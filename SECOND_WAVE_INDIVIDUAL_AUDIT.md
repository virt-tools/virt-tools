# Second-Wave Individual Tool Audit

## Method

- Scope: the 100 tools in `NEW_TOOL_PROPOSALS_2.md`.
- Assignment: one fresh, independent subagent per tool; no batched audits.
- Each auditor checks functional correctness, edge cases, security and bounded input handling, accessibility, responsive/theme behavior, truthful scope, exports, and JavaScript syntax.
- Auditors may edit only their assigned tool page, fix confirmed findings, and rerun focused fixtures plus repository design and whitespace checks.

## Confirmed fixes

- `dockerfile-linter` — fixed parser-directive and continuation handling; global `ARG` secret checks; finding caps; image tag/digest parsing; stage-user inheritance; external and numeric `COPY --from` validation; retained apt-index detection; JSON command, `HEALTHCHECK`, and `ONBUILD` validation; truthful unknown user state; stale-result clearing; responsive wrapping; and bounded JSON export. Audit totals: 2 high, 6 medium, 2 low.
- `kubernetes-manifest-inspector` — fixed escape-aware YAML parsing, prototype-safe mappings, JSON depth/value caps, image tag classification with registry ports, crash-safe scalar/null container handling, atomic stale-result reset, and keyboard-operable tabs. Audit totals: 2 high, 4 medium, 1 low.
- `terraform-plan-summarizer` — fixed root data-resource module classification, preserved `action_reason` and `replace_paths`, made malformed sensitive-value trees fail closed, validated malformed collections, completed action/unknown/sensitive/dependency metrics, and disclosed truncation. Audit totals: 3 high, 3 medium.
- `webassembly-module-inspector` — capped parser/report amplification; added checked LEB decoding and memory64-safe exports; fixed constant-expression decoding, custom/name section bounds, tag and limits handling, Data Count consistency/order, canonical Base64 checks, and stale/racy resets. Audit totals: 2 high, 4 medium, 2 low.
- `dependency-lockfile-auditor` — corrected pnpm 5/6/9 locator, peer, snapshot and importer resolution; Poetry hash association; npm/Yarn alias/workspace/direct/integrity handling; secret redaction; malformed-map and line caps; ecosystem-normalized findings; stale reset; CSV formula safety; download lifetime; and scope/a11y language. Audit totals: 4 high, 6 medium, 1 low.
- `conventional-commit-validator` — corrected body/footer boundaries, multiline trailers, BREAKING CHANGE parsing, Unicode/grapheme-aware policy rules, line endings and empty batches; isolated user regexes in a timed worker; bounded policies; fixed issue-pattern validation, CSV formula safety, complete exports, theme contrast, and detail/table accessibility. Audit totals: 2 high, 4 medium, 1 low.
- `json-schema-fixture-generator` — made local `$ref` resolution own-property-safe with URI/Pointer decoding and cycle/error handling; bounded subset validation now gates valid fixtures; removed untrusted regex execution; added deterministic verified-invalid fixtures and explicit vocabulary/draft/sibling/limit disclosures; improved a11y and export failures. Audit totals: 3 high, 3 medium.
- `http-transcript-parser` — corrected bodyless response semantics, TE/CL ambiguity and message boundaries, Unicode unframed bodies, bounded header/trailer/framing parsing, folded/control-header findings, body-hex preservation, stale-result clearing, and accessible binary/line-ending disclosures. Audit totals: 8 fixed.
- `database-migration-sequencer` — added strict irreversible parsing and rollback-blocker propagation while preserving independent branches; bounded and validated migrations/edges/CSV; repaired graph/theme output; improved cycle diagnostics and table/scroll accessibility. Audit totals: 2 high, 2 medium, 1 low.
- `fstab-builder` — corrected escape/option normalization, UUID/swap/mount semantics, candidate-first guidance and stale exports; made imports transactional and bounded; added option/source/target/order checks, control/bidi/credential safeguards, export gating, accessible row controls, contrast and mobile layout. Audit totals: 4 high, 6 medium, 3 low.
- `journalctl-query-builder` — preserved commas in field matches; fixed priority and newest-first explanations; validated inactive fields, enums, conflicting modes and imported priorities; added caps; reset import modes; rebuilt current argv before copy/export so invalid edits cannot leak stale commands. Audit totals: 10 fixed across the initial review and recheck.
- `systemd-hardening-analyzer` — corrected continuations, line attribution, repeated/reset directives and drop-in ordering; fixed nuanced DynamicUser/root/boolean/PrivateTmp/capability findings; hardened override paths and retained writable paths; repaired theme, mobile, table and live-output accessibility. Audit totals: 12 fixed.
- `process-resource-limit-planner` — corrected Bash, systemd, Docker and Kubernetes units; preserved soft/hard pairs and request/max separation; removed duplicate/malformed output and unsafe defaults; fixed stale results and caps; added cross-target mismatch warnings and accessible previews/tabs/tables. Audit totals: 3 high, 4 medium, 1 low.
- `inode-capacity-planner` — corrected blank/zero, reserve exhaustion, density, unsafe totals, fractional retention, horizon and tie rounding; enforced file/inode consistency; hardened imports, CSV, stale edits and caps; improved keyboard, table, status and theme accessibility. Audit totals: 19 assertions covering all fixes.
- `boot-timeline-analyzer` — added robust blame/critical-chain variants and ANSI/tree parsing; corrected all supported duration units and overflow; preserved repeated hierarchy; removed invented durations and causal overclaiming; bounded output and hardened units/CSV; improved SVG/table/export accessibility. Audit totals: all scoped findings fixed.
- `network-har-waterfall-analyzer` — corrected SSL/connect timing, RFC 3339/order/end-time handling, and misleading critical-path/cache/redirect/connection claims; added default sensitive-data masking and safe exports; handled malformed records and caps; cleared stale results; improved chart/table/theme/mobile accessibility. Audit totals: zero open after grouped fixes.
- `cors-preflight-simulator` — corrected method normalization, forbidden methods/headers, Range and length safelists, repeated/list header parsing, wildcard/credentials/Authorization rules, 2xx preflight/PNA logic, response exposure, same-origin visibility, redirect uncertainty, stale results, and checkbox/theme/accessibility behavior. Audit totals: zero open after grouped fixes.
- `cookie-scope-simulator` — corrected default/effective Path, Max-Age/expiry/deletion and storage state, ordering, Domain/IP/public-suffix limitations, SameSite fallback, Secure/Partitioned/prefix checks, source lines and CSV safety; improved explicit limitations, theme/mobile/table accessibility. Audit totals: 16 focused assertions.
- `webrtc-sdp-inspector` — hardened m-line, ICE, fingerprint, setup, RTP, simulcast, SCTP and candidate parsing; corrected rejected-section, codec/map/MID/direction/ICE/DTLS/BUNDLE comparisons; cleared stale export state and added non-color severity cues. Audit totals: zero open after grouped fixes.
- `dnssec-chain-inspector` — fixed record ordering/escaping/wrapping/bounds; key-tag and DS digest/class checks; serial-arithmetic RRSIG windows and linkage; canonical NSEC/NSEC3 chain diagnostics; claim boundaries, input/export documentation and accessible tables/themes. Audit totals: 5 grouped fixes.
- `bgp-path-explorer` — corrected AS_SET/confederation parsing and repeat/prepend ambiguity; added strict prefix/community/AS validation; made route-selection comparisons, eliminations, skipped MED, ties and winners explicit; bounded accessible graph and repaired mobile/theme contrast. Audit totals: zero open.
- `dhcp-pool-planner` — corrected canonical CIDR/network/broadcast and /31-/32 handling; exact inclusive range carving and overlap/reservation validation; lease-turnover/headroom/exhaustion math; relay/context overlap severity; stale output, safe export and accessible visuals. Audit totals: 5 grouped fixes.
- `mtu-fragmentation-explorer` — corrected MSS semantics, IPv4/IPv6 fragment sizes/offsets/MF/alignment, protocol/jumbogram ceilings and IPv6 fragmentation rules; added preallocation cap, state resets, safe exports, table/keyboard accessibility and explicit assumptions. Audit totals: zero open.
- `threat-model-workshop` — completed data-flow edit CRUD, cascading deletes and boundary/link guards; stabilized STRIDE/risk links; hardened imports and cycles; preserved qualitative settings and safe exports; fixed dynamic attributes, keyboard tabs, overflow and themes. Audit totals: 5 grouped fixes.
- `cvss-vector-calculator` — corrected CVSS v3.1 Roundup, v3/v4 zero-impact explanations, prototype-safe metric validation, version-specific labels, stale invalid results and clipboard status. Audit totals: official v3.1 and v4.0 score/vector suites passed.
- `source-secret-scanner` — fixed scan cancellation/stale reveals, a global candidate budget, deterministic bounded wildcard matching and credential patterns, stronger short-value and URL masking, fatal UTF-8 decoding, removal of secret digests, CSV formula neutralization, theme/a11y and scope wording. Audit required a second zero-open recheck.
- `saml-assertion-inspector` — hardened XML/Base64, entity rejection, namespaces and signature caps; expanded SAML field/timestamp inspection; added wrapping/ID/reference observations without crypto claims; redacted exports and removed dynamic HTML; repaired live errors and themes. Audit totals: 5 grouped fixes.
- `oauth-pkce-workbench` — bounded inputs and live regions; made state/nonce exact and callback parsing strict; added missing-state failure; invalidated stale async/output state; corrected copy/reset behavior. Audit totals: 4 grouped fixes with RFC 7636 vector pass.
- `sbom-inventory-inspector` — hardened CycloneDX/SPDX parsing and caps; corrected dependency direction, roots, reachability, cycles and duplicates; added normalized filters/exports; masked credentials and safe CSV; cleared stale state and fixed tabs/tables/themes. Audit totals: 5 grouped fixes.
- `certificate-hostname-matcher` — restricted SAN extraction to the correct certificate extension, removed CN fallback, bounded GeneralNames and inputs, made malformed/IP-like rows invalid, and improved table/theme accessibility. Audit totals: 4 grouped fixes.
- `json-lines-inspector` — corrected all line endings/BOM/terminal blank policy; preserved valid records through bounded profiling; fixed mixed arrays and disclosed caps/duplicate semantics; preserved lexical JSONL; hardened error CSV; cleared stale state and added accessible tabs/tables. Audit totals: 5 grouped fixes.
- `dataset-reconciliation-workbench` — hardened CSV/JSON and caps; separated missing/null/empty semantics; normalized keys/mappings; used exact decimal and strict UTC date tolerances; retained classifications; fixed stale output and row-level safe exports; repaired theme/table/pagination accessibility. Audit totals: 5 grouped fixes.
- `time-series-gap-analyzer` — hardened CSV/header/row parsing; made epoch/ISO interval math nanosecond-exact with strict calendar/DST handling; made cadence/completeness conservative; stabilized UTC filters and duplicates/reversals; added precision-safe exports and accessible timeline/tabs. Audit totals: 5 grouped fixes.
- `missingness-pattern-explorer` — corrected CSV/BOM/line endings/quoted/excess/prototype headers; fixed token and absent/null semantics; disclosed exact pattern/pair caps; cleared stale results, secured exports/SVG, and added accessible tabs/tables/themes. Audit totals: 5 grouped fixes.
- `record-linkage-scorer` — hardened parsing and work caps; renormalized weights when values are missing/invalid; fixed Unicode edit, decimal/date evidence, candidate prechecks, conflict preservation and blocked-positive recall; secured stale state/exports and accessibility. Audit totals: 5 grouped fixes.
- `data-dictionary-builder` — corrected capped distinct/range/date inference; separated contradictions from stale/unverified observations; preserved profiles in roundtrips; made generated schema authored-only and explicitly lossy; fixed sample/privacy/a11y, CSV formulas and explicit nullability. Audit required a zero-open recheck.
- `dataset-constraint-validator` — hardened lexical parsing/caps; closed and validated the rule vocabulary; fixed uniqueness/finding rows/cap disclosure; secured CSV and DOM; repaired themes/tabs/tables. Audit totals: 5 grouped fixes.
- `critical-path-planner` — corrected signed-lag CPM, origin/finish constraints, all float fields, precision/order/cycle/path caps, what-if baselines and date projection; hardened imports/exports and critical/table accessibility. Audit totals: 5 grouped fixes.
- `team-capacity-planner` — fixed unassigned/role shortage accounting, ledger preallocation caps, horizon/deadline/priority validation, overload wording, current-setting baselines, CSV formulas, themes/tables/heatmaps and local default dates.
- `decision-log-builder` — enforced immutable unique IDs and strict imports; fixed relationship/action dates, supersession cycles/status mismatches and local overdue dates; completed detail/export visibility, CSV safety and privacy/storage/tab accessibility.
- `okr-alignment-mapper` — enforced typed hierarchy and safe ID cascades; fixed progress direction/blank values/stale dates/roll-up ambiguity; hardened imports/storage/CSV; repaired owner/matrix/tab/theme accessibility without performance scoring.
- `communication-cadence-planner` — bounded and validated recurrence/date/escalation data; fixed grouped conflicts, active-date cadence gaps and trigger limitations; hardened ICS/CSV/import/download/table behavior; enforced JSON caps and storage errors in a zero-open recheck.
- `medication-refill-runway` — corrected demand, whole-dose, runout/refill off-by-one, adjustments, blackout and travel bounds; added strict transactional data/storage caps, safe CSV, privacy/print scope and accessible ledgers.
- `workstation-fit-planner` — corrected JSON units, clearance intersection, strict import/storage schemas, formula-safe CSV, reversed/large assumption rejection and chart/theme accessibility. Audit required a second turn to close six initial findings.
- `walking-progression-planner` — fixed enumeration/date/unit and two-session distribution rules; made weekly edits and precedence correct; hardened import/storage/CSV and progression warnings; repaired mobile/table/safety accessibility.
- `sunscreen-use-planner` — corrected validation, notes, overnight/event/end-boundary and packing behavior; invalidated stale results; hardened JSON/storage/CSV and repaired themes/tables/status text. Quantity and conversion fixtures passed.
- `first-aid-kit-inventory` — fixed opened/contradictory date and order-by semantics, incompatible-unit lot grouping, stale reviewed state, transactional imports and CSV formulas; added accessible narrow-screen inventory regions. Audit totals: 3 high, 1 medium, 1 low.
- `health-visit-prep-builder` — fixed local overdue dates, same-priority reordering, complete print/Markdown detail and safety text, strict imports and full sensitive-data clearing. Audit totals: 2 high, 3 medium.
- `meal-prep-batch-planner` — bounded scaling and compatible consolidation with provenance; hardened task graph/resource scheduling and mode conflicts; validated imports; removed dynamic HTML; secured CSV/storage and repaired safety/theme/table accessibility.
- `pantry-rotation-planner` — preserved FEFO/FIFO ranks through filters/sorts; fixed past-date projection and grouped shortage semantics; hardened transactional imports, stale state, CSV/storage and mobile tables. Audit totals: 3 high, 1 medium, 1 low.
- `recipe-yield-loss-calculator` — added finite unit conversion, stable safe remainder/portion math, clearer basis warnings, recalculated untrusted imported scenarios, secured CSV and printed scope text. Audit totals: 4 high, 1 medium, 1 low.
- `grocery-list-consolidator` — corrected malformed/negative-zero fractions, qualifier/brand provenance and incompatible overrides, persistent section filtering, atomic import/audit history, CSV/storage caps and formula safety. Audit totals: 4 high, 1 medium, 1 low.
- `spice-blend-formulator` — tightened basis/unit/density/value rules; made largest-remainder rounding safe/deterministic; corrected cost and user-entered contribution bases; hardened scenarios/storage/CSV and mobile/table/safety accessibility.
- `multi-dish-cooking-scheduler` — hardened imports/null holds/IDs/refs/dates/ranges; rejected duplicate graph IDs; added terminal hold replay; removed dynamic HTML, cleared failed stale schedules, secured CSV/storage and printed safety scope. Audit totals: 5 high, 1 medium, 1 low.
- `rainwater-harvest-planner` — fixed text/NaN formatting, monthly chronology and gap policy, capacity-before-demand overflow, runout/recovery/reserve and cross-unit scenarios; added atomic JSON import, stale invalidation and CSV safety. Audit totals: 4 high, 1 medium, 1 low.
- `household-water-audit` — corrected person/household multipliers and volume-row rules; exposed full conversion/frequency/season formulas; fixed absolute/category/location totals and recomputed scenarios; hardened import/storage/CSV and accessible charts/tables.
- `solar-battery-autonomy` — corrected outage-relative autonomy, recovery and integer boundaries; removed dynamic SVG HTML; fixed roundtrip settings, comparison normalization, stale ledgers and CSV safety. Audit totals: 4 high, 2 medium, 1 low.
- `household-waste-audit` — tightened provenance/weight validation; excluded undated mass from annualization; preserved exact span/gaps/groupings/duplicates; hardened import/storage/CSV and chart/table accessibility.
- `window-condensation-risk` — made flags uncertainty-range-aware, rejected undefined zero-RH dew point, clarified pressure/factor roles, handled unbounded charts, unified scenario semantics and hardened import/storage/CSV. Audit totals: 3 high, 1 medium, 1 low.
- `thermal-bridge-estimator` — hardened import/IDs/settings and negative-coefficient acknowledgement; fixed SI/Imperial temperatures; removed dynamic SVG HTML; secured CSV/storage and preserved printed scope/warnings.
- `stormwater-cistern-drawdown` — moved overflow before drawdown; corrected preserve-mode/restoration source steps and deadlines; tightened units/dates/reserve/outlet bounds; normalized scenarios and hardened JSON/storage/CSV; improved ledger accessibility.
- `appliance-load-scheduler` — rejected conflicting manual starts and interruptible self-overlap; preserved profiles/chunks; fixed deterministic outcomes, bounds/headroom/imports/stale state; removed dynamic SVG HTML and hardened exports/tabs/charts. Audit totals: 14 fixes.
- `spherical-polygon-area` — fixed radius units, antipodal rejection, finding resets, physical pole/±180 closure and scalable uniqueness, strict pre-closure/intersection caps, quoted CSV, reverse closure and print safety. Audit required a zero-open recheck.
- `rhumb-line-planner` — preserved multi-revolution longitude/leg sums; stabilized isometric latitude and coincident/antipodal cases; added validation/diagnostics, safe CSV and accessible theme/layout.
- `waypoint-route-analyzer` — hardened all parsers/caps/IDs/properties; preserved lexical endpoints; required qualified timestamps; corrected coincident bearings/turns/grades; removed dynamic SVG HTML and secured append/export/tabs. Audit totals: 16 fixes.
- `contour-slope-aspect` — made conditioning scale-independent and eigen math stable; added caps/finite guards; corrected flat aspect/ratio and uncertainty extrema; secured exports and accessible themes/tables.
- `coordinate-uncertainty-buffer` — fixed spherical bounds and detailed circle states; tolerant SAT/mixed margins; box-only imports, validation/caps, safe SVG/CSV/imports and clockwise visual bearing. Audit required a zero-open SVG recheck.
- `cash-runway-simulator` — captured intraday minima/crossings in correct order; replaced quadratic grouping; bounded inputs/scenarios; added aggregate flows and currency-safe comparison; hardened storage/CSV and accessible themes/tables.
- `freelance-rate-floor` — preserved correct gross-up/writeoff order with finite guards; isolated invalid sensitivities; clarified capacity/rounding assumptions; added bounded imports/storage/reset, CSV safety and cross-currency/print/mobile fixes.
- `equipment-lease-buy-comparator` — fixed calendar dates, down-payment period zero, principal reconciliation and beyond-horizon financing balance; added DCF/EAC/crossing/cap guards; hardened imports/storage/CSV and print/mobile behavior.
- `inventory-carrying-cost` — tightened all average methods, sample/cap/ID validation and zero-value custom-base allocation; reconciled scoped components; separated turnover bases; fixed sensitivity, roundtrips, SVG/CSV/tabs. Audit totals: 17 fixes.
- `escrow-expense-planner` — stopped solver mutation, corrected anniversary escalation, bounded recurrence/events, handled solver/order/floor/no-date edge cases, and hardened roundtrip imports/CSV/storage/themes/tables.
- `invoice-late-fee-schedule` — tightened terms/payments/order/cutoff logic; corrected flat/periodic labels, inclusion and overpayment disclosures; preserved allocation, terms and bounded summaries; hardened imports/storage/CSV/actions. Audit totals: 18 fixes.
- `rotating-shift-calendar` — tightened tokens/anchor/offset/imports; preserved override notes/last-wins; deduplicated rest warnings; added correct DTSTAMP/UID/UTF-8 ICS folding and hardened CSV/storage/print.
- `backward-deadline-planner` — preserved signed out-of-window times; bounded all dates/tasks/holidays; separated backward versus replay resource conflicts; added lead/zero-slack diagnostics and safe transactional import/CSV/storage/accessibility.
- `recurrence-collision-finder` — tightened every recurrence field/count/until/buffer/labels; fixed numeric-start roundtrips and post-window overrides; capped scans/findings; corrected contained overlap/concurrency/dedup; hardened imports/storage/CSV. Audit totals: 17 fixes.
- `time-log-gap-analyzer` — unified strict timestamp parsing and DST policy; added all touching pairs and correct UTC span caps; preserved union/raw/midnight splits; fixed CSV cap/header/BOM/formulas and storage/file/print handling.
- `availability-heatmap-builder` — preserved overnight carry; added cross-midnight exceptions and midnight-contiguous windows; indexed person-days and exact union/ties; hardened import/storage/CSV and semantic heatmap accessibility.
- `impulse-response-analyzer` — hardened WAV/endian/chunks/samples and all analysis controls; qualified EDT/T20/T30 with explicit unavailable reasons; reduced memory/stale exports and secured UI/CSV/JSON.
- `biquad-filter-designer` — tightened active parameters; preserved all RBJ formulas; fixed all-disabled unity cascade and sample-rate transactions; guarded response/group-delay math and improved coefficient/code export/accessibility.
- `audio-channel-layout-mapper` — tightened layout/matrix validation, explicit normalization and safe FFmpeg/CSV output; preserved routes through rename/reorder and repaired theme/responsive/a11y behavior.
- `pcm-sample-inspector` — enforced RIFF bounds/padding/core chunks/data; added overflow-safe statistics and non-finite discontinuities; replaced huge display arrays with lazy paging; removed unsafe clearing and secured state/CSV/export.
- `audio-phase-alignment-explorer` — hardened WAV/range/work caps; corrected normal/inverted peak, ambiguity, fractional lag and phase sign; added qualification warnings, reduced memory/stale exports and safe CSV/downloads.
- `scala-tuning-inspector` — tightened lexical/comment/ratio parsing; corrected KBM size-zero, formal-octave, unmapped and reference anchoring; hardened clear/export/themes/tables.
- `midi-transform-workbench` — hardened SMF/EOT/PPQN parsing and writer canonicalization; bounded transform schemas; fixed FIFO note pairing/ties/humanize/collisions; transactional state and safe exports. Audit totals: 20 binary/transform fixtures.
- `musicxml-score-inspector` — hardened XML declarations/root lookup; validated musical attributes/durations; corrected division changes, grace/chord cursors and per-part repeats; added timing warnings, stale/file/export safety.
- `chord-voicing-explorer` — tightened pitch/formula and all piano/guitar constraints; fixed guitar doubling/MIDI enforcement and exact search caps; cleared stale state, secured SVG/tabs/CSV/downloads.
- `rhythm-notation-converter` — bounded rational growth; made tempo/position/meter math exact; fixed partial meter segments and signed quantization error; tightened settings/CSV and stale/export safety.
- `edl-converter` — tightened FCM/DF consistency, event/dissolve bounds and motion/comments/duplicates; expanded compare/loss reporting; secured exports and accessibility with exact DF vectors.
- `adaptive-stream-manifest-inspector` — hardened inert URIs, HLS keys/maps/parts/caps and DASH direct-child/BaseURL/template/timeline/list/protection/xlink inheritance; cleared stale state, secured DOM/tabs/exports. Audit totals: 26 manifest assertions.
- `ffmpeg-command-planner` — tightened options/maps/filter references and copy conflicts; corrected Matroska muxer; added NUL/path/container warnings; consolidated shell quoting and fixed stale clipboard/export/accessibility.
- `caption-reading-speed-auditor` — bounded safe markup/entity metrics; expanded WebVTT lexical preservation; fixed duplicates/timing/threshold/preview semantics; hardened normalized/JSON/CSV exports and UI accessibility.
- `video-test-pattern-generator` — enforced integer pixel/object caps; corrected contiguous bands and zone ordering; restored full Canvas/SVG parity; sanitized text, invalidated stale renders and hardened preview/download/accessibility.
- `perceptual-image-hash` — corrected normalized DCT pHash; tightened raster decode/batch/pair rules and deterministic clusters; improved accessible matrices and export/URL safety. Audit totals: 25 synthetic assertions.
- `image-registration-overlay` — made decode race-safe; normalized/conditioned transforms; added alpha-aware NCC; corrected RGB RMSE/overlap and inverse point picking; hardened exports and accessibility.
- `sprite-atlas-packer` — fixed shelf reuse; added compressed/decoded/atlas caps; recomputed trims from retained sources; stabilized IDs/sorts/metadata/CSS; disabled smoothing for exact rotated extrusion and hardened URLs/actions.
- `print-imposition-planner` — tightened geometry/grid/page caps; corrected booklet creep and duplex mirroring; enforced usable-margin fit; added real SVG crop guides/accessibility and safe exports. Audit totals: 26 geometry assertions.
- `variable-font-axis-explorer` — bounded sfnt/TTC/name/fvar/avar/STAT; fixed selected-face extraction and FontFace URL races; preserved exact axes/instances/snapshots and byte-free safe exports/accessibility.
- `svg-accessibility-auditor` — hardened XML/caps/snippets/paths; expanded accessible-name/focus/IDREF and separated active-resource security findings; tightened root-only patches, stale state and CSV/Markdown/export safety.
- `mojibake-repair-workbench` — implemented true ISO-8859-1 distinct from CP1252, BOM handling and UTF-32 rejection; tightened step/roundtrip/ranking/surrogate/binary caps; enforced explicit selection and safe exports. Audit totals: 34 encoding fixtures.

