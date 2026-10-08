# Tool Consolidation, Quarantine, and Removal Recommendations

## Decision and safety boundary

**Do not delete any source page as part of the current stabilization release.**
The recommendations below authorize analysis only. Existing source pages,
tests, history, and compatibility routes should remain recoverable until a
separate removal change is approved after replacement parity, traffic, inbound
link, feedback, and redirect review.

The preferred lifecycle is:

1. quarantine or unlist an unsafe/low-value page without deleting it;
2. build and test a genuinely capable canonical replacement;
3. preserve the old intent with an exact permanent redirect or preset query;
4. monitor usage and broken-link telemetry through at least one release cycle;
5. consider source deletion only in a later, explicitly reviewed change.

## Current workspace snapshot

- 3,416 physical tool pages are retained in source.
- The generated catalog currently exposes 1,739 public tools.
- 37 canonical quantity converters cover 1,047 preserved pair-specific legacy
  routes.
- Nine formula workbenches cover 160 retained formulas; 22 unsafe or
  under-specified formulas remain excluded rather than redirected into a
  misleading replacement.
- Declarative curation contains 214 canonical redirects, including 160 formula
  routes and 54 duplicate/compatibility routes.
- There are 288 physical `css-*` pages. Prefix curation keeps only 13 in the
  public catalog; the rest remain in source.

These numbers describe routing and catalog state, not individual audit
coverage. See `INDIVIDUAL_TOOL_AUDIT.md` for the much smaller verified audit
set.

## Priority 0: keep unsafe tools quarantined

Quarantine is a publication decision, not a deletion recommendation. Retain
the implementations as evidence and test fixtures while replacing or reviewing
them.

### Newly confirmed defects

- `wire-gauge-calculator` — keep quarantined at critical risk. It lacks the
  inputs and code context needed for safe conductor sizing, has inconsistent
  table entries, and can recommend an undersized last-row conductor.
- `beam-deflection-calculator` — keep quarantined. Its ideal deflection formulas
  do not establish structural adequacy, yet the page overstates generic
  L/360/L/240 checks and sizing utility.
- `bmi-calculator` — keep quarantined. It mixes pediatric and adult
  interpretation, mislabels imperial and body-composition results, and gives
  poorly bounded intake guidance.
- `solar-time-calculator` — keep unlisted until its angle conversion, civil-date
  handling, polar cases, apparent-horizon model, validation, and formatting are
  corrected against primary reference fixtures.
- `timezone-converter` — keep unlisted until the selected source zone actually
  controls parsing and DST gaps/folds have an explicit tested policy.
- `speech-to-text` and `text-to-speech` — keep unlisted because browser Web
  Speech implementations may use vendor-operated network services, making the
  existing “100% client-side” promises unreliable. Relist only with
  capability-aware disclosure/consent or a demonstrably local implementation.

The corrected `moon-phase` page may remain the canonical low-risk draft because
it now describes itself as a rough mean-cycle estimate. Preserve
`moon-phase-calculator` as an unlisted redirect source; do not infer that the
legacy page was audited.

### Existing risk groups

Continue the source-retaining quarantine for structural/lifting, fire and life
safety, personal protective equipment, industrial process, projectile/rocketry,
electrical protection, health-estimate, diving, and climbing tools recorded in
`tool-risk-policy.json`. Relisting requires a scoped method, primary sources,
strict cross-field validation, independent expected-value fixtures, explicit
limitations, and a qualified domain review. A disclaimer by itself is not a
fix.

## Priority 1: complete CSS consolidation

The remaining standalone CSS pages are the clearest low-value maintenance
burden: 288 source pages repeat nearly identical control/preview/copy code, and
many differ only by a preset or decorative object. Only 13 are public today,
which is a sensible temporary state.

Build a small set of maintained replacements before redirecting old routes:

- **CSS layout workbench** — Flexbox, Grid, positioning, columns, object-fit,
  scroll snap, clamp, and responsive presets.
- **CSS component builder** — buttons, inputs, navigation, cards, tables,
  alerts, badges, tabs, modals, pagination, forms, and states.
- **CSS animation workbench** — keyframes, transforms, transitions, loaders,
  reveals, hover/motion effects, and reduced-motion output.
- **CSS text-effects workbench** — gradients, clipping, strokes, shadows,
  truncation, marquees, and animated text.
- **CSS backgrounds/decorations workbench** — gradients, patterns, borders,
  shadows, shapes, ribbons, dividers, and textures.
- **CSS data-display workbench** — progress, gauges, simple charts, counters,
  ratings, status indicators, and skeletons.

Keep `css-beautifier`, `css-formatter`, `css-minifier`,
`css-specificity-calculator`, `css-named-colors`, and `css-clamp-generator` as
independent utilities. Keep the existing layout/animation/pattern generators
only until equivalent workbench modes and permalinkable presets exist.

Recommended first absorption batch:

