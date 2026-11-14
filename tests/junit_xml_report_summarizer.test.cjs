/* JUnit XML report summarizer: the XML reader, the counting rules, the exact
   rejection messages, the page contract and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'junit-xml-report-summarizer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* junit-core:start */';
const endMarker = '/* junit-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreText), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, parseInt, module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = JunitCore;', sandbox);
const C = sandbox.module.exports;

const failure = (input) => {
  try { C.summarize(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, label) => {
  assert.equal(typeof actual, 'number', label + ' is not a number');
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
    label + ': ' + actual + ' != ' + expected);
};
const match = (actual, expected, label) => {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label + ' is not an array');
    assert.equal(actual.length, expected.length, label + ' length');
    expected.forEach((value, index) => match(actual[index], value, label + '[' + index + ']'));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', label + ' is not an object');
    for (const key of Object.keys(expected)) {
      assert.ok(Object.prototype.hasOwnProperty.call(actual, key), label + '.' + key + ' missing');
      match(actual[key], expected[key], label + '.' + key);
    }
    return;
  }
  if (typeof expected === 'number') { near(actual, expected, label); return; }
  assert.equal(actual, expected, label);
};

// ---- Clock formatting, including the millisecond carry.
assert.equal(C.fmtClock(0), '0:00.000');
assert.equal(C.fmtClock(0.012), '0:00.012');
assert.equal(C.fmtClock(83.421), '1:23.421');
assert.equal(C.fmtClock(59.9996), '1:00.000');
assert.equal(C.fmtClock(3723.5), '1:02:03.500');

// ---- The reader and the counting rules, written out from the method text.
const basic = C.summarize(
  '<testsuite name="s" tests="3" time="1.5">' +
  '<testcase classname="c" name="a" time="0.5"/>' +
  '<testcase classname="c" name="b" time="0.5"><failure message="no"/></testcase>' +
  '<testcase classname="c" name="d" time="0.5"><skipped/></testcase>' +
  '</testsuite>');
assert.equal(basic.total, 3);
assert.equal(basic.passed, 1);
assert.equal(basic.failed, 1);
assert.equal(basic.skipped, 1);
assert.equal(basic.errored, 0);
near(basic.passRate, 100 / 3, 'pass rate');
near(basic.durationSeconds, 1.5, 'suite time wins');
assert.equal(basic.durationSource, 'suite');
assert.equal(basic.suites.length, 1);
assert.equal(basic.failures[0].kind, 'failed');
assert.equal(basic.failureTotal, 1);

// Numeric character references and a quoted attribute containing ">".
const escaped = C.summarize('<testsuite name="a > b"><testcase name="caf&#233;" time="0.1"/></testsuite>');
assert.equal(escaped.suites[0].name, 'a > b');
assert.equal(escaped.slowest[0].name, 'café');
assert.equal(escaped.durationSource, 'testcase');

// A test case outside any suite is reported under "(no suite)".
const orphan = C.summarize('<testsuites><testcase name="lonely" time="0.2"/></testsuites>');
assert.equal(orphan.suites.length, 1);
assert.equal(orphan.suites[0].name, '(no suite)');
assert.equal(orphan.suites[0].total, 1);

// Error outranks skipped, failure outranks both.
const precedence = C.summarize(
  '<testsuite name="p"><testcase name="x"><skipped/><error message="e"/></testcase>' +
  '<testcase name="y"><error message="e"/><failure message="f"/></testcase></testsuite>');
assert.equal(precedence.errored, 1);
assert.equal(precedence.failed, 1);
assert.equal(precedence.skipped, 0);
assert.equal(precedence.passRate, 0);

// The slowest list keeps five entries and breaks ties in document order.
const timed = ['a', 'b', 'c', 'd', 'e', 'f'].map((name, index) =>
  '<testcase name="' + name + '" time="' + (index < 5 ? '1.0' : '2.0') + '"/>').join('');
const slow = C.summarize('<testsuite name="s">' + timed + '</testsuite>');
assert.equal(slow.slowest.length, 5);
assert.equal(slow.slowest[0].name, 'f');
assert.equal(slow.slowest[1].name, 'a');

// ---- The page contract.
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'the page makes no network or storage calls');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'no raw HTML sinks');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('/assets/theme-init.js'), 'the theme is applied before paint');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is used');
assert.ok(html.includes('/assets/app.js'), 'the shared header is loaded');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('@media (max-width:560px)'), 'the layout reflows for phones');
assert.ok(html.includes('overflow-x:auto'), 'tables scroll on narrow screens');
assert.ok(html.includes('setAttribute("scope", "col")'), 'table headers are scoped');
assert.ok(html.includes('<textarea id="report"'), 'the report is pasted into a textarea');
assert.ok(html.includes('aria-live="polite"'), 'results are announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2266, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'JUnit XML Report Summarizer');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.equal(record.icon, '🧪');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('junit'));
assert.ok(record.tags.includes('test-report'));
assert.ok(record.aliases.includes('JUnit Report Summarizer'));
assert.ok(record.method.length > 1000, 'the method documents the counting rules and its limits');
for (const phrase of ['testcase', 'precedence', 'DOCTYPE', 'no network']) {
  assert.ok(record.method.includes(phrase), 'method states ' + phrase);
}
assert.equal(record.sources.length, 3, 'sources are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 20));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 43, 'Developer count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'one name');
assert.equal(catalog.tools.filter((tool) => (tool.tags || []).includes('junit')).length, 1, 'one junit tool');

assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 16);
for (const testCase of record.testCases) {
  const expected = testCase.expected;
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input.xml), expected.error, testCase.name);
    continue;
  }
  match(C.summarize(testCase.input.xml), expected, testCase.name);
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases, the XML reader, the counting rules and the page contract pass');
