# Virtual Tools

A free, privacy-first collection of browser-based utilities at **https://virt.tools**.

Each tool runs entirely in the user's browser — no data is sent to a server. The
only server-side component is the **anonymous feedback** service, which stores
submissions keyed by a UUID so users can check back on status and developer
replies.

## Project layout

```
frontend/              Static site (served by nginx)
  index.html           Ranked, filtered, incrementally rendered catalog
  assets/
    tool-catalog.json  ★ Canonical tool catalog — edit this source
    tool-catalog.schema.json
                       JSON Schema for catalog records and trust metadata
    tools.js           Generated lean browser search index — do not edit
    tool-meta/         Generated small public trust record per listed tool
    app.js             Shared header, catalog, trust UI, local preferences
    formula-workbench.js
                       Shared runtime for generated domain workbenches
    theme-init.js      Early theme bootstrap (applies saved theme before paint)
    style.css          Shared styles (dark/light, with manual override)
  vendor/              Locally vendored libraries (e.g. qrcode.min.js) — no runtime CDNs
  tools/<slug>/        One folder per tool, each with an index.html
  feedback/            Submit + status lookup page
  privacy/             Privacy/trust center and browser storage controls
  service-worker.js    Bounded, privacy-aware offline caching
  manifest.webmanifest Installable-app metadata
api/                   Flask + SQLite feedback service
  app.py               POST /api/feedback, GET /api/feedback/<uuid>
  db.py                SQLite storage layer
  Dockerfile            Non-root Gunicorn production image
scripts/
  generate_tool_catalog.py
                       Validates JSON and generates public browser artifacts
  generate_formula_workbenches.py
                       Validates formula manifest and generates static workbenches
  manage_feedback.py   Offline admin CLI (review / reply / set status)
  backup_feedback.sh   WAL-safe encrypted backup wrapper
  restore_feedback.sh  Verified restore wrapper
nginx/
  nginx.conf           Serves frontend, proxies /api/ to the api service
  Dockerfile
docker-compose.yml     web (nginx) + api, exposed on port 8080
docs/
  OPERATIONS.md        Deployment, privacy, backup and rollback runbook
  RISK_AND_TRUST_POLICY.md
                       Publication rules and review requirements
  audits/              Retained review evidence and audit-ledger instructions
```

Personal AI/editor settings and installed skills are local-only and ignored by
Git; they are not needed to build or run the app. Superseded proposals and
release summaries remain available in Git history.

## Adding a new tool

1. Create `frontend/tools/<your-slug>/index.html` — copy an existing tool folder
   as a starting point so the header, styles and back-link are consistent.
2. Add an entry to `frontend/assets/tool-catalog.json`. Follow
   `frontend/assets/tool-catalog.schema.json`; use conservative `risk` and
   `maturity` values until evidence supports a stronger status.
3. Generate and validate public artifacts:

   ```bash
   python3 scripts/generate_tool_catalog.py frontend
   python3 scripts/validate_tools.py frontend
   ```

`tools.js` and `assets/tool-meta/*.json` are deterministic outputs. Never edit
them directly. Generation applies `tool-curation.json`, so unlisted and redirect
source routes cannot be republished accidentally. The canonical record may be
retained with `listed: false` for review history.

Keep tools client-side. If you need a JS library, vendor it under
`frontend/vendor/` rather than loading from a CDN, to preserve privacy.

Small formula-only calculators are declared in `formula-workbenches.json` and
generated into domain workbenches. Their former routes remain in source and
redirect to the exact replacement formula with `?formula=<legacy-slug>`; do not
hand-edit the generated workbench pages or function assets.

## Maintaining unit converters

The 37 quantity-level converters share `frontend/assets/unit-converter.js`.
Their unit definitions and 1,047 legacy route mappings are recorded in
`generated-conversion-tools.json`. When changing units, update both the manifest
and the corresponding page's embedded `unit-config`, then run:

```bash
python3 scripts/validate_generated_conversions.py .
python3 scripts/validate_tools.py frontend
```

