"""Section 3: equalisation."""

import random
from datetime import date, timedelta

from conftest import err, ok

from cee_ref.equalisation import compute

FUND = {"fee_rate_bps": 200, "investment_period_end": "2026-01-01"}


def lp(id, commitment, excuse_sectors=(), fee_discount_bps=0):
    return {"id": id, "commitment": commitment, "excuse_sectors": list(excuse_sectors),
            "fee_discount_bps": fee_discount_bps}


def eq(lps, prior, close_date="2025-01-01", rate_bps=800, fund=FUND):
    return {"close_date": close_date, "rate_bps": rate_bps, "fund": fund, "lps": lps, "prior": prior}


def test_two_lp_worked_example():
    lps = [lp("A", 600), lp("B", 400)]
    prior = [
        {"kind": "expense", "due_date": "2024-01-01", "paid": {"A": 1000}},
        {"kind": "investment", "due_date": "2024-07-01", "sectors": ["tech"], "paid": {"A": 6000}},
    ]
    out = ok("equalisation", eq(lps, prior))["lines"]
    # expense target 600/400 -> B +400; investment target 3600/2400 -> B +2400
    # exact interest B: (400*800*366 + 2400*800*184) / 3_650_000 = 470_400_000/3_650_000 = 128.88 -> 129
    assert out["B"] == {"capital_delta": 2800, "fee_catch_up": 0, "interest_paid": 129,
                        "interest_received": 0, "net": 2929}
    assert out["A"] == {"capital_delta": -2800, "fee_catch_up": 0, "interest_paid": 0,
                        "interest_received": 129, "net": -2929}


def test_interest_split_between_refunded_lps_tie():
    lps = [lp("A", 500), lp("B", 300), lp("C", 200)]
    prior = [{"kind": "expense", "due_date": "2024-01-01", "paid": {"A": 625, "B": 375}}]
    out = ok("equalisation", eq(lps, prior, rate_bps=1000))["lines"]
    # C pays 200*1000*366/3_650_000 = 20.05 -> 20; split 125:75 -> 12.5 / 7.5 -> tie, A (weight) wins
    assert out["C"]["capital_delta"] == 200
    assert out["C"]["interest_paid"] == 20
    assert out["A"]["interest_received"] == 13
    assert out["B"]["interest_received"] == 7
    assert out["A"]["capital_delta"] == -125 and out["B"]["capital_delta"] == -75


def test_investment_excuse_and_no_interest_for_late_due_date():
    lps = [lp("A", 500), lp("B", 500, excuse_sectors=["oil"]), lp("C", 1000)]
    prior = [{"kind": "investment", "due_date": "2025-03-01", "sectors": ["oil"],
              "paid": {"A": 1000}}]
    out = ok("equalisation", eq(lps, prior))["lines"]
    # B excused: targets A 1000*500/1500 = 333.3 -> 333, C 666.7 -> 667
    assert out["A"]["capital_delta"] == 333 - 1000
    assert out["B"]["capital_delta"] == 0
    assert out["C"]["capital_delta"] == 667
    # due date after close date: max(0, days) = 0, no interest
    assert all(out[k]["interest_paid"] == 0 and out[k]["interest_received"] == 0 for k in "ABC")


def test_fee_catch_up_never_refunds():
    lps = [lp("A", 3_650_000), lp("C", 1_825_000, fee_discount_bps=100)]
    prior = [{"kind": "fee", "due_date": "2024-01-01", "period_start": "2024-01-01",
              "period_end": "2025-01-01", "paid": {"A": 80_000}}]
    fund = {"fee_rate_bps": 200, "investment_period_end": "2025-01-01"}  # period ends exactly at ipe
    out = ok("equalisation", eq(lps, prior, fund=fund))["lines"]
    # A target 3_650_000*200*366/3_650_000 = 73_200 < paid: no refund
    # C target 1_825_000*100*366/3_650_000 = 18_300; no interest on fees
    assert out["A"] == {"capital_delta": 0, "fee_catch_up": 0, "interest_paid": 0,
                        "interest_received": 0, "net": 0}
    assert out["C"] == {"capital_delta": 0, "fee_catch_up": 18_300, "interest_paid": 0,
                        "interest_received": 0, "net": 18_300}


def test_unsupported_fee_period():
    lps = [lp("A", 100)]
    prior = [{"kind": "fee", "due_date": "2024-01-01", "period_start": "2025-07-01",
              "period_end": "2026-01-02", "paid": {"A": 1}}]
    assert err("equalisation", eq(lps, prior))["error"] == "UNSUPPORTED_FEE_PERIOD"


def test_errors():
    lps = [lp("A", 100, excuse_sectors=["x"])]
    prior = [{"kind": "investment", "due_date": "2024-01-01", "sectors": ["x"], "paid": {"A": 5}}]
    assert err("equalisation", eq(lps, prior))["error"] == "NO_WEIGHT"
    prior = [{"kind": "expense", "due_date": "2024-01-01", "paid": {"Z": 5}}]
    assert err("equalisation", eq(lps, prior))["error"] == "INVALID_INPUT"
    prior = [{"kind": "expense", "due_date": "2024-01-01", "paid": {"A": -5}}]
    assert err("equalisation", eq(lps, prior))["error"] == "INVALID_INPUT"


def test_conservation_random():
    rnd = random.Random(2026)
    start = date(2022, 1, 1)
    sectors = ["a", "b", "c"]
    for _ in range(300):
        n = rnd.randint(1, 6)
        lps = [{"id": f"L{i}", "commitment": rnd.randint(1, 10**7),
                "excuse_sectors": rnd.sample(sectors, rnd.randint(0, 1)),
                "fee_discount_bps": rnd.choice([0, 25, 50])} for i in range(n)]
        ids = [x["id"] for x in lps]
        prior = []
        for _ in range(rnd.randint(1, 5)):
            kind = rnd.choice(["expense", "investment", "fee"])
            due = start + timedelta(days=rnd.randint(0, 900))
            paid = {k: rnd.randint(0, 10**6) for k in rnd.sample(ids, rnd.randint(1, n))}
            comp = {"kind": kind, "due_date": due, "paid": paid}
            if kind == "investment":
                comp["sectors"] = rnd.sample(sectors, rnd.randint(1, 2))
                if all(set(comp["sectors"]) & set(x["excuse_sectors"]) for x in lps):
                    comp["sectors"] = []
            if kind == "fee":
                comp["period_start"] = due
                comp["period_end"] = due + timedelta(days=rnd.randint(1, 200))
            prior.append(comp)
        result = compute(date(2025, 6, 1), rnd.choice([0, 500, 800]), 200, date(2026, 1, 1), lps, prior)
        for comp in result["components"]:
            if comp["kind"] == "fee":
                assert all(x >= 0 for x in comp["fee_delta"].values())
            else:
                assert sum(comp["delta"].values()) == 0
        lines = result["lines"]
        assert sum(x["interest_paid"] for x in lines.values()) == sum(
            x["interest_received"] for x in lines.values())
        assert sum(x["capital_delta"] for x in lines.values()) == 0
        for x in lines.values():
            assert x["net"] == x["capital_delta"] + x["fee_catch_up"] + x["interest_paid"] - x["interest_received"]
