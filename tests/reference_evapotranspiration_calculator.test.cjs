/* Regression checks for the FAO-56 reference evapotranspiration core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/reference-evapotranspiration-calculator/index.html'), 'utf8');
const start = html.indexOf('/* eto-core:start */');
const end = html.indexOf('/* eto-core:end */');
assert.ok(start > -1 && end > start, 'ETo core markers missing');
const core = html.slice(start, end + '/* eto-core:end */'.length);
assert.ok(!/document\.|window\.|fetch\(|localStorage|XMLHttpRequest/.test(core), 'the core stays free of DOM, storage and network access');
assert.ok(!/fetch\(|localStorage|XMLHttpRequest/.test(html), 'the page makes no network or storage call');

const sandbox = { module: {}, Date };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EtoCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const slug = 'reference-evapotranspiration-calculator';
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2495, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2234, 'public tools');
assert.equal(entry.category, 'Environment', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.equal(entry.sources.length, 2, 'the method and its worked example are cited');
for (const source of entry.sources) {
  assert.match(source.url, /^https:\/\/www\.fao\.org\/3\/x0490e\/x0490e0[68]\.htm$/, `source URL ${source.url}`);
}
assert.ok(entry.testCases.length >= 24, `expected at least 24 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are unique');

const close = (actual, expected, message, tolerance = 1e-6) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};

// Every published catalog case, replayed field by field.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.compute(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.compute(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    close(result[key], testCase.expected[key], `${label}: ${key}`);
  }
  assert.ok(result.et0 >= 0, `${label}: ET0 is never negative`);
  close(result.weekMm, result.et0 * 7, `${label}: weekly depth`);
}

// A dense fixture from an independent Python implementation of the same paper.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/eto_fao56_vectors.json'), 'utf8'));
assert.ok(fixture.vectors.length >= 200, `expected a dense fixture, found ${fixture.vectors.length}`);
for (const vector of fixture.vectors) {
  const result = C.compute(vector.input);
  for (const key of Object.keys(vector.expected)) {
    const expected = vector.expected[key];
    const tolerance = key === 'dayOfYear' ? 0 : Math.max(1e-9, Math.abs(expected) * 1e-10);
    close(result[key], expected, `${vector.input.date} ${vector.input.latitude}${vector.input.hemisphere} ${key}`, tolerance);
  }
}

// The published Uccle example: its own rounded figures are the oracle.
const uccleInput = {
  latitude: '50.8', hemisphere: 'N', elevation: '100', date: '2026-07-06',
  tmax: '21.5', tmin: '12.3', tempUnit: 'c', rhmax: '84', rhmin: '63',
  wind: '10', windUnit: 'kmh', windHeight: '10', sunshine: '9.25'
};
const uccle = C.compute(uccleInput);
close(uccle.wind2, 2.078, 'example wind at 2 m', 5e-4);
close(uccle.ra, 41.09, 'example Ra', 0.01);
close(uccle.daylight, 16.1, 'example daylight', 0.05);
close(uccle.rs, 22.07, 'example Rs', 0.01);
close(uccle.rn, 13.28, 'example Rn', 0.01);
close(uccle.es, 1.997, 'example es', 0.001);
close(uccle.ea, 1.409, 'example ea', 0.001);
close(uccle.radTerm, 2.81, 'example radiation term', 0.005);
close(uccle.aeroTerm, 1.07, 'example aerodynamic term', 0.005);
close(uccle.et0, 3.88, 'example ET0', 0.005);

// Temperature units, wind units and wind-height conversion are the same weather.
const metric = C.compute({
  latitude: '40', hemisphere: 'N', elevation: '100', date: '2026-08-01',
  tmax: '35', tmin: '21.11111111111111', tempUnit: 'c', rhmax: '80', rhmin: '45',
  wind: '3.57632', windUnit: 'ms', windHeight: '2', sunshine: '10'
});
const imperial = C.compute({
  latitude: '40', hemisphere: 'N', elevation: '100', date: '2026-08-01',
  tmax: '95', tmin: '70', tempUnit: 'f', rhmax: '80', rhmin: '45',
  wind: '8', windUnit: 'mph', windHeight: '2', sunshine: '10'
});
close(imperial.et0, metric.et0, 'Fahrenheit/mph equivalence', 1e-9);

// A 10 m reading converts down to 2 m, and a 2 m reading is left alone.
const atTwo = C.compute({ ...uccleInput, windHeight: '2' });
close(atTwo.wind2, 2.7777777777777777, '2 m reading kept', 1e-12);
assert.ok(uccle.wind2 < 2.2, '10 m reading is reduced');

// A negative energy balance is reported as zero, with the flag set.
const frozen = C.compute({
  latitude: '65', hemisphere: 'N', elevation: '200', date: '2026-12-21',
  tmax: '-10', tmin: '-20', tempUnit: 'c', rhmax: '90', rhmin: '80',
  wind: '0', windUnit: 'ms', windHeight: '2', sunshine: '0'
});
assert.ok(frozen.et0Raw < 0, 'the frozen case has a negative raw balance');
assert.equal(frozen.et0, 0, 'negative ET0 is clamped to zero');
assert.equal(frozen.clamped, true, 'clamp flag');

// Half-away-from-zero rounding, including the binary tie that toFixed gets wrong.
assert.equal(C.fmt(82.85, 1), '82.9', '82.85 rounds up');
assert.equal(C.fmt(2.675, 2), '2.68', '2.675 rounds up');
assert.equal(C.fmt(3.880259, 1), '3.9', 'example display');
assert.equal(C.fmt(16.104612, 1), '16.1', 'daylight display');

// Day of year is a property of the calendar, including leap years.
assert.equal(C.dayOfYear('2026-01-01'), 1, 'new year');
assert.equal(C.dayOfYear('2026-12-31'), 365, 'end of a common year');
assert.equal(C.dayOfYear('2024-12-31'), 366, 'end of a leap year');
assert.equal(C.dayOfYear('2024-02-29'), 60, 'leap day');

// The sunshine refusal names the daylight of the chosen day, not a fixed number.
assert.throws(
  () => C.compute({ ...uccleInput, sunshine: '20' }),
  (error) => {
    assert.match(error.message, /hours for this date and latitude\.$/, 'sunshine refusal context');
    return true;
  }
);

console.log('reference ET checks passed:', entry.testCases.length, 'catalog cases,', fixture.vectors.length, 'vectors');
