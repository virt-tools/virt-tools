# CLAUDE.md

Repository guidance for coding agents. See [README.md](README.md) for the app
layout and [OPERATIONS.md](OPERATIONS.md) for production operations.

## Invariants

- Tool inputs and calculations stay in the browser. Vendor dependencies under
  `frontend/vendor/`; do not add runtime CDNs or transmit tool inputs.
- Flask + SQLite handles anonymous feedback only. Administrative access is
  through `scripts/manage_feedback.py`, never a public list/admin endpoint.
- Preserve unlisted and redirect-source pages in Git for audit and compatibility.
  The build prunes them from the runtime image. Follow
  [RISK_AND_TRUST_POLICY.md](RISK_AND_TRUST_POLICY.md) before publishing
  quarantined or higher-risk tools.

## Sources of truth

- Edit `frontend/assets/tool-catalog.json`, not generated `tools.js` or
  `frontend/assets/tool-meta/*.json`. Regenerate with
  `python3 scripts/generate_tool_catalog.py frontend`.
- Edit `formula-workbenches.json` for generated formula tools, then run
  `python3 scripts/generate_formula_workbenches.py`.
- Maintain converter definitions and compatibility mappings as described in
  the README's unit-converter section.

## Verification and deployment

CI in `.github/workflows/` defines the validation, security, and browser gates.
Run the checks relevant to each change; the core checks include:

```bash
python3 scripts/generate_tool_catalog.py frontend --check
python3 scripts/generate_formula_workbenches.py --check
python3 scripts/validate_tools.py frontend
python3 scripts/validate_generated_conversions.py .
node scripts/validate_javascript.mjs frontend
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

API tests require the pinned dependencies in `api/requirements.txt`. See CI for
the remaining formula, design, risk, operational, and browser checks.

For local development, use Docker Compose as documented in the README. For
production, follow the blue-green release and rollback runbook in OPERATIONS;
do not replace the live stack with the local-development Compose commands.
Asset versions are deterministic hashes, including vendored assets, rather
than build timestamps.
