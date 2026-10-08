# Stabilization Release Summary

Date: 2026-08-20

## Outcome

This release turns the repository from a large collection of loosely indexed
static pages into a generated, risk-aware catalog with consolidated converter
and formula families, stricter browser/API security, reproducible assets,
production container controls, backups, and a blue-green deployment path.

No source tool page was deleted. Unsafe pages and compatibility sources are
retained for evidence and rollback while curation and the runtime build prevent
them from being presented as ordinary public tools.

## Catalog, consolidation, and tool fixes

- Established `frontend/assets/tool-catalog.json` as the canonical catalog with
  schema-validated names, descriptions, categories, aliases, risk, maturity,
  method, source, test, review, and listing metadata. The browser search index
  and per-tool public metadata are deterministic generated artifacts.
- Added ranked, bounded catalog rendering plus domain and review-state filters.
  Internal risk classifications enforce quarantine without appearing as public
  taxonomy; tool pages show plain-language verification guidance only when
  warranted, alongside methods/sources, related tools, favorites, and a
  prefilled issue path.
- Preserved 3,416 physical pages and 1,999 canonical catalog records while
  exposing 1,739 current public tools. Declarative curation unlists
  quarantined/low-value sources and preserves 214 exact canonical redirects.
- Consolidated 1,047 pair-specific unit routes into 37 quantity-level
  converters with common From/To selection, swapping, finite conversion, and
  round-trip/redirect validation.
- Consolidated 160 small calculators into nine generated domain workbenches:
  geometry, physics/astronomy, finance, construction/materials,
  workshop/crafts, recreation, environment/fluids, photography, and audio.
  Former formula routes retain exact intent through `?formula=<legacy-slug>`.
- Corrected known formula defects and ambiguities, including stable zero and
  near-zero annuities, exact whole-unit break-even handling, geometry/domain
  guards, current physical constants, clearer rate/unit conventions, staircase
  geometry, wallpaper/brick/roofing quantity semantics, and expanded bolt-circle
  output. Inputs now have explicit finite bounds and generated golden fixtures.
- Added 57 manifest-authored golden vectors plus a generated example smoke for
  each of the 160 retained formulas. The Docker/CI Node gate executes generated
  JavaScript in a VM and checks parity and whole-unit rounding boundaries.
- Kept 22 under-specified industrial, projectile, rocketry, pneumatic, and pump
  formulas excluded rather than publishing unsafe simplifications.
- Preserved the two completed 100-tool cohorts. The second cohort received 100
  explicit one-page audit records; its parser, graph, date/time, media, import,
  export, formula, accessibility, theme, responsive-layout, and bounded-input
  fixes are itemized in `SECOND_WAVE_INDIVIDUAL_AUDIT.md`.
- Corrected `moon-phase` into an honestly scoped mean-cycle estimator with
  deterministic wall-time parsing, fixed-offset handling (including fractional
  offsets), 1900–2100 bounds, selected-offset event labels, accessible status,
  and a U.S. Naval Observatory comparison warning.
- Kept exact duplicate/alias routes pointed at maintained canonical tools. CSS
  novelty pages remain source-retained and mostly unlisted pending real
  workbench replacements; no generic placeholder redirects were introduced.

Detailed earlier page-level repairs remain in `TOOL_REVIEW_FIXES.md`. Current
consolidation and future-removal guidance is in
`TOOL_REMOVAL_RECOMMENDATIONS.md`.

## Risk and audit evidence

- Added a release-enforced high/critical risk policy covering 96 tools.
  Quarantined tools must be unlisted and absent from the pruned runtime tree
  while remaining in source.
- Added conservative trust states. Missing evidence defaults to experimental or
  unreviewed; a disclaimer cannot promote a consequential tool.
- Refreshed `individual-tool-audit.json` after all generated pages existed and
  added idempotent second-wave evidence synchronization with page-existence and
  exact-count checks.
- The audit ledger now reports 3,293 pending, 7 findings, 15 fixed, and 101
  rechecked pages (123/3,416, or 3.60%, with a recorded outcome). It does not
  claim that all tools were audited.
- Direct audits placed `bmi-calculator`, `wire-gauge-calculator`,
  `beam-deflection-calculator`, `solar-time-calculator`, and
  `timezone-converter` in `findings` with concrete defects and references.
  `moon-phase` is rechecked with its approximation limits recorded. The legacy
  `moon-phase-calculator` redirect source remains pending.
- A release review also quarantined `speech-to-text` and `text-to-speech`:
  browser Web Speech recognition and network-backed synthesis voices can send
  audio or text to vendor services, contradicting unconditional local-only
  claims.

## Browser privacy and security

- Added a local privacy/trust center, installable manifest, and explicit cache
  controls.
- Added a bounded service worker: shell assets are limited, visited pages use a
  bounded network-first cache, static assets use bounded caches, and feedback,
  API, catalog, metadata, and arbitrary query URLs are excluded.
