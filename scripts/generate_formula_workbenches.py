#!/usr/bin/env python3
"""Generate consolidated formula workbenches from a declarative manifest.

The manifest contains trusted arithmetic expressions. They are validated with a
small allowlist and emitted as static JavaScript functions at build time. The
browser runtime never evaluates expression strings.
"""

from __future__ import annotations

import argparse
import ast
import html
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

from generate_tool_catalog import load_catalog, normalize_entry


SCRIPT_PATH = Path(__file__).resolve()
# The source tree keeps this file under scripts/, while the deliberately small
# Docker validation stage copies it directly into /build. Resolve the project
# root correctly in both layouts instead of depending on an ambient cwd.
ROOT = SCRIPT_PATH.parents[1] if SCRIPT_PATH.parent.name == "scripts" else SCRIPT_PATH.parent
MANIFEST = ROOT / "formula-workbenches.json"
SCHEMA = ROOT / "formula-workbenches.schema.json"
FRONTEND = ROOT / "frontend"
ASSET_DIR = FRONTEND / "assets" / "formula-workbenches"
ADDED = "2026-08-19T00:00:00Z"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FIELD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
NUMBER_RE = re.compile(r"(?<![A-Za-z0-9_])(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
SAFE_EXPRESSION_RE = re.compile(r"^[A-Za-z0-9_+*/().,\-\s]+$")
SAFE_GUARD_RE = re.compile(r"^[A-Za-z0-9_+*/().,<>!=&|\-\s]+$")
MATH_MEMBERS = {
    "PI", "sqrt", "pow", "sin", "cos", "tan", "atan", "log", "log1p",
    "expm1", "ceil", "round",
}
SAFE_HELPERS = {"safeCeil"}
PROHIBITED_FIELD_IDS = {
    "Math", "__proto__", "constructor", "prototype", "eval", "Function",
    "window", "document", "var", "let", "const", "return", "function",
    "class", "new", "default", "delete", "this", "typeof", "void", "with",
    "yield", "await", "import", "export", "extends", "super", "static",
    "switch", "case", "break", "continue", "do", "while", "for", "if",
    "else", "try", "catch", "finally", "throw", "in", "instanceof", "of",
    "true", "false", "null", "enum", "implements", "interface", "package",
    "private", "protected", "public",
}


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="/assets/theme-init.js"></script>
  <title>{title} — Virtual Tools</title>
  <meta name="description" content="{description_attr}">
  <link rel="stylesheet" href="/assets/style.css">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
  <header id="site-header"></header>
  <main class="tool-container formula-workbench">
    <div class="tool-header">
      <a class="back" href="/">← All tools</a>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    <section class="panel formula-picker" aria-labelledby="formula-picker-title">
      <h2 id="formula-picker-title">Choose a formula</h2>
      <div class="formula-picker-grid">
        <div>
          <label for="formula-search">Filter formulas</label>
          <input id="formula-search" type="search" autocomplete="off" spellcheck="false" placeholder="Search this workbench…">
        </div>
        <div>
          <label for="formula-select">Formula</label>
          <select id="formula-select"></select>
        </div>
      </div>
      <p id="formula-filter-status" class="note" role="status" aria-live="polite"></p>
    </section>
    <section class="panel formula-calculator" aria-labelledby="selected-formula-title">
      <h2 id="selected-formula-title"></h2>
      <p id="selected-formula-description" class="subtitle"></p>
      <form id="formula-form" novalidate>
        <div id="formula-fields" class="formula-fields"></div>
        <div class="formula-actions">
          <button type="submit">Calculate</button>
          <button id="formula-example" class="secondary" type="button">Load example</button>
          <button id="formula-reset" class="secondary" type="button">Reset</button>
          <button id="formula-copy" class="secondary" type="button" disabled>Copy results</button>
        </div>
      </form>
      <p id="formula-error" class="formula-error" role="alert" aria-live="assertive"></p>
      <section id="formula-results" class="formula-results" aria-label="Calculation results" aria-live="polite" aria-atomic="true" hidden></section>
      <div class="formula-assumptions">
        <h3>Formula and assumptions</h3>
        <p id="formula-note"></p>
        <p>Use the displayed units consistently. This is an idealized estimate; verify important results against authoritative methods and domain requirements.</p>
      </div>
    </section>
    <script id="formula-workbench-config" type="application/json">{config}</script>
  </main>
  <script src="/assets/app.js"></script>
  <script src="/assets/formula-workbenches/{slug}.js"></script>
  <script src="/assets/formula-workbench.js"></script>
</body>
</html>
"""


def load_manifest(path: Path = MANIFEST) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("formula manifest must be an object")
    return document


def expression_identifiers(expression: str) -> set[str]:
    without_numbers = NUMBER_RE.sub("0", expression)
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", without_numbers))


def validate_expression(expression: str, fields: set[str], label: str) -> list[str]:
    issues: list[str] = []
    if not isinstance(expression, str) or not expression or len(expression) > 500:
        return [f"{label}: expression must contain 1–500 characters"]
    if not SAFE_EXPRESSION_RE.fullmatch(expression):
        issues.append(f"{label}: expression contains a prohibited character")
    if expression.count("(") != expression.count(")"):
        issues.append(f"{label}: unbalanced parentheses")
    dotted = re.findall(r"([A-Za-z_]\w*)\.([A-Za-z_]\w*)", expression)
    for owner, member in dotted:
        if owner != "Math" or member not in MATH_MEMBERS:
            issues.append(f"{label}: prohibited member access {owner}.{member}")
    identifiers = expression_identifiers(expression)
    allowed = fields | {"Math"} | MATH_MEMBERS | SAFE_HELPERS
    unknown = identifiers - allowed
    if unknown:
        issues.append(f"{label}: unknown identifiers: {', '.join(sorted(unknown))}")
    for bad in ("eval", "Function", "constructor", "prototype", "__proto__", "window", "document"):
        if bad in identifiers:
            issues.append(f"{label}: prohibited identifier {bad}")
    return issues


def validate_guard(expression: str, fields: set[str], label: str) -> list[str]:
    issues: list[str] = []
    if not isinstance(expression, str) or not expression or len(expression) > 500:
        return [f"{label}: guard must contain 1–500 characters"]
    if not SAFE_GUARD_RE.fullmatch(expression):
        issues.append(f"{label}: guard contains a prohibited character")
    if expression.count("(") != expression.count(")"):
        issues.append(f"{label}: unbalanced parentheses")
    if re.search(r"(?<![=!<>])=(?!=)", expression):
        issues.append(f"{label}: assignment is prohibited")
    if expression_identifiers(expression) - fields:
        issues.append(f"{label}: guard may reference declared fields only")
    return issues


def validate_manifest(document: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if document.get("$schema") != "./formula-workbenches.schema.json":
        issues.append("formula-workbenches.json: invalid $schema")
    if document.get("version") != 1:
        issues.append("formula-workbenches.json: version must be 1")
    if set(document) - {"$schema", "version", "limits", "excluded", "workbenches"}:
        issues.append("formula-workbenches.json: unsupported top-level fields")
    limits = document.get("limits")
    if not isinstance(limits, dict):
        return issues + ["formula-workbenches.json: limits must be an object"]
    expected_limits = {"maxInputCharacters", "maxAbsoluteInput", "maxFieldsPerFormula", "maxOutputsPerFormula"}
    if set(limits) != expected_limits:
        issues.append("formula-workbenches.json: limits fields do not match schema")
    max_fields = limits.get("maxFieldsPerFormula", 0)
    max_outputs = limits.get("maxOutputsPerFormula", 0)
    max_abs = limits.get("maxAbsoluteInput", 0)
    if not isinstance(max_fields, int) or not 1 <= max_fields <= 20:
        issues.append("limits.maxFieldsPerFormula must be 1–20")
    if not isinstance(max_outputs, int) or not 1 <= max_outputs <= 20:
        issues.append("limits.maxOutputsPerFormula must be 1–20")
    if not isinstance(max_abs, (int, float)) or not math.isfinite(max_abs) or max_abs <= 0:
        issues.append("limits.maxAbsoluteInput must be positive and finite")

    excluded = document.get("excluded")
    excluded_slugs: set[str] = set()
    if not isinstance(excluded, list):
        issues.append("formula-workbenches.json: excluded must be an array")
        excluded = []
    for item in excluded:
        if not isinstance(item, dict) or set(item) != {"slug", "reason"}:
            issues.append("excluded entry must contain slug and reason")
            continue
        excluded_slug = item.get("slug")
        if not isinstance(excluded_slug, str) or not SLUG_RE.fullmatch(excluded_slug):
            issues.append(f"invalid excluded slug: {excluded_slug!r}")
        elif excluded_slug in excluded_slugs:
            issues.append(f"duplicate excluded slug: {excluded_slug}")
        excluded_slugs.add(excluded_slug)
        if not isinstance(item.get("reason"), str) or not item["reason"].strip():
            issues.append(f"{excluded_slug}: exclusion reason is required")

    workbenches = document.get("workbenches")
    if not isinstance(workbenches, list) or not workbenches:
        return issues + ["formula-workbenches.json: workbenches must be a non-empty array"]
    workbench_slugs: set[str] = set()
    formula_slugs: set[str] = set()
    for workbench in workbenches:
        if not isinstance(workbench, dict):
            issues.append("workbench entry must be an object")
            continue
        slug = workbench.get("slug", "<unknown>")
        expected_keys = {"slug", "name", "description", "category", "subcategory", "icon", "risk", "formulas"}
        if set(workbench) != expected_keys:
            issues.append(f"{slug}: workbench fields do not match schema")
        if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
            issues.append(f"{slug}: invalid workbench slug")
        elif slug in workbench_slugs:
            issues.append(f"duplicate workbench slug: {slug}")
        workbench_slugs.add(slug)
        for key in ("name", "description", "category", "subcategory", "icon"):
            if not isinstance(workbench.get(key), str) or not workbench[key].strip():
                issues.append(f"{slug}: {key} must be a non-empty string")
        if workbench.get("risk") not in {"low", "moderate", "high", "critical"}:
            issues.append(f"{slug}: invalid risk")
        formulas = workbench.get("formulas")
        if not isinstance(formulas, list) or not formulas or len(formulas) > 64:
            issues.append(f"{slug}: formulas must contain 1–64 entries")
            continue
        for formula in formulas:
            if not isinstance(formula, dict):
                issues.append(f"{slug}: formula must be an object")
                continue
            formula_slug = formula.get("slug", "<unknown>")
            if set(formula) != {"slug", "name", "description", "fields", "outputs", "note", "guards", "cases", "tests"}:
                issues.append(f"{formula_slug}: formula fields do not match schema")
            if not isinstance(formula_slug, str) or not SLUG_RE.fullmatch(formula_slug):
                issues.append(f"{formula_slug}: invalid formula slug")
            elif formula_slug in formula_slugs or formula_slug in workbench_slugs:
                issues.append(f"duplicate formula slug: {formula_slug}")
            formula_slugs.add(formula_slug)
            for key in ("name", "description", "note"):
                if not isinstance(formula.get(key), str) or not formula[key].strip():
                    issues.append(f"{formula_slug}: {key} must be a non-empty string")
            fields = formula.get("fields")
            outputs = formula.get("outputs")
            if not isinstance(fields, list) or not 1 <= len(fields) <= max_fields:
                issues.append(f"{formula_slug}: invalid field count")
                continue
            field_ids: set[str] = set()
            for field in fields:
                if not isinstance(field, dict):
                    issues.append(f"{formula_slug}: field must be an object")
                    continue
                allowed_field_keys = {"id", "label", "unit", "placeholder", "example", "integer", "min", "max"}
                if set(field) - allowed_field_keys or not {"id", "label", "unit", "placeholder", "example"} <= set(field):
                    issues.append(f"{formula_slug}: field keys do not match schema")
                field_id = field.get("id")
                if (
                    not isinstance(field_id, str)
                    or not FIELD_RE.fullmatch(field_id)
                    or field_id in PROHIBITED_FIELD_IDS | SAFE_HELPERS | MATH_MEMBERS
                ):
                    issues.append(f"{formula_slug}: invalid field id {field_id!r}")
                elif field_id in field_ids:
                    issues.append(f"{formula_slug}: duplicate field id {field_id}")
                field_ids.add(field_id)
                if not isinstance(field.get("label"), str) or not field["label"].strip():
                    issues.append(f"{formula_slug}.{field_id}: label is required")
                if not isinstance(field.get("unit"), str) or not isinstance(field.get("placeholder"), str):
                    issues.append(f"{formula_slug}.{field_id}: unit and placeholder must be strings")
                example = field.get("example")
                if not isinstance(example, (int, float)) or not math.isfinite(example) or abs(example) > max_abs:
                    issues.append(f"{formula_slug}.{field_id}: example is invalid")
                if field.get("integer") is not None and not isinstance(field.get("integer"), bool):
                    issues.append(f"{formula_slug}.{field_id}: integer must be boolean")
                for bound in ("min", "max"):
                    if bound not in field:
                        issues.append(f"{formula_slug}.{field_id}: explicit {bound} is required")
                    elif not isinstance(field[bound], (int, float)) or not math.isfinite(field[bound]):
                        issues.append(f"{formula_slug}.{field_id}: {bound} must be finite")
                if field.get("min") is not None and field.get("max") is not None and field["min"] > field["max"]:
                    issues.append(f"{formula_slug}.{field_id}: min exceeds max")
                if (
                    isinstance(example, (int, float))
                    and isinstance(field.get("min"), (int, float))
                    and isinstance(field.get("max"), (int, float))
                    and not field["min"] <= example <= field["max"]
                ):
                    issues.append(f"{formula_slug}.{field_id}: example is outside declared bounds")
                if field.get("integer"):
                    for label_name, value in (
                        ("example", example), ("min", field.get("min")), ("max", field.get("max")),
                    ):
                        if isinstance(value, (int, float)) and not float(value).is_integer():
                            issues.append(f"{formula_slug}.{field_id}: integer {label_name} must be integral")
            if not isinstance(outputs, list) or not 1 <= len(outputs) <= max_outputs:
                issues.append(f"{formula_slug}: invalid output count")
                continue
            for index, output in enumerate(outputs):
                label = f"{formula_slug}.outputs[{index}]"
                if not isinstance(output, dict) or set(output) != {"label", "expression", "unit"}:
                    issues.append(f"{label}: output fields do not match schema")
                    continue
                if not isinstance(output.get("label"), str) or not output["label"].strip() or not isinstance(output.get("unit"), str):
                    issues.append(f"{label}: label/unit is invalid")
                issues.extend(validate_expression(output.get("expression"), field_ids, label))
            guards = formula.get("guards")
            if not isinstance(guards, list):
                issues.append(f"{formula_slug}: guards must be an array")
                guards = []
            for index, guard in enumerate(guards):
                label = f"{formula_slug}.guards[{index}]"
                if not isinstance(guard, dict) or set(guard) != {"expression", "message"}:
                    issues.append(f"{label}: guard fields do not match schema")
                    continue
                issues.extend(validate_guard(guard.get("expression"), field_ids, label))
                if not isinstance(guard.get("message"), str) or not guard["message"].strip():
                    issues.append(f"{label}: message is required")
            cases = formula.get("cases")
            if not isinstance(cases, list):
                issues.append(f"{formula_slug}: cases must be an array")
                cases = []
            for index, case in enumerate(cases):
                label = f"{formula_slug}.cases[{index}]"
                if not isinstance(case, dict) or set(case) != {"when", "outputs"}:
                    issues.append(f"{label}: case fields do not match schema")
                    continue
                issues.extend(validate_guard(case.get("when"), field_ids, label + ".when"))
                case_outputs = case.get("outputs")
                if not isinstance(case_outputs, list) or len(case_outputs) != len(outputs):
                    issues.append(f"{label}: case output count must match formula outputs")
                else:
                    for output_index, expression in enumerate(case_outputs):
                        issues.extend(validate_expression(expression, field_ids, f"{label}.outputs[{output_index}]"))
            tests = formula.get("tests")
            if not isinstance(tests, list):
                issues.append(f"{formula_slug}: tests must be an array")
                tests = []
            for index, test in enumerate(tests):
                label = f"{formula_slug}.tests[{index}]"
                if not isinstance(test, dict) or set(test) != {"name", "input", "expected"}:
                    issues.append(f"{label}: test fields do not match schema")
                    continue
                if not isinstance(test.get("name"), str) or not test["name"].strip():
                    issues.append(f"{label}: test name is required")
                inputs = test.get("input")
                expected = test.get("expected")
                if not isinstance(inputs, dict) or set(inputs) != field_ids:
                    issues.append(f"{label}: test input must cover every field exactly")
                elif any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in inputs.values()):
                    issues.append(f"{label}: test inputs must be finite numbers")
                else:
                    fields_by_id = {field["id"]: field for field in fields}
                    for field_id, value in inputs.items():
                        field = fields_by_id[field_id]
                        if not field["min"] <= value <= field["max"]:
                            issues.append(f"{label}: {field_id} is outside declared bounds")
                        if field.get("integer") and not float(value).is_integer():
                            issues.append(f"{label}: {field_id} must be an integer")
                if not isinstance(expected, list) or len(expected) != len(outputs) or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in (expected or [])):
                    issues.append(f"{label}: expected values must match output count and be finite")
    if workbench_slugs & formula_slugs:
        issues.append("workbench and formula slugs overlap")
    overlap = excluded_slugs & formula_slugs
    if overlap:
        issues.append("excluded formulas remain in workbenches: " + ", ".join(sorted(overlap)))
    return issues


def _js_round(value: float) -> float:
    return math.floor(value + 0.5)


SAFE_FUNCTIONS = {
    "sqrt": math.sqrt,
    "pow": math.pow,
    "sin": math.sin,
    "cos": math.cos,
    "tan": math.tan,
    "atan": math.atan,
    "log": math.log,
    "log1p": math.log1p,
    "expm1": math.expm1,
    "ceil": math.ceil,
    "round": _js_round,
}


def _safe_ceil(value: float) -> int:
    nearest = round(value)
    scale = max(abs(value), abs(nearest), sys.float_info.min)
    tolerance = sys.float_info.epsilon * scale * 4
    return nearest if abs(value - nearest) <= tolerance else math.ceil(value)


SAFE_FUNCTIONS["safeCeil"] = _safe_ceil


def _parse_expression(expression: str, *, condition: bool = False) -> ast.Expression:
    translated = expression.replace("Math.PI", "pi")
    for member in MATH_MEMBERS - {"PI"}:
        translated = translated.replace(f"Math.{member}", member)
    if condition:
        translated = translated.replace("===", "==").replace("&&", " and ").replace("||", " or ")
    tree = ast.parse(translated, mode="eval")
    if sum(1 for _ in ast.walk(tree)) > 120:
        raise ValueError("expression is too complex")
    return tree

def _evaluate_tree(tree: ast.Expression, values: dict[str, float]) -> float | bool:
    def visit(node: ast.AST) -> float | bool:
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id == "pi":
                return math.pi
            if node.id in values:
                return float(values[node.id])
            raise ValueError(f"unknown name {node.id}")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand)
            return value if isinstance(node.op, ast.UAdd) else -value
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            return left / right
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in SAFE_FUNCTIONS:
            if node.keywords:
                raise ValueError("keyword arguments are prohibited")
            return float(SAFE_FUNCTIONS[node.func.id](*(visit(arg) for arg in node.args)))
        if isinstance(node, ast.Compare) and len(node.ops) == len(node.comparators) == 1:
            left, right = float(visit(node.left)), float(visit(node.comparators[0]))
            operator = node.ops[0]
            if isinstance(operator, ast.Eq): return left == right
            if isinstance(operator, ast.NotEq): return left != right
            if isinstance(operator, ast.Lt): return left < right
            if isinstance(operator, ast.LtE): return left <= right
            if isinstance(operator, ast.Gt): return left > right
            if isinstance(operator, ast.GtE): return left >= right
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            results = [bool(visit(value)) for value in node.values]
            return all(results) if isinstance(node.op, ast.And) else any(results)
        raise ValueError(f"prohibited syntax {type(node).__name__}")
    return visit(tree)


def evaluate_expression(expression: str, values: dict[str, float]) -> float:
    result = float(_evaluate_tree(_parse_expression(expression), values))
    if not math.isfinite(result):
        raise ValueError("non-finite example result")
    return result


def evaluate_guard(expression: str, values: dict[str, float]) -> bool:
    return bool(_evaluate_tree(_parse_expression(expression, condition=True), values))


def calculate_formula(formula: dict[str, Any], values: dict[str, float]) -> list[float]:
    for guard in formula["guards"]:
        if not evaluate_guard(guard["expression"], values):
            raise ValueError(guard["message"])
    expressions = [output["expression"] for output in formula["outputs"]]
    for case in formula["cases"]:
        if evaluate_guard(case["when"], values):
            expressions = case["outputs"]
            break
    return [evaluate_expression(expression, values) for expression in expressions]


def formula_examples(workbench: dict[str, Any]) -> list[dict[str, Any]]:
    tests = []
    for formula in workbench["formulas"]:
        inputs = {field["id"]: field["example"] for field in formula["fields"]}
        expected = calculate_formula(formula, inputs)
        tests.append({"name": formula["slug"] + " finite example smoke", "kind": "example-smoke", "input": inputs, "expected": expected})
        for test in formula["tests"]:
            tests.append({**test, "kind": "golden"})
    return tests


def config_for(workbench: dict[str, Any], limits: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": workbench["slug"],
        "limits": limits,
        "formulas": [
            {
                "slug": formula["slug"],
                "name": formula["name"],
                "description": formula["description"],
                "fields": formula["fields"],
                "outputs": [
                    {"label": output["label"], "unit": output["unit"]}
                    for output in formula["outputs"]
                ],
                "note": formula["note"],
            }
            for formula in workbench["formulas"]
        ],
    }


def render_page(workbench: dict[str, Any], limits: dict[str, Any]) -> str:
    config = json.dumps(config_for(workbench, limits), ensure_ascii=False, separators=(",", ":"))
    config = config.replace("</", "<\\/")
    return PAGE_TEMPLATE.format(
        slug=workbench["slug"],
        title=html.escape(workbench["name"]),
        description=html.escape(workbench["description"]),
        description_attr=html.escape(workbench["description"], quote=True),
        config=config,
    )


def render_functions(workbench: dict[str, Any]) -> str:
    lines = [
        "/* Generated by scripts/generate_formula_workbenches.py; do not edit. */",
        "(function () {",
        '"use strict";',
        "function safeCeil(value) {",
        "  var nearest = Math.round(value);",
        "  var scale = Math.max(Math.abs(value), Math.abs(nearest), Number.MIN_VALUE);",
        "  var tolerance = Number.EPSILON * scale * 4;",
        "  return Math.abs(value - nearest) <= tolerance ? nearest : Math.ceil(value);",
        "}",
        "window.VT_FORMULA_FUNCTIONS = Object.freeze({",
    ]
    for formula in workbench["formulas"]:
        lines.append(f"  {json.dumps(formula['slug'])}: function (values) {{")
        lines.append('    "use strict";')
        for field in formula["fields"]:
            lines.append(f"    var {field['id']} = values[{json.dumps(field['id'])}];")
        for guard in formula["guards"]:
            lines.append(f"    if (!({guard['expression']})) throw new RangeError({json.dumps(guard['message'])});")
        for case in formula["cases"]:
            expressions = ", ".join(case["outputs"])
            lines.append(f"    if ({case['when']}) return [{expressions}];")
        expressions = ", ".join(output["expression"] for output in formula["outputs"])
        lines.append(f"    return [{expressions}];")
        lines.append("  },")
    lines.extend(["});", "}());", ""])
    return "\n".join(lines)


def golden_tests(workbench: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {**test, "kind": "golden"}
        for formula in workbench["formulas"]
        for test in formula["tests"]
    ]


def workbench_catalog_entry(workbench: dict[str, Any]) -> dict[str, Any]:
    aliases = []
    for formula in workbench["formulas"]:
        aliases.extend([formula["name"], formula["slug"].replace("-", " ")])
    aliases = list(dict.fromkeys(aliases))
    return normalize_entry({
        "slug": workbench["slug"],
        "name": workbench["name"],
        "description": workbench["description"],
        "category": workbench["category"],
        "legacyCategory": None,
        "subcategory": workbench["subcategory"],
        "tags": ["formula-workbench", workbench["category"].casefold().replace(" ", "-")],
        "aliases": aliases,
        "icon": workbench["icon"],
        "added": ADDED,
        "risk": workbench["risk"],
        "maturity": "draft",
        "reviewedAt": None,
        "method": "Static formula functions generated from the formula-workbenches.json manifest; inputs are strictly parsed as bounded finite numbers and every output must remain finite. Only manifest-authored golden vectors are counted as recorded tests; generated example smokes are internal checks, not independent domain certification.",
        "sources": [],
        "testCases": golden_tests(workbench),
        "listed": True,
    })


def redirect_mapping(document: dict[str, Any]) -> dict[str, str]:
    return {
        formula["slug"]: workbench["slug"]
        for workbench in document["workbenches"]
        for formula in workbench["formulas"]
    }


def expected_files(document: dict[str, Any]) -> dict[Path, str]:
    files: dict[Path, str] = {}
    for workbench in document["workbenches"]:
        files[FRONTEND / "tools" / workbench["slug"] / "index.html"] = render_page(workbench, document["limits"])
        files[ASSET_DIR / f"{workbench['slug']}.js"] = render_functions(workbench)
    return files


def apply_manifest(document: dict[str, Any]) -> None:
    files = expected_files(document)
    for path, content in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    mapping = redirect_mapping(document)
    policy_path = ROOT / "tool-curation.json"
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    redirects = dict(policy.get("redirects", {}))
    excluded = {item["slug"] for item in document["excluded"]}
    for source in excluded:
        redirects.pop(source, None)
    redirects.update(mapping)
    policy["redirects"] = dict(sorted(redirects.items()))
    redirect_queries = dict(policy.get("redirect_queries", {}))
    for source in excluded:
        redirect_queries.pop(source, None)
    redirect_queries.update({source: {"formula": source} for source in mapping})
    policy["redirect_queries"] = dict(sorted(redirect_queries.items()))
    policy["unlist"] = sorted(set(policy.get("unlist", [])) | excluded)
    policy_path.write_text(json.dumps(policy, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    catalog_path = FRONTEND / "assets" / "tool-catalog.json"
    catalog_document, tools = load_catalog(catalog_path)
    legacy_slugs = set(mapping)
    excluded_slugs = {item["slug"] for item in document["excluded"]}
    workbench_slugs = {workbench["slug"] for workbench in document["workbenches"]}
    retained = []
    for tool in tools:
        if tool["slug"] in workbench_slugs:
            continue
        if tool["slug"] in legacy_slugs or tool["slug"] in excluded_slugs:
            tool = dict(tool)
            tool["listed"] = False
        retained.append(tool)
    retained.extend(workbench_catalog_entry(workbench) for workbench in document["workbenches"])
    catalog_document["tools"] = retained
    catalog_path.write_text(json.dumps(catalog_document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Reapply the unified policy so registry, metadata, and nginx redirects all
    # derive from the updated canonical sources.
    from apply_tool_curation import main as apply_curation
    result = apply_curation()
    if result:
        raise RuntimeError("applying tool curation failed")


def check_generated(document: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    for path, content in expected_files(document).items():
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            issues.append(f"{path.relative_to(ROOT)}: missing or stale")
    mapping = redirect_mapping(document)
    policy = json.loads((ROOT / "tool-curation.json").read_text(encoding="utf-8"))
    redirects = policy.get("redirects", {})
    redirect_queries = policy.get("redirect_queries", {})
    for source, target in mapping.items():
        if redirects.get(source) != target:
            issues.append(f"tool-curation.json: missing formula redirect {source} -> {target}")
        if redirect_queries.get(source) != {"formula": source}:
            issues.append(f"tool-curation.json: missing exact formula query for {source}")
    _, tools = load_catalog(FRONTEND / "assets" / "tool-catalog.json")
    by_slug = {tool["slug"]: tool for tool in tools}
    for source in mapping:
        if source not in by_slug or by_slug[source].get("listed", True):
            issues.append(f"tool-catalog.json: legacy formula remains listed: {source}")
    for item in document["excluded"]:
        source = item["slug"]
        if source not in by_slug or by_slug[source].get("listed", True):
            issues.append(f"tool-catalog.json: excluded formula remains listed: {source}")
        if source not in set(policy.get("unlist", [])):
            issues.append(f"tool-curation.json: excluded formula is not unlisted: {source}")
        if source in mapping or source in redirects:
            issues.append(f"tool-curation.json: excluded formula must not redirect: {source}")
    for workbench in document["workbenches"]:
        expected = workbench_catalog_entry(workbench)
        if by_slug.get(workbench["slug"]) != expected:
            issues.append(f"tool-catalog.json: workbench entry is missing or stale: {workbench['slug']}")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    document = load_manifest()
    issues = validate_manifest(document)
    try:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            issues.append("formula-workbenches.schema.json: expected draft 2020-12")
    except (OSError, json.JSONDecodeError) as exc:
        issues.append(f"formula-workbenches.schema.json: {exc}")
    if issues:
        print("\n".join(issues), file=sys.stderr)
        return 1
    # Evaluate every example independently before emitting source.
    try:
        for value, expected in ((1e-20, 1), (1.0000000000000002, 1), (1.00000000000001, 2), (699.9999999999999, 700)):
            if _safe_ceil(value) != expected:
                raise ValueError(f"safeCeil invariant failed for {value!r}")
        for workbench in document["workbenches"]:
            formula_examples(workbench)
            for formula in workbench["formulas"]:
                example = {field["id"]: field["example"] for field in formula["fields"]}
                calculate_formula(formula, example)
                for test in formula["tests"]:
                    actual = calculate_formula(formula, test["input"])
                    for actual_value, expected_value in zip(actual, test["expected"]):
                        if not math.isclose(actual_value, expected_value, rel_tol=1e-9, abs_tol=1e-9):
                            raise ValueError(f"{formula['slug']}: golden test failed: {test['name']}")
    except (ArithmeticError, ValueError, OverflowError) as exc:
        print(f"formula example validation failed: {exc}", file=sys.stderr)
        return 1
    if args.check:
        issues = check_generated(document)
        if issues:
            print("\n".join(issues), file=sys.stderr)
            return 1
    else:
        apply_manifest(document)
    count = sum(len(workbench["formulas"]) for workbench in document["workbenches"])
    print(f"Validated {count} formulas across {len(document['workbenches'])} workbenches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
