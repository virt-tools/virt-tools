/* Albers equal-area conic: golden points cross-checked against PROJ's +proj=aea,
   the equal-area property measured from a numeric Jacobian, forward/inverse
   round trips, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'albers-equal-area-conic';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* albers-core:start */';
const endMarker = '/* albers-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AlbersCore;', sandbox);
const C = sandbox.module.exports;
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');

const DEG = Math.PI / 180;
const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.forward(input));
const back = (input) => plain(C.inverse(input));
const failure = (input) => {
  try { C.forward(input); } catch (error) { return error.message; }
  return null;
};
const inverseFailure = (input) => {
  try { C.inverse(input); } catch (error) { return error.message; }
  return null;
};
const configs = [
  { ellipsoid: 'grs80', lat1: '29.5', lat2: '45.5', lat0: '23', lon0: '-96', fe: '0', fn: '0', lat: [24, 50], lon: [-125, -66] },
  { ellipsoid: 'grs80', lat1: '-18', lat2: '-36', lat0: '0', lon0: '132', fe: '0', fn: '0', lat: [-44, -10], lon: [110, 155] },
  { ellipsoid: 'clarke1866', lat1: '55', lat2: '65', lat0: '50', lon0: '-154', fe: '0', fn: '0', lat: [51, 71], lon: [-170, -130] },
  { ellipsoid: 'wgs84', lat1: '40', lat2: '60', lat0: '50', lon0: '10', fe: '500000', fn: '-3000000', lat: [35, 70], lon: [-30, 60] }
];
const params = (config) => ({
  ellipsoid: config.ellipsoid, lat1: config.lat1, lat2: config.lat2, lat0: config.lat0,
  lon0: config.lon0, fe: config.fe, fn: config.fn
});
const ellipsoidShape = (key) => {
  const item = C.ELLIPSOIDS[key];
  const f = item.invF ? 1 / item.invF : 0;
  return { a: item.a, e2: f * (2 - f) };
};

let seed = 20261122;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const sample = (range) => range[0] + (range[1] - range[0]) * rand();

// ---- Published points: PROJ's +proj=aea, copied from its forward result.
const projPoints = [
  { name: 'Washington DC, US national grid', config: configs[0], latitude: 38.8895, longitude: -77.0353, x: 1618883.307401, y: 1924594.23363 },
  { name: 'Denver, US national grid', config: configs[0], latitude: 39.7392, longitude: -104.9903, x: -762409.047764, y: 1893843.599649 },
  { name: 'Sydney, Australian grid', config: configs[1], latitude: -33.8688, longitude: 151.2093, x: 1760981.528598, y: -3828749.389753 },
  { name: 'Anchorage, Alaska grid (Clarke 1866)', config: configs[2], latitude: 61.2181, longitude: -149.9003, x: 219358.27154, y: 1255317.077311 }
];
for (const point of projPoints) {
  const result = run(Object.assign(params(point.config), { latitude: String(point.latitude), longitude: String(point.longitude) }));
  assert.ok(Math.abs(result.easting - point.x) < 1e-5, 'easting agrees with PROJ: ' + point.name);
  assert.ok(Math.abs(result.northing - point.y) < 1e-5, 'northing agrees with PROJ: ' + point.name);
  const inverse = back(Object.assign(params(point.config), { easting: String(point.x), northing: String(point.y) }));
  assert.ok(Math.abs(inverse.latitude - point.latitude) < 1e-8, 'inverse latitude: ' + point.name);
  assert.ok(Math.abs(inverse.longitude - point.longitude) < 1e-8, 'inverse longitude: ' + point.name);
}

