/**
 * The life of a fund through the API against a real MySQL: first close, side letters with
 * four-eyes review, a capital call with an excused investor, approval, issue, bank payments
 * with every reconciliation outcome, a stale approval, a second closing with equalisation,
 * a distribution through the waterfall, an MFN election, the investor portal, and the controls
 * (ledger, audit chain, tenant isolation, idempotency).
 */
import { readFileSync } from "node:fs";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { createDb } from "../src/db/database.js";
import { OutboxService } from "../src/outbox/outbox.service.js";
import { camt054 } from "../src/payments/iso20022.js";
import { type Client, client, configure, createTenant, dropDatabase, freshDatabase, token } from "./helpers.js";

let url: string;
let app: NestFastifyApplication;
let tenant: string;
let alice: Client; // preparer
let bob: Client; // approver
let carol: Client; // preparer and approver
let outbox: OutboxService;
const ids: Record<string, string> = {};
const M = (eur: number) => String(Math.round(eur * 100)); // euros to cents

const drain = () => outbox.drain();

beforeAll(async () => {
  url = await freshDatabase();
  configure(url);
  tenant = await createTenant(url, "Spreeblick Capital");
  app = await createApp({ logger: false });
  await app.init();
  outbox = app.get(OutboxService);
  alice = client(app, await token(tenant, "alice", ["preparer"]));
  bob = client(app, await token(tenant, "bob", ["approver"]));
  carol = client(app, await token(tenant, "carol", ["preparer", "approver"]));
});

afterAll(async () => {
  await app?.close();
  if (url) await dropDatabase(url);
});

