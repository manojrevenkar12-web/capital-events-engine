"""Section 7: scenario files. `python3 -m cee_ref <scenario.json>` or `--batch <file.jsonl>`."""

import json
import sys

from . import capital_call, distribution, equalisation, feeder, mfn
from . import validate as v
from .allocation import allocate
from .dates import add_business_days, subtract_business_days
from .errors import OVER_CALL, CalcError, invalid


def _op_allocate(inp) -> dict:
    inp = v.obj(inp, "input")
    amount = v.integer(v.req(inp, "amount", "input"), "amount")
    weights_raw = v.obj(v.req(inp, "weights", "input"), "weights")
    weights = {k: v.integer(w, "weight") for k, w in weights_raw.items()}
    return allocate(amount, weights)


def _op_business_days(inp) -> dict:
    inp = v.obj(inp, "input")
    d = v.day(v.req(inp, "date", "input"), "date")
    n = v.integer(v.req(inp, "n", "input"), "n", nonneg=False)
    try:
        out = add_business_days(d, n) if n >= 0 else subtract_business_days(d, -n)
    except OverflowError:
        raise invalid("date out of range") from None
    return {"date": out.isoformat()}


OPS = {
    "allocate": _op_allocate,
    "business_days": _op_business_days,
    "capital_call": capital_call.run,
    "equalisation": equalisation.run,
    "distribution": distribution.run,
    "feeder_call": feeder.run,
    "mfn": mfn.run,
}


def run_scenario(scenario) -> dict:
    """Run one parsed scenario and return the result object of section 7."""
    try:
        s = v.obj(scenario, "scenario")
        op = v.req(s, "op", "scenario")
        if not isinstance(op, str) or op not in OPS:
            raise invalid(f"unknown op {op!r}")
        output = OPS[op](v.req(s, "input", "scenario"))
        return {"ok": True, "output": output}
    except CalcError as err:
        result = {"ok": False, "error": err.code}
        if err.code == OVER_CALL:
            result["ids"] = err.ids
        return result
    except (OverflowError, RecursionError):
        return {"ok": False, "error": "INVALID_INPUT"}


def _reject_constant(name):
    raise ValueError(f"non-JSON constant {name}")


def parse_json(text: str):
    return json.loads(text, parse_constant=_reject_constant)


def run_text(text: str) -> dict:
    try:
        scenario = parse_json(text)
    except (ValueError, RecursionError):
        return {"ok": False, "error": "INVALID_INPUT"}
    try:
        return run_scenario(scenario)
    except Exception as exc:  # a defect in this implementation, never a silent match
        return {"ok": False, "error": "INTERNAL_ERROR", "message": f"{type(exc).__name__}: {exc}"}


def dumps(result: dict) -> str:
    return json.dumps(result, separators=(",", ":"), ensure_ascii=False)


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    out = sys.stdout
    try:
        out.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if len(argv) == 2 and argv[0] == "--batch":
        lines = []
        with open(argv[1], encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                lines.append(dumps(run_text(line)))
        out.write("\n".join(lines) + ("\n" if lines else ""))
        return 0
    if len(argv) == 1 and not argv[0].startswith("--"):
        with open(argv[0], encoding="utf-8") as fh:
            text = fh.read()
        out.write(dumps(run_text(text)) + "\n")
        return 0
    sys.stderr.write("usage: python3 -m cee_ref <scenario.json> | --batch <file.jsonl>\n")
    return 2
