/* Regression checks for the SLA uptime budget core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sla-uptime-budget-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* sla-uptime-budget-core:start */');
const end = html.indexOf('/* sla-uptime-budget-core:end */');
assert.ok(start > -1 && end > start, 'SLA core markers missing');
const core = html.slice(start, end + '/* sla-uptime-budget-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SlaUptimeBudgetCore;', sandbox);
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

// Independent arithmetic, written from the method text: the budget is the part
// of the period the target does not claim, the achieved availability is what is
// left after the downtime, and the nines count is the integer logarithm of the
// shortfall.
const HOURS = { day: 24, week: 168, month: 730, quarter: 2190, year: 8760 };
function r(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
function oracle(input) {
  const hours = HOURS[input.period === undefined ? 'month' : input.period];
  const targetText = input.targetPercent === undefined ? '99.9' : String(input.targetPercent);
  const target = Number(targetText.replace(',', '.'));
  const periodSeconds = hours * 3600;
  const allowed = r(periodSeconds - (periodSeconds * target) / 100, 2);
  const shortfall = 100 - target;
  let nines = null;
  if (shortfall > 0) {
    const candidate = Math.log10(100 / shortfall);
    const whole = Math.round(candidate);
    if (Math.abs(candidate - whole) < 1e-6 && whole >= 1 && whole <= 6) nines = whole;
  }
  const result = {
    targetPercent: target,
    period: input.period === undefined ? 'month' : input.period,
    periodHours: hours,
    allowedSeconds: allowed,
    nines,
    downtimeMinutes: null,
    observedSeconds: null,
    achievedPercent: null,
    budgetUsedPercent: null,
    remainingSeconds: null,
    overBudget: false,
  };
  const downtimeText = input.downtimeMinutes === undefined ? '' : String(input.downtimeMinutes).trim();
  if (downtimeText) {
    const minutes = Number(downtimeText.replace(',', '.'));
    const observed = r(minutes * 60, 2);
    result.downtimeMinutes = minutes;
    result.observedSeconds = observed;
    result.achievedPercent = r(100 - (observed / periodSeconds) * 100, 4);
    result.budgetUsedPercent = r((observed / allowed) * 100, 1);
    result.remainingSeconds = r(allowed - observed, 2);
    result.overBudget = observed > allowed;
  }
  return result;
}

// Documented surface and constants.
assert.equal(C.DEFAULTS.targetPercent, 99.9);
assert.equal(C.DEFAULTS.period, 'month');
assert.equal(C.DEFAULTS.downtimeMinutes, '');
assert.equal(C.MAX_TARGET, 99.9999);
assert.deepEqual({ ...C.PERIOD_HOURS }, HOURS);
assert.equal(C.TARGET_MISSING, 'Enter the target availability.');
assert.equal(C.TARGET_ERROR, 'Target availability must be a number greater than 0 and at most 99.9999.');
assert.equal(C.PERIOD_ERROR, 'Choose a period from the list.');
assert.equal(C.DOWNTIME_ERROR,
  'Downtime must be a number of minutes from 0 up to the length of the period, or left blank.');
assert.equal(C.DOWNTIME_LONG, 'Downtime in minutes cannot be longer than the selected period.');

// Golden: the default three nines over a month is the familiar 43 min 48 s.
const base = { targetPercent: '99.9', period: 'month', downtimeMinutes: '' };
assert.deepEqual({ ...run({}) }, {
  targetPercent: 99.9, period: 'month', periodHours: 730, allowedSeconds: 2628, nines: 3,
  downtimeMinutes: null, observedSeconds: null, achievedPercent: null,
  budgetUsedPercent: null, remainingSeconds: null, overBudget: false,
});
assert.equal(run({ ...base, period: 'year' }).allowedSeconds, 31536);
assert.equal(run({ ...base, period: 'day' }).allowedSeconds, 86.4);
assert.equal(run({ ...base, period: 'week' }).allowedSeconds, 604.8);
assert.equal(run({ ...base, period: 'quarter' }).allowedSeconds, 7884);
assert.equal(run({ targetPercent: '99.999', period: 'year' }).allowedSeconds, 315.36);
assert.equal(run({ targetPercent: '99.9999', period: 'year' }).allowedSeconds, 31.54);

// Nines are labelled only on a whole power of ten, and never outside one to six.
assert.equal(run({ targetPercent: '99.9' }).nines, 3);
assert.equal(run({ targetPercent: '99.99' }).nines, 4);
assert.equal(run({ targetPercent: '99.999' }).nines, 5);
assert.equal(run({ targetPercent: '99.9999' }).nines, 6);
assert.equal(run({ targetPercent: '99.95' }).nines, null);
assert.equal(run({ targetPercent: '99.5' }).nines, null);
assert.equal(run({ targetPercent: '0.1' }).nines, null);
assert.equal(run({ targetPercent: '90' }).nines, 1);

// An observed downtime moves the achieved availability and the budget bar.
const over = run({ targetPercent: '99.95', period: 'month', downtimeMinutes: '60' });
assert.equal(over.allowedSeconds, 1314);
assert.equal(over.observedSeconds, 3600);
assert.equal(over.achievedPercent, 99.863);
assert.equal(over.budgetUsedPercent, 274);
assert.equal(over.remainingSeconds, -2286);
assert.equal(over.overBudget, true);
const within = run({ targetPercent: '99.5', period: 'quarter', downtimeMinutes: '30' });
assert.equal(within.achievedPercent, 99.9772);
assert.equal(within.budgetUsedPercent, 4.6);
assert.equal(within.remainingSeconds, 37620);
assert.equal(within.overBudget, false);
const exact = run({ targetPercent: '99.9', period: 'month', downtimeMinutes: '43.8' });
assert.equal(exact.observedSeconds, 2628);
assert.equal(exact.achievedPercent, 99.9);
assert.equal(exact.budgetUsedPercent, 100);
assert.equal(exact.remainingSeconds, 0);
assert.equal(exact.overBudget, false);
const none = run({ targetPercent: '99.99', period: 'day', downtimeMinutes: '0' });
assert.equal(none.achievedPercent, 100);
assert.equal(none.budgetUsedPercent, 0);
assert.equal(none.remainingSeconds, 8.64);
assert.equal(none.overBudget, false);
assert.equal(run({ ...base, downtimeMinutes: '43,8' }).observedSeconds, 2628);

// A grid of targets, periods and downtimes against the independent oracle.
const targets = ['90', '99', '99.5', '99.9', '99.95', '99.99', '99.995', '99.999', '99.9999', '99.0'];
const periods = ['day', 'week', 'month', 'quarter', 'year'];
const downtimes = ['', '1.5', '120'];
let checked = 0;
for (const targetPercent of targets) {
  for (const period of periods) {
    for (const downtimeMinutes of downtimes) {
      const input = { targetPercent, period, downtimeMinutes };
      const result = run(input);
      const expected = oracle(input);
      for (const key of Object.keys(expected)) {
        if (expected[key] === null) {
          assert.equal(result[key], null, key + ' ' + JSON.stringify(input));
        } else if (typeof expected[key] === 'number') {
          assert.ok(Math.abs(result[key] - expected[key]) < 1e-9, key + ' ' + JSON.stringify(input));
        } else {
          assert.equal(result[key], expected[key], key + ' ' + JSON.stringify(input));
        }
      }
      // The budget plus the downtime the target claims is the whole period.
      assert.ok(Math.abs(result.allowedSeconds - (result.periodHours * 3600 * (100 - result.targetPercent)) / 100) < 0.01,
        'budget follows the target ' + JSON.stringify(input));
      if (result.downtimeMinutes !== null) {
        assert.ok(Math.abs(result.achievedPercent + (result.observedSeconds / (result.periodHours * 3600)) * 100 - 100) < 0.002,
          'achieved availability closes to 100 ' + JSON.stringify(input));
        assert.ok(result.allowedSeconds > 0, 'budget is positive ' + JSON.stringify(input));
        assert.equal(result.overBudget, result.observedSeconds > result.allowedSeconds,
          'overrun flag ' + JSON.stringify(input));
      }
      checked += 1;
    }
  }
}

// Every listed period is accepted and an unknown one is refused.
for (const period of periods) assert.ok(run({ ...base, period }).periodHours > 0, period);
assert.equal(failure({ ...base, period: 'fortnight' }), C.PERIOD_ERROR);
assert.equal(failure({ ...base, period: '' }), C.PERIOD_ERROR);
assert.equal(failure({ ...base, period: 'Month' }), C.PERIOD_ERROR);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2261, 'catalog total');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
let overruns = 0;
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
    if (result.overBudget) overruns += 1;
  }
}
assert.ok(overruns >= 1, 'expected an over-budget case');

// Refusals name the field and the rule.
assert.equal(failure({ ...base, targetPercent: '' }), C.TARGET_MISSING);
assert.equal(failure({ ...base, targetPercent: '   ' }), C.TARGET_MISSING);
for (const bad of ['0', '100', '99.99995', '-1', 'three nines', '9.99e1', '99..9']) {
  assert.equal(failure({ ...base, targetPercent: bad }), C.TARGET_ERROR, bad);
}
for (const bad of ['-5', 'an hour', '1e2']) {
  assert.equal(failure({ ...base, downtimeMinutes: bad }), C.DOWNTIME_ERROR, bad);
}
assert.equal(failure({ ...base, downtimeMinutes: '43800.5' }), C.DOWNTIME_LONG);
assert.equal(run({ ...base, downtimeMinutes: '43800' }).overBudget, true);

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="sla-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['in-target', 'in-period', 'in-downtime']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const period of periods) {
  assert.ok(html.includes('<option value="' + period + '"'), 'period option ' + period + ' missing');
}
assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(html.includes('id="reset"'), 'reset control missing');

console.log('sla uptime budget calculator: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
