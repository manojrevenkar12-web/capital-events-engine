"""Independent reference implementation of docs/SPEC.md (standard library only)."""

from .cli import run_scenario
from .errors import CalcError

__all__ = ["CalcError", "run_scenario"]
