"""Section 1: rounding, business days, allocation."""

from datetime import date
from fractions import Fraction as F

import pytest
from conftest import err, ok

from cee_ref.allocation import allocate
from cee_ref.dates import (
    add_business_days, add_years, days, easter_sunday, is_business_day, subtract_business_days,
)
from cee_ref.errors import CalcError
from cee_ref.money import round_half_even


# ---- 1.2 rounding ---------------------------------------------------------------

@pytest.mark.parametrize(
    "x,expected",
    [
        (F(5, 2), 2), (F(7, 2), 4), (F(-5, 2), -2), (F(-7, 2), -4),
        (F(1, 2), 0), (F(3, 2), 2), (F(-1, 2), 0), (F(-3, 2), -2),
        (F(249999, 100000), 2), (F(250001, 100000), 3), (F(26, 10), 3), (F(-26, 10), -3),
        (F(-24, 10), -2), (F(0), 0), (F(7), 7), (F(-7), -7),
        (F(10**30 + 1, 2), 10**30 // 2), (F(10**30 + 3, 2), (10**30 + 4) // 2),
    ],
)
def test_round_half_even(x, expected):
    assert round_half_even(x) == expected


# ---- 1.3 day counts --------------------------------------------------------------

def test_days_signed():
    assert days(date(2024, 1, 1), date(2025, 1, 1)) == 366
    assert days(date(2025, 1, 1), date(2024, 1, 1)) == -366
    assert days(date(2024, 7, 1), date(2025, 1, 1)) == 184


# ---- 1.4 business days -----------------------------------------------------------

@pytest.mark.parametrize(
    "year,expected",
    [
        (2024, date(2024, 3, 31)), (2025, date(2025, 4, 20)), (2026, date(2026, 4, 5)),
        (2019, date(2019, 4, 21)), (2000, date(2000, 4, 23)), (2038, date(2038, 4, 25)),
        (2285, date(2285, 3, 22)), (1961, date(1961, 4, 2)), (2027, date(2027, 3, 28)),
    ],
)
def test_easter(year, expected):
    assert easter_sunday(year) == expected


def test_holidays():
    for d in [date(2024, 3, 29), date(2024, 4, 1), date(2025, 4, 18), date(2025, 4, 21),
              date(2026, 4, 3), date(2026, 4, 6), date(2026, 1, 1), date(2026, 5, 1),
              date(2026, 12, 25), date(2026, 12, 26)]:
        assert not is_business_day(d), d
    assert not is_business_day(date(2026, 10, 31))  # Saturday
    assert not is_business_day(date(2026, 11, 1))  # Sunday
    assert is_business_day(date(2026, 4, 2))  # Maundy Thursday is a business day
    assert is_business_day(date(2026, 12, 24))
    assert is_business_day(date(2026, 12, 31))
    assert is_business_day(date(2025, 6, 9))  # Whit Monday is not a TARGET2 holiday


def test_add_business_days():
    assert add_business_days(date(2024, 3, 28), 1) == date(2024, 4, 2)  # over Easter 2024
    assert add_business_days(date(2025, 4, 17), 1) == date(2025, 4, 22)  # over Easter 2025
    assert add_business_days(date(2025, 12, 24), 1) == date(2025, 12, 29)
    assert add_business_days(date(2026, 12, 31), 1) == date(2027, 1, 4)
    assert add_business_days(date(2026, 4, 30), 1) == date(2026, 5, 4)
    assert add_business_days(date(2026, 10, 29), 10) == date(2026, 11, 12)
    # n = 0 returns the date itself, business day or not
    assert add_business_days(date(2026, 10, 31), 0) == date(2026, 10, 31)
    # from a Saturday, the first business day strictly after is Monday
    assert add_business_days(date(2026, 10, 31), 1) == date(2026, 11, 2)


def test_subtract_business_days():
    assert subtract_business_days(date(2024, 4, 2), 1) == date(2024, 3, 28)
    assert subtract_business_days(date(2026, 4, 8), 3) == date(2026, 4, 1)
    assert subtract_business_days(date(2027, 1, 4), 1) == date(2026, 12, 31)
    assert subtract_business_days(date(2026, 11, 1), 0) == date(2026, 11, 1)
    assert subtract_business_days(date(2026, 11, 1), 1) == date(2026, 10, 30)


def test_business_days_op():
    assert ok("business_days", {"date": "2024-03-28", "n": 1}) == {"date": "2024-04-02"}
    assert ok("business_days", {"date": "2024-04-02", "n": -1}) == {"date": "2024-03-28"}
    assert ok("business_days", {"date": "2026-10-31", "n": 0}) == {"date": "2026-10-31"}
    assert err("business_days", {"date": "2026-02-30", "n": 1})["error"] == "INVALID_INPUT"
    assert err("business_days", {"date": "2026-1-5", "n": 1})["error"] == "INVALID_INPUT"


def test_add_years():
    assert add_years(date(2024, 2, 29), 1) == date(2025, 2, 28)
    assert add_years(date(2024, 2, 29), 4) == date(2028, 2, 29)
    assert add_years(date(2023, 3, 1), 1) == date(2024, 3, 1)


# ---- 1.5 allocation --------------------------------------------------------------

def test_allocate_basic_and_ties():
    assert allocate(100, {"a": 1, "b": 1, "c": 1}) == {"a": 34, "b": 33, "c": 33}
    # remainders 2/3, 1/3, 0
    assert allocate(10, {"a": 1, "b": 2, "c": 3}) == {"a": 2, "b": 3, "c": 5}
    # remainder tie (1/2 each) broken by weight descending
    assert allocate(2, {"a": 1, "b": 3}) == {"a": 0, "b": 2}
    # remainder and weight tie broken by key ascending, by code point: "B" (66) < "a" (97)
    assert allocate(1, {"a": 1, "B": 1}) == {"a": 0, "B": 1}
    assert allocate(1, {"ä": 1, "z": 1}) == {"ä": 0, "z": 1}
    # weight-0 keys get 0
    assert allocate(5, {"a": 0, "b": 1, "c": 1}) == {"a": 0, "b": 3, "c": 2}


def test_allocate_rational_weights():
    assert allocate(3, {"x": F(1, 3), "y": F(2, 3)}) == {"x": 1, "y": 2}
    assert allocate(1, {"x": F(1, 3), "y": F(1, 3)}) == {"x": 1, "y": 0}


def test_allocate_zero_and_errors():
    assert allocate(0, {"a": 0}) == {"a": 0}
    assert allocate(0, {}) == {}
    with pytest.raises(CalcError) as e:
        allocate(1, {"a": 0})
    assert e.value.code == "NO_WEIGHT"
    with pytest.raises(CalcError) as e:
        allocate(1, {})
    assert e.value.code == "NO_WEIGHT"


def test_allocate_property():
    import random

    rnd = random.Random(7)
    for _ in range(500):
        n = rnd.randint(1, 8)
        weights = {f"k{i}": rnd.randint(0, 50) for i in range(n)}
        if sum(weights.values()) == 0:
            continue
        amount = rnd.randint(0, 10_000)
        out = allocate(amount, weights)
        total = sum(weights.values())
        assert sum(out.values()) == amount
        for k, w in weights.items():
            assert abs(out[k] - F(amount * w, total)) < 1
            if w == 0:
                assert out[k] == 0


def test_allocate_op():
    assert ok("allocate", {"amount": 100, "weights": {"a": 1, "b": 1, "c": 1}}) == {"a": 34, "b": 33, "c": 33}
    assert err("allocate", {"amount": 1, "weights": {"a": 0}})["error"] == "NO_WEIGHT"
    assert err("allocate", {"amount": -1, "weights": {"a": 1}})["error"] == "INVALID_INPUT"
    assert err("allocate", {"amount": 1, "weights": {"a": -1, "b": 2}})["error"] == "INVALID_INPUT"
    assert err("allocate", {"amount": 1.5, "weights": {"a": 1}})["error"] == "INVALID_INPUT"
    assert err("allocate", {"amount": True, "weights": {"a": 1}})["error"] == "INVALID_INPUT"
    assert "ids" not in err("allocate", {"amount": 1, "weights": {"a": 0}})
