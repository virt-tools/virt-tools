# Individual Tool Audit Ledger

## Honest scope

[The audit ledger](../../individual-tool-audit.json) accounts for every physical
`frontend/tools/<slug>/index.html` page currently in the workspace. Accounting
for a page is not the same as auditing it: a `pending` record means no completed
individual review is claimed.

The ledger was refreshed after all nine generated formula-workbench pages were
materialized. It contains **3,416** unique page records.

## Current coverage

| Status | Pages | Meaning |
|---|---:|---|
| Pending | 3,293 | No completed individual audit is recorded. |
| Auditing | 0 | No review is represented as in progress in the saved ledger. |
| Clean | 0 | No page was recorded as reviewed with no changes required. |
| Findings | 7 | A direct review found unresolved defects; these pages are quarantined/unlisted. |
| Fixed | 15 | A prior individual review recorded confirmed repairs; independent recheck is not implied by this status. |
| Rechecked | 101 | Documented fixes or corrected behavior were rechecked. |
| **Total** | **3,416** | Every physical page is represented exactly once. |

This is **123 pages with a recorded audit outcome (3.60%)** and **3,293 pages
still pending (96.40%)**. The completed evidence consists of 100 explicit
second-wave page reviews documented in
[the second-wave report](SECOND_WAVE_INDIVIDUAL_AUDIT.md), 15
earlier fixed records (see [confirmed repairs](TOOL_REVIEW_FIXES.md)), and eight
targeted stabilization reviews. These figures do
not support a claim that every tool in the project has been individually
audited.

## Stabilization findings

The following direct audits remain open and are represented as `findings`:

- `bmi-calculator` — pediatric/adult interpretation, unit, body-composition,
  energy-label, validation, and advice defects.
- `wire-gauge-calculator` — critically under-specified conductor sizing,
  inconsistent table data, unsafe over-range selection, and voltage-drop
  selection defects.
- `beam-deflection-calculator` — code-check overclaiming, omitted structural
  limit states, modulus-unit mismatch, and weak numerical/unit handling.
- `solar-time-calculator` — double angle conversion, timezone-sensitive date
  parsing, polar/non-finite handling, horizon-model, validation, and formatting
  defects.
- `timezone-converter` — the selected source timezone is ignored; browser-zone
  parsing and missing DST gap/fold handling make conversions unreliable.
- `speech-to-text` — browser Web Speech recognition can use a remote service,
  contradicting the public promise that microphone input is always local.
- `text-to-speech` — browser-selected synthesis voices can be network-backed,
  contradicting the page's unconditional local-only claim.

`moon-phase` is recorded as `rechecked` after correction. It is deliberately a
low-risk mean-cycle estimate, not an ephemeris; sampled 2026 phase times can
differ from U.S. Naval Observatory data by about 17.6 hours. The legacy
`moon-phase-calculator` source remains `pending` because redirect status does
not constitute an individual page audit.

## Ledger maintenance

From the repository root, run the manager without a record to refresh
physical-page coverage while preserving existing entries:

```sh
python3 scripts/manage_individual_tool_audit.py
```

The following command validates the 100 explicit entries in the second-wave
report, verifies that each referenced page exists, and changes only currently
`pending` entries to `rechecked`:

```sh
python3 scripts/manage_individual_tool_audit.py --sync-second-wave
```

The synchronization is idempotent and deliberately does not overwrite an
existing `findings`, `fixed`, `clean`, `auditing`, or `rechecked` result.

## Completion standard

A future project-wide audit should assign and evidence one page per review,
exercise functionality and boundary cases, assess security and bounded input
handling, check accessibility/responsive/theme behavior, record source and
method limitations, fix confirmed issues, and recheck the result. Repository
validation is a release gate, not a substitute for individual domain review.
