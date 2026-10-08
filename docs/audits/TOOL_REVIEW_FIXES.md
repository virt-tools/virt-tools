# Tool Review Fixes

This historical report records confirmed defects fixed during tool reviews. Counts
and verification results reflect the workspace at the time of each fix.

## 2026-10-08 catalog UI and correctness pass

Scope: 3,416 retained source pages, of which 1,739 are public. The initial
browser pass flagged 155 public pages for startup failures, missing control
names, horizontal overflow, or non-finite default results. All 155 passed
targeted rechecks after corrections. A broader follow-up pass also caught a
shifted-column bug in the food-storage guide. This is a browser baseline and targeted
correctness work, **not** independent mathematical or professional validation
of every tool. Existing quarantine, maturity labels, and pending individual
audit records remain unchanged.

### Confirmed repairs

- Shared layout: shrinkable form/grid tracks, wrapping results and code,
  stacked key/value results on phones, theme-aware legacy color variables,
  correctly clipped hidden file pickers, and keyboard-scrollable fixed-size
  game boards. Wide tables scroll locally instead of widening the page.
- Startup: fixed malformed closing tags in five cipher pages; incorrect
  variables in geometry, matrices, vectors, equation solving, resistor colors,
  Mad Libs, exposure value, and the circle of fifths; an L-system state shadow;
  and attempts to assign the read-only textarea `type` in two inventory tools.
- Accessible controls: corrected malformed placeholder attributes and named
  dynamically generated inputs. The design normalizer now respects `>` inside
  quoted attributes and does not append a second closing bracket. Its new test
  preserves template-variable case and checks idempotence.
- Percentage calculator: repaired percentage-change mode, keyboard submission,
  missing-input errors, zero-denominator handling, and stale results.
- Length converter: corrected computer points/picas, rods/chains, and the
  angstrom input factor; uses one unit table for both input and output; tiny
  nonzero results are no longer rounded to zero.
- All 37 shared converters: reject non-finite results and empty input; identity
  conversion preserves tiny values even in offset units. Temperature tools
  reject values below absolute zero. The new Node tests state one independent
  reference conversion per quantity, rather than relying only on round trips.
- Fraction calculator: scientific notation is parsed exactly with bounded
  BigInts, without recursive conversion through `Number`; negative-zero mixed
  numbers and invalid decimal points are handled; truncated expansions are not
  falsely labelled repeating.
- Loan calculator: simpler payment summary with an expandable full schedule,
  bounded whole-month terms, explicit empty-input errors, stable near-zero
  interest arithmetic, and schedules beyond 360 months.
- Compound-interest pages: monthly contributions no longer become daily or
  annual contributions when frequency changes; zero interest works; the
  equivalent-monthly-rate assumption is explicit. The per-period variant
  rejects fractional years, clears stale results/exports, and guards precision.
- Retirement savings: corrected the employer-match variable that produced
  `NaN` for default inputs; validates finite amounts, age ranges, and numerical
  overflow, with explicit model assumptions. This does not validate tax limits
  or plan rules.
- Statistics: strict numeric tokens, bounded data size, finite results,
  interpolated quartiles, and an explicit unavailable sample deviation for
  one observation. Invalid tokens are no longer silently dropped.
- Dates: correct years below 100, bounded spans, constant-time weekday counts,
  inclusive end dates, and month-end clamping; weekday counts do not account for
  public holidays.
- Ring sizes: replaced incorrect formulas and a string passed to `Math.max`
  with nearest-row GIA reference estimates, explicit supported range and fit
  limitations; removed unsupported regional/ISO equivalence claims.
- PEM viewer: restored the shared shell; literal DOM output, strict Base64,
  bounded input, separate hashes for each block, and stale-request protection.
  The tool explicitly does not establish certificate or key validity.
- Gratitude journal: empty storage no longer causes an infinite streak loop;
  malformed saved JSON does not prevent startup, local dates are used, and
  prompt text uses DOM values. Removed its now-unneeded raw-HTML exception.
- HTML entity reference: displays and copies literal entity names and numeric
  references instead of accidentally decoding them into characters.
- Vectors/matrix multiplication: explicit zero-vector angle/2D-cross errors,
  finite components/results, and bounded integer matrix dimensions.
- Determinants, equation solving, and geometry: reject missing/non-finite
  inputs and overflowing results; distinguish numerical precision from exact
  algebraic certainty.
- XML formatter: validates well-formed input, preserves mixed text, CDATA,
  `xml:space="preserve"`, and a single XML declaration. Minification no longer
  collapses meaningful text spaces; invalid input clears old output. Structural
  indentation changes and input limits are explained next to the controls.
