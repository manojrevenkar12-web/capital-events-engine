# Working in this repository

## Fast feedback

```sh
pnpm install && pnpm --filter @cee/engine build
pnpm --filter @cee/engine test                 # seconds
pnpm --filter @cee/console test                # seconds
CEE_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:3306/cee pnpm --filter @cee/api test   # needs MySQL 8
(cd reference && python -m pytest -q)
pnpm diff                                      # 6,000-scenario differential
pnpm exec biome ci . && pnpm -r typecheck
```

End to end: seed the API (`pnpm --filter @cee/api seed`), start it and `vite preview`, then
`pnpm --filter @cee/console e2e`.

## Invariants (each has a test)

- Money is integer cents or exact rationals. No floats in `packages/engine` or in money paths.
- Every query on a tenant table is filtered by `tenant_id`; the Kysely guard refuses it otherwise.
  Only migrations, the outbox and health checks use `SYSTEM_DB`.
- An approval is for a result hash. Never let issue proceed on a hash that was not approved, and
  never let the preparer approve.
- Postings and audit records are append-only (database triggers). Corrections are new entries.
- A performance change must leave the benchmark's posting count unchanged.
- Extracted side-letter terms are proposals; calculations read approved provisions only.
- There is no default JWT secret. Production verifies the identity provider's keys (`JWKS_URL`).
- Settings come from the environment through `src/config/config.ts`, validated at start-up.
- `docs/openapi.json` is generated (`pnpm --filter @cee/api openapi`); the build fails on drift.

## Specification and reference

`docs/SPEC.md` is the contract. Never edit `reference/` to make the differential pass: a
disagreement is a bug or a spec question. Spec changes go in `SPEC.md` and `reference/NOTES.md`.

## Held-out sets

`heldout/<set>` is scored once; its first run in `reports/heldout/<set>/first_run.json` is never
rewritten (CI fails if it changes). Never change extraction to pass a held-out set. If you study a
set's failures, write `regression` to `heldout/<set>/STATUS` and have someone who has not seen the
code write a new set from `heldout/WRITING_SIDE_LETTERS.md` only.
