import "reflect-metadata";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOpenApi } from "../src/http/openapi.js";

const doc = buildOpenApi();
type Op = { requestBody?: unknown; security?: unknown[]; "x-roles"?: string[]; summary: string };
const ops = Object.entries(doc.paths).flatMap(([path, methods]) =>
  Object.entries(methods as Record<string, Op>).map(([m, op]) => ({ key: `${m.toUpperCase()} ${path}`, op })),
);

describe("OpenAPI contract", () => {
  it("is the committed docs/openapi.json (run `pnpm --filter @cee/api openapi` after changing a route)", () => {
    const committed = JSON.parse(readFileSync(new URL("../../../docs/openapi.json", import.meta.url), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)));
  });
  it("documents every write with the schema its handler validates", () => {
    const writes = ops.filter((o) => o.key.startsWith("POST /v1") && !o.key.match(/calculate|issue|cancel/));
    expect(writes.length).toBe(14);
    for (const w of writes) expect(w.op.requestBody, w.key).toBeDefined();
  });
  it("marks only health, metrics and the dev identity provider as open, and gives every other route roles", () => {
    const open = ops.filter((o) => Array.isArray(o.op.security) && o.op.security.length === 0).map((o) => o.key);
    expect(open.sort()).toEqual(["GET /healthz", "GET /metrics", "GET /readyz", "GET /v1/dev/tenants", "POST /v1/dev/token"]);
    for (const o of ops.filter((x) => !open.includes(x.key))) expect(o.op["x-roles"]?.length, o.key).toBeGreaterThan(0);
  });
  it("has a written summary for every operation", () => {
    for (const o of ops) expect(o.op.summary, o.key).toMatch(/ /);
  });
});
