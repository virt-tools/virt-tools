/* RIAA equalization calculator: the published playback table, the transfer
   function's shape, the page contract and the catalog record's 24 cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'riaa-equalization-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* riaa-core:start */';
const endMarker = '/* riaa-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RiaaCore;', sandbox);
const C = sandbox.module.exports;

const round = (value, digits) => Number(value.toFixed(digits));

// ---- Published RIAA playback table, normalised to 1 kHz.
// Values in decibels from the standard replay characteristic; the model must
// agree to a tenth of a decibel at every published point.
const published = {
  20: 19.3, 30: 18.6, 40: 17.8, 50: 16.9, 60: 16.1, 80: 14.5, 100: 13.1,
  150: 10.3, 200: 8.2, 300: 5.5, 400: 3.8, 500: 2.6, 600: 1.8, 800: 0.7, 1000: 0
};
for (const [hz, expected] of Object.entries(published)) {
  const actual = C.playbackDb(Number(hz));
  assert.ok(Math.abs(actual - expected) <= 0.1, `${hz} Hz: ${actual.toFixed(2)} dB against ${expected} dB`);
}
assert.equal(round(C.playbackDb(1000), 3), 0, '1 kHz is the 0 dB reference');
assert.equal(round(C.playbackDb(10000), 2), -13.73, '10 kHz sits at -13.73 dB');
assert.equal(round(C.playbackDb(20000), 2), -19.62, '20 kHz sits at -19.62 dB');

// ---- Constants and formatting.
assert.equal(C.T1, 3180e-6);
assert.equal(C.T2, 318e-6);
assert.equal(C.T3, 75e-6);
assert.equal(round(C.CORNERS.low, 2), 50.05, '3180 us is 50.05 Hz');
assert.equal(round(C.CORNERS.mid, 2), 500.49, '318 us is 500.49 Hz');
assert.equal(round(C.CORNERS.high, 2), 2122.07, '75 us is 2122.07 Hz');
assert.equal(JSON.stringify(C.TABLE_HZ), JSON.stringify([20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]));
assert.equal(C.fmtDb(-0), '0.00 dB');
assert.equal(C.fmtDb(19.2734), '19.27 dB');
assert.equal(C.fmtRatio(1), '1.000x');
assert.equal(C.fmtRatio(9.1983), '9.198x');
assert.equal(C.fmtLevel(9198.3), '9.20 V');
assert.equal(C.fmtLevel(104.5), '104.5 mV');
assert.equal(C.fmtLevel(52.2), '52.2 mV');
assert.equal(C.fmtHz(1000), '1 kHz');
assert.equal(C.fmtHz(2122), '2.12 kHz');
assert.equal(C.fmtHz(20), '20 Hz');
assert.equal(C.fmtHz(1.5), '1.50 Hz');

// ---- Shape of the curve, checked without the published table.
const slope = (a, b) => (C.playbackDb(a) - C.playbackDb(b)) / Math.log2(b / a);
assert.ok(Math.abs(slope(20000, 80000) - 6.02) < 0.05, 'the treble slope is 6 dB per octave');
assert.ok(slope(100, 200) > 4, 'the bass rises towards low frequencies');
assert.ok(Math.abs(C.playbackDb(0.2) - C.playbackDb(1)) < 0.05, 'the bass shelf is flat below 20 Hz');
assert.ok(Math.abs(C.playbackDb(50000) - C.playbackDb(100000) - 6.02) < 0.05, 'the treble slope continues above 20 kHz');
for (const hz of [20, 50, 200, 2122, 20000]) {
  assert.ok(Math.abs(C.playbackDb(hz) + C.recordDb(hz)) < 1e-12, 'record is the exact inverse');
  assert.ok(Math.abs(C.ratio(hz) - Math.pow(10, C.playbackDb(hz) / 20)) < 1e-12, 'ratio matches the decibels');
}
let previous = Infinity;
for (let hz = 20; hz <= 20000; hz *= 1.05) {
  const value = C.playbackDb(hz);
  assert.ok(value < previous, 'the playback curve falls monotonically');
  previous = value;
}

// ---- Regions.
assert.equal(C.region(20).name, 'Bass shelf');
assert.equal(C.region(24.9).name, 'Bass shelf');
assert.equal(C.region(30).name, 'Bass transition');
assert.equal(C.region(499).name, 'Bass transition');
assert.equal(C.region(500).name, 'Mid band');
assert.equal(C.region(2121).name, 'Mid band');
assert.equal(C.region(2122).name, 'Treble roll-off');
assert.equal(C.region(20000).name, 'Treble roll-off');

