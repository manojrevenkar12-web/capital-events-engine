#!/usr/bin/env python3
"""Delivery metrics for this repository, from git and GitHub Actions.

    python3 scripts/dora.py owner/repo > reports/engineering/dora.json

There are no production deploys yet, so a green CI run on main stands in for a deploy; the output
says so. Lead time is from a commit's author time to the first green run on main that contains it.
"""

import json
import subprocess
import sys
from datetime import datetime


def gh(path: str):
    return json.loads(subprocess.check_output(["gh", "api", path, "--paginate"], text=True))


def ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main(repo: str) -> None:
    runs = [
        r
        for r in gh(f"repos/{repo}/actions/runs?branch=main&per_page=100")["workflow_runs"]
        if r["name"] == "ci" and r["status"] == "completed" and r["conclusion"] in ("success", "failure")
    ]
    runs.sort(key=lambda r: r["created_at"])
    commits = subprocess.check_output(["git", "log", "--format=%H %aI", "main"], text=True).split("\n")
    authored = {line.split()[0]: ts(line.split()[1]) for line in commits if line}
    order = [line.split()[0] for line in reversed(commits) if line]

    green = [r for r in runs if r["conclusion"] == "success"]
    lead = []
    for sha in order:
        later = [r for r in green if r["head_sha"] in order and order.index(r["head_sha"]) >= order.index(sha)]
        if later:
            first = min(later, key=lambda r: r["updated_at"])
            lead.append((ts(first["updated_at"]) - authored[sha]).total_seconds() / 60)

    restore = []
    broken_at = None
    for r in runs:
        if r["conclusion"] == "failure" and broken_at is None:
            broken_at = ts(r["created_at"])
        elif r["conclusion"] == "success" and broken_at is not None:
            restore.append((ts(r["updated_at"]) - broken_at).total_seconds() / 60)
            broken_at = None

    median = lambda xs: sorted(xs)[len(xs) // 2] if xs else None  # noqa: E731
    print(
        json.dumps(
            {
                "note": "no production deploys yet: a green CI run on main stands in for a deploy",
                "commits_on_main": len(order),
                "ci_runs_completed": len(runs),
                "green_runs": len(green),
                "change_failure_rate": round(1 - len(green) / len(runs), 3) if runs else None,
                "lead_time_minutes_median": round(median(lead), 1) if lead else None,
                "time_to_restore_minutes": [round(x, 1) for x in restore],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
