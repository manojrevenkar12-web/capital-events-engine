/**
 * OpenAPI 3.1 for the API, built from the controllers themselves: Nest's route metadata gives
 * paths, methods, parameters and roles; @Accepts gives the zod schema each body is validated
 * with. `pnpm --filter @cee/api openapi` writes docs/openapi.json and a test fails when the
 * committed document differs from the code.
 */
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import { z } from "zod";
import { BODY_SCHEMA, BODY_XML } from "./contract.js";
import {
  AuditController,
  DevController,
  EventsController,
  FundsController,
  HealthController,
  PaymentsController,
  PortalController,
  SideLettersController,
} from "./controllers.js";

const CONTROLLERS = [
  HealthController,
  DevController,
  FundsController,
  SideLettersController,
  EventsController,
  PaymentsController,
  AuditController,
  PortalController,
] as const;
const VERBS = ["get", "post", "put", "delete", "patch", "all", "options", "head"] as const;
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

/** What each operation does, in the words an integrator needs. Keyed by "METHOD /path". */
const SUMMARIES: Record<string, string> = {
  "GET /healthz": "Liveness: the process is serving",
  "GET /readyz": "Readiness: the database answers",
  "GET /metrics": "Prometheus metrics",
  "GET /v1/dev/tenants": "Fund managers to sign in to (local identity provider; DEV_TOKENS=on only)",
  "POST /v1/dev/token": "Issue a development token (DEV_TOKENS=on only)",
  "GET /v1/funds": "Funds of the caller's fund manager, with committed capital",
  "POST /v1/funds": "Create a main, feeder or parallel fund",
  "GET /v1/funds/{fundId}": "One fund",
  "POST /v1/funds/{fundId}/commitments": "Add an investor's commitment (KYC must be verified)",
  "GET /v1/funds/{fundId}/capital-accounts": "Capital account per investor from the ledger, with approved side-letter terms",
  "GET /v1/funds/{fundId}/ledger/verify": "Check that every journal balances and balances equal postings",
  "GET /v1/investors": "Investors, optionally filtered by name",
  "POST /v1/investors": "Register an investor",
  "POST /v1/funds/{fundId}/side-letters": "Upload a side letter; its terms are proposed asynchronously",
  "GET /v1/funds/{fundId}/side-letters": "Side letters of a fund",
  "GET /v1/side-letters/{id}": "A side letter with its proposed and decided terms",
  "GET /v1/funds/{fundId}/provisions": "Side-letter terms, by review status",
  "POST /v1/provisions/{id}/decision": "Approve or reject a proposed term (not by the person who uploaded the letter)",
  "GET /v1/funds/{fundId}/compendium": "MFN compendium: every approved term an investor may elect",
  "GET /v1/funds/{fundId}/mfn/{investorId}": "Terms this investor is eligible to elect under MFN",
  "POST /v1/funds/{fundId}/mfn/{investorId}/election": "Elect eligible MFN terms",
  "GET /v1/funds/{fundId}/events": "Capital events of a fund, newest first",
  "POST /v1/funds/{fundId}/calls": "Draft a capital call",
  "POST /v1/funds/{fundId}/distributions": "Draft a distribution through the waterfall",
  "POST /v1/funds/{fundId}/closings": "Draft a subsequent closing with equalisation",
  "GET /v1/events/{id}": "An event with its result hash and approvals",
  "GET /v1/events/{id}/lines": "Investor lines of a calculated event",
  "POST /v1/events/{id}/calculate": "Calculate (or recalculate) an event; approvals of an earlier result stop counting",
  "POST /v1/events/{id}/approve": "Approve the calculated result with this hash (a second person)",
  "POST /v1/events/{id}/issue": "Issue notices, post to the ledger and assign payment references",
  "POST /v1/events/{id}/cancel": "Cancel an event that has not been issued",
  "GET /v1/events/{id}/feeder-plan": "For each feeder in a call: amount owed, latest issue date, bridge need",
  "POST /v1/events/{id}/feeder-calls": "Draft the feeder's own call for its share of a main-fund call",
  "GET /v1/events/{id}/payment-file": "The pain.001.001.09 credit transfer file of an issued distribution",
  "POST /v1/funds/{fundId}/bank/camt054": "Import a camt.054.001.08 statement; credits are matched by end-to-end reference",
  "GET /v1/funds/{fundId}/bank/entries": "Bank credits, by match status",
  "POST /v1/funds/{fundId}/bank/entries/{entryId}/resolve": "Place an unmatched credit on an investor's line, with a reason",
  "GET /v1/audit": "The newest audit records",
  "GET /v1/audit/verify": "Re-verify the hash chain from the first record",
  "GET /v1/me/notices": "An investor's own notices (investor tokens only)",
};

