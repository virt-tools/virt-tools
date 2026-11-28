/* Screw conveyor capacity: the CEMA volumetric arithmetic checked against its
   own geometry, the unit conversion, the refusals, the page markup and every
   catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'screw-conveyor-capacity-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* screw-core:start */';
const endMarker = '/* screw-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ScrewCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.calculate(payload); } catch (error) { return error.message; }
  return null;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const DEFAULTS = C.DEFAULTS;
assert.equal(JSON.stringify(DEFAULTS), JSON.stringify({ unit: 'metric', diameter: 300, shaft: 76, pitch: 300, rpm: 60, fill: 30, density: 800 }));

// ---- The flight annulus over one pitch, once per turn: the reported capacity
// is the full flight volume, the speed and the loading multiplied out.
let sweep = 0;
for (const diameter of [50, 120, 300, 600, 1000, 1500]) {
  for (const shaft of [0, 42, 76, 168, 300]) {
    if (shaft >= diameter) continue;
    for (const pitch of [50, 150, 300, 600, 1200]) {
      for (const rpm of [0, 10, 60, 300]) {
        for (const fill of [5, 30, 45]) {
          const row = C.calculate({ diameter, shaft, pitch, rpm, fill, density: 800 });
          const d = diameter / 1000;
          const s = shaft / 1000;
          const p = pitch / 1000;
          const area = Math.PI * (d * d - s * s) / 4;
          const volume = area * p;
          const capacity = volume * rpm * 60 * fill / 100;
          assert.ok(near(row.capacityM3h, capacity, 1e-5), 'capacity at ' + diameter + '/' + shaft + '/' + pitch);
          assert.ok(near(row.volumePerRevM3, volume, 1e-9), 'volume per turn');
          assert.ok(near(row.areaM2, area, 1e-9), 'flight area');
          assert.ok(near(row.filledAreaCm2, area * fill / 100 * 1e4, 1e-5), 'filled area');
          assert.ok(near(row.capacityTh, capacity * 0.8, 1e-5), 'mass capacity at 800 kg/m3');
          assert.ok(near(row.tipSpeedMps, Math.PI * d * rpm / 60, 1e-6), 'tip speed');
          assert.ok(near(row.perRpmM3h, volume * 60 * fill / 100, 1e-5), 'capacity per rpm');
          assert.ok(near(row.capacityFt3h, capacity / 0.028316846592, 1e-4), 'cubic feet');
          assert.ok(near(row.capacityShortTonH, row.capacityTh * 1.102311310924388, 1e-5), 'short tons');
          sweep += 1;
        }
      }
    }
  }
}
assert.ok(sweep > 500, 'the sweep covers the catalog (' + sweep + ')');

// ---- The same physical screw reads the same in both unit systems.
for (const [diameter, shaft, pitch, rpm, fill, density] of [
  [300, 76, 300, 60, 30, 800],
  [150, 42, 150, 120, 45, 1600],
  [600, 168, 600, 30, 15, 2400],
  [76.2, 0, 76.2, 300, 15, 400]
]) {
  const metric = C.calculate({ diameter, shaft, pitch, rpm, fill, density });
  const imperial = C.calculate({
    unit: 'imperial', diameter: diameter / 25.4, shaft: shaft / 25.4, pitch: pitch / 25.4,
    rpm, fill, density: density / 16.018463373960138
  });
  assert.ok(near(metric.capacityM3h, imperial.capacityM3h, 1e-6), 'metric and imperial agree on m3/h');
  assert.ok(near(metric.capacityTh, imperial.capacityTh, 1e-6), 'metric and imperial agree on t/h');
  assert.ok(near(metric.areaCm2, imperial.areaCm2, 1e-6), 'flight area agrees');
  assert.ok(near(metric.volumePerRevL, imperial.volumePerRevL, 1e-6), 'volume per turn agrees');
}

