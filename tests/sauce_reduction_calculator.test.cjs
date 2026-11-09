/* Regression checks for the sauce reduction calculator: independently computed
   catalog cases, published arithmetic anchors, a cross-unit grid and the page's
   accessible, offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sauce-reduction-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* sauce-reduction-core:start */';
const endMarker = '/* sauce-reduction-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'sauce reduction core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SauceReductionCore;', sandbox);
const C = sandbox.module.exports;

const CUP_ML = 236.5882365;
const UNIT_ML = { ml: 1, litres: 1000, cups: CUP_ML };
const defaults = { start: '1000', current: '750', unit: 'ml', target: '50', elapsed: '20' };
const closeTo = (actual, expected, label, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} vs ${expected}`);
const calculate = (input) => C.calculate(input);
const failure = (input) => {
  try { calculate(input); } catch (error) { return error.message; }
  return null;
};
function roundHalfUp(value, places) {
  const factor = 10 ** places;
  const scaled = value * factor;
  const tolerance = 1e-9;
  return Math.floor(scaled + 0.5 + tolerance) / factor;
}

// Independent transcription of the published measured-rate model. It does not
// call the page core or reuse its returned intermediate values.
function oracle(input) {
  const value = { ...defaults, ...(input || {}) };
  const startMl = Number(value.start) * UNIT_ML[value.unit];
  const currentMl = Number(value.current) * UNIT_ML[value.unit];
  const targetMl = startMl * (1 - Number(value.target) / 100);
  const elapsed = Number(value.elapsed);
  const loss = startMl - currentMl;
  const rate = loss / elapsed;
  const reached = currentMl <= targetMl;
  const remaining = Math.max(0, currentMl - targetMl);
  const minutes = remaining / rate;
  const warnings = [];
  if (reached) {
    warnings.push('The current measurement is already at or beyond the target volume; no more reduction time is needed.');
  } else {
    if (elapsed < 5) warnings.push('A short trial can misstate the rate; repeat the measurement over a longer steady simmer for a better estimate.');
    if (minutes <= 5) warnings.push('The target is close: check the actual volume now rather than waiting for the estimate.');
    if (Number(value.target) >= 75) warnings.push('A large reduction concentrates seasoning as well as flavour; taste before adding more salt.');
  }
  return {
    startMl: roundHalfUp(startMl, 1),
    currentMl: roundHalfUp(currentMl, 1),
    targetMl: roundHalfUp(targetMl, 1),
    lossSoFarMl: roundHalfUp(loss, 1),
    remainingMl: roundHalfUp(remaining, 1),
    evaporationRateMlMin: roundHalfUp(rate, 2),
    actualReductionPct: roundHalfUp(loss / startMl * 100, 1),
    remainingMinutes: roundHalfUp(minutes, 1),
    totalMinutes: roundHalfUp(elapsed + minutes, 1),
    concentrationMultiplier: roundHalfUp(startMl / targetMl, 2),
    targetReached: reached,
    warnings,
  };
}
function checkExpected(result, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') closeTo(result[key], value, `${label} ${key}`, 1e-8);
    else if (Array.isArray(value)) assert.deepEqual(Array.from(result[key]), value, `${label} ${key}`);
    else assert.equal(result[key], value, `${label} ${key}`);
  }
}

const base = calculate({});
assert.equal(base.targetReached, false);
assert.equal(base.startMl, 1000);
assert.equal(base.currentMl, 750);
assert.equal(base.targetMl, 500);
assert.equal(base.lossSoFarMl, 250);
assert.equal(base.remainingMl, 250);
assert.equal(base.evaporationRateMlMin, 12.5);
assert.equal(base.actualReductionPct, 25);
assert.equal(base.remainingMinutes, 20);
assert.equal(base.totalMinutes, 40);
assert.equal(base.concentrationMultiplier, 2);
assert.equal(base.warnings.length, 0);

// Published Dash Calculator stock example: 2400 -> 1800 mL at 12 mL/min is
// 50 minutes total and 1.3333x. A 120 mL ten-minute trial leaves 40 minutes.
const published = calculate({ start: '2400', current: '2280', unit: 'ml', target: '25', elapsed: '10' });
assert.equal(published.evaporationRateMlMin, 12);
assert.equal(published.targetMl, 1800);
assert.equal(published.remainingMl, 480);
assert.equal(published.remainingMinutes, 40);
assert.equal(published.totalMinutes, 50);
assert.equal(published.concentrationMultiplier, 1.33);

// CalculatorSoup's published percentage-decrease example: 60 to 8 is 86.67%.
const decrease = calculate({ start: '60', current: '8', unit: 'ml', target: '50', elapsed: '52' });
assert.equal(decrease.actualReductionPct, 86.7);
assert.equal(decrease.targetReached, true);
assert.equal(decrease.remainingMinutes, 0);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Sauce Reduction Calculator');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '🍲');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1200, 'method must document arithmetic, ranges and limits');
assert.equal(entry.sources.length, 2);
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 8, boundary: 8, validation: 18 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    checkExpected(calculate(testCase.input), testCase.expected, testCase.name);
    checkExpected(testCase.expected, oracle(testCase.input), testCase.name + ' independent oracle');
  }
}

// Cross-unit deterministic grid, including both sides of the target boundary.
let rows = 0;
const volumePairs = {
  ml: [['30', '29'], ['30', '20'], ['1000', '750'], ['2400', '2280'], ['10000', '9000']],
  litres: [['0.03', '0.029'], ['2', '1.8'], ['10', '9']],
  cups: [['0.125', '0.124'], ['4', '3'], ['42', '41']],
};
for (const [unit, pairs] of Object.entries(volumePairs)) {
  for (const [startVolume, currentVolume] of pairs) {
    for (const target of ['1', '25', '50', '75', '95']) {
      for (const elapsed of ['1', '10', '100', '1440']) {
        const input = { start: startVolume, current: currentVolume, unit, target, elapsed };
        const result = calculate(input);
        const expected = oracle(input);
        checkExpected(result, expected, JSON.stringify(input));
        assert.ok(result.targetMl > 0 && result.targetMl < result.startMl, 'positive smaller target');
        assert.ok(result.currentMl < result.startMl, 'trial must lose volume');
        assert.ok(result.totalMinutes >= result.elapsed, 'total cannot precede trial');
        assert.equal(result.remainingMinutes === 0, result.targetReached, 'zero time only at target');
        if (!result.targetReached) assert.ok(result.remainingMl > 0, 'unfinished reduction has volume left');
        rows += 1;
      }
    }
  }
}
const expectedRows = Object.values(volumePairs).reduce((sum, pairs) => sum + pairs.length, 0) * 5 * 4;
assert.equal(rows, expectedRows);

// Algebraic identities on examples whose displayed precision retains them.
for (const input of [
  {},
  { start: '2400', current: '2280', unit: 'ml', target: '25', elapsed: '10' },
  { start: '4', current: '3', unit: 'cups', target: '50', elapsed: '20' },
  { start: '2', current: '1.8', unit: 'litres', target: '25', elapsed: '10' },
]) {
  const result = calculate(input);
  closeTo(result.startMl - result.currentMl, result.lossSoFarMl, 'loss identity', 0.11);
  if (!result.targetReached) closeTo(result.currentMl - result.targetMl, result.remainingMl, 'remaining identity', 0.11);
  closeTo(result.elapsed + result.remainingMinutes, result.totalMinutes, 'time identity', 0.11);
  closeTo(result.concentrationMultiplier, result.startMl / result.targetMl, 'concentration identity', 0.011);
}

// Inclusive numeric bounds, surrounding whitespace and leading zeroes.
assert.equal(failure({ start: ' 001000 ', current: ' 0750 ', target: ' 50 ', elapsed: ' 20 ' }), null);
assert.equal(calculate({ start: '30', current: '20', target: '1', elapsed: '1' }).startMl, 30);
assert.equal(calculate({ start: '10000', current: '9000', target: '95', elapsed: '1440' }).startMl, 10000);
assert.equal(calculate({ start: '0.03', current: '0.02', unit: 'litres', target: '1', elapsed: '1' }).startMl, 30);
assert.equal(calculate({ start: '10', current: '9', unit: 'litres', target: '95', elapsed: '1440' }).startMl, 10000);
assert.equal(calculate({ start: '0.125', current: '0.124', unit: 'cups', target: '1', elapsed: '1' }).unit, 'cups');
assert.equal(calculate({ start: '42', current: '41', unit: 'cups', target: '95', elapsed: '1440' }).unit, 'cups');

// Additional malformed-input paths not repeated in the catalog vectors.
assert.equal(failure({ start: '.5' }), 'Starting volume must be a number from 30 to 10000.');
assert.equal(failure({ start: '1000.' }), 'Starting volume must be a number from 30 to 10000.');
assert.equal(failure({ start: '-1000' }), 'Starting volume must be a number from 30 to 10000.');
assert.equal(failure({ current: '750.0001' }), 'Current volume must be a number from 0 to 10000.');
assert.equal(failure({ elapsed: '1e2' }), 'Elapsed simmer time must be a number from 1 to 1440.');
assert.equal(failure({ unit: 'ML' }), 'Choose millilitres, litres or US cups.');

// The page stays self-contained, labelled, keyboard-operable and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('<form id="reduction-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('type="button" class="secondary" id="reset"'), 'reset button missing');
for (const id of ['start', 'current', 'unit', 'target', 'elapsed']) {
  assert.ok(html.includes(`id="in-${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="in-${id}"`), `label ${id} missing`);
  assert.ok(html.includes(`aria-describedby="${id}-help"`), `help reference ${id} missing`);
  assert.ok(html.includes(`id="${id}-help"`), `help text ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('min-height:44px'), 'controls need 44 px tap targets');
assert.ok(html.includes('@media (max-width:400px)'), 'mobile result rows must stack');

console.log(`Sauce reduction: ${entry.testCases.length} catalog cases, ${rows} independent grid rows and published anchors passed`);