The one-time converter migration scripts have been retired. Preserve legacy
route mappings and retained source pages; the build omits redirect-source and
unlisted pages from the runtime image while nginx preserves old URLs through
exact redirects. See [the operations guide](docs/OPERATIONS.md) for deployment details.

## Catalog and search architecture

The canonical catalog stores domain category, subcategory, tags, aliases, risk,
maturity, review date, method, sources, and test cases. Internal risk
classifications enforce curation and quarantine but are omitted from public
cards, metadata, and HTML. Search ranks exact names, aliases, tags, domains,
descriptions, and small typo matches before rendering a bounded result window.
Domain and review-status filters operate on data, not on thousands of
pre-rendered hidden cards.

Tool pages load one small generated metadata document for their own route. The
shared shell uses it to show review status, methodology/source coverage,
plain-language verification guidance when warranted, favorites, related public
tools, and a prefilled issue link. Quarantined entries have no public metadata
document.

## Offline support

The service worker pre-caches the shared shell only. It uses network-first HTML
for a bounded set of visited tool pages and a bounded static-asset cache. It
does not cache API or feedback routes, arbitrary query URLs, the canonical
catalog, or every tool page. Users can inspect and clear these caches from
`/privacy/`.

## Running locally with Docker

```bash
docker compose build --pull
docker compose up -d --no-build
```

Then open http://localhost:8080.

## Development checks and documentation

GitHub Actions workflows and scheduled Dependabot updates are disabled.
Run checks locally before a release; core checks include:

```bash
python3 scripts/generate_tool_catalog.py frontend --check
python3 scripts/generate_formula_workbenches.py --check
python3 scripts/validate_tools.py frontend
python3 scripts/validate_generated_conversions.py .
node scripts/validate_javascript.mjs frontend
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

API tests require the pinned dependencies in `api/requirements.txt`. Shared
design checks live in `scripts/validate_tool_design.py`; the repeatable markup
normalizer is `scripts/normalize_tool_design.py`. Browser suites remain available
through `bash scripts/run_browser_smoke.sh`; setup and the full manual release
checklist are in [the operations guide](docs/OPERATIONS.md#release-checks).

Use [the operations guide](docs/OPERATIONS.md) for production releases and rollback,
[the risk policy](docs/RISK_AND_TRUST_POLICY.md) for publication requirements,
and [the audit guide](docs/audits/INDIVIDUAL_TOOL_AUDIT.md) for review evidence and
ledger maintenance. Automated validation does not imply every tool has been
individually reviewed.

For the catalog-wide UI baseline and targeted calculation regressions, see the
[2026-10-08 audit evidence](docs/audits/TOOL_REVIEW_FIXES.md#2026-10-08-catalog-ui-and-correctness-pass).
The full browser pass is `node tests/catalog_audit.mjs` against a local server;
focused regressions are `node tests/tool_correctness.mjs` and
`node tests/unit_converter.test.cjs`. These are local checks, not GitHub workflows.

## Reviewing feedback (offline, developer only)

The admin tool runs inside the `api` container so it reads the same data volume:

```bash
docker compose exec api python /app/scripts/manage_feedback.py list
docker compose exec api python /app/scripts/manage_feedback.py show <uuid>
docker compose exec api python /app/scripts/manage_feedback.py reply <uuid> --status completed --text "Shipped!"
```

The canonical lifecycle is `received` → `reviewing` → `planned` → `resolved` →
`closed`. Legacy terminal values `completed` and `rejected` remain supported so
existing records and automation are not silently rewritten. There is no public
admin endpoint — submissions are only readable by someone with host/docker
access.

## Privacy notes

- Tool inputs and calculations stay client-side. The shared shell may request
  static assets and the small public trust record for the current route, but it
  does not include tool inputs in those requests.
- Feedback submissions are anonymous (no name/email collected). Users identify
  their own submission only by the UUID returned at submit time.
- The SQLite database is stored in a docker volume, not committed to the repo.
- Feedback endpoints use strict JSON validation and privacy-preserving rate
  limiting; raw client addresses and UUID lookup paths are not retained in
  application access logs.

See [the operations guide](docs/OPERATIONS.md) for health probes, encrypted backup and
restore, container controls, local release checks, and zero-downtime blue-green deployment
and rollback.
