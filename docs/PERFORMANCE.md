# Performance at 5,000 LPs

`pnpm --filter @cee/api bench` builds a fund with 5,000 investors, then runs a full cycle: a
capital call (fee, expenses, an investment), a camt.054 statement with a credit from every
investor, a subsequent closing admitting 500 more, a distribution, and a ledger verification.
It writes `reports/benchmarks/latest-5000.json`, including the number of ledger postings.

Machine: 2 vCPUs, MySQL 8.0 on the same host. Times in milliseconds.

| Step | Per-row writes | Set-based | |
|---|---:|---:|---|
| camt.054 import and reconciliation | 40,099 | 1,268 | 32× |
| call: issue (references, receivables, notices) | 4,283 | 1,167 | 3.7× |
| closing: issue | 4,830 | 2,412 | 2.0× |
| distribution: issue | 3,393 | 1,166 | 2.9× |
| call: calculate | 872 | 610 | |
| ledger verify | 391 | 575 | |
| **Ledger postings** | **74,002** | **74,002** | identical |

## What changed

The first version applied each payment with a read, an update and a journal: about 15,000 round
trips for one statement, all inside one transaction holding locks. The set-based version parses
the file, matches references in memory, aggregates payments per line (two credits for the same
line must add, not overwrite), then writes with `UPDATE ... JOIN (VALUES ROW(...))` and chunked
multi-row inserts.

## The regression the posting count caught

The first set-based version booked one bank line per statement instead of one per credit, and a
journal paying several events carried no event. Balances still agreed, so `ledger/verify` passed.
The benchmark's posting count did not: 74,002 before, 69,003 after (5,000 credits, 4,999 fewer
lines). It now books one journal per event with a bank line per credit, and
`lifecycle.test.ts` pays two events from one statement and checks both.

## Not yet done

Admitting investors at a closing still runs per investor (2.4 s for 500), and the per-tenant audit
lock serialises writers within a tenant. Both are in the technical-debt register.
