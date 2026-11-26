/* Regression checks for the speaker crossover calculator core.
 *
 * The component values are checked the hard way: the exact two-element network
 * is evaluated at several frequencies and compared with the analytic
 * Butterworth magnitude, so the suite proves the design rather than repeating
 * the page's algebra. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'speaker-crossover-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* scx-core:start */');
const end = html.indexOf('/* scx-core:end */');
assert.ok(start > -1 && end > start, 'crossover core markers missing');
const core = html.slice(start, end + '/* scx-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CrossoverCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= eps * scale,
    `${label}: expected ${expected}, got ${actual}`);
};
// A displayed value keeps a fixed number of decimals; accept half of the last
// one plus float slack and nothing looser.
const closeTo = (actual, expected, label) => {
  const text = String(expected);
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  const tolerance = 0.5 * Math.pow(10, -decimals) + Math.abs(expected) * 1e-9;
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
};
const run = (input) => C.calculate(input);
const base = { frequency: '2500', order: 'second', wooferImpedance: '8', tweeterImpedance: '8', tweeterLevel: '0' };
const withInput = (patch) => run(Object.assign({}, base, patch));
const refuses = (input, message) => {
  assert.throws(() => run(Object.assign({}, base, input)), (error) => {
    assert.equal(error.message, message);
    return true;
  }, `expected the refusal "${message}"`);
};

// ---- Complex arithmetic in the test's own hands.
const complex = (re, im) => ({ re, im });
const reactance = (value) => complex(0, value);
const parallel = (a, b) => {
  const divisor = complex(a.re + b.re, a.im + b.im);
  const numerator = complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const magnitude = divisor.re * divisor.re + divisor.im * divisor.im;
  return complex((numerator.re * divisor.re + numerator.im * divisor.im) / magnitude,
    (numerator.im * divisor.re - numerator.re * divisor.im) / magnitude);
};
const seriesSum = (list) => list.reduce((sum, value) => complex(sum.re + value.re, sum.im + value.im), complex(0, 0));
const abs = (value) => Math.sqrt(value.re * value.re + value.im * value.im);

// |Vout / Vin| of one branch, ideal voltage source, resistive driver.
const branchGain = (kind, f, impedance, seriesValue, shuntValue) => {
  const omega = 2 * Math.PI * f;
  const series = kind === 'L' ? reactance(omega * seriesValue) : complex(0, -1 / (omega * seriesValue));
  const load = complex(impedance, 0);
  const zp = shuntValue === null ? load
    : parallel(load, kind === 'L' ? complex(0, -1 / (omega * shuntValue)) : reactance(omega * shuntValue));
  return abs(zp) / abs(seriesSum([zp, series]));
};

// ---- 1. The values are the Butterworth values, checked against the shape.
for (const [order, power] of [['first', 2], ['second', 4]]) {
  for (const [frequency, woofer, tweeter] of [[2500, 8, 8], [3000, 4, 4], [800, 6, 12], [5000, 16, 4]]) {
    const result = run({
      frequency: String(frequency), order,
      wooferImpedance: String(woofer), tweeterImpedance: String(tweeter), tweeterLevel: '0'
    });
    for (const ratio of [0.5, 0.8, 1, 1.25, 2, 4]) {
      const low = branchGain('L', frequency * ratio, woofer, result.wooferSeriesL, result.wooferShuntC);
      const high = branchGain('C', frequency * ratio, tweeter, result.tweeterSeriesC, result.tweeterShuntL);
      near(low, 1 / Math.sqrt(1 + Math.pow(ratio, power)), `${order} low pass at ${ratio} fc`);
      near(high, 1 / Math.sqrt(1 + Math.pow(ratio, -power)), `${order} high pass at ${ratio} fc`);
    }
    // 3 dB down exactly at the crossover, and never a peak.
    near(20 * Math.log10(branchGain('L', frequency, woofer, result.wooferSeriesL, result.wooferShuntC)),
      20 * Math.log10(1 / Math.SQRT2), `${order} low pass level at fc`);
    near(20 * Math.log10(branchGain('C', frequency, tweeter, result.tweeterSeriesC, result.tweeterShuntL)),
      20 * Math.log10(1 / Math.SQRT2), `${order} high pass level at fc`);
    let peak = 0;
    for (let octave = -3; octave <= 0; octave += 0.05) {
      const f = frequency * Math.pow(10, octave);
      peak = Math.max(peak, branchGain('L', f, woofer, result.wooferSeriesL, result.wooferShuntC));
    }
    assert.ok(peak <= 1 + 1e-12, `${order} low pass peaks: ${peak}`);
  }
}