describe("a fund from first close to distribution", () => {
  it("sets up the fund and its first close", async () => {
    const f = await alice.post("/v1/funds", {
      name: "Spreeblick Growth Fund III",
      feeRateBps: 200,
      investmentPeriodEnd: "2030-01-01",
      firstCloseDate: "2026-01-15",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
    });
    expect(f.status).toBe(201);
    ids.fund = f.body.id;
    const investors: Array<[string, string, number]> = [
      ["A", "Atlas Family Office", 10_000_000],
      ["B", "Bergamt Stiftung", 5_000_000],
      ["C", "Nordlicht Pensionskasse", 20_000_000],
      ["D", "Dahlem Holdings", 20_000_000],
      ["E", "Elbe Ventures (late)", 10_000_000],
    ];
    for (const [k, name, eur] of investors) {
      const r = await alice.post("/v1/investors", {
        name,
        kind: "institution",
        country: "DE",
        kycStatus: "verified",
        iban: "DE02120300000000202051",
        bic: "BYLADEM1001",
      });
      expect(r.status).toBe(201);
      ids[k] = r.body.id;
      if (k !== "E")
        expect((await alice.post(`/v1/funds/${ids.fund}/commitments`, { investorId: ids[k], amount: M(eur) })).status).toBe(201);
    }
    const pending = await alice.post("/v1/investors", {
      name: "Unverified GmbH",
      kind: "institution",
      country: "DE",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
    });
    const refused = await alice.post(`/v1/funds/${ids.fund}/commitments`, { investorId: pending.body.id, amount: M(1_000_000) });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("KYC_NOT_VERIFIED");
  });

  it("extracts a side letter, and only a second person can approve its terms", async () => {
    const body = readFileSync(new URL("./fixtures/side-letter-pension.txt", import.meta.url), "utf8");
    const up = await carol.post(`/v1/funds/${ids.fund}/side-letters`, { investorId: ids.C, title: "Nordlicht side letter", body });
    expect(up.status).toBe(201);
    await drain();
    const sl = await carol.get(`/v1/side-letters/${up.body.id}`);
    const types = sl.body.provisions.map((p: { type: string }) => p.type).sort();
    expect(types).toEqual(["EXCUSE_RIGHT", "FEE_DISCOUNT", "MFN", "NOTICE_PERIOD", "REPORTING"]);
    for (const p of sl.body.provisions) {
      // every term points at the sentence it came from
      expect(body.slice(p.quote_start, p.quote_end)).toBe(p.quote);
    }
    const first = sl.body.provisions[0].id;
    const own = await carol.post(`/v1/provisions/${first}/decision`, { decision: "approve" });
    expect(own.status).toBe(403);
    expect(own.body.code).toBe("FOUR_EYES");
    for (const p of sl.body.provisions)
      expect((await bob.post(`/v1/provisions/${p.id}/decision`, { decision: "approve" })).status).toBe(201);
    const excuse = sl.body.provisions.find((p: { type: string }) => p.type === "EXCUSE_RIGHT");
    expect(excuse.params.sectors).toEqual(["fossil_fuels", "tobacco"]);
  });

  it("calculates a call with an excused investor, a fee discount and a longer notice period", async () => {
    const ev = await alice.post(`/v1/funds/${ids.fund}/calls`, {
      reference: "CALL-2026-01",
      issueDate: "2026-03-02",
      components: [
        { kind: "fee", periodStart: "2026-01-15", periodEnd: "2026-07-15" },
        { kind: "expense", amount: M(55_000) },
        { kind: "investment", deal: "kiln-tobacco", sectors: ["tobacco"], amount: M(3_500_000) },
      ],
    });
    expect(ev.status).toBe(201);
    ids.call1 = ev.body.id;
    const calc = await alice.post(`/v1/events/${ids.call1}/calculate`);
    expect(calc.status).toBe(201);
    expect(calc.body.status).toBe("calculated");
    const lines = (await alice.get(`/v1/events/${ids.call1}/lines`)).body as Array<{
      investor_id: string;
      components: string[];
      due_date: string;
    }>;
    const c = lines.find((l) => l.investor_id === ids.C);
    const a = lines.find((l) => l.investor_id === ids.A);
    expect(c?.components[2]).toBe("0"); // excused from the tobacco deal
    // A has 10m of the 35m non-excused commitments
    expect(a?.components[2]).toBe(M(1_000_000));
    // fee: 2% on 10m for 181 days vs 1.5% on 20m for 181 days
    expect(a?.components[0]).toBe(String(Math.round((10_000_000_00 * 0.02 * 181) / 365)));
    expect(c?.components[0]).toBe(String(Math.round((20_000_000_00 * 0.015 * 181) / 365)));
    expect(c?.due_date).toBe("2026-03-23"); // 15 business days
    expect(a?.due_date).toBe("2026-03-16"); // the fund's 10
  });

  it("enforces four eyes on the exact result, then issues and books it", async () => {
    const ev = (await alice.get(`/v1/events/${ids.call1}`)).body;
    const self = await carol.post(`/v1/events/${ids.call1}/approve`, { resultHash: ev.result_hash });
    expect(self.status).toBe(201); // carol did not prepare this one
    const wrong = await bob.post(`/v1/events/${ids.call1}/approve`, { resultHash: "0".repeat(64) });
    expect(wrong.body.code).toBe("RESULT_CHANGED");
    const ok = await bob.post(`/v1/events/${ids.call1}/approve`, { resultHash: ev.result_hash });
    expect(ok.body.status).toBe("approved");
    const issued = await alice.post(`/v1/events/${ids.call1}/issue`, {}, { "idempotency-key": "issue-call1" });
    expect(issued.body.status).toBe("issued");
    const again = await alice.post(`/v1/events/${ids.call1}/issue`, {}, { "idempotency-key": "issue-call1" });
    expect(again.body).toEqual(issued.body); // a retry does not book twice
    const verify = await alice.get(`/v1/funds/${ids.fund}/ledger/verify`);
    expect(verify.body.ok).toBe(true);
    await drain();
    const accounts = (await alice.get(`/v1/funds/${ids.fund}/capital-accounts`)).body;
    expect(accounts.totals.receivable).toBe(issued.body.totals.total);
  });

  it("refuses for the preparer to approve their own event", async () => {
    const ev = await alice.post(`/v1/funds/${ids.fund}/calls`, {
      reference: "CALL-2026-02",
      issueDate: "2026-04-01",
      components: [{ kind: "expense", amount: M(10_000) }],
    });
    ids.call2 = ev.body.id;
    const calc = await alice.post(`/v1/events/${ids.call2}/calculate`);
    const aliceApprover = client(app, await token(tenant, "alice", ["preparer", "approver"]));
    const self = await aliceApprover.post(`/v1/events/${ids.call2}/approve`, { resultHash: calc.body.result_hash });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe("FOUR_EYES");
    await bob.post(`/v1/events/${ids.call2}/approve`, { resultHash: calc.body.result_hash });
  });

  it("reconciles a camt.054: exact, short, unknown and a re-sent entry", async () => {
    const lines = (await alice.get(`/v1/events/${ids.call1}/lines`)).body as Array<{
      investor_id: string;
      total: string;
      end_to_end_id: string;
    }>;
    const byInv = (k: string) => lines.find((l) => l.investor_id === ids[k]);
    const entry = (k: string, ref: string, amount: bigint, e2e: string | null, remittance: string | null) => ({
      acctSvcrRef: ref,
      amount,
      bookingDate: "2026-03-12",
      endToEndId: e2e,
      remittance,
      debtorName: k,
      debtorIban: "DE02120300000000202051",
    });
    const A = byInv("A");
    const B = byInv("B");
    const C = byInv("C");
    const D = byInv("D");
    if (!A || !B || !C || !D) throw new Error("missing lines");
    const xml = camt054("BANK-0001", "DE89370400440532013000", "EUR", [
      entry("A", "R1", BigInt(A.total), A.end_to_end_id, null),
      entry("B", "R2", BigInt(B.total) - 100_00n, null, `Capital call ${B.end_to_end_id} Bergamt`), // short, matched by remittance
      entry("X", "R3", 123_45n, null, "no reference at all"),
      entry("C", "R4", BigInt(C.total), C.end_to_end_id, null),
    ]);
    const r = await alice.post(`/v1/funds/${ids.fund}/bank/camt054`, xml);
    expect(r.body).toMatchObject({ matched: 3, unmatched: 1, duplicates: 0 });
    const again = await alice.post(`/v1/funds/${ids.fund}/bank/camt054`, xml);
    expect(again.body.code).toBe("ALREADY_IMPORTED");
    // the bank re-sends R4 in a new message; it must not be booked twice
    const resend = camt054("BANK-0002", "DE89370400440532013000", "EUR", [
      entry("C", "R4", BigInt(C.total), C.end_to_end_id, null),
      entry("D", "R5", BigInt(D.total), D.end_to_end_id, null),
    ]);
    expect((await alice.post(`/v1/funds/${ids.fund}/bank/camt054`, resend)).body).toMatchObject({ matched: 1, duplicates: 1 });
    const after = (await alice.get(`/v1/events/${ids.call1}/lines`)).body as Array<{ investor_id: string; status: string }>;
    const status = Object.fromEntries(after.map((l) => [l.investor_id, l.status]));
    expect([status[ids.A ?? ""], status[ids.B ?? ""], status[ids.C ?? ""], status[ids.D ?? ""]]).toEqual([
      "paid",
      "partial",
      "paid",
      "paid",
    ]);
    // a person places the unknown credit on B's shortfall... it is the wrong amount, so B is overpaid
    const unmatched = (await alice.get(`/v1/funds/${ids.fund}/bank/entries?status=unmatched`)).body;
    expect(unmatched).toHaveLength(1);
    const res = await alice.post(`/v1/funds/${ids.fund}/bank/entries/${unmatched[0].id}/resolve`, {
      eventId: ids.call1,
      investorId: ids.B,
      note: "phoned Bergamt: second transfer",
    });
    expect(res.body.status).toBe("resolved");
    const pay = camt054("BANK-0003", "DE89370400440532013000", "EUR", [
      entry("B", "R6", 100_00n - 123_45n + 123_45n, B.end_to_end_id, null),
    ]);
    await alice.post(`/v1/funds/${ids.fund}/bank/camt054`, pay);
    expect((await alice.get(`/v1/funds/${ids.fund}/ledger/verify`)).body.ok).toBe(true);
  });

  it("refuses to issue an approval that the fund has outrun", async () => {
    // CALL-2026-02 was approved before CALL-2026-03 changes everyone's unfunded commitment
    const ev = await alice.post(`/v1/funds/${ids.fund}/calls`, {
      reference: "CALL-2026-03",
      issueDate: "2026-04-02",
      components: [{ kind: "investment", deal: "nordwind-software", sectors: ["software"], amount: M(9_000_000) }],
    });
    ids.call3 = ev.body.id;
    const calc = await alice.post(`/v1/events/${ids.call3}/calculate`);
    await bob.post(`/v1/events/${ids.call3}/approve`, { resultHash: calc.body.result_hash });
    expect((await alice.post(`/v1/events/${ids.call3}/issue`)).body.status).toBe("issued");
    // an expense call depends only on commitments, so CALL-2026-02 is still valid...
    expect((await alice.post(`/v1/events/${ids.call2}/issue`)).body.status).toBe("issued");
    // ...but a call sized to the remaining commitment is not, once another call has used some
    const big = await alice.post(`/v1/funds/${ids.fund}/calls`, {
      reference: "CALL-2026-04",
      issueDate: "2026-04-03",
      components: [{ kind: "investment", deal: "x", sectors: [], amount: M(40_000_000) }],
    });
    const bc = await alice.post(`/v1/events/${big.body.id}/calculate`);
    await bob.post(`/v1/events/${big.body.id}/approve`, { resultHash: bc.body.result_hash });
    const small = await alice.post(`/v1/funds/${ids.fund}/calls`, {
      reference: "CALL-2026-05",
      issueDate: "2026-04-03",
      components: [{ kind: "expense", amount: M(1_000) }],
    });
    const sc = await alice.post(`/v1/events/${small.body.id}/calculate`);
    await bob.post(`/v1/events/${small.body.id}/approve`, { resultHash: sc.body.result_hash });
    await alice.post(`/v1/events/${small.body.id}/issue`);
    const stale = await alice.post(`/v1/events/${big.body.id}/issue`);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_CALCULATION");
    const cancel = await alice.post(`/v1/events/${big.body.id}/cancel`);
    expect(cancel.body.status).toBe("cancelled");
  });

  it("admits a late investor at a second closing with equalisation", async () => {
    const ev = await alice.post(`/v1/funds/${ids.fund}/closings`, {
      reference: "CLOSE-2",
      closeDate: "2026-06-30",
      admissions: [{ investorId: ids.E, amount: M(10_000_000) }],
    });
    expect(ev.status).toBe(201);
    const calc = await alice.post(`/v1/events/${ev.body.id}/calculate`);
    expect(calc.status).toBe(201);
    const lines = (await alice.get(`/v1/events/${ev.body.id}/lines`)).body as Array<{
      investor_id: string;
      total: string;
      detail: Record<string, string>;
    }>;
    const e = lines.find((l) => l.investor_id === ids.E);
    expect(BigInt(e?.total ?? "0")).toBeGreaterThan(0n);
    const capital = lines.reduce((s, l) => s + BigInt(l.detail.capital_delta ?? "0"), 0n);
    const paidI = lines.reduce((s, l) => s + BigInt(l.detail.interest_paid ?? "0"), 0n);
    const recvI = lines.reduce((s, l) => s + BigInt(l.detail.interest_received ?? "0"), 0n);
    expect(capital).toBe(0n);
    expect(paidI).toBe(recvI);
    expect(paidI).toBeGreaterThan(0n);
    await bob.post(`/v1/events/${ev.body.id}/approve`, { resultHash: calc.body.result_hash });
    expect((await alice.post(`/v1/events/${ev.body.id}/issue`)).body.status).toBe("issued");
    await drain();
    const file = await alice.get(`/v1/events/${ev.body.id}/payment-file`);
    expect(file.body.xml).toContain("pain.001.001.09");
    const refunds = lines.filter((l) => BigInt(l.total) < 0n);
    expect(file.body.transactions).toBe(refunds.length);
    expect(BigInt(file.body.control_sum)).toBe(-refunds.reduce((s, l) => s + BigInt(l.total), 0n));
    const accounts = (await alice.get(`/v1/funds/${ids.fund}/capital-accounts`)).body;
    expect(accounts.totals.commitment).toBe(M(65_000_000));
    expect((await alice.get(`/v1/funds/${ids.fund}/ledger/verify`)).body.ok).toBe(true);
  });

  it("distributes proceeds through the waterfall and writes a payment file", async () => {
    const ev = await alice.post(`/v1/funds/${ids.fund}/distributions`, {
      reference: "DIST-2026-01",
      date: "2026-10-01",
      deal: "nordwind-software",
      amount: M(15_000_000),
    });
    const calc = await alice.post(`/v1/events/${ev.body.id}/calculate`);
    expect(calc.status).toBe(201);
    const lines = (await alice.get(`/v1/events/${ev.body.id}/lines`)).body as Array<{
      investor_id: string;
      total: string;
      detail: Record<string, string>;
    }>;
    const gross = lines.reduce((s, l) => s + BigInt(l.detail.gross ?? "0"), 0n);
    expect(gross).toBe(BigInt(M(15_000_000)));
    for (const l of lines) {
      expect(BigInt(l.total) + BigInt(l.detail.gp_total ?? "0")).toBe(BigInt(l.detail.gross ?? "0"));
    }
    await bob.post(`/v1/events/${ev.body.id}/approve`, { resultHash: calc.body.result_hash });
    await alice.post(`/v1/events/${ev.body.id}/issue`);
    await drain();
    const file = await alice.get(`/v1/events/${ev.body.id}/payment-file`);
    expect(BigInt(file.body.control_sum)).toBe(lines.reduce((s, l) => s + BigInt(l.total), 0n));
    expect((await alice.get(`/v1/funds/${ids.fund}/ledger/verify`)).body.ok).toBe(true);
  });

  it("lets an investor with an MFN right elect a smaller investor's terms", async () => {
    const body =
      "SIDE LETTER\n\n1. The Management Fee payable in respect of the Investor's Commitment shall be reduced by 25 basis points per annum.\n\n2. The General Partner shall offer the Investor co-investment opportunities alongside the Fund.\n";
    const up = await alice.post(`/v1/funds/${ids.fund}/side-letters`, { investorId: ids.B, title: "Bergamt side letter", body });
    await drain();
    for (const p of (await alice.get(`/v1/side-letters/${up.body.id}`)).body.provisions)
      await bob.post(`/v1/provisions/${p.id}/decision`, { decision: "approve" });
    // D has no MFN right; C has one, but already holds a better fee discount, and co-invest is carved out
    expect((await alice.get(`/v1/funds/${ids.fund}/mfn/${ids.D}`)).body.code).toBe("NO_MFN_RIGHT");
    expect((await alice.get(`/v1/funds/${ids.fund}/mfn/${ids.C}`)).body).toEqual([]);
  });

  it("shows each investor their own notices only", async () => {
    const asC = client(app, await token(tenant, "nordlicht-ir", ["investor"], ids.C));
    const notices = (await asC.get("/v1/me/notices")).body as Array<{ html: string; reference: string }>;
    expect(notices.length).toBeGreaterThanOrEqual(3);
    expect(notices.every((n) => n.html.includes("Nordlicht"))).toBe(true);
    expect((await asC.get(`/v1/funds/${ids.fund}/capital-accounts`)).status).toBe(403);
  });

  it("keeps tenants apart and the audit chain intact", async () => {
    const other = await createTenant(url, "Another Manager");
    const stranger = client(app, await token(other, "eve", ["preparer", "approver", "viewer"]));
    expect((await stranger.get(`/v1/funds/${ids.fund}`)).status).toBe(404);
    expect((await stranger.get(`/v1/events/${ids.call1}`)).status).toBe(404);
    expect((await stranger.get("/v1/funds")).body).toEqual([]);
    const v = await alice.get("/v1/audit/verify");
    expect(v.body.ok).toBe(true);
    expect(v.body.records).toBeGreaterThan(30);
    const db = createDb(url, { guard: false });
    await expect(sql`UPDATE audit_log SET actor = 'mallory' WHERE seq = 1`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM postings LIMIT 1`.execute(db)).rejects.toThrow(/immutable/);
    await db.destroy();
  });
});