// ---- A wider flight, more speed or a fuller trough carries more; a fatter
// shaft leaves less room.
const base = { diameter: 300, shaft: 76, pitch: 300, rpm: 60, fill: 30, density: 800 };
const baseLine = C.calculate(base).capacityTh;
assert.ok(C.calculate({ ...base, diameter: 400 }).capacityTh > baseLine, 'a bigger screw carries more');
assert.ok(C.calculate({ ...base, shaft: 120 }).capacityTh < baseLine, 'a bigger shaft carries less');
assert.ok(C.calculate({ ...base, pitch: 450 }).capacityTh > baseLine, 'a longer pitch carries more');
assert.ok(C.calculate({ ...base, rpm: 90 }).capacityTh > baseLine, 'more speed carries more');
assert.ok(C.calculate({ ...base, fill: 45 }).capacityTh > baseLine, 'a fuller trough carries more');
assert.ok(C.calculate({ ...base, density: 1600 }).capacityTh > baseLine, 'a denser material weighs more');
assert.equal(C.calculate({ ...base, density: 1600 }).capacityM3h, C.calculate(base).capacityM3h, 'density leaves the volume alone');

// ---- Defaults and the arithmetic behind the published display.
const defaults = C.calculate({});
assert.equal(defaults.capacityM3h, 21.432397);
assert.equal(defaults.capacityTh, 17.145918);
assert.equal(defaults.capacityFt3h, 756.877974);
assert.equal(defaults.capacityShortTonH, 18.900139);
assert.equal(defaults.areaCm2, 661.493749);
assert.equal(defaults.filledAreaCm2, 198.448125);
assert.equal(defaults.volumePerRevL, 19.844812);
assert.equal(defaults.perRpmM3h, 0.357207);
assert.equal(defaults.tipSpeedMps, 0.942478);
assert.equal(defaults.pitchRatio, 1);

// ---- The published selection table: 12 in screw, 3 1/2 in pipe, 12 in pitch,
// 30% loading carries 12.9 ft3/h per rpm; the page gives 12.93.
const table = C.calculate({ unit: 'imperial', diameter: '12', shaft: '3.5', pitch: '12', rpm: '1', fill: '30', density: '50' });
assert.equal(table.capacityFt3h, 12.934526);
assert.equal(table.perRpmFt3h, 12.934526);

// ---- A screw that is not turning, and a shaftless screw.
const idle = C.calculate({ rpm: 0 });
assert.equal(idle.capacityM3h, 0);
assert.equal(idle.capacityTh, 0);
assert.equal(idle.perRpmM3h, defaults.perRpmM3h, 'the per-rpm figure is geometry, not speed');
assert.equal(idle.tipSpeedMps, 0);
assert.equal(idle.volumePerRevL, defaults.volumePerRevL, 'geometry does not change when the screw stops');
for (const value of Object.values(idle)) {
  assert.ok(typeof value === 'string' || Number.isFinite(value), 'no NaN or infinity in the idle result');
}
const shaftless = C.calculate({ shaft: 0 });
assert.ok(shaftless.areaCm2 > defaults.areaCm2, 'a shaftless screw has the full flight area');
assert.equal(shaftless.shaft, 0);

// ---- Switching the unit selector converts the figures already typed, so the
// same physical screw stays on screen.
for (const [quantity, from, to, values] of [
  ['length', 'metric', 'imperial', [25, 76, 300, 1500]],
  ['length', 'imperial', 'metric', [1, 3, 12, 60]],
  ['density', 'metric', 'imperial', [50, 800, 4000]],
  ['density', 'imperial', 'metric', [3, 50, 250]]
]) {
  for (const value of values) {
    const converted = Number(C.convert(String(value), quantity, from, to));
    assert.ok(isFinite(converted) && converted > 0, 'converted ' + quantity + ' ' + value);
    const back = Number(C.convert(String(converted), quantity, to, from));
    const tolerance = Math.max(1e-6, Math.abs(value) * 5e-3);
    assert.ok(Math.abs(back - value) <= tolerance, 'round trip ' + quantity + ' ' + value + ' -> ' + converted + ' -> ' + back);
  }
}
assert.equal(C.convert('', 'length', 'metric', 'imperial'), '', 'an empty field stays empty');
assert.equal(C.convert('abc', 'length', 'metric', 'imperial'), 'abc', 'unreadable text is left for the refusal');
assert.equal(C.convert('300', 'length', 'metric', 'metric'), '300', 'the same unit is untouched');
const metricRun = C.calculate({});
const switched = C.calculate({
  unit: 'imperial',
  diameter: C.convert('300', 'length', 'metric', 'imperial'),
  shaft: C.convert('76', 'length', 'metric', 'imperial'),
  pitch: C.convert('300', 'length', 'metric', 'imperial'),
  rpm: '60', fill: '30',
  density: C.convert('800', 'density', 'metric', 'imperial')
});
assert.ok(near(switched.capacityTh, metricRun.capacityTh, 1e-2), 'switching units keeps the run ('
  + switched.capacityTh + ' vs ' + metricRun.capacityTh + ')');

