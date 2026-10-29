/**
 * A simulated fund manager, built through the same services the API uses: a master fund and
 * a private-client feeder, institutional and private investors, side letters in many drafting
 * styles, calls, bank payments with the usual problems, a second closing and a distribution.
 * Deterministic for a seed.
 */

import { addBusinessDays } from "@cee/engine";
import type { INestApplicationContext } from "@nestjs/common";
import type { Principal } from "../auth/principal.js";
import { newId } from "../common/util.js";
import type { Db } from "../db/database.js";
import { SYSTEM_DB } from "../db/db.module.js";
import { EventsService } from "../events/events.service.js";
import { FundsService } from "../funds/funds.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { camt054 } from "../payments/iso20022.js";
import { PaymentsService } from "../payments/payments.service.js";
import { SideLettersService } from "../side-letters/side-letters.service.js";

let state = 1;
const rnd = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const INSTITUTIONS = [
  "Nordlicht Pensionskasse VVaG",
  "Bayerische Versorgungskammer Spezialfonds",
  "Rheinland Versicherung AG",
  "Hanseatic Family Office",
  "Stiftung Mercator Vermögen",
  "Kirchliche Zusatzversorgungskasse",
  "Aarhus Pension A/S",
  "Helvetia Vorsorge",
  "Ostsee Stiftung",
  "Lombard Sovereign Holdings",
  "Alpenland Fund of Funds",
  "Dutch Care Pension Fund",
  "Elbe Family Office",
  "Isar Endowment",
  "Main Capital Insurance",
  "Bodensee Versorgungswerk",
  "Luxembourg Retirement Plan",
  "Nordic Growth FoF",
  "Spree Ventures Holding",
  "Weser Stiftung",
  "Danube Pension Trust",
  "Harz Family Holding",
  "Taunus Asset Management",
  "Mosel Insurance Group",
];
const FIRST = [
  "Anna",
  "Jonas",
  "Lea",
  "Felix",
  "Mia",
  "Lukas",
  "Sofia",
  "Noah",
  "Emma",
  "Paul",
  "Clara",
  "Ben",
  "Ida",
  "Elias",
  "Greta",
  "Moritz",
];
const LAST = [
  "Becker",
  "Schulz",
  "Wagner",
  "Hoffmann",
  "Koch",
  "Richter",
  "Klein",
  "Wolf",
  "Neumann",
  "Schwarz",
  "Braun",
  "Zimmermann",
  "Hartmann",
  "Krüger",
];

const LETTERS = [
  (name: string) =>
    `SIDE LETTER\n\nSpreeblick Growth Fund III SCSp\n${name} (the "Investor")\n\n1. Management Fee. The Management Fee payable in respect of the Investor's Commitment shall be reduced by 25 basis points per annum.\n\n2. Reporting. The General Partner shall provide the Investor with a quarterly ESG report on each Portfolio Company.\n\n3. Confidentiality. This letter is confidential.\n`,
  (name: string) =>
    `Dear ${name},\n\nWith reference to your subscription, we agree that:\n\n(a) You shall be excused from participating in any investment in companies engaged in tobacco, gambling or thermal coal.\n\n(b) The General Partner shall give you not less than fifteen (15) Business Days' notice of each capital call.\n\n(c) You shall be entitled to elect the benefit of rights granted to other investors under the most favoured nation provisions of the Partnership Agreement.\n\nYours faithfully,\nSpreeblick Capital GP S.à r.l.\n`,
  (name: string) =>
    `SIDE LETTER AGREEMENT\n\nRecitals: ${name} is a public pension institution subject to the state transparency act.\n\n1. Nothing in the Partnership Agreement shall prevent the Investor from making disclosures required by any freedom of information or public records law.\n\n2. The Investor shall be excused from any investment in weapons or munitions manufacturers where its participation would breach the investment regulations applicable to it.\n\n3. The Investor shall be entitled to appoint one member of the Advisory Committee.\n`,
  (name: string) =>
    `Side letter: ${name}\n\nIn consideration of its Commitment at the First Closing, the Management Fee applicable to the Investor shall be reduced by 50 bps for the life of the Fund.\n\nThe carried interest attributable to the Investor shall be reduced to 17.5% of profits.\n\nThe General Partner shall use commercially reasonable efforts to minimise withholding tax on distributions to the Investor.\n`,
  (name: string) =>
    `${name}: side letter\n\n1. The General Partner shall offer the Investor co-investment opportunities in Portfolio Investments where the Fund's allocation exceeds its concentration limit.\n\n2. The General Partner will deliver an annual principal adverse impact report.\n\n3. The Investor shall be entitled to the benefit of the most favoured nation provisions and may elect terms granted to other investors.\n`,
];

export interface WorldOptions {
  institutions: number;
  privateClients: number;
  lateInvestors: number;
  seed: number;
}

