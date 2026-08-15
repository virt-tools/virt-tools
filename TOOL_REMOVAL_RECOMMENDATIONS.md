# Tool Removal and Consolidation Recommendations

No tool page has been deleted. Approved candidates may be unlisted or redirected
as described below; the remaining items are a recommendation backlog.

## Implementation status

The approved first curation pass is now applied through `tool-curation.json`:

- 334 low-value, duplicate, or higher-risk pages are removed from the public
  registry but retained on disk, so existing direct links still resolve.
- 18 true duplicate routes permanently redirect to a registered canonical
  replacement.
- CSS and audio pages without a genuine consolidated workbench remain at their
  original URLs instead of being redirected to an unrelated placeholder.
- The curation pass initially left 953 registered tools. An experimental
  pair-converter expansion was subsequently consolidated into 37 quantity-level
  converters. The current public catalog contains 990 registered tools, while
  all former pair URLs permanently redirect to their canonical quantity tool.
  After two approved 100-tool additions, the current public catalog contains
  1,190 registered tools and 2,571 physical pages. A validator enforces the
  distinction between registered, intentionally unlisted, and redirected
  routes.

The recommendations below remain useful as the design backlog for eventual
workbenches and later redirect migrations. No tool page was deleted.

## Decision criteria

A tool is a removal or consolidation candidate when it meets several of these:

- It is a static visual demo rather than a reusable utility.
- Its functionality differs from another tool by only one preset or CSS rule.
- A single workbench could cover dozens of pages with less duplicated code.
- The result is hard-coded, misleadingly precise, jurisdiction-dependent, or
  likely to become stale.
- The maintenance and testing cost is disproportionate to likely user value.
- The catalog already has a clearer tool serving the same intent.

## Highest-priority recommendation: retire standalone novelty CSS pages

There are still **288 physical `css-*` pages**, although the curation pass leaves
only 13 in the 1,190-tool public registry. Most retained direct routes repeat the
same control-to-preview-to-copy scaffold and differ only in a short HTML/CSS
template. They remain a disproportionate maintenance burden even though they no
longer dominate public catalog search.

Recommended direction: replace the 288 standalone pages with a small set of
maintained workbenches, migrate useful presets into those workbenches, redirect
valuable old routes, and then remove the standalone pages.

Suggested consolidated tools:

1. CSS layout workbench: Flexbox, Grid, columns, masonry, positioning, scroll
   snap, object-fit, and clamp.
2. CSS component builder: buttons, inputs, navigation, tabs, pagination,
   accordions, modals, tables, cards, alerts, badges, tooltips, and forms.
3. CSS animation workbench: keyframes, transforms, transitions, loaders,
   reveals, scrolling effects, and reduced-motion output.
4. CSS text effects: shadows, strokes, clipping, gradients, truncation, and
   animated text.
5. CSS backgrounds and decoration: gradients, patterns, borders, shadows,
   noise, shapes, ribbons, and dividers.
6. CSS data display: progress, gauges, charts, counters, ratings, status, and
   skeletons.
7. CSS formatter/minifier/validator reference tool.

Keep as independent utilities only where the task has substantial general logic:

- `css-beautifier`, `css-formatter`, `css-minifier`
- `css-specificity-calculator`
- `css-named-colors`
- `css-clamp-generator`
- `css-flexbox-generator`, `css-grid-generator` (until replaced by the layout
  workbench)
- `css-animation-generator`, `css-loader-generator` (until replaced by the
  animation workbench)
- `css-pattern-generator`, `css-gradient-border`, `css-mesh-gradient` (until
  replaced by the backgrounds workbench)

Recommend retiring or absorbing **all other `css-*` routes**, especially these
low-utility novelty groups:

- Decorative objects/characters: `css-book`, `css-burger`, `css-cake`,
  `css-candle`, `css-cassette`, `css-castle`, `css-cocktail`, `css-coffee-cup`,
  `css-crown`, `css-crystal`, `css-donut`, `css-dragon`, `css-envelope`,
  `css-eyeball`, `css-fairy`, `css-flower`, `css-gameboy`, `css-house`,
  `css-ice-cream`, `css-jack-o-lantern`, `css-knight`, `css-mermaid`,
  `css-mood-ring`, `css-mountain`, `css-ninja`, `css-orbit`, `css-petals`,
  `css-phoenix`, `css-pizza`, `css-pyramid`, `css-robot`, `css-snow-globe`,
  `css-solar-system`, `css-sundial`, `css-sushi`, and `css-unicorn`.
- Highly specific ambient effects: `css-aurora`, `css-bubbles`, `css-confetti`,
  `css-crt-screen`, `css-dot-walker`, `css-fireworks`, `css-galaxy`,
  `css-hologram`, `css-holographic`, `css-lava-lamp`, `css-lightning`,
  `css-matrix-rain`, `css-neon-flicker`, `css-rain`, `css-rainmeter-widget`,
  `css-ripple-pond`, `css-snowfireworks`, `css-spotlight`, and `css-starfield`.
