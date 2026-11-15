/* Regression checks for the spectrum analyzer sweep-time core.
 * The relation and the k = 2 to 3 range follow the Keysight measurement-speed
 * application note and the UC Santa Barbara ECE 145A spectrum analyzer notes.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const pagePath = path.join(root, 'frontend/tools/spectrum-analyzer-sweep-time-calculator/index.html');
const html = fs.readFileSync(pagePath, 'utf8');
const startMarker = '/* spectrum-sweep-core:start */';
const endMarker = '/* spectrum-sweep-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'sweep core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SpectrumSweepCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'spectrum-analyzer-sweep-time-calculator');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function close(actual, expected, label, tolerance) {
  const limit = tolerance || 1e-11;
  if (expected === 0) {
    assert.ok(Math.abs(actual) <= 1e-12, label + ': expected 0, got ' + actual);
    return;
  }
  const relative = Math.abs(actual - expected) / Math.abs(expected);
  assert.ok(relative <= limit, label + ': ' + actual + ' vs ' + expected + ' (' + relative + ')');
}

// 1. The catalog record exists and stays a conservative, listed, documented tool.
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Spectrum Analyzer Sweep Time Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is too thin');
assert.ok(record.method.includes('k times the span divided by the resolution bandwidth squared'), 'method states the relation');
assert.ok(record.tags.includes('spectrum-analyzer') && record.tags.includes('rbw'), 'tags name the domain');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique inside the record');
assert.equal(record.sources.length, 2, 'both specifications are cited');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and an https URL');
}

// 2. Every documented case replays through the core.
assert.ok(record.testCases.length >= 20, 'the record documents a useful number of cases');
let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, 'message for ' + testCase.name);
      return true;
    }, testCase.name);
    refusals += 1;
    continue;
  }
  const result = plain(C.calculate(testCase.input));
  assert.deepEqual(Object.keys(result).sort(), Object.keys(testCase.expected).sort(),
    'result fields for ' + testCase.name);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      close(result[key], expected, testCase.name + ' / ' + key);
    } else {
      assert.deepEqual(result[key], expected, testCase.name + ' / ' + key);
    }
  }
  goldens += 1;
}
assert.ok(goldens >= 12 && refusals >= 10, 'golden and refusal cases are both present');

// 3. The documented defaults load on the page and reproduce the header numbers.
const defaults = C.calculate({});
close(defaults.spanHz, 1e8, 'default span');
close(defaults.sweepTimeSeconds, 0.02, 'default sweep time');
close(defaults.sweepRateHzPerSecond, 5e9, 'default rate');
assert.equal(defaults.verdict, 'typical');
for (const [key, value] of Object.entries(C.DEFAULTS)) {
  assert.equal(typeof value, 'string', 'default ' + key + ' is a string');
}
assert.equal(C.DEFAULTS.frequencyUnit, 'MHz');
assert.equal(C.DEFAULTS.rbwUnit, 'kHz');

// 4. Formatting reads like an instrument display.
assert.equal(C.formatDuration(0.02), '20 ms');
assert.equal(C.formatDuration(0.6), '600 ms');
assert.equal(C.formatDuration(2), '2 s');
assert.equal(C.formatDuration(405), '6.75 min');
assert.equal(C.formatDuration(7200), '2 h');
assert.equal(C.formatDuration(2e-12), '2 ps');
assert.equal(C.formatDuration(2e-14), '20 fs');
assert.equal(C.formatDuration(2e9), '555,556 h');
assert.equal(C.formatDuration(0), '0 s');
assert.equal(C.formatFrequency(1e8), '100 MHz');
assert.equal(C.formatFrequency(1e9), '1 GHz');
assert.equal(C.formatFrequency(1e12), '1 THz');
assert.equal(C.formatFrequency(1), '1 Hz');
assert.equal(C.formatFrequency(0), '0 Hz');
assert.equal(C.formatFrequency(44721.35955), '44.7 kHz');
assert.equal(C.formatRate(5e9), '5 GHz/s');
assert.equal(C.formatRate(0.5), '500 mHz/s');
assert.equal(C.formatRate(0), '0 Hz/s');
assert.equal(C.formatRate(33333333.333333332), '33.3 MHz/s');
assert.equal(C.threeSig(1000), '1,000');
assert.equal(C.threeSig(999999), '999,999');
assert.equal(C.threeSig(33333333.333333332), '33,333,333');
assert.equal(C.threeSig(2.5), '2.5');
assert.equal(C.threeSig(0.5), '0.5');
assert.equal(C.threeSig(0), '0');
assert.equal(C.threeSig(1e9), '1e9');
assert.equal(C.threeSig(1e18), '1e18');
assert.equal(C.threeSig(1e-6), '1e-6');
assert.equal(C.threeSig(1414213562.373095), '1.41e9');

