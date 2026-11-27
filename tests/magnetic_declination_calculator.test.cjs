/* Magnetic declination calculator: the WMM2025 field is checked against NOAA's
   published test rows, the epoch arithmetic is checked independently, catalog
   cases are replayed and the page's offline contract is asserted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'magnetic-declination-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* magnetic-declination-core:start */';
const endMarker = '/* magnetic-declination-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MagneticDeclinationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.compute(input));
const base = (overrides) => Object.assign({
  latitude: '51.5074', longitude: '-0.1278', elevationM: '0', date: '2026-11-27'
}, overrides);
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), label + ': not a number (' + actual + ')');
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' != ' + expected + ' (tolerance ' + tolerance + ')');
};

assert.equal(C.EPOCH, 2025);
assert.equal(C.NMAX, 12);
assert.equal(C.MIN_LAT, 89.999);
assert.equal(C.MIN_ELEVATION, -500);
assert.equal(C.MAX_ELEVATION, 850000);
assert.equal(C.MIN_YEAR, 2025);

// ---- The shipped coefficient block: 90 Gauss terms, n = 1..12, m = 0..n.
const coefficientBlock = html.slice(html.indexOf('var COF = "') + 11, html.indexOf('";', html.indexOf('var COF = "')));
const coefficientRows = coefficientBlock.split(';');
assert.equal(coefficientRows.length, 90, 'all 90 WMM2025 Gauss coefficients are present');
const seen = new Set();
for (const row of coefficientRows) {
  const [n, m, g, h] = row.split(',').map(Number);
  assert.ok(n >= 1 && n <= 12 && m >= 0 && m <= n, 'coefficient degree and order: ' + row);
  assert.ok(Number.isFinite(g) && Number.isFinite(h), 'coefficient values: ' + row);
  seen.add(n + ',' + m);
}
assert.equal(seen.size, 90, 'no duplicate coefficient');
assert.ok(coefficientBlock.includes('1,0,-29351.8,0.0,12.0,0.0'), 'the leading g(1,0) term is the published one');

// ---- NOAA's published WMM2025 test values, replayed to their printed precision.
// date, height (km), lat, lon, D, I, H, F, X, Y, Z. The 2027.5 rows are dated the
// nearest calendar day, so their intensities carry a fraction of a nanotesla.
const noaaRows = [
  ['2025-01-01', 0, 80, 0, 1.28, 83.21, 6523.2, 55178.5, 6521.6, 145.9, 54791.5, 0.06],
  ['2025-01-01', 0, 0, 120, -0.16, -14.93, 39677.9, 41064.3, 39677.8, -109.6, -10580.2, 0.06],
  ['2025-01-01', 0, -80, 240, 68.78, -72.00, 16898.1, 54698.2, 6117.5, 15751.9, -52022.5, 0.06],
  ['2025-01-01', 100, 80, 0, 0.85, 83.26, 6216.7, 52964.9, 6216.0, 92.4, 52598.8, 0.06],
  ['2025-01-01', 100, 0, 120, -0.15, -15.08, 37688.7, 39032.1, 37688.6, -96.2, -10152.1, 0.06],
  ['2025-01-01', 100, -80, 240, 68.21, -72.19, 15917.1, 52035.0, 5907.6, 14780.3, -49540.7, 0.06],
  ['2027-07-02', 0, 80, 0, 2.59, 83.24, 6507.5, 55253.9, 6500.8, 294.5, 54869.4, 0.6],
  ['2027-07-02', 0, 0, 120, -0.24, -14.65, 39702.0, 41036.9, 39701.6, -167.3, -10381.8, 0.6],
  ['2027-07-02', 0, -80, 240, 68.49, -71.92, 16908.3, 54474.2, 6200.7, 15730.3, -51783.7, 0.6],
  ['2027-07-02', 100, 80, 0, 2.16, 83.29, 6201.1, 53034.3, 6196.7, 233.8, 52670.5, 0.6],
  ['2027-07-02', 100, 0, 120, -0.23, -14.81, 37711.8, 39007.4, 37711.5, -148.7, -9969.8, 0.6],
  ['2027-07-02', 100, -80, 240, 67.93, -72.10, 15927.0, 51825.7, 5984.0, 14760.2, -49317.8, 0.6]
];
for (const [date, km, lat, lon, D, I, H, F, X, Y, Z, tolerance] of noaaRows) {
  const r = run(base({ latitude: String(lat), longitude: String(lon), elevationM: String(km * 1000), date }));
  const tag = 'NOAA ' + date + ' ' + km + ' km ' + lat + '/' + lon;
  near(r.declinationDeg, D, tolerance === 0.6 ? 0.02 : 0.01, tag + ' declination');
  near(r.inclinationDeg, I, tolerance === 0.6 ? 0.02 : 0.01, tag + ' inclination');
  near(r.horizontalNt, H, tolerance, tag + ' horizontal intensity');
  near(r.totalNt, F, tolerance * 2, tag + ' total intensity');
  near(r.northNt, X, tolerance, tag + ' X');
  near(r.eastNt, Y, tolerance, tag + ' Y');
  near(r.downNt, Z, tolerance, tag + ' Z');
}

