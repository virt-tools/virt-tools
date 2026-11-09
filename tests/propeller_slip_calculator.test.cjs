/* Regression checks for the propeller slip calculator: every catalog case,
   an independently derived closed-form oracle, hand-checked anchors and
   refusals outside the catalog. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/propeller-slip-calculator/index.html'), 'utf8');
const start = html.indexOf('/* propeller-slip-core:start */');
const end = html.indexOf('/* propeller-slip-core:end */');
assert.ok(start > -1 && end > start, 'propeller slip core markers missing');
const core = html.slice(start, end + '/* propeller-slip-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PropSlipCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'propeller-slip-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Sports & Outdoors', 'catalog category');
assert.equal(entry.subcategory, 'Estimation & calculation', 'catalog subcategory');
assert.equal(entry.risk, 'low', 'catalog risk');
assert.equal(entry.maturity, 'draft', 'catalog maturity');
assert.equal(entry.listed, true, 'catalog listed');
assert.ok(entry.testCases.length >= 34, `expected at least 34 cases, found ${entry.testCases.length}`);

const NUMERIC = [
  'shaftRpm', 'theoreticalKn', 'theoreticalMph', 'theoreticalKmh',
  'actualKn', 'actualMph', 'actualKmh', 'lostKn', 'lostMph', 'slipPct',
];

function close(actual, expected, label) {
  const tolerance = Math.max(Math.abs(expected) * 1e-6, 1e-5);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
}

// Independent oracle: the nominal advance is taken in miles per hour first
// (inches per hour divided by 12 and 5,280) and only then converted to knots.
// The page multiplies straight into the 72,913.386 inches of a nautical mile.
const KN_TO_MPH = 1.1507794480235425;
const KN_TO_KMH = 1.852;
const UNIT_TO_KN = { kn: 1, mph: 1 / KN_TO_MPH, kmh: 1 / KN_TO_KMH };

function oracle(input) {
  const given = input || {};
  const pick = (key) => (given[key] === undefined ? C.DEFAULTS[key] : given[key]);
  const pitch = Number(String(pick('pitch')).trim());
  const rpm = Number(String(pick('rpm')).trim());
  const ratio = Number(String(pick('ratio')).trim());
  const unit = String(pick('unit')).trim().toLowerCase();
  const speed = Number(String(pick('speed')).trim());
  const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
  const shaft = rpm / ratio;
  const mph = (pitch * shaft * 60) / 12 / 5280;
  const kn = mph / KN_TO_MPH;
  const actual = speed * UNIT_TO_KN[unit];
  return {
    shaftRpm: round(shaft, 4),
    theoreticalKn: round(kn, 4),
    theoreticalMph: round(kn * KN_TO_MPH, 4),
    theoreticalKmh: round(kn * KN_TO_KMH, 4),
    actualKn: round(actual, 4),
    actualMph: round(actual * KN_TO_MPH, 4),
    actualKmh: round(actual * KN_TO_KMH, 4),
    lostKn: round(kn - actual, 4),
    lostMph: round((kn - actual) * KN_TO_MPH, 4),
    slipPct: round(((kn - actual) / kn) * 100, 4),
  };
}

let golden = 0;
let refused = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expected && typeof testCase.expected.error === 'string',
      `${testCase.name}: validation case needs an error string`);
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${testCase.name}: refusal text`);
      return true;
    }, `${testCase.name}: expected a refusal`);
    refused += 1;
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const key of NUMERIC) {
    if (testCase.expected[key] === undefined) continue;
    close(result[key], testCase.expected[key], `${testCase.name} / ${key}`);
  }
  const mirror = oracle(testCase.input);
  for (const key of NUMERIC) {
    close(mirror[key], result[key], `${testCase.name} / oracle ${key}`);
  }
  golden += 1;
}
assert.equal(golden + refused, entry.testCases.length, 'every case ran');

// Hand-checked anchors worked out from the documented formula. The core reports
// four decimals, so the anchors are rounded the same way before comparing.
const round4 = (value) => Math.round(value * 1e4) / 1e4;
const dflt = C.calculate({});
assert.equal(dflt.shaftRpm, 2400, 'default shaft speed is 4,800 / 2');
close(dflt.theoreticalKn, round4((19 * 2400 * 60) / 72913.38582677165), 'default theoretical speed');
close(dflt.theoreticalMph, 43.1818, 'default theoretical speed in mph');
close(dflt.theoreticalKmh, 69.4944, 'default theoretical speed in km/h');
close(dflt.lostKn, round4((19 * 2400 * 60) / 72913.38582677165 - 32), 'default speed lost');
close(dflt.slipPct,
  round4(((19 * 2400 * 60) / 72913.38582677165 - 32) / ((19 * 2400 * 60) / 72913.38582677165) * 100),
  'default slip');
assert.equal(C.calculate({ speed: 0 }).slipPct, 100, 'a stopped boat shows 100% slip');
assert.equal(C.calculate({ ratio: 1 }).shaftRpm, 4800, '1:1 turns the shaft at engine speed');

// The same physical speed entered in each unit must give the same slip.
const inKnots = C.calculate({ speed: 32, unit: 'kn' });
const inMph = C.calculate({ speed: 32 * KN_TO_MPH, unit: 'mph' });
const inKmh = C.calculate({ speed: 32 * KN_TO_KMH, unit: 'kmh' });
close(inMph.slipPct, inKnots.slipPct, 'mph and knots agree');
close(inKmh.slipPct, inKnots.slipPct, 'km/h and knots agree');
close(inMph.actualKn, 32, 'mph converts back to knots');
close(inKmh.actualKn, 32, 'km/h converts back to knots');

// Doubling engine speed doubles the nominal advance and keeps the slip when the
// measured speed doubles too.
const base = C.calculate({ rpm: 3000, speed: 20 });
const doubled = C.calculate({ rpm: 6000, speed: 40 });
close(doubled.theoreticalKn, 2 * base.theoreticalKn, 'double rpm doubles the theoretical speed');
close(doubled.slipPct, base.slipPct, 'doubling speed and rpm keeps the same slip');

// Negative slip is reported rather than clamped, so a following current shows up.
const assisted = C.calculate({ speed: 40 });
assert.ok(assisted.slipPct < 0, 'a speed above the nominal advance gives a negative slip');
assert.ok(assisted.lostKn < 0, 'negative slip loses a negative distance');

// Refusals that are not in the catalog keep the same wording and never throw raw errors.
const refusals = [
  [{ pitch: '4.0.1' }, 'Propeller pitch must be a number from 4 to 40 inches.'],
  [{ pitch: '-19' }, 'Propeller pitch must be a number from 4 to 40 inches.'],
  [{ ratio: 0 }, 'Gear ratio must be a number from 0.5 to 5.'],
  [{ speed: 151 }, 'Measured speed must be a number from 0 to 150 knots.'],
  [{ speed: 174, unit: 'mph' }, 'Measured speed must be a number from 0 to 173 mph.'],
  [{ unit: 'furlongs' }, 'Speed unit must be knots, mph or km/h.'],
];
for (const [input, message] of refusals) {
  assert.throws(() => C.calculate(input), (error) => {
    assert.equal(error.message, message, `refusal for ${JSON.stringify(input)}`);
    return true;
  }, `expected a refusal for ${JSON.stringify(input)}`);
}

// Trimming is tolerated on otherwise valid numbers.
close(C.calculate({ pitch: ' 19 ', rpm: ' 4800 ', ratio: ' 2 ', speed: ' 32 ' }).slipPct,
  C.calculate({}).slipPct, 'padded numbers match trimmed numbers');

console.log(`propeller-slip-calculator: ${golden} calculation cases and ${refused} catalog refusals pass, plus ${refusals.length} extra refusals and 9 anchors`);
