"""Section 1.5: pro-rata allocation with largest-remainder tie-breaks."""

from fractions import Fraction

from .errors import NO_WEIGHT, CalcError, invalid


def allocate(amount: int, weights: dict) -> dict:
    """Split a non-negative integer amount by non-negative rational weights.

    Returns a dict with the same keys, in the same order, as `weights`.
    """
    if amount < 0:
        raise invalid("allocate: negative amount")
    for k, w in weights.items():
        if w < 0:
            raise invalid(f"allocate: negative weight for {k!r}")
    if amount == 0:
        return {k: 0 for k in weights}
    total = sum((Fraction(w) for w in weights.values()), Fraction(0))
    if total == 0:
        raise CalcError(NO_WEIGHT, detail="allocate: all weights are zero")

    base = {}
    rem = {}
    for k, w in weights.items():
        q = Fraction(amount) * Fraction(w) / total
        fl = q.numerator // q.denominator
        base[k] = fl
        rem[k] = q - fl
    extra = amount - sum(base.values())
    if extra:
        # remainder descending, then weight descending, then key ascending (code point).
        order = sorted(weights, key=lambda k: (-rem[k], -Fraction(weights[k]), k))
        for k in order[:extra]:
            base[k] += 1
    return base