export const buildWorld = async (app: INestApplicationContext, tenantName: string, o: WorldOptions) => {
  state = o.seed;
  const sys = app.get<Db>(SYSTEM_DB);
  const funds = app.get(FundsService);
  const events = app.get(EventsService);
  const letters = app.get(SideLettersService);
  const payments = app.get(PaymentsService);
  const outbox = app.get(OutboxService);

  const tenantId = newId();
  await sys.insertInto("tenants").values({ id: tenantId, name: tenantName }).execute();
  const alice: Principal = { sub: "alice@spreeblick.example", name: "Alice Brandt", tenantId, roles: ["preparer"] };
  const bob: Principal = { sub: "bob@spreeblick.example", name: "Bob Okafor", tenantId, roles: ["approver"] };

  const master = await funds.createFund(alice, {
    name: "Spreeblick Growth Fund III",
    currency: "EUR",
    kind: "master",
    feeRateBps: 200,
    investmentPeriodEnd: "2031-01-15",
    defaultNoticeDays: 10,
    hurdleBps: 800,
    carryBps: 2000,
    equalisationRateBps: 600,
    firstCloseDate: "2026-01-15",
    iban: "LU280019400644750000",
    bic: "BCEELULL",
  });
  const feeder = await funds.createFund(alice, {
    name: "Spreeblick Private Clients Feeder",
    currency: "EUR",
    kind: "feeder",
    masterFundId: master.id,
    feeRateBps: 0,
    investmentPeriodEnd: "2031-01-15",
    defaultNoticeDays: 15,
    hurdleBps: 0,
    carryBps: 0,
    equalisationRateBps: 600,
    firstCloseDate: "2026-01-15",
    iban: "DE44500105175407324931",
    bic: "INGDDEFFXXX",
  });

  const iban = () => `DE${between(10, 99)}${String(between(10_000_000, 99_999_999))}${String(between(1_000_000_000, 9_999_999_999))}`;
  const investor = async (name: string, kind: "individual" | "institution" | "feeder", extra: { feederFundId?: string } = {}) =>
    (
      await funds.createInvestor(alice, {
        name,
        kind,
        country: pick(["DE", "DE", "LU", "NL", "AT", "DK", "CH"]),
        kycStatus: "verified",
        iban: iban(),
        bic: "COBADEFFXXX",
        ...extra,
      })
    ).id;

  const feederLp = await investor("Spreeblick Private Clients Feeder", "feeder", { feederFundId: feeder.id });
  const institutions: string[] = [];
  for (let i = 0; i < o.institutions; i++) {
    const name = INSTITUTIONS[i % INSTITUTIONS.length] + (i >= INSTITUTIONS.length ? ` ${Math.floor(i / INSTITUTIONS.length) + 1}` : "");
    const id = await investor(name, "institution");
    institutions.push(id);
    await funds.addCommitment(alice, master.id, { investorId: id, amount: BigInt(pick([5, 10, 15, 20, 25, 30, 40, 50])) * 1_000_000_00n });
  }
  let feederTotal = 0n;
  for (let i = 0; i < o.privateClients; i++) {
    const id = await investor(`${pick(FIRST)} ${pick(LAST)}`, "individual");
    const amount = BigInt(pick([100, 125, 150, 200, 250, 500, 1000])) * 1_000_00n;
    feederTotal += amount;
    await funds.addCommitment(alice, feeder.id, { investorId: id, amount });
  }
  if (feederTotal > 0n) await funds.addCommitment(alice, master.id, { investorId: feederLp, amount: feederTotal });

  // side letters for the larger institutions, reviewed by a second person
  for (const [i, id] of institutions.slice(0, Math.min(12, institutions.length)).entries()) {
    const name = INSTITUTIONS[i % INSTITUTIONS.length] ?? "Investor";
    await letters.upload(alice, master.id, {
      investorId: id,
      title: `${name} side letter`,
      body: (LETTERS[i % LETTERS.length] ?? LETTERS[0])?.(name) ?? "",
    });
  }
  await outbox.drain();
  const proposed = await letters.provisions(tenantId, master.id, "proposed");
  // one extraction is rejected on review, to show the trail
  for (const [i, prov] of proposed.entries()) await letters.decide(bob, prov.id, { decision: i === 3 ? "reject" : "approve" });

  // and one letter arrives later and waits for review in the console
  const lateLetter = institutions[12];
  if (lateLetter) {
    const name = INSTITUTIONS[12 % INSTITUTIONS.length] ?? "Investor";
    await letters.upload(alice, master.id, {
      investorId: lateLetter,
      title: `${name} side letter`,
      body: (LETTERS[1] ?? LETTERS[0])?.(name) ?? "",
    });
    await outbox.drain();
  }

  const run = async (create: () => Promise<{ id: string }>, opts: { issue?: boolean; approve?: boolean } = {}) => {
    const ev = await create();
    const calc = await events.calculate(alice, ev.id).catch((e: unknown) => e);
    if (calc instanceof Error) return { id: ev.id, failed: calc.message };
    const got = await events.get(tenantId, ev.id);
    if (opts.approve === false) return { id: ev.id };
    await events.approve(bob, ev.id, got.result_hash ?? "");
    if (opts.issue !== false) await events.issue(alice, ev.id);
    await outbox.drain();
    return { id: ev.id };
  };

  const call1 = await run(() =>
    events.createCall(alice, master.id, {
      reference: "CALL-2026-01",
      issueDate: "2026-02-02",
      components: [
        { kind: "fee", periodStart: "2026-01-15", periodEnd: "2026-07-15" },
        { kind: "expense", amount: "18500000", description: "Organisational expenses" },
        { kind: "investment", deal: "Kontor Logistics", sectors: ["software"], amount: "3800000000" },
      ],
    }),
  );

  // the bank: most pay on time, a few short, one with no reference, one re-sent
  const pay = async (eventId: string, msg: string, bookingDate: string) => {
    const lines = await events.lines(tenantId, eventId);
    const entries = [];
    let n = 0;
    for (const l of lines) {
      const total = BigInt(l.total);
      if (total <= 0n) continue;
      n += 1;
      const r = rnd();
      if (r < 0.04) continue; // late: not yet paid
      const amount = r < 0.08 ? total - BigInt(between(1, 500)) * 100n : total;
      const byRemittance = r > 0.9;
      entries.push({
        acctSvcrRef: `${msg}-${n}`,
        amount,
        bookingDate,
        endToEndId: byRemittance ? null : l.end_to_end_id,
        remittance: byRemittance ? `Kapitalabruf ${l.end_to_end_id}` : null,
        debtorName: l.investor_name,
        debtorIban: "DE02120300000000202051",
      });
    }
    entries.push({
      acctSvcrRef: `${msg}-X`,
      amount: 250_000_00n,
      bookingDate,
      endToEndId: null,
      remittance: "Einzahlung",
      debtorName: "Unknown sender",
      debtorIban: "DE75512108001245126199",
    });
    await payments.importCamt054(alice, master.id, camt054(msg, "LU280019400644750000", "EUR", entries));
    if (entries[0]) await payments.importCamt054(alice, master.id, camt054(`${msg}-R`, "LU280019400644750000", "EUR", [entries[0]]));
  };
  await pay(call1.id, "CAMT-2026-0211", addBusinessDays("2026-02-02", 8));
  if (o.privateClients > 0) await run(() => events.createFeederCall(alice, call1.id, feeder.id, "2026-01-19"));

  // second closing: late investors with equalisation
  const late: Array<{ investorId: string; amount: string }> = [];
  for (let i = 0; i < o.lateInvestors; i++) {
    const id = await investor(
      `${pick(["Ruhr", "Neckar", "Saale", "Havel", "Lahn"])} ${pick(["Pension", "Stiftung", "Capital", "Holding"])} ${i + 1}`,
      "institution",
    );
    late.push({ investorId: id, amount: String(BigInt(pick([5, 10, 20])) * 1_000_000_00n) });
  }
  if (late.length)
    await run(() => events.createClosing(alice, master.id, { reference: "CLOSE-2026-2", closeDate: "2026-06-30", admissions: late }));

  const call2 = await run(() =>
    events.createCall(alice, master.id, {
      reference: "CALL-2026-02",
      issueDate: "2026-07-01",
      components: [
        { kind: "fee", periodStart: "2026-07-15", periodEnd: "2027-01-15" },
        { kind: "investment", deal: "Hafen Energy", sectors: ["fossil_fuels"], amount: "2400000000" },
      ],
    }),
  );
  await pay(call2.id, "CAMT-2026-0715", "2026-07-15");

  await run(() =>
    events.createDistribution(alice, master.id, {
      reference: "DIST-2026-01",
      date: "2026-10-01",
      deal: "Kontor Logistics",
      amount: "6100000000",
    }),
  );

  // work in progress for the console: one awaiting approval, one that fails its calculation
  await run(
    () =>
      events.createCall(alice, master.id, {
        reference: "CALL-2026-03",
        issueDate: "2026-11-02",
        components: [{ kind: "investment", deal: "Brandenburg Robotics", sectors: ["software"], amount: "3100000000" }],
      }),
    { approve: false },
  );
  const over = await events.createCall(alice, master.id, {
    reference: "CALL-2026-04",
    issueDate: "2026-11-03",
    components: [{ kind: "investment", deal: "Too Big To Fund", sectors: [], amount: "990000000000" }],
  });
  await events.calculate(alice, over.id).catch(() => undefined);

  return { tenantId, masterId: master.id, feederId: feeder.id };
};
