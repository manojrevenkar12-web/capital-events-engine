import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../src/db/database.js";
import { dropDatabase, freshDatabase } from "./helpers.js";

/** Found while building the console: DEFAULT CURRENT_TIMESTAMP columns were an hour off on a CET server. */
describe("timestamps", () => {
  let url: string;
  let db: Db;
  beforeAll(async () => {
    url = await freshDatabase();
    db = createDb(url, { guard: false, poolSize: 3 });
  });
  afterAll(async () => {
    await db.destroy();
    await dropDatabase(url);
  });

  it("every pooled session runs in UTC", async () => {
    const zones = await Promise.all(
      Array.from({ length: 3 }, () => sql<{ tz: string }>`SELECT @@session.time_zone AS tz, SLEEP(0.05)`.execute(db)),
    );
    for (const z of zones) expect(z.rows[0]?.tz).toBe("+00:00");
  });

  it("a database default and a value written from Node describe the same instant", async () => {
    const before = Date.now();
    await db.insertInto("tenants").values({ id: "01TIMEZONE0000000000000000", name: "tz" }).execute();
    const row = await db
      .selectFrom("tenants")
      .select("created_at")
      .where("id", "=", "01TIMEZONE0000000000000000")
      .executeTakeFirstOrThrow();
    const at = new Date(row.created_at as unknown as string).getTime();
    expect(Math.abs(at - before)).toBeLessThan(5_000);
  });
});
