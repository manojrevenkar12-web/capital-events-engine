# Engineering practices

How this code base is meant to be worked on by a team, written the way I would hand it to one.

## Definition of done

A change is done when:

1. It has a test that fails without it. Each defect below has a test that was run against the
   old code and failed.
2. Anything that moves money or changes who can do what has been read by a second engineer.
   The same four-eyes rule the product enforces for capital events applies to the code that
   computes them.
3. CI is green: types, lint, unit and API tests, the 30,000-scenario differential, end-to-end,
   Helm and Terraform validation, and the kind deployment.
4. If it changes the API, `docs/openapi.json` is regenerated (the build fails otherwise).
5. If it changes a decision, there is an ADR. If it adds a shortcut, the debt register below says
   so, with what it costs and what would trigger paying it back.

## Defects found while building

| Found by | Defect | Fix |
|---|---|---|
| The console showing times an hour apart | mysql2 wrote UTC while the MySQL session ran in CET, so `DEFAULT CURRENT_TIMESTAMP` columns were an hour off | every pooled session pinned to UTC; RDS parameter group in UTC; CI runs MySQL in CET |
| The benchmark's posting count (74,002 → 69,003) | the batched camt.054 import booked one bank line per statement and lost the event on multi-event journals | one journal per event, one bank line per credit |
| The kind deployment | MySQL 8.4 logs binary changes by default, so a non-SUPER user cannot create the append-only triggers; the migration failed half-way | `log_bin_trust_function_creators` on RDS and in kind; `/readyz` fails while any append-only trigger is missing |

## Quality gates that matter most here

- **The differential.** A change to the engine that the reference does not agree with is either
  a bug or a spec change. Spec changes go through `docs/SPEC.md` and a note in
  `reference/NOTES.md`, never by editing the reference to match.
- **Posting counts in the benchmark.** A performance change must not change what is booked.
- **Held-out sets.** Extraction is scored on letters written blind, once. Studying a set's
  failures turns it into a regression set and requires a new blind set.

## Delivery metrics

`scripts/dora.py` measures from git and GitHub Actions. There are no production deploys yet, so
a green run on main stands in for a deploy; the numbers describe how fast a change gets to a
releasable state, not production. Latest output: `reports/engineering/dora.json`.

On this repository so far (7 commits, 2 completed CI runs on main, so a sample too small to mean
much): median lead time from commit to green 11.9 minutes; one of two runs failed (the console
preview bound to IPv6 on the runner) and main was green again 8.7 minutes later.

What I would watch in a team, and why:

| Metric | Why it matters for fund operations |
|---|---|
| Lead time for changes | Fund managers ask for terms that change calculations; the speed at which a spec change can ship safely is the product's responsiveness. |
| Change failure rate | Measured on main, and separately for releases that touch `packages/engine` or `payments/`, because those failures reach investors' money. |
| Time to restore | For a wrong notice, "restore" means the corrected notice, the reversal in the ledger and the audit trail, not a rollback. Runbooks are written for that. |
| Escaped calculation defects | Defects found after issue. The differential and the hash-bound approvals exist to keep this at zero; each one gets a post-incident review and a new generator case. |

## Technical debt

| Item | Cost today | Trigger to pay it back |
|---|---|---|
| Admitting investors at a closing runs per investor | 2.4 s for 500 admissions at 5,000 LPs | A closing above ~2,000 admissions, or lock waits in production |
| Audit append locks the tenant row, serialising writers in a tenant | Fine at one operator team per tenant | Concurrent bulk jobs within one tenant |
| Claude side-letter extractor is built but unscored | Unknown recall; rules extractor finds 55% | Before enabling `EXTRACTOR=claude` for any customer: score it on a new blind set |
| Notices are HTML stored in the database | No PDF, no e-signature | First customer that sends notices by post or needs signed PDFs |
| One currency per fund, no FX | Funds with multi-currency share classes cannot be modelled | First multi-currency fund |
| Waterfall is European only | No deal-by-deal carry or clawback | First American-waterfall fund |
| Dev identity provider in the API (`DEV_TOKENS`) | Off by default; refuses to start without a secret | Replace with a test IdP container once the team has one |
| Python reference has no owner outside this repository | It drifts if nobody reviews spec changes against it | When the engine gets a second maintainer |

## Onboarding a new engineer

Week one is about the domain, because the code is only hard where the domain is.

1. **Day 1.** Run it locally, sign in as all three people, take one capital call from draft to
   reconciled payment. Read `docs/SPEC.md` sections 1 and 2 with the engine's `call.ts` beside it.
2. **Day 2.** Read the ADRs. Pair on a small change in the console; ship it.
3. **Day 3.** Equalisation and the waterfall: work one closing by hand in a spreadsheet, then find
   the same numbers in the engine's tests.
4. **Day 4.** Break something on purpose: change a rounding rule and watch the differential fail;
   remove a tenant filter and watch the guard refuse the query.
5. **Day 5.** First real ticket, reviewed by the engineer who owns that area.

By the end of month one: owns one area (side letters, payments or the console), has written an
ADR or a runbook, and has reviewed a change to the engine.