// ---- 2. Reactances, the published round numbers and the second-order scaling.
const mid = run(Object.assign({}, base));
closeTo(mid.wooferSeriesLmH, 0.720253, '2.5 kHz 8 ohm woofer inductor');
closeTo(mid.tweeterSeriesCmF, 5.626977, '2.5 kHz 8 ohm tweeter capacitor');
closeTo(mid.wooferReactance, 8 * Math.SQRT2, 'second-order reactance is sqrt 2 times the impedance');
closeTo(mid.tweeterReactance, 8 * Math.SQRT2, 'tweeter reactance matches the woofer');
closeTo(mid.wooferLevelDb, -3.01, 'second-order branch is 3 dB down');
assert.equal(mid.wooferShuntCmF, mid.tweeterSeriesCmF, 'symmetric branches share the capacitor value');
assert.equal(mid.tweeterShuntLmH, mid.wooferSeriesLmH, 'symmetric branches share the inductor value');
assert.equal(mid.padShuntR, Infinity, 'no pad without attenuation');
assert.equal(mid.padSeriesR, 0, 'no series resistor without attenuation');
assert.equal(mid.padInputZ, 8, 'unpadded load is the driver');
assert.equal(mid.order, 'second');
assert.equal(mid.slope, '12 dB per octave');

const firstOrder = withInput({ order: 'first' });
closeTo(firstOrder.wooferSeriesLmH, 0.509296, 'first-order inductor');
closeTo(firstOrder.tweeterSeriesCmF, 7.957747, 'first-order capacitor');
closeTo(firstOrder.wooferReactance, 8, 'first-order reactance equals the impedance');
assert.equal(firstOrder.wooferShuntCmF, null, 'first order has no shunt capacitor');
assert.equal(firstOrder.tweeterShuntLmH, null, 'first order has no shunt inductor');
assert.equal(firstOrder.slope, '6 dB per octave');

// Doubling the frequency halves both components; doubling the impedance
// doubles the inductor and halves the capacitor.
const doubled = withInput({ frequency: '5000' });
near(doubled.wooferSeriesLmH * 2, mid.wooferSeriesLmH, 'inductor halves with frequency');
near(doubled.tweeterSeriesCmF * 2, mid.tweeterSeriesCmF, 'capacitor halves with frequency');
const biggerWoofer = withInput({ wooferImpedance: '16' });
const biggerTweeter = withInput({ tweeterImpedance: '16' });
near(biggerWoofer.wooferSeriesLmH, mid.wooferSeriesLmH * 2, 'inductor doubles with impedance');
near(biggerTweeter.tweeterSeriesCmF, mid.tweeterSeriesCmF / 2, 'capacitor halves with impedance');

// ---- 3. The pad keeps the driver's impedance while it attenuates.
for (const level of [1, 3, 6, 9, 12]) {
  const padded = withInput({ tweeterLevel: String(level) });
  closeTo(padded.padInputZ, 8, `${level} dB pad keeps an 8 ohm load`);
  closeTo(padded.tweeterLevel, level, `${level} dB reported`);
  assert.ok(padded.padShuntR > 0 && padded.padSeriesR > 0, `${level} dB needs both resistors`);
}
const six = withInput({ tweeterLevel: '6' });
closeTo(six.padSeriesR, 3.990502, '6 dB series resistor');
closeTo(six.padShuntR, 8.038082, '6 dB shunt resistor');
const twelve = withInput({ tweeterLevel: '12' });
closeTo(twelve.padSeriesR, 5.990491, '12 dB series resistor');
closeTo(twelve.padShuntR, 2.683599, '12 dB shunt resistor');
assert.ok(twelve.padSeriesR > six.padSeriesR && twelve.padShuntR < six.padShuntR,
  'a deeper pad needs more series resistance and less shunt resistance');

// ---- 4. Limits and refusals.
assert.deepEqual(Object.keys(C.LIMITS).sort(), ['frequency', 'impedance', 'level']);
assert.equal(C.LIMITS.frequency[0], 100);
assert.equal(C.LIMITS.frequency[1], 10000);
assert.equal(C.LIMITS.impedance[0], 1);
assert.equal(C.LIMITS.impedance[1], 32);
assert.equal(C.LIMITS.level[1], 12);

