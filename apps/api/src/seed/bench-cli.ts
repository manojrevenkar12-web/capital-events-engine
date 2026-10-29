/**
 * Benchmark at the scale bunch operates (150 funds, 12,000 LPs): one fund with N LPs through
 * a call, issue, notices, a bank file with a payment from every LP, a closing and a
 * distribution. Writes reports/benchmarks/latest.json.
 */
import "reflect-metadata";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import type { Principal } from "../auth/principal.js";
import { newId } from "../common/util.js";
import { loadConfig } from "../config/config.js";
import type { Db } from "../db/database.js";
import { createDb, migrate } from "../db/database.js";
import { SYSTEM_DB } from "../db/db.module.js";
import { EventsService } from "../events/events.service.js";
import { FundsService } from "../funds/funds.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { camt054 } from "../payments/iso20022.js";
import { PaymentsService } from "../payments/payments.service.js";

process.env.OUTBOX_WORKER = "off";
const N = Number(process.argv.find((a) => a.startsWith("--lps="))?.split("=")[1] ?? 5000);
const config = loadConfig();
const mdb = createDb(config.DATABASE_URL, { guard: false });
await migrate(mdb as never);
await mdb.destroy();

const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
const sys = app.get<Db>(SYSTEM_DB);
const funds = app.get(FundsService);
const events = app.get(EventsService);
const payments = app.get(PaymentsService);
const outbox = app.get(OutboxService);
const ledger = app.get(LedgerService);

const tenantId = newId();
await sys
  .insertInto("tenants")
  .values({ id: tenantId, name: `bench-${N}` })
  .execute();
const alice: Principal = { sub: "alice", name: "alice", tenantId, roles: ["preparer"] };
const bob: Principal = { sub: "bob", name: "bob", tenantId, roles: ["approver"] };

const timings: Record<string, number> = {};
const time = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  const r = await f();
  timings[name] = Math.round(performance.now() - t);
  return r;
};

const fund = await funds.createFund(alice, {
  name: `Benchmark Fund ${N}`,
  currency: "EUR",
  kind: "master",
  feeRateBps: 200,
  investmentPeriodEnd: "2031-01-01",
  defaultNoticeDays: 10,
  hurdleBps: 800,
  carryBps: 2000,
  equalisationRateBps: 600,
  firstCloseDate: "2026-01-15",
  iban: "LU280019400644750000",
  bic: "BCEELULL",
});
// bulk-load investors and commitments directly: the benchmark is about capital events
await time("load_investors", async () => {
  for (let i = 0; i < N; i += 1000) {
    const rows = Array.from({ length: Math.min(1000, N - i) }, (_, j) => ({
      id: newId(),
      tenant_id: tenantId,
      name: `Investor ${i + j}`,
      kind: "individual" as const,
      country: "DE",
      kyc_status: "verified" as const,
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      feeder_fund_id: null,
    }));
    await sys.insertInto("investors").values(rows).execute();
    await sys
      .insertInto("commitments")
      .values(
        rows.map((r, j) => ({
          id: newId(),
          tenant_id: tenantId,
          fund_id: fund.id,
          investor_id: r.id,
          amount: String((1 + ((i + j) % 50)) * 100_000_00),
          admitted: "2026-01-15",
        })),
      )
      .execute();
  }
});

const cycle = async (label: string, create: () => Promise<{ id: string }>) => {
  const ev = await create();
  await time(`${label}.calculate`, () => events.calculate(alice, ev.id));
  const got = await events.get(tenantId, ev.id);
  await events.approve(bob, ev.id, got.result_hash ?? "");
  await time(`${label}.issue`, () => events.issue(alice, ev.id));
  await time(`${label}.outbox`, () => outbox.drain());
  return ev.id;
};

const callId = await cycle("call", () =>
  events.createCall(alice, fund.id, {
    reference: "BENCH-CALL-1",
    issueDate: "2026-02-02",
    components: [
      { kind: "fee", periodStart: "2026-01-15", periodEnd: "2026-07-15" },
      { kind: "expense", amount: "10000000", description: "x" },
      { kind: "investment", deal: "bench-deal", sectors: [], amount: String(BigInt(N) * 25_000_00n) },
    ],
  }),
);
const lines = await events.lines(tenantId, callId);
const xml = camt054(
  "BENCH-CAMT-1",
  "LU280019400644750000",
  "EUR",
  lines.map((l, i) => ({
    acctSvcrRef: `B${i}`,
    amount: BigInt(l.total),
    bookingDate: "2026-02-12",
    endToEndId: l.end_to_end_id,
    remittance: null,
    debtorName: "x",
    debtorIban: "DE02120300000000202051",
  })),
);
const imported = await time("camt054.import", () => payments.importCamt054(alice, fund.id, xml));

const late: Array<{ investorId: string; amount: string }> = [];
for (let i = 0; i < Math.max(1, Math.floor(N / 10)); i++) {
  const id = newId();
  await sys
    .insertInto("investors")
    .values({
      id,
      tenant_id: tenantId,
      name: `Late ${i}`,
      kind: "individual",
      country: "DE",
      kyc_status: "verified",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      feeder_fund_id: null,
    })
    .execute();
  late.push({ investorId: id, amount: "50000000" });
}
await cycle("closing", () =>
  events.createClosing(alice, fund.id, { reference: "BENCH-CLOSE-2", closeDate: "2026-06-30", admissions: late }),
);
await cycle("distribution", () =>
  events.createDistribution(alice, fund.id, {
    reference: "BENCH-DIST-1",
    date: "2026-10-01",
    deal: "bench-deal",
    amount: String(BigInt(N) * 40_000_00n),
  }),
);
const verify = await time("ledger.verify", () => ledger.verify(tenantId, fund.id));
const postings = await sys
  .selectFrom("postings")
  .select((eb) => eb.fn.countAll<string>().as("n"))
  .where("tenant_id", "=", tenantId)
  .executeTakeFirst();

const report = {
  lps: N,
  lateLps: late.length,
  machine: {
    cpus: (await import("node:os")).cpus().length,
    mysql: (await sys.selectNoFrom((eb) => eb.fn<string>("version").as("v")).executeTakeFirst())?.v,
  },
  timingsMs: timings,
  callLines: lines.length,
  camt054: imported,
  postings: Number(postings?.n ?? 0),
  ledgerOk: verify.ok,
  at: new Date().toISOString(),
};
const out = resolve(process.cwd().endsWith("apps/api") ? "../.." : ".", "reports/benchmarks");
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, `latest-${N}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await app.close();
