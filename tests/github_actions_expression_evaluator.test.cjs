/* GitHub Actions expression evaluator: the documented examples, the coercion table,
   the operator and filter invariants, the refusals, the catalog cases and the page
   contract. The language model was cross-checked during development against GitHub's
   own @actions/expressions implementation over about two thousand expressions. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'github-actions-expression-evaluator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* github-actions-expression-core:start */';
const endMarker = '/* github-actions-expression-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = GhaExpressionCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const evaluate = (expression, context, extra) => {
  const result = C.calculate(Object.assign({
    expression,
    contexts: JSON.stringify(context || {}),
    status: 'success',
    wrapper: 'value'
  }, extra || {}));
  return plain(result);
};
const value = (expression, context) => evaluate(expression, context).value;
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

const LABELS = {
  github: {
    ref: 'refs/heads/main', event_name: 'pull_request',
    event: { pull_request: { draft: false, labels: [{ name: 'bug' }, { name: 'deploy' }] } }
  }
};

// ---- The examples the documentation prints, verbatim.
assert.equal(value("contains('Hello world', 'llo')"), true);
assert.equal(value("startsWith('Hello world', 'He')"), true);
assert.equal(value("endsWith('Hello world', 'ld')"), true);
assert.equal(value("format('Hello {0} {1} {2}', 'Mona', 'the', 'Octocat')"), 'Hello Mona the Octocat');
assert.equal(value("format('{{Hello {0} {1} {2}!}}', 'Mona', 'the', 'Octocat')"), '{Hello Mona the Octocat!}');
assert.equal(value("contains(fromJSON('[\"push\", \"pull_request\"]'), 'pull_request')"), true);
assert.equal(value('toJSON(github)', LABELS), JSON.stringify(LABELS.github, null, 2));
assert.equal(value("fromJSON('[1, 2]')[1]"), 2);
assert.equal(value("fromJSON('{\"a\": true}').a"), true);
assert.equal(value("'It''s open source!'"), "It's open source!");
assert.equal(value('0xff'), 255);
assert.equal(value('-2.99e-2'), -0.0299);
assert.equal(value('-9.2'), -9.2);

// ---- Truthiness: false, 0, -0, "", '' and null are falsy.
for (const literal of ['false', '0', '-0', "''", 'null']) {
  assert.equal(evaluate(literal).truthy, false, literal + ' is falsy');
  assert.equal(value('!' + literal), true, '!' + literal);
}
for (const literal of ['true', '1', '-1', "'0'", "'false'"]) {
  assert.equal(evaluate(literal).truthy, true, literal + ' is truthy');
}

// ---- Loose equality, from the coercion table: a mismatch is coerced to a number.
const equalPairs = [
  ['null', '0'], ['true', '1'], ['false', '0'], ["''", '0'], ["'1'", '1'],
  ["'0x10'", '16'], ["' 7 '", '7'], ["'A'", "'a'"], ['true', "'1'"],
  ['false', "''"], ['null', "''"]
];
for (const [left, right] of equalPairs) {
  assert.equal(value(left + ' == ' + right), true, left + ' == ' + right);
  assert.equal(value(right + ' == ' + left), true, right + ' == ' + left);
}
const unequalPairs = [
  ["'1'", "'2'"], ['true', '2'], ["'abc'", '0'], ['null', "'x'"],
  ["'10'", '10.5'], ['true', 'false']
];
for (const [left, right] of unequalPairs) {
  assert.equal(value(left + ' == ' + right), false, left + ' == ' + right);
  assert.equal(value(left + ' != ' + right), true, left + ' != ' + right);
}

// ---- Relational comparisons: two strings compare as text, anything else as numbers.
assert.equal(value("'10' < '9'"), true);
assert.equal(value("10 < '9'"), false);
assert.equal(value("'b' > 'A'"), true, 'string comparison ignores case');
assert.equal(value('true > false'), true);
assert.equal(value('null < 1'), true);
assert.equal(value("'abc' < 1"), false, 'NaN comparisons are false');
assert.equal(value("'abc' >= 1"), false);
assert.equal(value('NaN == NaN'), false);
assert.equal(value('Infinity > 1e308'), true);

// ---- Logical operators return an operand, not a boolean.
assert.equal(value("true && 'x'"), 'x');
assert.equal(value("'' && 'x'"), '');
assert.equal(value("'' || 'fallback'"), 'fallback');
assert.equal(value("'first' || 'second'"), 'first');
assert.equal(value('!0 && 5'), 5);
assert.equal(value('1 == 1 || 2 == 2 && 3 == 4'), true, '&& binds tighter than ||');
assert.equal(evaluate('!github.ref', LABELS).type, 'Boolean', '! is always boolean');