// ---- The published declination rate column, compared with a one-year difference.
const noaaRates = [
  ['2025-01-01', 0, 80, 0, 0.52],
  ['2025-01-01', 0, 0, 120, -0.03],
  ['2025-01-01', 0, -80, 240, -0.12],
  ['2025-01-01', 100, 80, 0, 0.52],
  ['2025-01-01', 100, 0, 120, -0.03],
  ['2025-01-01', 100, -80, 240, -0.12]
];
for (const [date, km, lat, lon, rate] of noaaRates) {
  const r = run(base({ latitude: String(lat), longitude: String(lon), elevationM: String(km * 1000), date }));
  near(r.annualChangeDeg, rate, 0.01, 'published declination rate at ' + km + ' km ' + lat + '/' + lon);
}

// ---- The date is a decimal year: elapsed days over the length of that year.
near(run(base({ date: '2025-01-01' })).decimalYear, 2025.0, 1e-12, '1 January is the epoch');
near(run(base({ date: '2025-12-31' })).decimalYear, 2025 + 364 / 365, 1e-12, 'the last day of a common year');
near(run(base({ date: '2028-07-02' })).decimalYear, 2028.5, 1e-12, 'midday of a leap year is the half-year');
near(run(base({ date: '2028-12-31' })).decimalYear, 2028 + 365 / 366, 1e-12, 'the last day of a leap year');
assert.equal(run(base({ date: '2025-01-01' })).date, '2025-01-01');

// ---- The vector is consistent with its own components.
for (const input of [
  base({}),
  base({ latitude: '-80', longitude: '240', date: '2025-01-01' }),
  base({ latitude: '89.9', longitude: '0', elevationM: '4000' })
]) {
  const r = run(input);
  near(Math.hypot(r.northNt, r.eastNt, r.downNt), r.totalNt, 1e-9, 'F is the quadrature sum of X, Y and Z');
  near(Math.hypot(r.northNt, r.eastNt), r.horizontalNt, 1e-9, 'H is the quadrature sum of X and Y');
  near(Math.atan2(r.eastNt, r.northNt) * 180 / Math.PI, r.declinationDeg, 1e-12, 'declination is atan2(Y, X)');
  near(r.declinationDeg, r.declinationDeg, 0, 'declination is finite');
  assert.ok(r.inclinationDeg > -91 && r.inclinationDeg < 91, 'inclination stays in range');
}

// ---- Hemisphere suffixes, signs, the degree symbol and 0-360 longitudes agree.
const sameSpot = (a, b, label) => {
  const left = run(base(a));
  const right = run(base(b));
  near(left.declinationDeg, right.declinationDeg, 1e-9, label + ' declination');
  near(left.horizontalNt, right.horizontalNt, 1e-9, label + ' horizontal intensity');
};
sameSpot({ latitude: '51.5074 N', longitude: '0.1278 W' }, { latitude: '51.5074', longitude: '-0.1278' }, 'N/W suffixes');
sameSpot({ latitude: 'N51.5074', longitude: 'W0.1278' }, { latitude: '51.5074', longitude: '-0.1278' }, 'leading letters');
sameSpot({ latitude: '51.5074n', longitude: '0.1278w' }, { latitude: '51.5074', longitude: '-0.1278' }, 'lowercase letters');
sameSpot({ latitude: '51.5074\u00b0', longitude: '\u22120.1278\u00b0' }, base({}), 'degree symbols');
sameSpot({ latitude: '-33.8688', longitude: '151.2093' }, { latitude: '33.8688 S', longitude: '151.2093 E' }, 'southern hemisphere');
sameSpot({ latitude: '10', longitude: '240' }, { latitude: '10', longitude: '-120' }, 'longitude past 180 degrees');
sameSpot({ latitude: '10', longitude: '180' }, { latitude: '10', longitude: '-180' }, 'the antimeridian');
near(run(base({ elevationM: '1,500' })).elevationM, 1500, 1e-9, 'a grouped elevation is accepted');

// ---- Declination rises with altitude and is continuous across the poles of longitude.
const low = run(base({ latitude: '45', longitude: '10', elevationM: '0' }));
const hill = run(base({ latitude: '45', longitude: '10', elevationM: '9000' }));
const high = run(base({ latitude: '45', longitude: '10', elevationM: '850000' }));
assert.ok(high.horizontalNt < low.horizontalNt, 'intensity falls with height');
assert.ok(Math.abs(hill.declinationDeg - low.declinationDeg) < 0.05, 'a mountain-top height barely moves declination');
assert.ok(Math.abs(high.declinationDeg - low.declinationDeg) > 1, '850 km is a different regime, as the model expects');
assert.ok(Math.abs(run(base({ latitude: '10', longitude: '-180' })).declinationDeg
  - run(base({ latitude: '10', longitude: '180' })).declinationDeg) < 1e-9, 'longitude 180 and -180 agree');

