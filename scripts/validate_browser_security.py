#!/usr/bin/env python3
"""Fail on high-confidence browser injection regressions.

This deliberately small static gate covers dangerous raw-HTML APIs, output
inserted into HTML-built textareas, direct form values sent to innerHTML,
runtime string compilation, unsafe static URL schemes, opener isolation, and
unsandboxed srcdoc previews. Existing reviewed false positives use whole-file
hashes so any edit forces a fresh review.
"""

from __future__ import annotations

import hashlib
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "scripts" / "browser-security-policy.json"
FIXTURES_PATH = ROOT / "tests" / "security" / "malicious-inputs.json"

LINE_RULES = {
    "document-write": re.compile(r"(?:\b|\.)document\.write\s*\("),
    "dynamic-textarea-html": re.compile(r"innerHTML\s*=.*<textarea", re.I),
    "direct-value-innerhtml": re.compile(
        r"innerHTML\s*=.*(?:\.value\b|getElementById\([^)]*\)\.value)"
    ),
    "dangerous-static-url": re.compile(
        r"(?:href|src)\s*=\s*['\"]\s*(?:javascript|vbscript|data\s*:\s*text/html)\s*:",
        re.I,
    ),
    "dynamic-code-execution": re.compile(
        r"\beval\s*\(|\bnew\s+Function\s*\(|(?<![\w.])Function\s*\("
    ),
}
RAW_SINK = re.compile(r"(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(|(?:\b|\.)document\.write\s*\(")
SRCDOC_ASSIGN = re.compile(r"\b([A-Za-z_$][\w$]*)\.srcdoc\s*=")
BLANK_ANCHOR = re.compile(r"<a\b[^>]*\btarget\s*=\s*['\"]_blank['\"][^>]*>", re.I | re.S)
REL_VALUE = re.compile(r"\brel\s*=\s*['\"]([^'\"]*)['\"]", re.I)
WINDOW_OPEN = re.compile(r"\bwindow\.open\s*\([^;\n]+")
JSONPATH_SAFE_MODE = re.compile(r"\beval\s*:\s*['\"]safe['\"]")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_url(value: str) -> str:
    value = value.strip()
    lowered = value.lower()
    if lowered.startswith(("http://", "https://", "mailto:")):
        return value
    if value.startswith(("#", "/", "?", "./", "../")):
        return value
    return "#"


def sandboxed(source: str, variable: str) -> bool:
    escaped = re.escape(variable)
    dynamic = re.search(
        rf"\b{escaped}\.setAttribute\s*\(\s*['\"]sandbox['\"]\s*,\s*['\"]['\"]\s*\)",
        source,
    )
    static = re.search(r"<iframe\b[^>]*\bsandbox(?:\s*=\s*['\"][^'\"]*['\"])?", source, re.I)
    return bool(dynamic or static)


