import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from "kysely";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/db/schema.js";
import { TenancyGuard } from "../src/db/tenancy.js";

const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new MysqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (k) => new MysqlIntrospector(k),
    createQueryCompiler: () => new MysqlQueryCompiler(),
  },
  plugins: [new TenancyGuard()],
});

describe("tenancy guard", () => {
  it("refuses a select without a tenant filter", () => {
    expect(() => db.selectFrom("funds").selectAll().where("id", "=", "x").compile()).toThrow(/tenant_id/);
  });
  it("accepts a filtered select", () => {
    expect(() => db.selectFrom("funds").selectAll().where("tenant_id", "=", "t").where("id", "=", "x").compile()).not.toThrow();
  });
  it("requires every joined tenant table to be tied to the tenant", () => {
    const loose = db
      .selectFrom("event_lines as l")
      .innerJoin("investors as i", "i.id", "l.investor_id")
      .selectAll("l")
      .where("l.tenant_id", "=", "t");
    expect(() => loose.compile()).toThrow(/investors/);
    const tied = db
      .selectFrom("event_lines as l")
      .innerJoin("investors as i", (j) => j.onRef("i.id", "=", "l.investor_id").onRef("i.tenant_id", "=", "l.tenant_id"))
      .selectAll("l")
      .where("l.tenant_id", "=", "t");
    expect(() => tied.compile()).not.toThrow();
  });
  it("refuses updates and deletes without a tenant filter", () => {
    expect(() => db.updateTable("capital_events").set({ status: "cancelled" }).where("id", "=", "x").compile()).toThrow();
    expect(() => db.deleteFrom("event_lines").where("event_id", "=", "x").compile()).toThrow();
  });
  it("refuses an insert without tenant_id", () => {
    expect(() =>
      db
        .insertInto("journal")
        .values({ id: "j", fund_id: "f", kind: "k", description: "d" } as never)
        .compile(),
    ).toThrow();
  });
  it("leaves the tenants table alone", () => {
    expect(() => db.selectFrom("tenants").selectAll().compile()).not.toThrow();
  });
});
