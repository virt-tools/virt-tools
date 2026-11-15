/* Regression checks for the pickup/cable resonance core, its catalog cases and the
   page's offline, no-storage contract. The circuit figure is checked against a
   direct complex-impedance evaluation of the divider (a different expression from
   the page's polynomial coefficients) and against a dense numerical peak sweep. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pickup-cable-resonance-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* pickup-resonance-core:start */');
const end = html.indexOf('/* pickup-resonance-core:end */');
assert.ok(start > -1 && end > start, 'pickup resonance core markers missing');
const core = html.slice(start, end + '/* pickup-resonance-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PickupResonanceCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEFAULTS = { inductance: '4', winding: '5', capacitance: '100', length: '5', load: '250' };
const run = (overrides) => C.calculate(Object.assign({}, DEFAULTS, overrides));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Oracle one: build the circuit as impedances and evaluate the divider at a frequency.
// Zp = R || 1/(jwC), H = Zp / (Rdc + jwL + Zp).
function transfer(frequency, L, Rdc, Cfarad, R) {
  const w = 2 * Math.PI * frequency;
  const denom = Math.hypot(1 / R, w * Cfarad);
  const zp = { re: (1 / R) / (denom * denom), im: -(w * Cfarad) / (denom * denom) };
  const num = zp;
  const den = { re: Rdc + zp.re, im: w * L + zp.im };
  const size = den.re * den.re + den.im * den.im;
  const hre = (num.re * den.re + num.im * den.im) / size;
  const him = (num.im * den.re - num.re * den.im) / size;
  return Math.hypot(hre, him);
}
const dcGain = (Rdc, R) => R / (R + Rdc);
const levelDb = (frequency, L, Rdc, Cfarad, R) =>
  20 * Math.log10(transfer(frequency, L, Rdc, Cfarad, R) / dcGain(Rdc, R));

// Oracle two: dense log sweep with parabolic refinement, no closed forms at all.
function sweepPeak(L, Rdc, Cfarad, R, from, to, steps) {
  const lo = from === undefined ? 10 : from;
  const hi = to === undefined ? 120000 : to;
  const count = steps === undefined ? 4000 : steps;
  let bestIndex = 0;
  let best = -Infinity;
  const ratio = Math.pow(hi / lo, 1 / count);
  for (let index = 0; index <= count; index += 1) {
    const value = transfer(lo * Math.pow(ratio, index), L, Rdc, Cfarad, R);
    if (value > best) { best = value; bestIndex = index; }
  }
  if (bestIndex === 0 || bestIndex === count) return { frequency: lo * Math.pow(ratio, bestIndex), magnitude: best };
  const at = (index) => transfer(lo * Math.pow(ratio, index), L, Rdc, Cfarad, R);
  const y0 = at(bestIndex - 1), y1 = at(bestIndex), y2 = at(bestIndex + 1);
  const offset = (0.5 * (y0 - y2)) / (y0 - 2 * y1 + y2);
  return { frequency: lo * Math.pow(ratio, bestIndex + offset), magnitude: y1 };
}

// Documented surface.
assert.deepEqual({ ...C.DEFAULTS }, { inductance: 4, winding: 5, capacitance: 100, length: 5, load: 250 });
assert.deepEqual({
  inductance: Array.from(C.LIMITS.inductance), winding: Array.from(C.LIMITS.winding),
  capacitance: Array.from(C.LIMITS.capacitance), length: Array.from(C.LIMITS.length), load: Array.from(C.LIMITS.load),
}, {
  inductance: [0.5, 12], winding: [0.5, 15], capacitance: [30, 300], length: [0.3, 30], load: [50, 2000],
});
closeTo(C.PEAK_Q, Math.SQRT1_2, 'peak threshold');
assert.equal(C.BRIGHT_HZ, 10000);
assert.equal(C.DARK_HZ, 2000);
assert.equal(C.STRONG_DB, 6);
assert.equal(C.CORNER_DB, 3);

// The default set-up, step by step: 4 H, 5 kohm winding, 500 pF of cable, 250 kohm load.
const base = run();
assert.equal(base.totalCapacitance, 500);
assert.equal(base.naturalFrequency, 3594);
assert.equal(base.peakFrequency, 3440);
assert.equal(base.hasPeak, true);
assert.equal(base.quality, 2.44);
assert.equal(base.peakBoost, 7.9);
assert.equal(base.corner, 5418);
assert.equal(base.responseAt2k, 2.8);
assert.equal(base.responseAt5k, -0.8);
assert.equal(base.responseAt10k, -16.7);
assert.equal(base.inductance, 4);
assert.equal(base.winding, 5);
assert.equal(base.load, 250);
assert.equal(base.warnings.length, 1);
assert.equal(base.warnings[0], C.MESSAGES.strong);

// The direct impedance model agrees with the reported peak, boost, levels and corner.
const L1 = 4, Rdc1 = 5000, Cf1 = 500e-12, R1 = 250000;
closeTo(levelDb(base.peakFrequency, L1, Rdc1, Cf1, R1), base.peakBoost, 'default peak boost', 0.06);
for (const [frequency, reported] of [[2000, base.responseAt2k], [5000, base.responseAt5k], [10000, base.responseAt10k]]) {
  closeTo(levelDb(frequency, L1, Rdc1, Cf1, R1), reported, 'level at ' + frequency, 0.06);
}
closeTo(levelDb(base.corner, L1, Rdc1, Cf1, R1), -3, 'default corner sits at -3 dB', 0.03);
const peakLevel = levelDb(base.peakFrequency, L1, Rdc1, Cf1, R1);
assert.ok(peakLevel > levelDb(base.peakFrequency * 0.97, L1, Rdc1, Cf1, R1) + 0.01, 'peak is higher than 3% below');
assert.ok(peakLevel > levelDb(base.peakFrequency * 1.03, L1, Rdc1, Cf1, R1) + 0.01, 'peak is higher than 3% above');

// Cable length dominates the shift: twice the capacitance moves the peak down.
const longer = run({ length: '10' });
const shorter = run({ length: '2.5' });
assert.ok(shorter.peakFrequency > base.peakFrequency && base.peakFrequency > longer.peakFrequency,
  'peak falls as cable capacitance rises');
closeTo(longer.totalCapacitance, 1000, 'ten metre capacitance');
closeTo(shorter.totalCapacitance, 250, 'two and a half metre capacitance');

// A heavy load damps the circuit to a flat, peakless response that falls monotonically.
const damped = run({ inductance: '0.5', winding: '15', capacitance: '300', length: '30', load: '50' });
assert.equal(damped.hasPeak, false);
assert.equal(damped.peakFrequency, null);
assert.equal(damped.peakBoost, 0);
assert.equal(damped.quality, 0.53);
assert.equal(damped.warnings.length, 1);
assert.equal(damped.warnings[0], C.MESSAGES.noPeak);
let previous = Infinity;
for (let step = 0; step <= 200; step += 1) {
  const frequency = 20 * Math.pow(20000 / 20, step / 200);
  const level = levelDb(frequency, 0.5, 15000, 9000e-12, 50000);
  assert.ok(level <= previous + 1e-9, 'damped response falls with frequency at ' + frequency);
  previous = level;
}

// Decimal commas are accepted in every field, and the peak matches its case row.
const commas = run({ inductance: '5,6', winding: '6,2', capacitance: '110', length: '7,5', load: '220' });
assert.equal(commas.peakFrequency, 2254);
assert.equal(commas.quality, 2.25);
assert.equal(commas.peakBoost, 7.3);

// Every field refuses a missing, non-numeric or out-of-range value with its own wording.
assert.equal(failure({ inductance: '' }), 'Enter the pickup inductance.');
assert.equal(failure({ inductance: '0.4' }), 'The pickup inductance must be a number from 0.5 to 12 henries.');
assert.equal(failure({ inductance: '12.5' }), 'The pickup inductance must be a number from 0.5 to 12 henries.');
assert.equal(failure({ inductance: 'four' }), 'The pickup inductance must be a number from 0.5 to 12 henries.');
assert.equal(failure({ winding: '' }), 'Enter the pickup winding resistance.');
assert.equal(failure({ winding: '0' }), 'The pickup winding resistance must be a number from 0.5 to 15 kilo-ohms.');
assert.equal(failure({ winding: '16' }), 'The pickup winding resistance must be a number from 0.5 to 15 kilo-ohms.');
assert.equal(failure({ capacitance: '' }), 'Enter the cable capacitance per metre.');
assert.equal(failure({ capacitance: '29' }), 'The cable capacitance must be a number from 30 to 300 picofarads per metre.');
assert.equal(failure({ capacitance: '301' }), 'The cable capacitance must be a number from 30 to 300 picofarads per metre.');
assert.equal(failure({ length: '' }), 'Enter the cable length.');
assert.equal(failure({ length: '0.2' }), 'The cable length must be a number from 0.3 to 30 metres.');
assert.equal(failure({ length: '31' }), 'The cable length must be a number from 0.3 to 30 metres.');
assert.equal(failure({ load: '' }), 'Enter the load resistance.');
assert.equal(failure({ load: '49' }), 'The load resistance must be a number from 50 to 2000 kilo-ohms.');
assert.equal(failure({ load: '2001' }), 'The load resistance must be a number from 50 to 2000 kilo-ohms.');
assert.equal(failure({ load: '-100' }), 'The load resistance must be a number from 50 to 2000 kilo-ohms.');
// Exactly at the limits is accepted.
assert.equal(run({ inductance: '12' }).inductance, 12);
assert.equal(run({ inductance: '0.5' }).inductance, 0.5);
assert.equal(run({ winding: '15' }).winding, 15);
assert.equal(run({ capacitance: '300', length: '30' }).totalCapacitance, 9000);
assert.equal(run({ length: '0.3', capacitance: '30' }).totalCapacitance, 9);
assert.equal(run({ load: '2000' }).load, 2000);
assert.equal(run({ load: '50' }).load, 50);

// Random sweep over the whole envelope against both oracles.
const random = (() => {
  let state = 20261115;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
})();
let compared = 0;
let swept = 0;
for (let index = 0; index < 400; index += 1) {
  const inductance = (0.5 + random() * 11.5).toFixed(2);
  const winding = (0.5 + random() * 14.5).toFixed(2);
  const capacitance = (30 + random() * 270).toFixed(1);
  const length = (0.3 + random() * 29.7).toFixed(2);
  const load = (50 + random() * 1950).toFixed(0);
  const input = { inductance, winding, capacitance, length, load };
  const numbers = {
    L: Number(inductance), Rdc: Number(winding) * 1000,
    C: Number(capacitance) * 1e-12 * Number(length), R: Number(load) * 1000,
  };
  const result = C.calculate(input);
  closeTo(result.totalCapacitance, numbers.C * 1e12, 'total capacitance', 0.06);
  if (!result.hasPeak) {
    assert.equal(result.peakFrequency, null, 'no peak frequency when damped');
    assert.equal(result.peakBoost, 0, 'no boost when damped');
    assert.ok(result.warnings.includes(C.MESSAGES.noPeak), 'damped warning');
    assert.ok(result.quality <= 0.71, 'damped Q');
    compared += 1;
    continue;
  }
  const peakLevelDb = levelDb(result.peakFrequency, numbers.L, numbers.Rdc, numbers.C, numbers.R);
  closeTo(peakLevelDb, result.peakBoost, 'random peak boost', 0.06);
  for (const [frequency, reported] of [[2000, result.responseAt2k], [5000, result.responseAt5k], [10000, result.responseAt10k]]) {
    closeTo(levelDb(frequency, numbers.L, numbers.Rdc, numbers.C, numbers.R), reported, 'random level at ' + frequency, 0.06);
  }
  closeTo(levelDb(result.corner, numbers.L, numbers.Rdc, numbers.C, numbers.R), -3, 'random corner', 0.03);
  const below = levelDb(result.peakFrequency * 0.99, numbers.L, numbers.Rdc, numbers.C, numbers.R);
  const above = levelDb(result.peakFrequency * 1.01, numbers.L, numbers.Rdc, numbers.C, numbers.R);
  assert.ok(below < peakLevelDb && above < peakLevelDb, 'reported peak is a local maximum: ' + JSON.stringify(input));
  if (index % 10 === 0) {
    const sweep = sweepPeak(numbers.L, numbers.Rdc, numbers.C, numbers.R);
    const error = Math.abs(sweep.frequency - result.peakFrequency) / result.peakFrequency;
    assert.ok(error < 0.003, 'sweep peak agrees: ' + sweep.frequency + ' vs ' + result.peakFrequency);
    assert.ok(Math.abs(20 * Math.log10(sweep.magnitude / dcGain(numbers.Rdc, numbers.R)) - result.peakBoost) < 0.06,
      'sweep boost agrees');
    swept += 1;
  }
  compared += 1;
}
assert.ok(compared > 300, 'compared ' + compared + ' solutions');
assert.ok(swept >= 30, 'swept peaks: ' + swept);

// Catalog cases replay, both directions.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2317, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.match(entry.guidance, /self-capacitance/, 'guidance names what the model leaves out');
assert.ok(entry.testCases.length >= 20, 'at least twenty catalog cases');
let goldenCases = 0;
let validationCases = 0;
for (const testCase of entry.testCases) {
  const input = Object.assign({}, DEFAULTS, testCase.input);
  if (testCase.kind === 'golden') {
    const result = C.calculate(input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.deepEqual(Array.from(result[key]), value, testCase.name + ' ' + key);
      } else if (typeof value === 'number') {
        closeTo(result[key], value, testCase.name + ' ' + key, 0.06);
      } else {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      }
    }
    goldenCases += 1;
  } else {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    validationCases += 1;
  }
}
assert.ok(goldenCases >= 10, 'golden cases: ' + goldenCases);
assert.ok(validationCases >= 8, 'validation cases: ' + validationCases);

