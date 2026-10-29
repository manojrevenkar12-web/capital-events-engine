"""Section 4: distribution waterfall."""

from datetime import date
from fractions import Fraction as F

from conftest import err, ok

from cee_ref.distribution import growth_factor


def lp(id, deal_contribution, contributions, distributions=(), prior_roc=0, prior_pref=0,
       prior_catch_up=0, carry_discount_bps=0):
    return {"id": id, "deal_contribution": deal_contribution, "carry_discount_bps": carry_discount_bps,
            "contributions": [{"date": d, "amount": a} for d, a in contributions],
            "distributions": [{"date": d, "amount": a} for d, a in distributions],
            "prior_roc": prior_roc, "prior_pref": prior_pref, "prior_catch_up": prior_catch_up}


def dist(lps, amount, date="2026-01-01", hurdle_bps=800, carry_bps=2000):
    return {"date": date, "amount": amount, "hurdle_bps": hurdle_bps, "carry_bps": carry_bps, "lps": lps}


def test_growth_factor():
    assert growth_factor(date(2024, 1, 1), date(2026, 1, 1), 800) == F(108, 100) ** 2
    assert growth_factor(date(2024, 1, 1), date(2024, 7, 1), 800) == 1 + F(8, 100) * 182 / 365
    assert growth_factor(date(2024, 1, 1), date(2025, 7, 1), 800) == F(108, 100) * (1 + F(8, 100) * 181 / 365)
    assert growth_factor(date(2024, 2, 29), date(2025, 2, 28), 1000) == F(11, 10)
    assert growth_factor(date(2024, 2, 29), date(2025, 2, 27), 1000) == 1 + F(1, 10) * 364 / 365
    # anniversary 3 is 2027-02-28; 2028-02-29 is after D, so f = 365 days of simple accrual
    assert growth_factor(date(2024, 2, 29), date(2028, 2, 28), 1000) == F(11, 10) ** 3 * (1 + F(1, 10) * 365 / 365)
    assert growth_factor(date(2024, 2, 29), date(2028, 2, 29), 1000) == F(11, 10) ** 4
    assert growth_factor(date(2026, 1, 1), date(2026, 1, 1), 800) == 1


def test_worked_example_compounded_two_years():
    out = ok("distribution", dist([lp("X", 1000, [("2024-01-01", 1000)])], 2000))["lines"]["X"]
    # H = 1000*1.08^2 = 1166.4; pref_owed = round(166.4) = 166
    # roc 1000; pref 166; target 166*2000/8000 = 41.5 -> 42 (half even); rest 792
    # gp_split round(158.4) = 158; lp_split 634
    assert out == {"gross": 2000, "roc": 1000, "pref": 166, "catch_up": 42, "gp_split": 158,
                   "lp_split": 634, "lp_total": 1800, "gp_total": 200}


def test_worked_example_simple_accrual():
    out = ok("distribution", dist([lp("X", 1, [("2024-01-01", 1000)])], 1100, date="2024-07-01"))
    # F = 1 + 0.08*182/365 -> H = 1039.89; pref_owed 40; target 40*2000/8000 = 10
    assert out["lines"]["X"] == {"gross": 1100, "roc": 1000, "pref": 40, "catch_up": 10, "gp_split": 10,
                                 "lp_split": 40, "lp_total": 1080, "gp_total": 20}


def test_worked_example_with_prior_distribution_and_discount():
    x = lp("X", 1, [("2024-01-01", 1000)], [("2025-01-01", 600)], prior_roc=600, carry_discount_bps=500)
    out = ok("distribution", dist([x], 1000, hurdle_bps=1000))["lines"]["X"]
    # H = 1210 - 660 = 550; unreturned 400; pref_owed 150
    # c = 1500; target 150*1500/8500 = 26.47 -> 26; rest 424; gp round(63.6) = 64
    assert out == {"gross": 1000, "roc": 400, "pref": 150, "catch_up": 26, "gp_split": 64,
                   "lp_split": 360, "lp_total": 910, "gp_total": 90}


def test_catch_up_counts_prior_tiers_and_zero_carry():
    # earlier distribution on D returned 1000 of capital and paid 80 of pref, no catch-up yet
    x = lp("X", 1, [("2024-01-01", 1000)], [("2025-01-01", 1080)], prior_roc=1000, prior_pref=80)
    out = ok("distribution", dist([x], 100, date="2025-01-01"))["lines"]["X"]
    # H = 1080 - 1080 = 0; pref_owed 0; target 80*2000/8000 = 20
    assert out == {"gross": 100, "roc": 0, "pref": 0, "catch_up": 20, "gp_split": 16,
                   "lp_split": 64, "lp_total": 64, "gp_total": 36}
    x["prior_catch_up"] = 20
    out = ok("distribution", dist([x], 100, date="2025-01-01"))["lines"]["X"]
    assert out["catch_up"] == 0 and out["gp_split"] == 20 and out["lp_split"] == 80
    y = lp("Y", 1, [("2024-01-01", 1000)], carry_discount_bps=2500)
    out = ok("distribution", dist([y], 2000))["lines"]["Y"]
    assert out["catch_up"] == 0 and out["gp_split"] == 0 and out["gp_total"] == 0
    assert out["lp_total"] == 2000


def test_gross_split_and_sum():
    lps = [lp("X", 1, [("2024-01-01", 0)]), lp("Y", 3, [("2024-01-01", 0)])]
    out = ok("distribution", dist(lps, 10))["lines"]
    assert out["X"]["gross"] == 2 and out["Y"]["gross"] == 8  # 2.5/7.5 tie -> weight
    for line in out.values():
        assert line["lp_total"] + line["gp_total"] == line["gross"]


def test_errors():
    late = lp("X", 1, [("2026-01-02", 1000)])
    assert err("distribution", dist([late], 10))["error"] == "INVALID_INPUT"
    late = lp("X", 1, [("2024-01-01", 1000)], [("2026-01-02", 5)])
    assert err("distribution", dist([late], 10))["error"] == "INVALID_INPUT"
    neg = lp("X", 1, [("2024-01-01", -1000)])
    assert err("distribution", dist([neg], 10))["error"] == "INVALID_INPUT"
    zero = lp("X", 0, [("2024-01-01", 1000)])
    assert err("distribution", dist([zero], 10))["error"] == "NO_WEIGHT"
    assert ok("distribution", dist([zero], 0))["lines"]["X"]["gross"] == 0
