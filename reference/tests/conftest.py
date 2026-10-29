import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cee_ref.cli import run_scenario


def run(op, inp):
    return run_scenario({"op": op, "input": inp})


def ok(op, inp):
    res = run(op, inp)
    assert res["ok"] is True, res
    return res["output"]


def err(op, inp):
    res = run(op, inp)
    assert res["ok"] is False, res
    return res
