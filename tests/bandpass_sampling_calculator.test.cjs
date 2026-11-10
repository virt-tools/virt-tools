/* Regression and independent spectral-overlap checks for bandpass sampling. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bandpass-sampling-calculator/index.html'), 'utf8');
const startMarker = '/* bandpass-sampling-core:start */';
const endMarker = '/* bandpass-sampling-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'bandpass sampling core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = BandpassSamplingCore;', sandbox);
const C = sandbox.module.exports;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * 1e-10), `${label || 'value'}: ${actual} != ${expected}`);
const exactError = (fn, expected) => {
  let thrown = null;
  try { fn(); } catch (error) { thrown = error; }
  assert.ok(thrown, `expected error: ${expected}`);
  assert.equal(thrown.message, expected);
};

const standard = C.calculate({});
assert.equal(standard.bandwidthHz, 4000);
assert.equal(standard.nyquistRateHz, 28000);
assert.equal(standard.theoreticalMinimumHz, 8000);
assert.equal(standard.sampleValid, true);
assert.equal(standard.sampleZone, 2);
assert.equal(standard.sampleInverted, true);
assert.deepEqual(Array.from(standard.zones, zone => zone.n), [3, 2, 1]);
close(standard.lowestWindowMinHz, 28000 / 3);
assert.equal(standard.lowestWindowMaxHz, 10000);
assert.equal(C.formatFrequencyHz(standard.bandwidthHz), '4 kHz');
assert.equal(C.formatSampleRateHz(standard.sampleRateHz), '16 kS/s');
assert.equal(C.formatRange(standard.zones[0]), '9.333333 kS/s < fs < 10 kS/s');
assert.equal(C.formatRange(standard.zones[2]), 'fs > 28 kS/s');
assert.match(C.summary(standard), /Alias-free: yes · zone 2 · inverted spectrum/);
assert.match(C.summary(standard), /Zone 3: 9\.333333 kS\/s < fs < 10 kS\/s · non-inverted/);

// Published AM example: GaussianWaves maps 0.99, 1.00 and 1.01 MHz
// to 30, 40 and 50 kHz at 120 kS/s in non-inverting zone 17.
const published = C.calculate({lowerFrequency: '0.99', upperFrequency: '1.01', sampleRate: '0.12', unit: 'MHz'});
assert.equal(published.maxZone, 50);
assert.equal(published.sampleZone, 17);
assert.equal(published.sampleInverted, false);
close(published.lowestWindowMinHz, 40400, 'published-example lowest lower bound');
close(published.lowestWindowMaxHz, 1980000 / 49, 'published-example lowest upper bound');
assert.equal(published.zones.length, 13, '12 lowest windows plus baseband');
assert.equal(published.omittedZoneCount, 37);
assert.equal(wrapped(990000, 120000), 30000);
assert.equal(wrapped(1000000, 120000), 40000);
assert.equal(wrapped(1010000, 120000), 50000);

