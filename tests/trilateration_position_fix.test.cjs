/* Trilateration position fix: catalog goldens are checked against an
   independent spherical-law-of-cosines distance and a brute-force search of
   the neighbourhood, so the reported point is a genuine least-squares minimum
   rather than a value copied from the page. Also covers units, refusals,
   uniqueness and the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'trilateration-position-fix';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* tri-core:start */';
const endMarker = '/* tri-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\./.test(core), 'the core stays free of DOM and browser access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TriCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');

const DEG = Math.PI / 180;
const clamp = (value) => Math.max(-1, Math.min(1, value));
// Independent distance: the spherical law of cosines, not the page's atan2 form.
const R_KM = 6371;
const distanceKm = (lat1, lon1, lat2, lon2) => {
  const a = Math.sin(lat1 * DEG) * Math.sin(lat2 * DEG) +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
  return R_KM * Math.acos(clamp(a));
};
const bearings = (lat, lon, stations) => stations.map((s) => {
  const p1 = lat * DEG, p2 = s[0] * DEG, dl = (s[1] - lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
});
const rmsAt = (lat, lon, stations, measured) => {
  const values = stations.map((s, i) => distanceKm(lat, lon, s[0], s[1]) - measured[i]);
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
};
const stationsOf = (input) => [
  [Number(input.lat1), Number(input.lon1)],
  [Number(input.lat2), Number(input.lon2)],
  [Number(input.lat3), Number(input.lon3)]
];
const measuredOf = (input) => {
  const factor = C.UNITS[input.unit || 'km'].km;
  return [input.d1, input.d2, input.d3].map((value) => Number(value) * factor);
};

// ---- Catalog replay: every golden and boundary case, then every refusal.
let goldens = 0;
let boundaries = 0;
let refusals = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    refusals += 1;
    assert.throws(() => C.analyze(testCase.input), { message: testCase.expectedError }, testCase.name);
    continue;
  }
  const result = C.analyze(testCase.input);
  const expected = testCase.expected;
  goldens += testCase.kind === 'golden' ? 1 : 0;
  boundaries += testCase.kind === 'boundary' ? 1 : 0;

  assert.ok(Math.abs(result.fixLat - expected.fixLat) < 2e-5, 'latitude: ' + testCase.name);
  assert.ok(Math.abs(result.fixLon - expected.fixLon) < 2e-5, 'longitude: ' + testCase.name);
  assert.equal(C.formatCoordinate(result.fixLat, result.fixLon), expected.coordinate, testCase.name);
  assert.equal(C.formatRms(result.rmsKm), expected.rmsText, testCase.name);
  assert.deepEqual(Array.from(result.residualsKm, (km) => C.formatResidual(km)), expected.residuals, testCase.name);
  assert.equal(Number(C.formatFactor(result.geometryFactor)), expected.geometryFactor, testCase.name);
  assert.equal(result.geometryLabel, expected.geometryLabel, testCase.name);
  assert.equal(result.unit, expected.unit, testCase.name);

  // The reported point must be at least as good as anything on a grid around
  // it, and its residual must agree with an independently measured distance.
  const stations = stationsOf(testCase.input);
  const measured = measuredOf(testCase.input);
  const best = rmsAt(result.fixLat, result.fixLon, stations, measured);
  for (let dLat = -0.02; dLat <= 0.0201; dLat += 0.002) {
    for (let dLon = -0.02; dLon <= 0.0201; dLon += 0.002) {
      const probe = rmsAt(result.fixLat + dLat, result.fixLon + dLon, stations, measured);
      assert.ok(probe >= best - 0.0005, 'a nearby point fits better: ' + testCase.name);
    }
  }
  // Geometry factor recomputed from the bearing rows, independently.
  const rows = bearings(result.fixLat, result.fixLon, stations).map((b) => {
    const angle = b * DEG;
    return [-Math.sin(angle), -Math.cos(angle)];
  });
  const a11 = rows.reduce((sum, r) => sum + r[0] * r[0], 0);
  const a12 = rows.reduce((sum, r) => sum + r[0] * r[1], 0);
  const a22 = rows.reduce((sum, r) => sum + r[1] * r[1], 0);
  const det = a11 * a22 - a12 * a12;
  const factor = Math.sqrt((a11 + a22) / det);
  assert.ok(Math.abs(factor - result.geometryFactor) < 1e-9, 'geometry factor: ' + testCase.name);
  for (const km of result.residualsKm) assert.ok(Math.abs(km * 1000) < 0.1, 'residual under 0.1 m');
}
assert.equal(entry.testCases.length, 18, 'eighteen catalog cases');
assert.equal(goldens, 6, 'six golden cases');
assert.equal(boundaries, 3, 'three boundary cases');
assert.equal(refusals, 9, 'nine refusals');

// ---- Units: the same geometry in each unit gives the same fix.
const base = {
  unit: 'km',
  lat1: '51.4779', lon1: '-0.0015', d1: '9.3390',
  lat2: '51.3762', lon2: '-0.0982', d2: '14.7323',
  lat3: '51.6565', lon3: '-0.3903', d3: '24.5732'
};
const inKm = C.analyze(base);
for (const [unit, factor] of [['nm', 1.852], ['mi', 1.609344]]) {
  const converted = Object.assign({}, base, {
    unit,
    d1: (9.3390 / factor).toFixed(4),
    d2: (14.7323 / factor).toFixed(4),
    d3: (24.5732 / factor).toFixed(4)
  });
  const result = C.analyze(converted);
  assert.ok(distanceKm(inKm.fixLat, inKm.fixLon, result.fixLat, result.fixLon) < 2e-3, 'unit independent fix: ' + unit);
  assert.equal(result.unit, unit);
  assert.ok(/NM|mi$/.test(C.formatDistance(result.computedKm[0], unit)), 'distance label');
}

