"""Error codes of SPEC section 7."""

NO_WEIGHT = "NO_WEIGHT"
INSUFFICIENT_UNFUNDED = "INSUFFICIENT_UNFUNDED"
OVER_CALL = "OVER_CALL"
UNSUPPORTED_FEE_PERIOD = "UNSUPPORTED_FEE_PERIOD"
INVALID_INPUT = "INVALID_INPUT"


class CalcError(Exception):
    """A calculation failure that is reported as {"ok": false, "error": code}."""

    def __init__(self, code: str, ids=None, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.ids = sorted(ids) if ids is not None else None
        self.detail = detail


def invalid(detail: str) -> CalcError:
    return CalcError(INVALID_INPUT, detail=detail)
