#!/usr/bin/env bash
# One serialized daily pull-request review. The agent keeps the normal
# sandbox and automatic approval review.
set -euo pipefail
umask 077

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
state="$repo/runtime/pr-review"

mkdir -p "$state"
chmod 700 "$state"
exec 9>"$state/run.lock"
if ! flock -n 9; then
    echo "PR review already running; skipping this tick."
    exit 0
fi
if [[ -e "$state/PAUSED" ]]; then
    echo "PR review paused by runtime/pr-review/PAUSED."
    exit 0
fi

command -v codex >/dev/null
command -v gh >/dev/null
command -v docker >/dev/null
command -v git >/dev/null
run_dir=$(mktemp -d "$state/$(date -u +%Y%m%dT%H%M%SZ)-run.XXXXXX")
echo "PR review started; private logs: $run_dir"
git -C "$repo" status --porcelain=v1 --untracked-files=all >"$run_dir/worktree-before.txt"

export VT_PR_REVIEW_RUN_DIR="$run_dir"
if codex exec --approve-for-me --cd "$repo" --color never --json \
    --output-last-message "$run_dir/summary.txt" - \
    <"$repo/scripts/pr-review-prompt.txt" >"$run_dir/events.jsonl" 2>"$run_dir/stderr.log"; then
    result=0
else
    result=$?
fi
printf '%s\n' "$result" >"$run_dir/exit-code.txt"
printf '%s\n' "$run_dir" >"$state/latest-run.txt"
echo "PR review exited $result; summary: $run_dir/summary.txt"
exit "$result"
