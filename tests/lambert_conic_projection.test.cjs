/* Regression checks for the Lambert conformal conic page: the catalogued cases,
   a finite-difference check of the scale factor against the projection itself,
   round trips over seeded parameter sets, the refusals, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lambert-conic-projection';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* lcc-core:start */');
const end = html.indexOf('/* lcc-core:end */');
assert.ok(start > -1 && end > start, 'lambert core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LambertCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.listed, true);
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Coordinates');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.sources.length, 3, 'PROJ, Snyder and Wikipedia are cited');
for (const source of record.sources) assert.ok(/^https:\/\//.test(source.url), 'sources carry https urls');

const run = (mode, input) => (mode === 'forward' ? C.forward(input) : C.inverse(input));
const failure = (mode, input) => {
  try {
    run(mode, input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- the catalogued cases, replayed against the page core -------------------
assert.ok(record.testCases.length >= 35, 'the record carries at least thirty-five cases');
const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] += 1;
  const mode = testCase.input.mode;
  if (testCase.expectedError) {
    assert.equal(failure(mode, testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(mode, testCase.input);
  const expected = testCase.expected;
  if (mode === 'forward') {
    assert.ok(Math.abs(result.easting - expected.easting) < 1e-3, testCase.name + ' easting');
    assert.ok(Math.abs(result.northing - expected.northing) < 1e-3, testCase.name + ' northing');
  } else {
    assert.ok(Math.abs(result.latitude - expected.latitude) < 1e-7, testCase.name + ' latitude');
    assert.ok(Math.abs(result.longitude - expected.longitude) < 1e-7, testCase.name + ' longitude');
    assert.ok(Math.abs(result.easting - expected.easting) < 1e-3, testCase.name + ' easting echo');
    assert.ok(Math.abs(result.northing - expected.northing) < 1e-3, testCase.name + ' northing echo');
  }
  assert.ok(Math.abs(result.scaleFactor - expected.scaleFactor) < 1e-8, testCase.name + ' scale factor');
  assert.ok(Math.abs(result.convergence - expected.convergence) < 1e-6, testCase.name + ' convergence');
  if (mode === 'forward') {
    assert.ok(Math.abs(result.deltaLongitude - expected.deltaLongitude) < 1e-6, testCase.name + ' delta longitude');
    assert.ok(Math.abs(result.coneConstant - expected.coneConstant) < 1e-8, testCase.name + ' cone constant');
  }
  if (expected.band) assert.equal(result.band, expected.band, testCase.name + ' band');
}
assert.ok(kinds.golden >= 12 && kinds.boundary >= 8 && kinds.validation >= 10, 'the case mix is kept');

// ---- independent checks that do not reuse the projection formula -----------
const CONUS = { ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0' };
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const e2 = WGS84.f * (2 - WGS84.f);
const radians = Math.PI / 180;

// the scale factor at a standard parallel is exactly 1 by definition
for (const parallel of ['33', '45']) {
  const atParallel = C.forward(Object.assign({}, CONUS, { latitude: parallel, longitude: '-90' }));
  assert.ok(Math.abs(atParallel.scaleFactor - 1) < 1e-12, 'unit scale on the standard parallel ' + parallel);
}
// the reported scale factor must equal what the projection actually does
for (const latitude of ['20', '33', '39', '45', '60', '-10']) {
  const phi = Number(latitude) * radians;
  const sin = Math.sin(phi);
  const m = Math.cos(phi) / Math.sqrt(1 - e2 * sin * sin);
  const meridianRadius = WGS84.a * (1 - e2) / Math.pow(1 - e2 * sin * sin, 1.5);
  const centre = C.forward(Object.assign({}, CONUS, { latitude, longitude: '-90' }));
  const h = 1e-6;
  const eastA = C.forward(Object.assign({}, CONUS, { latitude, longitude: String(-90 + h) }));
  const eastB = C.forward(Object.assign({}, CONUS, { latitude, longitude: String(-90 - h) }));
  const northA = C.forward(Object.assign({}, CONUS, { latitude: String(Number(latitude) + h), longitude: '-90' }));
  const northB = C.forward(Object.assign({}, CONUS, { latitude: String(Number(latitude) - h), longitude: '-90' }));
  const gridEast = Math.hypot(eastA.easting - eastB.easting, eastA.northing - eastB.northing);
  const gridNorth = Math.hypot(northA.easting - northB.easting, northA.northing - northB.northing);
  const groundEast = WGS84.a * m * 2 * h * radians;
  const groundNorth = meridianRadius * 2 * h * radians;
  assert.ok(Math.abs(gridEast / groundEast - centre.scaleFactor) < 1e-6, 'east scale factor at ' + latitude);
  assert.ok(Math.abs(gridNorth / groundNorth - centre.scaleFactor) < 1e-6, 'north scale factor at ' + latitude);
  assert.ok(Math.abs(gridEast / groundEast - gridNorth / groundNorth) < 1e-5, 'conformal at ' + latitude);
}
// the central meridian is a straight north line, and the origin carries the false northing
for (const latitude of ['10', '39', '70']) {
  const onMeridian = C.forward(Object.assign({}, CONUS, { latitude, longitude: '-96' }));
  assert.equal(onMeridian.easting, 0, 'central meridian easting at ' + latitude);
  assert.equal(onMeridian.convergence, 0, 'central meridian convergence at ' + latitude);
}
const atOrigin = C.forward(Object.assign({}, CONUS, { latitude: '39', longitude: '-96' }));
assert.equal(atOrigin.northing, 0, 'the latitude of origin on the central meridian is the false origin');
const shifted = C.forward(Object.assign({}, CONUS, { fe: '500000', fn: '-1000000', latitude: '39', longitude: '-96' }));
assert.equal(shifted.easting, 500000, 'the false easting shifts the whole grid');
assert.equal(shifted.northing, -1000000, 'the false northing shifts the whole grid');
// a pair either side of the central meridian is a mirror image
const east = C.forward(Object.assign({}, CONUS, { latitude: '42', longitude: '-86' }));
const west = C.forward(Object.assign({}, CONUS, { latitude: '42', longitude: '-106' }));
assert.ok(Math.abs(east.easting + west.easting) < 1e-6, 'eastings mirror about the central meridian');
assert.ok(Math.abs(east.northing - west.northing) < 1e-6, 'northings agree either side of the central meridian');
assert.ok(Math.abs(east.convergence + west.convergence) < 1e-9, 'convergence mirrors about the central meridian');
// convergence is the cone constant times the longitude from the central meridian
assert.ok(Math.abs(east.convergence - east.coneConstant * 10) < 1e-9, 'convergence is n times delta longitude');
// toward the pole the grid converges on the apex, whose northing is the falsing plus rho0
const nearPole = C.forward(Object.assign({}, CONUS, { latitude: '89.999999', longitude: '-96' }));
const parameters = C.parameters(Object.assign({}, CONUS));
const apexNorthing = parameters.fn + parameters.rho0;
const gapPole = Math.abs(nearPole.northing - apexNorthing);
const gap85 = Math.abs(C.forward(Object.assign({}, CONUS, { latitude: '85', longitude: '-96' })).northing - apexNorthing);
const gap60 = Math.abs(C.forward(Object.assign({}, CONUS, { latitude: '60', longitude: '-96' })).northing - apexNorthing);
assert.ok(gapPole < 1000, 'the grid closes on the apex toward the pole');
assert.ok(gapPole < gap85 && gap85 < gap60, 'the northing approaches the apex monotonically');
// the same map with the parallels swapped describes the same cone
const swapped = C.forward(Object.assign({}, CONUS, { lat1: '45', lat2: '33', latitude: '38.8895', longitude: '-77.0353' }));
const straight = C.forward(Object.assign({}, CONUS, { latitude: '38.8895', longitude: '-77.0353' }));
assert.ok(Math.abs(swapped.easting - straight.easting) < 1e-6 && Math.abs(swapped.northing - straight.northing) < 1e-6,
  'the order of the two standard parallels does not matter');

// ---- round trips over seeded parameter sets --------------------------------
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(9802);
const sets = [
  CONUS,
  { ellipsoid: 'grs80', lat1: '30', lat2: '65', lat0: '0', lon0: '10', fe: '0', fn: '0' },
  { ellipsoid: 'grs80', lat1: '-18', lat2: '-36', lat0: '0', lon0: '132', fe: '0', fn: '0' },
  { ellipsoid: 'clarke1866', lat1: '44', lat2: '49', lat0: '46.5', lon0: '3', fe: '700000', fn: '6600000' },
  { ellipsoid: 'sphere', lat1: '20', lat2: '50', lat0: '30', lon0: '90', fe: '1000', fn: '-2000' },
  { ellipsoid: 'wgs84', lat1: '45', lat2: '45', lat0: '45', lon0: '0', fe: '0', fn: '0' }
];
let roundTrips = 0;
for (const set of sets) {
  for (let index = 0; index < 50; index += 1) {
    const latitude = (Number(set.lat0) + (rand() - 0.5) * 50).toFixed(6);
    const longitude = (Number(set.lon0) + (rand() - 0.5) * 60).toFixed(6);
    const forward = C.forward(Object.assign({}, set, { latitude, longitude }));
    assert.ok(Number.isFinite(forward.easting) && Number.isFinite(forward.northing), 'finite grid ' + latitude);
    const back = C.inverse(Object.assign({}, set, {
      easting: String(forward.easting), northing: String(forward.northing)
    }));
    assert.ok(Math.abs(back.latitude - Number(latitude)) < 1e-9, 'latitude round trip ' + latitude);
    assert.ok(Math.abs(back.longitude - Number(longitude)) < 1e-9, 'longitude round trip ' + longitude);
    assert.ok(Math.abs(back.scaleFactor - forward.scaleFactor) < 1e-9, 'scale factor round trip');
    roundTrips += 1;
  }
}

// ---- refusals --------------------------------------------------------------
const refusals = [
  [{ ellipsoid: 'wgs84', lat1: '', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Enter the standard parallel 1.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Enter the latitude of origin.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Enter the central meridian.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '', fn: '0', latitude: '35', longitude: '-100' }, 'Enter the false easting.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '', longitude: '-100' }, 'Enter the point latitude.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '' }, 'Enter the point longitude.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '91', longitude: '-100' }, 'Point latitude must be between -90 and 90 degrees.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '181' }, 'Point longitude must be between -180 and 180 degrees.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '1e2', longitude: '-100' }, 'Point latitude must be a number.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '12.3.4', longitude: '-100' }, 'Point latitude must be a number.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '--35', longitude: '-100' }, 'Point latitude must be a number.'],
  [{ ellipsoid: 'wgs84', lat1: '90', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Standard parallel 1 must be between -90 and 90 degrees and not on a pole.'],
  [{ ellipsoid: 'wgs84', lat1: '-33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'The standard parallels must lie on the same side of the equator.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '0', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'A standard parallel cannot lie on the equator.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '90', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Latitude of origin must be between -90 and 90 degrees and not on a pole.'],
  [{ ellipsoid: 'wgs84', lat1: '33', lat2: '45', lat0: '-39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'The latitude of origin must not be in the opposite hemisphere to the standard parallels.'],
  [{ ellipsoid: 'mars', lat1: '33', lat2: '45', lat0: '39', lon0: '-96', fe: '0', fn: '0', latitude: '35', longitude: '-100' }, 'Choose one of the listed ellipsoids.']
];
for (const [input, message] of refusals) {
  if (message === null) continue;
  assert.equal(failure('forward', input), message, 'refusal: ' + message);
}
assert.ok(failure('inverse', Object.assign({}, CONUS, { easting: '', northing: '0' })), 'a blank easting is refused');
assert.ok(failure('inverse', Object.assign({}, CONUS, { easting: '0', northing: 'x' })), 'a northing that is a word is refused');
assert.ok(failure('inverse', Object.assign({}, CONUS, { easting: '0', northing: '10000000000' })), 'a northing past the metre limit is refused');
assert.ok(failure('inverse', Object.assign({}, CONUS, { easting: '0', northing: String(C.parameters(CONUS).rho0) })).includes('apex'));

// ---- accepted input conventions -------------------------------------------
const comma = C.forward(Object.assign({}, CONUS, { latitude: '38,8895', longitude: '-77,0353' }));
assert.ok(Math.abs(comma.easting - straight.easting) < 1e-6, 'decimal commas are accepted');
const plusSign = C.forward(Object.assign({}, CONUS, { latitude: '+38.8895', longitude: '-77.0353' }));
assert.ok(Math.abs(plusSign.easting - straight.easting) < 1e-6, 'a leading plus sign is accepted');
const spaced = C.forward(Object.assign({}, CONUS, { latitude: ' 38.8895 ', longitude: ' -77.0353 ' }));
assert.ok(Math.abs(spaced.easting - straight.easting) < 1e-6, 'surrounding spaces are ignored');
const tangent = C.forward(Object.assign({}, CONUS, { lat1: '33', lat2: '33', latitude: '33', longitude: '-96' }));
assert.ok(Math.abs(tangent.scaleFactor - 1) < 1e-12, 'one parallel given twice is the tangent cone');

// ---- page contract ---------------------------------------------------------
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/(?:src|href)=\"https?:/.test(html), 'no off-site asset references');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html.slice(html.indexOf('/* lcc-core:end */'))),
  'no network or storage calls in the page script');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const id of ['ellipsoid', 'lat1', 'lat2', 'lat0', 'lon0', 'fe', 'fn', 'point-a', 'point-b',
  'projection-form', 'projection-err', 'projection-out', 'run', 'reset', 'mode-forward', 'mode-inverse', 'method']) {
  assert.ok(ids.includes(id), 'missing control #' + id);
}
for (const forId of ['ellipsoid', 'lat1', 'lat2', 'lat0', 'lon0', 'fe', 'fn', 'point-a', 'point-b']) {
  assert.ok(new RegExp('for="' + forId + '"').test(html), 'control #' + forId + ' is labelled');
}
assert.ok(html.includes('aria-pressed'), 'the direction buttons expose their state');
assert.ok(html.includes('aria-live'), 'the result region is announced');
assert.ok(/<select[^>]*id="ellipsoid"/.test(html), 'the ellipsoid is a select');

console.log('lambert-conic-projection: ' + record.testCases.length + ' catalog cases, ' + roundTrips +
  ' round trips, finite-difference scale checks, ' + (refusals.length + 3) + ' refusals, page contract — all green');
