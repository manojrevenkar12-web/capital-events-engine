# Calculation specification

This document defines every number the engine produces for capital calls, closings,
distributions, feeder funds and most-favoured-nation (MFN) elections. It is the contract between
the engine (`src/`, TypeScript) and an independent reference implementation (`reference/`,
Python) that was written from this document alone. The two are compared on thousands of
generated scenarios; any difference is a defect in one of them, or an ambiguity here.

Where real limited partnership agreements (LPAs) differ from fund to fund, this document picks
one common convention and says so. Fund terms that vary are inputs.

## 1. Conventions

### 1.1 Money

- All money is an integer number of **cents** of the fund currency. There are no fractional cents
  anywhere in inputs or outputs.
- Intermediate values are **exact rationals** (fractions of arbitrary-precision integers). Floating
  point is never used.
- Rates are integers in **basis points** (1 bp = 1/10000).

### 1.2 Rounding

`round(x)` rounds an exact rational `x` to the nearest integer, **half to even** (banker's
rounding). Examples: 2.5 → 2, 3.5 → 4, −2.5 → −2, 2.4999… → 2.

Each section says exactly where rounding happens. Nothing is rounded anywhere else.

### 1.3 Dates and day counts

- Dates are calendar dates `YYYY-MM-DD` with no time zone.
- `days(a, b)` is the number of calendar days from `a` to `b` (`b − a`); it is negative if `b` is
  before `a`.
- Year fractions use **ACT/365**: `days / 365`, including in leap years.

### 1.4 Business days (TARGET2 calendar)

A date is a **business day** unless it is a Saturday, a Sunday, 1 January, Good Friday, Easter
Monday, 1 May, 25 December or 26 December. Easter Sunday is computed with the anonymous Gregorian
algorithm (Meeus/Jones/Butcher):

```
a = Y mod 19;  b = Y div 100;  c = Y mod 100;  d = b div 4;  e = b mod 4
f = (b + 8) div 25;  g = (b − f + 1) div 3;  h = (19a + b − d − g + 15) mod 30
i = c div 4;  k = c mod 4;  l = (32 + 2e + 2i − h − k) mod 7
m = (a + 11h + 22l) div 451
month = (h + l − 7m + 114) div 31;  day = ((h + l − 7m + 114) mod 31) + 1
```

Good Friday is Easter Sunday − 2 days; Easter Monday is Easter Sunday + 1 day.

- `add_business_days(d, n)` for `n ≥ 0`: if `n = 0` the result is `d` itself (business day or
  not). Otherwise, step forward one calendar day at a time from `d` and return the date on which
  the `n`th business day strictly after `d` is reached.
- `subtract_business_days(d, n)` for `n ≥ 0`: the mirror image, stepping backwards; `n = 0`
  returns `d`.

### 1.5 Pro-rata allocation

`allocate(amount, weights)` splits a non-negative integer `amount` among keys in proportion to
non-negative weights. Weights are exact rationals (integers in most uses).

1. Let `W` be the sum of weights. If `W = 0` and `amount > 0`, it is an error
   (`NO_WEIGHT`). If `amount = 0`, every key gets 0.
2. Each key's exact share is `q_k = amount × w_k / W`. Its base allocation is `floor(q_k)`, and its
   remainder `r_k = q_k − floor(q_k)`.
3. Let `R = amount − Σ floor(q_k)`. Give one extra cent to each of the `R` keys that come first
   when keys are sorted by: remainder `r_k` descending, then weight `w_k` descending, then key
   ascending (keys are strings, compared by Unicode code point).

Keys with weight 0 always get 0. The result sums to `amount` exactly, and each key's result
differs from its exact share by less than one cent.

### 1.6 Ordering

Wherever a result lists ids (errors, eligible provisions), the ids are sorted ascending by Unicode
code point.

## 2. Capital call

A capital call asks the fund's limited partners (LPs) for money. It has one or more
**components**, processed in the order given.

### 2.1 Inputs

- Fund terms: `fee_rate_bps` (annual management fee), `investment_period_end` (the first day
  **after** the investment period), `default_notice_days` (business days).
- `issue_date`: the day notices go out.
- For each LP: `id`, `commitment`, `contributed` (net contributed so far: all earlier calls minus
  refunds), `net_invested` (investment contributions minus capital returned, the fee basis after
  the investment period), `admitted` (date the LP was admitted), `fee_discount_bps`,
  `excuse_sectors` (sectors the LP may not be called for), `notice_days` (the LP's own notice
  period, 0 if none).
