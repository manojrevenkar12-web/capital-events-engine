/** pnpm seed: migrate, then build the simulated manager and print dev tokens for the console. */
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module.js";
import { issueToken } from "../auth/tokens.js";
import { loadConfig } from "../config/config.js";
import { createDb, migrate } from "../db/database.js";
import { buildWorld } from "./world.js";

process.env.OUTBOX_WORKER = "off";
const config = loadConfig();
const db = createDb(config.DATABASE_URL, { guard: false });
await migrate(db as never);
await db.destroy();

const arg = (name: string, d: number) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? d);
const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
const t0 = performance.now();
const w = await buildWorld(app, "Spreeblick Capital", {
  institutions: arg("institutions", 24),
  privateClients: arg("private-clients", 400),
  lateInvestors: arg("late", 6),
  seed: arg("seed", 2026),
});
const tok = (sub: string, roles: Array<"preparer" | "approver" | "viewer" | "admin">) =>
  issueToken(config.JWT_SECRET, config.JWT_ISSUER, { sub, tid: w.tenantId, roles }, "30d");
console.log(
  JSON.stringify(
    {
      ...w,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      tokens: {
        alice: await tok("alice@spreeblick.example", ["preparer", "viewer"]),
        bob: await tok("bob@spreeblick.example", ["approver", "viewer"]),
      },
    },
    null,
    2,
  ),
);
await app.close();
