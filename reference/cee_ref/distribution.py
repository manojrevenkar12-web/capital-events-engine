"""Section 4: distribution with a per-LP European waterfall."""

from fractions import Fraction

from . import validate as v
from .allocation import allocate
from .dates import add_years, days
from .errors import invalid
from .money import round_half_even


def growth_factor(t, d, hurdle_bps: int) -> Fraction:
    """F(t, D) of section 4.3: annual compounding on anniversaries, simple accrual between."""
    if t > d:
        raise invalid("cash flow dated after the distribution date")
    h = Fraction(hurdle_bps, 10000)
    n = max(0, d.year - t.year)
    while n > 0 and add_years(t, n) > d:
        n -= 1
    while add_years(t, n + 1) <= d:  # defensive; never loops more than once
        n += 1
    last = add_years(t, n)
    f = days(last, d)
    return (1 + h) ** n * (1 + h * f / 365)


def parse_flows(raw, what: str, d) -> list:
    flows = []
    for x in v.lst(raw, what):
        o = v.obj(x, what)
        when = v.day(v.req(o, "date", what), f"{what}.date")
        amt = v.integer(v.req(o, "amount", what), f"{what}.amount")
        if when > d:
            raise invalid(f"{what}: dated after the distribution date")
        flows.append((when, amt))
    return flows


def parse_lp(raw, d) -> dict:
    o = v.obj(raw, "lp")
    return {
        "id": v.string(v.req(o, "id", "lp"), "lp.id"),
        "deal_contribution": v.integer(v.req(o, "deal_contribution", "lp"), "lp.deal_contribution"),
        "carry_discount_bps": v.integer(v.req(o, "carry_discount_bps", "lp"), "lp.carry_discount_bps"),
        "contributions": parse_flows(v.req(o, "contributions", "lp"), "contributions", d),
        "distributions": parse_flows(v.req(o, "distributions", "lp"), "distributions", d),
        "prior_roc": v.integer(v.req(o, "prior_roc", "lp"), "lp.prior_roc"),
        "prior_pref": v.integer(v.req(o, "prior_pref", "lp"), "lp.prior_pref"),
        "prior_catch_up": v.integer(v.req(o, "prior_catch_up", "lp"), "lp.prior_catch_up"),
    }


def tiers(gross: int, lp: dict, d, hurdle_bps: int, carry_bps: int) -> dict:
    contributed = sum(a for _, a in lp["contributions"])
    h_val = sum((a * growth_factor(t, d, hurdle_bps) for t, a in lp["contributions"]), Fraction(0))
    h_val -= sum((a * growth_factor(t, d, hurdle_bps) for t, a in lp["distributions"]), Fraction(0))
    unreturned = contributed - lp["prior_roc"]
    pref_owed = round_half_even(max(Fraction(0), h_val - unreturned))

    roc = min(gross, max(0, unreturned))
    pref = min(gross - roc, pref_owed)

    c = max(0, carry_bps - lp["carry_discount_bps"])
    if c == 0:
        catch_up = 0
    else:
        if c >= 10000:
            raise invalid("effective carry of 10000 bps or more: catch-up target undefined")
        target = Fraction((lp["prior_pref"] + pref) * c, 10000 - c)
        catch_up = min(gross - roc - pref, round_half_even(max(Fraction(0), target - lp["prior_catch_up"])))

    rest = gross - roc - pref - catch_up
    gp_split = round_half_even(Fraction(rest * c, 10000))
    lp_split = rest - gp_split
    return {
        "gross": gross,
        "roc": roc,
        "pref": pref,
        "catch_up": catch_up,
        "gp_split": gp_split,
        "lp_split": lp_split,
        "lp_total": roc + pref + lp_split,
        "gp_total": catch_up + gp_split,
    }


def run(inp) -> dict:
    inp = v.obj(inp, "input")
    d = v.day(v.req(inp, "date", "input"), "date")
    amount = v.integer(v.req(inp, "amount", "input"), "amount")
    hurdle = v.integer(v.req(inp, "hurdle_bps", "input"), "hurdle_bps")
    carry = v.integer(v.req(inp, "carry_bps", "input"), "carry_bps")
    lps = [parse_lp(x, d) for x in v.lst(v.req(inp, "lps", "input"), "lps")]
    v.unique_ids([lp["id"] for lp in lps], "lps")
    gross = allocate(amount, {lp["id"]: lp["deal_contribution"] for lp in lps})
    return {"lines": {lp["id"]: tiers(gross[lp["id"]], lp, d, hurdle, carry) for lp in lps}}
