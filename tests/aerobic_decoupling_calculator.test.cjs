/* Aerobic decoupling calculator: duration and distance parsing, the efficiency
   factor chain, decoupling sign and band edges, unit conversion, validation,
   catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'aerobic-decoupling-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* aerobic-decoupling-core:start */';
const endMarker = '/* aerobic-decoupling-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AerobicDecouplingCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (t1, d1, h1, t2, d2, h2, unit) => plain(C.compute(t1, d1, h1, t2, d2, h2, unit));
const failure = (t1, d1, h1, t2, d2, h2, unit) => {
  try { run(t1, d1, h1, t2, d2, h2, unit); } catch (error) { return error.message; }
  return null;
};
const rows = (result) => new Map(result.rows.map((row) => [row.k, row.v]));
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    (label || 'value') + ': ' + actual + ' vs ' + expected);
};

// ---- Exported contract.
assert.equal(C.METRES_PER_KM, 1000);
assert.equal(C.METRES_PER_MILE, 1609.344);
assert.equal(C.MIN_SECONDS, 60);
assert.equal(C.MAX_SECONDS, 36000);
assert.equal(C.MIN_DISTANCE, 0.1);
assert.equal(C.MAX_DISTANCE, 1000);
assert.equal(C.MIN_HR, 40);
assert.equal(C.MAX_HR, 250);
assert.equal(C.COUPLED_BAND, 5);
assert.equal(C.MODERATE_BAND, 10);
assert.equal(C.UNITS.length, 2);
assert.equal(C.unitById('km').metres, 1000);
assert.equal(C.unitById('mi').metres, 1609.344);
assert.equal(C.unitById('m'), null);
assert.deepEqual(plain(C.DEFAULTS), {
  unit: 'km', time1: '20:00', dist1: '5.00', hr1: '150', time2: '20:00', dist2: '4.95', hr2: '153'
});

// ---- Duration parsing and formatting.
assert.equal(C.parseDuration('20:00', 'empty', 'range'), 1200);
assert.equal(C.parseDuration('1:00', 'empty', 'range'), 60, 'one minute is the minimum');
assert.equal(C.parseDuration('1:05:00', 'empty', 'range'), 3900);
assert.equal(C.parseDuration('600:00', 'empty', 'range'), 36000, 'ten hours is accepted');
assert.equal(C.parseDuration(' 20:00 ', 'empty', 'range'), 1200, 'stray spaces are trimmed');
assert.throws(() => C.parseDuration('', 'empty', 'range'), /empty/);
assert.throws(() => C.parseDuration('20.00', 'empty', 'range'), /empty/);
assert.throws(() => C.parseDuration('20', 'empty', 'range'), /empty/);
assert.throws(() => C.parseDuration('20:75', 'empty', 'range'), /empty/, 'seconds above 59 are a format error');
assert.throws(() => C.parseDuration('1:75:00', 'empty', 'range'), /empty/, 'minutes above 59 are a format error');
assert.throws(() => C.parseDuration('0:59', 'empty', 'range'), /range/, 'under a minute is a range error');
assert.throws(() => C.parseDuration('601:00', 'empty', 'range'), /range/);
assert.equal(C.formatDuration(1200), '20:00');
assert.equal(C.formatDuration(3900), '1:05:00');
assert.equal(C.formatDuration(36000), '10:00:00');
assert.equal(C.formatDuration(59), '0:59');
assert.equal(C.formatPace(240), '4:00');
assert.equal(C.formatPace(242), '4:02');
assert.equal(C.formatPace(667), '11:07');
assert.equal(C.formatPace(3900), '1:05:00');

