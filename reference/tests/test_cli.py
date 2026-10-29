"""Section 7: scenario files and the CLI."""

import json
import subprocess
import sys
from pathlib import Path

from conftest import run

REF = Path(__file__).resolve().parent.parent


def cli(*args):
    res = subprocess.run([sys.executable, "-m", "cee_ref", *args], cwd=REF, capture_output=True,
                         text=True, check=True)
    return res.stdout


def test_single_and_batch(tmp_path):
    one = tmp_path / "one.json"
    one.write_text(json.dumps({"op": "allocate", "input": {"amount": 100, "weights": {"a": 1, "b": 1, "c": 1}}}))
    assert json.loads(cli(str(one))) == {"ok": True, "output": {"a": 34, "b": 33, "c": 33}}

    batch = tmp_path / "b.jsonl"
    batch.write_text("\n".join([
        json.dumps({"op": "business_days", "input": {"date": "2024-03-28", "n": 1}}),
        "not json",
        json.dumps({"op": "nope", "input": {}}),
        json.dumps({"op": "allocate", "input": {"amount": 1, "weights": {"a": 0}}}),
    ]) + "\n")
    lines = [json.loads(x) for x in cli("--batch", str(batch)).splitlines()]
    assert lines == [
        {"ok": True, "output": {"date": "2024-04-02"}},
        {"ok": False, "error": "INVALID_INPUT"},
        {"ok": False, "error": "INVALID_INPUT"},
        {"ok": False, "error": "NO_WEIGHT"},
    ]


def test_types_in_output():
    res = run("feeder_call", {"master_components": [], "feeder_expense": 0, "lps": [],
                              "master_issue_date": "2026-04-01", "master_due_date": "2026-04-10",
                              "default_notice_days": 0, "buffer_days": 0})
    assert res["output"]["bridge_required"] is False
    assert json.dumps(res).count("false") == 1


def test_missing_input_is_invalid():
    assert run("capital_call", {}) == {"ok": False, "error": "INVALID_INPUT"}
    assert run("distribution", None) == {"ok": False, "error": "INVALID_INPUT"}