- Components, each an object whose `kind` is one of:
  - `expense`: `amount` (fund expenses).
  - `fee`: `period_start`, `period_end` (the fee period `[period_start, period_end)`).
  - `investment`: `deal`, `sectors` (list), `amount`.

`unfunded_i = commitment_i − contributed_i`. It can be negative if an LP was over-called in the
past; such an LP fails the over-call check of 2.5 even when called for 0, which is deliberate: the
position has to be corrected before the fund calls anyone else.

### 2.2 Expense component

`allocate(amount, commitment)` over all LPs.

### 2.3 Fee component

Only LPs with `admitted ≤ period_start` pay; others get 0 for this component (late LPs catch up
at their closing, section 3).

For a paying LP, split the period at `investment_period_end`:

- days in `[period_start, min(period_end, investment_period_end))` use basis `commitment_i`;
- days in `[max(period_start, investment_period_end), period_end)` use basis `net_invested_i`.

(A sub-period with zero or negative days contributes nothing.) With
`rate_i = max(0, fee_rate_bps − fee_discount_bps_i)`:

```
fee_i = round( Σ over sub-periods  basis × rate_i × days / (10000 × 365) )
```

The sum is exact; rounding happens once per LP.

### 2.4 Investment component: excuse and water-filling

1. An LP is **excused** if any of the deal's `sectors` is in its `excuse_sectors`. Excused LPs get 0.
2. Each non-excused LP has a **cap**: `max(0, unfunded_i − (its amounts from earlier components of
   this call))`.
3. Water-fill. Let `active` be the non-excused LPs with cap > 0, `fixed` empty, and
   `remaining = amount`.
   1. If `remaining > 0` and `active` is empty, the call fails with `INSUFFICIENT_UNFUNDED`.
   2. `a = allocate(remaining, commitment over active)`.
   3. Let `over` be the active LPs with `a_i > cap_i`. If `over` is empty, every active LP gets
      `a_i` and the component is done.
   4. Otherwise every LP in `over` gets exactly `cap_i` and leaves `active`;
      `remaining = remaining − Σ cap_i (over)`. Go back to step 1.

### 2.5 Over-call check and result

After all components, `total_i` is the sum of LP `i`'s component amounts. If any
`total_i > unfunded_i`, the call fails with `OVER_CALL` and the ids of those LPs.

Each LP's due date is `add_business_days(issue_date, max(default_notice_days, notice_days_i))`.

Output per LP: the amount for each component (in input order), the total, the due date.

## 3. Subsequent closing: equalisation

At a later closing, new LPs join (or existing LPs increase their commitment). They must end up as
if they had been in the fund from the start: they pay their share of everything called so far,
with interest, and the LPs who paid more than their new share get the excess back with that
interest.

### 3.1 Inputs

- `close_date`, `rate_bps` (equalisation interest, simple, per year).
- Fund terms: `fee_rate_bps`, `investment_period_end`.
- For each LP after the closing: `id`, `commitment` (after the closing), `excuse_sectors`,
  `fee_discount_bps`.
- Prior components: every component of every earlier call, each with `kind` (`expense`, `fee`,
  `investment`), `due_date`, `paid` (cents per LP id; missing ids paid 0), and for an investment
  its `sectors`, for a fee its `period_start` and `period_end`.

If any prior fee period ends after `investment_period_end`, equalisation fails with
`UNSUPPORTED_FEE_PERIOD` (fees on net invested capital are not equalised by this engine).

### 3.2 Targets and deltas

For each prior component `k` with total `T_k = Σ paid`:

- `expense`: `target = allocate(T_k, commitment)` over all LPs.
- `investment`: `target = allocate(T_k, commitment over non-excused LPs)`, where excuse is judged
  on the component's `sectors` and each LP's current `excuse_sectors`; excused LPs' target is 0.
  There is no water-filling here.
- `fee`: `target_i` is the fee of section 2.3 for the period, computed with the LP's commitment
  after the closing and its discount, **as if every LP had been admitted before the period**.

Capital deltas (expense and investment): `delta_ik = target_ik − paid_ik`. They sum to zero for
each component. Positive means the LP pays, negative means it is refunded.

Fee catch-up: `fee_delta_ik = max(0, target_ik − paid_ik)`. Fees are never refunded; they go to
the manager, not to other LPs.

### 3.3 Interest

Interest is charged on positive **capital** deltas only (not on fee catch-up):

```
exact_ik = delta_ik × rate_bps × max(0, days(due_date_k, close_date)) / (10000 × 365)   for delta_ik > 0
interest_paid_i = round( Σ_k exact_ik )
```

Interest is paid to the refunded LPs. For each LP `j` with a negative delta on component `k`, its
exact entitlement from `k` is

