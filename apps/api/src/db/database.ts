import { Kysely, MysqlDialect } from "kysely";
import { type MigrationProvider, Migrator } from "kysely/migration";
import { createPool } from "mysql2";
import { migrations } from "./migrations.js";
import type { Database } from "./schema.js";
import { TenancyGuard } from "./tenancy.js";

export type Db = Kysely<Database>;

export const createDb = (url: string, opts: { guard?: boolean; poolSize?: number } = {}): Db => {
  const u = new URL(url);
  const pool = createPool({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    connectionLimit: opts.poolSize ?? 10,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: ["DATE"],
    timezone: "Z",
    multipleStatements: false,
  });
  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool }),
    plugins: opts.guard === false ? [] : [new TenancyGuard()],
  });
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

export const migrate = async (db: Kysely<unknown>): Promise<string[]> => {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  if (error) throw error;
  return (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
};
