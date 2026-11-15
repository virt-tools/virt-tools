#!/usr/bin/env python3
"""Generate behavioural regression suites from each page's own catalog cases.

A tool page marks its arithmetic core between

    /* <name>-core:start */   ...   /* <name>-core:end */

and exports it as an object of functions (`calculate`, `analyze`, `plan`, `convert`,
`compute`, ...). The canonical catalog carries the same tool's cases (`input` plus
`expected` or `expectedError`). This script derives the adapter - which symbol, which
entry point, whether the defaults table has to be merged into a partial input - and
writes a suite only when *every* comparable case passes with that adapter. A test that
was guessed rather than proven is never committed.

Suites are only derived for tools that do not already have a hand-written suite. On
this checkout every tool with cases has one, so the tool writes nothing today; it is
kept so that a new tool landing with catalog cases but no suite gets one for free.

  python3 scripts/generate_tool_tests.py            # derive + write tests/generated/*.test.cjs
  python3 scripts/generate_tool_tests.py --check    # verify the generated files are current
  python3 scripts/generate_tool_tests.py <slug>...  # restrict to slugs
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "frontend" / "tools"
CATALOG = ROOT / "frontend" / "assets" / "tool-catalog.json"
OUT = ROOT / "tests" / "generated"
NODE = "node"

ENTRY_POINTS = ["calculate", "analyze", "analyse", "plan", "convert", "compute",
                "build", "decode", "encode", "run", "parse", "generate", "solve",
                "evaluate", "report", "assess", "resolve"]
MARKER = re.compile(r"/\*\s*([A-Za-z0-9_-]+)-core:start\s*\*/(.*?)/\*\s*\1-core:end\s*\*/", re.S)
SYMBOLS = re.compile(r"\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)")

HARNESS = r"""
const vm = require('node:vm'), fs = require('node:fs');
const block = fs.readFileSync(process.argv[1], 'utf8');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const symbols = JSON.parse(process.argv[3]);
const entries = JSON.parse(process.argv[4]);

function base() {
  return { module: { exports: {} }, console, Math, JSON, Number, String, Boolean, Array, Object,
    Date, RegExp, Error, RangeError, TypeError, isFinite, isNaN, parseInt, parseFloat, Set, Map, Intl };
}

function compare(actual, expected, where) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    // Catalog expectations are published at display precision: 151.0886 for a core
    // value of 151.08861548. Accept half a unit of the last published decimal, plus
    // float slack, and nothing looser.
    const decimals = (String(expected).split('.')[1] || '').length;
    const tolerance = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(expected));
    if (!(Math.abs(actual - expected) <= tolerance)) {
      throw new Error(where + ': ' + actual + ' != ' + expected);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) throw new Error(where + ': array shape');
    expected.forEach((item, index) => compare(actual[index], item, where + '[' + index + ']'));
    return;
  }
  if (typeof expected === 'string' && actual && typeof actual === 'object' && !Array.isArray(actual)) {
    const display = actual.name ?? actual.label ?? actual.text ?? actual.title;
    if (display !== undefined) {
      if (String(display) !== expected) throw new Error(where + ': ' + display + ' != ' + expected);
      return;
    }
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') throw new Error(where + ': not an object');
    for (const key of Object.keys(expected)) compare(actual[key], expected[key], where + '.' + key);
    return;
  }
  if (actual !== expected) throw new Error(where + ': ' + JSON.stringify(actual) + ' != ' + JSON.stringify(expected));
}

function replay(symbol, name, mode) {
  const results = [];
  for (const item of cases) {
    const sandbox = base();
    vm.createContext(sandbox);
    try {
      vm.runInContext(block, sandbox);
    } catch (error) {
      return null;
    }
    const core = sandbox[symbol];
    if (!core || typeof core[name] !== 'function') return null;
    let input = item.input;
    if (mode === 'merged' && input && typeof input === 'object' && !Array.isArray(input)) {
      const table = core.DEFAULTS || core.defaults;
      input = Object.assign({}, table && typeof table === 'object' ? table : {}, input);
    }
    try {
      const value = core[name](input);
      if (item.expectedError) { results.push({ ok: false, why: 'expected an error' }); continue; }
      compare(value, item.expected, 'out');
      results.push({ ok: true });
    } catch (error) {
      if (item.expectedError && String(error.message) === String(item.expectedError)) results.push({ ok: true });
      else results.push({ ok: false, why: String(error.message || error) });
    }
  }
  return results;
}

