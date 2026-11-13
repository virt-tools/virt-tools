/* Regression checks for the vertical jump power page: an independently written
   reference for the kinematics and the two published regressions, the catalog
   cases, round-trip and monotonicity invariants, and the page's offline
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'vertical-jump-power-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* jump-core:start */');
const end = html.indexOf('/* jump-core:end */');
assert.ok(start > -1 && end > start, 'jump core markers missing');
const core = html.slice(start, end + '/* jump-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = JumpPowerCore;', sandbox);
const C = sandbox.module.exports;

const G = 9.80665;
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} vs ${expected} (tolerance ${tolerance})`
);

/* Independent reference: the height/takeoff/time triangle written from the
   velocity side - takeoff speed from g*t/2 for time input and flight time
   from 2v/g for height input - and the two power polynomials written straight
   from the published coefficients. */
function referenceHeightFromFlight(seconds) {
  const velocity = (G * seconds) / 2;
  return (velocity * velocity) / (2 * G) * 100;
}
function referenceFlightFromHeight(cm) {
  const velocity = Math.sqrt(2 * G * (cm / 100));
  return (2 * velocity) / G;
}
function referenceSayers(cm, kg) { return 60.7 * cm + 45.3 * kg - 2055; }
function referenceHarman(cm, kg) { return 61.9 * cm + 36.0 * kg - 1822; }
const LB = 0.45359237;

assert.equal(C.G, 9.80665);
assert.equal(C.CM_PER_IN, 2.54);
assert.equal(C.KG_PER_LB, LB);
assert.equal(C.FLIGHT_MIN, 0.1);
assert.equal(C.FLIGHT_MAX, 1.2);
assert.deepEqual(Array.from(Object.keys(C.MASS_LIMITS.metric)), ['min', 'max', 'unit']);
assert.equal(C.MASS_LIMITS.metric.min, 20);
assert.equal(C.MASS_LIMITS.metric.max, 300);
assert.equal(C.MASS_LIMITS.imperial.min, 44);
assert.equal(C.MASS_LIMITS.imperial.max, 661);
assert.equal(C.HEIGHT_LIMITS.metric.min, 5);
assert.equal(C.HEIGHT_LIMITS.metric.max, 150);
assert.equal(C.HEIGHT_LIMITS.imperial.min, 2);
assert.equal(C.HEIGHT_LIMITS.imperial.max, 59);
assert.equal(C.sourceKey('flight'), 'flight');
assert.equal(C.sourceKey('bogus'), 'height');
assert.equal(C.unitKey('imperial'), 'imperial');
assert.equal(C.unitKey('stone'), 'metric');

// Headline: 45 cm at 75 kg.
const base = C.analyze({ source: 'height', units: 'metric', value: '45', mass: '75' });
close(base.heightCm, 45, 1e-9, 'default height');
close(base.heightIn, 45 / 2.54, 1e-6, 'default height in inches');
close(base.flightSeconds, referenceFlightFromHeight(45), 1e-6, 'default flight time');
close(base.takeoffVelocity, Math.sqrt(2 * G * 0.45), 1e-6, 'default takeoff velocity');
close(base.sayersW, referenceSayers(45, 75), 1e-3, 'default Sayers power');
close(base.harmanW, referenceHarman(45, 75), 1e-3, 'default Harman power');
close(base.relativeWkg, referenceSayers(45, 75) / 75, 1e-6, 'default relative power');
assert.equal(base.derived, false);
close(base.gapPct, 100 * (base.highW - base.lowW) / ((base.highW + base.lowW) / 2), 1e-2, 'gap percent');

// Flight-time input derives the height and lands on the same jump.
const fromTime = C.analyze({ source: 'flight', units: 'metric', value: '0.6', mass: '75' });
assert.equal(fromTime.derived, true);
close(fromTime.heightCm, referenceHeightFromFlight(0.6), 1e-6, 'height from flight time');
close(fromTime.takeoffVelocity, (G * 0.6) / 2, 1e-6, 'velocity from flight time');
close(fromTime.flightSeconds, 0.6, 1e-6, 'flight time echoed');
close(fromTime.sayersW, referenceSayers(fromTime.heightCm, 75), 1e-3, 'Sayers from derived height');

// A height and the flight time it implies describe the same jump in both modes.
for (const cm of [5, 20, 45, 72.5, 150]) {
  const asHeight = C.analyze({ source: 'height', units: 'metric', value: String(cm), mass: '80' });
  const asFlight = C.analyze({ source: 'flight', units: 'metric', value: String(asHeight.flightSeconds), mass: '80' });
  close(asFlight.heightCm, cm, 1e-2, `round trip at ${cm} cm`);
  close(asFlight.sayersW, asHeight.sayersW, 1e-2, `power survives the round trip at ${cm} cm`);
}

// Imperial input is the same physical jump as its metric equivalent.
const metric = C.analyze({ source: 'height', units: 'metric', value: '60.96', mass: '74.84274105' });
const imperial = C.analyze({ source: 'height', units: 'imperial', value: '24', mass: '165' });
close(imperial.heightCm, metric.heightCm, 1e-9, 'inch height agrees');
close(imperial.massKg, metric.massKg, 1e-6, 'pound mass agrees');
close(imperial.sayersW, metric.sayersW, 1e-2, 'power agrees across unit systems');
close(imperial.relativeWkg, metric.relativeWkg, 1e-4, 'relative power agrees across unit systems');
close(imperial.heightIn, 24, 1e-9, 'inches echoed');

// The powers are affine in height and mass: a one-centimetre rise adds 60.7 W
// (Sayers) and 61.9 W (Harman) at fixed mass, and one kilogram adds 45.3 W and 36 W.
for (const kg of [40, 90, 120]) {
  const a = C.analyze({ source: 'height', units: 'metric', value: '30', mass: String(kg) });
  const b = C.analyze({ source: 'height', units: 'metric', value: '31', mass: String(kg) });
  close(b.sayersW - a.sayersW, 60.7, 2e-3, 'Sayers height slope');
  close(b.harmanW - a.harmanW, 61.9, 2e-3, 'Harman height slope');
  const c = C.analyze({ source: 'height', units: 'metric', value: '30', mass: String(kg + 1) });
  close(c.sayersW - a.sayersW, 45.3, 2e-3, 'Sayers mass slope');
  close(c.harmanW - a.harmanW, 36.0, 2e-3, 'Harman mass slope');
  assert.ok(a.lowW <= a.sayersW && a.sayersW <= a.highW, 'Sayers inside the reported range');
  assert.ok(a.lowW <= a.harmanW && a.harmanW <= a.highW, 'Harman inside the reported range');
}

// Sweep: every in-range pair either returns a consistent jump or is refused.
let swept = 0;
let refused = 0;
for (let cm = 5; cm <= 150; cm += 5) {
  for (let kg = 20; kg <= 300; kg += 20) {
    let result;
    try {
      result = C.analyze({ source: 'height', units: 'metric', value: String(cm), mass: String(kg) });
    } catch (error) {
      refused += 1;
      assert.equal(error.message, C.NO_POWER, 'only the power floor refuses a valid range');
      assert.ok(referenceSayers(cm, kg) <= 0 || referenceHarman(cm, kg) <= 0,
        `refusal must follow a non-positive regression at ${cm} cm and ${kg} kg`);
      continue;
    }
    swept += 1;
    close(result.heightCm, cm, 1e-6, 'sweep height');
    close(result.heightIn, cm / 2.54, 1e-6, 'sweep inches');
    close(result.flightSeconds, referenceFlightFromHeight(cm), 1e-6, 'sweep flight time');
    close(result.takeoffVelocity, Math.sqrt(2 * G * cm / 100), 1e-6, 'sweep velocity');
    close(result.sayersW, referenceSayers(cm, kg), 1e-3, 'sweep Sayers');
    close(result.harmanW, referenceHarman(cm, kg), 1e-3, 'sweep Harman');
    close(result.relativeWkg * kg, result.sayersW, 1e-3, 'sweep relative power');
    assert.ok(result.sayersW > 0 && result.harmanW > 0, 'positive powers');
  }
}
assert.ok(swept > 400, 'the sweep covered the range');
assert.ok(refused > 0, 'the light-and-shallow corner is refused');

// Flight-time sweep: height and takeoff velocity follow the kinematics.
for (let ms = 100; ms <= 1200; ms += 25) {
  const seconds = ms / 1000;
  const result = C.analyze({ source: 'flight', units: 'metric', value: String(seconds), mass: '75' });
  close(result.heightCm, referenceHeightFromFlight(seconds), 1e-6, 'flight sweep height');
  close(result.takeoffVelocity, (G * seconds) / 2, 1e-6, 'flight sweep velocity');
  close(result.flightSeconds, seconds, 1e-6, 'flight sweep time');
  close(result.harmanW, referenceHarman(result.heightCm, 75), 1e-3, 'flight sweep Harman');
}

// Formatting helpers.
assert.equal(C.fmtPower(4074), '4074 W');
assert.equal(C.fmtFlight(base), '0.606 s');
assert.equal(C.fmtSpeed(base), '2.97 m/s');
assert.equal(C.fmtRelative(base), '54.32 W/kg');
assert.equal(C.fmtHeight(base), '45.0 cm \u00b7 17.7 in');
assert.ok(C.copyText(base).includes('Sayers 1999') && C.copyText(base).includes('Harman 1991'));

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug appears exactly once');
const record = matches[0];
assert.equal(catalog.tools.length, 2241, 'catalog total');
assert.equal(record.name, 'Vertical Jump Power Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.added, '2026-11-13T02:40:00Z');
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 4, 'sources are listed');
for (const alias of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === alias || (tool.aliases || []).includes(alias));
  assert.equal(clash, false, 'alias is unique: ' + alias);
}
for (const tag of record.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}

let goldens = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.analyze(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  goldens += 1;
  const result = C.analyze(testCase.input);
  const expected = testCase.expected;
  for (const key of ['heightCm', 'heightIn', 'flightSeconds', 'takeoffVelocity', 'massKg', 'relativeWkg']) {
    close(result[key], expected[key], 1e-5, testCase.name + ' ' + key);
  }
  close(result.sayersW, expected.sayersW, 5e-3, testCase.name + ' sayersW');
  close(result.harmanW, expected.harmanW, 5e-3, testCase.name + ' harmanW');
  assert.equal(result.derived, expected.derived, testCase.name + ' derived flag');
  // Each golden is also checked against the independent reference.
  close(result.sayersW, referenceSayers(result.heightCm, result.massKg), 1e-2, testCase.name + ' Sayers reference');
  close(result.harmanW, referenceHarman(result.heightCm, result.massKg), 1e-2, testCase.name + ' Harman reference');
}
assert.equal(goldens, 8, 'golden case count');

// Page contract: shared chrome, one form, default state, unit switching, no
// storage, no network, no HTML sinks, 44 px targets, and every element the
// script looks up exists in the markup.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="jump-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
for (const id of ['source', 'value', 'units', 'mass', 'err', 'out', 'reset', 'value-label', 'value-hint', 'mass-hint', 'source-hint']) {
  assert.ok(html.includes('id="' + id + '"'), 'element present: ' + id);
}
assert.match(html, /id="value"[^>]*value="45"/);
assert.match(html, /id="mass"[^>]*value="75"/);
assert.match(html, /<option value="height" selected>/);
assert.match(html, /<option value="metric" selected>/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.tools button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{min-height:44px\}/);
assert.match(html, /<button type="submit">/);
const lookups = Array.from(html.matchAll(/getElementById\("([a-z-]+)"\)/g)).map((m) => m[1]);
assert.ok(lookups.length >= 10, 'script looks up its controls');
for (const id of new Set(lookups)) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'getElementById target exists: ' + id);
}
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, ' + goldens
  + ' golden, kinematic round trips and the power slopes)');