// ---- Distance and heart-rate parsing.
assert.equal(C.parseDistance('5.00', C.unitById('km'), 'empty', 'range'), 5);
assert.equal(C.parseDistance('1,000', C.unitById('km'), 'empty', 'range'), 1000, 'separators are ignored');
assert.equal(C.parseDistance('0.1', C.unitById('km'), 'empty', 'range'), 0.1);
assert.throws(() => C.parseDistance('0', C.unitById('km'), 'empty', 'range'), /range/);
assert.throws(() => C.parseDistance('1001', C.unitById('km'), 'empty', 'range'), /range/);
assert.throws(() => C.parseDistance('five', C.unitById('km'), 'empty', 'range'), /empty/);
assert.equal(C.parseHeartRate('150', 'empty', 'range'), 150);
assert.equal(C.parseHeartRate(' 40 ', 'empty', 'range'), 40);
assert.equal(C.parseHeartRate('250', 'empty', 'range'), 250);
assert.throws(() => C.parseHeartRate('39', 'empty', 'range'), /range/);
assert.throws(() => C.parseHeartRate('251', 'empty', 'range'), /range/);
assert.throws(() => C.parseHeartRate('150.5', 'empty', 'range'), /empty/);

// ---- The default case: 5.00 km in 20:00 at 150 bpm, then 4.95 km at 153 bpm.
let result = run('20:00', '5.00', '150', '20:00', '4.95', '153', 'km');
near(result.speed1, 250, 1e-9, 'first-half speed is 250 m/min');
near(result.speed2, 247.5, 1e-9, 'second-half speed is 247.5 m/min');
near(result.ef1, 250 / 150, 1e-12, 'efficiency factor is speed over heart rate');
near(result.ef2, 247.5 / 153, 1e-12, 'second-half efficiency factor');
near(result.decoupling, (250 / 150 - 247.5 / 153) / (250 / 150) * 100, 1e-12, 'decoupling formula');
near(result.decoupling, 2.941176470588238, 1e-9, 'default decoupling');
near(result.speedChange, -1, 1e-12);
near(result.hrChangePercent, 2, 1e-12);
assert.equal(result.band, 'coupled');
assert.equal(result.headline, '+2.9%');
assert.equal(result.subText, 'EF 1.667 \u2192 1.618 \u00b7 20:00 and 20:00 \u00b7 150 \u2192 153 bpm');
assert.equal(result.pace1, 240);
assert.equal(result.pace2, 242);
const defaultRows = rows(result);
assert.equal(defaultRows.get('First-half pace'), '4:00 /km');
assert.equal(defaultRows.get('Second-half pace'), '4:02 /km');
assert.equal(defaultRows.get('First-half efficiency factor'), '1.667 m/min per bpm');
assert.equal(defaultRows.get('Second-half efficiency factor'), '1.618 m/min per bpm');
assert.equal(defaultRows.get('Heart-rate change'), '+3 bpm (+2.0%)');
assert.equal(defaultRows.get('Speed change'), '-1.0%');
assert.equal(defaultRows.get('Decoupling'), '+2.9%');
assert.equal(defaultRows.get('Aerobic durability'), 'Coupled \u2014 within the 5% guideline');
assert.ok(result.summary.includes('5.00 and 4.95 km'), 'summary names both distances');
assert.ok(result.summary.includes('1.667 \u2192 1.618'), 'summary states both factors');

// ---- No drift is zero, and the same inputs twice agree.
const flat = run('40:00', '10.00', '140', '40:00', '10.00', '140', 'km');
assert.equal(flat.headline, '0.0%');
assert.equal(flat.decoupling, 0);
assert.equal(flat.hrChange, 0);
assert.equal(rows(flat).get('Heart-rate change'), '0 bpm (0.0%)');
assert.equal(rows(flat).get('Speed change'), '0.0%');
assert.deepEqual(run('20:00', '5.00', '150', '20:00', '4.95', '153', 'km'), result);

// ---- Sign conventions: drifting heart rate is positive, a fading one negative.
const drift = run('30:00', '8.00', '150', '30:00', '7.60', '158', 'km');
assert.ok(drift.decoupling > 0 && drift.hrChange > 0, 'heart rate rose, output fell');
assert.equal(drift.headline, '+9.8%');
assert.equal(drift.band, 'moderate');
assert.equal(rows(drift).get('Heart-rate change'), '+8 bpm (+5.3%)');
assert.equal(rows(drift).get('Speed change'), '-5.0%');
const negative = run('25:00', '4.00', '160', '25:00', '4.12', '156', 'mi');
assert.ok(negative.decoupling < 0 && negative.hrChange < 0, 'heart rate fell, output rose');
assert.equal(negative.headline, '-5.6%');
assert.equal(negative.band, 'moderate-negative');
assert.equal(rows(negative).get('Aerobic durability'), 'Negative drift \u2014 above 5%, under 10%');
assert.equal(rows(negative).get('Heart-rate change'), '-4 bpm (-2.5%)');