def main() -> int:
    policy = json.loads(POLICY_PATH.read_text(encoding="utf-8"))
    fixtures = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    errors: list[str] = []
    findings: list[tuple[str, str, int, str]] = []
    sources: dict[str, str] = {}
    hashes: dict[str, str] = {}

    for path in sorted((ROOT / "frontend").rglob("*.html")):
        rel = path.relative_to(ROOT).as_posix()
        source = path.read_text(encoding="utf-8")
        sources[rel] = source
        hashes[rel] = digest(path)
        for number, line in enumerate(source.splitlines(), 1):
            for rule, pattern in LINE_RULES.items():
                if pattern.search(line):
                    findings.append((rel, rule, number, line.strip()[:180]))
        for match in SRCDOC_ASSIGN.finditer(source):
            if not sandboxed(source, match.group(1)):
                number = source.count("\n", 0, match.start()) + 1
                findings.append((rel, "unsandboxed-srcdoc", number, match.group(0)))
        for match in BLANK_ANCHOR.finditer(source):
            rel_value = REL_VALUE.search(match.group(0))
            tokens = set(rel_value.group(1).lower().split()) if rel_value else set()
            if "noopener" not in tokens:
                number = source.count("\n", 0, match.start()) + 1
                findings.append((rel, "blank-link-with-opener", number, match.group(0)[:180]))
        for match in WINDOW_OPEN.finditer(source):
            call = match.group(0).lower()
            if "noopener" not in call or "noreferrer" not in call:
                number = source.count("\n", 0, match.start()) + 1
                findings.append((rel, "window-open-with-opener", number, match.group(0)[:180]))
        if "/vendor/jsonpath-plus.min.js" in source and not JSONPATH_SAFE_MODE.search(source):
            findings.append((rel, "jsonpath-eval-mode-not-pinned", 1, "jsonpath-plus loaded without eval: safe"))

    # Web Speech implementations may delegate recognition or synthesis to a
    # browser/vendor service. Until trust metadata can disclose that capability
    # per tool, these pages must remain source-retained but absent from runtime.
    curation = json.loads((ROOT / "tool-curation.json").read_text(encoding="utf-8"))
    unlisted = set(curation.get("unlist", []))
    browser_service_markers = (
        "SpeechRecognition",
        "webkitSpeechRecognition",
        "speechSynthesis",
        "SpeechSynthesisUtterance",
    )
    for rel, source in sources.items():
        if not any(marker in source for marker in browser_service_markers):
            continue
        match = re.fullmatch(r"frontend/tools/([a-z0-9-]+)/index\.html", rel)
        if not match or match.group(1) not in unlisted:
            errors.append(
                f"{rel}: browser-mediated speech service must be explicitly unlisted "
                "until capability-aware privacy disclosure exists"
            )

    nonvendor_scripts = 0
    dynamic_code = LINE_RULES["dynamic-code-execution"]
    for path in sorted((ROOT / "frontend").rglob("*.js")):
        rel = path.relative_to(ROOT).as_posix()
        if "vendor" in path.relative_to(ROOT / "frontend").parts:
            continue
        nonvendor_scripts += 1
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if dynamic_code.search(line):
                errors.append(f"{rel}:{number}: dynamic-code-execution: {line.strip()[:180]}")

    exceptions = {(item["path"], item["rule"]): item for item in policy["exceptions"]}
    used: set[tuple[str, str]] = set()
    for rel, rule, number, excerpt in findings:
        key = (rel, rule)
        exception = exceptions.get(key)
        if exception and hashes.get(rel) == exception.get("sha256") and exception.get("reason"):
            used.add(key)
            continue
        errors.append(f"{rel}:{number}: {rule}: {excerpt}")

    for key, exception in exceptions.items():
        path = ROOT / exception["path"]
        if not path.is_file():
            errors.append(f"Security exception references missing file: {exception['path']}")
        elif digest(path) != exception["sha256"]:
            errors.append(f"Security exception hash is stale; re-review {exception['path']} ({exception['rule']})")
        elif key not in used:
            errors.append(f"Security exception is no longer needed: {exception['path']} ({exception['rule']})")

    for rel in policy["sink_free_files"]:
        source = sources.get(rel)
        if source is None:
            errors.append(f"Sink-free policy references missing HTML file: {rel}")
        elif match := RAW_SINK.search(source):
            number = source.count("\n", 0, match.start()) + 1
            errors.append(f"{rel}:{number}: reviewed sink-free file reintroduced {match.group(0)!r}")

    for asset in policy.get("reviewed_assets", []):
        path = ROOT / asset["path"]
        if not path.is_file():
            errors.append(f"Reviewed security asset is missing: {asset['path']}")
        elif digest(path) != asset.get("sha256"):
            errors.append(f"Reviewed security asset changed; re-review and update hash: {asset['path']}")
        elif not asset.get("reason"):
            errors.append(f"Reviewed security asset lacks a reason: {asset['path']}")

    # Exercise the attack corpus against the same escaping and URL policy the
    # reviewed pages are required to expose in source.
    for fixture in fixtures:
        value = fixture["value"]
        if fixture["kind"] == "text":
            escaped = html.escape(value, quote=True)
            for token in fixture.get("must_escape", []):
                if token in escaped:
                    errors.append(f"Fixture {fixture['name']} left {token!r} unescaped")
        elif fixture["kind"] == "url":
            result = safe_url(value)
            if "expected" in fixture and result != fixture["expected"]:
                errors.append(f"Fixture {fixture['name']} URL result was {result!r}")
            if "expected_scheme" in fixture and urlsplit(result).scheme != fixture["expected_scheme"]:
                errors.append(f"Fixture {fixture['name']} URL scheme was not preserved")
            escaped = html.escape(result, quote=True)
            for token in fixture.get("must_escape", []):
                if token in escaped:
                    errors.append(f"Fixture {fixture['name']} left {token!r} unescaped")
        elif fixture["kind"] == "expression":
            normalized = re.sub(r"\bMath\s*\.", "", value)
            grammar = bool(re.fullmatch(r"[\dA-Za-z_\s+\-*/%^(),.]+", normalized))
            forbidden = bool(
                re.search(
                    r"\b(?:constructor|prototype|__proto__|globalThis|window|document|fetch|"
                    r"XMLHttpRequest|WebSocket|EventSource|Function|eval|import)\b",
                    normalized,
                    re.I,
                )
            )
            accepted = grammar and not forbidden
            expected = fixture.get("expected")
            if expected == "rejected" and accepted:
                errors.append(f"Fixture {fixture['name']} dangerous expression was accepted")
            elif expected == "accepted" and not accepted:
                errors.append(f"Fixture {fixture['name']} safe expression was rejected")
        else:
            errors.append(f"Unknown malicious fixture kind: {fixture.get('kind')}")

    required_markers = {
        "frontend/tools/markdown-to-html/index.html": ["safeUrl", "setAttribute('sandbox','')", "escapeAttr"],
        "frontend/tools/markdown-preview/index.html": ["safeUrl", "sandbox=\"\"", "escapeAttr"],
        "frontend/tools/markdown-to-pdf/index.html": ["safeUrl", "setAttribute('sandbox','')", "escapeAttr"],
        "frontend/tools/html-to-markdown/index.html": ["safeUrl", "output.value=value"],
        "frontend/feedback/index.html": [
            "UUID_RE", "encodeURIComponent(id)", "vt.feedback.ids.v1",
            '"received", "reviewing", "planned", "resolved", "closed", "completed", "rejected"',
        ],
        "frontend/tools/number-series-sum/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "100,000 terms"],
        "frontend/tools/derivative-calculator/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "Number.isFinite"],
        "frontend/tools/integral-calculator/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "100000"],
        "frontend/tools/limit-calculator/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "evaluator"],
        "frontend/tools/scientific-calculator/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "replaceChildren"],
        "frontend/tools/csv-formula/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "never executed as JavaScript"],
        "frontend/tools/monte-carlo/index.html": ["/assets/math-expression.js", "VTMathExpression.compile", "1000000"],
        "frontend/tools/jsonpath-evaluator/index.html": ['eval: "safe"'],
        "frontend/tools/reading-list/index.html": ["safeUrl", "noopener noreferrer", "function store"],
        "frontend/tools/badge-generator/index.html": ["safeUrl", "revokeObjectURL"],
        "frontend/tools/strip-html-tags/index.html": ["safeUrl", "referrerPolicy"],
    }
    for rel, markers in required_markers.items():
        source = sources.get(rel, "")
        for marker in markers:
            if marker not in source:
                errors.append(f"{rel}: missing reviewed security marker {marker!r}")

    if errors:
        print("Browser security validation failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(
        f"Validated {len(sources)} HTML files, {len(policy['sink_free_files'])} sink-free reviews, "
        f"{len(exceptions)} hash-pinned exceptions, {len(policy.get('reviewed_assets', []))} reviewed security asset, "
        f"{nonvendor_scripts} non-vendor scripts, and {len(fixtures)} malicious fixtures."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