// ---- The defining property: the map is equal-area, measured without the
// closed-form scale factors, from a numeric Jacobian against the ellipsoid's
// own area element M N cos(phi) dphi dlambda.
let worstArea = 0;
for (const config of configs) {
  const shape = ellipsoidShape(config.ellipsoid);
  for (let i = 0; i < 150; i += 1) {
    const lat = sample(config.lat);
    const lon = sample(config.lon);
    const d = 1e-5;
    const rad = d * DEG;
    const f = (la, lo) => run(Object.assign(params(config), { latitude: String(la), longitude: String(lo) }));
    const p = f(lat, lon);
    const latUp = f(lat + d, lon);
    const latDown = f(lat - d, lon);
    const lonUp = f(lat, lon + d);
    const lonDown = f(lat, lon - d);
    const xPhi = (latUp.easting - latDown.easting) / (2 * rad);
    const yPhi = (latUp.northing - latDown.northing) / (2 * rad);
    const xLam = (lonUp.easting - lonDown.easting) / (2 * rad);
    const yLam = (lonUp.northing - lonDown.northing) / (2 * rad);
    const determinant = Math.abs(xPhi * yLam - xLam * yPhi);
    const phi = lat * DEG;
    const w = 1 - shape.e2 * Math.sin(phi) ** 2;
    const bigM = shape.a * (1 - shape.e2) / Math.pow(w, 1.5);
    const bigN = shape.a / Math.sqrt(w);
    const areaElement = bigM * bigN * Math.cos(phi);
    worstArea = Math.max(worstArea, Math.abs(determinant / areaElement - 1));
    assert.ok(p.areaScale === 1, 'the area scale is reported as exactly 1');
  }
}
assert.ok(worstArea < 1e-6, 'the numeric Jacobian shows equal area everywhere: ' + worstArea.toExponential(2));

// ---- Scale is exactly 1 on both standard parallels, and h k = 1 everywhere.
for (const config of configs) {
  for (const parallel of [config.lat1, config.lat2]) {
    const result = run(Object.assign(params(config), { latitude: parallel, longitude: config.lon0 }));
    assert.ok(Math.abs(result.scaleParallel - 1) < 1e-12, 'k is 1 on the standard parallel ' + parallel);
    assert.ok(Math.abs(result.scaleMeridian - 1) < 1e-12, 'h is 1 on the standard parallel ' + parallel);
    assert.equal(result.band, 'parallel');
  }
}
for (const config of configs) {
  for (let i = 0; i < 50; i += 1) {
    const result = run(Object.assign(params(config), { latitude: String(sample(config.lat)), longitude: String(sample(config.lon)) }));
    assert.ok(Math.abs(result.scaleParallel * result.scaleMeridian - 1) < 1e-12, 'h times k stays 1');
  }
}

// ---- Round trips in every aspect, including the southern cone where a signed
// radius has to keep the longitude in the right quarter.
let roundTrips = 0;
for (const config of configs) {
  for (let i = 0; i < 500; i += 1) {
    const lat = sample(config.lat);
    const lon = sample(config.lon);
    const forward = run(Object.assign(params(config), { latitude: String(lat), longitude: String(lon) }));
    const inverse = back(Object.assign(params(config), { easting: String(forward.easting), northing: String(forward.northing) }));
    assert.ok(Math.abs(inverse.latitude - lat) < 1e-9, 'latitude round trip ' + lat + ', ' + lon);
    assert.ok(Math.abs(inverse.longitude - lon) < 1e-9, 'longitude round trip ' + lat + ', ' + lon);
    roundTrips += 1;
  }
}
const southern = run(Object.assign(params(configs[1]), { latitude: '-33.8688', longitude: '151.2093' }));
assert.ok(southern.convergence < 0, 'a southern cone turns grid north west of true north east of the meridian');
const southernBack = back(Object.assign(params(configs[1]), { easting: String(southern.easting), northing: String(southern.northing) }));
assert.ok(Math.abs(southernBack.longitude - 151.2093) < 1e-9, 'the southern inverse keeps the eastern longitude');

// ---- A single-parallel cone takes n from that parallel, and wraps longitudes.
const single = run({ ellipsoid: 'wgs84', lat1: '45', lat2: '45', lat0: '45', lon0: '0', fe: '0', fn: '0', latitude: '45', longitude: '0' });
assert.ok(Math.abs(single.coneConstant - Math.sin(45 * DEG)) < 1e-12, 'single-parallel cone constant');
const wrapped = run({ ellipsoid: 'wgs84', lat1: '30', lat2: '50', lat0: '40', lon0: '179', fe: '0', fn: '0', latitude: '35', longitude: '-179' });
assert.ok(Math.abs(wrapped.deltaLongitude - 2) < 1e-12, 'longitude wraps across the antimeridian');
const origin = run(Object.assign(params(configs[0]), { latitude: '23', longitude: '-96' }));
assert.ok(Math.abs(origin.northing) < 1e-9 && Math.abs(origin.easting) < 1e-9, 'the origin sits at the false origin');

