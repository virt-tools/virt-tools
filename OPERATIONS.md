# Operations

## Hardened standard deployment

The standard Compose deployment publishes the web service at
`http://localhost:8080` by default. The API is internal-only. Both application
containers run as unprivileged users with read-only root filesystems, all Linux
capabilities dropped, bounded logs, process and memory limits, graceful stop
periods, and health checks. A short-lived, networkless `data-init` service fixes
ownership of both new and pre-hardening feedback volumes before the non-root API
starts.

```sh
docker compose build --pull
docker compose up -d --no-build
docker compose ps
```

Set `VT_WEB_PORT` to change the host port. Set an immutable `VT_IMAGE_TAG` in a
release system instead of relying on `latest`. `VT_ASSET_VERSION` may also be
set by a release system; when omitted, the web build derives a stable version
from asset contents, so identical builds generate identical asset URLs.
The API and web image builds apply available Alpine package updates on their
pinned release branch. Run the container vulnerability gate on each candidate;
digest pinning alone does not apply fixes published after the base image build.
The separately managed stable edge proxy is not rebuilt by an application-slot
release. Its pinned upstream image also contains older Alpine packages; plan and
verify its package update separately, since replacing the single port-owning
proxy can briefly interrupt traffic. Do not claim an API/web scan covers it.

The probes have different contracts:

- `/api/live` proves the Gunicorn process can answer.
- `/api/ready` verifies SQLite can be read and can acquire a write transaction.
- `/api/health` remains a backward-compatible alias of readiness.

The runtime web image contains only public pages. Explicitly curated, high-risk,
and redirect-source pages remain in Git for review but are safely removed from a
disposable build tree. Exact nginx redirects are evaluated before static-file
lookup and continue to work after their source pages are omitted.

The enforced CSP no longer permits JavaScript `eval`/`Function`; the narrowly
scoped `wasm-unsafe-eval` token remains for the local sql.js WebAssembly runtime.
`unsafe-inline` remains for the site's existing inline scripts and styles and is
tracked as staged migration debt; the browser-security gate prevents reviewed
dangerous sinks from returning while those inline blocks are moved to assets.

## Feedback privacy and abuse control

Feedback accepts only a JSON object with `message` plus optional string fields
`kind` and `tool`. Unknown fields, duplicate keys, invalid kinds, non-string
values, non-standard numbers, oversized bodies, and unsupported control
characters are rejected. nginx and Flask both cap request size.

Submission and lookup limits use an HMAC of the client address. Raw addresses
are never stored, counters become eligible for deletion after their one-hour
window and are purged by later rate-limited activity, and feedback API access
logging is disabled so bearer UUID lookup paths are not written to access logs.
At the first API startup, an HMAC secret is generated atomically in the
`service_metadata` table of the protected feedback volume. Every Gunicorn
worker, blue/green slot, and later release using that volume reads the same
secret, fixing per-worker rate-limit bypass without exposing a secret in Compose
or `docker inspect`. A platform secret can override this by mounting a file and
setting `VT_RATE_LIMIT_SECRET_FILE`; the file must contain at least 32 bytes.
The database-generated secret is included in encrypted backups.

SQLite uses WAL mode, a 10-second busy timeout, atomic write transactions, and a
database-aware readiness probe. Gunicorn runs multiple threaded workers with
bounded request recycling; the Flask development server is not used in Docker.

Feedback moves through `received`, `reviewing`, `planned`, `resolved`, and
`closed`. The older terminal values `completed` and `rejected` are also accepted
and displayed verbatim for backward compatibility. The CLI, database update
guard, API response validation, UI, and tests use this seven-value contract;
new workflows should prefer `resolved` or `closed` over `completed`.

Feedback becomes eligible for automatic deletion after 365 days by default. Set
`VT_FEEDBACK_RETENTION_DAYS` to a positive number of days to change this policy.
Startup performs one bounded deletion batch of at most 500 eligible records.
Request-safe housekeeping checks at most every six hours per worker and removes
at most another 500 records per run; a busy database defers cleanup for one
minute rather than failing a user request. Under a large backlog, actual removal
can occur after the eligibility date. Recent feedback and the HMAC metadata are
never selected by this cleanup.

## Backups and restores

Encrypted backup is the default. The live backup uses SQLite's online backup
API, so the snapshot is consistent with the WAL even while feedback is being
submitted. The versioned archive envelope contains an OpenSSL AES-256-CBC
payload plus an encrypt-then-MAC HMAC-SHA256 tag. Its MAC key is derived with a
domain-separated 250,000-iteration PBKDF2 input, and authentication is checked
with a constant-time comparison before decryption. A wrong passphrase and a
modified archive both fail closed. The passphrase is provided through the
environment, not a process argument.

```sh
export VT_BACKUP_PASSPHRASE='a-long-passphrase-from-your-secret-manager'
scripts/backup_feedback.sh backups/feedback-$(date +%F).db.enc
```

Use `--plain` only when storage-level encryption already protects the archive:

```sh
scripts/backup_feedback.sh --plain backups/feedback-$(date +%F).db
```