// ---- Band edges are inclusive on the lower side.
assert.equal(run('30:00', '10.00', '150', '30:00', '9.50', '150', 'km').band, 'coupled');
assert.equal(run('30:00', '10.00', '150', '30:00', '9.50', '150', 'km').headline, '+5.0%');
assert.equal(run('30:00', '10.00', '150', '30:00', '9.49', '150', 'km').band, 'moderate');
assert.equal(run('30:00', '10.00', '150', '30:00', '9.00', '150', 'km').band, 'moderate');
assert.equal(run('30:00', '10.00', '150', '30:00', '9.00', '150', 'km').headline, '+10.0%');
assert.equal(run('30:00', '10.00', '150', '30:00', '8.99', '150', 'km').band, 'high');
assert.equal(run('30:00', '10.00', '150', '30:00', '8.99', '150', 'km').headline, '+10.1%');
assert.equal(C.bandOf(4.99), 'coupled');
assert.equal(C.bandOf(5), 'coupled');
assert.equal(C.bandOf(5.01), 'moderate');
assert.equal(C.bandOf(10), 'moderate');
assert.equal(C.bandOf(10.01), 'high');
assert.equal(C.bandOf(-5.01), 'moderate-negative');
assert.equal(C.bandOf(-10.01), 'high-negative');
assert.equal(C.bandText('coupled'), 'Coupled \u2014 within the 5% guideline');
assert.equal(C.bandText('high'), 'High drift \u2014 above 10%');
assert.equal(C.bandText('high-negative'), 'High negative drift \u2014 above 10%');

// ---- Sign helpers.
assert.equal(C.signedPercent(2.94), '+2.9%');
assert.equal(C.signedPercent(-2.94), '-2.9%');
assert.equal(C.signedPercent(0), '0.0%');
assert.equal(C.signedPercent(-0.04), '0.0%', 'a value that rounds to zero carries no sign');
assert.equal(C.signedNumber(3, ' bpm'), '+3 bpm');
assert.equal(C.signedNumber(-4, ' bpm'), '-4 bpm');
assert.equal(C.signedNumber(0, ' bpm'), '0 bpm');

// ---- Unit conversion: the same session in miles keeps its efficiency factor.
const kmCase = run('30:00', '8.04672', '150', '30:00', '7.644384', '158', 'km');
const miCase = run('30:00', '5.00', '150', '30:00', '4.75', '158', 'mi');
near(miCase.ef1, kmCase.ef1, 1e-9, 'miles and kilometres give the same efficiency factor');
near(miCase.decoupling, kmCase.decoupling, 1e-9, 'miles and kilometres give the same decoupling');
assert.ok(rows(miCase).get('First-half pace').endsWith('/mi'), 'pace is labelled in miles');
assert.equal(rows(miCase).get('First-half pace'), '6:00 /mi', 'pace converts to minutes per mile');
assert.equal(miCase.metres1, 5 * 1609.344);

// ---- Scaling: a slower second half at the same heart rate decouples exactly as much.
near(run('30:00', '10.00', '150', '30:00', '9.50', '150', 'km').decoupling, 5, 1e-12);
near(run('30:00', '10.00', '150', '30:00', '9.00', '150', 'km').decoupling, 10, 1e-12);
near(run('60:00', '20.00', '150', '60:00', '19.00', '150', 'km').decoupling, 5, 1e-12,
  'doubling the duration does not change the ratio');

// ---- Validation messages.
assert.equal(failure('', '5.00', '150', '20:00', '4.95', '153', 'km'),
  "Enter the first half's time as MM:SS.");
assert.equal(failure('20.00', '5.00', '150', '20:00', '4.95', '153', 'km'),
  "Enter the first half's time as MM:SS.");
assert.equal(failure('0:30', '5.00', '150', '20:00', '4.95', '153', 'km'),
  'First-half time must be between 1:00 and 10:00:00.');
