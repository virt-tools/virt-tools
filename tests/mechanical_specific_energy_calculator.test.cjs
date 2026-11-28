/* Mechanical specific energy: the Teale arithmetic checked against its own
   energy balance, the unit conversion, the refusals, the page markup and every
   catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'mechanical-specific-energy-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* mse-core:start */';
const endMarker = '/* mse-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MseCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.calculate(payload); } catch (error) { return error.message; }
  return null;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const DEFAULTS = C.DEFAULTS;
assert.equal(JSON.stringify(DEFAULTS), JSON.stringify({ unit: 'metric', wob: 80, torque: 3, rpm: 120, rop: 25, diameter: 215.9 }));

// ---- The two terms are the axial pressure and the rotary power per volume
// rate, so MSE times the volume rate returns the mechanical power.
for (const diameter of [10, 96, 215.9, 311.2, 1500]) {
  for (const wob of [0, 20, 200, 2000]) {
    for (const [torque, rpm, rop] of [[0.5, 60, 3], [3, 120, 25], [12, 400, 60], [200, 1000, 1000]]) {
      const row = C.calculate({ wob, torque, rpm, rop, diameter });
      const d = diameter / 1000;
      const area = Math.PI * d * d / 4;
      const rate = rop / 3600;
      const weight = wob * 1000;
      const moment = torque * 1000;
      const power = weight * rate + 2 * Math.PI * (rpm / 60) * moment;
      assert.ok(near(row.mseMPa * 1e6, power / (area * rate), Math.max(2, power / (area * rate) * 1e-9)),
        'energy balance at ' + diameter + ' mm, ' + wob + ' kN, ' + torque + ' kN m');
      assert.ok(near(row.axialMPa, weight / area / 1e6, 2e-6), 'axial term');
      assert.ok(near(row.rotaryMPa, 2 * Math.PI * (rpm / 60) * moment / (area * rate) / 1e6, 2e-6), 'rotary term');
      assert.ok(near(row.axialMPa + row.rotaryMPa, row.mseMPa, 5e-6), 'the terms add up');
      assert.ok(near(row.axialShare + row.rotaryShare, 100, 1e-5), 'the shares add up');
      assert.ok(near(row.msePsi, row.mseMPa * 1e6 / 6894.757293168361,
        Math.max(2e-3, Math.abs(row.msePsi) * 1e-9)), 'psi conversion');
    }
  }
}

// ---- The same physical run reads the same in both unit systems.
for (const [wob, torque, rpm, rop, diameter] of [[80, 3, 120, 25, 215.9], [200, 12, 60, 3, 311.2], [20, 0.5, 400, 60, 96]]) {
  const metric = C.calculate({ wob, torque, rpm, rop, diameter });
  const imperial = C.calculate({
    unit: 'imperial', wob: wob * 1000 / 4.4482216152605, torque: torque * 1000 / 1.3558179483314004,
    rpm, rop: rop / 0.3048, diameter: diameter / 25.4
  });
  assert.ok(near(metric.mseMPa, imperial.mseMPa, 1e-9), 'metric and imperial agree on MPa');
  assert.ok(near(metric.msePsi, imperial.msePsi, 1e-6), 'metric and imperial agree on psi');
  assert.ok(near(metric.bitAreaCm2, imperial.bitAreaCm2, 1e-6), 'bit area agrees');
  assert.ok(near(metric.ropFth, imperial.ropFth, 1e-6), 'rate agrees');
}

// ---- More torque, more weight or a slower rate raises the figure; a bigger
// bit spreads the same load over more rock.
const base = { wob: 80, torque: 3, rpm: 120, rop: 25, diameter: 215.9 };
const baseLine = C.calculate(base).mseMPa;
assert.ok(C.calculate({ ...base, torque: 4 }).mseMPa > baseLine, 'torque raises MSE');
assert.ok(C.calculate({ ...base, wob: 120 }).mseMPa > baseLine, 'weight raises MSE');
assert.ok(C.calculate({ ...base, rop: 12.5 }).mseMPa > baseLine, 'a slower rate raises MSE');
assert.ok(C.calculate({ ...base, rop: 50 }).mseMPa < baseLine, 'a faster rate lowers MSE');
assert.ok(C.calculate({ ...base, rpm: 240 }).mseMPa > baseLine, 'more rotary speed raises MSE');
assert.ok(C.calculate({ ...base, diameter: 311.2 }).mseMPa < baseLine, 'a bigger bit lowers MSE');

// ---- Defaults and the arithmetic behind the published display.
const defaults = C.calculate({});
assert.equal(defaults.mseMPa, 150.470636);
assert.equal(defaults.msePsi, 21823.920631);
assert.equal(defaults.axialMPa, 2.185218);
assert.equal(defaults.rotaryMPa, 148.285418);
assert.equal(defaults.rotaryShare, 98.547744);
assert.equal(defaults.bitAreaCm2, 366.096154);
assert.equal(defaults.ropFth, 82.020997);

