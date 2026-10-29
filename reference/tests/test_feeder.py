"""Section 5: feeder pass-through."""

from conftest import err, ok


def lp(id, commitment, contributed=0, excuse_sectors=(), notice_days=0):
    return {"id": id, "commitment": commitment, "contributed": contributed,
            "excuse_sectors": list(excuse_sectors), "notice_days": notice_days}


def feeder(lps, comps, feeder_expense=0, issue="2026-04-01", due="2026-04-10", default=2, buffer=2):
    return {"master_components": comps, "feeder_expense": feeder_expense, "lps": lps,
            "master_issue_date": issue, "master_due_date": due, "default_notice_days": default,
            "buffer_days": buffer}


COMPS = [{"kind": "expense", "amount": 100}, {"kind": "fee", "amount": 50},
         {"kind": "investment", "sectors": ["oil"], "amount": 500}]


def test_amounts_and_timing():
    lps = [lp("F1", 600, notice_days=3), lp("F2", 400, contributed=300, excuse_sectors=["oil"])]
    out = ok("feeder_call", feeder(lps, COMPS, feeder_expense=11))
    # expense 60/40, fee 30/20, investment: F2 excused -> F1 500 (cap 510), feeder expense 6.6/4.4 -> 7/4
    assert out["lines"]["F1"] == {"components": [60, 30, 500, 7], "total": 597}
    assert out["lines"]["F2"] == {"components": [40, 20, 0, 4], "total": 64}
    # pay_by = 2026-04-10 - 2 bd = 04-08; notice 3 back over Easter Monday 04-06 and Good Friday 04-03
    assert out["latest_issue"] == "2026-04-01"
    assert out["bridge_required"] is False
    out = ok("feeder_call", feeder(lps, COMPS, feeder_expense=11, issue="2026-04-02"))
    assert out["bridge_required"] is True


def test_feeder_expense_zero_still_listed_and_water_filling():
    lps = [lp("F1", 100, contributed=95), lp("F2", 100)]
    out = ok("feeder_call", feeder(lps, [{"kind": "investment", "sectors": [], "amount": 50}]))
    assert out["lines"]["F1"] == {"components": [5, 0], "total": 5}
    assert out["lines"]["F2"] == {"components": [45, 0], "total": 45}


def test_errors():
    lps = [lp("F1", 100, contributed=100), lp("F2", 100)]
    res = err("feeder_call", feeder(lps, [{"kind": "fee", "amount": 10}]))
    assert res == {"ok": False, "error": "OVER_CALL", "ids": ["F1"]}
    res = err("feeder_call", feeder(lps, [{"kind": "investment", "sectors": [], "amount": 101}]))
    assert res["error"] == "INSUFFICIENT_UNFUNDED"
    res = err("feeder_call", feeder([], [], feeder_expense=1))
    assert res["error"] == "NO_WEIGHT"
    out = ok("feeder_call", feeder([], [], default=0, buffer=0, issue="2026-04-10"))
    assert out == {"lines": {}, "latest_issue": "2026-04-10", "bridge_required": False}
