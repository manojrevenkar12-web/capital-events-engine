"""Section 6: most-favoured-nation election eligibility."""

from fractions import Fraction

from . import validate as v
from .errors import invalid

CARVE_OUTS = frozenset(
    {"REGULATORY_LP_SPECIFIC", "TAX_LP_SPECIFIC", "LPAC_SEAT", "FIRST_CLOSE_INCENTIVE", "CO_INVEST"}
)
BPS_TYPES = ("FEE_DISCOUNT", "CARRY_DISCOUNT")


def canon(x):
    """Canonical, hashable form for 'equal params': same keys and values, lists as sets
    (recursively). Booleans are not numbers; 1 and 1.0 are the same number."""
    if isinstance(x, bool):
        return ("bool", x)
    if isinstance(x, (int, float)):
        return ("num", Fraction(x))
    if isinstance(x, str):
        return ("str", x)
    if x is None:
        return ("null",)
    if isinstance(x, list):
        return ("set", frozenset(canon(e) for e in x))
    if isinstance(x, dict):
        return ("obj", frozenset((k, canon(e)) for k, e in x.items()))
    raise invalid("params: unsupported value")


def parse_provision(raw) -> dict:
    o = v.obj(raw, "provision")
    p = {
        "id": v.string(v.req(o, "id", "provision"), "provision.id"),
        "lp": v.string(v.req(o, "lp", "provision"), "provision.lp"),
        "type": v.string(v.req(o, "type", "provision"), "provision.type"),
        "params": v.obj(v.req(o, "params", "provision"), "provision.params"),
        "category": v.string(v.req(o, "category", "provision"), "provision.category"),
    }
    t, params = p["type"], p["params"]
    if t in BPS_TYPES:
        p["bps"] = v.integer(v.req(params, "bps", t), f"{t}.bps")
    elif t == "NOTICE_PERIOD":
        p["days"] = v.integer(v.req(params, "days", t), "NOTICE_PERIOD.days")
    elif t == "EXCUSE_RIGHT":
        p["sectors"] = v.strings(v.req(params, "sectors", t), "EXCUSE_RIGHT.sectors")
    p["canon"] = canon(params)
    return p


def already_held(p: dict, own: list) -> bool:
    """Rule 5: the electing LP already holds an equal or better provision of p's type."""
    same = [q for q in own if q["type"] == p["type"]]
    t = p["type"]
    if t in BPS_TYPES:
        return any(q["bps"] >= p["bps"] for q in same)
    if t == "NOTICE_PERIOD":
        return any(q["days"] >= p["days"] for q in same)
    if t == "EXCUSE_RIGHT":
        held = set()
        for q in same:
            held.update(q["sectors"])
        return set(p["sectors"]) <= held
    return any(q["canon"] == p["canon"] for q in same)


def eligible(lps: dict, provisions: list, e: str) -> list:
    own = [q for q in provisions if q["lp"] == e]
    ok = []
    for p in provisions:
        if p["lp"] == e:
            continue
        if not lps[p["lp"]] <= lps[e]:
            continue
        if p["category"] in CARVE_OUTS:
            continue
        if p["type"] == "MFN":
            continue
        if already_held(p, own):
            continue
        ok.append(p)
    best = {}
    for p in ok:
        key = (p["type"], p["canon"])
        if key not in best or p["id"] < best[key]["id"]:
            best[key] = p
    return sorted(p["id"] for p in best.values())


def run(inp) -> dict:
    inp = v.obj(inp, "input")
    lps = {}
    for raw in v.lst(v.req(inp, "lps", "input"), "lps"):
        o = v.obj(raw, "lp")
        lp_id = v.string(v.req(o, "id", "lp"), "lp.id")
        if lp_id in lps:
            raise invalid("lps: duplicate id")
        lps[lp_id] = v.integer(v.req(o, "commitment", "lp"), "lp.commitment")
    provisions = [parse_provision(x) for x in v.lst(v.req(inp, "provisions", "input"), "provisions")]
    v.unique_ids([p["id"] for p in provisions], "provisions")
    e = v.string(v.req(inp, "electing_lp", "input"), "electing_lp")
    if e not in lps:
        raise invalid("electing_lp is not an LP")
    for p in provisions:
        if p["lp"] not in lps:
            raise invalid(f"provision {p['id']!r} held by unknown LP")
    return {"eligible": eligible(lps, provisions, e)}