// ---- The build contract.
const base = C.build({});
assert.equal(base.frequency, 1000);
assert.equal(base.playback, 0);
assert.equal(base.region, 'Mid band');
assert.equal(round(base.gainDb, 2), 46.02);
assert.equal(base.outputLowText, '9.20 V');
assert.equal(base.outputHighText, '104.5 mV');
assert.equal(base.rows.length, 11);
assert.equal(base.rows.filter((row) => row.active).length, 1);
assert.equal(base.rows[6].label, '1 kHz');
assert.equal(base.rows[6].active, true);
assert.ok(base.summary.includes('0.00 dB'));
assert.ok(base.summary.includes('46.02 dB'));
assert.ok(base.explanation.length >= 6, 'the method is explained');
assert.ok(base.explanation[0].includes('microseconds'));
assert.equal(base.warnings.length, 0, 'the defaults need no warning');
assert.ok(base.regionDetail.length > 0);

// ---- Warnings.
const loud = C.build({ frequency: '30', cartridge: '0.4', target: '15000' });
assert.equal(loud.warnings.length, 2, 'high gain and headroom are both flagged');
assert.ok(loud.warnings[0].includes('91.48 dB'));
assert.ok(loud.warnings[1].includes('9.2 times'));
const outside = C.build({ frequency: '100000' });
assert.equal(outside.warnings.length, 1);
assert.ok(outside.warnings[0].includes('extrapolates'));
assert.equal(C.build({ frequency: '20' }).warnings.length, 0, '20 Hz is inside the standard range');
assert.equal(C.build({ frequency: '20000' }).warnings.length, 0, '20 kHz is inside the standard range');
const quiet = C.build({ frequency: '1000', cartridge: '10', target: '200' });
assert.ok(quiet.warnings.some((line) => line.includes('is low for a magnetic cartridge')));

// ---- Validation messages.
const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};
assert.equal(failure({ frequency: '' }), 'Frequency is required.');
assert.equal(failure({ frequency: '1k' }), 'Frequency must be a number in Hz, such as 1000.');
assert.equal(failure({ frequency: '-5' }), 'Frequency must be a number in Hz, such as 1000.');
assert.equal(failure({ frequency: '0.5' }), 'Frequency must be from 1 to 100000 Hz.');
assert.equal(failure({ frequency: '100001' }), 'Frequency must be from 1 to 100000 Hz.');
assert.equal(failure({ cartridge: '' }), 'Cartridge output is required.');
assert.equal(failure({ cartridge: '0' }), 'Cartridge output must be from 0.05 to 20 mV.');
assert.equal(failure({ cartridge: '21' }), 'Cartridge output must be from 0.05 to 20 mV.');
assert.equal(failure({ target: '49' }), 'Target output must be from 50 to 20000 mV.');
assert.equal(failure({ target: 'five' }), 'Target output must be a number in mV, such as 1000.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2250, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'RIAA Equalization Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f4bf}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('3180'), 'method names the time constants');
assert.ok(record.method.includes('Neumann'), 'method excludes the unofficial pole');
assert.ok(record.method.includes('0.05 to 20 mV'), 'method states the cartridge range');
assert.ok(record.sources.length >= 4, 'sources are cited');
assert.equal(record.testCases.length, 24, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 18);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  assert.equal(round(result.playback, 2), expected.playbackDb, testCase.name + ' playback');
  assert.equal(round(result.record, 2), expected.recordDb + 0, testCase.name + ' record');
  assert.equal(round(result.ratio, 3), expected.ratio, testCase.name + ' ratio');
  assert.equal(result.region, expected.region, testCase.name + ' region');
  assert.equal(round(result.gainDb, 2), expected.gainDb, testCase.name + ' gain');
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
  assert.deepEqual(Array.from(owners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/\$\('([A-Za-z][A-Za-z0-9-]+)'\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 20, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['in-frequency', 'in-cartridge', 'in-target']) {
  assert.ok(html.includes('<label for="' + id + '"'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="img"/.test(html), 'the chart is described');
assert.ok(/aria-label="[^"]+"/.test(html), 'the chart has a label');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main class="tool-container">/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/\.table-wrap\{overflow-x:auto/.test(html) && /min-width:540px/.test(html), 'the table scrolls');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(|innerHTML/.test(html),
  'no network, storage, dynamic evaluation or raw HTML sinks');
const withoutSvgNamespace = html.split('http://www.w3.org/2000/svg').join('');
assert.ok(!/https?:\/\//.test(withoutSvgNamespace), 'no external URLs apart from the SVG namespace');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('riaa equalization: published table within 0.1 dB at 15 points, curve shape, validation, 24 catalog cases and the page contract pass');
