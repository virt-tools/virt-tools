/* Bash parameter expansion explainer: replay the catalog fixtures, compare the
   page against an independently written glob oracle, and check the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bash-parameter-expansion-explainer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* bash-parameter-expansion-core:start */');
const end = html.indexOf('/* bash-parameter-expansion-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = BashExpansionCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2240, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'Bash Parameter Expansion Explainer');
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Reference');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the supported forms and limits');
assert.ok(entry.sources.length >= 3);
assert.equal(entry.testCases.length, 26, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 8);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 9);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 9);

function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(attempt(() => C.analyse(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[field], expected, testCase.name + ' ' + field);
  }
  if (result.status === 'ok') {
    assert.ok(result.explanation.length > 10, testCase.name + ' needs an explanation');
  }
}

// Hand-computed anchors, worked out from bash's own rules.
const anchors = [
  [{ expression: '${f%%.*}', value: 'a.b.c' }, 'a'],
  [{ expression: '${f#*.}', value: 'a.b.c' }, 'b.c'],
  [{ expression: '${f##*.}', value: 'a.b.c' }, 'c'],
  [{ expression: '${f%.*}', value: 'a.b.c' }, 'a.b'],
  [{ expression: '${f: -3}', value: 'abcdef' }, 'def'],
  [{ expression: '${f: -3:2}', value: 'abcdef' }, 'de'],
  [{ expression: '${f:2:-2}', value: 'abcdef' }, 'cd'],
  [{ expression: '${f//o/0}', value: 'foo boo' }, 'f00 b00'],
  [{ expression: '${f/o/0}', value: 'foo boo' }, 'f0o boo'],
  [{ expression: '${f/[a-c]/_}', value: 'abcdef' }, '_bcdef'],
  [{ expression: '${f//[!a-c]/_}', value: 'abcdef' }, 'abc___'],
  [{ expression: '${f#?}', value: 'abc' }, 'bc'],
  [{ expression: '${f%?}', value: 'abc' }, 'ab'],
  [{ expression: '${f^^}', value: 'aBc' }, 'ABC'],
  [{ expression: '${f,}', value: 'ABC' }, 'aBC'],
  [{ expression: '${#f}', value: 'abcd' }, '4'],
  [{ expression: '${f:-d}', value: '' }, 'd'],
  [{ expression: '${f-d}', value: '' }, ''],
  [{ expression: '${f:+a}', value: '' }, ''],
  [{ expression: '${f+a}', value: '' }, 'a']
];
for (const [input, expected] of anchors) {
  const result = C.analyse(input);
  assert.equal(result.value, expected, JSON.stringify(input));
}

// Independent oracle: convert the pattern to a regular expression and scan the
// value directly, rather than using the page's end-position dynamic program.
function globToRegex(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 1;
      assert.ok(i < pattern.length, 'oracle: dangling escape');
      source += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '*') {
      source += '[\\s\\S]*';
    } else if (ch === '?') {
      source += '[\\s\\S]';
    } else if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      assert.ok(close > i + 1, 'oracle: unclosed class');
      let body = pattern.slice(i + 1, close);
      let negate = false;
      if (body[0] === '!' || body[0] === '^') {
        negate = true;
        body = body.slice(1);
      }
      source += '[' + (negate ? '^' : '') + body.replace(/\\/g, '\\\\') + ']';
      i = close;
    } else {
      source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + source + '$');
}
function globTest(regex, text) { return regex.test(text); }
function oracleStrip(value, pattern, direction, longest) {
  const regex = globToRegex(pattern);
  const chars = Array.from(value);
  const lengths = [];
  for (let length = 0; length <= chars.length; length += 1) {
    const piece = direction === 'prefix'
      ? chars.slice(0, length).join('')
      : chars.slice(chars.length - length).join('');
    if (globTest(regex, piece)) lengths.push(length);
  }
  if (!lengths.length) return { value, match: null };
  const length = longest ? Math.max(...lengths) : Math.min(...lengths);
  if (direction === 'prefix') {
    return { value: chars.slice(length).join(''), match: chars.slice(0, length).join('') };
  }
  return { value: chars.slice(0, chars.length - length).join(''), match: chars.slice(chars.length - length).join('') };
}

function oracleSubstitute(value, pattern, replacement, global) {
  const regex = globToRegex(pattern);
  const chars = Array.from(value);
  let out = '';
  let i = 0;
  let count = 0;
  while (i < chars.length) {
    let found = -1;
    for (let length = chars.length - i; length >= 1; length -= 1) {
      if (globTest(regex, chars.slice(i, i + length).join(''))) { found = length; break; }
    }
    if (found > 0) {
      out += replacement;
      count += 1;
      i += found;
      if (!global) { out += chars.slice(i).join(''); break; }
    } else {
      out += chars[i];
      i += 1;
    }
  }
  return { value: out, count };
}