// ---- Zero terms are reported, not hidden.
const noTorque = C.calculate({ torque: 0 });
assert.equal(noTorque.rotaryMPa, 0);
assert.equal(noTorque.rotaryShare, 0);
assert.equal(noTorque.axialShare, 100);
assert.equal(noTorque.mseMPa, noTorque.axialMPa);
const noWeight = C.calculate({ wob: 0 });
assert.equal(noWeight.axialMPa, 0);
assert.equal(noWeight.mseMPa, noWeight.rotaryMPa);
const idle = C.calculate({ wob: 0, torque: 0 });
assert.equal(idle.mseMPa, 0);
assert.equal(idle.axialShare, 0);
assert.equal(idle.rotaryShare, 0, 'no share of nothing');

// ---- Switching the unit selector converts the figures already typed, so the
// same physical run stays on screen.
for (const [quantity, from, to, values] of [
  ['wob', 'metric', 'imperial', [20, 80, 2000]],
  ['wob', 'imperial', 'metric', [5000, 17984.85, 450000]],
  ['torque', 'metric', 'imperial', [0.5, 3, 200]],
  ['torque', 'imperial', 'metric', [369, 2212.69, 150000]],
  ['rop', 'metric', 'imperial', [0.1, 25, 1000]],
  ['rop', 'imperial', 'metric', [0.3, 82.02, 3280]],
  ['diameter', 'metric', 'imperial', [10, 215.9, 1500]],
  ['diameter', 'imperial', 'metric', [0.4, 8.5, 59]]
]) {
  for (const value of values) {
    const converted = Number(C.convert(String(value), quantity, from, to));
    assert.ok(isFinite(converted) && converted > 0, 'converted ' + quantity + ' ' + value);
    const back = Number(C.convert(String(converted), quantity, to, from));
    const tolerance = Math.max(1e-6, Math.abs(value) * 5e-3);
    assert.ok(Math.abs(back - value) <= tolerance, 'round trip ' + quantity + ' ' + value + ' -> ' + converted + ' -> ' + back);
  }
}
assert.equal(C.convert('', 'wob', 'metric', 'imperial'), '', 'an empty field stays empty');
assert.equal(C.convert('abc', 'wob', 'metric', 'imperial'), 'abc', 'unreadable text is left for the refusal');
assert.equal(C.convert('80', 'wob', 'metric', 'metric'), '80', 'the same unit is untouched');
const metricRun = C.calculate({});
const switched = C.calculate({
  unit: 'imperial',
  wob: C.convert('80', 'wob', 'metric', 'imperial'),
  torque: C.convert('3', 'torque', 'metric', 'imperial'),
  rpm: '120',
  rop: C.convert('25', 'rop', 'metric', 'imperial'),
  diameter: C.convert('215.9', 'diameter', 'metric', 'imperial')
});
assert.ok(near(switched.mseMPa, metricRun.mseMPa, 1e-3), 'switching units keeps the run ('
  + switched.mseMPa + ' vs ' + metricRun.mseMPa + ')');

// ---- Inputs are not mutated.
const frozen = Object.freeze({ wob: 80, torque: 3, rpm: 120, rop: 25, diameter: 215.9 });
const before = JSON.stringify(frozen);
C.calculate(frozen);
assert.equal(JSON.stringify(frozen), before, 'input untouched');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Mechanical Specific Energy Calculator');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 400, 'description length ' + record.description.length);
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.equal(record.sources.length, 2, 'the equation carries its references');
for (const source of record.sources) {
  assert.ok(/^https:\/\//.test(source.url), 'source url ' + source.url);
  assert.ok(source.title.length > 60, 'source title explains what it supports');
}
assert.ok(record.method.includes('120\u03c0'), 'the method states the 120 pi constant');
assert.ok(record.method.includes('Ab = \u03c0 D\u00b2 / 4'), 'the method states the bit area');
assert.ok(record.method.length > 1200, 'method explains the arithmetic');
assert.ok(record.guidance.length > 120, 'guidance');
assert.ok(record.tags.includes('drilling') && record.tags.includes('mse') && record.tags.includes('mechanical-specific-energy'), 'tags');

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
assert.equal(goldens, 10, 'golden cases');
assert.equal(refusals, 13, 'refusal cases');

// ---- Catalog totals pinned site-wide.
assert.equal(catalog.tools.length, 2529, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2268, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 58,
  'Oil, Gas & Marine Engineering count');

// ---- Page contract.
assert.match(html, /<title>Mechanical Specific Energy Calculator/);
assert.match(html, /<meta name="description" content="Work out the mechanical specific energy/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-unit', 'in-wob', 'in-torque', 'in-rpm', 'in-rop', 'in-diameter',
  'out', 'err', 'warn', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
}
for (const label of ['in-unit', 'in-wob', 'in-torque', 'in-rpm', 'in-rop', 'in-diameter']) {
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
assert.ok(html.includes('<h1>Mechanical Specific Energy Calculator</h1>'));
assert.ok(html.includes('Everything runs in your browser'), 'storage disclosure');

console.log('mechanical specific energy: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
