# Reference implementation: ambiguities and the readings chosen

This Python reference (`reference/cee_ref/`) was written from `docs/SPEC.md` alone. No other
file in the repository was read. Wherever the spec could be read more than one way, the code
follows the most literal reading, and the choice is listed below by spec section. Items marked
**(behavioural)** are the ones most likely to show up as differences when the two
implementations are compared.

## General (sections 1, 7)

1. **Validation happens before any calculation (section 7).** The whole input is checked first.
   Any malformed value gives `INVALID_INPUT` before any calculation error can happen. After
   that, errors come in processing order: components in input order (`NO_WEIGHT`,
   `INSUFFICIENT_UNFUNDED`), then `OVER_CALL`. In equalisation, `UNSUPPORTED_FEE_PERIOD` is
   checked before any allocation, so it beats `NO_WEIGHT`. The spec never gives an order for
   errors.
2. **Negative integers (section 7).** The spec only names "negative money or weights". The
   reference rejects *every* negative integer input as `INVALID_INPUT`, including rates in bps,
   discounts, `notice_days`, `default_notice_days`, `buffer_days` and `rate_bps`. The one
   exception is `n` in the `business_days` op, which section 7 allows to be negative.
3. **What counts as an integer.** JSON booleans are not integers. A float with a fractional
   part is `INVALID_INPUT`. An integral float such as `5.0` or `1e3`, with magnitude under 2^53,
   is accepted as that integer, because JavaScript cannot tell it from `5`. Python ints have
   arbitrary precision; values above 2^53 may not survive a JavaScript `JSON.parse` on the
   TypeScript side unless it parses into BigInt.
4. **Required fields.** Every field that the spec lists and the calculation uses is required,
   with no defaults. For example, `notice_days` ("0 if none", section 2.1) must be present as
   `0`, and `admitted` is required even when the call has no fee component. Unknown extra keys
   are ignored. The one listed field that is *not* required is the investment `deal`
   (section 2.1), because nothing reads it.
5. **Ids.** LP ids and provision ids must be strings, because section 1.6 sorts them by code
   point. Duplicate LP ids, or duplicate provision ids, give `INVALID_INPUT`. Sectors must be
   strings.
6. **Dates** must match `YYYY-MM-DD` exactly and be real calendar dates. A business-day step
   that runs past year 9999 gives `INVALID_INPUT`.
