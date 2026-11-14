/* Regression checks for the sweat-rate core, its catalog cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sweat-rate-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* sweat-core:start */');
const end = html.indexOf('/* sweat-core:end */');
assert.ok(start > -1 && end > start, 'sweat core markers missing');
const core = html.slice(start, end + '/* sweat-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SweatRateCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { system: 'metric', pre: '70', post: '69', fluid: '0.5', urine: '0', minutes: '60' };
const run = (overrides) => C.compute(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

assert.equal(C.LB_G, 453.59237, 'exact pound-to-gram factor');
assert.equal(C.FLOZ_ML, 29.5735295625, 'exact US fluid-ounce factor');
assert.equal(C.LIMITS.metric.weightMin, 20);
assert.equal(C.LIMITS.metric.weightMax, 400);
assert.equal(C.LIMITS.imperial.weightMax, 880);
assert.equal(C.DEFAULTS.metric.pre, '70');
assert.equal(C.DEFAULTS.imperial.fluid, '16.9');

// The headline case: one kilogram lost on top of half a litre drunk is 1.5 L.
const base = run();
close(base.sweatMl, 1500, 1e-9, 'default sweat volume');
close(base.rateLph, 1.5, 1e-9, 'default hourly rate');
close(base.netPct, 100 / 70, 1e-9, 'default net change');
close(base.totalL, 1.5, 1e-9, 'default total litres');
close(base.totalFlOz, 1500 / C.FLOZ_ML, 1e-9, 'default total fluid ounces');
close(base.massLossKg, 1, 1e-9, 'default mass loss');
assert.equal(base.weightUnit, 'kg');
assert.equal(base.fluidUnit, 'L');

// The same session in imperial units must produce the same physical rate.
const imperial = run({ system: 'imperial', pre: '154.32', post: '152.12', fluid: '16.9', minutes: '60' });
close(imperial.rateLph, base.rateLph, 0.01, 'unit systems agree on the rate');
close(imperial.totalFlOz, 1500 / C.FLOZ_ML, 0.1, 'unit systems agree on the volume');
assert.equal(imperial.weightUnit, 'lb');
assert.equal(imperial.fluidUnit, 'fl oz');

// Drinking more than was lost still leaves a positive sweat volume.
const gain = run({ pre: '60', post: '60.3', fluid: '0.8', minutes: '45' });
close(gain.sweatMl, 500, 1e-9, 'gain case volume');
close(gain.rateLph, 500 * 0.06 / 45, 1e-9, 'gain case rate');
assert.ok(gain.netPct < 0, 'finishing heavier reports a negative change');

// Urine comes off the total.
const urine = run({ pre: '90', post: '89.2', fluid: '1.0', urine: '0.3' });
close(urine.sweatMl, 1500, 1e-9, 'urine subtracted');
close(urine.urineDisplay, 0.3, 1e-9, 'urine display in litres');

// A shorter session at a higher rate.
const hard = run({ pre: '75', post: '73.6', fluid: '0.3', minutes: '30' });
close(hard.sweatMl, 1700, 1e-9, 'short session volume');
close(hard.rateLph, 3.4, 1e-9, 'short session rate');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2261, 'catalog total');
assert.equal(record.name, 'Sweat Rate Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.added, '2026-11-12T14:50:00Z');
assert.ok(record.testCases.length >= 29, 'catalog has the full test case set');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 4, 'sources are listed');
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
for (const tag of record.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}

let golden = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.compute(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  for (const key of ['sweatMl', 'rateLph', 'netPct', 'totalFlOz', 'massLossKg']) {
    close(result[key], expected[key], 5e-4, testCase.name + ' ' + key);
  }
  // Structural invariants: the rate is the volume over the duration, and the
  // three volume views agree with each other.
  const minutes = Number(testCase.input.minutes);
  close(result.rateLph, result.sweatMl * 0.06 / minutes, 1e-9, testCase.name + ' rate identity');
  close(result.totalL * 1000, result.sweatMl, 1e-9, testCase.name + ' litre view');
  close(result.totalFlOz * C.FLOZ_ML, result.sweatMl, 1e-6, testCase.name + ' fluid-ounce view');
  close(result.rateFlOzph, result.totalFlOz * 60 / minutes, 1e-9, testCase.name + ' ounce rate identity');
  close(result.massLossKg * 1000, result.sweatMl - result.fluidMl + result.urineMl, 1e-6,
    testCase.name + ' mass balance');
  assert.ok(result.sweatMl > 0, testCase.name + ' positive sweat volume');
  assert.equal(result.minutes, minutes, testCase.name + ' duration');
}
assert.equal(golden, 14, 'golden case count');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ pre: '' }, 'Pre-exercise weight is required.');
refuse({ post: '  ' }, 'Post-exercise weight is required.');
refuse({ fluid: '' }, 'Fluid drunk is required.');
refuse({ urine: '' }, 'Urine passed is required.');
refuse({ minutes: '' }, 'Session length is required.');
refuse({ pre: '7e1' }, 'Pre-exercise weight must be a number with at most two decimal places.');
refuse({ fluid: '0.125' }, 'Fluid drunk must be a number with at most two decimal places.');
refuse({ urine: '-0.1' }, 'Urine passed must be a number with at most two decimal places.');
refuse({ system: 'stone' }, 'Choose metric or imperial units.');
refuse({ pre: '19' }, 'Pre-exercise weight must be from 20 to 400 kg.');
refuse({ post: '401' }, 'Post-exercise weight must be from 20 to 400 kg.');
refuse({ system: 'imperial', pre: '40', post: '39' }, 'Pre-exercise weight must be from 44 to 880 lb.');
refuse({ fluid: '10.1' }, 'Fluid drunk must be from 0 to 10 L.');
refuse({ urine: '5.5' }, 'Urine passed must be from 0 to 5 L.');
refuse({ minutes: '0' }, 'Session length must be a whole number of minutes from 1 to 1440.');
refuse({ minutes: '60.5' }, 'Session length must be a whole number of minutes from 1 to 1440.');
refuse({ pre: '70', post: '70.2', fluid: '0.1' },
  'Fluid intake, urine and the weigh-in imply no sweat loss; check the numbers.');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="sweat-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['in-system', 'in-pre', 'in-post', 'in-fluid', 'in-urine', 'in-minutes']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.match(html, /<option value="metric" selected>/);
assert.match(html, /id="in-pre"[^>]*value="70"/);
assert.match(html, /id="in-post"[^>]*value="69"/);
assert.match(html, /id="in-fluid"[^>]*value="0\.5"/);
assert.match(html, /id="in-urine"[^>]*value="0"/);
assert.match(html, /id="in-minutes"[^>]*value="60"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{[^}]*min-height:44px/);
assert.match(html, /<button type="submit">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, rate and mass-balance invariants)');
