# Architecture

## The path of a capital call

1. **Draft.** A preparer posts the call: deals, fees, expenses. Nothing is calculated yet.
2. **Calculate.** The API loads commitments, approved side-letter terms and earlier events, and
   hands them to the engine. The engine returns lines per investor or an error code naming the
   investors affected (`INSUFFICIENT_UNFUNDED`, `OVER_CALL`, ...). Lines are stored with a
   SHA-256 of the canonical result.
3. **Approve.** An approver who did not prepare the event approves *that hash*. If anything
   changes and the event is recalculated, the hash changes and the approval stops counting.
4. **Issue.** Under a `FOR UPDATE` lock on the fund row, the API recalculates the event and
   refuses if the result's hash is not the approved one (`STALE_CALCULATION`), then assigns end-to-end payment
   references, posts the receivables to the ledger, and enqueues notices in the outbox, all in
   one transaction.
5. **Reconcile.** A camt.054 statement is matched by end-to-end reference. Payments are applied
   set-based; anything that cannot be matched waits for a person, who places it with a reason
   that goes to the audit trail.

Distributions and subsequent closings follow the same path. A distribution's issue writes a
pain.001 credit transfer file; a closing admits the new investors and books equalisation.

## Where the guarantees live

| Guarantee | Enforced by | Tested by |
|---|---|---|
| Exact money | Engine works in rationals; rounding only at the edge, half-even; allocation by largest remainder | engine properties; 30,000-scenario differential |
| Tenant isolation | Kysely plugin rejects any query on a tenant table without a `tenant_id` filter, including joins | `tenancy.test.ts`; lifecycle cross-tenant reads |
| Four eyes | approve refuses the preparer; approval rows carry the result hash | lifecycle, console and Playwright tests |
| No stale results | issue recalculates under the fund lock and compares hashes | lifecycle "stale calculation" |
| Books balance | each journal must sum to zero; postings immutable by trigger | `ledger/verify`, immutability tests |
| Tamper evidence | audit records chained by SHA-256; UPDATE/DELETE refused by trigger | audit verify, immutability tests |
| Exactly-once side effects | outbox drained with `FOR UPDATE SKIP LOCKED`; Idempotency-Key replays | lifecycle idempotent issue |
| Contract | OpenAPI generated from route metadata and zod schemas | `openapi.test.ts` fails on drift |

## Deployment

```
            ALB (internal, TLS 1.3)
              │  /v1, /readyz            │  /
              ▼                          ▼
      api Deployment (3–12, HPA)    console Deployment (nginx, strict CSP)
        │  pre-upgrade hook: migrate
        │  outbox drained by every replica
        ▼
      RDS MySQL 8.4 (Multi-AZ in production, KMS, TLS required, time_zone UTC)
```

Secrets come from AWS Secrets Manager through External Secrets; pods get AWS access only through
EKS Pod Identity. Network policies allow the API to reach MySQL, DNS and HTTPS only. Images are
tagged with the git sha in an immutable, scanned ECR repository.

## Code map

```
packages/engine/src     rational.ts dates.ts allocate.ts call.ts equalisation.ts waterfall.ts feeder.ts mfn.ts scenario.ts
reference/cee_ref       the blind Python implementation of docs/SPEC.md
tools/differential      scenario generator and comparator
apps/api/src
  db/                   schema, migrations (triggers), tenancy guard, set-based helpers
  auth/                 JWT verification, roles
  funds/ events/        commands and calculations, notices
  side-letters/         upload, extraction (rules or Claude), review, MFN
  payments/             ISO 20022 in and out, reconciliation
  ledger/ audit/ outbox/
  http/                 controllers, OpenAPI generation, metrics, idempotency
  seed/ eval/           simulated manager, benchmark, held-out scoring
apps/console/src        app/ (router, shell) features/ (one folder per screen) components/ lib/ theme/
deploy/                 helm/ terraform/ kind/
```
