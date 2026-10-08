#!/usr/bin/env bash
# Keep the test server and both suites in one supervised CI step.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
export BASE_URL=http://127.0.0.1:4173
server_log="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/virt-tools-http.log"

python3 -u -m http.server 4173 --bind 127.0.0.1 --directory frontend >"$server_log" 2>&1 &
server_pid=$!
cleanup() {
    smoke_result=$?
    trap - EXIT
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
    if [ "$smoke_result" -ne 0 ]; then
        printf '\nStatic server log:\n' >&2
        cat "$server_log" >&2
    fi
    exit "$smoke_result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

ready=0
for ((attempt = 1; attempt <= 60; attempt++)); do
    if ! kill -0 "$server_pid" 2>/dev/null; then
        echo "Static server exited before becoming ready." >&2
        exit 1
    fi
    if curl --fail --silent --max-time 1 "$BASE_URL/" >/dev/null 2>&1; then
        ready=1
        break
    fi
    sleep 0.5
done
if [ "$ready" -ne 1 ]; then
    echo "Static server did not become ready after 60 attempts." >&2
    exit 1
fi

node tests/browser_smoke.mjs
node tests/ui_smoke.mjs
