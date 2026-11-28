/* Fuel oil viscosity-temperature calculator: the ASTM D341 Walther fit through
   two measured points, its inverse, the refusals, the published RMG380
   cross-check, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fuel-oil-viscosity-temperature-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* fuel-viscosity-core:start */';
const endMarker = '/* fuel-viscosity-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = FuelViscosityCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { v1: 347.2, t1: 50, v2: 15, t2: 127, target: 10, check: 130 };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The published RMG380 worked example: 347.2 cSt at 50 °C, 15 cSt at
//      127 °C, and 10 cSt at 144 °C in the Britannia P&I table.
const defaults = run();
assert.equal(defaults.temperature, 144.4);
assert.equal(defaults.checkViscosity, 13.92);
assert.equal(defaults.slope, 3.527);
assert.equal(defaults.extrapolation, 17.4);
assert.equal(defaults.coldTemperature, 50);
assert.equal(defaults.hotTemperature, 127);
assert.equal(defaults.headline, '144.4 °C');
assert.equal(defaults.warnings.length, 0);

// The same table's transfer-pump limit of 800 cSt at 38 °C.
const pump = run({ target: 800, check: 38 });
assert.equal(pump.temperature, 38.0);
assert.ok(Math.abs(pump.checkViscosity - 801.63) <= 0.01);

// ---- The fit passes through both measured points, wherever they are.
let checked = 0;
for (const v1 of [2.4, 15, 46.4, 180, 380, 4000]) {
  for (const t1 of [15, 40, 50, 80]) {
    for (const ratio of [1.6, 2.5, 5, 12, 40]) {
      const v2 = v1 / ratio;
      if (v2 < 2) continue;
      const t2 = t1 + 40;
      if (t2 > 300) continue;
      const fit = { v1, t1, v2, t2, target: Math.max(2.1, v1 / 3), check: t1 };
      const cold = C.calculate(fit);
      assert.ok(Math.abs(cold.checkViscosity - v1) <= 0.02, 'the cold point is reproduced');
      const hot = C.calculate(Object.assign({}, fit, { check: t2 }));
      assert.ok(Math.abs(hot.checkViscosity - v2) <= 0.02, 'the hot point is reproduced');
      assert.ok(cold.slope > 0, 'the Walther slope is positive when viscosity falls with temperature');
      checked += 1;
    }
  }
}

// ---- Viscosity falls as the temperature rises, and the inverse solve agrees
//      with the forward one.
const temperatures = [60, 80, 100, 120, 140];
let previous = Infinity;
for (const t of temperatures) {
  const value = run({ check: t }).checkViscosity;
  assert.ok(value < previous, 'viscosity falls as temperature rises');
  previous = value;
}
for (const target of [5, 10, 20, 50, 200, 700]) {
  const solved = run({ target });
  const back = run({ check: solved.temperature });
  assert.ok(Math.abs(back.checkViscosity - target) / target < 0.01,
    'the solved temperature returns the target viscosity: ' + target);
}

// ---- Order does not matter; numeric strings behave like numbers.
const reversed = run({ v1: 15, t1: 127, v2: 347.2, t2: 50 });
for (const key of ['temperature', 'checkViscosity', 'slope', 'intercept', 'extrapolation', 'headline']) {
  assert.deepEqual(reversed[key], defaults[key], 'order independence: ' + key);
}
assert.deepEqual(C.calculate({ v1: '347.2', t1: '50', v2: '15', t2: '127', target: '10', check: '130' }), defaults);
assert.equal(run({ v2: '15.0' }).v2, 15);

// ---- Refusals, in the page's own words.
assert.equal(failure({ v1: '' }), 'The first viscosity is required.');
assert.equal(failure({ v1: '347.2 cSt' }), 'The first viscosity must be a number in cSt.');
assert.equal(failure({ v1: '1e3' }), 'The first viscosity must be a number in cSt.');
assert.equal(failure({ v2: 1.9 }), 'The second viscosity must be between 2 and 100,000 cSt.');
assert.equal(failure({ target: 0.5 }), 'The target viscosity must be between 2 and 100,000 cSt.');
assert.equal(failure({ t1: -51 }), 'The first temperature must be between -50 and 300 °C.');
assert.equal(failure({ check: 'hot' }), 'The check temperature must be a number in °C.');
assert.equal(failure({ t2: 50 }), 'The two reference temperatures must differ.');
assert.equal(failure({ v1: 15, v2: 347.2 }), 'The viscosity must fall as the temperature rises; swap the two reference points.');

// ---- Warnings: narrow span, far extrapolation, and an answer above 200 °C.
assert.ok(run({ v1: 200, t1: 50, v2: 165, t2: 65, target: 180, check: 60 }).warnings
  .some((w) => /less than 20 °C apart/.test(w)));
assert.ok(run({ v1: 100, t1: 50, v2: 20, t2: 100, target: 3, check: 150 }).warnings
  .some((w) => /more than 60 °C outside/.test(w)));
assert.ok(run({ v1: 100, t1: 50, v2: 20, t2: 100, target: 3, check: 150 }).warnings
  .some((w) => /Above 200 °C/.test(w)));
assert.ok(run({ target: 800, check: 38 }).warnings.some((w) => /more than 60 °C outside/.test(w)));
assert.equal(run().warnings.length, 0, 'the default fit is plausible');

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2516, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2255, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 57,
  'Oil, Gas & Marine Engineering count');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.match(record.method, /ASTM D341/);
assert.equal(record.sources.length, 2);
assert.match(record.sources[0].url, /^https:\/\/store\.astm\.org\//);
assert.match(record.sources[1].url, /^https:\/\/britanniapandi\.com\//);
assert.ok(record.tags.length === new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 4, validation: 6 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Fuel Oil Viscosity-Temperature Calculator<\/h1>/);
assert.match(html, /<form id="viscosity-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label[^>]* for="/g) || []).length, 6, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 6);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas|<select/.test(html), 'no embedded media or extra controls');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* fuel-viscosity-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* fuel-viscosity-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['viscosity-form', 'in-v1', 'in-t1', 'in-v2', 'in-t2', 'in-target', 'in-check', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('fuel oil viscosity calculator OK: ' + checked + ' fit cases, ' + record.testCases.length +
  ' catalog cases, inverse solve, refusals, warnings, uniqueness and page contract OK');
