"""Section 1.3 / 1.4 / 4.3: day counts, TARGET2 business days, add_years."""

from datetime import date, timedelta
from functools import lru_cache

ONE_DAY = timedelta(days=1)


def days(a: date, b: date) -> int:
    """Calendar days from a to b (b - a); negative if b is before a."""
    return (b - a).days


def easter_sunday(year: int) -> date:
    """Anonymous Gregorian algorithm (Meeus/Jones/Butcher), exactly as in SPEC 1.4."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


@lru_cache(maxsize=None)
def holidays(year: int) -> frozenset:
    easter = easter_sunday(year)
    return frozenset(
        {
            date(year, 1, 1),
            easter - timedelta(days=2),  # Good Friday
            easter + timedelta(days=1),  # Easter Monday
            date(year, 5, 1),
            date(year, 12, 25),
            date(year, 12, 26),
        }
    )


def is_business_day(d: date) -> bool:
    if d.weekday() >= 5:  # Saturday=5, Sunday=6
        return False
    return d not in holidays(d.year)


def add_business_days(d: date, n: int) -> date:
    if n < 0:
        raise ValueError("n must be >= 0")
    cur = d
    count = 0
    while count < n:
        cur = cur + ONE_DAY
        if is_business_day(cur):
            count += 1
    return cur


def subtract_business_days(d: date, n: int) -> date:
    if n < 0:
        raise ValueError("n must be >= 0")
    cur = d
    count = 0
    while count < n:
        cur = cur - ONE_DAY
        if is_business_day(cur):
            count += 1
    return cur


def _is_leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def add_years(t: date, n: int) -> date:
    """Same month and day n years later; 29 Feb becomes 28 Feb in a non-leap year."""
    y = t.year + n
    if t.month == 2 and t.day == 29 and not _is_leap(y):
        return date(y, 2, 28)
    return date(y, t.month, t.day)
