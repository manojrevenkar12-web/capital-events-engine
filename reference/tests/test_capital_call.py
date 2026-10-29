"""Section 2: capital call."""

from conftest import err, ok

FUND = {"fee_rate_bps": 200, "investment_period_end": "2025-01-01", "default_notice_days": 10}


def lp(id, commitment, contributed=0, net_invested=0, admitted="2023-01-01", fee_discount_bps=0,
       excuse_sectors=(), notice_days=0):
    return {"id": id, "commitment": commitment, "contributed": contributed,
            "net_invested": net_invested, "admitted": admitted, "fee_discount_bps": fee_discount_bps,
            "excuse_sectors": list(excuse_sectors), "notice_days": notice_days}


def call(lps, components, fund=FUND, issue_date="2026-10-29"):
    return {"fund": fund, "issue_date": issue_date, "lps": lps, "components": components}


def test_expense_allocated_by_commitment():
    out = ok("capital_call", call([lp("A", 1000), lp("B", 2000)], [{"kind": "expense", "amount": 301}]))
    # q = 100.33.., 200.66.. -> floors 100, 200, R = 1 to B (remainder 2/3)
    assert out["lines"]["A"]["components"] == [100]
    assert out["lines"]["B"]["components"] == [201]
    assert out["lines"]["B"]["total"] == 201


def test_fee_split_at_investment_period_end():
    # period 2024-07-01..2025-07-01; ipe 2025-01-01 -> 184 days on commitment, 181 on net invested
    lps = [lp("A", 1_000_000, net_invested=500_000, fee_discount_bps=50),
           lp("B", 3_650_000, net_invested=1_825_000, fee_discount_bps=50)]
    comp = {"kind": "fee", "period_start": "2024-07-01", "period_end": "2025-07-01"}
    out = ok("capital_call", call(lps, [comp]))
    # A: (1e6*150*184 + 5e5*150*181) / 3_650_000 = 4_117_500/365 = 11280.82.. -> 11281
    assert out["lines"]["A"]["components"] == [11281]
    # B: 150*184 + 0.5*150*181 = 27600 + 13575 = 41175 exactly
    assert out["lines"]["B"]["components"] == [41175]


def test_fee_wholly_before_and_after_ipe():
    lps = [lp("A", 3_650_000, net_invested=730_000)]
    before = {"kind": "fee", "period_start": "2024-01-01", "period_end": "2024-01-11"}
    after = {"kind": "fee", "period_start": "2025-01-01", "period_end": "2025-01-11"}
    out = ok("capital_call", call(lps, [before, after]))
    # before: 3_650_000*200*10/3_650_000 = 2000; after: 730_000*200*10/3_650_000 = 400
    assert out["lines"]["A"]["components"] == [2000, 400]


def test_fee_rounding_half_even_and_discount_floor():
    # one day at 200 bps: 9_125 -> exactly 0.5 ; 27_375 -> exactly 1.5
    lps = [lp("A", 9_125), lp("B", 27_375), lp("C", 9_125, fee_discount_bps=500)]
    comp = {"kind": "fee", "period_start": "2024-03-01", "period_end": "2024-03-02"}
    out = ok("capital_call", call(lps, [comp]))
    assert out["lines"]["A"]["components"] == [0]  # 0.5 -> 0
    assert out["lines"]["B"]["components"] == [2]  # 1.5 -> 2
    assert out["lines"]["C"]["components"] == [0]  # rate max(0, 200-500) = 0


def test_fee_late_lp_pays_nothing_and_inverted_period():
    lps = [lp("A", 3_650_000, admitted="2024-01-01"), lp("B", 3_650_000, admitted="2024-01-02")]
    comps = [{"kind": "fee", "period_start": "2024-01-01", "period_end": "2024-01-11"},
             {"kind": "fee", "period_start": "2024-02-01", "period_end": "2024-01-01"}]
    out = ok("capital_call", call(lps, comps))
    assert out["lines"]["A"]["components"] == [2000, 0]
    assert out["lines"]["B"]["components"] == [0, 0]


def test_water_filling_with_caps():
    lps = [lp("A", 100, contributed=90), lp("B", 100), lp("C", 200)]
    out = ok("capital_call", call(lps, [{"kind": "investment", "deal": "d", "sectors": [], "amount": 200}]))
    # round 1: 50/50/100, A over cap 10 -> A=10, remaining 190
    # round 2: allocate(190, B:100, C:200) = 63.33/126.67 -> 63/127
    assert [out["lines"][k]["components"][0] for k in "ABC"] == [10, 63, 127]


