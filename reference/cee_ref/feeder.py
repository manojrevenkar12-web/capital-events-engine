"""Section 5: feeder fund pass-through."""

from . import validate as v
from .allocation import allocate
from .capital_call import investment_component, over_call_check
from .dates import subtract_business_days
from .errors import invalid


def parse_lp(raw) -> dict:
    o = v.obj(raw, "lp")
    return {
        "id": v.string(v.req(o, "id", "lp"), "lp.id"),
        "commitment": v.integer(v.req(o, "commitment", "lp"), "lp.commitment"),
        "contributed": v.integer(v.req(o, "contributed", "lp"), "lp.contributed"),
        "excuse_sectors": v.strings(v.req(o, "excuse_sectors", "lp"), "lp.excuse_sectors"),
        "notice_days": v.integer(v.req(o, "notice_days", "lp"), "lp.notice_days"),
    }


def parse_component(raw) -> dict:
    o = v.obj(raw, "master_component")
    kind = v.req(o, "kind", "master_component")
    if kind not in ("expense", "fee", "investment"):
        raise invalid(f"master_component: unknown kind {kind!r}")
    comp = {"kind": kind, "amount": v.integer(v.req(o, "amount", "master_component"), "amount")}
    if kind == "investment":
        comp["sectors"] = v.strings(v.req(o, "sectors", "master_component"), "sectors")
    return comp


def run(inp) -> dict:
    inp = v.obj(inp, "input")
    comps = [parse_component(x) for x in v.lst(v.req(inp, "master_components", "input"), "master_components")]
    feeder_expense = v.integer(v.req(inp, "feeder_expense", "input"), "feeder_expense")
    lps = [parse_lp(x) for x in v.lst(v.req(inp, "lps", "input"), "lps")]
    v.unique_ids([lp["id"] for lp in lps], "lps")
    master_issue = v.day(v.req(inp, "master_issue_date", "input"), "master_issue_date")
    master_due = v.day(v.req(inp, "master_due_date", "input"), "master_due_date")
    default_notice = v.integer(v.req(inp, "default_notice_days", "input"), "default_notice_days")
    buffer_days = v.integer(v.req(inp, "buffer_days", "input"), "buffer_days")

    ids = [lp["id"] for lp in lps]
    unfunded = {lp["id"]: lp["commitment"] - lp["contributed"] for lp in lps}
    so_far = {k: 0 for k in ids}
    per_lp = {k: [] for k in ids}
    commitments = {lp["id"]: lp["commitment"] for lp in lps}

    for comp in comps + [{"kind": "expense", "amount": feeder_expense}]:
        if comp["kind"] in ("expense", "fee"):
            amounts = allocate(comp["amount"], commitments)
        else:
            amounts = investment_component(comp["amount"], comp["sectors"], lps, unfunded, so_far)
        for k in ids:
            per_lp[k].append(amounts[k])
            so_far[k] += amounts[k]

    over_call_check(so_far, unfunded)

    notice = max([default_notice] + [lp["notice_days"] for lp in lps])
    pay_by = subtract_business_days(master_due, buffer_days)
    latest_issue = subtract_business_days(pay_by, notice)
    return {
        "lines": {k: {"components": per_lp[k], "total": so_far[k]} for k in ids},
        "latest_issue": latest_issue.isoformat(),
        "bridge_required": latest_issue < master_issue,
    }
