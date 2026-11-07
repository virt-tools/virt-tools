/* Regression checks for the UTM zone calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/utm-zone-calculator/index.html'), 'utf8');
const startMarker = '/* utm-zone-core:start */';
const endMarker = '/* utm-zone-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'UTM zone core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = UTMZoneCore;', sandbox);
const C = sandbox.module.exports;

const standard = C.calculate({});
assert.equal(standard.zone, 30);
assert.equal(standard.regularZone, 30);
assert.equal(standard.band, 'U');
assert.equal(standard.gridZone, '30U');
assert.equal(standard.centralMeridian, -3);
assert.equal(standard.longitudeStart, -6);
assert.equal(standard.longitudeEnd, 0);
assert.equal(standard.hemisphere, 'North');
assert.equal(standard.rule, 'Standard 6° longitude zone');
assert.equal(C.latitude(-80), '80°S');
assert.equal(C.latitude(0), '0°N');
assert.equal(C.longitude(180), '180°E');
assert.equal(C.longitude(-0.1278), '0.1278°W');
assert.match(C.summary(standard), /Grid zone designation: 30U/);
assert.match(C.summary(standard), /Central meridian: 3°W/);

// Exercise every ordinary zone at its start, midpoint and end without using the core's result as an oracle.
let ordinaryChecks = 0;
for (let zone = 1; zone <= 60; zone += 1) {
  const startLongitude = zone * 6 - 186;
  const endLongitude = startLongitude + 6;
  const samples = [startLongitude, (startLongitude + endLongitude) / 2, endLongitude];
  for (const longitude of samples) {
    const result = C.calculate({latitude: 0, longitude});
    const expectedZone = zone === 60 && longitude === 180 ? 60 : (longitude === endLongitude ? zone + 1 : zone);
    assert.equal(result.zone, expectedZone, `longitude ${longitude}`);
    assert.equal(result.regularZone, expectedZone);
    assert.equal(result.band, 'N');
    assert.equal(result.centralMeridian, expectedZone * 6 - 183);
    ordinaryChecks += 1;
  }
}
assert.equal(ordinaryChecks, 180);

// Check every latitude band at its lower edge and immediately below its upper edge.
const expectedBands = 'CDEFGHJKLMNPQRSTUVWX';
assert.equal(expectedBands.length, 20);
let bandChecks = 0;
for (let index = 0; index < expectedBands.length; index += 1) {
  const minimum = -80 + index * 8;
  const maximum = index === 19 ? 84 : minimum + 8;
  const expected = expectedBands[index];
  for (const latitude of [minimum, maximum - 0.000001]) {
    const result = C.calculate({latitude, longitude: -150});
    assert.equal(result.band, expected, `latitude ${latitude}`);
    assert.equal(result.bandMin, minimum);
    assert.equal(result.bandMax, maximum);
    assert.equal(result.hemisphere, latitude >= 0 ? 'North' : 'South');
    bandChecks += 1;
  }
}
assert.equal(bandChecks, 40);

// Explicit zone-exception boundaries use independently recorded expected zones.
const exceptionCases = [
  [56, 3, 32, 'V', 'Norway exception'],
  [63.999999, 11.999999, 32, 'V', 'Norway exception'],
  [64, 3, 31, 'W', 'Standard 6° longitude zone'],
  [60, 12, 33, 'V', 'Standard 6° longitude zone'],
  [72, 8.999999, 31, 'X', 'Svalbard exception'],
  [75, 9, 33, 'X', 'Svalbard exception'],
  [75, 20.999999, 33, 'X', 'Svalbard exception'],
  [75, 21, 35, 'X', 'Svalbard exception'],
  [75, 32.999999, 35, 'X', 'Svalbard exception'],
  [75, 33, 37, 'X', 'Svalbard exception'],
  [75, 41.999999, 37, 'X', 'Svalbard exception'],
  [75, 42, 38, 'X', 'Standard 6° longitude zone'],
  [71.999999, 8, 32, 'W', 'Standard 6° longitude zone']
];
for (const [latitude, longitude, zone, band, rule] of exceptionCases) {
  const result = C.calculate({latitude, longitude});
  assert.equal(result.zone, zone, `${latitude}, ${longitude}`);
  assert.equal(result.band, band);
  assert.equal(result.rule, rule);
  assert.equal(result.gridZone, `${zone}${band}`);
}

for (const latitude of ['', ' ', '1e1', '+10', '10,5', NaN, Infinity, null, true, {}, 84, 84.000001, -80.000001]) {
  assert.throws(() => C.calculate({latitude}), /Latitude|UTM latitude bands/);
}
for (const longitude of ['', ' ', '1e2', '+10', '10,5', NaN, Infinity, null, false, [], -180.000001, 180.000001]) {
  assert.throws(() => C.calculate({longitude}), /Longitude/);
}

// Replay every canonical catalog case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'utm-zone-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one UTM zone calculator');
const record = records[0];
assert.equal(record.name, 'UTM Zone Calculator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('Universal Transverse Mercator Zone Finder'));
assert.ok(record.testCases.length >= 20, 'catalog carries golden, boundary and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) assert.equal(result[key], expected, `${testCase.name}: ${key}`);
}

console.log(`utm-zone-calculator: all checks passed (${record.testCases.length} catalog cases, ${ordinaryChecks} ordinary-zone samples, ${bandChecks} band samples and ${exceptionCases.length} exception boundaries)`);