refuses({ frequency: '' }, 'Enter the crossover frequency.');
refuses({ frequency: '   ' }, 'Enter the crossover frequency.');
refuses({ frequency: '2.5 kHz' }, 'Enter the crossover frequency as a number.');
refuses({ frequency: '1e3' }, 'Enter the crossover frequency as a number.');
refuses({ frequency: '99' }, 'Enter a crossover frequency from 100 to 10000 Hz.');
refuses({ frequency: '10001' }, 'Enter a crossover frequency from 100 to 10000 Hz.');
refuses({ wooferImpedance: '' }, 'Enter the woofer impedance.');
refuses({ wooferImpedance: 'eight' }, 'Enter the woofer impedance as a number.');
refuses({ wooferImpedance: '0.5' }, 'Enter an impedance from 1 to 32 Ω for the woofer.');
refuses({ wooferImpedance: '33' }, 'Enter an impedance from 1 to 32 Ω for the woofer.');
refuses({ tweeterImpedance: '0' }, 'Enter an impedance from 1 to 32 Ω for the tweeter.');
refuses({ tweeterImpedance: '40' }, 'Enter an impedance from 1 to 32 Ω for the tweeter.');
refuses({ tweeterLevel: '-1' }, 'Enter a tweeter level from 0 to 12 dB.');
refuses({ tweeterLevel: '13' }, 'Enter a tweeter level from 0 to 12 dB.');
refuses({ tweeterLevel: 'loud' }, 'Enter the tweeter level as a number.');
refuses({ order: 'third' }, 'Choose the filter order.');
refuses({ order: '' }, 'Choose the filter order.');

// Decimal commas and the order aliases the page never shows are accepted.
closeTo(withInput({ frequency: '2500,5' }).frequency, 2500.5, 'decimal comma frequency');
closeTo(withInput({ order: '1st' }).wooferSeriesLmH, firstOrder.wooferSeriesLmH, '1st order alias');
closeTo(withInput({ order: '2nd' }).wooferSeriesLmH, mid.wooferSeriesLmH, '2nd order alias');
// A missing level means no pad rather than a refusal.
const noLevel = run({ frequency: '2500', order: 'second', wooferImpedance: '8', tweeterImpedance: '8' });
assert.equal(noLevel.tweeterLevel, 0, 'a missing level is 0 dB');

// ---- 5. Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2470, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2209, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Speaker Crossover Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'sources present');
assert.ok(record.sources.some((entry) => (entry.url || '').includes('Audio_crossover')),
  'the passive crossover network is cited');
assert.ok(record.sources.some((entry) => (entry.url || '').includes('Butterworth_filter')),
  'the Butterworth response is cited');
assert.ok(record.sources.some((entry) => (entry.url || '').includes('L_pad')),
  'the constant-impedance pad is cited');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 100, 'guidance present');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 16, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 6, 'golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5, 'boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 5, 'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 55, 'Audio count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
}

for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'string') {
      assert.equal(result[field], value, `${label}: ${field}`);
      continue;
    }
    assert.ok(typeof result[field] === 'number', `${label}: ${field} should be a number`);
    closeTo(result[field], value, `${label}: ${field}`);
  }
}

// ---- 6. Page contract: local-only, keyboard-submittable, one form.
assert.ok(html.includes('id="scx-form"'), 'form present');
assert.ok(html.includes('id="frequency"') && html.includes('id="order"'), 'inputs present');
assert.ok(html.includes('id="woofer"') && html.includes('id="tweeter"') && html.includes('id="level"'), 'driver fields present');
assert.ok(html.includes('id="ref-body"'), 'reference table present');
assert.ok(html.includes('aria-labelledby="ref-title"'), 'table named by its heading');
assert.ok(!html.includes('fetch(') && !html.includes('XMLHttpRequest'), 'no network calls');
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')),
  'no external URLs in the page');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1,
  'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
assert.ok(/<button\b[^>]*type="submit"/.test(html), 'submit button present');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const id of ['frequency', 'order', 'woofer', 'tweeter', 'level']) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(html), `label for ${id}`);
}
assert.ok(html.includes('aria-live="polite"'), 'results are announced');

console.log('speaker crossover calculator: all assertions passed');
