/* Regression checks for the calligraphy guideline core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/calligraphy-guideline-calculator/index.html'), 'utf8');
const start = html.indexOf('/* calligraphy-guide-core:start */');
const end = html.indexOf('/* calligraphy-guide-core:end */');
assert.ok(start > -1 && end > start, 'calligraphy guide core markers missing');
const core = html.slice(start, end + '/* calligraphy-guide-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CalligraphyGuideCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);

// Defaults: 2.5 mm nib, body 4, ascender 3, descender 2.5, gap 1, slant 15.
assert.deepEqual(JSON.parse(JSON.stringify(run({}))), {
  nib: 2.5, bodyNibs: 4, ascenderNibs: 3, descenderNibs: 2.5, gapNibs: 1, slantDegrees: 15,
  body: 10, ascender: 7.5, descender: 6.25, gap: 2.5, band: 23.75, lineSpacing: 26.25,
  slantRunBody: 2.679, slantRunBand: 6.364, slantRatio: 3.732
});

// Every height is the nib width times its own ratio, and the band is their sum.
for (const [nib, body, ascender, descender, gap] of [
  [2.5, 4, 3, 2.5, 1], [3, 5, 4, 3, 0], [1.5, 3, 2, 2, 2], [0.2, 1, 0, 0, 0], [10, 10, 8, 8, 10], [2.4, 4.5, 2.5, 3.5, 1.5]
]) {
  const r = run({ nib, bodyNibs: body, ascenderNibs: ascender, descenderNibs: descender, gapNibs: gap, slantDegrees: 0 });
  assert.equal(r.body, Math.round(nib * body * 1000) / 1000, 'body');
  assert.equal(r.ascender, Math.round(nib * ascender * 1000) / 1000, 'ascender');
  assert.equal(r.descender, Math.round(nib * descender * 1000) / 1000, 'descender');
  assert.equal(r.gap, Math.round(nib * gap * 1000) / 1000, 'gap');
  assert.equal(r.band, Math.round((r.body + r.ascender + r.descender) * 1000) / 1000, 'band');
  assert.equal(r.lineSpacing, Math.round((r.band + r.gap) * 1000) / 1000, 'line spacing');
  assert.ok(r.lineSpacing >= r.band, 'spacing never drops below the band');
}

// The slant run is height times the tangent, checked against an independent tangent.
for (const degrees of [5, 10, 15, 20, 30, 40, 45]) {
  const r = run({ nib: 2.5, bodyNibs: 4, ascenderNibs: 3, descenderNibs: 2.5, gapNibs: 1, slantDegrees: degrees });
  const tangent = Math.tan((degrees * Math.PI) / 180);
  assert.ok(Math.abs(r.slantRunBody - r.body * tangent) < 1e-3, 'body run ' + degrees);
  assert.ok(Math.abs(r.slantRunBand - r.band * tangent) < 1e-3, 'band run ' + degrees);
  assert.ok(Math.abs(r.slantRatio - 1 / tangent) < 1e-3, 'slope ' + degrees);
}

// Upright guides have no run and no finite slope, rather than an infinite ratio.
const upright = run({ slantDegrees: 0 });
assert.equal(upright.slantRunBody, 0);
assert.equal(upright.slantRunBand, 0);
assert.equal(upright.slantRatio, null);

// A steeper slant runs further sideways for the same heights.
const shallow = run({ slantDegrees: 10 });
const steep = run({ slantDegrees: 35 });
assert.ok(steep.slantRunBody > shallow.slantRunBody);
assert.ok(steep.slantRatio < shallow.slantRatio);

// Larger nib widths scale every height linearly; slant runs carry rounding slop only.
const small = run({ nib: 1 });
const large = run({ nib: 4 });
for (const key of ['body', 'ascender', 'descender', 'gap', 'band', 'lineSpacing']) {
  assert.equal(large[key], Math.round(small[key] * 4 * 1000) / 1000, key + ' scales');
}
for (const key of ['slantRunBody', 'slantRunBand']) {
  assert.ok(Math.abs(large[key] - small[key] * 4) < 0.01, key + ' scales');
}

// Inclusive bounds at both ends of every range.
const bottom = run({ nib: 0.2, bodyNibs: 1, ascenderNibs: 0, descenderNibs: 0, gapNibs: 0, slantDegrees: 0 });
assert.equal(bottom.body, 0.2);
assert.equal(bottom.band, 0.2);
assert.equal(bottom.lineSpacing, 0.2);
const top = run({ nib: 10, bodyNibs: 10, ascenderNibs: 8, descenderNibs: 8, gapNibs: 10, slantDegrees: 45 });
assert.equal(top.body, 100);
assert.equal(top.band, 260);
assert.equal(top.lineSpacing, 360);
assert.equal(top.slantRatio, 1);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ nib: '' }), /Nib width is required\./);
assert.throws(() => run({ nib: 'two and a half' }), /Nib width must be a number from 0\.2 to 10 mm\./);
assert.throws(() => run({ nib: 0.19 }), /Nib width must be a number from 0\.2 to 10 mm\./);
assert.throws(() => run({ nib: 10.01 }), /Nib width must be a number from 0\.2 to 10 mm\./);
assert.throws(() => run({ nib: -2 }), /Nib width must be a number from 0\.2 to 10 mm\./);
assert.throws(() => run({ bodyNibs: '' }), /Body height \(x-height\) is required\./);
assert.throws(() => run({ bodyNibs: 0.99 }), /Body height \(x-height\) must be a number from 1 to 10 nib widths\./);
assert.throws(() => run({ bodyNibs: 10.5 }), /Body height \(x-height\) must be a number from 1 to 10 nib widths\./);
assert.throws(() => run({ ascenderNibs: -0.5 }), /Ascender allowance must be a number from 0 to 8 nib widths\./);
assert.throws(() => run({ ascenderNibs: 8.1 }), /Ascender allowance must be a number from 0 to 8 nib widths\./);
assert.throws(() => run({ descenderNibs: -1 }), /Descender allowance must be a number from 0 to 8 nib widths\./);
assert.throws(() => run({ descenderNibs: 9 }), /Descender allowance must be a number from 0 to 8 nib widths\./);
assert.throws(() => run({ gapNibs: -1 }), /Line gap must be a number from 0 to 10 nib widths\./);
assert.throws(() => run({ gapNibs: 10.1 }), /Line gap must be a number from 0 to 10 nib widths\./);
assert.throws(() => run({ slantDegrees: -1 }), /Slant must be a number from 0 to 45 degrees\./);
assert.throws(() => run({ slantDegrees: 45.1 }), /Slant must be a number from 0 to 45 degrees\./);
assert.throws(() => run({ slantDegrees: 'fifteen' }), /Slant must be a number from 0 to 45 degrees\./);
assert.throws(() => run({ nib: '.5.' }), /Nib width must be a number from 0\.2 to 10 mm\./);

// The page must not reach the network, store data or use inline handlers.
const withoutNamespaces = html
  .replace(/https:\/\/virt\.tools[^"]*/g, '')
  .replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutNamespaces), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'calligraphy-guideline-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 24, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('calligraphy guideline core: all checks passed');