def test_water_filling_cascade_and_earlier_components_reduce_caps():
    lps = [lp("A", 1000, contributed=990), lp("B", 1000, contributed=900), lp("C", 1000)]
    comps = [{"kind": "expense", "amount": 30},
             {"kind": "investment", "deal": "d", "sectors": [], "amount": 300}]
    out = ok("capital_call", call(lps, comps))
    # expense 10/10/10 -> caps A 0, B 90, C 990
    # active B, C: allocate(300) = 150/150 -> B over (90): B = 90, remaining 210 -> C = 210
    assert [out["lines"][k]["components"] for k in "ABC"] == [[10, 0], [10, 90], [10, 210]]
    assert [out["lines"][k]["total"] for k in "ABC"] == [10, 100, 220]


def test_excused_lp_and_insufficient_unfunded():
    lps = [lp("A", 100, excuse_sectors=["tobacco"]), lp("B", 100, contributed=60)]
    inv = {"kind": "investment", "deal": "d", "sectors": ["tobacco", "food"], "amount": 40}
    out = ok("capital_call", call(lps, [inv]))
    assert out["lines"]["A"]["components"] == [0]
    assert out["lines"]["B"]["components"] == [40]
    inv["amount"] = 41
    assert err("capital_call", call(lps, [inv]))["error"] == "INSUFFICIENT_UNFUNDED"


def test_over_call_from_expense():
    lps = [lp("B", 100, contributed=100), lp("A", 100, contributed=99), lp("C", 100)]
    res = err("capital_call", call(lps, [{"kind": "expense", "amount": 30}]))
    assert res == {"ok": False, "error": "OVER_CALL", "ids": ["A", "B"]}


def test_due_dates_use_longer_notice():
    lps = [lp("A", 100), lp("B", 100, notice_days=15)]
    out = ok("capital_call", call(lps, [{"kind": "expense", "amount": 0}], issue_date="2026-03-27"))
    # 10 business days from Fri 2026-03-27 skipping Good Friday 04-03 and Easter Monday 04-06
    assert out["lines"]["A"]["due_date"] == "2026-04-14"
    assert out["lines"]["B"]["due_date"] == "2026-04-21"


def test_invalid_inputs():
    good = call([lp("A", 100)], [{"kind": "expense", "amount": 1}])
    assert ok("capital_call", good)
    bad = call([lp("A", -100)], [{"kind": "expense", "amount": 1}])
    assert err("capital_call", bad)["error"] == "INVALID_INPUT"
    bad = call([lp("A", 100), lp("A", 100)], [{"kind": "expense", "amount": 1}])
    assert err("capital_call", bad)["error"] == "INVALID_INPUT"
    bad = call([lp("A", 100)], [{"kind": "carry", "amount": 1}])
    assert err("capital_call", bad)["error"] == "INVALID_INPUT"
    bad = call([lp("A", 0)], [{"kind": "expense", "amount": 1}])
    assert err("capital_call", bad)["error"] == "NO_WEIGHT"


def test_negative_unfunded_is_over_call_even_with_zero_total():
    # literal 2.5: total 0 > unfunded -10 (see NOTES.md)
    lps = [lp("A", 100, contributed=110), lp("B", 100)]
    res = err("capital_call", call(lps, [{"kind": "investment", "deal": "d", "sectors": [], "amount": 50}]))
    assert res == {"ok": False, "error": "OVER_CALL", "ids": ["A"]}


def test_fee_counts_against_cap_of_later_investment():
    lps = [lp("A", 3_650_000, contributed=3_648_000), lp("B", 3_650_000)]
    comps = [{"kind": "fee", "period_start": "2024-01-01", "period_end": "2024-01-11"},
             {"kind": "investment", "deal": "d", "sectors": [], "amount": 1000}]
    out = ok("capital_call", call(lps, comps))
    # fee 2000 each; A cap max(0, 2000 - 2000) = 0 -> B takes the whole investment
    assert out["lines"]["A"]["components"] == [2000, 0]
    assert out["lines"]["B"]["components"] == [2000, 1000]
