#!/usr/bin/env python3
"""Validate formula-workbench sources, generated routes, safety, and trust data."""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import generate_formula_workbenches as generator
from generate_tool_catalog import load_catalog


EXPECTED_EXCLUDED = {
    "arrow-front-of-center", "arrow-kinetic-energy", "arrow-trajectory-range",
    "bow-letoff-effective", "countersink-depth", "draw-length-estimator",
    "drilling-feed-rate", "lathe-cutting-time", "machining-feed-rate",
    "material-removal-rate", "pneumatic-air-consumption",
    "pneumatic-cylinder-force", "pump-power", "rocket-apogee",
    "rocket-burnout-velocity", "rocket-delta-v", "rocket-parachute-size",
    "rocket-thrust-to-weight", "spindle-speed-rpm", "tap-drill-size",
    "welding-fillet-volume", "welding-heat-input",
}
ADDITIONAL_QUARANTINE = {
    "solar-time-calculator", "timezone-converter", "bmi-calculator", "wire-gauge-calculator",
    "beam-deflection-calculator",
}
FORBIDDEN_JS = ("eval(", "new Function", ".innerHTML", "document.write")


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    frontend = root / "frontend"
    issues: list[str] = []

    try:
        document = generator.load_manifest(root / "formula-workbenches.json")
        issues.extend(generator.validate_manifest(document))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(exc)
        return 1

    workbenches = document["workbenches"]
    formulas = [formula for workbench in workbenches for formula in workbench["formulas"]]
    by_slug = {formula["slug"]: formula for formula in formulas}
    workbench_by_slug = {workbench["slug"]: workbench for workbench in workbenches}
    excluded = {item["slug"] for item in document["excluded"]}
    mapping = generator.redirect_mapping(document)

    if len(workbenches) != 9:
        issues.append(f"expected 9 workbenches, found {len(workbenches)}")
    if len(formulas) != 160:
        issues.append(f"expected 160 retained formulas, found {len(formulas)}")
    if excluded != EXPECTED_EXCLUDED:
        issues.append("formula exclusions differ from the approved 22-tool quarantine")
    if len(mapping) != len(formulas):
        issues.append("formula redirect map is incomplete or contains duplicate slugs")

    for formula in formulas:
        for field in formula["fields"]:
            if "min" not in field or "max" not in field:
                issues.append(f"{formula['slug']}.{field['id']}: missing explicit bounds")
            elif not math.isfinite(field["min"]) or not math.isfinite(field["max"]):
                issues.append(f"{formula['slug']}.{field['id']}: non-finite bounds")
        example = {field["id"]: field["example"] for field in formula["fields"]}
        try:
            values = generator.calculate_formula(formula, example)
            if not values or not all(math.isfinite(value) for value in values):
                issues.append(f"{formula['slug']}: example produced no finite output")
        except (ArithmeticError, ValueError, OverflowError) as exc:
            issues.append(f"{formula['slug']}: example failed: {exc}")

    for workbench in workbenches:
        if not any(formula["tests"] for formula in workbench["formulas"]):
            issues.append(f"{workbench['slug']}: no manifest-authored golden vector")

    def expect(condition: bool, message: str) -> None:
        if not condition:
            issues.append(message)

    expect(by_slug["hemisphere-properties"]["outputs"][0]["expression"] == "2*Math.PI*r*r", "hemisphere curved-area correction is missing")
    expect(by_slug["hohmann-transfer-period"]["outputs"][0]["expression"] == "0.5*Math.sqrt(Math.pow((r1+r2)/2,3))", "Hohmann half-transfer correction is missing")
    expect(by_slug["snell-refractive-index"]["fields"][1]["min"] > 0, "Snell denominator angle must be strictly positive")
    expect(next(field for field in by_slug["debroglie-wavelength"]["fields"] if field["id"] == "m")["min"] <= 9.109e-31, "de Broglie electron-mass input is outside bounds")
    expect("Math.log1p" in by_slug["future-value-annuity"]["outputs"][0]["expression"], "future annuity is not numerically stable")
    expect("Math.expm1" in by_slug["present-value-annuity"]["outputs"][0]["expression"], "present annuity is not numerically stable")
    expect(by_slug["future-value-annuity"]["cases"] == [{"when": "r===0", "outputs": ["PMT*n"]}], "future annuity zero-rate case is missing")
    expect(by_slug["present-value-annuity"]["cases"] == [{"when": "r===0", "outputs": ["PMT*n"]}], "present annuity zero-rate case is missing")
    expect([output["label"] for output in by_slug["bolt-circle-spacing"]["outputs"]] == ["Arc spacing", "Chord spacing", "Angular spacing"], "bolt-circle outputs are stale")
    expect(any(field["id"] == "allowance" for field in by_slug["wallpaper-roll-count"]["fields"]), "wallpaper generic allowance field is missing")
    expect(any(field["id"] == "bps" for field in by_slug["roofing-bundle-count"]["fields"]), "roofing product coverage input is missing")
    expect(next(field for field in by_slug["cycling-climbing-power"]["fields"] if field["id"] == "grade")["label"].endswith("(decimal ratio)"), "cycling grade convention is unclear")
    expect("6.67430e-11" in by_slug["gravitational-force"]["outputs"][0]["expression"], "current G constant is missing")
    expect("299792458" in by_slug["redshift-velocity"]["outputs"][0]["expression"], "exact c constant is missing")
    expect("6.62607015e-34" in by_slug["debroglie-wavelength"]["outputs"][0]["expression"], "exact Planck constant is missing")
    expect("5.670374419e-8" in by_slug["stefan-luminosity"]["outputs"][0]["expression"], "current Stefan-Boltzmann constant is missing")
    expect(generator._safe_ceil(1e-20) == 1, "safeCeil undercounts a tiny positive count")
    expect(generator._safe_ceil(1.0000000000000002) == 1, "safeCeil fails ULP-near integer")
    expect(generator._safe_ceil(1.00000000000001) == 2, "safeCeil undercounts a real fractional excess")

    rejection_cases = {
        "triangle-area-heron": {"a": 1, "b": 2, "c": 4},
        "annulus-area": {"R": 2, "r": 3},
        "conical-surface-area": {"r": 3, "l": 3},
        "torus-properties": {"R": 1, "r": 1},
        "spherical-cap-properties": {"R": 2, "h": 5},
        "break-even-units": {"fixed": 100, "price": 5, "vc": 5},
        "price-elasticity": {"pctQ": 2, "pctP": 0},
        "dice-success-probability": {"sides": 6, "target": 7},
        "escape-velocity": {"M": 1e32, "R": 1e-12},
    }
    for slug, values in rejection_cases.items():
        try:
            generator.calculate_formula(by_slug[slug], values)
            issues.append(f"{slug}: approved invalid-input rejection did not fire")
        except (ArithmeticError, ValueError, OverflowError):
            pass

    bound_rejections = {
        "snell-refractive-index": {"a1": 45, "a2": 0},
        "kinetic-energy-momentum": {"m": 1, "v": 29979246},
        "star-distance-modulus": {"m": 101, "M": 0},
    }
    for slug, values in bound_rejections.items():
        fields = {field["id"]: field for field in by_slug[slug]["fields"]}
        rejected = any(
            value < fields[field_id]["min"]
            or value > fields[field_id]["max"]
            or (fields[field_id].get("integer") and not float(value).is_integer())
            for field_id, value in values.items()
        )
        if not rejected:
            issues.append(f"{slug}: approved out-of-domain input remains inside declared bounds")

    issues.extend(generator.check_generated(document))

    runtime = frontend / "assets" / "formula-workbench.js"
    if not runtime.is_file():
        issues.append("frontend/assets/formula-workbench.js: shared runtime is missing")
    else:
        runtime_text = runtime.read_text(encoding="utf-8")
        for token in FORBIDDEN_JS:
            if token in runtime_text:
                issues.append(f"formula runtime contains prohibited source token {token!r}")
        if "NUMBER_PATTERN" not in runtime_text or "Number.isFinite" not in runtime_text:
            issues.append("formula runtime does not visibly enforce strict finite-number parsing")

    for workbench in workbenches:
        asset = frontend / "assets" / "formula-workbenches" / f"{workbench['slug']}.js"
        if asset.is_file():
            text = asset.read_text(encoding="utf-8")
            if "(function () {" not in text or "Object.freeze" not in text:
                issues.append(f"{asset.relative_to(root)}: generated functions are not isolated/frozen")
            for token in FORBIDDEN_JS:
                if token in text:
                    issues.append(f"{asset.relative_to(root)}: prohibited source token {token!r}")

    curation = json.loads((root / "tool-curation.json").read_text(encoding="utf-8"))
    redirects = curation.get("redirects", {})
    redirect_queries = curation.get("redirect_queries", {})
    unlisted = set(curation.get("unlist", []))
    for source, target in mapping.items():
        if redirects.get(source) != target:
            issues.append(f"{source}: formula redirect target is stale")
        if redirect_queries.get(source) != {"formula": source}:
            issues.append(f"{source}: exact formula redirect query is stale")
    for source in excluded | ADDITIONAL_QUARANTINE:
        if source not in unlisted:
            issues.append(f"{source}: approved quarantine is not in curation unlist")
        if source in redirects or source in redirect_queries:
            issues.append(f"{source}: quarantined source must not redirect")
    if "moon-phase-calculator" not in unlisted:
        issues.append("moon-phase-calculator: legacy source must remain unlisted")
    if redirects.get("moon-phase-calculator") != "moon-phase":
        issues.append("moon-phase-calculator: declarative canonical redirect is missing")
    if "moon-phase-calculator" in redirect_queries:
        issues.append("moon-phase-calculator: legacy redirect must not carry a formula query")
    if "moon-phase" in unlisted:
        issues.append("moon-phase: patched canonical estimate remains unlisted")

    redirects_text = (root / "nginx" / "tool-redirects.conf").read_text(encoding="utf-8")
    for source, target in mapping.items():
        expected_line = f"location = /tools/{source}/ {{ return 301 /tools/{target}/?formula={source}; }}"
        if expected_line not in redirects_text.splitlines():
            issues.append(f"nginx redirect does not preserve exact formula intent: {source}")

    _, catalog = load_catalog(frontend / "assets" / "tool-catalog.json")
    catalog_by_slug = {tool["slug"]: tool for tool in catalog}
    for source in set(mapping) | excluded | ADDITIONAL_QUARANTINE:
        record = catalog_by_slug.get(source)
        if record is not None and record.get("listed", True):
            issues.append(f"{source}: canonical source/quarantine record remains listed")
    moon = catalog_by_slug.get("moon-phase")
    if (
        moon is None
        or not moon.get("listed")
        or moon.get("risk") != "low"
        or moon.get("maturity") != "draft"
        or moon.get("reviewedAt") is not None
        or not moon.get("method")
        or not moon.get("sources")
        or len(moon.get("testCases", [])) < 2
    ):
        issues.append("moon-phase: canonical low-risk draft metadata is incomplete")
    for slug, workbench in workbench_by_slug.items():
        record = catalog_by_slug.get(slug)
        if record is None or not record.get("listed", False):
            issues.append(f"{slug}: public canonical workbench record is missing")
            continue
        expected_golden_count = sum(len(formula["tests"]) for formula in workbench["formulas"])
        if len(record.get("testCases", [])) != expected_golden_count:
            issues.append(f"{slug}: canonical recorded-test count includes non-golden checks")
        if any(test.get("kind") != "golden" for test in record.get("testCases", [])):
            issues.append(f"{slug}: canonical testCases contain a non-golden check")
        if record.get("maturity") != "draft" or record.get("reviewedAt") is not None:
            issues.append(f"{slug}: trust status overstates formula review")

    ledger = json.loads((root / "individual-tool-audit.json").read_text(encoding="utf-8"))
    ledger_slugs = {item.get("slug") for item in ledger.get("tools", [])}
    missing_ledger = set(workbench_by_slug) - ledger_slugs
    if missing_ledger:
        issues.append("formula workbenches missing from audit ledger: " + ", ".join(sorted(missing_ledger)))

    if issues:
        print("\n".join(issues))
        return 1
    print(
        f"Validated {len(formulas)} formulas, {len(workbenches)} workbenches, "
        f"{len(mapping)} intent-preserving redirects, and {len(excluded)} exclusions"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
