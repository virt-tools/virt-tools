/* HRV baseline calculator: the statistics contract, the page markup and the
   catalog record's sixteen cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hrv-baseline-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hrv-core:start */';
const endMarker = '/* hrv-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HrvCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

const SAMPLE = '62, 58, 65, 71, 55, 60, 68, 74, 59, 63, 70, 66, 61, 78';
const SAMPLE_VALUES = [62, 58, 65, 71, 55, 60, 68, 74, 59, 63, 70, 66, 61, 78];

// ---- Parsing: separators, ranges and the reading cap.
assert.deepEqual(Array.from(C.parseReadings(SAMPLE)), SAMPLE_VALUES);
assert.deepEqual(Array.from(C.parseReadings('62\n58; 65 71')), [62, 58, 65, 71]);
assert.deepEqual(Array.from(C.parseReadings('  41.5 ,44.25\n\n39.75 ')), [41.5, 44.25, 39.75]);
assert.deepEqual(Array.from(C.parseReadings('5 300 5')), [5, 300, 5]);
assert.equal(failure({ readings: '62, 58' }),
  'Enter at least 3 readings to get a standard deviation; 2 were given.');
assert.equal(failure({ readings: '62' }),
  'Enter at least 3 readings to get a standard deviation; 1 was given.');
assert.equal(failure({ readings: '   ' }),
  'Enter at least three nightly rMSSD readings, oldest first.');
assert.equal(failure({ readings: '4, 50, 60' }),
  'Each reading must be from 5 to 300 ms; "4" is outside that range.');
assert.equal(failure({ readings: '50, 60, 301' }),
  'Each reading must be from 5 to 300 ms; "301" is outside that range.');
assert.equal(failure({ readings: '50, -60, 70' }),
  '"-60" is not a reading in milliseconds. Use numbers separated by commas, spaces or new lines.');
assert.equal(failure({ readings: '50, sixty, 70' }),
  '"sixty" is not a reading in milliseconds. Use numbers separated by commas, spaces or new lines.');
assert.equal(failure({ readings: '50, 60.5.5, 70' }),
  '"60.5.5" is not a reading in milliseconds. Use numbers separated by commas, spaces or new lines.');
assert.equal(failure({ readings: Array(181).fill('50').join(' ') }),
  'Enter at most 180 readings; 181 were given.');
assert.equal(C.parseReadings(Array(180).fill('50').join(' ')).length, 180);

// ---- Windows.
assert.deepEqual(Array.from(C.WINDOWS), [7, 14, 28]);
assert.equal(C.parseWindow('7'), 7);
assert.equal(C.parseWindow(14), 14);
assert.equal(failure({ readings: SAMPLE, window: '5' }),
  'Choose a baseline window of 7, 14 or 28 readings.');
assert.equal(failure({ readings: SAMPLE, window: '' }),
  'Choose a baseline window of 7, 14 or 28 readings.');
assert.equal(failure({ readings: SAMPLE, window: 'abc' }),
  'Choose a baseline window of 7, 14 or 28 readings.');

// ---- The statistics themselves, against independently computed values.
near(C.meanOf([62, 58, 65, 71, 55, 60, 68]), 62.7142857, 1e-6, 'mean');
const mu = C.meanOf(SAMPLE_VALUES.slice(-7));
near(mu, 67.2857143, 1e-6, 'seven-night mean');
near(C.sampleSd(SAMPLE_VALUES.slice(-7), mu), 7.017, 1e-3, 'sample standard deviation');
near(C.sampleSd([40, 50, 60], 50), 10, 1e-9, 'the sample deviation uses n - 1');
near(C.sampleSd([50, 50, 50], 50), 0, 1e-12, 'a flat window has no spread');
near(C.cvPercent(50, 10), 20, 1e-12, 'coefficient of variation');
near(C.cvPercent(0, 0), 0, 1e-12, 'a zero mean does not divide');
near(C.slopePerReading([30, 40, 50, 60, 70], 50), 10, 1e-9, 'a linear ramp');
near(C.slopePerReading([57, 57, 57], 57), 0, 1e-12, 'a flat ramp');