// Independent oracle: real positive and negative spectral copies must neither
// overlap nor touch after translation by integer multiples of the sample rate.
function independentAliasFree(lower, upper, sampleRate) {
  const bandwidth = upper - lower;
  const tolerance = Math.max(1, upper) * 1e-11;
  if (!(sampleRate > bandwidth + tolerance)) return false;
  const firstShift = Math.floor((2 * lower) / sampleRate) - 2;
  const lastShift = Math.ceil((2 * upper) / sampleRate) + 2;
  for (let shift = firstShift; shift <= lastShift; shift++) {
    // Positive band [lower,upper] versus shifted negative band
    // [shift*fs-upper,shift*fs-lower]. Touching is rejected too.
    const left = Math.max(lower, shift * sampleRate - upper);
    const right = Math.min(upper, shift * sampleRate - lower);
    if (left <= right + tolerance) return false;
  }
  return true;
}
function wrapped(frequency, sampleRate) {
  return ((frequency + sampleRate / 2) % sampleRate + sampleRate) % sampleRate - sampleRate / 2;
}
let seed = 0x51a7c3;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
let randomChecks = 0;
let validChecks = 0;
let midpointChecks = 0;
for (let index = 0; index < 5000; index++) {
  const lower = 1 + random() * 1000;
  const bandwidth = 0.05 + random() * lower * 1.5;
  const upper = lower + bandwidth;
  const sampleRate = (0.15 + random() * 2.2) * upper;
  const result = C.calculate({lowerFrequency: String(lower), upperFrequency: String(upper), sampleRate: String(sampleRate), unit: 'Hz'});
  const expected = independentAliasFree(result.lowerFrequencyHz, result.upperFrequencyHz, result.sampleRateHz);
  assert.equal(result.sampleValid, expected, `spectral oracle mismatch at ${lower}–${upper} Hz, fs=${sampleRate}`);
  if (result.sampleValid) {
    validChecks++;
    const centre = (result.lowerFrequencyHz + result.upperFrequencyHz) / 2;
    const delta = result.bandwidthHz * 1e-7;
    const alias = wrapped(centre, result.sampleRateHz);
    const direction = wrapped(centre + delta, result.sampleRateHz) - wrapped(centre - delta, result.sampleRateHz);
    // A negative principal alias represents baseband through the conjugate
    // (original negative-frequency) copy, reversing the observed derivative.
    const independentlyInverted = alias >= 0 ? direction < 0 : direction > 0;
    assert.equal(independentlyInverted, result.sampleInverted, 'spectral orientation parity');
  }
  for (const zone of result.zones) {
    const fs = zone.maxHz === null ? zone.minHz * 1.25 : (zone.minHz + zone.maxHz) / 2;
    assert.equal(independentAliasFree(result.lowerFrequencyHz, result.upperFrequencyHz, fs), true, `zone ${zone.n} midpoint must be alias-free`);
    midpointChecks++;
  }
  randomChecks++;
}
assert.ok(validChecks > 1000 && validChecks < randomChecks, 'random sweep exercises valid and invalid rates');

// Exact integer band placement has a zero-width top wedge, which is omitted.
const degenerate = C.calculate({lowerFrequency: '8', upperFrequency: '10', sampleRate: '5.1', unit: 'kHz'});
assert.equal(degenerate.maxZone, 5);
assert.equal(degenerate.validZoneCount, 4);
assert.deepEqual(Array.from(degenerate.zones, zone => zone.n), [4, 3, 2, 1]);
assert.equal(degenerate.sampleZone, 4);
for (const rate of [28000 / 3, 10000, 14000, 20000, 28000]) {
  assert.equal(C.calculate({sampleRate: String(rate / 1000)}).sampleValid, false, `zero-margin boundary ${rate} must be rejected`);
}
assert.equal(C.calculate({sampleRate: '9.5'}).sampleZone, 3);
assert.equal(C.calculate({sampleRate: '15'}).sampleZone, 2);
assert.equal(C.calculate({sampleRate: '29'}).sampleZone, 1);

for (const id of Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), match => match[1])) {
  assert.ok(html.includes(`id="${id}"`), `DOM id missing: ${id}`);
}

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter(tool => tool.slug === 'bandpass-sampling-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one bandpass sampling calculator');
const record = records[0];
assert.equal(record.name, 'Bandpass Sampling Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Undersampling Calculator'));
assert.ok(record.testCases.length >= 14, 'catalog carries golden, boundary and validation checks');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    exactError(() => C.calculate(testCase.input), testCase.expectedError);
    continue;
  }
  assert.ok(testCase.kind === 'golden' || testCase.kind === 'boundary', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') close(result[key], expected, `${testCase.name}: ${key}`);
    else assert.deepEqual(result[key], expected, `${testCase.name}: ${key}`);
  }
}

console.log(`bandpass-sampling-calculator: all checks passed (${record.testCases.length} catalog cases; ${randomChecks} independent random spectral checks, ${validChecks} valid; ${midpointChecks} window midpoints)`);