const problem = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
});

type Handler = (...args: unknown[]) => unknown;

/** The body as the client sends it (before zod's transforms), without a per-schema $schema key. */
const jsonSchema = (schema: z.ZodType) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  return rest;
};

export const buildOpenApi = () => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const ctrl of CONTROLLERS) {
    const prefix = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? "").replace(/^\/|\/$/g, "");
    const args = (name: string) => (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as Record<string, { data?: string }>;
    for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
      const handler = (ctrl.prototype as unknown as Record<string, Handler>)[name];
      if (name === "constructor" || typeof handler !== "function") continue;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
      if (sub === undefined || verb === undefined) continue;
      const route = `/${[prefix, sub.replace(/^\//, "")].filter(Boolean).join("/")}`.replace(/:(\w+)/g, "{$1}");
      const method = VERBS[verb] ?? "get";
      const roles = Reflect.getMetadata("roles", handler) as string[] | undefined;
      const open = Reflect.getMetadata("public", handler) === true || !route.startsWith("/v1");
      const parameters: unknown[] = [];
      for (const [key, a] of Object.entries(args(name))) {
        const type = Number(key.split(":")[0]);
        if (type === PARAM && a.data) parameters.push({ name: a.data, in: "path", required: true, schema: { type: "string" } });
        if (type === QUERY && a.data) parameters.push({ name: a.data, in: "query", required: false, schema: { type: "string" } });
      }
      const takesBody = Object.keys(args(name)).some((k) => Number(k.split(":")[0]) === BODY);
      const schema = Reflect.getMetadata(BODY_SCHEMA, handler) as z.ZodType | undefined;
      const xml = Reflect.getMetadata(BODY_XML, handler) === true;
      const op: Record<string, unknown> = {
        operationId: `${ctrl.name.replace(/Controller$/, "").toLowerCase()}.${name}`,
        summary: SUMMARIES[`${method.toUpperCase()} ${route}`] ?? name,
        tags: [ctrl.name.replace(/Controller$/, "")],
        ...(parameters.length ? { parameters } : {}),
        ...(open ? { security: [] } : {}),
        ...(roles ? { "x-roles": roles } : {}),
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
          ...(open ? {} : { "401": problem("No valid token"), "403": problem("The token's roles do not allow this") }),
          ...(takesBody ? { "400": problem("The body does not match the schema") } : {}),
          ...(method === "post" && !open ? { "409": problem("The record changed or the action is not allowed in its state") } : {}),
          ...(route.includes("calculate")
            ? { "422": problem("The calculation cannot be done with these inputs (engine error code)") }
            : {}),
        },
      };
      if (takesBody && (schema || xml)) {
        op.requestBody = {
          required: true,
          content: xml
            ? { "application/xml": { schema: { type: "string", description: "ISO 20022 camt.054.001.08 document" } } }
            : { "application/json": { schema: jsonSchema(schema as z.ZodType) } },
        };
      }
      if (method === "post" && route.startsWith("/v1")) {
        op.parameters = [
          ...((op.parameters as unknown[]) ?? []),
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string", maxLength: 200 },
            description: "Replays return the first response",
          },
        ];
      }
      paths[route] = { ...(paths[route] ?? {}), [method]: op };
    }
  }
  const sorted = Object.fromEntries(Object.entries(paths).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    openapi: "3.1.0",
    info: {
      title: "Capital events API",
      version: "1.0.0",
      description:
        "Capital calls, subsequent closings with equalisation, distributions through a European waterfall, feeder pass-through, side letters and MFN, " +
        "with a double-entry ledger, ISO 20022 payments and a hash-chained audit trail. Money is integer cents in strings. " +
        "Every result is approved by a second person against its hash before notices go out.",
    },
    servers: [{ url: "/" }],
    security: [{ bearer: [] }],
    paths: sorted,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        Problem: {
          type: "object",
          description: "RFC 9457 problem details",
          required: ["type", "title", "status", "code"],
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            status: { type: "integer" },
            code: { type: "string" },
            ids: { type: "array", items: { type: "string" }, description: "Investors affected by an engine error" },
          },
        },
      },
    },
  };
};