// 5. The same physical frequencies give the same answer in every unit.
const unitFactors = { Hz: 1, kHz: 1e3, MHz: 1e6, GHz: 1e9 };
const startHz = 2.4e9;
const stopHz = 2.5e9;
const rbwHz = 1e5;
let reference = null;
for (const [unit, factor] of Object.entries(unitFactors)) {
  const rbwUnit = rbwHz >= 1e6 ? 'MHz' : rbwHz >= 1e3 ? 'kHz' : 'Hz';
  const rbwFactor = unitFactors[rbwUnit];
  const result = C.calculate({
    start: String(startHz / factor), stop: String(stopHz / factor), frequencyUnit: unit,
    rbw: String(rbwHz / rbwFactor), rbwUnit, k: '2', budget: '0.5'
  });
  close(result.spanHz, 1e8, 'span in ' + unit, 1e-9);
  close(result.rbwHz, rbwHz, 'rbw in ' + unit, 1e-9);
  close(result.sweepTimeSeconds, 0.02, 'sweep time in ' + unit, 1e-9);
  if (reference === null) reference = result;
  else {
    close(result.widestRbwHz, reference.widestRbwHz, 'widest RBW in ' + unit, 1e-9);
    assert.equal(result.verdict, reference.verdict, 'verdict in ' + unit);
  }
}

// 6. Seeded sweep: the invariants of a swept analysis hold for every case.
let seed = 20261115;
function next() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
let rounds = 0;
let budgetRounds = 0;
for (let round = 0; round < 260; round += 1) {
  const span = Math.round(1 + next() * 1e9);
  const startValue = Math.round(next() * 1e9);
  const rbw = Number((0.001 + next() * 1e6).toFixed(3));
  const k = Number((1 + next() * 9).toFixed(2));
  const budget = next() < 0.6 ? Number((1e-6 + next() * 1e6).toPrecision(4)) : '';
  const input = {
    start: String(startValue), stop: String(startValue + span), frequencyUnit: 'Hz',
    rbw: String(rbw), rbwUnit: 'Hz', k: String(k), budget: budget === '' ? '' : String(budget)
  };
  const result = C.calculate(input);
  close(result.spanHz, span, 'sweep span');
  close(result.sweepTimeSeconds, k * span / (rbw * rbw), 'sweep time', 1e-10);
  close(result.sweepRateHzPerSecond * result.sweepTimeSeconds, span, 'rate times time', 1e-9);
  close(result.resolutionElements * rbw, span, 'elements times RBW', 1e-9);
  close(result.narrowerTenTimesSeconds, result.sweepTimeSeconds * 100, 'narrower sweep', 1e-10);
  close(result.widerTenTimesSeconds, result.sweepTimeSeconds / 100, 'wider sweep', 1e-10);
  close(result.rateAtTwoHzPerSecond, rbw * rbw / 2, 'rate at k = 2', 1e-9);
  close(result.rateAtThreeHzPerSecond, rbw * rbw / 3, 'rate at k = 3', 1e-9);
  const expectedVerdict = k < 2 ? 'fast' : k > 3 ? 'slow' : 'typical';
  assert.equal(result.verdict, expectedVerdict, 'verdict for k = ' + k);
  if (result.verdict === 'fast') {
    assert.ok(result.sweepRateHzPerSecond >= rbw * rbw / 2 * (1 - 1e-9), 'fast rate above RBW squared over 2');
  }
  if (result.verdict === 'slow') {
    assert.ok(result.sweepRateHzPerSecond <= rbw * rbw / 3 * (1 + 1e-9), 'slow rate below RBW squared over 3');
  }
  if (budget !== '') {
    budgetRounds += 1;
    close(result.budgetSeconds, budget, 'budget echo');
    close(k * span / (result.widestRbwHz * result.widestRbwHz), budget, 'sweep time at the widest RBW', 1e-9);
    close(result.widestRbwAboveCap ? 1 : 0, result.widestRbwHz > 1e9 ? 1 : 0, 'RBW cap flag');
    close(result.widestRateHzPerSecond, span / budget, 'rate at the widest RBW', 1e-9);
  } else {
    assert.equal(result.widestRbwHz, null, 'no inverse without a budget');
    assert.equal(result.widestResolutionElements, null);
    assert.equal(result.widestRateHzPerSecond, null);
    assert.equal(result.budgetSeconds, null);
  }
  rounds += 1;
}
assert.equal(rounds, 260);
assert.ok(budgetRounds > 120, 'the sweep exercised the inverse, got ' + budgetRounds);