const values = ['a.b.c', 'report.tar.gz', 'abcabc', 'a/b/c', 'Mixed CASE', '  pad  ', 'x', 'file_01.log', 'abc-123-def', 'one', 'aXbXc'];
const patterns = ['*', '?', '*.', '.', '.*', '*.*', 'a*', '*c', '*b*', 'a?c', '[a-c]*', '*[!a-z]', 'x*', '*z', '??', '\\*', 'a*b', '*.*.*'];
for (const value of values) {
  for (const pattern of patterns) {
    const ops = [
      { expression: '${v#' + pattern + '}', direction: 'prefix', longest: false, label: 'Shortest matching prefix' },
      { expression: '${v##' + pattern + '}', direction: 'prefix', longest: true, label: 'Longest matching prefix' },
      { expression: '${v%' + pattern + '}', direction: 'suffix', longest: false, label: 'Shortest matching suffix' },
      { expression: '${v%%' + pattern + '}', direction: 'suffix', longest: true, label: 'Longest matching suffix' }
    ];
    for (const op of ops) {
      const result = C.analyse({ expression: op.expression, value });
      const expected = oracleStrip(value, pattern, op.direction, op.longest);
      assert.equal(result.value, expected.value, op.expression + ' on ' + JSON.stringify(value));
      assert.deepEqual(result.matchText, expected.match, op.expression + ' match on ' + JSON.stringify(value));
      assert.equal(result.operator, op.label);
    }
    for (const global of [false, true]) {
      if (value === '') continue;
      const expression = '${v' + (global ? '//' : '/') + pattern + '/X}';
      const result = C.analyse({ expression, value });
      const expected = oracleSubstitute(value, pattern, 'X', global);
      assert.equal(result.value, expected.value, expression + ' on ' + JSON.stringify(value));
      if (expected.count === 0) assert.equal(result.matchText, null);
    }
  }
}

// Substring arithmetic, recomputed with plain slicing.
const slices = [
  ['abcdef', ':0', 'abcdef'], ['abcdef', ':0:2', 'ab'], ['abcdef', ':4', 'ef'],
  ['abcdef', ':6', ''], ['abcdef', ':99', ''], ['abcdef', ': -1', 'f'],
  ['abcdef', ': -6', 'abcdef'], ['abcdef', ': -7', ''], ['abcdef', ':2:-2', 'cd'],
  ['abcdef', ':0:-6', ''], ['abcdef', ':5:9', 'f'], ['abc', ':0:0', '']
];
for (const [value, tail, expected] of slices) {
  const expression = '${v' + tail + '}';
  assert.equal(C.analyse({ expression, value }).value, expected, expression + ' on ' + value);
}

// A negative length that ends before the offset is the one case bash rejects.
assert.equal(
  attempt(() => C.analyse({ expression: '${v:1:-9}', value: 'abc' })),
  'Bash rejects a negative length that ends before the offset: -9 leaves nothing after position 1.'
);

// Character counting and the unset switch.
assert.equal(C.analyse({ expression: '${#v}', value: '\u{1F642}ab' }).value, '3');
assert.equal(C.analyse({ expression: '${v:1:2}', value: '\u{1F642}ab' }).value, 'ab');
assert.equal(C.analyse({ expression: '${v#?}', value: '\u{1F642}ab' }).value, 'ab');
assert.equal(C.analyse({ expression: '${v^}', value: '\u00e9cole' }).warnings.length, 1, 'non-ASCII case warning');
assert.equal(C.analyse({ expression: '${v^^}', value: 'abc' }).warnings.length, 0);
assert.equal(C.analyse({ expression: '${v}', value: 'abc', unset: true }).state, 'unset');
assert.equal(C.analyse({ expression: '${v}', value: '', unset: false }).state, 'empty');
assert.equal(C.analyse({ expression: '${v:?}', value: '', unset: true }).status, 'error');
assert.equal(C.analyse({ expression: '${v:?}', value: 'set' }).status, 'ok');
assert.equal(C.analyse({ expression: '${v?}', value: '' }).status, 'ok');

// Limits and the rejected forms.
assert.equal(
  attempt(() => C.analyse({ expression: '${v}', value: 'x'.repeat(1001) })),
  'The variable value is limited to 1000 characters.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v:-' + 'y'.repeat(400) + '}' })),
  'The expansion is limited to 400 characters.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v#' + 'z'.repeat(201) + '}', value: 'abc' })),
  'A pattern is limited to 200 characters.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v@Q}', value: 'abc' })),
  'Unsupported expansion operator "@". Only the operators listed under the form are supported.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v/#a/X}', value: 'abc' })),
  'The anchored substitution forms ${name/#pattern/repl} and ${name/%pattern/repl} are not supported.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v:-x' + String.fromCharCode(96) + 'y}', value: 'abc' })),
  'Command substitution and nested variables are not supported inside the expansion.'
);
assert.equal(
  attempt(() => C.analyse({ expression: '${v:abc}', value: 'abc' })),
  'The substring form is ${name:offset} or ${name:offset:length} with whole numbers; a negative offset needs a space, as in ${name: -3}.'
);

// Page contract: shared shell, one inline script, no dynamic markup or network.
assert.ok(html.includes('<title>Bash Parameter Expansion Explainer — Virtual Tools</title>'));
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.equal((html.match(/<script(?![^>]*src=)/g) || []).length, 1, 'one inline script');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'no dynamic markup sinks');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|importScripts|localStorage|sessionStorage/.test(html), 'no network or storage');
for (const id of ['expr', 'value', 'unset', 'err', 'out', 'expand-form', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing #' + id);
}
for (const id of ['expr', 'value', 'unset']) {
  assert.ok(html.includes('for="' + id + '"'), 'control ' + id + ' needs a label');
}
assert.equal((html.match(/<button\b[^>]*\btype="(?:submit|button)"/g) || []).length, 2, 'buttons need explicit types');

console.log('bash parameter expansion explainer: catalog, oracle and page checks passed');
