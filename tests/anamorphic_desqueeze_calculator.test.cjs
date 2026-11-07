/* Regression checks for the anamorphic desqueeze core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/anamorphic-desqueeze-calculator/index.html'), 'utf8');
const start = html.indexOf('/* anacore:start */');
const end = html.indexOf('/* anacore:end */');
assert.ok(start > -1 && end > start, 'anamorphic core markers missing');
const core = html.slice(start, end + '/* anacore:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AnaCore;', sandbox);
const A = sandbox.module.exports;

const run = (input) => A.analyse(input);

// The default is a 16:9 UHD recording behind a 4:3 (1.33x) adapter.
const base = run({});
assert.equal(base.width, 3840);
assert.equal(base.height, 2160);
assert.equal(base.displayWidth, 5120);
assert.ok(Math.abs(base.aspect - 2.370370370) < 1e-9);
assert.equal(base.aspectLabel, '64:27');
assert.equal(base.storedLabel, '16:9');
assert.equal(base.megapixels, 8.2944);
assert.equal(base.target, null);

// Desqueezing only stretches the horizontal axis: the height and the pixel
// count are identical to the recording.
for (const squeeze of ['5/4', '4/3', '3/2', '8/5', '7/4', '9/5', '2/1', '1.42']) {
  const r = run({ squeeze });
  assert.equal(r.height, 2160, squeeze + ' height');
  assert.equal(r.megapixels, 8.2944, squeeze + ' pixels');
  assert.ok(Math.abs(r.displayWidth - Math.round(3840 * r.par)) <= 1, squeeze + ' width');
  assert.ok(Math.abs(r.aspect - (3840 * r.par) / 2160) < 1e-12, squeeze + ' aspect');
  assert.ok(Math.abs(r.par - r.squeeze) < 1e-12, squeeze + ' par');
}

// A fraction and its decimal are the same factor, and the pixel aspect ratio
// is the factor itself.
assert.ok(Math.abs(run({ squeeze: '16/9' }).par - run({ squeeze: 1.7777777778 }).par) < 1e-9);
assert.ok(Math.abs(run({ squeeze: '2/1' }).par - 2) < 1e-12);

// Published pairings: 16:9 with 1.33x is 2.37:1, 4:3 with 2x is 2.67:1,
// 16:9 with 2x is 3.56:1.
assert.ok(Math.abs(run({ squeeze: '4/3' }).aspect - 2.37037037) < 1e-6);
assert.ok(Math.abs(run({ width: 2880, squeeze: '2/1' }).aspect - 2.66666667) < 1e-6);
assert.ok(Math.abs(run({ squeeze: '2/1' }).aspect - 3.55555556) < 1e-6);

// A target equal to the frame's own aspect needs exactly the entered squeeze.
const aspect = run({}).aspect;
const exact = run({ target: String(aspect) });
assert.equal(exact.target.status, 'matches');
assert.ok(Math.abs(exact.target.squeeze - 4 / 3) < 1e-9);
assert.ok(Math.abs(exact.target.deltaPercent) < 1e-9);

// Wider frames miss a scope target by landing wide, narrower frames by landing narrow.
const wide = run({ squeeze: '2/1', target: 2.39 });
assert.equal(wide.target.status, 'misses');
assert.ok(wide.target.deltaPercent > 0);
const narrow = run({ width: 6048, height: 4032, squeeze: '3/2', target: 2.66 });
assert.ok(narrow.target.deltaPercent < 0);

// Ratio labels reduce exactly, and unusual frames fall back to a decimal.
assert.equal(A.ratioLabel(7680, 2160), '32:9');
assert.equal(A.ratioLabel(5120, 2160), '64:27');
assert.equal(A.ratioLabel(6144, 2160), '2.84:1');
assert.equal(A.ratioLabel(3277, 1080), '3.03:1');

// Validation keeps the input surface honest.
assert.throws(() => run({ width: '' }), /Recorded width is required\./);
assert.throws(() => run({ width: '3840.5' }), /whole number between 64 and 16384 px\./);
assert.throws(() => run({ height: '  ' }), /Recorded height is required\./);
assert.throws(() => run({ squeeze: '' }), /Squeeze factor is required\./);
assert.throws(() => run({ squeeze: '4/0' }), /must not divide by zero\./);
assert.throws(() => run({ squeeze: '9/2' }), /Squeeze factor must be between 1 and 3\./);
assert.throws(() => run({ target: '4.5' }), /Target aspect must be between 1 and 4\./);

// The page must not reach the network, store data or use inline handlers. The W3C
// SVG namespace string is an identifier, not a fetch, so it is ignored here.
const withoutSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutSvgNs), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/<textarea/i.test(html), 'page keeps the input surface to simple fields');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'anamorphic-desqueeze-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 24, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11);

const fields = {
  width: (result) => result.width,
  height: (result) => result.height,
  squeeze: (result) => result.squeeze,
  displayWidth: (result) => result.displayWidth,
  aspect: (result) => result.aspect,
  aspectLabel: (result) => result.aspectLabel,
  storedLabel: (result) => result.storedLabel,
  par: (result) => result.par,
  megapixels: (result) => result.megapixels,
  targetSqueeze: (result) => (result.target ? result.target.squeeze : null),
  targetStatus: (result) => (result.target ? result.target.status : null)
};

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => A.analyse(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = A.analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    const pick = fields[key];
    assert.ok(pick, 'unknown expected field ' + key);
    const actual = pick(result);
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(actual - value) < 1e-6, testCase.name + ' ' + key + ' (' + actual + ')');
    } else {
      assert.equal(actual, value, testCase.name + ' ' + key);
    }
  }
}

console.log('anamorphic-desqueeze-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
