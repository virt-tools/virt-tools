# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Virtual Tools (virt.tools) is a privacy-first catalog of browser utilities. Every tool runs **fully client-side** — no tool makes a network request. The only server-side component is the anonymous feedback service (Flask + SQLite). Keep this invariant when adding tools: vendor any JS dependency under `frontend/vendor/` rather than loading from a CDN.

## Commands

```bash
# Build + run both services (web on :8080, api internal on :8000)
docker compose up --build
# Open http://localhost:8080

# Rebuild just the frontend after editing files under frontend/
docker compose up -d --build web

# Review feedback (CLI runs inside the api container so it shares the data volume)
docker compose exec api python /app/scripts/manage_feedback.py list
docker compose exec api python /app/scripts/manage_feedback.py show <uuid>
docker compose exec api python /app/scripts/manage_feedback.py reply <uuid> --status completed --text "Shipped!"
```

There is no test suite, linter, or formatter configured. Verification is manual: rebuild `web`, then `curl` the new tool path and the homepage's `assets/tools.js` to confirm the catalog entry is present.

## Architecture

Two containers defined in `docker-compose.yml`:

- **web** (nginx, `nginx/Dockerfile`) — serves the static frontend from `/usr/share/nginx/html` and proxies `/api/` to the `api` service (`nginx/nginx.conf`). Exposed on host port 8080.
- **api** (Flask, `api/Dockerfile`) — `api/app.py` exposes `POST /api/feedback`, `GET /api/feedback/<uuid>`, `GET /api/health`. Stores submissions in SQLite at `$VT_FEEDBACK_DB` (default `/data/feedback.db`, a named docker volume). `api/db.py` is the storage layer. There is **deliberately no public list/admin endpoint** — the admin surface is the offline CLI in `scripts/manage_feedback.py`, runnable only by someone with host/docker access.

### Catalog is data-driven

The homepage and per-tool nav are generated from `window.VIRTUAL_TOOLS` in `frontend/assets/tools.js`. **To add a tool:**
1. Create `frontend/tools/<slug>/index.html` (copy an existing tool folder for the consistent header / back-link / styles).
2. Add an entry to `frontend/assets/tools.js`. No other wiring — the homepage, search, and "Recently added" view all derive from this registry.

Entry fields: `slug`, `name`, `description`, `category`, `icon` (emoji), `added` (ISO 8601 timestamp — drives the "Recently added" tab and the "Added X ago" card label; use the first-commit date of the tool's folder).

`frontend/assets/app.js` injects the shared site header (any element with `id="site-header"`), renders the catalog (grouped-by-category vs. flat "recent", view choice persisted in `localStorage`), and wires client-side search. It exposes `window.VT = { el, ready, ROOT }` for tool pages to reuse.

### Asset cache-busting (nginx Dockerfile)

The `web` image build rewrites every `assets/*.js` and `assets/*.css` reference in the built HTML to append `?v=<build-timestamp>`, forcing returning visitors to fetch changed assets. This sed pass only matches the `assets/` path prefix — **vendored libraries under `frontend/vendor/` are not versioned**, so when you add a new vendor file just reference it directly (e.g. `/vendor/foo.min.js`). nginx sends `Cache-Control: no-cache` for `*.html|js|css` so revalidation still happens. Rebuild `web` whenever frontend files change, or new tools won't appear.

### Feedback lifecycle

Client (`frontend/feedback/index.html`) `POST /api/feedback` → API writes row with `status='received'` and returns a UUID the user keeps. User later `GET /api/feedback/<uuid>` to read status/reply. Valid statuses: `received`, `completed`, `rejected`. Admin updates status + reply via the CLI, never via a public endpoint.