"""Strict readers for scenario input. Anything malformed raises INVALID_INPUT."""

import re
from datetime import date

from .errors import invalid

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SAFE = 2**53


def obj(v, what: str) -> dict:
    if not isinstance(v, dict):
        raise invalid(f"{what}: expected object")
    return v


def lst(v, what: str) -> list:
    if not isinstance(v, list):
        raise invalid(f"{what}: expected list")
    return v


def req(o: dict, key: str, what: str):
    if key not in o:
        raise invalid(f"{what}: missing {key!r}")
    return o[key]


def integer(v, what: str, *, nonneg: bool = True) -> int:
    """An integer. JSON booleans are not integers. An integral float (e.g. 5.0 or 1e3) is
    accepted, because JavaScript cannot tell it from an integer; a fractional one is not."""
    if isinstance(v, bool):
        raise invalid(f"{what}: expected integer, got boolean")
    if isinstance(v, int):
        n = v
    elif isinstance(v, float) and v.is_integer() and abs(v) < _SAFE:
        n = int(v)
    else:
        raise invalid(f"{what}: expected integer")
    if nonneg and n < 0:
        raise invalid(f"{what}: negative")
    return n


def string(v, what: str) -> str:
    if not isinstance(v, str):
        raise invalid(f"{what}: expected string")
    return v


def strings(v, what: str) -> list:
    return [string(x, what) for x in lst(v, what)]


def day(v, what: str) -> date:
    if not isinstance(v, str) or not _DATE_RE.match(v):
        raise invalid(f"{what}: expected YYYY-MM-DD")
    try:
        return date(int(v[0:4]), int(v[5:7]), int(v[8:10]))
    except ValueError:
        raise invalid(f"{what}: not a calendar date") from None


def unique_ids(ids, what: str) -> None:
    if len(set(ids)) != len(ids):
        raise invalid(f"{what}: duplicate id")