// ---- Refusals, pinned by their exact wording.
const refusals = [
  [Object.assign(params(configs[0]), { lat1: '0', latitude: '40', longitude: '-100' }), 'A standard parallel cannot lie on the equator.'],
  [Object.assign(params(configs[0]), { lat2: '-10', latitude: '40', longitude: '-100' }), 'The standard parallels must lie on the same side of the equator.'],
  [Object.assign(params(configs[0]), { lat0: '-5', latitude: '40', longitude: '-100' }), 'The latitude of origin must not be in the opposite hemisphere to the standard parallels.'],
  [Object.assign(params(configs[0]), { lat1: '90', latitude: '40', longitude: '-100' }), 'Standard parallel 1 must be between -90 and 90 degrees and not on a pole.'],
  [Object.assign(params(configs[0]), { lon0: '181', latitude: '40', longitude: '-100' }), 'Central meridian must be between -180 and 180 degrees.'],
  [Object.assign(params(configs[0]), { latitude: '40', longitude: '200' }), 'Point longitude must be between -180 and 180 degrees.'],
  [Object.assign(params(configs[0]), { latitude: '' }), 'Enter the point latitude.'],
  [Object.assign(params(configs[0]), { latitude: '38N' }), 'Point latitude must be a number.']
];
for (const [input, message] of refusals) assert.equal(failure(input), message);
const apex = C.parameters(params(configs[0])).rho0;
assert.equal(inverseFailure(Object.assign(params(configs[0]), { easting: '0', northing: String(apex) })),
  'This grid position is the cone apex: every longitude meets there, so the point has no longitude.');
assert.equal(inverseFailure(Object.assign(params(configs[0]), { easting: '0', northing: '10000000' })),
  'This easting and northing lie beyond the pole, where the cone has no image.');

// ---- Catalog replay: every recorded case, within the recorded precision.
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.ok(entry.testCases.length >= 20, 'the record carries a full case table');
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 7);
assert.equal(kinds('validation'), 13);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    const inverseCase = 'easting' in testCase.input;
    assert.equal(inverseCase ? inverseFailure(testCase.input) : failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = 'easting' in testCase.input && !('latitude' in testCase.input)
    ? back(testCase.input) : run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[key] - value) < 1e-6, testCase.name + ' ' + key + ': ' + result[key] + ' vs ' + value);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// ---- Uniqueness: no other record claims this slug, name or alias, and no other
// tool already maps an Albers projection.
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
for (const tag of ['geography', 'cartography', 'map-projection', 'albers', 'equal-area', 'conic']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/albers|equal-area conic/.test(haystack), 'no duplicate: ' + tool.slug);
}

// ---- Page contract: self-contained, offline, keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
assert.ok(html.includes('<form id="projection-form"'), 'projection form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-pressed="true"'), 'mode tabs expose their state');
const controls = ['ellipsoid', 'lat1', 'lat2', 'lat0', 'lon0', 'fe', 'fn', 'point-a', 'point-b'];
for (const id of controls) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.equal((html.match(/<button /g) || []).length, 4, 'two mode tabs and two actions');
assert.ok(!/autocomplete="on"/.test(html), 'inputs are not autocompleted');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
assert.equal(scripts.length, 1, 'one inline script');
const lastScript = html.lastIndexOf('<script');
const lastInline = html.lastIndexOf('<script>');
assert.ok(lastInline > -1 && html.slice(lastScript, lastInline + 8) === '<script>', 'the inline core is the last script, as the CSP hash expects');
assert.ok(!html.includes('http://') && !html.includes('https://'), 'no absolute URLs in the page source');

console.log('albers equal-area conic: ' + entry.testCases.length + ' catalog cases, '
  + roundTrips + ' round trips, worst area error ' + worstArea.toExponential(2)
  + ', ' + projPoints.length + ' PROJ points and ' + refusals.length + ' refusals pass');
