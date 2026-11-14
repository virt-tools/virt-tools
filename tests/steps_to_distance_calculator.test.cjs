/* Steps-to-distance regression checks: independent arithmetic grid, mode
   switching, input boundaries, catalog replay and the offline DOM contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'steps-to-distance-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* steps-distance-core:start */';
const endMarker = '/* steps-distance-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'steps-to-distance core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StepsDistanceCore;', sandbox);
const C = sandbox.module.exports;

const MILE = 1609.344;
const STEP_METRES = { cm: 0.01, in: 0.0254 };
const DISTANCE_METRES = { km: 1000, mi: MILE, m: 1 };
const closeTo = (actual, expected, label, epsilon = 1e-8) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} vs ${expected}`);
const run = (input) => C.compute({ ...C.DEFAULTS, ...(input || {}) });
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// Independent oracle written from the documented definition: distance is the
// step count times one step, the reverse divides and rounds to whole steps.
function oracle(input) {
  const value = { ...C.DEFAULTS, ...(input || {}) };
  const stepLength = Number(String(value.step).trim().replace(',', '.'));
  const stepMetres = stepLength * STEP_METRES[value.stepUnit];
  let steps;
  let metres;
  if (value.mode === 'steps') {
    steps = Number(value.steps);
    metres = steps * stepMetres;
  } else {
    const distance = Number(String(value.distance).trim().replace(',', '.'));
    metres = distance * DISTANCE_METRES[value.distanceUnit];
    steps = Math.round(metres / stepMetres);
  }
  return {
    mode: value.mode,
    steps,
    stepLength,
    stepUnit: value.stepUnit,
    stepMetres,
    metres,
    km: metres / 1000,
    miles: metres / MILE,
    stepsPerKm: 1000 / stepMetres,
    stepsPerMile: MILE / stepMetres,
  };
}
function checkExpected(result, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') closeTo(result[key], value, `${label} ${key}`);
    else assert.equal(result[key], value, `${label} ${key}`);
  }
}

assert.equal(C.DEFAULTS.mode, 'steps');
assert.equal(C.DEFAULTS.steps, '8900');
assert.equal(C.DEFAULTS.step, '76');
assert.equal(C.DEFAULTS.stepUnit, 'cm');
assert.equal(C.METRES_PER_MILE, MILE);
assert.equal(C.STEP_UNITS.cm.metres, 0.01);
assert.equal(C.STEP_UNITS.in.metres, 0.0254);
assert.equal(C.DISTANCE_UNITS.km.metres, 1000);
assert.equal(C.DISTANCE_UNITS.mi.metres, MILE);
assert.equal(C.DISTANCE_UNITS.m.metres, 1);

// Worked defaults: 8,900 steps of 76 cm is 6,764 m, and 1,000 / 0.76 gives the
// steps-per-kilometre constant both ways.
const published = run({});
checkExpected(published, {
  mode: 'steps', steps: 8900, stepMetres: 0.76, metres: 6764,
  km: 6.764, miles: 6764 / MILE, stepsPerKm: 1000 / 0.76, stepsPerMile: MILE / 0.76,
}, 'default route');

// A 30 inch step is exactly 0.762 m, so 10,000 steps is 7.62 km.
const inches = run({ steps: '10000', step: '30', stepUnit: 'in' });
closeTo(inches.metres, 7620, 'inch step metres');
closeTo(inches.km, 7.62, 'inch step km');
closeTo(inches.stepsPerMile, MILE / 0.762, 'inch step per mile');

// Reverse conversion rounds to the nearest whole step: 5 km / 0.76 m sits
// 0.05 of a step below 6,579, and 3 miles / 0.70 m sits 0.19 above 6,897.
assert.equal(run({ mode: 'distance', distance: '5', distanceUnit: 'km' }).steps, 6579);
assert.equal(run({ mode: 'distance', distance: '3', distanceUnit: 'mi', step: '70' }).steps, 6897);
assert.equal(run({ mode: 'distance', distance: '1', distanceUnit: 'm', step: '100' }).steps, 1);
assert.equal(run({ mode: 'distance', distance: '0.001', distanceUnit: 'km' }).steps, 1);
assert.equal(run({ mode: 'distance', distance: '1000', distanceUnit: 'km' }).steps, 1315789);

// Boundaries.
assert.equal(run({ steps: '1', step: '20' }).metres, 0.2);
assert.equal(run({ steps: '1000000', step: '150' }).metres, 1500000);
closeTo(run({ steps: '100', step: '59', stepUnit: 'in' }).metres, 149.86, 'inch maximum');
assert.equal(run({ mode: 'distance', distance: '1', distanceUnit: 'm', step: '20' }).steps, 5);

// Decimal commas and surrounding whitespace are accepted for every length.
closeTo(run({ steps: ' 0100 ', step: '76,5' }).metres, 76.5, 'decimal comma step');
closeTo(run({ mode: 'distance', distance: ' 5,5 ', step: '76' }).metres, 5500, 'decimal comma distance');

// Every valid combination agrees with the independent oracle and keeps the
// distance/step identities intact.
let rows = 0;
for (const stepUnit of Object.keys(STEP_METRES)) {
  for (const steps of ['1', '777', '8900', '250000']) {
    for (const step of stepUnit === 'cm' ? ['20', '65.5', '76', '149.75'] : ['8', '30', '59']) {
      const input = { steps, step, stepUnit };
      const result = run(input);
      const expected = oracle(input);
      checkExpected(result, expected, JSON.stringify(input));
      closeTo(result.steps * result.stepMetres, result.metres, 'step product');
      closeTo(result.stepsPerKm * result.stepMetres, 1000, 'per-km identity');
      closeTo(result.stepsPerMile * result.stepMetres, MILE, 'per-mile identity');
      rows += 1;
    }
  }
}
for (const distanceUnit of Object.keys(DISTANCE_METRES)) {
  for (const distance of distanceUnit === 'm' ? ['1', '12.5', '1500'] : ['0.001', '1', '5', '999.5']) {
    for (const step of ['20', '76', '150']) {
      const input = { mode: 'distance', distance, distanceUnit, step };
      const result = run(input);
      checkExpected(result, oracle(input), JSON.stringify(input));
      closeTo(result.steps * result.stepMetres, result.metres, 'rounded step product', 0.5 * result.stepMetres + 1e-9);
      rows += 1;
    }
  }
}
assert.equal(rows, 61);

// Refusals name the field and its accepted range.
assert.equal(failure({ steps: '' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ steps: '0' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ steps: '1.5' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ steps: '1000001' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ steps: '-5' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ steps: '1e3' }), 'Steps must be a whole number from 1 to 1,000,000.');
assert.equal(failure({ mode: 'both' }), 'Choose steps to distance or distance to steps.');
assert.equal(failure({ step: '' }), 'Step length must be a number from 20 to 150 cm.');
assert.equal(failure({ step: '19' }), 'Step length must be a number from 20 to 150 cm.');
assert.equal(failure({ step: '151' }), 'Step length must be a number from 20 to 150 cm.');
assert.equal(failure({ step: '76,5,1' }), 'Step length must be a number from 20 to 150 cm.');
assert.equal(failure({ stepUnit: 'mm' }), 'Choose centimetres or inches.');
assert.equal(failure({ step: '7', stepUnit: 'in' }), 'Step length must be a number from 8 to 59 inches.');
assert.equal(failure({ step: '59.5', stepUnit: 'in' }), 'Step length must be a number from 8 to 59 inches.');
assert.equal(failure({ mode: 'distance', distance: '' }), 'Distance must be a number from 0.001 to 1,000 km.');
assert.equal(failure({ mode: 'distance', distance: '0' }), 'Distance must be a number from 0.001 to 1,000 km.');
assert.equal(failure({ mode: 'distance', distance: '1001' }), 'Distance must be a number from 0.001 to 1,000 km.');
assert.equal(failure({ mode: 'distance', distance: '0.0005' }), 'Distance must be a number from 0.001 to 1,000 km.');
assert.equal(failure({ mode: 'distance', distance: '5', distanceUnit: 'yd' }), 'Choose kilometres, miles or metres.');
assert.equal(failure({ mode: 'distance', distance: '2000000', distanceUnit: 'm' }), 'Distance must be a number from 1 to 1,000,000 m.');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Steps to Distance Calculator');
assert.equal(entry.category, 'Health');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 0);
assert.ok(entry.method.includes('1609.344') && entry.method.includes('whole step'));
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2275);
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 7, boundary: 6, validation: 15 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    checkExpected(result, testCase.expected, testCase.name);
    const expected = oracle(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'number') closeTo(expected[key], value, `${testCase.name} oracle ${key}`);
    }
  }
}

// Static offline, accessibility and DOM-wiring contract.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('<form id="steps-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="alert"'), 'error alert missing');
for (const id of ['mode', 'steps', 'distance', 'distance-unit', 'step', 'step-unit']) {
  const control = id === 'distance-unit' ? 'in-distance-unit' : id === 'step-unit' ? 'in-step-unit' : `in-${id}`;
  assert.ok(html.includes(`id="${control}"`), `control ${control} missing`);
}
for (const id of ['mode', 'steps', 'distance', 'step']) {
  assert.ok(html.includes(`for="in-${id}"`), `label ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('@media (max-width:400px)'), 'mobile result rows must stack');

console.log(`Steps to distance: ${entry.testCases.length} catalog cases, ${rows} independent grid rows and boundary anchors passed`);