7. **Output (section 7).** Output is compact JSON with non-ASCII characters not escaped (as
   JavaScript's `JSON.stringify` does). `lines` and `allocate` results keep the input order of
   the keys. Section 7 does not define key order, so the harness should compare parsed JSON.
   `ids` appears only for `OVER_CALL`.
8. **Batch mode.** Blank lines in the input are skipped, and every other line gives exactly one
   output line. A line that is not valid JSON, an unknown `op`, or `NaN`/`Infinity` constants
   give `INVALID_INPUT`. An unexpected exception inside the reference prints
   `{"ok": false, "error": "INTERNAL_ERROR", "message": ...}`. That is not a spec error code, and
   it is used on purpose so that a defect here can never match by accident.

## 1.2 Rounding

9. No ambiguity. The reference rounds exact rationals half to even, negative values included.
   Every `round(...)` call in the spec happens to take a non-negative argument.

## 1.4 Business days

10. `subtract_business_days` is read as "step backwards one calendar day at a time and return
    the date on which the nth business day strictly before `d` is reached". With `n = 0` it
    returns `d` even when `d` is not a business day.
11. In the `business_days` op, a negative `n` means `subtract_business_days(d, −n)`.
12. The holiday list is exactly the spec's list. There are no substitute days: a holiday that
    falls on a weekend does not move. Whit Monday and Maundy Thursday are business days.

## 1.5 Allocation

13. **Error code for a negative amount or weight.** Section 1.5 states the precondition but
    names no error code. Section 7's `INVALID_INPUT` is used.
14. **Key comparison is by Unicode code point**, as the spec says. Warning for the TypeScript
    side: JavaScript's default `<` comparison and `Array.prototype.sort` compare UTF-16 code
    units, which differ from code points for characters outside the BMP (for example emoji, or
    some CJK characters). Python `str` comparison is by code point.
15. "Keys with weight 0 always get 0" follows from the tie-break; it does not need special
    handling. The remainders sum to `R`, each is < 1, so at least `R` keys have a positive
    remainder, and they sort before every key whose remainder is 0.
16. With rational weights (the equalisation interest split), the "weight descending"
    tie-break compares the exact rationals.

## 2 Capital call

17. **Component discriminator key (sections 2.1, 7).** Section 2.1 says components are "each
    one of" expense, fee or investment, but never names the key that says which. Sections 3.1
    and 5.1 call it `kind`, so `kind` is used here too, with the values `expense`, `fee` and
    `investment`. Any other value gives `INVALID_INPUT`.
18. **Negative unfunded (sections 2.1, 2.5) (behavioural).** `contributed > commitment` is not
    treated as invalid (the money is not negative). Then `unfunded < 0`, the cap is 0, and the
    over-call check `total_i > unfunded_i` is true **even when the LP was called for 0**. So
    such an LP always produces `OVER_CALL`. This is literal, and arguably not what was meant.
    Tested in `test_negative_unfunded_is_over_call_even_with_zero_total`.
19. **Fees and expenses use up unfunded commitment (sections 2.4 step 2, 2.5).** "its amounts
    from earlier components of this call" includes expense and fee components, so a fee lowers
    the cap of a later investment. Expenses and fees are never capped themselves, so either can
    cause `OVER_CALL` on their own (for example, an expense on a fully funded LP).
20. **Fee period with `period_end < period_start` (section 2.3).** This is not rejected. Both
    sub-periods then have zero or negative days and "contribute nothing", so the fee is 0.
21. **Fee admission test (section 2.3).** This is `admitted ≤ period_start`, compared as dates.
    An LP admitted during the period pays 0 for the whole component, not a pro-rated fee.
22. The post-investment-period basis is `net_invested` as given, even when it is larger than
    `commitment`. ACT/365 is applied literally, so a 366-day fee period charges 366/365 of the
    annual rate.
23. **Excuse with empty `sectors`.** An investment with `sectors: []` excuses nobody.
24. **Due dates (section 2.5)** are computed for every LP, including LPs whose total is 0.
25. **Water-filling.** Step 1 is checked on every pass, including the first. So an investment
    with `amount > 0` where no non-excused LP has a positive cap fails `INSUFFICIENT_UNFUNDED`,
    however much unfunded commitment the excused LPs have. An investment of 0 with an empty
    `active` set succeeds with zeros.

## 3 Equalisation

26. **`paid` ids that are not LPs after the closing (sections 3.1, 3.2).** The spec only covers
    *missing* ids ("paid 0"). An id in `paid` that does not appear in `lps` gives
    `INVALID_INPUT`. Silently dropping it would break the rule that "deltas sum to zero",
    because `T_k` would include money that no target covers.
27. **"Ends after `investment_period_end`" (section 3.1)** is read as
    `period_end > investment_period_end`. The fee period is half-open
    (`[period_start, period_end)`) and `investment_period_end` is the first day *after* the
    investment period, so `period_end == investment_period_end` lies wholly inside the period
    and is supported. Only fee components are checked.
28. **Fee targets (section 3.2)** are the absolute section 2.3 fee, not a share of `T_k`. They
    use the fund's current `fee_rate_bps`, each LP's commitment after the closing and its
    current discount, for every LP, existing LPs included. An existing LP whose commitment went
    up therefore owes a fee catch-up. An LP that paid more than its target gets nothing back.
    Because of item 27, the `net_invested` sub-period always has zero or negative days, so
    `net_invested` is never needed (and the LP input does not carry it).
29. **An investment component where every LP is excused, or where every non-excused LP has
    commitment 0, with `T_k > 0` (section 3.2)** gives `NO_WEIGHT`, the literal result of
    `allocate` with `W = 0`. The spec does not say what happens to that money.
30. **Interest days (section 3.3).** `max(0, days(due_date_k, close_date))`, so a component due
    on or after the close date earns no interest.
31. **Paying and receiving interest are not netted.** An LP can pay interest on one component,
    where its delta is positive, and receive interest from another, where its delta is
    negative. `interest_paid` and `interest_received` are reported separately, and both are in
    `net`.
32. **"If no LP has `e_j > 0`, `I` must be 0" (section 3.3)** is always true. No entitlement
    means every `Σ_i exact_ik = 0`, so every `exact_ik = 0`, so every `interest_paid_i = 0`. It is
    implemented as an internal assertion, not as an error code.
33. A fee component's `due_date` is required, even though nothing reads it.

## 4 Distribution

34. **Negative cash-flow amounts (section 4.1).** `contributions` are described as "net of
    refunds", which could suggest negative refund entries. Following "negative money is
    `INVALID_INPUT`", any negative `amount` in `contributions` or `distributions` gives
    `INVALID_INPUT`.
35. **Dated after D (section 4.3)** applies to both `contributions` and `distributions`. A flow
    dated exactly `D` is allowed, with `F = 1`. The check is done while reading input, so it
    beats `NO_WEIGHT`.
36. **`add_years` is always applied to the original `t`**, never chained. For `t` = 29 Feb, the
    anniversaries are 28 Feb in non-leap years and 29 Feb in leap years. As a result `f` can
    reach 365. For example, `t = 2024-02-29` and `D = 2028-02-28` give `n = 3` (the 2028
    anniversary is 02-29, after `D`) and `f = 365`. So can any non-29-Feb `t` whose next
    anniversary is one day after `D` across a 29 Feb, for example `2023-03-01 → 2024-02-29`.
    Numerically, `(1+h)^n (1 + h·365/365) = (1+h)^(n+1)`, so this is harmless. It is noted
    because an implementation that counts years differently could compound one more time.
37. **Effective carry `c ≥ 10000` (section 4.4).** The catch-up target divides by
    `10000 − c`. That is undefined at 10000, and above 10000 it gives a negative target and a
    `gp_split` larger than `rest`, so `lp_split < 0`. The reference returns `INVALID_INPUT` when
    `c = max(0, carry_bps − carry_discount_bps) ≥ 10000`. If the discount brings `c` below
    10000, `carry_bps > 10000` is accepted.
38. **Consistency of the `prior_*` fields with `distributions` is not checked.** The formula is
    applied as written, even to inconsistent input. For example, `prior_roc = 1000` with an
    empty `distributions` list gives `H − (contributed − prior_roc)` = the whole contributed
    amount as `pref_owed`.
39. **What `H` measures (section 4.4).** `H` subtracts *all* earlier distributions the LP kept
    (`roc`, `pref` and `lp_split`) at their grown value. So an earlier `lp_split` also reduces
    the preferred return owed later. This is literal and was not "corrected".
40. **`roc` covers all of `contributed`** (calls of every kind, across all deals), not only
    `deal_contribution`. This is a whole-fund European waterfall applied to this deal's
    proceeds. `deal_contribution` is used only for the gross split.
41. **Rounding points:** `pref_owed` (once), the catch-up (`round(max(0, target − prior_catch_up))`,
    with `target` exact), and `gp_split`. Nothing else.

## 5 Feeder

42. **Feeder `fee` components (section 5.2)** are split by commitment over *all* feeder LPs.
    Admission and discount do not apply; feeder LPs have no `admitted` or `fee_discount_bps`.
43. **`feeder_expense` is always the last entry of `components` (section 5.3 output)**, even
    when it is 0 ("may be 0" and "processed after the master components" are read as "always
    processed"). Every line therefore has `len(master_components) + 1` entries.
44. **Notice with no feeder LPs (section 5.3).** "max over feeder LPs of `notice_days`" over an
    empty set is taken as `default_notice_days`. Notice is the maximum over *all* feeder LPs,
    including those called for 0.
45. **`bridge_required`** is `latest_issue < master_issue_date`, strictly. Issuing on the latest
    possible day needs no bridge.
46. An expense or fee with a positive amount and no feeder LPs, or with every commitment 0,
    gives `NO_WEIGHT`. Timing is only computed when the amounts succeed: a failed pass-through
    returns only the error.
47. Feeder lines have no per-LP `due_date`, unlike section 2.5. The output follows section 7
    exactly.

## 6 MFN

48. **LP references (section 6.1).** `electing_lp`, and the `lp` of every provision, must be an
    id in `lps`. Otherwise `commitment(·)` in rule 2 is undefined, and the reference returns
    `INVALID_INPUT`. This is checked for all provisions, not only the ones being compared.
49. **What "e holds" means (rule 5)** is every provision with `lp == e`, whatever its category,
    including carve-out categories. For example, an electing LP's own `FIRST_CLOSE_INCENTIVE`
    fee discount still counts as held, and blocks a smaller `FEE_DISCOUNT`.
50. **`EXCUSE_RIGHT` with empty `sectors` (rule 5) (behavioural).** Read literally, the union
    over `e`'s `EXCUSE_RIGHT` provisions (empty when `e` holds none) "contains all of"
    `p.sectors = []`. Such a provision is therefore always treated as already held, and is
    never eligible, even if `e` holds no `EXCUSE_RIGHT` at all. The alternative reading ("hold"
    requires at least one `EXCUSE_RIGHT`) would list it.
51. **Known types compare only their named parameter in rule 5.** `FEE_DISCOUNT` and
    `CARRY_DISCOUNT` compare `bps`, `NOTICE_PERIOD` compares `days`, and `EXCUSE_RIGHT` compares
    `sectors`. Other keys in their `params` are ignored for rule 5. `REPORTING` is not listed
    with a special rule, so it uses the "any other type" rule (full `params` equality).
52. **The dedupe step applies to every type and uses full `params` equality**, through the
    "as in rule 5, last bullet" reference. So `FEE_DISCOUNT {bps: 50}` and
    `FEE_DISCOUNT {bps: 50, note: "x"}` are *not* duplicates, and two eligible
    `FEE_DISCOUNT`s with different `bps` (say 50 and 75) are *both* listed. Dedupe removes exact
    duplicates only, not dominated provisions. It runs only among *eligible* provisions, so an
    ineligible duplicate with a smaller id does not suppress an eligible one. The smallest id is
    by code point.
53. **Definition of params equality.** Same key set, with values equal recursively. Lists are
    compared as sets at every nesting depth, so duplicates and order are ignored
    (`["x","y"]` equals `["y","x","x"]`). Key order is irrelevant. Booleans are not numbers
    (`true ≠ 1`). Numbers compare by value (`1` equals `1.0`). `null` is an ordinary value, so
    `{v: 1, w: null}` does not equal `{v: 1}`. Strings are compared exactly and are case
    sensitive.
54. **Parameter validation.** `FEE_DISCOUNT` and `CARRY_DISCOUNT` need an integer `bps` ≥ 0,
    `NOTICE_PERIOD` needs an integer `days` ≥ 0, and `EXCUSE_RIGHT` needs `sectors` as a list of
    strings. Anything else gives `INVALID_INPUT`, checked on every provision. `params` must be
    an object. `REPORTING`'s `report` and the parameters of other types are not validated.
55. **Unknown categories are accepted (section 6.1).** They are not carve-outs, so a provision
    with one can be eligible. Category and type names are matched exactly and are case
    sensitive.
56. The size tier uses `≤`, so an LP with an equal commitment is eligible.
