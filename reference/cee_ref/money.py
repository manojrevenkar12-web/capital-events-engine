"""Section 1.1 / 1.2: exact rationals and half-to-even rounding."""

from fractions import Fraction

HALF = Fraction(1, 2)


def round_half_even(x) -> int:
    """Round an exact rational to the nearest integer, ties to even (SPEC 1.2)."""
    x = Fraction(x)
    fl = x.numerator // x.denominator  # floor, also for negatives
    r = x - fl
    if r > HALF:
        return fl + 1
    if r < HALF:
        return fl
    return fl if fl % 2 == 0 else fl + 1


def floor(x) -> int:
    x = Fraction(x)
    return x.numerator // x.denominator
