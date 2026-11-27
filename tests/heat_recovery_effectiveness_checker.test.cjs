/* Regression checks for the heat recovery effectiveness core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/heat-recovery-effectiveness-checker/index.html'), 'utf8');
const start = html.indexOf('/* heat-recovery-effectiveness-core:start */');
const end = html.indexOf('/* heat-recovery-effectiveness-core:end */');
assert.ok(start > -1 && end > start, 'heat recovery core markers missing');
const core = html.slice(start, end + '/* heat-recovery-effectiveness-core:end */'.length);
assert.ok(!/document\.|window\.|fetch\(|localStorage|XMLHttpRequest/.test(core), 'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HeatRecoveryCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'heat-recovery-effectiveness-checker');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2505, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2244, 'public tools');
assert.equal(entry.category, 'Home Systems', 'category');
assert.equal(entry.risk, 'low', 'risk');
assert.ok(entry.sources.length >= 1, 'a published standard backs the arithmetic');
assert.ok(entry.testCases.length >= 20, `expected at least 20 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} vs ${expected}`);
};

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
  const want = testCase.expected;
  assert.equal(result.mode, want.mode, `${label}: direction`);
  close(result.percent, want.percent, `${label}: effectiveness`);
  close(result.percentDisplayed, want.percentDisplayed, `${label}: displayed effectiveness`);
  close(result.deltaF, want.deltaF, `${label}: outdoor to return`);
  close(result.sensitivity, want.sensitivity, `${label}: probe sensitivity`);
  if (want.recoveredLoad !== undefined) close(result.recoveredLoad, want.recoveredLoad, `${label}: recovered load`);
  if (want.ventilationLoad !== undefined) close(result.ventilationLoad, want.ventilationLoad, `${label}: ventilation load`);
  if (want.balanceGapF !== undefined) close(result.balanceGapF, want.balanceGapF, `${label}: balance gap`);
  if (want.balanced !== undefined) assert.equal(result.balanced, want.balanced, `${label}: balance verdict`);
  if (want.floor !== undefined) close(result.floor, want.floor, `${label}: rating floor`);
  if (want.meets !== undefined) assert.equal(result.meets, want.meets, `${label}: rating verdict`);
  assert.equal(result.noisy, Boolean(want.noisy), `${label}: noise flag`);
  // Invariants that any correct effectiveness must satisfy.
  assert.ok(result.percent >= 0 && result.percent <= 100, `${label}: effectiveness inside 0-100`);
}

// A perfect core passes the return temperature through as supply: 100%, whatever the spread.
for (const [outdoor, spread] of [[20, 15], [30, 40], [-5, 60], [90, 25]]) {
  const result = C.compute({ outdoor: String(outdoor), returnAir: String(outdoor + spread), supply: String(outdoor + spread) });
  close(result.percent, 100, `perfect core at ${outdoor}/${spread}`);
  close(result.sensitivity, 200 / spread, `perfect core sensitivity at ${outdoor}/${spread}`);
}
// A dead core leaves the supply at the outdoor temperature: 0%.
for (const outdoor of [-10, 32, 75]) {
  const result = C.compute({ outdoor: String(outdoor), returnAir: String(outdoor + 30), supply: String(outdoor) });
  close(result.percent, 0, `dead core at ${outdoor}`);
}

// Adding the same offset to all three readings cannot change the share: only differences matter.
const base = { outdoor: '28', returnAir: '69', supply: '59' };
const basePercent = C.compute(base).percent;
for (const offset of [-40, -7.5, 0.5, 12, 55]) {
  const shifted = {
    outdoor: String(28 + offset),
    returnAir: String(69 + offset),
    supply: String(59 + offset)
  };
  close(C.compute(shifted).percent, basePercent, `offset invariance at ${offset}`);
}
// A spread of one degree is refused; five degrees is accepted, and the flag marks ten.
assert.throws(() => C.compute({ outdoor: '40', returnAir: '40.9', supply: '40.4' }),
  /at least 5/, 'one-degree spread is refused');
