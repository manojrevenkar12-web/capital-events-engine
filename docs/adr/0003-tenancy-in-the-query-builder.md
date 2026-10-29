# 3. Tenancy enforced where queries are built

**Status:** accepted

**Context.** Fund administrators hold competitors' data side by side. A missing `WHERE tenant_id`
in one query is a breach. Row-level security does not exist in MySQL.

**Decision.** A Kysely plugin inspects every query's syntax tree and refuses it unless each tenant
table it touches, including joined ones, is constrained by `tenant_id`. Migrations, the outbox and
health checks use a separate, explicitly named connection (`SYSTEM_DB`) without the guard.

**Consequences.** A forgotten filter fails in development, not in production. The guard is a
programming-error check, so a violation returns a generic 500 and never details to the caller.
