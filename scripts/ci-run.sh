#!/usr/bin/env bash
# ci-run.sh <title> <command...>: runs a command, and on failure posts the tail of its output as a
# GitHub annotation (job logs are not always readable; annotations are).
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status=${PIPESTATUS[0]}
if [ "$status" -ne 0 ]; then
  tail_text="$(tail -n 25 "$log" | cut -c1-400 | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN{ORS="%0A"} {print}')"
  echo "::error title=${title}::${tail_text}"
fi
exit "$status"
