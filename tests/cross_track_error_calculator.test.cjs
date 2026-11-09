/* Regression checks for the cross-track error calculator core: an independent
   spherical-trigonometry oracle, the catalog cases, formatting and refusals. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/cross-track-error-calculator/index.html'), 'utf8');
const start = html.indexOf('/* xtk-core:start */');
const end = html.indexOf('/* xtk-core:end */');
assert.ok(start > -1 && end > start, 'cross-track core markers missing');
const core = html.slice(start, end + '/* xtk-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CrossTrackCore;', sandbox);
const C = sandbox.module.exports;

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Independent transcription of the documented method with spherical
// trigonometry (haversine, bearing, destination) rather than the page's
// unit-vector projection, so a shared algebra mistake cannot hide.
function centralAngle(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dp = p2 - p1;
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
function destPoint(lat, lon, bearing, distanceKm) {
  const d = distanceKm / R;
  const p1 = rad(lat);
  const l1 = rad(lon);
  const brg = rad(bearing);
  const p2 = Math.asin(clamp(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg), -1, 1));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  let lonOut = deg(l2);
  lonOut = ((lonOut + 540) % 360) - 180;
  return { lat: deg(p2), lon: lonOut };
}

function oracle(input) {
  const n = (v) => Number(String(v).trim().replace(',', '.'));
  const slat = n(input.startLat), slon = n(input.startLon);
  const elat = n(input.endLat), elon = n(input.endLon);
  const plat = n(input.posLat), plon = n(input.posLon);
  const routeRad = centralAngle(slat, slon, elat, elon);
  const d13 = centralAngle(slat, slon, plat, plon);
  const t12 = rad(bearingDeg(slat, slon, elat, elon));
  const t13 = rad(bearingDeg(slat, slon, plat, plon));
  const xtRad = Math.asin(clamp(Math.sin(d13) * Math.sin(t13 - t12), -1, 1));
  let alongRad = Math.acos(clamp(Math.cos(d13) / Math.cos(xtRad), -1, 1));
  if (Math.cos(t13 - t12) < 0) alongRad = -alongRad;
  const routeKm = routeRad * R;
  const alongKm = alongRad * R;
  const clamped = clamp(alongKm, 0, routeKm);
  const nearest = destPoint(slat, slon, deg(t12), clamped);
  const crossKm = xtRad * R;
  return {
    routeKm,
    crossTrackKm: crossKm,
    alongTrackKm: alongKm,
    stillToRunKm: Math.max(0, routeKm - alongKm),
    toEndKm: centralAngle(plat, plon, elat, elon) * R,
    distanceToRouteKm: centralAngle(plat, plon, nearest.lat, nearest.lon) * R,
    nearestLat: nearest.lat,
    nearestLon: nearest.lon,
    trackBearing: deg(t12),
    bearingToPosition: deg(t13),
    side: crossKm > 0.0005 ? 'right' : crossKm < -0.0005 ? 'left' : 'on',
    relation: alongRad < 0 ? 'behind' : alongRad > routeRad ? 'beyond' : 'ahead',
  };
}

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-6 : epsilon),
  `${label}: ${actual} vs ${expected}`
);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'cross-track-error-calculator');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 24, `expected at least 24 cases, found ${entry.testCases.length}`);

const NUMERIC = ['routeKm', 'crossTrackKm', 'alongTrackKm', 'stillToRunKm', 'toEndKm', 'distanceToRouteKm', 'nearestLat', 'nearestLon', 'trackBearing', 'bearingToPosition'];

// Every catalog case replays through the page core, and refusals match exactly.
let goldenCount = 0;
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.analyze(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  goldenCount += 1;
  const result = C.analyze(Object.assign({}, testCase.input));
  for (const key of NUMERIC) closeTo(result[key], testCase.expected[key], `${label}: ${key}`, 1e-5);
  assert.equal(result.side, testCase.expected.side, `${label}: side`);
  assert.equal(result.relation, testCase.expected.relation, `${label}: relation`);
}
assert.ok(goldenCount >= 15, `expected at least 15 golden cases, found ${goldenCount}`);