// Slug and name stay unique, and no neighbouring record already answers the question.
for (const field of ['slug', 'name']) {
  const values = catalog.tools.map((tool) => String(tool[field]).toLowerCase());
  assert.equal(new Set(values).size, values.length, 'duplicate ' + field);
}
const rivals = ['guitar-cable-capacitance-calculator', 'pickup-resonance-calculator', 'tonearm-resonance-calculator'];
for (const rival of rivals) assert.ok(!catalog.tools.some((tool) => tool.slug === rival), 'competing record ' + rival);
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const text = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' ')].join(' ').toLowerCase();
  assert.ok(!text.includes('pickup resonance'), 'another record claims the pickup resonance');
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')),
  'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="pkr-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('type="button"'), 'reset needs an explicit type');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['in-inductance', 'in-winding', 'in-capacitance', 'in-length', 'in-load', 'err', 'out', 'warn', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const value of ['value="4"', 'value="5"', 'value="100"', 'value="250"']) {
  assert.ok(html.includes(value), 'default ' + value + ' missing from the markup');
}
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}

console.log('pickup cable resonance: ' + entry.testCases.length + ' catalog cases, '
  + compared + ' impedance-checked solutions, ' + swept + ' swept peaks and '
  + goldenCases + ' golden / ' + validationCases + ' validation replays passed');
