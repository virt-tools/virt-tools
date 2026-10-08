# Tool Risk and Trust Policy

File paths in this guide are relative to the repository root.

Virtual Tools is a browser-local utility catalog, not a substitute for a
qualified professional, an applicable code or standard, a listed product's
instructions, or an independently verified engineering model.

## Public maturity levels

- **Verified** — method and limits are documented, primary references are
  recorded, representative and boundary test vectors pass, and the review date
  and reviewer role are recorded.
- **Reviewed** — behavior and safety boundaries were reviewed, but the tool is
  not a certification method and may still require independent verification.
- **Draft** — useful for exploration, with explicit assumptions and validation,
  but not independently reviewed for consequential decisions.
- **Not reviewed** — no completed independent review is recorded.
- **Deprecated** — retained temporarily for compatibility while users move to a
  maintained replacement.

Quarantined is a publication state rather than a maturity label: quarantined
tools remain in source for correction or expert review and are not emitted into
the public catalog or runtime image. Missing maturity metadata is treated as not
reviewed, never as verified.

## Risk levels

- **Low** — text transformation, formatting, visualization, games, or similarly
  reversible output with limited consequences.
- **Moderate** — planning or numerical output where a wrong result may waste
  time or money but is not intended to protect life, health, or infrastructure.
- **High** — financial, health, structural, industrial, security, food-safety,
  surveying, or equipment output requiring prominent assumptions and review.
- **Critical** — life-safety, PPE, fire protection, electrical protection,
  lifting, diving, climbing, medication use, or other output that could directly
  influence an unsafe action. Critical tools remain quarantined until qualified
  domain review is recorded.

These classifications are internal publication controls. Public catalog cards,
filters, HTML metadata, and per-tool metadata do not expose the taxonomy. A
public tool shows plain-language verification guidance when its classification,
explicit metadata, or consequential domain warrants it; low-consequence tools
receive no generated notice. Quarantine and every release gate continue to use
the canonical classification.

## Required metadata for high and critical tools

The canonical catalog must record:

1. What the result does and does not determine.
2. Formula, algorithm, model version, and rounding behavior.
3. Required assumptions, valid ranges, units, and known exclusions.
4. Stable primary references and their edition or effective date.
5. Representative, boundary, invalid-input, and published-example test cases.
6. Review date, reviewer role, and a re-review trigger.

A disclaimer alone cannot promote a high-risk tool. The implementation and test
evidence must support its claims.

## Quarantine and relisting

`tool-risk-policy.json` contains the current conservative quarantine groups.
`tool-curation.json` must also unlist every quarantined slug. Source pages and
history are retained, but production images omit them. Relisting requires:

1. a scoped method and primary sources;
2. strict input and cross-field validation;
3. independent expected-value fixtures;
4. accessible explanations of assumptions and unavailable cases;
5. a qualified review recorded in the catalog; and
6. explicit removal from both quarantine and curation in the same reviewed
   change.

## Release gate

Every release runs `scripts/validate_risk_policy.py`. It fails when a
quarantined tool is public, when quarantine and curation disagree, when a
quarantine page is lost unexpectedly, or when the individual audit ledger no
longer accounts for every physical tool page.
