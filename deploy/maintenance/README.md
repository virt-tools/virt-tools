# Half-hourly maintenance

This host-specific user timer runs one Codex cycle at :00 and :30 UTC. It checks
live feedback, addresses at most one actionable unresolved item, or adds one
genuinely absent low-risk tool when the queue is empty. Every application release
must pass tests, a scoped commit and push, a blue-green build/deploy, and health
checks. The durable instructions are in `scripts/feedback-maintenance-prompt.txt`.

The workflow uses the existing Codex ChatGPT sign-in and normal workspace sandbox
with automatic approval review (`--approve-for-me`), not unrestricted execution.
It consumes account usage. The host, Docker, network, and sign-in must remain
available. A rejected approval is a blocker, not permission to bypass review.
The service uses `sg docker` to pick up devbot's existing Docker group membership;
the long-lived user manager may predate that membership. Codex still runs as
devbot, not root.

## Install on this host

Install both units into `/home/devbot/.config/systemd/user/`, then:

```sh
loginctl enable-linger devbot
systemctl --user daemon-reload
bash scripts/run_feedback_maintenance.sh preflight
# Inspect the private preflight summary for PREFLIGHT_OK before enabling.
systemctl --user enable --now virt-tools-maintenance.timer
systemctl --user list-timers virt-tools-maintenance.timer
```

The timer does not run immediately on install or replay missed runs after an
outage. If a cycle lasts more than 30 minutes, systemd skips overlapping ticks.
The runner also holds a file lock so manual invocations cannot overlap it.
There is no forced timeout that could interrupt a production traffic switch.

## Inspect and stop

```sh
systemctl --user status virt-tools-maintenance.timer virt-tools-maintenance.service
journalctl --user -u virt-tools-maintenance.service -n 30 --no-pager
systemctl --user disable --now virt-tools-maintenance.timer
```

Disabling the timer prevents future runs; it does not kill an in-flight deploy.
Wait for that run to finish before editing its files. A
`runtime/maintenance/PAUSED` file also makes new invocations exit without work.

Per-run events, stderr, source-status snapshots, and final summaries live under
`runtime/maintenance/`, ignored by git and owner-readable only. `latest-run.txt`
and `latest-preflight.txt` point to the most recent finished runs. These logs can
contain private feedback; do not publish them. Codex also keeps its normal local
session records. There is no external notification delivery configured. Review
the logs for `NEEDS_ATTENTION.txt`, failures, and disk usage regularly.

## Source baseline and concurrent edits

At setup, the checkout contained uncommitted stabilization source and deployment
files. The owner approved reviewing and committing that baseline on 2026-10-08.
That approval does not extend to unrelated edits made after the baseline commit.
The worker must continue to preserve other work and stop an affected release if
it cannot make an isolated, reproducible change. Failed feedback access or
ambiguous feedback never counts as an empty queue, and pending work is resumed
rather than replaced by a new tool.

Systemd is used because this CLI session has no native Scheduled task control.
OpenAI's [scheduled-task documentation](https://learn.chatgpt.com/docs/automations)
describes the desktop/web management interface; this timer is managed on the
server, not in that interface.
