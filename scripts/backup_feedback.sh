#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
slot_compose="$root/deploy/blue-green/compose.slot.yml"
slot_state="$root/runtime/edge/active-slot"

active_slot=""
if [ -f "$slot_state" ]; then
    active_slot=$(sed -n '1p' "$slot_state")
    case "$active_slot" in
        blue|green) ;;
        *) echo "Invalid blue-green active-slot state: $active_slot" >&2; exit 1 ;;
    esac
fi

compose() {
    if [ -n "$active_slot" ]; then
        VT_SLOT="$active_slot" docker compose -p "virt-tools-$active_slot" \
            -f "$slot_compose" "$@"
    else
        docker compose -f "$root/docker-compose.yml" "$@"
    fi
}

usage() {
    echo "Usage: VT_BACKUP_PASSPHRASE=... $0 [--plain] OUTPUT" >&2
    exit 2
}

encrypt=1
if [ "${1:-}" = "--plain" ]; then
    encrypt=0
    shift
fi
[ "$#" -eq 1 ] || usage

output=$1
case "$output" in
    /*) ;;
    *) output="$(pwd)/$output" ;;
esac
output_dir=$(dirname "$output")
[ -d "$output_dir" ] || { echo "Output directory does not exist: $output_dir" >&2; exit 1; }

container_file="/tmp/feedback-backup-$$.db"
if [ "$encrypt" -eq 1 ]; then
    [ -n "${VT_BACKUP_PASSPHRASE:-}" ] || {
        echo "Set VT_BACKUP_PASSPHRASE or pass --plain." >&2
        exit 1
    }
    container_file="$container_file.enc"
    compose exec -T -e VT_BACKUP_PASSPHRASE api \
        python /app/scripts/feedback_backup.py backup /data/feedback.db "$container_file" --encrypt
else
    compose exec -T api \
        python /app/scripts/feedback_backup.py backup /data/feedback.db "$container_file"
fi

cleanup() {
    compose exec -T api rm -f "$container_file" >/dev/null 2>&1 || true
}
trap cleanup EXIT HUP INT TERM
compose cp "api:$container_file" "$output"
chmod 600 "$output"
if [ -n "$active_slot" ]; then
    deployment_label="blue-green slot $active_slot"
else
    deployment_label="standard Compose"
fi
echo "Backup copied to $output from $deployment_label"
