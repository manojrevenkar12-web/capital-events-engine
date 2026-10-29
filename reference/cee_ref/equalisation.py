"""Section 3: subsequent closing equalisation."""

from fractions import Fraction

from . import validate as v
from .allocation import allocate
from .capital_call import fee_exact, is_excused, net_rate
from .dates import days
from .errors import UNSUPPORTED_FEE_PERIOD, CalcError, invalid
from .money import round_half_even

DAY_BASIS = 10000 * 365


def parse_lp(raw) -> dict:
    o = v.obj(raw, "lp")
    return {
        "id": v.string(v.req(o, "id", "lp"), "lp.id"),
        "commitment": v.integer(v.req(o, "commitment", "lp"), "lp.commitment"),
        "excuse_sectors": v.strings(v.req(o, "excuse_sectors", "lp"), "lp.excuse_sectors"),
        "fee_discount_bps": v.integer(v.req(o, "fee_discount_bps", "lp"), "lp.fee_discount_bps"),
    }


def parse_prior(raw, lp_ids: set) -> dict:
    o = v.obj(raw, "prior")
    kind = v.req(o, "kind", "prior")
    if kind not in ("expense", "fee", "investment"):
        raise invalid(f"prior: unknown kind {kind!r}")
    paid_raw = v.obj(v.req(o, "paid", "prior"), "prior.paid")
    paid = {}
    for k, amt in paid_raw.items():
        if k not in lp_ids:
            raise invalid(f"prior.paid: unknown LP {k!r}")
        paid[k] = v.integer(amt, "prior.paid")
    comp = {"kind": kind, "due_date": v.day(v.req(o, "due_date", "prior"), "prior.due_date"), "paid": paid}
    if kind == "investment":
        comp["sectors"] = v.strings(v.req(o, "sectors", "prior"), "prior.sectors")
    if kind == "fee":
        comp["period_start"] = v.day(v.req(o, "period_start", "prior"), "prior.period_start")
        comp["period_end"] = v.day(v.req(o, "period_end", "prior"), "prior.period_end")
    return comp


def compute(close_date, rate_bps, fee_rate_bps, ipe, lps, prior) -> dict:
    """Returns the full breakdown: per-component deltas and exact interest, plus per-LP lines."""
    ids = [lp["id"] for lp in lps]

    for comp in prior:
        if comp["kind"] == "fee" and comp["period_end"] > ipe:
            raise CalcError(UNSUPPORTED_FEE_PERIOD)

    capital_delta = {k: 0 for k in ids}
    fee_catch_up = {k: 0 for k in ids}
    exact_paid = {k: Fraction(0) for k in ids}
    entitlement = {k: Fraction(0) for k in ids}
    breakdown = []

    for comp in prior:
        paid = {k: comp["paid"].get(k, 0) for k in ids}
        total = sum(paid.values())
        if comp["kind"] == "fee":
            target = {}
            for lp in lps:
                rate = net_rate(fee_rate_bps, lp["fee_discount_bps"])
                # net_invested basis never applies: the period ends on or before ipe.
                target[lp["id"]] = round_half_even(
                    fee_exact(lp["commitment"], 0, rate, comp["period_start"], comp["period_end"], ipe)
                )
            deltas = {k: max(0, target[k] - paid[k]) for k in ids}
            for k in ids:
                fee_catch_up[k] += deltas[k]
            breakdown.append({"kind": "fee", "target": target, "fee_delta": deltas})
            continue

        if comp["kind"] == "expense":
            target = allocate(total, {lp["id"]: lp["commitment"] for lp in lps})
        else:
            weights = {
                lp["id"]: lp["commitment"]
                for lp in lps
                if not is_excused(comp["sectors"], lp["excuse_sectors"])
            }
            target = {k: 0 for k in ids}
            target.update(allocate(total, weights))
        delta = {k: target[k] - paid[k] for k in ids}
        n_days = max(0, days(comp["due_date"], close_date))
        exact = {
            k: (Fraction(delta[k] * rate_bps * n_days, DAY_BASIS) if delta[k] > 0 else Fraction(0))
            for k in ids
        }
        pool = sum(exact.values(), Fraction(0))
        refunded = sum(-delta[k] for k in ids if delta[k] < 0)
        share = {k: Fraction(0) for k in ids}
        if pool > 0:
            # pool > 0 implies a positive delta, and deltas sum to zero, so refunded > 0.
            for k in ids:
                if delta[k] < 0:
                    share[k] = pool * (-delta[k]) / refunded
        for k in ids:
            capital_delta[k] += delta[k]
            exact_paid[k] += exact[k]
            entitlement[k] += share[k]
        breakdown.append(
            {"kind": comp["kind"], "target": target, "delta": delta, "exact_interest": exact,
             "entitlement": share}
        )

    interest_paid = {k: round_half_even(exact_paid[k]) for k in ids}
    collected = sum(interest_paid.values())
    weights = {k: entitlement[k] for k in ids if entitlement[k] > 0}
    if weights:
        received_part = allocate(collected, weights)
    else:
        if collected != 0:  # cannot happen: no entitlement means no exact interest at all
            raise AssertionError("interest collected with no LP entitled to it")
        received_part = {}
    interest_received = {k: received_part.get(k, 0) for k in ids}

    lines = {}
    for k in ids:
        lines[k] = {
            "capital_delta": capital_delta[k],
            "fee_catch_up": fee_catch_up[k],
            "interest_paid": interest_paid[k],
            "interest_received": interest_received[k],
            "net": capital_delta[k] + fee_catch_up[k] + interest_paid[k] - interest_received[k],
        }
    return {"lines": lines, "components": breakdown}


def run(inp) -> dict:
    inp = v.obj(inp, "input")
    close_date = v.day(v.req(inp, "close_date", "input"), "close_date")
    rate_bps = v.integer(v.req(inp, "rate_bps", "input"), "rate_bps")
    fund = v.obj(v.req(inp, "fund", "input"), "fund")
    fee_rate = v.integer(v.req(fund, "fee_rate_bps", "fund"), "fund.fee_rate_bps")
    ipe = v.day(v.req(fund, "investment_period_end", "fund"), "fund.investment_period_end")
    lps = [parse_lp(x) for x in v.lst(v.req(inp, "lps", "input"), "lps")]
    v.unique_ids([lp["id"] for lp in lps], "lps")
    lp_ids = {lp["id"] for lp in lps}
    prior = [parse_prior(x, lp_ids) for x in v.lst(v.req(inp, "prior", "input"), "prior")]
    return {"lines": compute(close_date, rate_bps, fee_rate, ipe, lps, prior)["lines"]}