// 7. Determinism and decimal commas.
const twice = [plain(C.calculate({ start: '2,4', stop: '2,5', frequencyUnit: 'GHz', rbw: '100', rbwUnit: 'kHz', k: '2', budget: '' })),
  plain(C.calculate({ start: '2,4', stop: '2,5', frequencyUnit: 'GHz', rbw: '100', rbwUnit: 'kHz', k: '2', budget: '' }))];
assert.deepEqual(twice[0], twice[1], 'the core is deterministic');
close(twice[0].spanHz, 1e8, 'decimal comma span');

// 8. Refusals name the field and the range, and never accept a hidden fallback.
const cases = [
  [{ start: '' }, C.ERRORS.startMissing],
  [{ k: '2', start: '1e3' }, C.ERRORS.start],
  [{ stop: '' }, C.ERRORS.stopMissing],
  [{ start: '200', stop: '100' }, C.ERRORS.stop],
  [{ start: '0', stop: '0' }, C.ERRORS.stop],
  [{ rbw: '' }, C.ERRORS.rbwMissing],
  [{ rbw: '0' }, C.ERRORS.rbw],
  [{ rbw: '2000', rbwUnit: 'MHz' }, C.ERRORS.rbw],
  [{ k: '' }, C.ERRORS.kMissing],
  [{ k: '0.9' }, C.ERRORS.k],
  [{ k: '10.1' }, C.ERRORS.k],
  [{ frequencyUnit: 'THz' }, C.ERRORS.unit],
  [{ rbwUnit: 'GHz' }, C.ERRORS.rbwUnit],
  [{ budget: '0' }, C.ERRORS.budget],
  [{ budget: '1000001' }, C.ERRORS.budget],
  [{ budget: 'soon' }, C.ERRORS.budget]
];
for (const [override, message] of cases) {
  assert.throws(() => C.calculate(Object.assign({}, override)), (error) => {
    assert.equal(error.message, message, JSON.stringify(override));
    return true;
  }, JSON.stringify(override));
}

// 9. The page wires the same constants the core documents.
assert.equal(C.MAX_FREQUENCY_HZ, 1e12);
assert.equal(C.MAX_RBW_HZ, 1e9);
assert.equal(C.MIN_K, 1);
assert.equal(C.MAX_K, 10);
assert.equal(C.MAX_BUDGET_SECONDS, 1e6);
assert.deepEqual(plain(C.FREQUENCY_UNITS), { Hz: 1, kHz: 1000, MHz: 1e6, GHz: 1e9 });
assert.deepEqual(plain(C.RBW_UNITS), { Hz: 1, kHz: 1000, MHz: 1e6 });
assert.ok(html.includes('<h1>Spectrum Analyzer Sweep Time Calculator</h1>'));
assert.ok(html.includes('/assets/app.js'), 'the shared shell runs on the page');
assert.ok(!/https?:\/\/(?!www\.keysight|web\.ece\.ucsb)/.test(html.replace(/<p class="note">[\s\S]*?<\/p>/, '')),
  'the page itself loads nothing from another origin');

console.log('spectrum analyzer sweep time: all checks passed, ' + goldens + ' golden, ' + refusals
  + ' refusal, ' + rounds + ' swept rounds (' + budgetRounds + ' with a budget)');
