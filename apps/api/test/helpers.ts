import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createPool } from "mysql2/promise";
import type { Role } from "../src/auth/principal.js";
import { issueToken } from "../src/auth/tokens.js";
import { newId } from "../src/common/util.js";
import { createDb, migrate } from "../src/db/database.js";

const BASE = process.env.CEE_TEST_DATABASE_URL ?? "mysql://cee:cee@127.0.0.1:3306/cee";
export const SECRET = "test-secret-test-secret-test-secret-0001";
export const ISSUER = "https://id.cee.local";

/** A fresh, migrated database for one test file. */
export const freshDatabase = async (): Promise<string> => {
  const u = new URL(BASE);
  const name = `cee_t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const pool = createPool({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  });
  await pool.query(`CREATE DATABASE \`${name}\``);
  await pool.end();
  u.pathname = `/${name}`;
  const url = u.toString();
  const db = createDb(url, { guard: false });
  await migrate(db as never);
  await db.destroy();
  return url;
};

export const dropDatabase = async (url: string): Promise<void> => {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  const pool = createPool({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
  });
  await pool.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await pool.end();
};

export const createTenant = async (url: string, name: string): Promise<string> => {
  const db = createDb(url, { guard: false });
  const id = newId();
  await db.insertInto("tenants").values({ id, name }).execute();
  await db.destroy();
  return id;
};

export const token = (tid: string, sub: string, roles: Role[], inv?: string) =>
  issueToken(SECRET, ISSUER, { sub, name: sub, tid, roles, ...(inv ? { inv } : {}) });

export const configure = (url: string) => {
  process.env.DATABASE_URL = url;
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_ISSUER = ISSUER;
  process.env.OUTBOX_WORKER = "off";
  process.env.DEV_TOKENS = "on";
};

export interface Client {
  get: (path: string) => Promise<{ status: number; body: any }>;
  post: (path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
}

export const client = (app: NestFastifyApplication, bearer: string): Client => {
  const call = async (method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${bearer}`,
          ...(typeof payload === "string" ? { "content-type": "application/xml" } : {}),
          ...headers,
        },
        ...(payload === undefined ? {} : { payload: payload as never }),
      });
    const text = res.body;
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.statusCode, body };
  };
  return { get: (p) => call("GET", p), post: (p, b, h) => call("POST", p, b ?? {}, h) };
};
