# Tool Review Fixes

This file records confirmed defects fixed during the full tool review. Counts
and verification results reflect the workspace at the time of each fix.

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
