# Converter Consolidation Summary

## Outcome

- Consolidated 1,047 pair-specific converters into 37 quantity-level tools.
- Each canonical tool supports every compatible unit through From and To
  selectors, bidirectional swapping, and live conversion.
- No CSS tools were added.
- The public registry now contains 990 useful tools.

## Link preservation

- All 1,047 former pair URLs are retained on disk and permanently redirect to
  the appropriate quantity converter.
- Together with 18 earlier duplicate-route redirects, Nginx serves 1,065 exact
  permanent redirects.
- The 334 previously unlisted legacy pages remain available directly.

## Architecture and validation

- `scripts/consolidate_conversion_tools.py` generates the 37 canonical pages,
  registry entries, manifest, and compatibility mapping.
- `frontend/assets/unit-converter.js` supplies shared selector, conversion,
  swap, formatting, and rendering behavior.
- `generated-conversion-tools.json` records canonical unit definitions and all
  legacy redirect mappings.
- `scripts/validate_generated_conversions.py` verifies exact counts, page and
  manifest agreement, finite scales and offsets, every within-quantity unit
  round trip, retained legacy pages, and complete redirect coverage.
- Runtime verification loaded all 37 canonical pages and checked the exact 301
  destination of all 1,047 legacy URLs with zero failures.
