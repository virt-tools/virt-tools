#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
deploy="$root/scripts/deploy_blue_green.sh"
base_url=${VT_SMOKE_URL:-http://127.0.0.1:8080}

case "${1:-}" in
    "") ;;
    --no-cache) ;;
    *) echo "Usage: $0 [--no-cache]" >&2; exit 2 ;;
esac

log=$(mktemp /tmp/virt-tools-deploy.XXXXXX)
deploy_pid=""
cleanup() {
    if [ -n "$deploy_pid" ] && kill -0 "$deploy_pid" 2>/dev/null; then
        kill "$deploy_pid" 2>/dev/null || true
    fi
    rm -f "$log"
}
trap cleanup EXIT HUP INT TERM

"$deploy" deploy "$@" >"$log" 2>&1 &
deploy_pid=$!
attempts=0
failures=0

while kill -0 "$deploy_pid" 2>/dev/null; do
    attempts=$((attempts + 1))
    if ! curl --fail --silent --show-error --max-time 2 "$base_url/api/ready" >/dev/null \
        || ! curl --fail --silent --show-error --max-time 2 "$base_url/" >/dev/null; then
        failures=$((failures + 1))
    fi
    if [ $((attempts % 20)) -eq 0 ]; then
        echo "Continuous probe: attempts=$attempts failures=$failures"
    fi
    sleep 0.25
done

if wait "$deploy_pid"; then
    deploy_status=0
else
    deploy_status=$?
fi
deploy_pid=""
cat "$log"

if [ "$deploy_status" -ne 0 ]; then
    echo "Deployment failed with status $deploy_status." >&2
    exit "$deploy_status"
fi
if [ "$attempts" -lt 2 ]; then
    echo "Deployment completed before continuous availability could be sampled." >&2
    exit 1
fi
if [ "$failures" -ne 0 ]; then
    echo "Zero-downtime verification observed $failures failed probe(s) out of $attempts." >&2
    exit 1
fi

echo "Zero-downtime verification passed: $attempts homepage/readiness probe pairs, 0 failures."
