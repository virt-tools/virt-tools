#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
slot_compose="$root/deploy/blue-green/compose.slot.yml"
slot_state="$root/runtime/edge/active-slot"
deploy_runtime="$root/runtime"

usage() {
    echo "Usage: VT_BACKUP_PASSPHRASE=... $0 --yes [--allow-plain] ARCHIVE" >&2
    exit 2
}

[ "${1:-}" = "--yes" ] || usage
shift
allow_plain=0
if [ "${1:-}" = "--allow-plain" ]; then
    allow_plain=1
    shift
fi
[ "$#" -eq 1 ] || usage

archive=$1
[ -f "$archive" ] || { echo "Backup does not exist: $archive" >&2; exit 1; }

mkdir -p "$deploy_runtime"
exec 9>"$deploy_runtime/deploy.lock"
if ! flock -n 9; then
    echo "A deployment or restore is already in progress." >&2
    exit 1
fi

active_slot=""
if [ -f "$slot_state" ]; then
    active_slot=$(sed -n '1p' "$slot_state")
    case "$active_slot" in
        blue|green) ;;
        *) echo "Invalid blue-green active-slot state: $active_slot" >&2; exit 1 ;;
    esac
fi

slot_compose_command() {
    restore_slot=$1
    shift
    VT_SLOT="$restore_slot" docker compose -p "virt-tools-$restore_slot" \
        -f "$slot_compose" "$@"
}

standard_compose_command() {
    docker compose -f "$root/docker-compose.yml" "$@"
}

# A restore must use the active release, not the Compose file's default tag.
# Resolve it before stopping any writers, and fail closed on unexpected images.
if [ -n "$active_slot" ]; then
    restore_container=$(slot_compose_command "$active_slot" ps --all --quiet api)
else
    restore_container=$(standard_compose_command ps --all --quiet api)
fi
printf '%s\n' "$restore_container" | grep -Eq '^[0-9a-f]{12,64}$' || {
    echo "Expected exactly one existing API container for restore." >&2
    exit 1
}
restore_image=$(docker inspect --format '{{.Config.Image}}' "$restore_container")
case "$restore_image" in
    virt-tools-api:?*) VT_IMAGE_TAG=${restore_image#virt-tools-api:}; export VT_IMAGE_TAG ;;
    *) echo "Unexpected active API image; refusing to change running releases." >&2; exit 1 ;;
esac

blue_was_running=0
green_was_running=0
standard_was_running=0
if [ -n "$active_slot" ]; then
    [ -n "$(slot_compose_command blue ps --status running --quiet api)" ] && blue_was_running=1
    [ -n "$(slot_compose_command green ps --status running --quiet api)" ] && green_was_running=1
else
    [ -n "$(standard_compose_command ps --status running --quiet api)" ] && standard_was_running=1
fi

restart_apis() {
    restart_status=0
    if [ "$blue_was_running" -eq 1 ]; then
        slot_compose_command blue start api >/dev/null || restart_status=1
    fi
    if [ "$green_was_running" -eq 1 ]; then
        slot_compose_command green start api >/dev/null || restart_status=1
    fi
    if [ "$standard_was_running" -eq 1 ]; then
        standard_compose_command start api >/dev/null || restart_status=1
    fi
    return "$restart_status"
}
# Install recovery before the first stop, including partial-stop failures.
trap restart_apis EXIT HUP INT TERM

if [ -n "$active_slot" ]; then
    echo "Stopping both blue-green API writers for an exclusive, verified restore..."
    slot_compose_command blue stop api
    slot_compose_command green stop api
else
    echo "Stopping the standard API writer for an exclusive, verified restore..."
    standard_compose_command stop api
fi

restore_runner() {
    if [ -n "$active_slot" ]; then
        slot_compose_command "$active_slot" run --rm -T --no-deps "$@"
    else
        standard_compose_command run --rm -T --no-deps "$@"
    fi
}

if [ -n "${VT_BACKUP_PASSPHRASE:-}" ]; then
    if [ "$allow_plain" -eq 1 ]; then
        restore_runner \
            -e VT_BACKUP_PASSPHRASE \
            api python /app/scripts/feedback_backup.py restore - /data/feedback.db --force --allow-plain <"$archive"
    else
        restore_runner \
            -e VT_BACKUP_PASSPHRASE \
            api python /app/scripts/feedback_backup.py restore - /data/feedback.db --force <"$archive"
    fi
else
    if [ "$allow_plain" -eq 1 ]; then
        restore_runner \
            api python /app/scripts/feedback_backup.py restore - /data/feedback.db --force --allow-plain <"$archive"
    else
        restore_runner \
            api python /app/scripts/feedback_backup.py restore - /data/feedback.db --force <"$archive"
    fi
fi

restart_apis
trap - EXIT HUP INT TERM
echo "Restore complete; every previously running API writer was restarted."
