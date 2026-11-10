/* Regression checks for the Git refname validator core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/git-refname-validator/index.html'), 'utf8');
const startMarker = '/* git-refname-core:start */';
const endMarker = '/* git-refname-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'Git refname core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = GitRefnameCore;', sandbox);
const C = sandbox.module.exports;

assert.equal(C.validateName('feature/parser', 'branch').valid, true);
assert.equal(C.validateName('-feature', 'branch').valid, false);
assert.equal(C.validateName('refs/tags/v1.2.3', 'full').valid, true);
assert.equal(C.validateName('main', 'full').valid, false);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'git-refname-validator');
assert.equal(records.length, 1, 'catalog entry exists exactly once');
const record = records[0];
assert.equal(record.name, 'Git Refname Validator');
assert.equal(record.category, 'Developer');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 17, 'catalog has golden, boundary and validation vectors');
assert.ok(record.sources.some((source) => source.url === 'https://git-scm.com/docs/git-check-ref-format'));

function runCase(testCase) {
  const got = C.evaluate(testCase.input);
  return {
    total: got.summary.total,
    valid: got.summary.valid,
    invalid: got.summary.invalid,
    validFlags: Array.from(got.results, (result) => result.valid),
    fullNames: Array.from(got.results, (result) => result.fullName),
    lines: Array.from(got.results, (result) => result.line)
  };
}

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    let thrown = null;
    try { runCase(testCase); } catch (error) { thrown = error; }
    assert.ok(thrown, `${testCase.name}: expected an error`);
    assert.equal(thrown.message, testCase.expected.error, testCase.name);
    continue;
  }
  const actual = runCase(testCase);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.ok(key in actual, `${testCase.name}: unknown expected key ${key}`);
    assert.deepEqual(actual[key], expected, `${testCase.name}: ${key}`);
  }
}

// Anchors checked against the installed Git implementation, including branch-only exceptions.
assert.equal(C.validateName('@', 'branch').valid, true);
assert.equal(C.validateName('@', 'full').valid, false);
assert.equal(C.validateName('HEAD', 'branch').valid, false);
assert.equal(C.validateName('feature/-parser', 'branch').valid, true);
assert.equal(C.validateName('feature.LOCK', 'branch').valid, true);
assert.equal(C.validateName('feature.lock', 'branch').valid, false);
assert.equal(C.validateName('refs/heads/é', 'full').valid, true);
assert.ok(C.validateName('refs/heads/a@{b', 'full').issues.includes('Names cannot contain the reflog sequence @{.'));
assert.ok(C.validateName('refs/heads/a\u0007b', 'full').issues.some((issue) => issue.includes('ASCII control character')));

// Input parsing preserves source line numbers and enforces bounded work.
{
  const got = C.evaluate({ text: 'main\r\n\r\nfeature/parser\r\n', mode: 'branch' });
  assert.deepEqual(Array.from(got.results, (result) => result.line), [1, 3]);
  assert.equal(got.summary.valid, 2);
}
assert.throws(() => C.validateName('main', 'other'));
assert.throws(() => C.evaluate({ text: '', mode: 'branch' }));
assert.throws(() => C.evaluate({ text: 'x'.repeat(1025), mode: 'branch' }));
assert.throws(() => C.evaluate({ text: Array(202).fill('main').join('\n'), mode: 'branch' }));

// The shipped page remains local, uses unique static IDs and resolves literal lookups.
assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML)\b/);
assert.doesNotMatch(html, /\beval\s*\(/);
const ids = new Set();
for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
  assert.ok(!ids.has(match[1]), `duplicate id ${match[1]}`);
  ids.add(match[1]);
}
for (const match of html.matchAll(/document\.getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.has(match[1]), `missing literal id ${match[1]}`);
}

console.log(`git-refname-validator: ${record.testCases.length} catalog cases, Git anchors and page contracts passed`);
