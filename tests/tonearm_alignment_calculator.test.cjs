/* Regression checks for the tonearm alignment calculator core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/tonearm-alignment-calculator/index.html'), 'utf8');
const start = html.indexOf('/* tonearm-core:start */');
const end = html.indexOf('/* tonearm-core:end */');
assert.ok(start > -1 && end > start, 'tonearm core markers missing');
const core = html.slice(start, end + '/* tonearm-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TonearmCore;', sandbox);
const C = sandbox.module.exports;
const arm = (input) => C.analyze(input);

// The documented default: 230 mm arm mounted 211.5 mm out at 23.5 degrees.
const standard = arm({ length: 230, pivot: 211.5, offset: 23.5, inner: 60.325, outer: 146.05 });
assert.equal(standard.overhang, 18.5);
assert.equal(standard.nullOne, 76.11);
assert.equal(standard.nullTwo, 107.31);
assert.equal(standard.middle, 90.38);
assert.equal(standard.minOffset, 23.14);
assert.equal(standard.teInner, -1.68);
assert.equal(standard.teOuter, -2.54);
assert.equal(standard.teMiddle, 0.36);
assert.equal(standard.worst, 2.54);
assert.equal(standard.worstAt, 'the outer edge');
assert.equal(standard.worstRadius, 146.05);

// The null points are where the tracking error vanishes, measured on the page's own angle.
for (const radius of [standard.nullOne, standard.nullTwo]) {
  assert.ok(Math.abs(C.errorAt(radius, 230, 211.5, 23.5)) < 0.02, `error at ${radius} mm should vanish`);
}
assert.ok(C.errorAt(standard.middle, 230, 211.5, 23.5) > 0, 'the peak between the nulls is positive');
assert.ok(C.errorAt(60.325, 230, 211.5, 23.5) < 0, 'the inner edge toes inward');
assert.ok(C.errorAt(146.05, 230, 211.5, 23.5) < 0, 'the outer edge toes inward');

// The positive peak is exactly the extra offset beyond the smallest usable one.
assert.ok(Math.abs(standard.teMiddle - (standard.offset - standard.minOffset)) < 0.02,
  'peak error should equal offset minus the smallest usable offset');

// The catalog carries the tool and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'tonearm-alignment-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.name, 'Tonearm Alignment Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 27);

// Overhang is the difference between effective length and mounting distance for every case,
// and the null radii always multiply to L^2 - d^2.
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') continue;
  const result = arm(testCase.input);
  const { length, pivot } = testCase.input;
  assert.ok(Math.abs(result.overhang - (length - pivot)) < 0.02, `${testCase.name}: overhang`);
  assert.ok(Math.abs(result.nullOne * result.nullTwo - (length * length - pivot * pivot)) < Math.max(0.6, length * 0.02),
    `${testCase.name}: null product should be L^2 - d^2`);
  assert.ok(result.nullOne < result.middle && result.middle < result.nullTwo, `${testCase.name}: null order`);
  if (result.inner < result.nullOne) {
    assert.ok(result.teInner <= 0.01, `${testCase.name}: an inner edge outside the nulls toes inward`);
  }
  if (result.outer > result.nullTwo) {
    assert.ok(result.teOuter <= 0.01, `${testCase.name}: an outer edge outside the nulls toes inward`);
  }
  if (result.teMiddle > 0.01) {
    assert.ok(result.teInner <= 0.01 || result.teOuter <= 0.01, `${testCase.name}: a positive peak needs an edge`);
  }
}

// More offset widens the null spread around the fixed midpoint sqrt(L^2 - d^2)
// and raises the peak between the nulls.
const less = arm({ length: 230, pivot: 211.5, offset: 24, inner: 60.325, outer: 146.05 });
const more = arm({ length: 230, pivot: 211.5, offset: 25, inner: 60.325, outer: 146.05 });
assert.ok(more.nullOne < less.nullOne && more.nullTwo > less.nullTwo, 'a bigger offset spreads both nulls outward');
assert.equal(more.middle, less.middle, 'the midpoint depends only on length and mounting distance');
assert.ok(more.teMiddle > less.teMiddle, 'a bigger offset raises the peak error');

// A shorter mounting distance needs a bigger offset before a null point exists at all.
const tight = arm({ length: 230, pivot: 200, offset: 30, inner: 60.325, outer: 146.05 });
assert.ok(tight.minOffset > standard.minOffset, 'a pivot closer to the spindle needs more offset');
assert.throws(() => arm({ length: 230, pivot: 200, offset: 23.5, inner: 60.325, outer: 146.05 }),
  /never reaches the groove tangent at this mounting distance: it needs at least 29\.59 degrees/);

// Geometry and range refusals.
assert.throws(() => arm({ length: 230, pivot: 230, offset: 23.5, inner: 60.325, outer: 146.05 }),
  /less than the effective arm length/);
assert.throws(() => arm({ length: 230, pivot: 211.5, offset: 23.5, inner: 146.05, outer: 60.325 }),
  /outer groove radius must be larger than the inner groove radius/);
assert.throws(() => arm({ length: 0, pivot: 211.5, offset: 23.5, inner: 60.325, outer: 146.05 }),
  /Effective arm length must be between 100 and 400 mm/);
assert.throws(() => arm({ pivot: 211.5, offset: 23.5, inner: 60.325, outer: 146.05 }),
  /Effective arm length is required/);

// Replay every canonical catalog test case against the core.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => arm(testCase.input), new RegExp(escape(testCase.expectedError)), testCase.name);
    continue;
  }
  const result = arm(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[key] - value) < 0.005, `${testCase.name} ${key}: ${result[key]} != ${value}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('tonearm-alignment-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