// ---- Property access and filters.
assert.equal(value('github.REF', LABELS), 'refs/heads/main', 'names are case-insensitive');
assert.deepEqual(value('github.event.pull_request.labels.*.name', LABELS), ['bug', 'deploy']);
assert.equal(value('github.event.pull_request.labels[0].name', LABELS), 'bug');
assert.equal(value('github.event.pull_request.labels[7]', LABELS), null);
assert.equal(value('github.missing', LABELS), null);
assert.equal(value('github.event.pull_request.merged == null', LABELS), true);
assert.equal(value("github['event_name']", LABELS), 'pull_request');
assert.deepEqual(value("fromJSON('{\"k\": [{\"v\": 1}, {\"v\": 2}]}').k.*.v"), [1, 2]);
assert.deepEqual(value("fromJSON('{\"k\": [{\"v\": 1}]}')['k']"), [{ v: 1 }]);

// ---- Functions.
assert.equal(value("format('{0}-{1}', 'a', 'b')"), 'a-b');
assert.equal(value("format('{0}{0}', 'x')"), 'xx');
assert.equal(value("format('{0:d}', '5')"), '5', 'a format specifier after the number is ignored');
assert.equal(value("join(fromJSON('[\"a\", \"b\"]'), ' + ')"), 'a + b');
assert.equal(value("join(fromJSON('[\"a\", \"b\"]'))"), 'a,b');
assert.equal(value("join('abc')"), 'abc');
assert.equal(value("contains(fromJSON('[\"bug\", \"help wanted\"]'), 'BUG')"), true);
assert.equal(value("contains('Mona', 5)"), false, 'a primitive search casts to text');
assert.equal(value("case(1 == 2, 'a', 1 == 1, 'b', 'c')"), 'b');
assert.equal(value("case(1 == 2, 'a', 'c')"), 'c');

// ---- The implicit success() gate on an if: condition.
const gate = (expression, status) => evaluate(expression, {}, { status, wrapper: 'if' });
assert.deepEqual([gate("'yes'", 'success').runs, gate("'yes'", 'failure').runs], [true, false]);
assert.equal(gate('success()', 'failure').runs, false);
assert.equal(gate('failure()', 'failure').runs, true);
assert.equal(gate('always()', 'cancelled').runs, true);
assert.equal(gate('cancelled()', 'cancelled').runs, true);
assert.equal(gate("''", 'success').runs, false, 'a falsy value never runs');
assert.equal(gate("'yes'", 'success').headline, 'Runs');
assert.equal(gate("'yes'", 'failure').headline, 'Skips');
assert.equal(gate("'yes'", 'failure').hasStatusFunction, false);

// ---- Invariants over deterministic pseudo-random primitive pairs: no oracle needed,
// these follow from symmetry and from the coercion rules themselves.
let seed = 20261120;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const atoms = ['0', '1', '-1', '2.5', "''", "'a'", "'A'", "'0'", "'1.5'", "'x'", 'true', 'false', 'null', 'NaN'];
for (let step = 0; step < 240; step += 1) {
  const left = atoms[Math.floor(next() * atoms.length)];
  const right = atoms[Math.floor(next() * atoms.length)];
  assert.equal(value(left + ' == ' + right), value(right + ' == ' + left), 'equality is symmetric');
  assert.equal(value(left + ' != ' + right), !value(left + ' == ' + right), '!= negates ==');
  assert.equal(value('(' + left + ' >= ' + right + ')'),
    value(left + ' == ' + right) || value(left + ' > ' + right), '>= is == or >');
  assert.equal(value('(' + left + ' <= ' + right + ')'),
    value(left + ' == ' + right) || value(left + ' < ' + right), '<= is == or <');
  assert.equal(value('!(' + left + ')'), !evaluate(left).truthy, '! is the negation of truthiness');
}

