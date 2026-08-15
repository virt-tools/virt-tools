# 100 Proposed New Tools

These proposals were checked against the current 990-tool public registry. They
favor broadly useful, browser-local tools and underserved categories rather than
single-property CSS generators or pair-specific unit converters.

| # | Proposed slug | Tool | Category | What it should do |
|---:|---|---|---|---|
| 1 | `api-request-builder` | API Request Builder | Developer | Compose HTTP requests, headers, query parameters, authentication, and bodies; export Fetch, cURL, or Python snippets. |
| 2 | `openapi-endpoint-explorer` | OpenAPI Endpoint Explorer | Developer | Load an OpenAPI document locally, browse operations, and generate example requests without sending them. |
| 3 | `protobuf-wire-inspector` | Protocol Buffers Wire Inspector | Developer | Decode pasted protobuf wire bytes into field numbers, wire types, raw values, and nested-message candidates without requiring a schema. |
| 4 | `api-schema-diff` | API Schema Diff | Developer | Compare two OpenAPI or JSON Schema documents and classify compatible, risky, and breaking contract changes. |
| 5 | `graphql-query-builder` | GraphQL Query Builder | Developer | Build operations and variables from an introspection result or pasted schema and export request code. |
| 6 | `webhook-payload-inspector` | Webhook Payload Inspector | Developer | Pretty-print payloads, verify common signature schemes, inspect timestamps, and replay as local request snippets. |
| 7 | `cron-syntax-converter` | Cron Syntax Converter | Developer | Translate schedules among Unix cron, Quartz, AWS EventBridge, and systemd calendar forms while identifying semantics that cannot map exactly. |
| 8 | `semver-range-tester` | Semantic Version Range Tester | Developer | Test version lists against npm-style ranges and explain caret, tilde, prerelease, and wildcard behavior. |
| 9 | `gitignore-builder` | .gitignore Builder | Developer | Combine curated templates by language, framework, editor, and OS with duplicate removal and local export. |
| 10 | `docker-compose-validator` | Docker Compose Validator | Developer | Parse Compose YAML, flag structural mistakes and risky defaults, and visualize services, networks, and volumes. |
| 11 | `sql-query-formatter` | SQL Query Formatter | Developer | Format and minify common SQL dialects with keyword casing and indentation controls. |
| 12 | `sql-parameter-binder` | SQL Parameter Binder | Developer | Safely preview positional or named parameters in a query for debugging while preserving SQL string escaping. |
| 13 | `regex-test-case-runner` | Regex Test Case Runner | Developer | Run a pattern against a table of positive and negative cases and export a compact regression fixture. |
| 14 | `stack-trace-parser` | Stack Trace Parser | Developer | Parse browser, Node, Python, Java, and .NET stack traces into searchable frames and file/line links. |
| 15 | `source-map-inspector` | Source Map Inspector | Developer | Inspect mappings, embedded sources, and generated-to-original locations from a local source-map file. |
| 16 | `unicode-security-scanner` | Unicode Security Scanner | Security | Detect mixed scripts, confusables, bidi controls, zero-width characters, and suspicious normalization differences. |
| 17 | `content-security-policy-builder` | CSP Policy Builder | Security | Assemble a Content-Security-Policy, explain directives, and flag unsafe or ineffective combinations. |
| 18 | `sri-hash-generator` | Subresource Integrity Generator | Security | Generate SHA-256/384/512 integrity attributes for local files and verify existing SRI values. |
| 19 | `totp-qr-migrator` | TOTP QR Migrator | Security | Decode and re-encode `otpauth` URIs locally, showing issuer, account, algorithm, digits, and period safely. |
| 20 | `password-policy-tester` | Password Policy Tester | Security | Test sample passwords against configurable rules and estimate user impact without storing inputs. |
| 21 | `certificate-chain-viewer` | Certificate Chain Viewer | Security | Parse PEM certificate chains locally and show subjects, issuers, validity, key usage, fingerprints, and gaps. |
| 22 | `security-headers-auditor` | Security Headers Auditor | Security | Analyze pasted response headers for CSP, HSTS, framing, referrer, permissions, and MIME protections. |
| 23 | `jwt-claims-validator` | JWT Claims Validator | Security | Validate claim timing, issuer, audience, and required fields separately from cryptographic signature verification. |
| 24 | `ssh-config-builder` | SSH Config Builder | System | Build host entries with jumps, identities, forwarding, keepalive, and multiplexing, then export valid config. |
| 25 | `systemd-timer-builder` | systemd Timer Builder | System | Create paired service/timer units and explain calendar, persistence, random delay, and missed-run behavior. |
| 26 | `file-permission-planner` | File Permission Planner | System | Design Unix mode bits, ownership, ACL intent, and recursive find/chmod commands with safety warnings. |
| 27 | `environment-variable-diff` | Environment Variable Diff | System | Compare two dotenv or environment dumps, mask secrets, and classify added, removed, and changed keys. |
| 28 | `log-rotation-planner` | Log Rotation Planner | System | Generate logrotate rules from retention, size, compression, ownership, and service-reload requirements. |
| 29 | `process-signal-reference` | Process Signal Planner | System | Explain POSIX signals and build cautious stop/reload/escalation command sequences for a selected process. |
| 30 | `backup-retention-planner` | Backup Retention Planner | System | Model grandfather-father-son and custom retention policies, storage counts, and recovery-point coverage. |
| 31 | `cidr-allocation-planner` | CIDR Allocation Planner | Networking | Divide an address block among named networks using VLSM and report waste, ranges, gateways, and overlaps. |
| 32 | `dns-zone-validator` | DNS Zone Validator | Networking | Parse pasted zone records and flag malformed names, TTLs, conflicting records, missing glue, and common mail issues. |
| 33 | `dns-propagation-planner` | DNS Propagation Planner | Networking | Model when cached records expire after TTL changes and produce a safe migration timeline. |
| 34 | `http-cache-header-builder` | HTTP Cache Header Builder | Networking | Build Cache-Control, Expires, ETag, and Vary strategies for HTML, APIs, and fingerprinted assets. |
| 35 | `proxy-header-inspector` | Proxy Header Inspector | Networking | Parse Forwarded and X-Forwarded headers, show hop order, and highlight spoofing or trust-boundary concerns. |
| 36 | `url-routing-tester` | URL Routing Tester | Networking | Test URL paths against ordered route patterns, parameters, wildcards, and rewrites to reveal shadowed routes. |
| 37 | `mqtt-topic-tester` | MQTT Topic Tester | Networking | Check topics against `+` and `#` subscriptions and simulate retained-message routing. |
| 38 | `websocket-frame-calculator` | WebSocket Frame Calculator | Networking | Encode or decode frame headers, masking, lengths, opcodes, and fragmentation from local input. |
| 39 | `email-auth-record-builder` | Email Authentication Builder | Networking | Build and cross-check SPF, DKIM selector, and DMARC records with alignment and lookup-limit guidance. |
| 40 | `ipv6-address-explainer` | IPv6 Address Explainer | Networking | Expand/compress IPv6, identify scope and embedded forms, and show network/interface portions for a prefix. |
| 41 | `meeting-cost-calculator` | Meeting Cost Calculator | Productivity | Estimate meeting cost from attendees, compensation ranges, duration, recurrence, and preparation time. |
| 42 | `decision-matrix` | Weighted Decision Matrix | Productivity | Score options against weighted criteria, run sensitivity analysis, and explain close or unstable rankings. |
| 43 | `priority-matrix` | Priority Matrix | Productivity | Sort tasks by urgency and importance with keyboard-friendly editing and local export. |
| 44 | `time-block-planner` | Time Block Planner | Productivity | Arrange tasks into daily blocks with breaks, fixed events, overflow detection, and printable output. |
| 45 | `work-break-planner` | Work/Break Planner | Productivity | Build focus cycles around available time, desired break ratio, and a hard finish time. |
| 46 | `project-estimate-range` | Project Estimate Range | Productivity | Combine optimistic, likely, and pessimistic estimates using PERT and Monte Carlo-style percentile summaries. |
| 47 | `stakeholder-map` | Stakeholder Map | Productivity | Place stakeholders by influence and interest and generate an engagement plan stored locally. |
| 48 | `raci-matrix-builder` | RACI Matrix Builder | Productivity | Assign responsibility roles across tasks, flag missing owners or excess approvers, and export CSV. |
| 49 | `agenda-builder` | Meeting Agenda Builder | Productivity | Allocate timed agenda items, owners, outcomes, and buffers within a fixed meeting duration. |
| 50 | `shift-handover-builder` | Shift Handover Builder | Productivity | Structure active incidents, completed work, risks, owners, and next actions into a portable handover note. |
| 51 | `reading-time-planner` | Reading Time Planner | Productivity | Turn page or word counts into a dated plan using reading speed, session limits, and skipped days. |
| 52 | `study-spaced-repetition-planner` | Spaced Repetition Planner | Productivity | Generate review dates from an exam deadline and adjustable recall intervals without becoming a flashcard app. |
| 53 | `medication-schedule-planner` | Medication Schedule Planner | Health | Lay out clinician-prescribed intervals around wake/sleep windows and food constraints with clear safety disclaimers. |
| 54 | `hydration-schedule` | Hydration Schedule Planner | Health | Distribute a user-selected daily fluid target across waking hours and activities without making medical prescriptions. |
| 55 | `sleep-debt-tracker` | Sleep Debt Tracker | Health | Compare logged sleep with a personal target across days and visualize cumulative surplus or deficit. |
| 56 | `training-load-calculator` | Training Load Calculator | Health | Calculate session-RPE load, acute/chronic summaries, monotony, and strain from local workout entries. |
| 57 | `pace-zone-planner` | Pace Zone Planner | Health | Derive configurable running, cycling, or swimming training zones from threshold pace or time-trial results. |
| 58 | `hearing-exposure-calculator` | Hearing Exposure Calculator | Health | Estimate combined daily noise dose using NIOSH or OSHA exchange rates with strong safety guidance. |
| 59 | `ergonomic-break-planner` | Ergonomic Break Planner | Health | Schedule short movement, eye-rest, and posture prompts around a work session with optional local notifications. |
| 60 | `symptom-timeline-builder` | Symptom Timeline Builder | Health | Organize dates, severity, triggers, medicines, and notes into a printable clinician-visit timeline without diagnosis. |
| 61 | `recipe-scaler-by-pan` | Recipe Pan Size Scaler | Food | Scale ingredient quantities by pan area or volume across round, square, loaf, and sheet pans. |
| 62 | `dough-hydration-planner` | Dough Hydration Planner | Food | Account for flour and water hidden in starters, preferments, eggs, and fats when scaling dough to a target hydration and mass. |
| 63 | `coffee-brew-ratio-planner` | Coffee Brew Ratio Planner | Food | Calculate coffee, water, beverage yield, and staged pours for common manual brew methods. |
| 64 | `fermentation-salt-calculator` | Fermentation Salt Calculator | Food | Compute salt by ingredient or brine mass with unit handling and food-safety reminders. |
| 65 | `nutrition-label-scaler` | Nutrition Label Scaler | Food | Scale label nutrients from serving size to consumed amount and compare multiple products locally. |
| 66 | `freezer-inventory-planner` | Freezer Inventory Planner | Food | Track portions, freeze dates, best-quality windows, and FIFO usage locally with CSV import/export. |
| 67 | `food-cost-calculator` | Recipe Food Cost Calculator | Food | Calculate recipe and serving costs from package price, package size, yield, and waste percentage. |
| 68 | `allergen-crosscheck` | Recipe Allergen Cross-check | Food | Flag declared allergens and user-defined ingredient aliases across pasted recipes; never infer absence as safety. |
| 69 | `solar-panel-spacing-calculator` | Solar Panel Row Spacing | Environment | Estimate minimum row spacing from panel geometry, latitude, and winter sun angle to limit self-shading. |
| 70 | `rain-garden-sizing` | Rain Garden Sizing Calculator | Environment | Estimate capture area and storage from drainage area, design rainfall, soil infiltration, and drawdown target. |
| 71 | `home-energy-baseline` | Home Energy Baseline | Environment | Normalize utility use by floor area, occupants, and heating/cooling degree days for month-to-month comparisons. |
| 72 | `heat-pump-balance-point` | Heat Pump Balance Point | Environment | Estimate thermal and economic balance points from heat-loss rate, capacity curve, COP, and backup-fuel cost. |
| 73 | `battery-carbon-shift` | Battery Carbon Shift Calculator | Environment | Compare emissions from charging and discharging across hourly grid-intensity values and round-trip efficiency. |
| 74 | `commute-mode-comparator` | Commute Mode Comparator | Environment | Compare time, direct cost, calories, and emissions for car, transit, cycling, walking, and remote days. |
| 75 | `tree-canopy-estimator` | Tree Canopy Estimator | Environment | Estimate mature canopy area, overlap, and shade coverage for a simple site plan. |
| 76 | `compost-ratio-builder` | Compost Mix Builder | Environment | Balance approximate carbon-to-nitrogen ratio, moisture, and volume from common green and brown materials. |
| 77 | `chord-progression-transposer` | Chord Progression Transposer | Music | Transpose chord symbols while preserving qualities, extensions, slash basses, and preferred sharp/flat spelling. |
| 78 | `scale-chord-finder` | Scale Chord Finder | Music | List diatonic chords for modes and scales and show compatible notes, roman numerals, and inversions. |
| 79 | `tempo-delay-calculator` | Tempo Delay Calculator | Music | Convert BPM and note divisions, including dotted and triplet values, into delay and pre-delay milliseconds. |
| 80 | `polyrhythm-visualizer` | Polyrhythm Visualizer | Music | Animate and audition two or more subdivisions over a shared cycle with accessible visual alternatives. |
| 81 | `tuning-frequency-calculator` | Tuning Frequency Calculator | Music | Calculate note frequencies for configurable A4 reference and equal temperament divisions. |
| 82 | `setlist-duration-planner` | Setlist Duration Planner | Music | Arrange songs, tuning changes, speaking breaks, and encores within a performance time limit. |
| 83 | `midi-note-inspector` | MIDI Note Inspector | Music | Inspect local MIDI events, channels, tempo changes, note ranges, and duration without uploading the file. |
| 84 | `subtitle-timing-shifter` | Subtitle Timing Shifter | Video | Shift, stretch, or rebase SRT and WebVTT cues with overlap and invalid-order detection. |
| 85 | `video-bitrate-planner` | Video Bitrate Planner | Video | Calculate target video/audio bitrates from duration and size limit with container-overhead allowance. |
| 86 | `aspect-crop-planner` | Video Crop Planner | Video | Compute crop and padding needed to adapt source dimensions to delivery aspect ratios and safe areas. |
| 87 | `timecode-calculator` | SMPTE Timecode Calculator | Video | Add, subtract, and convert frame counts and timecodes with drop-frame support for 29.97 and 59.94 fps. |
| 88 | `shot-list-builder` | Shot List Builder | Video | Organize shots by scene, framing, movement, location, cast, gear, status, and estimated setup time. |
| 89 | `podcast-chapter-builder` | Podcast Chapter Builder | Audio | Create timestamped chapters with titles and links and export common JSON, MP4, and show-note formats. |
| 90 | `loudness-normalization-planner` | Loudness Normalization Planner | Audio | Calculate gain to target LUFS while checking true-peak headroom and platform-specific targets. |
| 91 | `speaker-delay-alignment` | Speaker Delay Alignment Calculator | Audio | Convert path-length differences and temperature-adjusted sound speed into delay settings for aligned speakers. |
| 92 | `microphone-pattern-planner` | Microphone Pattern Planner | Audio | Compare pickup patterns and placement geometry for source angle, rejection direction, and stereo arrangements. |
| 93 | `audio-file-header-inspector` | Audio File Header Inspector | Audio | Parse local WAV, AIFF, FLAC, and MP3 headers to report encoding, channel, duration, and metadata details. |
| 94 | `geodata-coordinate-cleaner` | Coordinate List Cleaner | Geography | Normalize pasted latitude/longitude lists, swap likely reversed columns, validate ranges, and export CSV or GeoJSON. |
| 95 | `great-circle-intersection` | Great-circle Intersection Finder | Geography | Find intersections of two bearings or great-circle paths and explain ambiguous solutions. |
| 96 | `map-scale-calculator` | Map Scale Calculator | Geography | Convert representative fractions, scale bars, printed distances, and real-world distances with print-size checks. |
| 97 | `geojson-bounds-calculator` | GeoJSON Bounds Calculator | Geography | Compute bounds, centroid estimates, geometry counts, and antimeridian warnings for local GeoJSON. |
| 98 | `survey-traverse-calculator` | Survey Traverse Calculator | Geography | Calculate coordinates, closure error, and Bowditch adjustment from bearings and distances. |
| 99 | `data-anonymization-planner` | Data Anonymization Planner | Data | Classify columns, choose masking or generalization strategies, and preview transformations entirely locally. |
| 100 | `data-quality-profiler` | Data Quality Profiler | Data | Profile local CSV/JSON for missingness, uniqueness, type inconsistencies, ranges, outliers, and candidate keys. |

## Suggested implementation order

Start with broadly useful, low-dependency tools: Cron Syntax Converter,
Semantic Version Range Tester, Unicode Security Scanner, CIDR Allocation
Planner, Weighted Decision Matrix, Recipe Pan Size Scaler, Chord Progression
Transposer, Subtitle Timing Shifter, SMPTE Timecode Calculator, and Data Quality
Profiler. These offer high standalone value and can run entirely in-browser.

Tools involving health, food safety, security policy, electrical/thermal models,
or geographic surveying should include explicit assumptions and limitations,
authoritative references, strong domain validation, and wording that avoids
presenting estimates as professional advice.