assert.equal(failure('601:00', '5.00', '150', '20:00', '4.95', '153', 'km'),
  'First-half time must be between 1:00 and 10:00:00.');
assert.equal(failure('20:75', '5.00', '150', '20:00', '4.95', '153', 'km'),
  "Enter the first half's time as MM:SS.");
assert.equal(failure('20:00', '0', '150', '20:00', '4.95', '153', 'km'),
  'First-half distance must be between 0.1 and 1,000 km.');
assert.equal(failure('20:00', '1001', '150', '20:00', '4.95', '153', 'km'),
  'First-half distance must be between 0.1 and 1,000 km.');
assert.equal(failure('20:00', '', '150', '20:00', '4.95', '153', 'km'),
  "Enter the first half's distance.");
assert.equal(failure('20:00', '5.00', '39', '20:00', '4.95', '153', 'km'),
  'First-half average heart rate must be between 40 and 250 bpm.');
assert.equal(failure('20:00', '5.00', '150', '20:00', '4.95', '251', 'km'),
  'Second-half average heart rate must be between 40 and 250 bpm.');
assert.equal(failure('20:00', '5.00', '150', '20:00', '', '153', 'km'),
  "Enter the second half's distance.");
assert.equal(failure('20:00', '5.00', '150', '20:00', '4.95', '153', 'm'),
  'Choose a distance unit from the list.');
assert.equal(failure('20:00', '5.00', '150', '', '4.95', '153', 'km'),
  "Enter the second half's time as MM:SS.");
assert.equal(run('1:00', '0.20', '55', '1:00', '0.19', '60', 'km').seconds1, 60, 'the shortest half is accepted');
assert.equal(run('600:00', '250.00', '120', '600:00', '240.00', '125', 'km').seconds2, 36000,
  'the longest half is accepted');
assert.equal(run('20:00', '5.00', '150', '20:00', '4.95', '153', 'mi').unitLabel, 'mi');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2265, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Aerobic Decoupling Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1fac0}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('metres per minute per beat'), 'method states the efficiency factor units');
assert.ok(record.method.includes('1,609.344'), 'method states the mile conversion');
assert.ok(record.method.includes('40 and 250 bpm'), 'method states the heart-rate limits');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 25, 'catalog case count');
assert.equal(kinds('golden'), 13, 'thirteen golden cases');
assert.equal(kinds('validation'), 12, 'twelve validation cases');
const FIELDS = ['speed1', 'speed2', 'ef1', 'ef2', 'decoupling', 'speedChange', 'hrChangePercent', 'pace1', 'pace2'];
for (const testCase of record.testCases) {
  const i = testCase.input;
  const args = [i.time1, i.distance1, i.heartRate1, i.time2, i.distance2, i.heartRate2, i.unit];
  if (testCase.kind === 'validation') {
    assert.equal(failure(...args), testCase.expected.error, testCase.name);
    continue;
  }
  const actual = run(...args);
  const expected = testCase.expected;
  for (const field of FIELDS) near(actual[field], expected[field], 1e-5 * Math.max(1, Math.abs(expected[field])),
    testCase.name + ' ' + field);
  assert.equal(actual.hrChange, expected.hrChange, testCase.name + ' heart-rate change');
  assert.equal(actual.band, expected.band, testCase.name + ' band');
  assert.equal(actual.headline, expected.headline, testCase.name + ' headline');
  assert.equal(actual.summary, expected.summary, testCase.name + ' summary');
  assert.deepEqual(plain(actual.rows), expected.rows, testCase.name + ' rows');
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['aerobic', 'decoupling', 'efficiency-factor', 'heart-rate']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['time1', 'dist1', 'hr1', 'time2', 'dist2', 'hr2', 'unit']) {
  assert.ok(html.includes('<label for="' + id + '">'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'decimal keyboards on touch');
assert.ok(/inputmode="numeric"/.test(html), 'numeric keyboards on touch');
assert.equal((html.match(/<input /g) || []).length, 6, 'six text inputs');
assert.equal((html.match(/<select /g) || []).length, 1, 'one select');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('aerobic decoupling calculator: parsing, efficiency factors, band edges, 25 catalog cases and the page contract pass');