// ---- The build contract on the default example.
const base = C.build({});
assert.equal(base.used, 7);
assert.equal(base.window, 7);
assert.equal(base.values.length, 14);
assert.equal(base.latest, 78);
near(base.mean, 67.29, 0.005, 'published mean');
near(base.sd, 7.02, 0.005, 'published spread');
near(base.cv, 10.43, 0.005, 'published CV');
near(base.delta, 10.71, 0.005, 'published change');
near(base.z, 1.53, 0.005, 'published z');
assert.equal(base.statusKind, 'warning');
assert.equal(base.statusText, 'Outside one standard deviation, above the baseline');
assert.equal(base.meanText, '67.3 ms');
assert.equal(base.sdText, '7.0 ms');
assert.equal(base.cvText, '10.4%');
assert.equal(base.deltaText, '+10.7 ms');
assert.equal(base.zText, '+1.53');
assert.equal(base.latestText, '78 ms');
assert.equal(base.trendText, '+0.68 ms per reading');
assert.equal(base.countText, '7 of 14 readings');
assert.equal(base.rows.length, 7);
assert.equal(base.rows.filter((row) => row.latest).length, 1);
assert.equal(base.rows[6].latest, true);
assert.equal(base.rows[6].valueText, '78 ms');
assert.equal(base.rows[6].zText, '+1.53');
assert.equal(base.rows[0].valueText, '74 ms');
assert.equal(base.warnings.length, 0, 'the default example needs no warning');
assert.ok(base.summary.includes('67.3 ms'));
assert.ok(base.summary.includes('z +1.53'));
assert.ok(base.explanation.length >= 6, 'the method is explained');
assert.ok(base.explanation[1].includes('arithmetic mean'));
assert.ok(base.explanation[4].includes('least-squares'));

// Every row's z follows from its own deviation.
for (const row of base.rows) {
  near(Number(row.zText), (row.value - base.mean) / base.sd, 0.02, 'row z-score');
}

// ---- Window selection keeps the most recent readings only.
const fourteen = C.build({ window: '14' });
assert.equal(fourteen.used, 14);
near(fourteen.mean, 65, 0.005, 'fourteen-night mean');
near(fourteen.sd, 6.56, 0.005, 'fourteen-night spread');
near(fourteen.z, 1.98, 0.005, 'fourteen-night z');
assert.equal(fourteen.statusKind, 'warning');
const all = C.build({ window: '28' });
assert.equal(all.used, 14, 'the window is capped by the readings given');
assert.equal(all.warnings.length, 1);
assert.ok(all.warnings[0].includes('28-reading window holds only 14'));

// ---- Status bands and their boundaries.
const bands = [
  ['40 50 60', 1, 'warning'],
  ['30 40 50 60 70', 1.26, 'warning'],
  ['50 50 50 50 50 50 100', 2.27, 'alert'],
  ['48, 55, 61, 52, 58, 63, 57, 49, 54, 60, 66, 59, 62, 51, 56, 64, 58, 53, 57, 61, 55, 60, 54, 58, 52, 63, 59, 57', -0.05, 'ok']
];
for (const [readings, z, kind] of bands) {
  const result = C.build({ readings, window: String(C.WINDOWS[C.WINDOWS.length - 1]) });
  near(result.z, z, 0.005, 'band z');
  assert.equal(result.statusKind, kind, 'band kind for z ' + z);
}
assert.equal(C.describe(10, 0.999, 'above').kind, 'ok');
assert.equal(C.describe(10, -0.999, 'below').kind, 'ok');
assert.equal(C.describe(10, 1, 'above').kind, 'warning');
assert.equal(C.describe(10, -1, 'below').kind, 'warning');
assert.equal(C.describe(10, 1.999, 'above').kind, 'warning');
assert.equal(C.describe(10, 2, 'above').kind, 'alert');
assert.equal(C.describe(10, -2, 'below').kind, 'alert');
assert.equal(C.describe(0, null, 'equal to').kind, 'flat');
assert.equal(C.describe(10, -1.5, 'below').text, 'Outside one standard deviation, below the baseline');

// ---- A flat window has no z-score and says so.
const flat = C.build({ readings: '50 50 50 50 50 50 50 50' });
assert.equal(flat.sd, 0);
assert.equal(flat.z, null);
assert.equal(flat.zText, '\u2014');
assert.equal(flat.statusText, 'No variation in this window');
assert.equal(flat.statusKind, 'flat');
assert.ok(flat.warnings.some((line) => line.includes('no spread')));
assert.ok(flat.rows.every((row) => row.zText === '\u2014'));