Copy backups off-host and test restores regularly. The wrapper marks archives
mode `0600`, but filesystem permissions are not a substitute for encryption.

Restore is intentionally explicit and stops the API to exclude concurrent
writes. It accepts the authenticated versioned envelope, rejects the former
unauthenticated `Salted__` format, and accepts a clearly identified raw SQLite
archive only when the operator adds the separate `--allow-plain` flag. Merely
passing `--yes` never permits a plaintext downgrade. After full
authentication and integrity validation—but before replacement—it writes a
WAL-consistent `feedback.db.pre-restore-<UTC timestamp>.db` rollback snapshot
beside the live database. The verified replacement is staged with mode `0600`
in the destination directory, fsynced, and atomically renamed only while the API
is stopped. The old database is checkpointed first, stale WAL/SHM sidecars are
removed, and the directory is fsynced. It then runs another integrity check and
restarts the API even if the operation fails:

```sh
export VT_BACKUP_PASSPHRASE='the-original-backup-passphrase'
scripts/restore_feedback.sh --yes backups/feedback-2026-08-19.db.enc
curl --fail http://localhost:8080/api/ready
```

Restoring an intentionally plaintext archive requires both confirmations:

```sh
scripts/restore_feedback.sh --yes --allow-plain backups/feedback-2026-08-19.db
```

The backup and restore wrappers automatically detect a valid blue-green
`runtime/edge/active-slot` selector. Backups run against that healthy slot.
Restore takes the same deployment lock as a release, records which slot APIs
are running, stops both blue and green writers because they share one feedback
volume, performs the verified replacement through the active slot image, and
restarts only the writers that were running. If the selector is absent, the
wrappers use the standard Compose project. An invalid selector fails closed.
Restore resolves the active API's immutable image before stopping writers. It
restarts existing containers with `start`, never recreates them from a default
tag, and arms recovery before stopping the first writer.

## Blue-green deployment and rollback

`scripts/deploy_blue_green.sh` maintains a stable, unprivileged edge proxy on
the public port and two isolated application projects on an external Docker
network. It builds and starts only the inactive slot, waits for end-to-end
database readiness, atomically replaces a small upstream file, validates nginx,
and reloads the edge proxy. The former slot keeps running for immediate rollback.
No image pruning occurs while it may be needed for rollback.

For a one-time migration from this repository's older standard Compose
deployment, first build and start a healthy slot with `deploy`. If port 8080 is
still owned by the legacy web container, the deploy will fail closed without
recording an active slot. Promote the already healthy candidate with:

```sh
scripts/deploy_blue_green.sh migrate blue
```

Migration probes the candidate before touching the legacy site, stops the old
port owner, starts and probes the stable edge, and removes the legacy containers
without `-v`, so the named feedback volume is retained. If edge activation
fails, it restarts the legacy web container. Because one host port cannot be
owned by two containers simultaneously, this initial cutover can have a short
connection gap; subsequent `deploy` operations build behind the stable edge and
do not require that gap.

The host needs Docker Compose v2 and `flock`. Start or update the inactive slot:

```sh
scripts/deploy_blue_green.sh deploy --no-cache
scripts/deploy_blue_green.sh status
```

To verify availability continuously during a real rebuild, use the wrapper
below. It probes both the homepage and database readiness every 250 ms while
the normal deploy command builds, starts, validates, and switches the inactive
slot; any failed pair makes the command fail:

```sh
scripts/test_zero_downtime_deploy.sh --no-cache
```

Roll back without rebuilding:

```sh
scripts/deploy_blue_green.sh rollback
```

The edge proxy terminates plain HTTP. In an internet deployment, keep a
same-host TLS proxy in front of port 8080, or add certificates to a separately
managed edge layer. Compose maps `host.docker.internal` to the host gateway and
nginx trusts forwarding headers only from that address, preserving per-client
rate limiting without accepting spoofed headers from direct clients. A remote
load balancer must preserve source addresses or be added explicitly as a
trusted proxy CIDR; otherwise all of its clients share one rate-limit identity.
Do not expose either slot network directly. Schema migrations must remain
backward-compatible while both releases are live.

Runtime selector files live under ignored `runtime/`; source-controlled edge
and slot definitions live in `deploy/blue-green/`.
The deployment script creates the named feedback volume when absent, and the
slot Compose model treats it as external so both releases attach it without
project-ownership warnings or accidental lifecycle coupling.

## Continuous integration

The workflows under `.github/workflows/` run:

- canonical catalog, route, conversion, design, risk, audit-ledger, operations,
  and JavaScript validation;
- API schema, rate-limit, health, and WAL-safe backup tests;
- Chromium smoke tests over the homepage and representative tool routes;
- production container builds, pinned Python dependency auditing, and weekly
  high/critical container vulnerability scans;
- an isolated public-edge response test proving feedback responses retain
  no-store, privacy, framing, and MIME headers without leaking Gunicorn's
  upstream `Server` value.

Treat all three workflows as required checks for the protected release branch.
