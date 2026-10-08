#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
slot_compose="$root/deploy/blue-green/compose.slot.yml"
edge_compose="$root/deploy/blue-green/compose.edge.yml"
runtime="$root/runtime/edge"
state="$runtime/active-slot"
lock="$root/runtime/deploy.lock"
feedback_volume=${VT_FEEDBACK_VOLUME:-virt-tools_feedback-data}

usage() {
    echo "Usage: $0 deploy [--no-cache] | migrate <blue|green> | rollback | status" >&2
    exit 2
}

command=${1:-}
shift || true
case "$command" in deploy|migrate|rollback|status) ;; *) usage ;; esac

mkdir -p "$runtime"
exec 9>"$lock"
if ! flock -n 9; then
    echo "Another deployment is in progress." >&2
    exit 1
fi

ensure_network() {
    if ! docker network inspect virt-tools-edge >/dev/null 2>&1; then
        docker network create virt-tools-edge >/dev/null
    fi
}

ensure_volume() {
    if ! docker volume inspect "$feedback_volume" >/dev/null 2>&1; then
        docker volume create "$feedback_volume" >/dev/null
    fi
}

current_slot() {
    if [ -f "$state" ]; then
        slot=$(sed -n '1p' "$state")
        case "$slot" in blue|green) echo "$slot"; return ;; esac
    fi
    echo ""
}

other_slot() {
    if [ "$1" = blue ]; then echo green; else echo blue; fi
}

probe_slot() {
    candidate=$1
    attempts=0
    while [ "$attempts" -lt 30 ]; do
        if docker run --rm --network virt-tools-edge --entrypoint wget \
            "virt-tools-web:${VT_IMAGE_TAG:-bluegreen}" \
            -q -O /dev/null "http://virt-tools-$candidate-web:8080/api/ready"; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 2
    done
    echo "Candidate slot $candidate did not become ready." >&2
    return 1
}

probe_edge() {
    attempts=0
    while [ "$attempts" -lt 20 ]; do
        if docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge \
            sh -c 'wget -q -O /dev/null http://127.0.0.1:8080/api/ready && wget -q -O /dev/null http://127.0.0.1:8080/'; then
            return 0
        fi
        attempts=$((attempts + 1))
        sleep 1
    done
    echo "Stable edge did not route to a ready API." >&2
    return 1
}

switch_slot() {
    candidate=$1
    upstream="$runtime/upstream.conf"
    temporary=$(mktemp "$runtime/upstream.conf.XXXXXX")
    previous=$(mktemp "$runtime/upstream.previous.XXXXXX")
    had_previous=0
    if [ -f "$upstream" ]; then
        cp "$upstream" "$previous"
        had_previous=1
    fi
    trap 'rm -f "$temporary" "$previous"' EXIT HUP INT TERM
    {
        echo "upstream active_web { zone active_web 64k; server virt-tools-$candidate-web:8080 resolve; keepalive 32; }"
        echo "upstream active_api { zone active_api 64k; server virt-tools-$candidate-api:8000 resolve; keepalive 16; }"
    } >"$temporary"
    chmod 644 "$temporary"
    mv "$temporary" "$upstream"

    if docker compose -p virt-tools-edge -f "$edge_compose" ps --status running --quiet | grep -q .; then
        if ! docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -t \
            || ! docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -s reload \
            || ! probe_edge; then
            if [ "$had_previous" -eq 1 ]; then
                mv "$previous" "$upstream"
                docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -t
                docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -s reload
                probe_edge
            else
                rm -f "$upstream"
            fi
            trap - EXIT HUP INT TERM
            echo "Traffic switch failed; the previous upstream was restored." >&2
            return 1
        fi
    else
        edge_ready=0
        if docker compose -p virt-tools-edge -f "$edge_compose" up -d && probe_edge; then
            edge_ready=1
        else
            echo "Retrying stable edge once after initial startup/routing failure..." >&2
            if docker compose -p virt-tools-edge -f "$edge_compose" up -d --force-recreate \
                && probe_edge; then
                edge_ready=1
            fi
        fi
        if [ "$edge_ready" -ne 1 ]; then
            if [ "$had_previous" -eq 1 ]; then
                mv "$previous" "$upstream"
                if docker compose -p virt-tools-edge -f "$edge_compose" ps --status running --quiet | grep -q .; then
                    docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -t
                    docker compose -p virt-tools-edge -f "$edge_compose" exec -T edge nginx -s reload
                    probe_edge
                fi
            else
                rm -f "$upstream"
                docker compose -p virt-tools-edge -f "$edge_compose" stop edge >/dev/null 2>&1 || true
            fi
            trap - EXIT HUP INT TERM
            echo "Stable edge startup failed; active-slot state was not changed." >&2
            return 1
        fi
    fi

    rm -f "$previous"
    trap - EXIT HUP INT TERM

    temporary=$(mktemp "$runtime/active-slot.XXXXXX")
    printf '%s\n' "$candidate" >"$temporary"
    mv "$temporary" "$state"
    echo "Traffic now points to $candidate; the previous slot remains available for rollback."
}

ensure_network
ensure_volume

case "$command" in
    deploy)
        no_cache=""
        if [ "${1:-}" = "--no-cache" ]; then
            no_cache="--no-cache"
            shift
        fi
        [ "$#" -eq 0 ] || usage
        current=$(current_slot)
        if [ -z "$current" ]; then candidate=blue; else candidate=$(other_slot "$current"); fi
        echo "Building inactive $candidate slot while ${current:-no slot} remains active..."
        VT_SLOT=$candidate docker compose -p "virt-tools-$candidate" -f "$slot_compose" \
            build --pull $no_cache
        VT_SLOT=$candidate docker compose -p "virt-tools-$candidate" -f "$slot_compose" \
            up -d --no-build
        probe_slot "$candidate"
        switch_slot "$candidate"
        ;;
    migrate)
        [ "$#" -eq 1 ] || usage
        candidate=$1
        case "$candidate" in blue|green) ;; *) usage ;; esac
        [ -z "$(current_slot)" ] || {
            echo "Blue-green already has an active slot; use deploy instead." >&2
            exit 1
        }
        standard_compose="$root/docker-compose.yml"
        legacy_web=$(docker compose -f "$standard_compose" ps --status running --quiet web)
        if [ -z "$legacy_web" ]; then
            echo "No running standard web container is available to migrate." >&2
            exit 1
        fi
        probe_slot "$candidate"
        echo "Stopping the legacy port owner for the one-time stable-edge cutover..."
        docker compose -f "$standard_compose" stop web
        if switch_slot "$candidate"; then
            # The named feedback volume is retained; `down` never receives -v.
            docker compose -f "$standard_compose" down
            echo "Legacy Compose containers removed; feedback volume retained."
        else
            # The legacy container may predate the current Compose dependency
            # model, so restart the exact captured container instead of asking
            # Compose to re-evaluate newly added services.
            docker start "$legacy_web" >/dev/null
            echo "Migration failed; the legacy web container was restarted." >&2
            exit 1
        fi
        ;;
    rollback)
        current=$(current_slot)
        [ -n "$current" ] || { echo "No active slot is recorded." >&2; exit 1; }
        candidate=$(other_slot "$current")
        probe_slot "$candidate"
        switch_slot "$candidate"
        ;;
    status)
        echo "Active slot: $(current_slot || true)"
        VT_SLOT=blue docker compose -p virt-tools-blue -f "$slot_compose" ps
        VT_SLOT=green docker compose -p virt-tools-green -f "$slot_compose" ps
        docker compose -p virt-tools-edge -f "$edge_compose" ps
        ;;
esac
