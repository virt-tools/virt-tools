# Individual Tool Audit Ledger

## Honest scope

[The audit ledger](../../data/individual-tool-audit.json) accounts for every physical
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
| Findings | 0 | No page currently records unresolved defects. |
| Fixed | 22 | A review recorded confirmed repairs; independent recheck is not implied by this status. |
| Rechecked | 101 | Documented fixes or corrected behavior were rechecked. |
| **Total** | **3,416** | Every physical page is represented exactly once. |

This is **123 pages with a recorded audit outcome (3.60%)** and **3,293 pages
still pending (96.40%)**. The completed evidence consists of 100 explicit
second-wave page reviews documented in
[the second-wave report](SECOND_WAVE_INDIVIDUAL_AUDIT.md), 22
fixed records (see [confirmed repairs](TOOL_REVIEW_FIXES.md)), and one
rechecked record. These figures do
not support a claim that every tool in the project has been individually
audited.

## Stabilization findings — status

The seven pages previously listed here as unresolved `findings` were repaired
in the 2026-10-09 third-wave fix pass (details in
[confirmed repairs](TOOL_REVIEW_FIXES.md)); their ledger records now read
`fixed`:

- `bmi-calculator`, `wire-gauge-calculator`, `beam-deflection-calculator`,
  `solar-time-calculator`, `timezone-converter`, `speech-to-text`,
  `text-to-speech`.

The health/safety/electrical pages (`bmi-calculator`, `wire-gauge-calculator`,
`beam-deflection-calculator`, `solar-time-calculator`) remain quarantined and
unlisted: per the risk policy, relisting requires a qualified domain review,
which this fix pass does not provide. `speech-to-text` and `text-to-speech`
remain quarantined pending the same relisting process.

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