- Replaced the old hard-coded cache version with one deterministic build hash
  shared by HTML asset URLs and the service worker. The hash includes the
  precached shell HTML, manifest, and icon, and cache writes/trimming are kept
  alive through completion. Changed shell/assets therefore create new cache
  namespaces; identical inputs remain reproducible.
- Added a browser-security policy and malicious-input validation gate covering
  remote dependencies, executable sinks, unsafe dynamic markup patterns,
  unbounded storage/parser behavior, and reviewed exceptions.
- Removed internal risk taxonomy from the public filter, cards, trust badges,
  HTML metadata, browser registry, and per-tool JSON. Canonical classifications
  still enforce quarantine; 643 public tools—including six formula
  workbenches and tools in consequential domains—receive action-focused,
  domain-specific verification guidance, while low-consequence tools receive
  no generated risk notice.
  Guidance is embedded in generated HTML as well as per-tool JSON so it remains
  available offline or when the metadata request fails.
- Added CSP, referrer, MIME-sniffing, framing, permissions, cross-origin, and
  cache headers at nginx. API responses are always `no-store`, and bearer UUID
  lookup paths are excluded from access logs.
- Production images remove every explicit unlisted and redirect-source page
  from a disposable build tree. Source history and exact nginx redirects remain
  intact.

## Feedback API and data durability

- Replaced permissive request parsing with strict JSON-object validation,
  duplicate/unknown-field rejection, type/control-character checks, finite
  standard JSON, and nginx/Flask body limits.
- Added strict UUIDv4 lookup validation and one consistent seven-state feedback
  lifecycle across the API, database guard, UI, and offline management CLI.
- Added persistent privacy-preserving rate limits. Client addresses are HMACed
  with a secret stored in the protected feedback database (or supplied by a
  mounted secret); raw addresses are not stored.
- Enabled SQLite WAL, busy timeouts, atomic transactions, database-aware
  readiness, process-only liveness, bounded retention cleanup, and Gunicorn
  worker recycling.
- Added authenticated encrypted backups using a WAL-safe online snapshot and an
  encrypt-then-MAC envelope. Restore verifies authentication and SQLite
  integrity before replacement, creates a rollback snapshot, atomically swaps
  the database while writers are stopped, and restarts the API on failure.

## Containers, deployment, and CI

- Pinned base images and Python dependencies, removed build tooling from runtime
  images, and run nginx/API as unprivileged users.
- Added read-only roots, bounded writable tmpfs mounts, dropped capabilities,
  `no-new-privileges`, process/memory/CPU/file limits, health checks, graceful
  stops, and bounded local logs. The API is internal-only in standard Compose.
- Added deterministic asset versioning, immutable caching only for validated
  version queries, gzip, dynamic Docker DNS re-resolution, and runtime-tree
  pruning.
- Added a stable-edge blue-green deployment workflow. It builds and validates
  the inactive slot while the active slot remains online, switches a small
  upstream file atomically, reloads nginx, retains the old slot for rollback,
  and serializes operations with a lock.
- Added CI for canonical catalog/formula/conversion/design/risk/browser-policy
  validation, API and backup tests, browser smoke tests, production builds,
  dependency auditing, container vulnerability scanning, and public-edge
  header verification.
- Added a restricted `.dockerignore` allowlist so local databases, backups,
  runtime selector state, caches, and unrelated workspace files do not enter
  build contexts.

## Known residuals and follow-up

- **Individual review remains incomplete:** 3,293 pages are still `pending`.
  Automated syntax/design checks are broad release gates, not substitutes for
  page-specific functional or qualified domain review.
- **Seven direct findings remain quarantined:** BMI, wire gauge, beam
  deflection, solar time, timezone conversion, speech recognition, and speech
  synthesis require implementation/disclosure work and recheck before
  relisting.
- **Consequential tool groups remain quarantined:** structural/lifting, fire and
  life safety, PPE, industrial process, projectiles/rocketry, electrical
  protection, health estimates, diving, and climbing require qualified review.
- **Formula workbenches remain draft:** generator checks and authored golden
  vectors do not constitute independent professional review. The 22 exclusions
  must stay excluded until their missing model inputs and safety scope are
  resolved.
- **Moon phase is approximate:** sampled 2026 primary phases can differ from
  USNO ephemerides by about 17.6 hours. Fixed offsets do not model daylight
  saving time; the tool is not for navigation, tides, eclipses, or precise
  observation.
- **CSP migration is incomplete:** legacy inline script/style usage still
  requires `unsafe-inline`, and local WebAssembly requires narrowly scoped
  `wasm-unsafe-eval`. Moving inline code to static assets would tighten policy.
- **CSS/audio consolidation is incomplete:** 288 CSS pages remain in source and
  audio media operations still need dedicated editor/analyzer workbenches.
- **TLS terminates at the existing reverse proxy:** the supplied stable edge
  intentionally serves HTTP on the private origin, while the production site
  is exposed as `https://virt.tools`.
- **Schema changes must remain backward compatible** while blue and green slots
  share the feedback volume. A restore intentionally stops both writers.