- decorative objects and characters such as `css-book`, `css-cake`,
  `css-cassette`, `css-castle`, `css-coffee-cup`, `css-dragon`, `css-gameboy`,
  `css-house`, `css-pizza`, `css-robot`, `css-sushi`, and `css-unicorn`;
- ambient one-offs such as `css-aurora`, `css-confetti`, `css-crt-screen`,
  `css-fireworks`, `css-galaxy`, `css-lava-lamp`, `css-matrix-rain`,
  `css-rain`, and `css-starfield`;
- single-component variants across alerts, badges, buttons, cards, chat,
  cookie notices, CTAs, dropdowns, forms, heroes, inputs, modals, navigation,
  notifications, pagination, tables, tabs, tags, and testimonials;
- one-animation pages for bounce, float, glow, heartbeat, marquee, ripple,
  rotate, shake, shimmer, shine, stagger, swing, ticker, and reveal effects.

Do not redirect these pages to a generic placeholder. Each useful legacy route
should open the matching replacement preset; routes with no useful preset may
remain unlisted until a later removal decision.

## Priority 2: preserve completed converter consolidation

The 37 quantity-level converters are the right canonical layer for the 1,047
pair-specific unit routes. Keep the compatibility map and exact redirects, and
avoid reintroducing one page per unit pair. Add a new unit by extending the
quantity manifest and its round-trip tests, not by creating more pair pages.

Potential later source cleanup should wait for redirect monitoring and should
not remove the manifest that proves old-route coverage.

## Priority 3: preserve and finish formula-workbench consolidation

The nine workbenches are preferable to 160 near-identical formula pages because
they centralize parsing, bounds, assumptions, error handling, and tests. Keep
the workbenches at draft maturity until their domain formulas receive the
individual review claimed by the audit policy.

Do not restore or redirect the 22 excluded formulas merely to improve counts.
Industrial process, projectiles/rocketry, and under-specified equipment formulas
need domain-specific inputs and qualified review first. The original pages
should remain quarantined in source.

## Priority 4: consolidate audio micro-tools by task

There are 40 physical `audio-*` pages, but not all are duplicates. The new
`audio-formula-workbench` covers formulas only and is not a replacement for
media processing.

Recommended canonical tools:

- **Audio editor/effect chain** — trim, split, concatenate, loop, fade, silence,
  normalize, pan, volume, speed, pitch, reverse, delay, reverb, chorus,
  equalization, compression, and distortion with preview/undo/export.
- **Audio analyzer** — waveform, spectrum, spectrogram, levels, frequency, and
  channel inspection with one decode path.
- Keep recording, format conversion, metadata inspection, test-tone generation,
  and advanced audited analysis tools as separate entry points.

Candidate effect/operation routes should redirect only after the replacement
supports the same input formats, controls, export behavior, accessibility, and
bounded-memory handling.

## Priority 5: consolidate structured-data transformations carefully

CSV, TSV, JSON, YAML, TOML, XML, HTML-table, and Markdown-table conversions
share parsing, preview, download, and error-handling infrastructure. A
**Structured Data Workbench** could replace many directional micro-pages with
format selectors, explicit dialect/options, a lossiness report, bounded input,
and safe export.

Do not collapse semantic tools such as JSONPath evaluation, schema validation,
record reconciliation, or migration sequencing into this converter. Do not
claim round-trip fidelity across formats that cannot represent the same types,
ordering, comments, namespaces, or mixed content.

## Priority 6: retain existing exact duplicate redirects

Current duplicate redirects already cover pairs such as `line-sorter` /
`sort-lines`, `bitwise-calculator` / `bitwise-calc`, `coffee-ratio` /
`coffee-ratio-calculator`, `compound-interest-calculator` /
`compound-interest`, `qr-generator` / `qr-code-generator`, `cron-generator` /
`crontab-generator`, `markdown-preview` / `markdown-previewer`, and formatter
aliases for HTML, JavaScript, and SQL.

Keep these redirect sources in the compatibility ledger. New duplicate
decisions should compare implementation quality and user intent, select one
canonical slug, and add a tested exact redirect rather than silently dropping a
route.

## Lower-priority information architecture

- Move games, quizzes, decorative generators, and novelty simulations into a
  clearly labeled Playground so utility search is not diluted.
- Replace thin static cheatsheets with maintained primary-source links when
  their offline value is negligible and their content is likely to become
  stale.
- Prefer configurable workbenches over pages that differ by one preset, one
  formula, or one output unit.
- Use search/usage analytics, feedback, inbound links, and maintenance burden
  before deciding that a specialized but substantial tool is useless. Narrow
  scope alone is not a deletion criterion.

## Required evidence before any future deletion

A removal proposal should name the exact slug, canonical replacement, preserved
preset/query, parity tests, redirect test, catalog and sitemap effect, observed
usage, rollback path, and retention period. It should also confirm that the
source is not the only evidence for a quarantined safety defect. Until that
evidence is reviewed, **unlist or redirect; do not delete**.
