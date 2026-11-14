/* Regression checks for the TDR fault distance core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tdr-fault-distance-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* tdr-fault-distance-core:start */');
const end = html.indexOf('/* tdr-fault-distance-core:end */');
assert.ok(start > -1 && end > start, 'TDR core markers missing');
const core = html.slice(start, end + '/* tdr-fault-distance-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TdrFaultDistanceCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.calculate(input);
function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent arithmetic: half the round trip, scaled by the velocity factor
// times the speed of light, rounded the way the method text describes.
const SPEED_OF_LIGHT = 299792458;
const FT = 0.3048;
function oracle(input) {
  const vf = Number(String(input.velocityFactor).replace(',', '.'));
  const t = Number(String(input.delayNs).replace(',', '.'));
  const lengthText = input.lengthM === undefined ? '100' : String(input.lengthM).trim();
  const length = lengthText ? Number(lengthText.replace(',', '.')) : null;
  const r = (value, places) => {
    const factor = 10 ** places;
    return Math.round(value * factor) / factor;
  };
  const speed = vf * SPEED_OF_LIGHT;
  const distance = (speed * t * 1e-9) / 2;
  const result = {
    velocityFactor: vf,
    delayNs: t,
    lengthM: length,
    oneWayDelayNs: r(t / 2, 3),
    signalSpeedMPerS: r(speed, 0),
    dielectricConstant: r(1 / (vf * vf), 3),
    distanceM: r(distance, 3),
    distanceFt: r(distance / FT, 3),
    positionPercent: null,
    fullRoundTripNs: null,
    beyondLength: false,
  };
  if (length !== null) {
    result.positionPercent = r((distance / length) * 100, 1);
    result.fullRoundTripNs = r(((length / speed) * 2) * 1e9, 3);
    result.beyondLength = distance > length;
  }
  return result;
}

// Documented surface and constants.
assert.equal(C.DEFAULTS.velocityFactor, 0.66);
assert.equal(C.DEFAULTS.delayNs, 500);
assert.equal(C.DEFAULTS.lengthM, 100);
assert.equal(C.C, 299792458);
assert.equal(C.MIN_VF, 0.1);
assert.equal(C.MAX_VF, 0.99);
assert.equal(C.MAX_DELAY_NS, 1000000);
assert.equal(C.MAX_LENGTH_M, 100000);
assert.equal(C.FT_PER_M, 0.3048);

const base = { velocityFactor: '0.66', delayNs: '500', lengthM: '100' };

// Golden: default solid polyethylene, 500 ns echo on a 100 m run.
const layout = run(base);
assert.equal(layout.distanceM, 49.466);
assert.equal(layout.distanceFt, 162.289);
assert.equal(layout.oneWayDelayNs, 250);
assert.equal(layout.signalSpeedMPerS, 197863022);
assert.equal(layout.dielectricConstant, 2.296);
assert.equal(layout.positionPercent, 49.5);
assert.equal(layout.fullRoundTripNs, 1010.8);
assert.equal(layout.beyondLength, false);
assert.equal(layout.lengthM, 100);
assert.ok(Math.abs(layout.distanceM - 0.66 * 299792458 * 500e-9 / 2) < 0.001);

// The one-way delay is exactly half of the round trip.
assert.equal(run({ ...base, delayNs: '250' }).oneWayDelayNs, 125);

// A missing cable length drops the position rows instead of guessing.
const noLength = run({ velocityFactor: '0.66', delayNs: '100', lengthM: '' });
assert.equal(noLength.lengthM, null);
assert.equal(noLength.positionPercent, null);
assert.equal(noLength.fullRoundTripNs, null);
assert.equal(noLength.distanceM, 9.893);
assert.equal(noLength.distanceFt, 32.458);

// A field left out of the input object falls back to the default.
assert.equal(run({ velocityFactor: '0.66', delayNs: '500' }).lengthM, 100);

// Decimal commas parse in every field.
const commas = run({ velocityFactor: '0,66', delayNs: '250,5', lengthM: '50,5' });
assert.equal(commas.velocityFactor, 0.66);
assert.equal(commas.delayNs, 250.5);
assert.equal(commas.lengthM, 50.5);
assert.equal(commas.distanceM, 24.782);

// A reflection beyond the entered length is flagged, not refused.
const beyond = run({ velocityFactor: '0.66', delayNs: '500', lengthM: '20' });
assert.equal(beyond.beyondLength, true);
assert.equal(beyond.positionPercent, 247.3);
assert.equal(run({ ...base, lengthM: '49.5' }).beyondLength, false, 'a fault just inside the run is fine');

// Boundaries are accepted, and just outside them is refused.
assert.equal(run({ velocityFactor: '0.1', delayNs: '100', lengthM: '10' }).signalSpeedMPerS, 29979246);
assert.equal(run({ velocityFactor: '0.99', delayNs: '100', lengthM: '100' }).velocityFactor, 0.99);
assert.equal(failure({ ...base, velocityFactor: '0.099' }),
  'Velocity factor must be a number from 0.1 to 0.99.');
assert.equal(failure({ ...base, velocityFactor: '1' }),
  'Velocity factor must be a number from 0.1 to 0.99.');
assert.equal(run({ ...base, delayNs: '1000000' }).distanceM, 98931.511);
assert.equal(failure({ ...base, delayNs: '1000000.1' }),
  'Round-trip delay must be a number of nanoseconds greater than 0 and at most 1000000.');
assert.equal(run({ ...base, lengthM: '100000' }).lengthM, 100000);
assert.equal(failure({ ...base, lengthM: '100000.1' }),
  'Cable length must be a number of metres greater than 0 and at most 100000, or left blank.');

// Invariants across a grid of velocity factors, delays and lengths.
const factors = ['0.1', '0.42', '0.66', '0.8', '0.99'];
const delays = ['0.01', '1', '250.5', '1000', '250000', '1000000'];
const lengths = ['', '10', '50.5', '100', '100000'];
let checked = 0;
for (const velocityFactor of factors) {
  for (const delayNs of delays) {
    for (const lengthM of lengths) {
      const input = { velocityFactor, delayNs, lengthM };
      const result = run(input);
      const expected = oracle(input);
      for (const key of ['velocityFactor', 'delayNs', 'lengthM', 'oneWayDelayNs',
        'signalSpeedMPerS', 'dielectricConstant', 'distanceM', 'distanceFt',
        'positionPercent', 'fullRoundTripNs']) {
        if (expected[key] === null) {
          assert.equal(result[key], null, key + ' ' + JSON.stringify(input));
        } else {
          assert.ok(Math.abs(result[key] - expected[key]) < 1e-9, key + ' ' + JSON.stringify(input));
        }
      }
      assert.equal(result.beyondLength, expected.beyondLength, 'beyondLength ' + JSON.stringify(input));
      assert.ok(result.distanceM >= 0, 'distance is not negative ' + JSON.stringify(input));
      assert.ok(Math.abs(result.oneWayDelayNs * 2 - result.delayNs) < 0.002, 'delay halves exactly');
      assert.ok(Math.abs(result.distanceM - (result.signalSpeedMPerS * result.delayNs * 1e-9) / 2) < 0.05,
        'distance follows the signal speed ' + JSON.stringify(input));
      checked += 1;
    }
  }
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2263, 'catalog total');
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
let beyondCases = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (value === null) {
        assert.equal(result[key], null, testCase.name + ' ' + key);
      } else if (typeof value === 'number') {
        assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
      } else {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      }
    }
    if (result.beyondLength) beyondCases += 1;
  }
}
assert.ok(beyondCases >= 1, 'expected a beyond-the-run case');

