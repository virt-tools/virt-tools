/* GNSS dilution-of-precision checks: the page core against an analytic
   symmetric sky and a 50-digit adjugate oracle, the catalog replay, the
   validation messages, and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gnss-dop-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gnss-dop-core:start */';
const endMarker = '/* gnss-dop-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'gnss dop core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GnssDopCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.build({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(C.FIELDS), ['satellites', 'mask', 'uere']);
assert.deepEqual(plain(C.DEFAULTS), {
  satellites: '10, 70\n100, 20\n175, 50\n250, 30\n330, 60', mask: 10, uere: 5,
});
assert.equal(C.MAX_SATELLITES, 64);
assert.equal(C.MIN_SATELLITES, 4);
assert.deepEqual(plain(C.QUALITY_LEVELS).map((level) => level.label),
  ['Ideal', 'Excellent', 'Good', 'Moderate', 'Poor']);
assert.equal(C.qualityFor(2).label, 'Ideal');
assert.equal(C.qualityFor(2.0001).label, 'Excellent');
assert.equal(C.qualityFor(5).label, 'Excellent');
assert.equal(C.qualityFor(10).label, 'Good');
assert.equal(C.qualityFor(20).label, 'Moderate');
assert.equal(C.qualityFor(20.5).label, 'Poor');

// ---- Published default: five satellites, excellent geometry, four decimals.
const published = run({});
assert.equal(published.pdop, 2.8532);
assert.equal(published.gdop, 3.3423);
assert.equal(published.hdop, 1.5419);
assert.equal(published.vdop, 2.4007);
assert.equal(published.tdop, 1.7408);
assert.equal(published.quality, 'Excellent');
assert.equal(published.usedCount, 5);
assert.equal(published.excludedCount, 0);
assert.equal(published.warningCount, 0);
assert.deepEqual(published.warnings, []);
assert.equal(published.summary, 'Excellent geometry: PDOP 2.85 from 5 of 5 satellites.');
assert.equal(published.horizontalAccuracy, 7.71);
assert.equal(published.verticalAccuracy, 12);
assert.ok(published.explanation.length >= 4);

// ---- An analytic sky: one satellite at the zenith and three on the horizon at
// 120 degree spacing make the normal matrix have a 1.5, 1.5, 1, 4 diagonal with
// a single -1 coupling between height and the clock, so every DOP is exact.
const symmetric = run({ satellites: '90, 90\n0, 0\n120, 0\n240, 0', mask: 0 });
assert.equal(symmetric.pdop, 1.633);
assert.equal(symmetric.gdop, 1.7321);
assert.equal(symmetric.hdop, 1.1547);
assert.equal(symmetric.vdop, 1.1547);
assert.equal(symmetric.tdop, 0.5774);
assert.equal(symmetric.quality, 'Ideal');
// Equal elevations on every satellite make height and the clock indistinguishable,
// which is a genuine degeneracy rather than a numeric accident.
assert.match(failure({ satellites: '0, 45\n90, 45\n180, 45\n270, 45' }), /geometrically dependent/);

// ---- The DOP identities hold for every geometry in the catalog.
// Values are rounded to four decimals before they leave the core, so the
// identity is checked with a relative tolerance that grows with magnitude.
const close = (a, b) => assert.ok(Math.abs(a - b) <= 5e-4 + 1e-4 * Math.abs(b), `${a} != ${b}`);
for (const input of [{}, { satellites: '15, 60\n75, 25\n140, 40\n200, 70\n265, 35\n320, 15' },
  { satellites: '20, 12\n110, 14\n200, 13\n290, 15' }, { satellites: '40, 55\n55, 50\n70, 60\n85, 45' }]) {
  const result = run(input);
  close(result.gdop * result.gdop, result.pdop * result.pdop + result.tdop * result.tdop);
  close(result.pdop * result.pdop, result.hdop * result.hdop + result.vdop * result.vdop);
  assert.ok(result.pdop >= result.hdop && result.vdop >= 0 && result.tdop >= 0);
}

// ---- Masking, scaling and quality bands.
const masked = run({ satellites: '15, 60\n75, 5\n140, 40\n200, 70\n265, 35\n320, 15', mask: 10 });
assert.equal(masked.usedCount, 5);
assert.equal(masked.excludedCount, 1);
assert.match(masked.explanation[0], /Using 5 of 6 satellites.*1 below the mask is ignored/);
assert.equal(run({ uere: 20 }).pdop, published.pdop, 'DOP is independent of the range error');
assert.equal(run({ uere: 20 }).horizontalAccuracy, 30.84);
assert.equal(run({ uere: 20 }).verticalAccuracy, 48.01);
assert.equal(run({ satellites: '20, 12\n110, 14\n200, 13\n290, 15' }).quality, 'Poor');
assert.equal(run({ satellites: '40, 55\n55, 50\n70, 60\n85, 45' }).quality, 'Poor');
assert.equal(run({ satellites: '0, 45\n90, 30\n180, 60\n270, 20' }).warningCount, 1);
assert.match(run({ satellites: '0, 45\n90, 30\n180, 60\n270, 20' }).warnings.join(' '), /no redundancy/);
assert.match(run({ satellites: '40, 55\n55, 50\n70, 60\n85, 45' }).warnings.join(' '), /above 20/);
assert.match(run({ satellites: '10, 40\n10, 40\n100, 20\n200, 35\n300, 60' }).warnings.join(' '),
  /share the same azimuth and elevation/);

// ---- Parsers accept the documented separators.
assert.deepEqual(plain(C.parseSatellites('10, 40\n200 30;90,15')), [
  { az: 10, el: 40 }, { az: 200, el: 30 }, { az: 90, el: 15 },
]);
assert.deepEqual(plain(C.parseSatellites('  0,0  ')), [{ az: 0, el: 0 }]);
assert.equal(C.parseSatellites('359.9, 89.999').length, 1);

// ---- Validation messages.
assert.equal(failure({ satellites: '' }), 'Add at least one satellite as azimuth, elevation.');
assert.equal(failure({ satellites: '10' }), 'Line 1 must be one azimuth and one elevation, such as 135, 40.');
assert.equal(failure({ satellites: 'north, 40' }), 'Line 1 must be two numbers: azimuth first, then elevation.');
assert.equal(failure({ satellites: '360, 30' }), 'Line 1: azimuth must be from 0 to just under 360 degrees.');
assert.equal(failure({ satellites: '-1, 30' }), 'Line 1: azimuth must be from 0 to just under 360 degrees.');
assert.equal(failure({ satellites: '10, 91' }), 'Line 1: elevation must be from 0 to 90 degrees.');
assert.equal(failure({ satellites: '10, -5' }), 'Line 1: elevation must be from 0 to 90 degrees.');
assert.equal(failure({ mask: 95 }), 'Elevation mask must be from 0 to 90 degrees.');
assert.equal(failure({ mask: 'ten' }), 'Elevation mask must be a number from 0 to 90 degrees.');
assert.equal(failure({ uere: 0 }), 'Average range error must be more than 0 and at most 1000 metres.');
assert.equal(failure({ uere: 1001 }), 'Average range error must be more than 0 and at most 1000 metres.');
assert.equal(failure({ satellites: '0, 5\n90, 5\n180, 5\n270, 5', mask: 10 }),
  'The 10 degree mask leaves 0 of 4 satellites; at least 4 are needed for a 3D fix.');
assert.equal(failure({ satellites: '0, 90\n120, 90\n240, 90\n45, 90' }),
  'These satellite directions are geometrically dependent, so no unique position solution exists. '
  + 'Spread satellites across the sky and across different elevations.');
assert.equal(failure({ satellites: Array.from({ length: 65 }, (_, i) => `${i % 360}, 20`).join('\n') }),
  'Use at most 64 satellites.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'GNSS Dilution of Precision Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'GNSS & NMEA');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('normal matrix'), 'method documents the normal matrix');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
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

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of C.FIELDS) {
  assert.ok(new RegExp(`<label for="${field}"`).test(html), 'control is labelled: ' + field);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<main/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/<form id="dop-form"/.test(html), 'the form submits so Enter calculates');
// The markup's initial state must equal the core defaults, otherwise the page
// opens on a validation error before the user touches anything.
const textarea = /<textarea id="satellites"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
assert.ok(textarea, 'satellite textarea present');
assert.equal(textarea[1], C.DEFAULTS.satellites, 'the textarea starts on the default satellites');
for (const pair of [['mask', '10'], ['uere', '5']]) {
  assert.ok(new RegExp(`<input id="${pair[0]}"[^>]*value="${pair[1]}"`).test(html),
    `the ${pair[0]} input starts at ${pair[1]}`);
}
for (const button of html.match(/<button\b[^>]*>/g)) {
  assert.ok(/type="(?:button|submit)"/.test(button), 'button declares a type: ' + button);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[\u2190\u00b7\u2014]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('gnss-dop-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, analytic zenith-and-horizon sky, DOP identities)');
