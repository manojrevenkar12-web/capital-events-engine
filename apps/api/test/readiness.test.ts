import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "kysely";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApp } from "../src/bootstrap.js";
import { createDb } from "../src/db/database.js";
import { configure, dropDatabase, freshDatabase } from "./helpers.js";

/** Found on the kind cluster: MySQL 8.4 refused to create the triggers for a non-SUPER user. */
let url: string;
let app: NestFastifyApplication;
beforeAll(async () => {
  url = await freshDatabase();
  configure(url);
});
afterAll(async () => {
  await app?.close();
  if (url) await dropDatabase(url);
});

it("is not ready when the ledger's append-only triggers are missing", async () => {
  const db = createDb(url, { guard: false });
  await sql`DROP TRIGGER postings_no_delete`.execute(db);
  await db.destroy();
  app = await createApp({ logger: false });
  await app.init();
  const res = await app.inject({ method: "GET", url: "/readyz" });
  expect(res.statusCode).toBe(503);
  expect(res.json().title).toContain("postings_no_delete");
});