```
(Σ_i exact_ik) × |delta_jk| / (Σ over LPs j' with delta_j'k < 0 of |delta_j'k|)
```

and its total entitlement `e_j` is the sum over components. The integer total collected,
`I = Σ_i interest_paid_i`, is split with `allocate(I, e)` over the LPs with `e_j > 0`
(rational weights). If no LP has `e_j > 0`, `I` must be 0.

### 3.4 Result

Per LP: `capital_delta = Σ_k delta_ik`, `fee_catch_up = Σ_k fee_delta_ik`, `interest_paid`,
`interest_received`, and

```
net = capital_delta + fee_catch_up + interest_paid − interest_received
```

A positive `net` is called from the LP; a negative `net` is paid back to it.

## 4. Distribution: European waterfall

Proceeds from a deal are split among the LPs who funded it, and then each LP's share goes through
the LP's own waterfall with the general partner (GP).

### 4.1 Inputs

- `date` (distribution date), `amount` (proceeds), `hurdle_bps` (preferred return, per year),
  `carry_bps` (the GP's carried interest).
- For each LP: `id`, `deal_contribution` (net cents the LP put into this deal),
  `carry_discount_bps`, `contributions` (dated amounts of everything the LP has contributed: calls
  of every kind, net of refunds, each `{date, amount}`), `distributions` (dated amounts the LP has
  received from earlier distributions, every tier the LP kept, each `{date, amount}`),
  `prior_roc`, `prior_pref`, `prior_catch_up` (the totals of those tiers from earlier
  distributions to this LP).

`contributed = Σ contributions.amount`.

### 4.2 Gross share

`gross = allocate(amount, deal_contribution)` over all LPs. If every `deal_contribution` is 0 and
`amount > 0`, it fails with `NO_WEIGHT`.

### 4.3 Growth factor

Preferred return compounds annually on each anniversary and accrues simply in between. With
`h = hurdle_bps / 10000`, for a cash flow on date `t` and the distribution date `D ≥ t`:

- `add_years(t, n)` is the same month and day `n` years later, except that 29 February becomes
  28 February in a year that is not a leap year.
- `n` is the largest integer `≥ 0` with `add_years(t, n) ≤ D`; `last = add_years(t, n)`;
  `f = days(last, D)`.
- `F(t, D) = (1 + h)^n × (1 + h × f / 365)` (exact).

Cash flows dated after `D` are an input error.

### 4.4 Tiers

```
H         = Σ contributions c × F(c.date, D) − Σ distributions d × F(d.date, D)       (exact)
pref_owed = round( max(0, H − (contributed − prior_roc)) )

roc  = min(gross, max(0, contributed − prior_roc))
pref = min(gross − roc, pref_owed)

c    = max(0, carry_bps − carry_discount_bps)
if c = 0:  catch_up = 0
else:      target   = (prior_pref + pref) × c / (10000 − c)                            (exact)
           catch_up = min(gross − roc − pref, round( max(0, target − prior_catch_up) ))

rest     = gross − roc − pref − catch_up
gp_split = round(rest × c / 10000)
lp_split = rest − gp_split
```

Output per LP: `gross`, `roc`, `pref`, `catch_up`, `gp_split`, `lp_split`,
`lp_total = roc + pref + lp_split`, `gp_total = catch_up + gp_split`. `lp_total + gp_total = gross`.

## 5. Feeder fund pass-through

A feeder fund is an LP in a master fund. When the master calls the feeder, the feeder calls its
own LPs for the same money, and it must collect before the master's due date.

### 5.1 Inputs

- `master_components`: the feeder's line of the master call, in order, each with `kind`
  (`expense`, `fee`, `investment`), `amount`, and for an investment `sectors`.
- `feeder_expense`: an extra feeder-level expense (may be 0), processed after the master components.
- Feeder LPs: `id`, `commitment`, `contributed`, `excuse_sectors`, `notice_days`.
- `master_issue_date`, `master_due_date`, `default_notice_days`, `buffer_days` (business days the
  feeder needs between collecting and paying the master).

### 5.2 Amounts

Process the master components in order, then `feeder_expense` as an expense:

- `expense` and `fee`: `allocate(amount, commitment)` over all feeder LPs.
- `investment`: exactly as section 2.4 (excuse by the feeder LP's own `excuse_sectors`, caps from
  `unfunded` minus earlier components of this pass-through, water-filling).

Then the over-call check of section 2.5 applies (`OVER_CALL`).

### 5.3 Timing

```
notice      = max(default_notice_days, max over feeder LPs of notice_days)
pay_by      = subtract_business_days(master_due_date, buffer_days)
latest_issue = subtract_business_days(pay_by, notice)
bridge_required = latest_issue < master_issue_date
```

Output: per-LP amounts per component (master components first, then the feeder expense) and
totals; `latest_issue`; `bridge_required` (the feeder cannot collect in time and needs a bridge
facility or the manager's cash).

## 6. Most-favoured-nation elections

An LP with an MFN right may elect terms that other LPs negotiated in their side letters, subject
to a size tier and carve-outs.

### 6.1 Inputs

- LPs: `id`, `commitment`.
- Provisions: every approved side-letter provision in the fund, each with `id`, `lp` (who holds
  it), `type`, `params`, `category`.
- `electing_lp`.

Types and parameters: `FEE_DISCOUNT {bps}`, `CARRY_DISCOUNT {bps}`, `NOTICE_PERIOD {days}`,
`EXCUSE_RIGHT {sectors}`, `REPORTING {report}`, `MFN {}`, and any other type with arbitrary
parameters.

Categories: `ECONOMIC`, `REPORTING`, `GOVERNANCE`, `REGULATORY_LP_SPECIFIC`, `TAX_LP_SPECIFIC`,
`LPAC_SEAT`, `FIRST_CLOSE_INCENTIVE`, `CO_INVEST`.

### 6.2 Eligibility

A provision `p` is eligible for the electing LP `e` when all hold:

1. `p.lp ≠ e`.
2. Size tier: `commitment(p.lp) ≤ commitment(e)`.
3. `p.category` is not a carve-out: not one of `REGULATORY_LP_SPECIFIC`, `TAX_LP_SPECIFIC`,
   `LPAC_SEAT`, `FIRST_CLOSE_INCENTIVE`, `CO_INVEST`.
4. `p.type` is not `MFN`.
5. `e` does not already hold an equal or better provision of the same type:
   - `FEE_DISCOUNT`, `CARRY_DISCOUNT`: `e` holds one with `bps ≥ p.bps`;
   - `NOTICE_PERIOD`: `e` holds one with `days ≥ p.days`;
   - `EXCUSE_RIGHT`: the union of sectors over `e`'s `EXCUSE_RIGHT` provisions contains all of
     `p.sectors`;
   - any other type: `e` holds one whose `params` are equal (same keys and values; lists compared
     as sets).

Then remove duplicates: among eligible provisions with the same `type` and equal `params` (as in
rule 5, last bullet), keep only the one with the smallest `id`.

Output: the eligible provision ids, sorted.

## 7. Scenario files

Both implementations read the same JSON scenarios and must print the same JSON results. A
scenario is `{"op": <operation>, "input": {...}}`; the result is `{"ok": true, "output": {...}}`
or `{"ok": false, "error": <code>, "ids": [...]}` (`ids` only for `OVER_CALL`, sorted).

| `op`            | `input`                                                                                                                                               | `output`                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `allocate`      | `{amount, weights: {id: int}}`                                                                                                                        | `{id: int}`                                                                           |
| `business_days` | `{date, n}` (n may be negative: subtract)                                                                                                             | `{date}`                                                                              |
| `capital_call`  | section 2.1, keys as named there; `fund: {fee_rate_bps, investment_period_end, default_notice_days}`; `issue_date`; `lps: [...]`; `components: [...]` | `{lines: {id: {components: [int], total: int, due_date}}}`                            |
| `equalisation`  | section 3.1: `close_date`, `rate_bps`, `fund: {fee_rate_bps, investment_period_end}`, `lps: [...]`, `prior: [...]`                                    | `{lines: {id: {capital_delta, fee_catch_up, interest_paid, interest_received, net}}}` |
| `distribution`  | section 4.1: `date`, `amount`, `hurdle_bps`, `carry_bps`, `lps: [...]`                                                                                | `{lines: {id: {gross, roc, pref, catch_up, gp_split, lp_split, lp_total, gp_total}}}` |
| `feeder_call`   | section 5.1: `master_components`, `feeder_expense`, `lps`, `master_issue_date`, `master_due_date`, `default_notice_days`, `buffer_days`               | `{lines: {id: {components: [int], total}}, latest_issue, bridge_required}`            |
| `mfn`           | section 6.1: `lps`, `provisions`, `electing_lp`                                                                                                       | `{eligible: [id]}`                                                                    |

Every LP in the input appears in `lines`, including those with zeros. Error codes:
`NO_WEIGHT`, `INSUFFICIENT_UNFUNDED`, `OVER_CALL`, `UNSUPPORTED_FEE_PERIOD`, `INVALID_INPUT`
(malformed input, negative money or weights, cash flows after the distribution date).
