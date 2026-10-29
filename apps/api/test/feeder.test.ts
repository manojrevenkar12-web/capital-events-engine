import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { type Client, client, configure, createTenant, dropDatabase, freshDatabase, token } from "./helpers.js";

let url: string;
let app: NestFastifyApplication;
let alice: Client;

beforeAll(async () => {
  url = await freshDatabase();
  configure(url);
  const tenant = await createTenant(url, "Feeder Manager");
  app = await createApp({ logger: false });
  await app.init();
  alice = client(app, await token(tenant, "alice", ["preparer", "viewer"]));
});
afterAll(async () => {
  await app?.close();
  if (url) await dropDatabase(url);
});

const fundBody = (name: string, kind: string, notice: number) => ({
  name,
  kind,
  feeRateBps: 200,
  investmentPeriodEnd: "2030-01-01",
  firstCloseDate: "2026-01-15",
  defaultNoticeDays: notice,
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
});
const inv = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: "institution",
  country: "DE",
  kycStatus: "verified",
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  ...extra,
});

it("passes a master call through a feeder and flags when it cannot collect in time", async () => {
  const master = (await alice.post("/v1/funds", fundBody("Master Fund", "master", 10))).body;
  const feeder = (await alice.post("/v1/funds", fundBody("Feeder Fund (private clients)", "feeder", 20))).body;
  const feederAsLp = (await alice.post("/v1/investors", inv("Feeder Fund (as LP)", { kind: "feeder", feederFundId: feeder.id }))).body;
  const direct = (await alice.post("/v1/investors", inv("Direct LP"))).body;
  await alice.post(`/v1/funds/${master.id}/commitments`, { investorId: feederAsLp.id, amount: "1000000000" });
  await alice.post(`/v1/funds/${master.id}/commitments`, { investorId: direct.id, amount: "3000000000" });
  for (let i = 0; i < 40; i++) {
    const c = (await alice.post("/v1/investors", inv(`Private client ${i}`))).body;
    await alice.post(`/v1/funds/${feeder.id}/commitments`, { investorId: c.id, amount: String((i + 1) * 1_000_000) });
  }
  const call = (
    await alice.post(`/v1/funds/${master.id}/calls`, {
      reference: "M-CALL-1",
      issueDate: "2026-03-02",
      components: [
        { kind: "expense", amount: "4000000" },
        { kind: "investment", deal: "d1", sectors: [], amount: "400000000" },
      ],
    })
  ).body;
  await alice.post(`/v1/events/${call.id}/calculate`);
  const plan = (await alice.get(`/v1/events/${call.id}/feeder-plan`)).body;
  expect(plan).toHaveLength(1);
  // the feeder's LPs need 20 business days, the master gives 10: the feeder needs a bridge
  expect(plan[0].bridgeRequired).toBe(true);
  expect(plan[0].investors).toBe(40);

  const fc = await alice.post(`/v1/events/${call.id}/feeder-calls`, { feederFundId: feeder.id, issueDate: "2026-03-02" });
  expect(fc.status).toBe(201);
  const calc = await alice.post(`/v1/events/${fc.body.id}/calculate`);
  expect(calc.status).toBe(201);
  // the feeder's LPs together owe exactly the feeder's line of the master call
  expect(calc.body.totals.total).toBe(plan[0].masterLineTotal);
});
