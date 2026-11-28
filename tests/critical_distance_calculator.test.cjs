/* Critical distance calculator: the absorption area and critical distance
   against an independent formula, the 6 dB per doubling relation, unit
   conversions, refusals, the placement curve, catalog replay and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'critical-distance-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* critical-distance-core:start */';
const endMarker = '/* critical-distance-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CriticalDistanceCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (v, vu, t, q, d, du) => plain(C.calculate(v, vu, t, q, d, du));
const failure = (v, vu, t, q, d, du) => {
  try { run(v, vu, t, q, d, du); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const round6 = (value) => Math.round(value * 1e6) / 1e6;

// ---- Published constants.
close(C.SABINE, 0.161, 1e-15, 'Sabine coefficient');
close(C.DC_COEFFICIENT, 0.14104739588693907, 1e-15, 'quarter root of one over pi');
close(C.DC_COEFFICIENT, 0.25 * Math.sqrt(1 / Math.PI), 1e-15, 'coefficient definition');
close(C.FT_PER_M, 3.280839895013123, 1e-12, 'feet per metre');
close(C.FT3_PER_M3, 35.31466672148859, 1e-9, 'cubic feet per cubic metre');
assert.equal(C.MIN_VOLUME, 1);
assert.equal(C.MAX_VOLUME, 1000000);
assert.equal(C.MIN_RT60, 0.05);
assert.equal(C.MAX_RT60, 20);
assert.equal(C.MIN_Q, 0.5);
assert.equal(C.MAX_Q, 50);
assert.equal(C.MIN_DISTANCE, 0.01);
assert.equal(C.MAX_DISTANCE, 200);
assert.deepEqual(plain(C.CURVE_FACTORS), [0.25, 0.5, 1, 2, 4]);
assert.equal(C.DEFAULT_VOLUME, '120');
assert.equal(C.DEFAULT_VOLUME_UNIT, 'm3');
assert.equal(C.DEFAULT_RT60, '0.6');
assert.equal(C.DEFAULT_Q, '1');
assert.equal(C.DEFAULT_DISTANCE, '1');
assert.equal(C.DEFAULT_DISTANCE_UNIT, 'm');

// ---- Unit resolution.
assert.equal(C.resolveVolumeUnit('m3'), 'm3');
assert.equal(C.resolveVolumeUnit(' ft3 '), 'ft3');
assert.equal((() => {
  try { C.resolveDistanceUnit('yards'); } catch (error) { return error.message; }
})(), 'Choose metres or feet.');
assert.equal((() => {
  try { C.resolveVolumeUnit('litres'); } catch (error) { return error.message; }
})(), 'Choose cubic metres or cubic feet.');

// ---- Absorption area and critical distance against an independent formula.
let sweep = 0;
for (let index = 0; index < 200; index += 1) {
  const volume = 5 + index * 37.5;
  const rt60 = 0.12 + (index % 40) * 0.11;
  const q = 0.5 + (index % 17) * 0.5;
  const distance = 0.05 + (index % 23) * 1.3;
  const result = C.compute(volume, rt60, q, distance);
  const area = (0.161 * volume) / rt60;
  const dc = 0.25 * Math.sqrt((q * area) / Math.PI);
  close(result.absorption, area, 1e-9 * Math.max(1, area), 'absorption at ' + index);
  close(result.dcM, dc, 1e-9 * Math.max(1e-6, dc), 'critical distance at ' + index);
  close(result.dcFt, dc * 3.280839895013123, 1e-9 * Math.max(1e-6, dc), 'critical distance in feet at ' + index);
  close(result.ratio, distance / dc, 1e-12 * Math.max(1, distance / dc), 'distance ratio at ' + index);
  close(result.drrDb, 20 * Math.log10(dc / distance), 1e-9, 'level difference at ' + index);
  close(result.drrDb, -20 * Math.log10(distance / dc), 1e-9, 'level difference sign at ' + index);
  close(C.absorptionArea(volume, rt60), area, 1e-12 * Math.max(1, area), 'absorption helper at ' + index);
  close(C.criticalDistance(volume, rt60, q), dc, 1e-12 * Math.max(1e-6, dc), 'distance helper at ' + index);
  sweep += 1;
}

// ---- The 6 dB per doubling relation and the equality at the critical distance.
for (const [volume, rt60, q] of [[120, 0.6, 1], [30, 0.4, 1], [5000, 1.8, 1], [12, 0.2, 3], [8000, 3.5, 4]]) {
  const dc = C.criticalDistance(volume, rt60, q);
  close(C.compute(volume, rt60, q, dc).drrDb, 0, 1e-12, 'equality at the critical distance');
  close(C.compute(volume, rt60, q, dc / 2).drrDb, 6.020599913279624, 1e-9, 'half the distance leads by 6 dB');
  close(C.compute(volume, rt60, q, dc * 2).drrDb, -6.020599913279624, 1e-9, 'twice the distance trails by 6 dB');
  close(C.compute(volume, rt60, q, dc * 4).drrDb, -12.041199826559248, 1e-9, 'four times trails by 12 dB');
  // Q acts as a square-law multiplier on the critical distance.
  close(C.criticalDistance(volume, rt60, q * 4), 2 * dc, 1e-12, 'four times the directivity doubles the distance');
}

// ---- Unit conversion round trips.
for (const volume of [1, 12, 120, 5000, 8000, 1000000]) {
  close(C.parseVolume(String(volume * C.FT3_PER_M3), 'ft3'), volume, 1e-9 * volume, 'cubic feet round trip');
  close(C.parseVolume(String(volume), 'm3'), volume, 0, 'cubic metres parse exactly');
}
for (const distance of [0.01, 0.5, 1, 3, 25, 200]) {
  close(C.parseDistance(String(distance * C.FT_PER_M), 'ft'), distance, 1e-9 * distance, 'feet round trip');
  close(C.parseDistance(String(distance), 'm'), distance, 0, 'metres parse exactly');
}
close(C.parseVolume('3531.466672148859', 'ft3'), 100, 1e-9, '3531.47 cubic feet is 100 cubic metres');
close(C.parseDistance('3.280839895013123', 'ft'), 1, 1e-12, '3.28084 feet is one metre');

// ---- Formatting.
assert.equal(C.formatLength(0.800374066262069, 'm'), '0.80 m');
assert.equal(C.formatLength(0.800374066262069, 'ft'), '2.63 ft');
assert.equal(C.formatLength(2.982818032649845, 'm'), '2.98 m');
assert.equal(C.formatDb(0), '0.00 dB');
assert.equal(C.formatDb(6.020599913279624), '+6.02 dB');
assert.equal(C.formatDb(-6.020599913279624), '-6.02 dB');
assert.equal(C.formatDb(-0.001), '0.00 dB', 'no negative zero');
assert.equal(C.formatDb(-Infinity), 'silent');
assert.equal(C.formatRatio(1.249415794629916), '1.25x');
assert.equal(C.formatRatio(1), '1.00x');
assert.equal(C.formatArea(32.2), '32.20 m2');
assert.equal(C.formatArea(447.22222222222223), '447.22 m2');

// ---- Verdicts at the four thresholds.
assert.ok(C.verdict(0.1).startsWith('well inside'));
assert.ok(C.verdict(0.5).startsWith('well inside'));
assert.ok(C.verdict(0.51).startsWith('inside'));
assert.ok(C.verdict(1).startsWith('inside'));
assert.ok(C.verdict(1.01).startsWith('just past'));
assert.ok(C.verdict(2).startsWith('just past'));
assert.ok(C.verdict(2.01).startsWith('well past'));

// ---- The default room.
const bedroom = run('120', 'm3', '0.6', '1', '1', 'm');
assert.equal(bedroom.headline, 'Critical distance 0.80 m');
assert.equal(
  bedroom.summary,
  'At 1.00 m (3.28 ft) you are 1.25x the critical distance, just past the critical distance: '
  + 'the room is about as loud as the source.'
);
assert.equal(bedroom.balanceText, 'The reverberant field leads the direct sound by 1.93 dB.');
assert.equal(bedroom.absorptionText, '32.20 m2');
assert.equal(bedroom.dcFtText, '2.63 ft');
assert.equal(bedroom.ratioText, '1.25x');
assert.equal(bedroom.drrText, '-1.93 dB');
close(bedroom.volumeFt3, 120 * C.FT3_PER_M3, 1e-9, 'volume in cubic feet');
const inside = run('120', 'm3', '0.6', '1', '0.4', 'm');
assert.equal(inside.balanceText, 'The direct sound leads the reverberant field by 6.02 dB.');
const equal = run('120', 'm3', '0.6', '1', String(C.criticalDistance(120, 0.6, 1)), 'm');
assert.equal(equal.balanceText, 'Direct and reverberant sound are equal here.');

// ---- The placement curve.
const curve = plain(C.curve(0.800374066262069, 1));
assert.equal(curve.length, 5);
assert.deepEqual(curve.map((row) => row.factorText), ['0.25x', '0.50x', '1x', '2.00x', '4.00x']);
assert.deepEqual(curve.map((row) => row.drrText), ['+12.04 dB', '+6.02 dB', '0.00 dB', '-6.02 dB', '-12.04 dB']);
assert.deepEqual(curve.map((row) => row.current), [false, false, true, false, false]);
assert.equal(curve[2].distanceText, '0.80 m');
assert.equal(curve[3].distanceFtText, '5.25 ft');
const farCurve = plain(C.curve(1, 6));
assert.deepEqual(farCurve.map((row) => row.current), [false, false, false, false, true]);
const nearCurve = plain(C.curve(1, 0.12));
assert.deepEqual(nearCurve.map((row) => row.current), [true, false, false, false, false]);

// ---- Refusals, with the exact wording the page shows.
for (const [label, args, message] of [
  ['empty volume', ['', 'm3', '0.6', '1', '1', 'm'], 'Enter the room volume, such as 120.'],
  ['empty volume in feet', ['', 'ft3', '0.6', '1', '1', 'm'], 'Enter the room volume, such as 4200.'],
  ['word volume', ['big', 'm3', '0.6', '1', '1', 'm'], 'Enter the room volume as a number, such as 120.'],
  ['zero volume', ['0', 'm3', '0.6', '1', '1', 'm'], 'Room volume must be between 1 and 1000000 cubic metres.'],
  ['over volume', ['1000001', 'm3', '0.6', '1', '1', 'm'], 'Room volume must be between 1 and 1000000 cubic metres.'],
  ['under volume in feet', ['30', 'ft3', '0.6', '1', '1', 'm'],
    'Room volume must be between 35 and 35314667 cubic feet.'],
  ['empty rt60', ['120', 'm3', '', '1', '1', 'm'], 'Enter the reverberation time RT60, such as 0.6.'],
  ['comma rt60', ['120', 'm3', '0,6', '1', '1', 'm'], 'Enter the reverberation time RT60 as a number, such as 0.6.'],
  ['long rt60', ['120', 'm3', '21', '1', '1', 'm'], 'Reverberation time must be between 0.05 and 20 seconds.'],
  ['short rt60', ['120', 'm3', '0.01', '1', '1', 'm'], 'Reverberation time must be between 0.05 and 20 seconds.'],
  ['empty q', ['120', 'm3', '0.6', '', '1', 'm'], 'Enter the directivity factor Q, such as 1.'],
  ['negative q', ['120', 'm3', '0.6', '-1', '1', 'm'], 'Enter the directivity factor Q as a number, such as 1.'],
  ['small q', ['120', 'm3', '0.6', '0.1', '1', 'm'], 'Directivity factor Q must be between 0.5 and 50.'],
  ['large q', ['120', 'm3', '0.6', '60', '1', 'm'], 'Directivity factor Q must be between 0.5 and 50.'],
  ['empty distance', ['120', 'm3', '0.6', '1', '', 'm'], 'Enter the source to listener distance, such as 1.'],
  ['empty distance in feet', ['120', 'm3', '0.6', '1', '', 'ft'], 'Enter the source to listener distance, such as 3.'],
  ['exponent distance', ['120', 'm3', '0.6', '1', '1e3', 'm'],
    'Enter the source to listener distance as a number, such as 1.'],
  ['long distance', ['120', 'm3', '0.6', '1', '201', 'm'], 'Distance must be between 0.01 and 200 metres.'],
  ['short distance in feet', ['120', 'm3', '0.6', '1', '0.01', 'ft'],
    'Distance must be between 0.03 and 656 feet.'],
  ['unknown volume unit', ['120', 'litres', '0.6', '1', '1', 'm'], 'Choose cubic metres or cubic feet.'],
  ['unknown distance unit', ['120', 'm3', '0.6', '1', '1', 'yards'], 'Choose metres or feet.'],
]) {
  assert.equal(failure(...args), message, label);
}

// ---- compute refuses non-positive values even when called directly.
for (const args of [[0, 0.6, 1, 1], [120, 0, 1, 1], [120, 0.6, 0, 1], [120, 0.6, 1, 0], [-120, 0.6, 1, 1]]) {
  assert.throws(() => C.compute(...args), /must all be positive/, 'direct compute refuses ' + args.join(','));
}

// ---- Determinism and the calculate/compute pair.
for (const args of [['120', 'm3', '0.6', '1', '1', 'm'], ['2119', 'ft3', '0.35', '3', '0.5', 'ft'],
  ['8000', 'm3', '3.5', '1', '5', 'm']]) {
  const once = run(...args);
  const twice = run(...args);
  assert.deepEqual(once, twice, args.join(',') + ' is deterministic');
  const direct = plain(C.compute(
    C.parseVolume(args[0], args[1]), C.parseRt60(args[2]), C.parseDirectivity(args[3]),
    C.parseDistance(args[4], args[5])));
  assert.deepEqual(once, direct, args.join(',') + ' matches compute');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Critical Distance Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-19T03:20:00Z');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('0.25 sqrt'), 'method states the critical distance');
assert.ok(record.method.includes('20 log10'), 'method states the level difference');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 2, 'two references are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 10),
  'both references are titled');
assert.ok(/^https:\/\//.test(record.sources[0].url), 'the fetched reference carries its URL');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 31, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 15, 'fifteen validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const input = testCase.input;
  const args = [input.volume, input.volumeUnit, input.rt60, input.q, input.distance, input.distanceUnit];
  if (testCase.kind === 'validation') {
    assert.equal(failure(...args), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(...args);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    const tolerance = key.endsWith('Db') ? 2e-6 : 1e-6 * Math.max(1, Math.abs(expected));
    close(actual[key], expected, tolerance, testCase.name + ' ' + key);
    checked += 1;
  }
  assert.ok(actual.headline.startsWith('Critical distance '), testCase.name + ' headline');
  assert.ok(/^-?\d+(\.\d\d)?[a-z ]*/.test(actual.ratioText), testCase.name + ' ratio text');
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
for (const tag of ['audio', 'acoustics', 'room-acoustics', 'critical-distance', 'reverberation-time',
  'microphone-placement']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2513, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2252, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 57, 'audio records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 10, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of ['volume', 'rt60', 'q', 'distance']) {
  assert.ok(new RegExp('<label for="' + field + '">').test(html), 'the ' + field + ' field has a label');
}
assert.ok(/<label for="volume-unit">/.test(html) && /<label for="distance-unit">/.test(html), 'unit selectors are labelled');
assert.ok(/<option value="m3" selected>/.test(html), 'cubic metres is the default volume unit');
assert.ok(/<option value="m" selected>/.test(html), 'metres is the default distance unit');
assert.ok(/value="120"/.test(html) && /value="0\.6"/.test(html), 'defaults are in the markup');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the tables are described');
assert.ok(/<th scope="row">/.test(html), 'the detail rows are headed');
assert.equal((html.match(/<th scope="col">/g) || []).length, 6, 'two detail and four curve columns');
assert.equal((html.match(/<select\b/g) || []).length, 2, 'two unit selectors');
assert.equal((html.match(/type="text"/g) || []).length, 4, 'four numeric fields');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/min-height:46px/.test(html), 'the inputs keep a comfortable height');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the layout has a narrow breakpoint');
assert.equal((html.match(/value="[^"]*"/g) || []).length >= 4, true, 'defaults are set in markup');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('critical distance calculator: ' + sweep + ' independent plans, ' + checked
  + ' replayed catalog values, 21 refusals and the page contract pass');