let best = null;
for (const symbol of symbols) {
  for (const name of entries) {
    for (const mode of ['raw', 'merged']) {
      const results = replay(symbol, name, mode);
      if (!results || results.length !== cases.length) continue;
      const failures = results.filter((item) => !item.ok);
      if (failures.length === 0) {
        console.log(JSON.stringify({ symbol, entry: name, mode, cases: results.length }));
        process.exit(0);
      }
      if (!best || failures.length < best.failures) {
        best = { symbol, entry: name, mode, failures: failures.length, first: failures[0].why };
      }
    }
  }
}
console.log(JSON.stringify({ failed: true, best }));
process.exit(1);
"""

# Plain JavaScript with @@TOKENS@@: formatting a JS body through str.format needs every
# brace doubled, and one missed brace fails with "unexpected '{' in field name".
TEST_TEMPLATE = r"""/* Generated by scripts/generate_tool_tests.py for @@SLUG@@; do not edit by hand.
 *
 * The page marks its arithmetic core with the @@MARKER@@-core:start and
 * @@MARKER@@-core:end marker comments and exposes `@@SYMBOL@@.@@ENTRY@@`. This suite replays the
 * canonical catalog's own cases against that core: @@CASES@@ of them (@@KINDS@@).
 *
 * Adapter: @@SYMBOL@@.@@ENTRY@@(@@SIGNATURE@@) - @@MODE_NOTE@@.
 * Regenerate with: python3 scripts/generate_tool_tests.py @@SLUG@@
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SLUG = '@@SLUG@@';
const MARKER = '@@MARKER@@';
const CASES = @@CASES_JSON@@;

const pagePath = path.join(__dirname, '..', '..', 'frontend', 'tools', SLUG, 'index.html');
const html = fs.readFileSync(pagePath, 'utf8');
const blockPattern = new RegExp('/\\*\\s*' + MARKER + '-core:start\\s*\\*/'
  + '([\\s\\S]*?)/\\*\\s*' + MARKER + '-core:end\\s*\\*/');
const blockMatch = html.match(blockPattern);
assert.ok(blockMatch, SLUG + ': marked core block (' + MARKER + ') is missing');

function loadCore() {
  const sandbox = {
    module: { exports: {} }, console, Math, JSON, Number, String, Boolean, Array, Object,
    Date, RegExp, Error, RangeError, TypeError, isFinite, isNaN, parseInt, parseFloat, Set, Map, Intl
  };
  vm.createContext(sandbox);
  vm.runInContext(blockMatch[1], sandbox);
  const core = sandbox['@@SYMBOL@@'];
  assert.ok(core, SLUG + ': core symbol @@SYMBOL@@ is not defined');
  assert.equal(typeof core['@@ENTRY@@'], 'function', SLUG + ': core has no @@ENTRY@@ entry point');
  return core;
}

function compare(actual, expected, where) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    // The catalog publishes display-rounded values; accept half of the last published
    // decimal so 151.08861548 satisfies 151.0886, and nothing looser.
    const decimals = (String(expected).split('.')[1] || '').length;
    const tolerance = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(expected));
    assert.ok(Math.abs(actual - expected) <= tolerance, where + ': ' + actual + ' != ' + expected);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && actual.length === expected.length, where + ': array shape');
    expected.forEach((item, index) => compare(actual[index], item, where + '[' + index + ']'));
    return;
  }
  if (typeof expected === 'string' && actual && typeof actual === 'object' && !Array.isArray(actual)) {
    // A catalog expectation may name the display label of an object result:
    // {name: "6G-SDI", mbps: 5940} is published as level: "6G-SDI".
    const display = actual.name ?? actual.label ?? actual.text ?? actual.title;
    if (display !== undefined) {
      assert.strictEqual(String(display), expected, where);
      return;
    }
  }
  if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', where + ': not an object');
    Object.keys(expected).forEach((key) => compare(actual[key], expected[key], where + '.' + key));
    return;
  }
  assert.strictEqual(actual, expected, where);
}

let checked = 0;
for (const item of CASES) {
  const core = loadCore();
  let input = item.input;
  if (@@MODE_MERGED@@ && input && typeof input === 'object' && !Array.isArray(input)) {
    const table = core.DEFAULTS || core.defaults;
    input = Object.assign({}, table && typeof table === 'object' ? table : {}, input);
  }
  let outcome = null;
  let message = null;
  try {
    outcome = core['@@ENTRY@@'](input);
  } catch (error) {
    message = String(error.message || error);
  }
  if (item.expectedError) {
    assert.ok(message !== null,
      SLUG + ' [' + item.name + ']: expected the error "' + item.expectedError + '" but it computed');
    assert.strictEqual(message, item.expectedError, SLUG + ' [' + item.name + ']: error message');
  } else {
    assert.strictEqual(message, null, SLUG + ' [' + item.name + ']: threw ' + message);
    compare(outcome, item.expected, SLUG + ' [' + item.name + ']');
  }
  checked += 1;
}