// ---- Refusals, by exact message.
assert.equal(failure(base({ latitude: '' })), 'Enter a latitude in decimal degrees.');
assert.equal(failure(base({ latitude: 'fifty' })),
  'Enter the latitude as a decimal number with at most six decimals, for example 51.5074 or 51.5074 N.');
assert.equal(failure(base({ latitude: '90' })),
  'Enter a latitude from 89.999\u00b0 S to 89.999\u00b0 N; declination is undefined at the poles.');
assert.equal(failure(base({ latitude: '-90' })),
  'Enter a latitude from 89.999\u00b0 S to 89.999\u00b0 N; declination is undefined at the poles.');
assert.equal(failure(base({ latitude: '51.5 E' })), 'Use N or S to give the latitude hemisphere.');
assert.equal(failure(base({ latitude: '-51.5 S' })),
  'Give the latitude either with a sign or with an N or S suffix, not both.');
assert.equal(failure(base({ longitude: '' })), 'Enter a longitude in decimal degrees.');
assert.equal(failure(base({ longitude: '51.5 S' })), 'Use E or W to give the longitude hemisphere.');
assert.equal(failure(base({ longitude: '361' })),
  'Enter a longitude from 180\u00b0 W to 180\u00b0 E, or 0\u00b0 to 360\u00b0 east.');
assert.equal(failure(base({ longitude: '1e3' })),
  'Enter the longitude as a decimal number with at most six decimals, for example -0.1278 or 0.1278 W.');
assert.equal(failure(base({ elevationM: '' })), 'Enter the elevation in metres, or 0 for sea level.');
assert.equal(failure(base({ elevationM: 'high' })), 'Enter the elevation as a number of metres.');
assert.equal(failure(base({ elevationM: '-501' })), 'Enter an elevation from -500 to 850,000 metres (850 km).');
assert.equal(failure(base({ elevationM: '850001' })), 'Enter an elevation from -500 to 850,000 metres (850 km).');
assert.equal(failure(base({ date: '' })), 'Enter a date, for example 2026-11-27.');
assert.equal(failure(base({ date: '2026-13-01' })), 'Enter a real calendar date, for example 2026-11-27.');
assert.equal(failure(base({ date: '27/11/2026' })), 'Enter a date as YYYY-MM-DD, for example 2026-11-27.');
assert.equal(failure(base({ date: '2024-12-31' })),
  'The model covers 2025 to 2029; enter a date from 1 January 2025 to 31 December 2029.');
assert.equal(failure(base({ date: '2030-01-01' })),
  'The model covers 2025 to 2029; enter a date from 1 January 2025 to 31 December 2029.');

// ---- Catalog replay, at the precision each expectation is published to.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Magnetic Declination Calculator');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Navigation');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.sources.length, 3, 'the model, its test values and the report are cited');
assert.equal(entry.sources[0].url, 'https://www.ncei.noaa.gov/products/world-magnetic-model');
assert.equal(entry.sources[1].url, 'https://www.ncei.noaa.gov/sites/default/files/2025-02/WMM2025_TEST_VALUES.txt');
assert.equal(entry.sources[2].url, 'https://doi.org/10.25923/prbc-s316');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 40, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 1500, 'the method explains the synthesis and its limits');
assert.ok(entry.guidance && entry.guidance.length > 200 && entry.guidance.length < 500, 'the guidance fits the banner');
assert.ok(entry.testCases.length >= 30, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 8);
assert.equal(kinds('boundary'), 6);
assert.equal(kinds('validation'), 19);

const closeEnough = (actual, expected, label) => {
  if (typeof expected !== 'number') {
    assert.deepEqual(actual, expected, label);
    return;
  }
  const decimals = (String(expected).split('.')[1] || '').length;
  const tolerance = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(expected));
  near(actual, expected, tolerance, label);
};
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    closeEnough(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- Uniqueness: no other record claims this slug, name, alias or capability.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['navigation', 'magnetic-declination', 'wmm', 'compass']) {
  assert.ok(entry.tags.includes(tag), 'tag present: ' + tag);
}
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/magnetic declination|magnetic variation|\bwmm\b|geomagnetic|compass declination/.test(haystack),
    'no duplicate geomagnetic record: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(html.includes('<form id="declination-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
assert.ok(html.includes('<meta name="viewport"'), 'viewport meta missing');
const controls = [
  ['latitude', 'value="51.5074"'],
  ['longitude', 'value="-0.1278"'],
  ['elevation', 'value="0"'],
  ['date', 'value="2026-11-27"']
];
for (const [id, needle] of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
  assert.ok(html.includes(needle), 'default for ' + id + ' missing: ' + needle);
}
assert.ok(html.includes('min="2025-01-01"') && html.includes('max="2029-12-31"'), 'date bounds');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 2, 'two buttons');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
assert.ok(html.includes('World Magnetic Model 2025'), 'the note names the model');
assert.ok(html.includes('no compass correction is needed'), 'the page covers the zero-declination case');
assert.ok(html.includes('No network request is made'), 'the note states the offline contract');

console.log('magnetic declination calculator: ' + entry.testCases.length + ' catalog cases, '
  + noaaRows.length + ' NOAA rows, ' + coefficientRows.length + ' coefficients');
