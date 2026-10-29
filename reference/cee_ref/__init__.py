"""Independent reference implementation of docs/SPEC.md (standard library only)."""

from .errors import CalcError
from .cli import run_scenario

__all__ = ["CalcError", "run_scenario"]
