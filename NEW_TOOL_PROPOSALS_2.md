# 100 Additional Proposed Tools

This second proposal set was screened against the current 1,090-tool registry
and the original `NEW_TOOL_PROPOSALS.md`. It favors substantial browser-local
utilities, underserved workflows, and tools with clear validation boundaries.
It deliberately excludes pair-specific converters and narrow CSS generators.

| # | Proposed slug | Tool | Category | What it should do |
|---:|---|---|---|---|
| 1 | `dockerfile-linter` | Dockerfile Linter | Developer | Parse a Dockerfile, flag ineffective layers, invalid instruction combinations, unsafe defaults, and portability concerns without building it. |
| 2 | `kubernetes-manifest-inspector` | Kubernetes Manifest Inspector | Developer | Validate local Kubernetes YAML structurally, cross-check object references, and summarize workloads, services, storage, probes, and security contexts. |
| 3 | `terraform-plan-summarizer` | Terraform Plan Summarizer | Developer | Parse a local Terraform JSON plan and summarize creates, updates, replacements, destroys, sensitive paths, and dependencies without contacting providers. |
| 4 | `webassembly-module-inspector` | WebAssembly Module Inspector | Developer | Decode a local Wasm binary's sections, imports, exports, memories, tables, functions, and feature flags without executing it. |
| 5 | `dependency-lockfile-auditor` | Dependency Lockfile Auditor | Developer | Inspect npm, Yarn, pnpm, or Poetry lockfiles for duplicate versions, integrity gaps, source types, and dependency concentration without querying registries. |
| 6 | `conventional-commit-validator` | Conventional Commit Validator | Developer | Validate commit-message lists against configurable Conventional Commits rules and summarize types, scopes, breaking markers, and malformed entries. |
| 7 | `json-schema-fixture-generator` | JSON Schema Fixture Generator | Developer | Generate bounded example JSON instances from JSON Schema while identifying ambiguous, contradictory, or unsupported constraints. |
| 8 | `http-transcript-parser` | HTTP Transcript Parser | Developer | Parse raw HTTP request and response transcripts into start lines, repeated headers, cookies, trailers, and bodies with malformed-line findings. |
| 9 | `database-migration-sequencer` | Database Migration Sequencer | Developer | Order migration definitions by dependencies, detect cycles or missing prerequisites, and produce forward and rollback run sheets without executing SQL. |
| 10 | `fstab-builder` | fstab Entry Builder | System | Build and validate fstab entries from devices, mount points, filesystems, options, and pass settings with safe test-command guidance. |
| 11 | `journalctl-query-builder` | journalctl Query Builder | System | Compose shell-safe journalctl commands from units, priorities, boots, identifiers, time windows, fields, and output modes without running them. |
| 12 | `systemd-hardening-analyzer` | systemd Unit Hardening Analyzer | System | Inspect service units for applicable sandboxing and privilege controls and generate a reviewable hardening override. |
| 13 | `process-resource-limit-planner` | Process Resource Limit Planner | System | Translate CPU, memory, file, process, and core-dump constraints into comparable ulimit, systemd, and container settings with mismatch warnings. |
| 14 | `inode-capacity-planner` | Inode Capacity Planner | System | Estimate inode demand and exhaustion risk from file-count distributions, filesystem capacity, growth, and retention independently of byte storage. |
| 15 | `boot-timeline-analyzer` | Boot Timeline Analyzer | System | Parse systemd-analyze blame or critical-chain output into a dependency timeline and identify the measured critical startup path. |
| 16 | `network-har-waterfall-analyzer` | HAR Waterfall Analyzer | Networking | Load a bounded HAR locally to chart request phases, connection reuse, redirects, cache behavior, and critical-path timing without replaying traffic. |
| 17 | `cors-preflight-simulator` | CORS Preflight Simulator | Networking | Evaluate origins, methods, credentials, requested headers, and CORS response headers to explain preflight and browser response-access outcomes. |
| 18 | `cookie-scope-simulator` | Cookie Scope Simulator | Networking | Test Set-Cookie attributes against hypothetical request URLs and contexts to explain domain, path, SameSite, Secure, expiry, and prefix rules. |
| 19 | `webrtc-sdp-inspector` | WebRTC SDP Inspector | Networking | Parse SDP offers or answers into media sections, codecs, ICE candidates, fingerprints, directions, and negotiation mismatches without connecting peers. |
| 20 | `dnssec-chain-inspector` | DNSSEC Chain Inspector | Networking | Inspect pasted DS, DNSKEY, RRSIG, and NSEC-family records for identifier, algorithm, time-window, and chain-consistency issues without DNS lookups. |
| 21 | `bgp-path-explorer` | BGP AS Path Explorer | Networking | Parse AS paths and communities, identify prepending, loops, private ASNs, and path-selection attributes, and compare candidate routes locally. |
| 22 | `dhcp-pool-planner` | DHCP Pool Planner | Networking | Size IPv4 lease pools from subnet, reservations, exclusions, lease duration, client demand, and churn while flagging overlaps and exhaustion scenarios. |
| 23 | `mtu-fragmentation-explorer` | MTU & Fragmentation Explorer | Networking | Calculate IPv4 fragmentation and IPv6 packet-sizing outcomes across encapsulation overheads, PMTU values, payloads, and transport headers. |
| 24 | `threat-model-workshop` | Threat Model Workshop | Security | Build a local data-flow model, enumerate assets and trust boundaries, apply STRIDE prompts, and export mitigations without claiming exhaustive coverage. |
| 25 | `cvss-vector-calculator` | CVSS Vector Calculator | Security | Build, parse, and explain CVSS v3.1 and v4.0 vectors with transparent subscores, rounding, and severity classification. |
| 26 | `source-secret-scanner` | Source Secret Scanner | Security | Scan pasted text or selected local files for high-confidence credential patterns and entropy candidates with masking, allowlists, and false-positive guidance. |
| 27 | `saml-assertion-inspector` | SAML Assertion Inspector | Security | Decode SAML XML and inspect issuer, subject, audience, conditions, attributes, and signature metadata without claiming cryptographic verification. |
| 28 | `oauth-pkce-workbench` | OAuth PKCE Workbench | Security | Generate and verify PKCE verifier/challenge pairs and assemble authorization parameters locally without sending authorization requests. |
| 29 | `sbom-inventory-inspector` | SBOM Inventory Inspector | Security | Parse CycloneDX or SPDX JSON locally to summarize components, licenses, hashes, dependency edges, and incomplete provenance without online vulnerability claims. |
| 30 | `certificate-hostname-matcher` | Certificate Hostname Matcher | Security | Compare DNS names or IPs against certificate SAN and wildcard entries using hostname-matching rules separately from chain trust. |
| 31 | `json-lines-inspector` | JSON Lines Inspector | Data | Validate JSONL or NDJSON record by record, summarize shape drift, and export valid records plus line-specific errors. |
| 32 | `dataset-reconciliation-workbench` | Dataset Reconciliation Workbench | Data | Match two local flat datasets by selected keys and classify equal, changed, left-only, right-only, duplicate-key, and conflicting records. |
| 33 | `time-series-gap-analyzer` | Time-Series Gap Analyzer | Data | Inspect timestamped local data for missing intervals, duplicates, irregular cadence, timezone ambiguity, and coverage windows without imputing values. |
| 34 | `missingness-pattern-explorer` | Missingness Pattern Explorer | Data | Count and visualize missing-field combinations, co-missing pairs, and row completeness with bounded pattern cardinality and no causal claims. |
| 35 | `record-linkage-scorer` | Record Linkage Scorer | Data | Compare candidate record pairs with configurable exact, normalized, token, and edit-distance fields while exposing scores and thresholds without auto-merging. |
| 36 | `data-dictionary-builder` | Data Dictionary Builder | Data | Turn CSV or flat JSON columns into an editable dictionary of definitions, allowed values, units, ownership, sensitivity, and validation notes. |
| 37 | `dataset-constraint-validator` | Dataset Constraint Validator | Data | Apply user-authored required, type, range, pattern, uniqueness, and cross-field rules to local tabular data and export row-level violations. |
| 38 | `critical-path-planner` | Critical Path Planner | Productivity | Model tasks, durations, and dependencies to calculate earliest and latest dates, float, critical paths, and duration-change impact. |
| 39 | `team-capacity-planner` | Team Capacity Planner | Productivity | Allocate dated work demand against availability, leave, focus factors, and role constraints while surfacing overload and unassigned work. |
| 40 | `decision-log-builder` | Decision Log Builder | Productivity | Record options, context, assumptions, owners, rationale, review triggers, and superseded decisions in a portable local log. |
| 41 | `okr-alignment-mapper` | OKR Alignment Mapper | Productivity | Map objectives to measurable key results and initiatives, flag orphaned work or duplicate ownership, and show roll-up relationships without scoring performance. |
| 42 | `communication-cadence-planner` | Communication Cadence Planner | Productivity | Design recurring stakeholder updates by audience, channel, owner, trigger, and escalation path and export a calendar-ready plan. |
| 43 | `medication-refill-runway` | Medication Refill Runway | Health | Calculate remaining doses, refill dates, travel coverage, and user-entered pharmacy or clinician lead-time reminders without changing prescribed use. |
| 44 | `workstation-fit-planner` | Workstation Fit Planner | Health | Estimate adjustable desk, chair, monitor, and keyboard ranges from user measurements with ergonomic rather than clinical guidance. |
| 45 | `walking-progression-planner` | Walking Progression Planner | Health | Build a conservative user-configured walking duration or distance progression and flag unusually large week-to-week increases. |
| 46 | `sunscreen-use-planner` | Sunscreen Use Planner | Health | Estimate application quantity and user-selected reapplication times from exposed area, activity duration, and product instructions without predicting protection. |
| 47 | `first-aid-kit-inventory` | First-Aid Kit Inventory | Health | Track household kit quantities, expiry dates, inspection intervals, and replacement shopping lists locally. |
| 48 | `health-visit-prep-builder` | Health Visit Prep Builder | Health | Organize appointment goals, questions, medication changes, records to bring, and follow-up notes without diagnostic advice. |
| 49 | `meal-prep-batch-planner` | Meal Prep Batch Planner | Food | Scale several recipes into portions, consolidate shared preparation work, and produce a coordinated batch schedule. |
| 50 | `pantry-rotation-planner` | Pantry Rotation Planner | Food | Track pantry quantities, opened dates, user-entered quality dates, and FIFO use-up priorities locally. |
| 51 | `recipe-yield-loss-calculator` | Recipe Yield Loss Calculator | Food | Convert purchased weight through trimming, cooking loss, and portioning into edible yield, servings, and cost per served unit. |
| 52 | `grocery-list-consolidator` | Grocery List Consolidator | Food | Merge multiple ingredient lists using compatible units, preserve non-convertible items, and group the result by store section. |
| 53 | `spice-blend-formulator` | Spice Blend Formulator | Food | Design a blend by percentages or parts, scale batch mass, and compare entered salt or sugar contributions. |
| 54 | `multi-dish-cooking-scheduler` | Multi-dish Cooking Scheduler | Food | Back-plan preparation, oven, stovetop, resting, and holding steps so multiple dishes finish at a chosen serving time. |
| 55 | `rainwater-harvest-planner` | Rainwater Harvest Planner | Environment | Model roof runoff, first-flush loss, tank capacity, demand, overflow, and dry-period coverage from user-entered rainfall. |
| 56 | `household-water-audit` | Household Water Audit | Environment | Estimate indoor and outdoor water use by fixture, frequency, duration, and measured flow to identify the largest categories. |
| 57 | `solar-battery-autonomy` | Solar Battery Autonomy Planner | Environment | Simulate hourly loads, solar input, usable capacity, charge limits, and outage autonomy without equipment-specific claims. |
| 58 | `household-waste-audit` | Household Waste Audit | Environment | Summarize weighed waste entries by stream, avoidable category, destination, and weekly or annualized totals. |
| 59 | `window-condensation-risk` | Window Condensation Risk Planner | Environment | Compare indoor dew point with entered glazing and frame surface temperatures to flag idealized condensation margins. |
| 60 | `thermal-bridge-estimator` | Thermal Bridge Estimator | Environment | Add linear and point thermal bridges to area-based heat loss and show their share of the modeled envelope load. |
| 61 | `stormwater-cistern-drawdown` | Stormwater Cistern Drawdown Planner | Environment | Model capture events, controlled release, infiltration, reuse demand, overflow, and time to restore storage capacity. |
| 62 | `appliance-load-scheduler` | Appliance Load Scheduler | Environment | Place flexible household loads into hourly tariff or carbon-intensity slots subject to deadlines, durations, and circuit limits. |
| 63 | `spherical-polygon-area` | Spherical Polygon Area Calculator | Geography | Compute perimeter, signed area, winding, and antimeridian-aware diagnostics for a latitude/longitude polygon on a sphere. |
| 64 | `rhumb-line-planner` | Rhumb-line Planner | Geography | Calculate constant-bearing distance, destination, intermediate points, and comparison with great-circle results. |
| 65 | `waypoint-route-analyzer` | Waypoint Route Analyzer | Geography | Analyze an ordered coordinate list for leg distances, bearings, cumulative distance, turns, and implausible jumps. |
| 66 | `contour-slope-aspect` | Contour Slope & Aspect Calculator | Geography | Derive grade, slope angle, and aspect from surveyed point elevations or contour spacing under a local-plane assumption. |
| 67 | `coordinate-uncertainty-buffer` | Coordinate Uncertainty Buffer | Geography | Translate stated horizontal accuracy into local bounding circles or boxes and test whether two uncertainty regions overlap. |
| 68 | `cash-runway-simulator` | Cash Runway Simulator | Finance | Project account balances under recurring and one-off cash flows and identify runway dates across configurable scenarios. |
| 69 | `freelance-rate-floor` | Freelance Rate Floor Calculator | Finance | Derive a sustainable billable-rate floor from income target, overhead, tax set-aside, utilization, leave, and unpaid-work assumptions. |
| 70 | `equipment-lease-buy-comparator` | Equipment Lease vs Buy Comparator | Finance | Compare discounted lease payments, purchase financing, maintenance, tax assumptions, resale value, and break-even horizon. |
| 71 | `inventory-carrying-cost` | Inventory Carrying Cost Calculator | Finance | Estimate capital, storage, shrinkage, insurance, and obsolescence costs from average inventory and turnover assumptions. |
| 72 | `escrow-expense-planner` | Escrow Expense Planner | Finance | Convert irregular property, insurance, tax, membership, or similar bills into a monthly reserve schedule with balance projections. |
| 73 | `invoice-late-fee-schedule` | Invoice Late-fee Schedule Builder | Finance | Calculate simple or periodic late charges from explicit contract terms and produce an auditable date-by-date schedule. |
| 74 | `rotating-shift-calendar` | Rotating Shift Calendar Builder | Time | Expand repeating on/off or day/evening/night patterns into a dated calendar with rotation-cycle validation and export. |
| 75 | `backward-deadline-planner` | Backward Deadline Planner | Time | Schedule dependent work backward from a hard deadline using durations, buffers, working days, and fixed milestones. |
| 76 | `recurrence-collision-finder` | Recurrence Collision Finder | Time | Expand multiple local recurrence rules over a bounded window and identify overlaps, near misses, and overloaded dates. |
| 77 | `time-log-gap-analyzer` | Time Log Gap Analyzer | Time | Validate timestamped activity intervals and report overlaps, unaccounted gaps, category totals, and daily coverage. |
| 78 | `availability-heatmap-builder` | Availability Heatmap Builder | Time | Combine manually entered weekly availability blocks into an accessible local overlap heatmap without contacting calendars. |
| 79 | `impulse-response-analyzer` | Impulse Response Analyzer | Audio | Load a local impulse-response WAV to chart decay, estimate frequency-dependent RT60 or EDT, and flag noise-floor limits. |
| 80 | `biquad-filter-designer` | Biquad Filter Designer | Audio | Design common digital EQ sections, calculate normalized coefficients at a selected sample rate, and preview magnitude and phase response. |
| 81 | `audio-channel-layout-mapper` | Audio Channel Layout Mapper | Audio | Map, rename, reorder, downmix, or upmix mono through immersive channel layouts and export routing matrices without processing files. |
| 82 | `pcm-sample-inspector` | PCM Sample Inspector | Audio | Inspect bounded PCM WAV samples for extrema, DC offset, RMS, clipping runs, zero crossings, and per-channel statistics. |
| 83 | `audio-phase-alignment-explorer` | Audio Phase Alignment Explorer | Audio | Compare local or synthetic signals for polarity, cross-correlation delay, frequency-dependent phase, and candidate alignment. |
| 84 | `scala-tuning-inspector` | Scala Tuning Inspector | Music | Parse local SCL and KBM tuning files, display cents and ratios, map notes to frequencies, and flag malformed or unmapped entries. |
| 85 | `midi-transform-workbench` | MIDI Transform Workbench | Music | Filter, remap, transpose, quantize, humanize, and velocity-scale selected MIDI channels or events with local export. |
| 86 | `musicxml-score-inspector` | MusicXML Score Inspector | Music | Parse local MusicXML for parts, measures, keys, meters, ranges, repeats, and structural notation warnings. |
| 87 | `chord-voicing-explorer` | Chord Voicing Explorer | Music | Enumerate piano or guitar voicings under range, span, inversion, doubling, and fret constraints rather than merely naming chords. |
| 88 | `rhythm-notation-converter` | Rhythm Notation Converter | Music | Convert beats, ticks, note values, tuplets, dots, and meter positions while showing exact rational durations and quantization error. |
| 89 | `edl-converter` | Edit Decision List Converter | Video | Parse, validate, compare, and convert CMX-style EDL records with reel names, transitions, source and record timecodes, and comments. |
| 90 | `adaptive-stream-manifest-inspector` | HLS/DASH Manifest Inspector | Video | Inspect local HLS and DASH manifests for variants, codecs, segment timelines, encryption declarations, and structural inconsistencies without fetching media. |
| 91 | `ffmpeg-command-planner` | FFmpeg Command Planner | Video | Build non-executing FFmpeg commands from explicit stream maps, trims, filters, codecs, metadata, and containers with shell-safe quoting. |
| 92 | `caption-reading-speed-auditor` | Caption Reading Speed Auditor | Video | Audit SRT or WebVTT cues for characters and words per second, line length, duration, gaps, overlaps, and configurable thresholds. |
| 93 | `video-test-pattern-generator` | Video Test Pattern Generator | Video | Generate downloadable local raster or SVG charts for framing, safe areas, grayscale, color patches, resolution wedges, and pixel-aspect checks. |
| 94 | `perceptual-image-hash` | Perceptual Image Hash Comparator | Image | Compute local perceptual fingerprints, Hamming distances, and likely duplicate clusters for bounded image batches. |
| 95 | `image-registration-overlay` | Image Registration Overlay | Image | Align two local images using control points or bounded correlation and inspect difference, flicker, and opacity overlays. |
| 96 | `sprite-atlas-packer` | Sprite Atlas Packer | Image | Trim transparent bounds, pack local sprites into bounded atlases, and export PNG plus CSS or JSON frame metadata. |
| 97 | `print-imposition-planner` | Print Imposition Planner | Design | Arrange page sizes onto sheets for n-up, booklet, signature, bleed, gutter, duplex, and creep planning with printable guides. |
| 98 | `variable-font-axis-explorer` | Variable Font Axis Explorer | Design | Load a local variable font, inspect axes and named instances, preview combinations, and export font-variation settings. |
| 99 | `svg-accessibility-auditor` | SVG Accessibility Auditor | Design | Inspect local SVG structure for titles, descriptions, roles, focusability, text alternatives, duplicate IDs, and unsafe embedded content. |
| 100 | `mojibake-repair-workbench` | Mojibake Repair Workbench | Encoding | Preview likely decoding-repair paths among UTF-8 and legacy encodings, rank round-trip-safe candidates, and expose every byte transformation. |

## Suggested first implementation wave

Start with tools that have high standalone value and limited dependency risk:
Dockerfile Linter, Conventional Commit Validator, CORS Preflight Simulator,
Cookie Scope Simulator, JSON Lines Inspector, Data Dictionary Builder, Critical
Path Planner, Grocery List Consolidator, Cash Runway Simulator, Caption Reading
Speed Auditor, Perceptual Image Hash Comparator, and Mojibake Repair Workbench.

Security, health, finance, food-safety, environmental, surveying, and media
engineering tools should expose their assumptions, use bounded parsers, cite
stable specifications where appropriate, and avoid presenting heuristic output
as certification or professional advice.