- Food storage: the old four-field data was rendered as five columns, placing
  refrigerated times under pantry storage and notes under freezer storage.
  Replaced it with 22 explicitly sourced cold-storage entries, named fields,
  two condition-labelled results, a link for other foods, and a warning that
  smell/appearance cannot establish safety. Unsourced pantry/produce estimates
  were removed from the tool; their previous contents remain in Git history.

### Reproduce and interpret the checks

Install the Playwright version documented in the operations guide. Start a
local server with `python3 -m http.server 4173 --directory frontend`, then run:

```sh
node tests/catalog_audit.mjs
node tests/tool_correctness.mjs
node tests/formula_workbench_ui.mjs
node tests/unit_converter.test.cjs
python3 -m unittest discover -s tests -p test_design_normalizer.py
```

The catalog audit visits every generated public route at 320px/light and
1280px/dark, checks startup errors, failed local assets, accessible input names,
page overflow, and bounded default actions where populated inputs are present.
It blocks external requests and production API calls. `AUDIT_REPORT` optionally
writes a JSON report; `AUDIT_FROM` rechecks failures in an earlier report, and
`AUDIT_SLUGS` limits a run to comma-separated slugs. A scoped run is never a
replacement for the full pass after shared changes.

The numerical browser suite covers the repairs above and all shared converter
configurations. The existing formula checks execute 160 generated formulas and
57 golden vectors; the new formula UI suite checks all examples, golden vectors,
and empty/malformed/overflow inputs with stale-result handling. Existing
browser/UI suites cover discovery and eight
responsive/theme combinations. Full static checks still cover retained legacy
and quarantined source pages. None of these tests exhausts every interactive
state, file format, browser, or specialized domain assumption. The existing
individual audit ledger remains the source for unfinished detailed reviews.

Final verification for this pass:

- Full public-catalog scan: 1,739 routes, mobile/light and desktop/dark layouts,
  plus 220 populated default actions. Its one remaining finding was the food
  storage display; after correction, all 11 final changed-page rechecks passed.
  No shared layout changes were made after that full scan.
- Focused browser correctness regressions passed, including all 37 shared
  converter configurations and all 22 revised food-reference entries.
- Formula UI: 160 examples, 57 golden vectors, and 480 invalid-input/stale-result
  checks passed, in addition to the isolated formula-function checks.
- Catalog, routes, design, conversion consolidation, formula generation,
  browser security, risk policy, operations, and JavaScript syntax checks passed.
- 38 host Python tests and 9 containerized feedback API tests passed.
- The updated local browser smoke runner passed against a disposable
  SEO-generated copy, including discovery, eight viewport/theme combinations,
  shared-converter checks, and the focused correctness regressions. All eight
  pre-existing Farkle unit tests also passed.
- These are local results. No commit, push, or production deployment was made
  by this audit; pre-existing Farkle work was preserved.

### Primary references used for targeted numerical checks

- [NIST SP 811 conversion factors](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b8)
  for SI/customary conversions; typography explicitly uses computer points and picas.
