#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
suffix=$$
network="vt-edge-header-test-$suffix"
api="vt-edge-header-api-$suffix"
edge="vt-edge-header-proxy-$suffix"
api_image=${VT_API_TEST_IMAGE:-virt-tools-api:ci}
edge_image="nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6"

cleanup() {
    docker rm -f "$edge" "$api" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM

docker network create "$network" >/dev/null
docker run -d --name "$api" --network "$network" --network-alias edge-test-api \
    -v "$root/tests/fixtures/http-root:/srv:ro" \
    --entrypoint python "$api_image" -m http.server 8000 --directory /srv >/dev/null
docker run -d --name "$edge" --network "$network" \
    --add-host host.docker.internal:host-gateway \
    -v "$root/deploy/blue-green/edge.conf:/etc/nginx/conf.d/default.conf:ro" \
    -v "$root/tests/fixtures:/etc/nginx/active-upstream:ro" \
    "$edge_image" >/dev/null

attempt=0
while ! docker exec "$edge" wget -q -O /dev/null http://127.0.0.1:8080/edge-health; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 20 ] || { docker logs "$edge" >&2; exit 1; }
    sleep 1
done

headers=$(docker exec "$edge" wget -S -O /dev/null http://127.0.0.1:8080/api/header-test 2>&1 || true)
for expected in \
    "Cache-Control: no-store" \
    "Pragma: no-cache" \
    "Referrer-Policy: no-referrer" \
    "X-Content-Type-Options: nosniff" \
    "X-Frame-Options: DENY"
do
    echo "$headers" | grep -Fqi "$expected" || {
        echo "Public edge response is missing: $expected" >&2
        echo "$headers" >&2
        exit 1
    }
done
if echo "$headers" | grep -Fqi "SimpleHTTP"; then
    echo "Public edge leaked the upstream Server header" >&2
    exit 1
fi
echo "Validated public edge API response headers"