## Completion ledger

- `dockerfile-linter` — audited and fixed by `audit2_001_dockerfile`; 18 focused fixtures passed.
- `kubernetes-manifest-inspector` — audited and fixed by `audit2_002_kubernetes`; 9 focused fixtures passed.
- `terraform-plan-summarizer` — audited and fixed by `audit2_003_terraform`; focused classification, reason/path, dependency, and redaction fixtures passed.
- `webassembly-module-inspector` — audited and fixed by `audit2_004_webassembly`; 16 binary fixtures and 9 parser-path assertions passed.
- `dependency-lockfile-auditor` — audited and fixed by `audit2_005_lockfile`; 10 lockfile groups and 22 assertions passed.
- `conventional-commit-validator` — audited and fixed by `audit2_006_conventional`; 19 focused assertions passed.
- `json-schema-fixture-generator` — audited and fixed by `audit2_007_jsonschema`; deterministic valid/invalid, combinator, ref, unique-item, and hostile-pattern fixtures passed.
- `http-transcript-parser` — audited and fixed by `audit2_008_http`; two VM fixture suites passed.
- `database-migration-sequencer` — audited and fixed by `audit2_009_migrations`; graph, ordering, rollback propagation, UI, and markup fixtures passed.
- `fstab-builder` — audited and fixed by `audit2_010_fstab`; focused escape, normalization, validation, markup, and safe-output fixtures passed.
- `journalctl-query-builder` — audited, fixed, and rechecked by `audit2_011_journalctl`; 8 focused assertions passed with zero open findings.
- `systemd-hardening-analyzer` — audited and fixed by `audit2_012_systemd`; generated override verified with systemd-analyze v257 and markup/safety checks passed.
- `process-resource-limit-planner` — audited and fixed by `audit2_013_resource_limits`; syntax, 28 DOM assertions, YAML structure, safety and page-design checks passed.
- `inode-capacity-planner` — audited and fixed by `audit2_014_inode`; 19 deterministic assertions plus syntax/design/whitespace passed.
- `boot-timeline-analyzer` — audited and fixed by `audit2_015_boot`; duration, hierarchy, security, markup and whitespace fixtures passed.
- `network-har-waterfall-analyzer` — audited and fixed by `audit2_016_har`; executable timing, ordering, cache, redirect, masking, malformed and cap fixtures passed.
- `cors-preflight-simulator` — audited and fixed by `audit2_017_cors`; static semantic, safety, bounds and whitespace checks passed with zero open findings.
- `cookie-scope-simulator` — audited and fixed by `audit2_018_cookie`; 16 focused assertions plus design/safety/whitespace checks passed.
- `webrtc-sdp-inspector` — audited and fixed by `audit2_019_sdp`; markup, safety, responsive/theme and structural checks passed.
- `dnssec-chain-inspector` — audited and fixed by `audit2_020_dnssec`; independent key-tag and SHA-256 DS vectors plus safety/markup checks passed.
- `bgp-path-explorer` — audited and fixed by `audit2_021_bgp`; structure, labels, IDs, graph caps, safety and whitespace passed.
- `dhcp-pool-planner` — audited and fixed by `audit2_022_dhcp`; seven independent IPv4/capacity/demand vectors plus safety checks passed.
- `mtu-fragmentation-explorer` — audited and fixed by `audit2_023_mtu`; ceiling, MSS, fragment-boundary, syntax/design/registry and safety gates passed.
- `threat-model-workshop` — audited and fixed by `audit2_024_threat`; CRUD/import/export, tab, markup and safety checks passed.
- `cvss-vector-calculator` — audited and fixed by `audit2_025_cvss`; 8 v3.1 score triples and 11 v4.0 official/reference vectors plus parser rejects passed.
- `source-secret-scanner` — audited, fixed, and rechecked by `audit2_026_secrets`; adversarial glob/mask/CSV, state, cap and export invariants passed with zero open findings.
- `saml-assertion-inspector` — audited and fixed by `audit2_027_saml`; structure, entity, safety and whitespace checks passed.
- `oauth-pkce-workbench` — audited and fixed by `audit2_028_pkce`; RFC 7636 Appendix B, entropy, structure, safety and no-network checks passed.
- `sbom-inventory-inspector` — audited and fixed by `audit2_029_sbom`; shape, graph, IDs/ARIA, safety and whitespace checks passed.
- `certificate-hostname-matcher` — audited and fixed by `audit2_030_certmatch`; static matching/security, markup and whitespace checks passed.
- `json-lines-inspector` — audited and fixed by `audit2_031_jsonl`; structural, line-policy, safety and export checks passed.
- `dataset-reconciliation-workbench` — audited and fixed by `audit2_032_reconcile`; decimal/date boundaries, caps, markup and safety fixtures passed.
- `time-series-gap-analyzer` — audited and fixed by `audit2_033_timeseries`; precision/date/DST, markup and export checks passed.
- `missingness-pattern-explorer` — audited and fixed by `audit2_034_missingness`; exact pattern/pair caps, parsing, metrics, syntax, ARIA and safety fixtures passed.
- `record-linkage-scorer` — audited and fixed in individual turn #35; five integration fixture groups plus design/registry/safety checks passed.
- `data-dictionary-builder` — audited, fixed and rechecked in turn #36; CSV roundtrip and schema-nullability truth-table fixtures passed.
- `dataset-constraint-validator` — audited and fixed in turn #37; parser/rule/syntax/design/safety fixtures passed.
- `critical-path-planner` — audited and fixed in turn #38; 12 CPM/date/export invariants passed.
- `team-capacity-planner` — audited and fixed in turn #39; allocation totals plus design/registry/safety checks passed.
- `decision-log-builder` — audited and fixed in turn #40; graph/import/markup/safety checks passed.
- `okr-alignment-mapper` — audited and fixed in turn #41; hierarchy/progress/import/ARIA/safety checks passed.
- `communication-cadence-planner` — audited, fixed and rechecked in turn #42; recurrence/ICS/cap/storage and project validators passed.
- `medication-refill-runway` — audited and fixed in turn #43; date/ledger/import/privacy/static safety checks passed.
- `workstation-fit-planner` — audited, fixed and rechecked in turn #44; unit, clearance, schema, cap, CSV and a11y guards passed.
- `walking-progression-planner` — audited and fixed in turn #45; distribution/date/import/export/markup checks passed.
- `sunscreen-use-planner` — audited and fixed in turn #46; quantity, conversion, overnight/dedup/end and packing fixtures passed.
- `first-aid-kit-inventory` — audited and fixed in turn #47; 10 date/group/import/export fixtures and repository syntax passed.
- `health-visit-prep-builder` — audited and fixed in turn #48; 9 privacy/order/date/import/export fixtures passed.
- `meal-prep-batch-planner` — audited and fixed in turn #49; graph/resource/scaling/import/safety checks passed.
- `pantry-rotation-planner` — audited and fixed in turn #50; 11 FEFO/FIFO/date/projection/group/import/CSV fixtures passed.
- `recipe-yield-loss-calculator` — audited and fixed in turn #51; 10 unit/portion/import/export fixtures passed.
- `grocery-list-consolidator` — audited and fixed in turn #52; 7 parsing/conversion/provenance/import/export fixtures passed.
- `spice-blend-formulator` — audited and fixed in turn #53; normalization/rounding/contribution/storage/export checks passed.
- `multi-dish-cooking-scheduler` — audited and fixed in turn #54; 12 dependency/resource/fixed/hold/deadline/import/export fixtures passed.
- Tools `rainwater-harvest-planner` through `mojibake-repair-workbench` — individually audited in turns #55–#100, with one page per turn and zero open findings after required rechecks. Their focused formula, parser, geometry, scheduling, media, export, accessibility and security fixtures are summarized above.

## Final integration and deployment verification

- All 100 pages completed an individual audit turn. Required rechecks closed
  every reported issue; the final open-finding count is zero.
- The repository-wide accessibility pass found two hidden file inputs without
  accessible names in `workstation-fit-planner` and
  `walking-progression-planner`; both now have explicit labels.
- The first container syntax gate caught two missing statement terminators in
  `musicxml-score-inspector` and `video-test-pattern-generator`. Both were
  fixed and passed targeted syntax checks before the clean rebuild.
- The successful no-cache image build validated 1,497 JavaScript scripts,
  1,190 registered tools, 2,571 physical tool pages, 37 consolidated
  converters, and 1,047 legacy redirects. It generated SEO for 1,190 tools and
  a 1,192-URL sitemap.
- The old containers remained online throughout the image build. Compose then
  performed a short `--no-build` cutover to the already validated images.
- Runtime verification matched both running container image IDs to the newly
  built images. The homepage returned HTTP 200, the API health endpoint
  returned `{"ok":true}`, and all 100 second-wave routes returned HTTP 200
  with zero failures.
