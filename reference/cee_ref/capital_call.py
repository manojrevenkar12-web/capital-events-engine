"""Section 2: capital call (expense, fee, investment components; over-call check; due dates)."""

from fractions import Fraction

from . import validate as v
from .allocation import allocate
from .dates import add_business_days, days
from .errors import INSUFFICIENT_UNFUNDED, OVER_CALL, CalcError, invalid
from .money import round_half_even

DAY_BASIS = 10000 * 365


def fee_exact(commitment, net_invested, rate_bps, period_start, period_end, ipe) -> Fraction:
    """Exact (unrounded) fee of section 2.3 for one LP; `rate_bps` is already net of discount."""
    total = Fraction(0)
    d1 = days(period_start, min(period_end, ipe))
    if d1 > 0:
        total += Fraction(commitment * rate_bps * d1, DAY_BASIS)
    d2 = days(max(period_start, ipe), period_end)
    if d2 > 0:
        total += Fraction(net_invested * rate_bps * d2, DAY_BASIS)
    return total


def net_rate(fee_rate_bps: int, discount_bps: int) -> int:
    return max(0, fee_rate_bps - discount_bps)


def is_excused(sectors, excuse_sectors) -> bool:
    ex = set(excuse_sectors)
    return any(s in ex for s in sectors)


def water_fill(amount: int, commitments: dict, caps: dict) -> dict:
    """Section 2.4 step 3. `commitments` and `caps` cover the non-excused LPs only."""
    result = {k: 0 for k in commitments}
    active = [k for k in commitments if caps[k] > 0]
    remaining = amount
    while True:
        if remaining > 0 and not active:
            raise CalcError(INSUFFICIENT_UNFUNDED)
        a = allocate(remaining, {k: commitments[k] for k in active})
        over = [k for k in active if a[k] > caps[k]]
        if not over:
            for k in active:
                result[k] = a[k]
            return result
        over_set = set(over)
        for k in over:
            result[k] = caps[k]
        remaining -= sum(caps[k] for k in over)
        active = [k for k in active if k not in over_set]


def investment_component(amount, sectors, lps, unfunded, so_far) -> dict:
    """Section 2.4 for one investment component. `lps` is a list of dicts with id, commitment,
    excuse_sectors; `so_far[id]` is the LP's sum over earlier components of this call."""
    out = {lp["id"]: 0 for lp in lps}
    commitments = {}
    caps = {}
    for lp in lps:
        if is_excused(sectors, lp["excuse_sectors"]):
            continue
        commitments[lp["id"]] = lp["commitment"]
        caps[lp["id"]] = max(0, unfunded[lp["id"]] - so_far[lp["id"]])
    filled = water_fill(amount, commitments, caps)
    out.update(filled)
    return out


def over_call_check(totals: dict, unfunded: dict) -> None:
    over = [k for k in totals if totals[k] > unfunded[k]]
    if over:
        raise CalcError(OVER_CALL, ids=over)


# ---------------------------------------------------------------- input parsing


def parse_lp(raw) -> dict:
    o = v.obj(raw, "lp")
    lp = {
        "id": v.string(v.req(o, "id", "lp"), "lp.id"),
        "commitment": v.integer(v.req(o, "commitment", "lp"), "lp.commitment"),
        "contributed": v.integer(v.req(o, "contributed", "lp"), "lp.contributed"),
        "net_invested": v.integer(v.req(o, "net_invested", "lp"), "lp.net_invested"),
        "admitted": v.day(v.req(o, "admitted", "lp"), "lp.admitted"),
        "fee_discount_bps": v.integer(v.req(o, "fee_discount_bps", "lp"), "lp.fee_discount_bps"),
        "excuse_sectors": v.strings(v.req(o, "excuse_sectors", "lp"), "lp.excuse_sectors"),
        "notice_days": v.integer(v.req(o, "notice_days", "lp"), "lp.notice_days"),
    }
    return lp


def parse_component(raw) -> dict:
    o = v.obj(raw, "component")
    kind = v.req(o, "kind", "component")
    if kind == "expense":
        return {"kind": kind, "amount": v.integer(v.req(o, "amount", "expense"), "expense.amount")}
    if kind == "fee":
        return {
            "kind": kind,
            "period_start": v.day(v.req(o, "period_start", "fee"), "fee.period_start"),
            "period_end": v.day(v.req(o, "period_end", "fee"), "fee.period_end"),
        }
    if kind == "investment":
        return {
            "kind": kind,
            "sectors": v.strings(v.req(o, "sectors", "investment"), "investment.sectors"),
            "amount": v.integer(v.req(o, "amount", "investment"), "investment.amount"),
        }
    raise invalid(f"component: unknown kind {kind!r}")


def run(inp) -> dict:
    inp = v.obj(inp, "input")
    fund = v.obj(v.req(inp, "fund", "input"), "fund")
    fee_rate = v.integer(v.req(fund, "fee_rate_bps", "fund"), "fund.fee_rate_bps")
    ipe = v.day(v.req(fund, "investment_period_end", "fund"), "fund.investment_period_end")
    default_notice = v.integer(v.req(fund, "default_notice_days", "fund"), "fund.default_notice_days")
    issue_date = v.day(v.req(inp, "issue_date", "input"), "issue_date")
    lps = [parse_lp(x) for x in v.lst(v.req(inp, "lps", "input"), "lps")]
    v.unique_ids([lp["id"] for lp in lps], "lps")
    components = [parse_component(x) for x in v.lst(v.req(inp, "components", "input"), "components")]

    ids = [lp["id"] for lp in lps]
    unfunded = {lp["id"]: lp["commitment"] - lp["contributed"] for lp in lps}
    so_far = {k: 0 for k in ids}
    per_lp = {k: [] for k in ids}

    for comp in components:
        if comp["kind"] == "expense":
            amounts = allocate(comp["amount"], {lp["id"]: lp["commitment"] for lp in lps})
        elif comp["kind"] == "fee":
            amounts = {}
            for lp in lps:
                if lp["admitted"] <= comp["period_start"]:
                    rate = net_rate(fee_rate, lp["fee_discount_bps"])
                    amounts[lp["id"]] = round_half_even(
                        fee_exact(
                            lp["commitment"], lp["net_invested"], rate,
                            comp["period_start"], comp["period_end"], ipe,
                        )
                    )
                else:
                    amounts[lp["id"]] = 0
        else:
            amounts = investment_component(comp["amount"], comp["sectors"], lps, unfunded, so_far)
        for k in ids:
            per_lp[k].append(amounts[k])
            so_far[k] += amounts[k]

    over_call_check(so_far, unfunded)

    lines = {}
    for lp in lps:
        k = lp["id"]
        due = add_business_days(issue_date, max(default_notice, lp["notice_days"]))
        lines[k] = {"components": per_lp[k], "total": so_far[k], "due_date": due.isoformat()}
    return {"lines": lines}
