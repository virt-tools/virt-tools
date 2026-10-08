#!/usr/bin/env bash
# One serialized scheduled run. The agent keeps the normal sandbox/approval review.
set -euo pipefail
umask 077

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
state="$repo/runtime/maintenance"
mode=${1:-run}
case "$mode" in run|preflight) ;; *) echo "Usage: $0 [run|preflight]" >&2; exit 2 ;; esac

mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/run.lock"
if ! flock -n 9; then
    echo "Maintenance already running; skipping this tick."
    exit 0
fi
if [[ -e "$state/PAUSED" ]]; then
    echo "Maintenance paused by runtime/maintenance/PAUSED."
    exit 0
fi

command -v codex >/dev/null
command -v docker >/dev/null
command -v git >/dev/null
run_dir=$(mktemp -d "$state/$(date -u +%Y%m%dT%H%M%SZ)-$mode.XXXXXX")
echo "Maintenance $mode started; private logs: $run_dir"
git -C "$repo" status --porcelain=v1 --untracked-files=all >"$run_dir/worktree-before.txt"

prompt="$repo/scripts/feedback-maintenance-prompt.txt"
if [[ "$mode" = preflight ]]; then
    prompt="$repo/scripts/feedback-maintenance-preflight.txt"
fi
export VT_MAINTENANCE_RUN_DIR="$run_dir"
if codex exec --approve-for-me --cd "$repo" --color never --json \
    --output-last-message "$run_dir/summary.txt" - \
    <"$prompt" >"$run_dir/events.jsonl" 2>"$run_dir/stderr.log"; then
    result=0
else
    result=$?
fi
printf '%s\n' "$result" >"$run_dir/exit-code.txt"
printf '%s\n' "$run_dir" >"$state/latest-$mode.txt"
echo "Maintenance $mode exited $result; summary: $run_dir/summary.txt"
exit "$result"