- Single-component variants that belong in the component builder: all
  `css-alert*`, card, badge, breadcrumb, button, chat, cookie, CTA, dropdown,
  empty-state, FAQ, footer, form, hero, input, modal, navbar, notification,
  pagination, popover, profile, radio-card, search, snackbar, social, status,
  stepper, table, tabs, tag, testimonial, and upload pages.
- One-animation pages that belong in the animation workbench: bounce, float,
  glow, heartbeat, magnetic, marquee, ripple, rotate, shake, shimmer, shine,
  stagger, swing, ticker, and reveal variants.

## High-priority consolidation outside CSS

### Audio tools

Consolidate the many one-operation pages into an **Audio Workbench** with an
effect chain, preview, undo, and export. Candidate standalone routes include:

- `audio-chorus`, `audio-compressor`, `audio-delay`, `audio-distortion`,
  `audio-equalizer`, `audio-fade`, `audio-noise-reducer`, `audio-normalize`,
  `audio-pan`, `audio-pitch-shift`, `audio-reverb`, `audio-reverser`,
  `audio-speed-changer`, and `audio-volume-booster`.
- Merge structural operations into one editor: `audio-concat`, `audio-merger`,
  `audio-splitter`, `audio-trimmer`, `audio-loop`, `audio-silence`,
  `audio-stereo-merge`, `audio-stereo-split`, and `audio-stereo-to-mono`.
- Merge analysis views: `audio-analyzer`, `audio-freq-analyzer`,
  `audio-spectrogram`, `audio-visualizer`, and `audio-waveform`.

Keep format conversion, recording, metadata inspection, and a consolidated
editor/analyzer as discoverable entry points.

### Duplicate or near-duplicate routes

Choose the better implementation, redirect the weaker route, and remove it
after usage/SEO review:

- `line-sorter` / `sort-lines`
- `bitwise-calc` / `bitwise-calculator`
- `coffee-ratio` / `coffee-ratio-calculator`
- `compound-interest` / `compound-interest-calculator`
- `border-radius` / `border-radius-generator`
- `qr-generator` / `qr-code-generator`
- `placeholder-image` / `placeholder-image-generator`
- `cron-generator` / `crontab-generator`
- `unit-converter` / `all-units-converter`
- `cooking-converter` / `cooking-measurement-converter`
- `binary-text` / `binary-translator` / `text-binary-converter`
- `url-encoder` / `url-encode-decode`
- `markdown-preview` / `markdown-previewer`
- `html-beautifier` / `html-formatter`
- `js-beautifier` / `js-formatter`
- `sql-beautifier` / `sql-formatter`
- `json-path` / `json-path-finder`

## Remove or redesign potentially misleading tools

These are not necessarily useless, but their current category carries a higher
accuracy, safety, or maintenance burden than ordinary local utilities.

- Jurisdiction/year-dependent finance estimates: `income-tax-estimator`,
  `estate-tax-calculator`, `capital-gains-calculator`, `paycheck-calculator`,
  `property-tax-calculator`, `social-security-calculator`, and
  `cost-of-living-comparison`. Remove unless assumptions, jurisdiction, source
  data, tax year, and update ownership are explicit and tested.
- Health/safety outputs: `bac-calculator`, `ideal-weight`,
  `pregnancy-due-date`, `ovulation-calculator`, `heartrate-zone`,
  `macro-calculator`, and `water-intake-calculator`. Prefer removing or clearly
  redesigning as educational estimates with limitations and authoritative
  sourcing; do not present them as medical or safety decisions.
- Location/time-dependent tools such as `moon-phase-calculator`,
  `solar-time-calculator`, and `timezone-converter` should stay only if timezone,
  coordinates, daylight-saving behavior, and date boundaries have strong tests.

## Lower-priority catalog cleanup

- Consider moving games, quizzes, decorative generators, and novelty simulators
  into a separate “Playground” site/section so utility search results are not
  diluted.
- Remove static “cheatsheet” pages when they merely duplicate maintained
  official documentation; outbound links to primary references age better.
- Prefer one extensible calculator per domain over many calculators that differ
  only by a formula and two inputs.

## Safe removal process

Before deleting any candidate:

1. Compare traffic, inbound links, feedback, and search impressions.
2. Select a maintained replacement and preserve any genuinely unique preset.
3. Add route redirects and canonical links before removing catalog entries.
4. Add regression tests for the consolidated replacement.
5. Remove the page and registry entry together, rebuild, validate the sitemap,
   and retain redirects long enough to avoid broken bookmarks.