// ---- The round trips fromJSON/toJSON and join preserve plain JSON.
for (let step = 0; step < 40; step += 1) {
  const item = {
    n: Math.round(next() * 100) - 50,
    s: ['a', 'B', '', 'x y'][Math.floor(next() * 4)],
    b: next() < 0.5,
    list: [Math.floor(next() * 5), Math.floor(next() * 5)]
  };
  const json = JSON.stringify(item).replace(/'/g, "''");
  assert.deepEqual(value("fromJSON('" + json + "')"), item);
  assert.equal(value("toJSON(fromJSON('" + json + "'))"), JSON.stringify(item, null, 2));
}

// ---- Refusals carry user-facing messages.
const base = { expression: "github.ref == 'refs/heads/main'", contexts: '{"github": {"ref": "refs/heads/main"}}', status: 'success', wrapper: 'if' };
assert.equal(failure({}), 'Enter an expression to evaluate.');
assert.equal(failure(Object.assign({}, base, { contexts: '   ' })).indexOf('The contexts are not valid JSON:'), 0);
assert.equal(failure(Object.assign({}, base, { expression: '   ${{  }}' })), 'Enter an expression to evaluate.');
assert.equal(failure(Object.assign({}, base, { expression: '1 + 2' })),
  'GitHub Actions expressions have no arithmetic operators: compute the number before the workflow, or return text with format().');
assert.equal(failure(Object.assign({}, base, { expression: '"main"' })),
  'Strings use single quotes: write \'text\' instead of "text".');
assert.equal(failure(Object.assign({}, base, { expression: 'github.ref =' })),
  'Use == to compare values: \u201c=\u201d on its own is not an operator (position 12).');
assert.equal(failure(Object.assign({}, base, { expression: 'github.ref ==' })),
  'The expression ends where a value is expected.');
assert.equal(failure(Object.assign({}, base, { expression: '(github.ref == 1' })),
  'Expected \u201c)\u201d but found the end of the expression.');
assert.equal(failure(Object.assign({}, base, { expression: 'nosuchfn(1)' })),
  '\u201cnosuchfn\u201d is not one of the expression functions.');
assert.equal(failure(Object.assign({}, base, { expression: "hashFiles('x') == ''" })),
  'hashFiles() needs the files of the workflow workspace, so this page cannot evaluate it.');
assert.equal(failure(Object.assign({}, base, { expression: 'secretz.token == 1' })),
  '\u201csecretz\u201d is not a context here. Add it to the contexts JSON, or use github, env, vars, job and the rest of the documented contexts.');
assert.equal(failure(Object.assign({}, base, { contexts: '{"github": {"ref": "x"}, "env": [1]}' })),
  'The \u201cenv\u201d context must be a JSON object, because every context holds named values.');
assert.equal(failure(Object.assign({}, base, { contexts: 'not json' })).indexOf('The contexts are not valid JSON:'), 0);
assert.equal(failure(Object.assign({}, base, { status: 'broken' })),
  'Choose whether earlier steps succeeded, failed or were cancelled.');
assert.equal(failure(Object.assign({}, base, { wrapper: 'other' })),
  'Choose whether the expression is an if: condition or a plain value.');
assert.equal(failure(Object.assign({}, base, { expression: "format('{1}', 'a')" })),
  'format() refers to {1}, but only one value was supplied.');
assert.equal(failure(Object.assign({}, base, { expression: "format('{a}', 'a')" })),
  'format() needs a number inside each \u201c{\u2026}\u201d placeholder.');
assert.equal(failure(Object.assign({}, base, { expression: "case(1, 'a', 'b')" })),
  'case() needs each predicate to evaluate to true or false; argument 1 is Number.');
assert.equal(failure(Object.assign({}, base, { expression: "case(true, 'a', 'b', 'c')" })),
  'case() takes predicate and value pairs followed by a default, so it needs an odd number of arguments.');
assert.equal(failure(Object.assign({}, base, { expression: 'case(true, 1)' })),
  'case() takes predicate and value pairs followed by a default, so it needs an odd number of arguments.');
assert.equal(failure(Object.assign({}, base, { expression: 'case(true)' })),
  'case() needs at least one predicate, its value and a default.');
assert.equal(failure(Object.assign({}, base, { expression: "contains('a')" })),
  'contains() takes 2 arguments.');
assert.equal(failure(Object.assign({}, base, { expression: "fromJSON('')" })),
  'fromJSON() needs a JSON value, but the string is empty.');
assert.equal(failure(Object.assign({}, base, { expression: "'x' & 'y'" })),
  'Use && for \u201cand\u201d (position 5).');
assert.equal(failure(Object.assign({}, base, { expression: 'x'.repeat(C.MAX_EXPRESSION + 1) })).indexOf('The expression is longer than'), 0);
assert.equal(failure(Object.assign({}, base, { contexts: '{"a": "' + 'x'.repeat(C.MAX_CONTEXTS) + '"}' })).indexOf('The contexts JSON is longer than'), 0);

// ---- The wrapper is optional and stripped from either side.
assert.equal(value('${{ 1 == 1 }}'), true);
assert.equal(value('1 == 1'), true);

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 1);
assert.equal(record.sources[0].url, 'https://docs.github.com/en/actions/reference/workflows-and-actions/expressions');
assert.ok(record.method.length > 1200, 'the method explains the language');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 56, 'Developer count');
assert.equal(catalog.tools.length, 2479, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2218, 'public total');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 9, boundary: 9, validation: 12 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.calculate(testCase.input));
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: slug, name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>GitHub Actions Expression Evaluator<\/h1>/);
assert.match(html, /<form id="expr-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.match(html, /id="expression"/);
assert.match(html, /id="contexts"/);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function/.test(html), 'no network calls and no eval');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* github-actions-expression-core:start \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
for (const id of html.match(/getElementById\("([^"]+)"\)/g) || []) {
  const name = id.slice(16, -2);
  assert.ok(html.includes('id="' + name + '"'), 'the page defines #' + name);
}

console.log('github-actions-expression-evaluator: documented examples, coercion table, ' +
  'invariants, refusals, ' + record.testCases.length + ' catalog cases, uniqueness and page contract OK');