- **Browser coverage is representative, not exhaustive:** the pinned Chromium
  smoke suite passed against both deployed slots, but it does not replace
  page-specific functional testing for the 3,293 tools still pending review.

## Verification snapshot

A passing check validates only its stated scope.

- Audit sync rerun: passed with zero additional promotions; verified 100 unique
  second-wave slugs/pages and exact ledger totals.
- Formula gate: 160 formulas, nine workbenches, 160 intent-preserving redirects,
  and 22 exclusions passed.
- Risk gate: 96 quarantined tools and all 3,416 ledger page records passed.
- Conversion gate: 37 canonical converters, 1,047 legacy redirects, and 1,739
  public tools passed.
- Catalog gate: 1,999 canonical entries and 1,739 public tool pages passed.
- Design/accessibility baseline: all 3,416 tool pages passed.
- Browser-security gate: 3,420 HTML files, 29 sink-free reviews, 20 pinned
  exceptions, 18 non-vendor scripts, and 10 malicious fixtures passed.
- Operational invariant gate, shell syntax checks, both slot/edge Compose
  renders, and Python compilation passed.
- Node validated 2,345 tool scripts. The formula VM exercised all 160 generated
  functions, 57 authored golden vectors, and 160 generated examples; the safe
  math-expression suite passed all 18 assertions.
- The complete production-image Python suite passed 28/28 tests, including 9
  feedback API, 7 authenticated backup/restore, 9 operation-script, and 3
  public risk-presentation boundary tests.
- `git diff --check`: passed.
- Clean production image builds completed successfully. The pinned Playwright
  Chromium smoke suite passed against both slots, and the isolated public-edge
  header test passed.

## Production deployment outcome

The release is publicly deployed at `https://virt.tools`; its reverse proxy
routes to the stable edge at `http://127.0.0.1:8080/`.

- The final active slot is blue. Its release-specific aliases and image IDs
  are `virt-tools-api:release-20260820-870c819dd3a2ff15` at
  `sha256:fa545a518c04c6e3338b84a72064a8d3ae30b07821a161eda0fb8627dba3bd98`
  and `virt-tools-web:release-20260820-870c819dd3a2ff15` at
  `sha256:e17d88fbe01c7fd0806ccce0b2fa750509712a4ec3c78530ec78e6ed1591c4d2`.
  The deterministic HTML/service-worker asset version is
  `870c819dd3a2ff15`.
- The retained green rollback slot is healthy on API image
  `sha256:f6adec93f3ac32060f702340018982c0ebabf7ce1ddcb0d75dbcc1d4127db89f`
  and web image
  `sha256:0d85d3829fb2ec34fc16769f8b95cedd46a729be9d533b28c1987e105a0dfe8f`.
  Rollback in both directions was exercised successfully before the latest
  green-to-blue deployment.
- The stable edge is healthy on pinned digest
  `sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6`.
  Both slot APIs/web servers and the edge report healthy, leaving five healthy
  release containers running.
- A no-cache build/deploy ran under continuous 250 ms homepage and API
  readiness probes: all 334 paired probe cycles succeeded with zero failures
  while the inactive green slot built, started, and received traffic. A later
  blue rebuild added 137 successful pairs, and the taxonomy-free green release
  added another 407 successful pairs. The final resilient-guidance blue release
  added 316 more. These are the measured zero-downtime rebuild results; none of
  the 1,194 paired cycles failed.
- Final public probes returned 200 for the homepage, liveness, readiness,
  geometry workbench deep link, and corrected moon-phase tool. The former
  Heron and moon-phase calculator routes returned exact 301 redirects. A
  quarantined Web Speech page and the pruned canonical catalog returned 404.
  Security/cache headers and the deployed service-worker version were verified.
- Public verification through `https://virt.tools` returned HTTP/2 200 via the
  reverse proxy, readiness `ok`, the expected security headers and formula
  redirect, and service-worker version `870c819dd3a2ff15`. The public homepage
  has no risk filter; deployed card registry, application script, tool HTML,
  and two representative per-tool metadata documents expose no classification
  field or taxonomy labels. Chromium verified that low-consequence pages show
  no generated caution, consequential pages show only neutral verification
  guidance, and that guidance survives malformed/unavailable metadata.
- Both API slots mount `virt-tools_feedback-data` at `/data`. The deployed
  database retained 29 feedback rows and one service-metadata row, remained in
  WAL mode, and passed `PRAGMA integrity_check`.

There was one observed interruption during the first, one-time migration from
the old single-container port owner to the stable edge. After stopping the old
web container, Docker hit a DNS/network-attachment race; the original fallback
also asked the newer Compose model to recreate legacy dependencies and could
not restore it automatically. The captured legacy container was restarted
directly, restoring service. The migration path was then hardened to restart
that exact container and retry the edge startup once. The next migration
succeeded, and the subsequent blue-green no-cache rebuild described above had
zero failed probes. This initial migration incident is distinct from the
validated steady-state rebuild path, but is recorded here as part of the actual
deployment outcome.