console.log(SLUG + ': ' + checked + ' catalog cases replayed against @@SYMBOL@@.@@ENTRY@@');
"""


def already_covered() -> set[str]:
    """Slugs a hand-written suite already exercises (those suites are stronger)."""
    blob = "\n".join(path.read_text(encoding="utf-8", errors="replace")
                     for path in (ROOT / "tests").glob("*.test.cjs"))
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["tools"]
    return {tool["slug"] for tool in catalog if tool.get("listed", True) and tool["slug"] in blob}


def comparable(cases: list) -> list[dict]:
    kept = []
    for case in cases:
        if not isinstance(case, dict) or "input" not in case:
            continue
        if "expectedError" in case:
            kept.append({"name": case.get("name", "case"), "input": case["input"],
                         "expectedError": case["expectedError"]})
        elif "expected" in case:
            kept.append({"name": case.get("name", "case"), "input": case["input"],
                         "expected": case["expected"]})
    return kept


def derive(slug: str, cases: list[dict]) -> dict | None:
    page = PAGES / slug / "index.html"
    if not page.is_file():
        return None
    match = MARKER.search(page.read_text(encoding="utf-8"))
    if not match:
        return None
    block = match.group(2)
    symbols = list(dict.fromkeys(SYMBOLS.findall(block)))
    if not symbols:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        harness_dir = Path(tmp)
        (harness_dir / "core.js").write_text(block, encoding="utf-8")
        (harness_dir / "cases.json").write_text(json.dumps(cases), encoding="utf-8")
        result = subprocess.run(
            [NODE, "-e", HARNESS, str(harness_dir / "core.js"), str(harness_dir / "cases.json"),
             json.dumps(symbols), json.dumps(ENTRY_POINTS)],
            capture_output=True, text=True, timeout=120,
        )
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        derived = json.loads(result.stdout.strip().splitlines()[-1])
    except json.JSONDecodeError:
        return None
    if derived.get("failed"):
        return None
    derived["marker"] = match.group(1)
    return derived


def render(slug: str, derived: dict, cases: list[dict]) -> str:
    kinds: dict[str, int] = {}
    for case in cases:
        key = "error" if "expectedError" in case else "value"
        kinds[key] = kinds.get(key, 0) + 1
    merged = derived["mode"] == "merged"
    tokens = {
        "@@SLUG@@": slug,
        "@@MARKER@@": derived["marker"],
        "@@SYMBOL@@": derived["symbol"],
        "@@ENTRY@@": derived["entry"],
        "@@CASES@@": str(len(cases)),
        "@@KINDS@@": ", ".join(f"{count} {name}" for name, count in sorted(kinds.items())),
        "@@SIGNATURE@@": "input" + (", merged with DEFAULTS" if merged else ""),
        "@@MODE_NOTE@@": ("partial inputs are merged with the core's DEFAULTS table" if merged
                          else "the case input is passed through unchanged"),
        "@@MODE_MERGED@@": "true" if merged else "false",
        "@@CASES_JSON@@": json.dumps(cases, ensure_ascii=False, indent=2).replace("\n", "\n  "),
    }
    rendered = TEST_TEMPLATE
    for token, value in tokens.items():
        rendered = rendered.replace(token, value)
    assert "@@" not in rendered, f"{slug}: unreplaced template token"
    return rendered


def main(argv: list[str]) -> int:
    check = "--check" in argv
    only = [arg for arg in argv[1:] if not arg.startswith("--")]
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["tools"]
    tools = [tool for tool in catalog if tool.get("listed", True) and tool.get("testCases")]
    if only:
        tools = [tool for tool in tools if tool["slug"] in only]

    covered = already_covered()
    written, skipped, stale = [], [], []
    for tool in tools:
        slug = tool["slug"]
        cases = comparable(tool["testCases"])
        if len(cases) < 3:
            continue
        if slug in covered:
            continue
        target = OUT / f"{slug}.test.cjs"
        derived = derive(slug, cases)
        if not derived:
            skipped.append(slug)
            if check and target.exists():
                stale.append(f"{slug}: no longer derivable; delete {target.relative_to(ROOT)}")
            continue
        rendered = render(slug, derived, cases)
        if check:
            if not target.is_file():
                stale.append(f"{slug}: missing generated suite")
            elif target.read_text(encoding="utf-8") != rendered:
                stale.append(f"{slug}: generated suite is out of date")
            continue
        OUT.mkdir(parents=True, exist_ok=True)
        target.write_text(rendered, encoding="utf-8")
        written.append((slug, len(cases), derived["symbol"], derived["entry"], derived["mode"]))

    if check:
        for line in stale:
            print("error: " + line, file=sys.stderr)
        if stale:
            return 1
        generated = len(list(OUT.glob("*.test.cjs"))) if OUT.is_dir() else 0
        print(f"Generated suites current: {generated} files across {len(tools)} tools with cases")
        return 0

    for slug, count, symbol, entry, mode in written:
        print(f"  {slug}: {count} cases via {symbol}.{entry} ({mode})")
    print(f"wrote {len(written)} generated suites, skipped {len(skipped)} tools without a proven adapter")
    if skipped:
        print("  not derivable: " + ", ".join(skipped[:10]) + (" ..." if len(skipped) > 10 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