assert.equal(C.compute({ outdoor: '40', returnAir: '45', supply: '42' }).noisy, true, 'five degrees is flagged as noisy');
assert.equal(C.compute({ outdoor: '40', returnAir: '50', supply: '45' }).noisy, false, 'ten degrees is not flagged');

// The published allowance of AHRI 1060 section 5.1.1: 4% of the rating plus one point, or two points.
for (const [rating, allowance] of [[75, 4], [20, 2], [40, 2.6], [100, 5], [10, 2]]) {
  const result = C.compute({ outdoor: '30', returnAir: '70', supply: '60', rating: String(rating) });
  close(result.allowance, allowance, `allowance for a ${rating}% rating`);
  close(result.floor, rating - allowance, `floor for a ${rating}% rating`);
}

// Balanced airflow: the supply gains exactly what the exhaust loses, so the balance check closes.
for (const step of [0, 0.2, 0.5, 0.8, 1]) {
  const supply = 30 + step * 40;
  const result = C.compute({ outdoor: '30', returnAir: '70', supply: String(supply), exhaust: String(70 - (supply - 30)) });
  close(result.balanceGapF, 0, `balanced core at ${step}`);
  assert.equal(result.balanced, true, `balanced verdict at ${step}`);
}

// Celsius and Fahrenheit entry describe the same measurement.
const fahrenheit = C.compute({ outdoor: '32', returnAir: '68', supply: '59' });
const celsius = C.compute({ outdoor: '0', returnAir: '20', supply: '15', unit: 'C' });
close(celsius.percent, fahrenheit.percent, 'unit equivalence');
close(celsius.deltaDisplayed, 20, 'a 36 F spread is 20 C');
close(fahrenheit.deltaDisplayed, 36, 'a 36 F spread reads 36 in Fahrenheit');

// The recovered load is the airflow times the sensible heat factor times the measured change.
for (const cfm of [1, 120, 900, 20000]) {
  const result = C.compute({ outdoor: '28', returnAir: '69', supply: '59', airflow: String(cfm) });
  close(result.recoveredLoad, 1.08 * cfm * 31, `recovered load at ${cfm} CFM`);
  close(result.ventilationLoad, 1.08 * cfm * 41, `ventilation load at ${cfm} CFM`);
  assert.ok(result.recoveredLoad < result.ventilationLoad, 'recovery always recovers less than the full load');
}

// A sweep across the working range: the reported share is the interpolated position, and every
// reading is inside the band. This is a property check, not a replay of the page's arithmetic.
let sweep = 0;
for (let outdoor = -30; outdoor <= 60; outdoor += 3) {
  for (const spread of [6, 13, 22, 35, 50, 65]) {
    for (let step = 0; step <= 10; step += 1) {
      const supply = outdoor + (step / 10) * spread;
      const result = C.compute({ outdoor: String(outdoor), returnAir: String(outdoor + spread), supply: String(supply) });
      close(result.percent, step * 10, `sweep at ${outdoor}/${spread}/${step}`);
      assert.ok(result.percent >= 0 && result.percent <= 100, 'sweep inside the band');
      sweep += 1;
    }
  }
}
assert.ok(sweep > 500, `the sweep ran: ${sweep}`);

// Refusals that the catalog cases do not cover: a blank optional field is fine, a zero spread is not.
assert.equal(C.compute({ outdoor: '28', returnAir: '69', supply: '59', exhaust: '', rating: '', airflow: '' }).balanced, null, 'blank optionals are accepted');
assert.throws(() => C.compute({ outdoor: '28', returnAir: '69', supply: '59', rating: 'abc' }), /not a number/, 'rating must be numeric');
assert.throws(() => C.compute({ outdoor: '28', returnAir: '69', supply: '59', airflow: '0.5' }), /from 1 to 20,000 CFM/, 'airflow below one is refused');
assert.equal(C.compute({ outdoor: '28', returnAir: '69', supply: '59', airflow: '120.5' }).recoveredLoad, 1.08 * 120.5 * 31, 'fractional airflow is accepted');

console.log('heat recovery effectiveness: catalog replay and invariants OK');