// ---- A short or spiky window warns without refusing to compute.
const short = C.build({ readings: '40 50 60' });
assert.equal(short.used, 3);
assert.equal(short.warnings.length, 2);
assert.ok(short.warnings[0].includes('7-reading window holds only 3'));
assert.ok(short.warnings[1].includes('fewer than seven'));
const spike = C.build({ readings: '50 50 50 50 50 50 100' });
assert.equal(spike.warnings.length, 1);
assert.ok(spike.warnings[0].includes('42.9 ms above'));
assert.ok(spike.warnings[0].includes('2.27 standard deviations'));

// ---- Formatting helpers.
assert.equal(C.fmtNum(67.2857, 1), '67.3');
assert.equal(C.fmtNum(0, 1), '0.0');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');
assert.equal(C.fmtSigned(10.71, 1), '+10.7');
assert.equal(C.fmtSigned(-0.214, 1), '-0.2');
assert.equal(C.fmtSigned(0, 1), '0.0');
assert.equal(C.fmtSigned(-0.001, 2), '0.00');
assert.equal(C.fmtZ(null), '\u2014');
assert.equal(C.fmtZ(-0.047), '-0.05');
assert.equal(C.fmtMs(7.0165, 1), '7.0 ms');
assert.equal(C.fmtPct(10.4335, 1), '10.4%');
assert.equal(C.fmtReading(78), '78 ms');
assert.equal(C.fmtReading(41.5), '41.5 ms');
assert.equal(C.directionOf(0), 'equal to');
assert.equal(C.directionOf(-2), 'below');
assert.equal(C.roundTo(67.2857, 2), 67.29);

// ---- Page markup: the documented contract.
for (const id of ['hrv-form', 'in-readings', 'in-window', 'calculate', 'example', 'reset',
  'status', 'error', 'summary', 'out-mean', 'out-sd', 'out-cv', 'out-latest', 'out-delta',
  'out-z', 'out-trend', 'chart', 'reading-body', 'table-caption', 'warnings', 'explanation']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
assert.ok(/<label for="in-readings">/.test(html), 'the readings box has a label');
assert.ok(/<label for="in-window">/.test(html), 'the window select has a label');
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('viewBox'), 'the chart sets an explicit viewBox');
assert.ok(/aria-label="rMSSD readings with the baseline mean/.test(html), 'the chart is described');
assert.ok(html.includes('<option value="7" selected>'));
assert.ok(html.includes('<option value="14">'));
assert.ok(html.includes('<option value="28">'));
assert.ok(html.includes('<textarea id="in-readings" name="readings" spellcheck="false"'));
assert.ok(html.includes('62, 58, 65, 71, 55, 60, 68, 74, 59, 63, 70, 66, 61, 78'),
  'the box starts with the documented example');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2257, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'HRV Baseline Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f493}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('n minus 1'), 'method states the sample denominator');
assert.ok(record.method.includes('coefficient of variation'), 'method defines the CV');
assert.ok(record.method.includes('no diagnosis'), 'method states the limits');
assert.ok(record.method.includes('5 to 300 ms'), 'method states the reading range');
assert.ok(record.method.includes('no uploads'), 'method states the privacy position');
assert.ok(record.sources.length >= 3, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 40), 'sources are described');
assert.ok(record.sources.every((source) => /^https:\/\/doi\.org\//.test(source.url || '')),
  'sources carry DOI links');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('rmssd'));

assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.used, expected.used, testCase.name + ' used');
  near(result.mean, expected.mean, 0.005, testCase.name + ' mean');
  near(result.sd, expected.sd, 0.005, testCase.name + ' sd');
  near(result.cv, expected.cv, 0.005, testCase.name + ' cv');
  near(result.slope, expected.slope, 0.005, testCase.name + ' slope');
  near(result.delta, expected.delta, 0.005, testCase.name + ' delta');
  if (expected.z === null) assert.equal(result.z, null, testCase.name + ' z');
  else near(result.z, expected.z, 0.005, testCase.name + ' z');
  assert.equal(result.statusText, expected.status, testCase.name + ' status');
}

// Slugs, names and aliases stay unique across the whole catalog.
const owners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!owners.has(folded)) owners.set(folded, new Set());
    owners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(owners.get(String(key).toLowerCase())), [slug],
    'catalog key is unique: ' + key);
}

// The page directory and the catalog must agree.
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', slug, 'index.html')));
assert.ok(fs.existsSync(path.join(root, 'frontend/assets/tool-meta', slug + '.json')),
  'generated metadata exists');

console.log('hrv_baseline_calculator: all checks passed');