// ---- Determinism and starting-guess independence.
const first = C.analyze(base);
for (let i = 0; i < 3; i += 1) {
  const again = C.analyze(base);
  assert.equal(again.fixLat, first.fixLat);
  assert.equal(again.fixLon, first.fixLon);
}

// ---- The antimeridian is not a discontinuity: a fix just west of 180.
const wrapStations = [[0.5, 179.8], [-0.4, 179.0], [0.2, -179.9]];
const wrapPoint = [0.1, 179.95];
const wrapDistances = wrapStations.map((s) => C.distanceKm(wrapPoint[0], wrapPoint[1], s[0], s[1]).toFixed(4));
const wrap = C.analyze({
  unit: 'km',
  lat1: String(wrapStations[0][0]), lon1: String(wrapStations[0][1]), d1: wrapDistances[0],
  lat2: String(wrapStations[1][0]), lon2: String(wrapStations[1][1]), d2: wrapDistances[1],
  lat3: String(wrapStations[2][0]), lon3: String(wrapStations[2][1]), d3: wrapDistances[2]
});
assert.ok(wrap.fixLon > 170 && wrap.fixLon <= 180, 'longitude stays in range: ' + wrap.fixLon);
assert.ok(distanceKm(wrapPoint[0], wrapPoint[1], wrap.fixLat, wrap.fixLon) < 1e-3, 'fix across the antimeridian');
assert.match(C.formatCoordinate(wrap.fixLat, wrap.fixLon), /\u00b0 E$/);

// ---- Input hygiene: comma decimals, whitespace and a leading plus sign.
const loose = C.analyze({
  unit: ' km ',
  lat1: ' 51,4779 ', lon1: ' -0,0015 ', d1: ' 9,3390 ',
  lat2: '51.3762', lon2: '-0.0982', d2: '14.7323',
  lat3: '51.6565', lon3: '-0.3903', d3: '+24.5732'
});
assert.ok(Math.abs(loose.fixLat - 51.5074) < 2e-5, 'comma decimals accepted');

// ---- Refusals the catalog does not pin: inconsistent ranges and units.
let inconsistentError = null;
try { C.analyze(Object.assign({}, base, { d3: '30.0000' })); } catch (error) { inconsistentError = error; }
assert.ok(inconsistentError, 'inconsistent ranges are refused');
assert.match(inconsistentError.message, /do not meet at one point/);
assert.match(inconsistentError.message, /root-mean-square residual of \d+ m/);
assert.throws(() => C.analyze(Object.assign({}, base, { unit: 'ft' })), /Choose kilometres, nautical miles or statute miles/);
assert.throws(() => C.analyze(Object.assign({}, base, { d1: '-1' })), /must be greater than zero/);
assert.throws(() => C.analyze(Object.assign({}, base, { lon1: '1e2' })), /exponent notation/);
assert.throws(() => C.analyze(Object.assign({}, base, { d2: '' })), /Enter the station 2 distance/);

// ---- Catalog growth, category balance and uniqueness.
assert.equal(catalog.tools.length, 2524, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2263, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Geography').length, 57, 'Geography count');
assert.equal(entry.category, 'Geography');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(Array.isArray(entry.sources) && entry.sources.length === 0, 'bespoke arithmetic carries no invented citation');
assert.match(entry.added, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

// The new record must not reuse another tool's slug, name or alias; the
// catalog already contains some older duplicated alias strings, so the check
// is scoped to what this page introduces.
const otherNames = new Set();
const otherAliases = new Set();
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  otherNames.add(tool.name.toLowerCase());
  for (const alias of tool.aliases) otherAliases.add(alias.toLowerCase());
}
assert.ok(!otherNames.has(entry.name.toLowerCase()), 'the name is new');
assert.ok(!otherAliases.has(entry.name.toLowerCase()), 'the name is not another tool alias');
for (const alias of entry.aliases) {
  assert.ok(!otherNames.has(alias.toLowerCase()), 'alias collides with a name: ' + alias);
  assert.ok(!otherAliases.has(alias.toLowerCase()), 'alias collides with an alias: ' + alias);
}

// ---- Page contract: shared shell, no network, honest labels.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<h1>Trilateration Position Fix Calculator<\/h1>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.ok(!/https?:\/\//.test(html), 'the page makes no outbound references');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(!/cdn|unpkg|jsdelivr/i.test(html), 'no CDN');
assert.match(html, /id="out"[^>]*aria-live="polite"/);
assert.match(html, /role="alert"/);
assert.ok(!fs.existsSync(path.join(root, 'data/i18n/tools/de', slug + '.json')), 'no invented German memory');
assert.ok(!fs.existsSync(path.join(root, 'data/i18n/tools/es', slug + '.json')), 'no invented Spanish memory');

console.log('trilateration-position-fix: ' + (goldens + boundaries) + ' fit cases and ' + refusals + ' refusals passed');