// ---- Inputs are not mutated.
const frozen = Object.freeze({ diameter: 300, shaft: 76, pitch: 300, rpm: 60, fill: 30, density: 800 });
const before = JSON.stringify(frozen);
C.calculate(frozen);
assert.equal(JSON.stringify(frozen), before, 'input untouched');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Screw Conveyor Capacity Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 400, 'description length ' + record.description.length);
assert.equal(record.testCases.length, 25, 'catalog case count');
assert.equal(record.sources.length, 2, 'the capacity form carries its references');
for (const source of record.sources) {
  assert.ok(/^https:\/\//.test(source.url), 'source url ' + source.url);
  assert.ok(source.title.length > 60, 'source title explains what it supports');
}
assert.ok(record.method.includes('0.7854'), 'the method states the CEMA constant');
assert.ok(record.method.includes('\u03c0/4'), 'the method states the metric form');
assert.ok(record.method.length > 1200, 'method explains the arithmetic');
assert.ok(record.guidance.length > 120, 'guidance');
assert.ok(record.tags.includes('screw-conveyor') && record.tags.includes('trough-loading'), 'tags');

const others = catalog.tools.filter((tool) => tool.slug !== slug);
const takenSlugs = new Set(others.map((tool) => tool.slug));
const takenNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const takenAliases = new Set();
for (const tool of others) for (const alias of tool.aliases || []) takenAliases.add(alias.toLowerCase());
assert.ok(!takenSlugs.has(slug), 'slug collides with another tool');
assert.ok(!takenNames.has(record.name.toLowerCase()), 'name collides with another tool');
for (const alias of record.aliases) {
  const key = alias.toLowerCase();
  assert.ok(!takenAliases.has(key), 'alias collides with another alias: ' + alias);
  assert.ok(!takenNames.has(key), 'alias repeats another tool name: ' + alias);
}
assert.ok(record.aliases.includes(record.name), 'the page title is listed as an alias');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'alias duplicates');
assert.ok(!others.some((tool) => /conveyor/i.test(tool.slug + ' ' + tool.name)), 'no other conveyor tool');

let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.input, 'malformed case');
  if (testCase.kind !== 'validation') {
    assert.ok(testCase.kind === 'golden' || testCase.kind === 'boundary', 'unknown case kind ' + testCase.kind);
    const result = C.calculate(testCase.input);
    for (const [key, want] of Object.entries(testCase.expected)) {
      assert.equal(typeof result[key], typeof want, testCase.name + ': ' + key + ' type');
      assert.ok(near(result[key], want), testCase.name + ': ' + key + ' (' + result[key] + ' vs ' + want + ')');
    }
    goldens += 1;
  } else {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 11, 'golden cases');
assert.equal(refusals, 14, 'refusal cases');

// ---- Catalog totals pinned site-wide.
assert.equal(catalog.tools.length, 2531, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2270, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 58,
  'Mechanical & Structural Engineering count');

// ---- Page contract.
assert.match(html, /<title>Screw Conveyor Capacity Calculator/);
assert.match(html, /<meta name="description" content="Work out what a screw conveyor will carry/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-unit', 'in-diameter', 'in-shaft', 'in-pitch', 'in-rpm', 'in-fill', 'in-density',
  'out', 'err', 'warn', 'reset', 'screw-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
}
for (const label of ['in-unit', 'in-diameter', 'in-shaft', 'in-pitch', 'in-rpm', 'in-fill', 'in-density']) {
  assert.ok(html.includes('for="' + label + '"'), 'label for ' + label);
}
assert.ok(html.includes('<option value="metric" selected>') && html.includes('<option value="imperial">'), 'unit options');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok(html.includes('aria-live="polite"'), 'live region');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>Screw Conveyor Capacity Calculator</h1>'));
assert.ok(html.includes('Everything runs in your browser'), 'storage disclosure');

console.log('screw conveyor capacity: ' + goldens + ' goldens, ' + refusals +
  ' refusals, ' + sweep + ' sweep rows, page and catalog contract ok');