// Refusals name the field and the rule.
assert.equal(failure({ ...base, velocityFactor: '' }), 'Enter the cable velocity factor.');
assert.equal(failure({ ...base, velocityFactor: 'fast' }), 'Velocity factor must be a number from 0.1 to 0.99.');
assert.equal(failure({ ...base, velocityFactor: '1e-1' }), 'Velocity factor must be a number from 0.1 to 0.99.');
assert.equal(failure({ ...base, delayNs: '' }), 'Enter the round-trip delay.');
assert.equal(failure({ ...base, delayNs: '0' }), 'Round-trip delay must be a number of nanoseconds greater than 0 and at most 1000000.');
assert.equal(failure({ ...base, delayNs: '-5' }), 'Round-trip delay must be a number of nanoseconds greater than 0 and at most 1000000.');
assert.equal(failure({ ...base, lengthM: '0' }), 'Cable length must be a number of metres greater than 0 and at most 100000, or left blank.');
assert.equal(failure({ ...base, lengthM: '-1' }), 'Cable length must be a number of metres greater than 0 and at most 100000, or left blank.');
assert.equal(failure({ ...base, lengthM: '1e3' }), 'Cable length must be a number of metres greater than 0 and at most 100000, or left blank.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="tdr-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['in-vf', 'in-delay', 'in-length']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('tdr fault distance calculator: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