- [CFPB monthly loan payment example](https://www.consumerfinance.gov/ask-cfpb/how-do-mortgage-lenders-calculate-monthly-payments-en-1965/)
  as an independent amortization sanity check, not a claim of loan suitability.
- [R quantile documentation](https://www.stat.ethz.ch/R-manual/R-devel/library/stats/html/quantile.html)
  for the explicitly selected type-7 quartile convention.
- [GIA ring-size chart](https://4cs.gia.edu/en-us/blog/how-to-determine-ring-size-tips-and-ring-size-chart/)
  for approximate chart lookups, not universal equivalence between brands.
- [FoodSafety.gov cold-storage chart](https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts)
  and [FDA storage guidance](https://www.fda.gov/consumers/consumer-updates/are-you-storing-food-safely)
  for the revised, condition-specific food-storage reference.

## Registry integrity and broken catalog routes

- Found 1,366 registry entries for 1,287 tool pages. Seventy-six slugs were
  duplicated, several appended objects were malformed, and `css-wizard`,
  `csv-to-json`, and `regex-tester` pointed to pages that did not exist.
- Deduplicated the registry by retaining the newest complete definition and
  removed entries without implementations. The catalog now has exactly 1,287
  unique entries for 1,287 existing pages.
- Added `scripts/validate_tools.py` and made the web image run it before SEO or
  sitemap generation. Future builds now fail on duplicate slugs, malformed or
  incomplete registry objects, missing pages, unregistered pages, incomplete
  HTML documents, and missing local script/stylesheet assets.
- Verified with a no-cache Docker Compose build: registry validation processed
  1,287 pages, SEO processed 1,287 pages once each, and the sitemap contained
  1,289 URLs (tools plus home and feedback). Docker image pruning reclaimed
  0 B.

## JSON to TOML converter was truncated

- `frontend/tools/json-to-toml/index.html` ended in the literal text
  `...[truncated]` in the middle of `valueToToml`; it had no working conversion
  handler and lacked closing script, main, body, and HTML tags.
- Replaced the incomplete code with a complete JSON-to-TOML converter covering
  escaped strings and keys, primitive arrays, nested tables, arrays of tables,
  finite-number validation, null rejection (TOML has no null type), readable
  errors, and output rendering. Restored the shared application script and a
  complete HTML document.
- Updated local-asset validation to ignore example markup generated inside
  inline scripts, avoiding false missing-file reports from tools such as the
  favicon generator.

## Automated JavaScript coverage

- Added `scripts/validate_javascript.mjs` and a dedicated Node build stage that
  syntax-checks every inline tool script and non-vendored standalone JavaScript
  file. JavaScript syntax failures now stop the container build before deploy.
- Linked a success marker from that stage into the SEO stage; without an
  explicit dependency BuildKit skipped the otherwise unused validation stage.

## Crossword Maker preset prevented all JavaScript from loading

- The Space preset contained the unescaped apostrophe in `Earth's natural
  satellite` inside a single-quoted JavaScript string. This terminated the
  string early, so none of the crossword controls could run.
- Escaped the apostrophe so the preset and the complete tool script compile.

## CSS Alert Generator did not load and trusted message markup

- A stray backtick in the nested animation conditional made the entire script
  invalid, so preview rendering and copy controls never initialized.
- Removed the stray delimiter and HTML-escaped the user-provided message before
  inserting the generated alert into the live preview. Message text can no
  longer inject markup or script into the page or copied component.

## CSS Avatar Stack grid mode broke the complete tool

- The grid-column expression had unbalanced parentheses and concatenation,
  causing a JavaScript parse error before any layout could render.
- Corrected the generated `repeat(N, 1fr)` expression and upgraded copy actions
  to the Clipboard API with a legacy fallback.

## CSS Back-to-Top position preview did not load

- Corrupted mixed quotes in the preview-position conditional ended a string in
  the middle of the expression, preventing all JavaScript from parsing.
- Rebuilt the four-position conditional with consistent delimiters and upgraded
  output copying to the Clipboard API with a legacy fallback.

## CSS Breadcrumb styles broke parsing and preview output

- The pill-style branch closed a JavaScript statement with an object brace
  instead of completing its CSS string. The following `else` therefore caused
  the whole script to fail parsing.
- Completed the CSS rule correctly and stopped placing complete CSS selectors
  in an element's `style` attribute; the preview now applies generated rules
  through a scoped style element.

## CSS Changelog produced invalid JavaScript and CSS

- The changelog-item rule concatenated its border color outside the JavaScript
  string, preventing the script from parsing.
- Corrected that delimiter and kept style-specific declarations inside the
  base `.changelog` rule instead of emitting orphan declarations after its
  closing brace.
- Escaped editable version/date text before preview insertion and upgraded copy
  actions to the Clipboard API with a legacy fallback.

## CSS Chat Bubble gradients and tails were broken

- Misplaced parentheses in the gradient conditional stopped the script from
  parsing. Corrected both gradient strings and their closing parentheses.
- The tail CSS was calculated and discarded, so Tail mode showed no tails.
  Added sent/received pseudo-element rules to both preview and copied CSS.
- Escaped user messages in copied HTML and upgraded output copying to the
  Clipboard API with a legacy fallback.

## CSS Comparison Table could not parse and ignored layout styles

- A gradient string closed before its second color, leaving a raw color token
  in JavaScript and preventing the tool from loading.
- Corrected the gradient, applied the selected theme background, and made Card
  and Minimal produce meaningfully different border/radius/shadow output.
- Upgraded output copying to the Clipboard API with a legacy fallback.

## CSS Copy Button had five broken style branches

- Every style branch had an unterminated CSS string, and the Gradient branch
  also closed its color string before the fallback color. The tool could not
  parse regardless of the selected style.
- Corrected all five branches and the gradient output. Escaped the editable
  button label, serialized the copied-feedback label safely into generated
  JavaScript, and upgraded output copying with a legacy fallback.

## CSS Emboss Text Gold preset broke the whole generator

- The Gold shadow loop omitted the closing call parenthesis, so no preset could
  initialize. Corrected the alternating gold-layer expression.
- Escaped editable text before preview/copy output, added border-box sizing to
  prevent the 100%-wide padded preview from overflowing, and upgraded copying
  with a legacy fallback.

## CSS Eyeball generated code terminated its own script

- The generated snippet embedded literal multiline text in a single-quoted
  JavaScript string and contained a literal closing script tag, which also
  terminated the tool's own HTML script element early.
- Rebuilt the snippet with a template literal and an HTML-safe escaped closing
  tag. Rebuilds now remove prior mouse handlers and wander intervals, preventing
  accumulating listeners/timers as controls change. Copying uses the Clipboard
  API with a legacy fallback.

## CSS Image Compare embedded invalid multiline JavaScript

- Generated drag code was stored as a single-quoted string containing literal
  newlines, preventing the generator itself from parsing.
- Rebuilt it as a template literal, added touch scroll prevention during an
  active drag, and used an abortable listener group so every control update
  removes the prior window-level drag handlers instead of accumulating them.
- Replaced a double-backslash/single-quote sequence in the generated handle
  pseudo-element with an unambiguous `content:""` declaration; the former still
  terminated its surrounding JavaScript string.
- Escaped editable labels in HTML output and upgraded copying with a fallback.

## CSS Noise Overlay had unbalanced generated-CSS delimiters

- The generated pseudo-element/animation CSS was assembled through fragile
  quoted fragments that left the function syntactically unbalanced.
- Rebuilt the CSS with template literals, expanded the animated overlay beyond
  clipped edges, and wrapped sample content so its z-index rule actually works.
- Closed the non-animated branch, whose missing JavaScript brace was the final
  source of the reported end-of-input parser failure.
- Dots mode now generates a real repeating dot texture instead of another
  turbulence filter. Copying uses the Clipboard API with a legacy fallback.

## CSS Pagination broke while assembling active-page styles

- A stray quote and statement semicolon split the active-page concatenation,
  so the entire script failed to parse.
- Rebuilt the active/inactive style expression, prevented the solid active
  background from overriding Gradient mode, synchronized Current Page's maximum
  with Total Pages, and removed a redundant preview render.

## CSS Ripple Pond Ocean mode broke parsing

- The Ocean gradient string terminated before its second color, leaving a raw
  color token in JavaScript and disabling every preset.
- Corrected the gradient, clamped invalid ripple counts to the documented 1–10
  range, and upgraded copying to the Clipboard API with a legacy fallback.

## CSS Status Indicator left Badge mode unclosed

- The Badge branch never closed its JavaScript block, causing an end-of-input
  parse failure for the whole generator.
- Closed the branch, supplied Badge mode's missing pulse keyframes, made Dot
  mode distinct from Icon+Text, and made the preview render the exact generated
  HTML/CSS so pulse animations are visible. Simplified event selection and
  upgraded copying with a legacy fallback.

## CSS Tag Gradient and removable controls were broken

- The Gradient string ended before its fallback color, leaving a raw color
  token that prevented the generator from parsing.
- Corrected the gradient and replaced the decorative removal span with an
  accessible button that actually removes its tag. The preview now renders the
  exact generated HTML/CSS, including working removal behavior, and reports
  clipboard failures.

## CSS Tilt Hover embedded invalid code and used eval

- Its generated interaction code used a multiline double-quoted string and its
  card gradient terminated before the second color, so the tool did not parse.
- Rebuilt the snippet as a template literal, corrected the gradient, replaced
  runtime `eval` with a direct preview initializer, escaped card text, and
  upgraded copying with a legacy fallback.

## CSS Unicorn horn gradient broke parsing and layout

- The horn gradient ended before its gold color, leaving an identifier-like
  color token in JavaScript and preventing the generator from loading.
- Corrected the gradient, gave the generated unicorn explicit dimensions so
  flex centering and leg overflow are laid out consistently, and upgraded
  copying with a legacy fallback.

## Daily Planner declared no valid functions and ignored date selection

- Every declaration was written as `functionname()` instead of `function
  name()`, so parsing stopped at the first function body.
- Corrected all declarations. The date picker now updates planner state instead
  of immediately resetting itself, and local-calendar helpers replace UTC ISO
  conversion and UTC date parsing, avoiding off-by-one days across time zones
  and daylight-saving transitions.
### Drum Machine

- Fixed an unterminated string in the step-highlighting code that prevented the entire drum machine script from loading.
### Focus Timer

- Restored every malformed function declaration (`functionname` instead of `function name`) so presets, countdown controls, session history, completion audio, and ambient sound can load and run.
### HIIT Interval Timer

- Fixed an incomplete nested conditional in the phase-label logic that prevented the interval timer script from parsing.
### Leet Speak Translator

- Repaired the advanced substitution map's misplaced closing braces, which made the entire translator invalid JavaScript.
- Decode substitutions now run longest-first so shorter tokens do not corrupt longer leet sequences.
- Updated copying to use the Clipboard API with a legacy fallback.
### Morse Code Translator

- Rebuilt the corrupted punctuation portion of the Morse map with valid JavaScript and standard International Morse sequences.
- Updated Morse copying to use the Clipboard API with a legacy fallback.
### Percentage Calculator

- Fixed a malformed nested template expression that prevented the calculator script from loading.
- Added explicit zero-denominator validation for percentage-of-total and percentage-change calculations instead of silently substituting a different value or displaying infinity.
### CSS Progress Bar Generator

- Fixed a corrupted template expression that prevented rendering and CSS generation.
- Corrected solid and gradient styles to use the selected style instead of always previewing/exporting a gradient.
- Added working preview keyframes for pulse and animated stripes, kept exported animation names consistent, and clamped numeric values to their advertised ranges.
### Readability Checker

- Fixed a malformed Flesch Reading Ease conditional that prevented the analyzer from loading.
- Corrected the Automated Readability Index formula to use characters per word; it previously used syllables per word and produced invalid ARI scores.
### Tank Volume Calculator

- Fixed an extra parenthesis in the bow-front formula that prevented the calculator from loading.
- Added shape-aware positive-dimension validation so empty, zero, or negative measurements do not produce misleading volumes.
### Text Shadow Generator

- Quoted the `3d` preset key, whose leading digit made the entire generator invalid JavaScript.
- Made the outline preset produce eight distinct surrounding shadows instead of eight identical invisible-offset layers.
- Clamped numeric controls to their advertised ranges and added a clipboard fallback.

## Pre-curation verification

- A final no-cache Docker Compose build completed successfully for both images.
- The JavaScript gate compiled 1,293 scripts without syntax errors.
- Registry validation matched 1,287 unique catalog entries to 1,287 tool pages.
- SEO generation processed all 1,287 tool pages, and sitemap generation produced 1,289 URLs.
- The post-build image prune removed the temporary `node:alpine` image; Docker reported 0 B of remaining reclaimable image data.

## Catalog curation and link preservation

- Added a declarative curation policy and removed 334 retained pages from the
  public registry without deleting their files or breaking their direct URLs.
- Added 18 exact permanent redirects from duplicate routes to registered
  canonical replacements.
- Configured redirects to emit relative `Location` headers so links remain
  correct behind HTTPS proxies and non-default development ports.
- Runtime-tested all 18 redirects for exact 301 destinations and all 316
  retained non-redirected unlisted pages for HTTP 200 responses.
- Before the later tool expansion, the curated build validated 953 registered
  pages and generated a 955-URL sitemap.

## Converter consolidation

- Replaced 1,047 overly specific pair-converter registry entries with 37
  quantity-level converters supporting all compatible From/To selections.
- Preserved every former pair URL with an exact permanent redirect to its
  canonical quantity converter; no legacy page file was deleted.
- Added a shared unit-converter runtime and a mandatory validator covering the
  37 canonical pages, all within-quantity formula round trips, 1,047 legacy
  mappings, and retained source pages.
- The public registry now contains 990 tools. Nginx has 1,065 exact redirects
  when the earlier 18 duplicate-route mappings are included.
- Runtime checks passed for all 37 canonical converter pages and all 1,047
  pair-route redirects with zero failures.

## Full design and accessibility audit

- Audited all 2,371 physical tool pages and added a shared responsive design
  system covering common panels, results, every standard form-control family,
  tables, media, mobile layouts, visible focus, skip navigation, and reduced
  motion.
- Normalized 1,163 pages with missing or implicit structural/accessibility
  semantics, then repaired and guarded an inline-script normalization edge case.
- Added a mandatory all-page design validator. Every tool now has the shared
  stylesheet, language and viewport metadata, a main landmark, an H1, explicit
  button types, and accessible control names.
- Runtime-tested all 2,371 routes and the served design-system stylesheet with
  zero failures.
- Updated registry validation to distinguish intentional unlisting from an
  accidental missing registry entry and to reject missing policy pages,
  self-redirects, unregistered redirect targets, or hidden pages that leak back
  into the catalog.