// The independent trig oracle agrees with the vector core across the catalog
// and across a grid of positions, including behind, beyond and on-track.
const grid = [
  { startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: -0.4, posLon: 0.3 },
  { startLat: 51.5, startLon: -0.1, endLat: 48.85, endLon: 2.35, posLat: 50.2, posLon: 1.4 },
  { startLat: -33.9, startLon: 151.2, endLat: -37.8, endLon: 144.9, posLat: -36.9, posLon: 146.0 },
  { startLat: 10, startLon: 179.5, endLat: 10, endLon: -179.5, posLat: 9.7, posLon: -179.9 },
  { startLat: 70, startLon: 20, endLat: 70, endLon: 30, posLat: 69.6, posLon: 24.0 },
  { startLat: 0, startLon: 0, endLat: 45, endLon: 80, posLat: 60, posLon: 40 },
  { startLat: -20, startLon: 30, endLat: -10, endLon: 60, posLat: -25, posLon: 25 },
  { startLat: 40, startLon: -100, endLat: 40, endLon: -80, posLat: 40.5, posLon: -90 },
];
for (const input of grid) {
  const expected = oracle(input);
  const actual = C.analyze(input);
  for (const key of NUMERIC) closeTo(actual[key], expected[key], `grid ${JSON.stringify(input)}: ${key}`, 2e-6);
  assert.equal(actual.side, expected.side, `grid side ${JSON.stringify(input)}`);
  assert.equal(actual.relation, expected.relation, `grid relation ${JSON.stringify(input)}`);
}

// Sign convention: right of an eastbound course is positive, left is negative.
assert.equal(C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: -0.5, posLon: 0.5 }).side, 'right');
assert.ok(C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: -0.5, posLon: 0.5 }).crossTrackKm > 0);
assert.equal(C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: 0.5, posLon: 0.5 }).side, 'left');
assert.ok(C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: 0.5, posLon: 0.5 }).crossTrackKm < 0);

// Behind and beyond states clamp the nearest point and the remaining route.
const behind = C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 2, posLat: 0, posLon: -0.5 });
assert.equal(behind.relation, 'behind');
assert.ok(behind.alongTrackKm < 0);
assert.equal(behind.nearestLat, 0);
assert.equal(behind.nearestLon, 0);
assert.ok(behind.stillToRunKm > behind.routeKm);
const beyond = C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 1, posLat: 0, posLon: 1.5 });
assert.equal(beyond.relation, 'beyond');
assert.equal(beyond.stillToRunKm, 0);
assert.equal(beyond.nearestLon, 1);

// Formatting is fixed to the documented display conventions.
assert.equal(C.formatKm(1234.5), '1,234.50 km');
assert.equal(C.formatKm(-29.081598), '-29.08 km');
assert.equal(C.formatKm(-0.004), '0.00 km');
assert.equal(C.formatNm(29.081598), '15.70 NM');
assert.equal(C.formatBearing(222.332863), '222.3\u00b0 true');
assert.equal(C.formatBearing(5.04), '005.0\u00b0 true');
assert.equal(C.formatCoordinate(50.274948, -1.803633), '50.2749\u00b0 N, 1.8036\u00b0 W');
assert.equal(C.formatCoordinate(0, 0), '0.0000\u00b0 N, 0.0000\u00b0 E');
assert.equal(C.formatCoordinate(-33.9, 151.2), '33.9000\u00b0 S, 151.2000\u00b0 E');

// The copyable summary names the side, both distances and the nearest point.
const channel = C.analyze({ startLat: 50.7, startLon: -1.2, endLat: 49.4, endLon: -3, posLat: 50.1, posLon: -1.5 });
assert.equal(
  C.copyText(channel),
  '29.08 km left of track (15.70 NM). Along track 63.70 km of 193.41 km; nearest point 50.2749\u00b0 N, 1.8036\u00b0 W; 129.71 km still to run.'
);
const onTrack = C.analyze({ startLat: 0, startLon: 0, endLat: 0, endLon: 2, posLat: 0, posLon: 1 });
assert.match(C.copyText(onTrack), /^On track \(0\.00 NM\)\./);
assert.ok(!C.copyText(channel).includes('undefined') && !C.copyText(channel).includes('NaN'));

// Blank input is refused rather than silently defaulted.
assert.throws(() => C.analyze({}), /^Error: Enter the route start latitude\.$/);

// The page stays offline: no network, storage or raw-HTML sinks.
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
assert.ok(html.includes('id="site-header"'), 'shared header mount missing');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');

console.log(`cross-track error calculator: ${entry.testCases.length} catalog cases, ${grid.length} oracle grid cases, formatting and refusals OK`);
