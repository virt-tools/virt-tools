# Virtual Tools

A free, privacy-first collection of browser-based utilities at **https://virt.tools**.

Each tool runs entirely in the user's browser — no data is sent to a server. The
only server-side component is the **anonymous feedback** service, which stores
submissions keyed by a UUID so users can check back on status and developer
replies.

## Project layout

```
frontend/              Static site (served by nginx)
  index.html           Homepage — renders the catalog from assets/tools.js
  assets/
    tools.js           ★ Tool registry — add new tools here
    app.js             Shared header + catalog rendering
    style.css          Shared styles (dark/light)
  vendor/              Locally vendored libraries (e.g. qrcode.min.js) — no runtime CDNs
  tools/<slug>/        One folder per tool, each with an index.html
  feedback/            Submit + status lookup page
api/                   Flask + SQLite feedback service
  app.py               POST /api/feedback, GET /api/feedback/<uuid>
  db.py                SQLite storage layer
  Dockerfile
scripts/
  manage_feedback.py   Offline admin CLI (review / reply / set status)
nginx/
  nginx.conf           Serves frontend, proxies /api/ to the api service
  Dockerfile
docker-compose.yml     web (nginx) + api, exposed on port 8080
```

## Adding a new tool

1. Create `frontend/tools/<your-slug>/index.html` — copy an existing tool folder
   as a starting point so the header, styles and back-link are consistent.
2. Add an entry to `frontend/assets/tools.js`. The homepage and nav update
   automatically. No other wiring needed.

Keep tools client-side. If you need a JS library, vendor it under
`frontend/vendor/` rather than loading from a CDN, to preserve privacy.

## Running locally with Docker

```bash
docker compose up --build
```

Then open http://localhost:8080.

## Reviewing feedback (offline, developer only)

The admin tool runs inside the `api` container so it reads the same data volume:

```bash
docker compose exec api python /app/scripts/manage_feedback.py list
docker compose exec api python /app/scripts/manage_feedback.py show <uuid>
docker compose exec api python /app/scripts/manage_feedback.py reply <uuid> --status completed --text "Shipped!"
```

Valid statuses: `received`, `completed`, `rejected`. There is no public admin
endpoint — submissions are only readable by someone with host/docker access.

## Privacy notes

- Tools never make network requests; all processing is client-side.
- Feedback submissions are anonymous (no name/email collected). Users identify
  their own submission only by the UUID returned at submit time.
- The SQLite database is stored in a docker volume, not committed to the repo.