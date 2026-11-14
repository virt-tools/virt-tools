/* Regression checks for the grid convergence calculator core: a Krüger-series
   transverse Mercator oracle, the catalog cases, formatting, the accepted band
   and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'grid-convergence-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* gridconv-core:start */');
const end = html.indexOf('/* gridconv-core:end */');
assert.ok(start > -1 && end > start, 'grid convergence core markers missing');
const core = html.slice(start, end + '/* gridconv-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GridConvCore;', sandbox);
const C = sandbox.module.exports;

/* Independent reference: Karney's Krüger n-series transverse Mercator forward
   projection (a different formulation from the page's series in delta lambda),
   differentiated along the meridian to recover the convergence angle. */
const A_WGS84 = 6378137.0;
const F_WGS84 = 1 / 298.257223563;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
function tmForward(lat, dLon) {
  const n = F_WGS84 / (2 - F_WGS84);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const A = (A_WGS84 / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
    (61 * n3) / 240 - (103 * n4) / 140,
    (49561 * n4) / 161280,
  ];
  const phi = lat * RAD;
  const dl = dLon * RAD;
  const e = Math.sqrt(F_WGS84 * (2 - F_WGS84));
  const tau = Math.tan(phi);
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.sqrt(1 + tau * tau)));
  const tauPrime = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
  const xi = Math.atan2(tauPrime, Math.cos(dl));
  const eta = Math.asinh(Math.sin(dl) / Math.sqrt(tauPrime * tauPrime + Math.cos(dl) * Math.cos(dl)));
  let xiSum = xi;
  let etaSum = eta;
  for (let j = 1; j <= 4; j += 1) {
    xiSum += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaSum += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  return { easting: A * etaSum, northing: A * xiSum };
}
function oracleConvergence(lat, dLon, delta) {
  const step = delta === undefined ? 1e-6 : delta;
  const north = tmForward(lat + step, dLon);
  const south = tmForward(lat - step, dLon);
  return -Math.atan2(north.easting - south.easting, north.northing - south.northing) * DEG;
}

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) <= (epsilon === undefined ? 1e-6 : epsilon),
  `${label}: ${actual} vs ${expected}`
);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2262, 'catalog total');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record present');
assert.equal(entry.name, 'Grid Convergence Calculator');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.length > 500, 'method explains the model');
assert.ok(entry.sources.length >= 3, 'sources cite the projection references');
assert.ok(entry.testCases.length >= 28, 'catalog cases cover golden values and refusals');
assert.ok(html.includes('<meta name="description" content="Find the grid convergence'), 'page description');
assert.ok(html.includes('Grid Convergence Calculator</h1>'), 'page heading');

// Names, aliases and tags are unique across the catalog.
const nameClash = catalog.tools.filter((tool) => tool.slug !== slug)
  .some((tool) => tool.name === entry.name);
assert.equal(nameClash, false, 'name is unique');
for (const alias of entry.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === alias || (tool.aliases || []).includes(alias));
  assert.equal(clash, false, `alias is unique: ${alias}`);
}
for (const tag of entry.tags) {
  assert.equal(typeof tag, 'string');
  assert.ok(tag.length > 0);
}
assert.ok(entry.tags.includes('grid-convergence') && entry.tags.includes('utm'));

// Every catalog case replays through the page core; refusals match word for word.
const NUMERIC = ['centralMeridian', 'deltaLon', 'convergence', 'gridAzimuth', 'trueAzimuth'];
let golden = 0;
let refusals = 0;
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.kind === 'validation') {
    refusals += 1;
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
  golden += 1;
  const result = C.analyze(Object.assign({}, testCase.input));
  for (const key of NUMERIC) closeTo(result[key], testCase.expected[key], `${label}: ${key}`, 3e-6);
  assert.equal(result.convergenceDirection, testCase.expected.gridNorth, `${label}: grid north`);
  assert.equal(result.outsideZone, testCase.expected.outsideZone, `${label}: outside band flag`);
  assert.equal(result.zoneLabel, `${result.zone} ${result.hemisphere}`, `${label}: zone label`);
}
assert.equal(golden, 15, 'golden case count');
assert.equal(refusals, 16, 'refusal case count');

// The catalog's golden values came from the Krüger projection, not from the
// page's series, so this sweep checks the two formulations against each other.
let worstInside = 0;
for (let lat = -78; lat <= 84; lat += 6) {
  for (let dLon = -3; dLon <= 3.001; dLon += 0.5) {
    const diff = Math.abs(C.convergence(lat, dLon) - oracleConvergence(lat, dLon));
    worstInside = Math.max(worstInside, diff);
    assert.ok(diff < 1e-6, `inside band at ${lat}, ${dLon}: ${diff}`);
  }
}
assert.ok(worstInside < 1e-6, 'series agrees with the projection inside the zone band');

// Out to the accepted outer limit the series stays inside a tenth of an arc second.
for (let lat = -78; lat <= 84; lat += 12) {
  for (const dLon of [-6, -5, -3.5, 3.5, 5, 6]) {
    const diff = Math.abs(C.convergence(lat, dLon) - oracleConvergence(lat, dLon));
    assert.ok(diff < 2.8e-5, `outer band at ${lat}, ${dLon}: ${(diff * 3600).toFixed(4)} arcsec`);
  }
}

// Endpoints and geometry: zero convergence on the central meridian and equator,
// and an antisymmetric longitude response.
assert.equal(C.convergence(45, 0), 0);
assert.equal(C.convergence(0, 3), 0);
closeTo(C.convergence(45, 3), -C.convergence(45, -3), 'antisymmetry', 1e-12);
closeTo(C.convergence(45, 3), -C.convergence(-45, 3), 'hemispheres', 1e-12);
assert.ok(C.convergence(60, 3) > C.convergence(30, 3), 'convergence grows with latitude');
assert.ok(C.convergence(45, 3) > C.convergence(45, 1), 'convergence grows with longitude offset');

// Zone arithmetic.
assert.equal(C.centralMeridian(30), -3);
assert.equal(C.centralMeridian(31), 3);
assert.equal(C.centralMeridian(1), -177);
assert.equal(C.centralMeridian(60), 177);
assert.equal(C.zoneFromLongitude(-0.0015), 30);
assert.equal(C.zoneFromLongitude(3), 31);
assert.equal(C.zoneFromLongitude(179.999), 60);
assert.equal(C.zoneFromLongitude(-179.999), 1);
assert.equal(C.zoneFromLongitude(180), 60);
assert.equal(C.analyze({ lat: 12, lon: 132, zone: '', bearing: 0 }).zone, 53, 'blank zone derived');

// Bearing conventions: true = grid + convergence, grid = true - convergence.
const greenwich = C.analyze({ lat: 51.4779, lon: -0.0015, zone: 30, bearing: 90, direction: 'true-to-grid' });
assert.equal(greenwich.convergenceDirection, 'east');
closeTo(greenwich.trueAzimuth, 90, 'true azimuth passthrough', 1e-12);
closeTo(greenwich.gridAzimuth, 90 - greenwich.convergence, 'grid azimuth', 1e-12);
const back = C.analyze({ lat: 51.4779, lon: -0.0015, zone: 30, bearing: greenwich.gridAzimuth, direction: 'grid-to-true' });
closeTo(back.trueAzimuth, 90, 'round trip through the grid azimuth', 1e-9);
assert.equal(C.analyze({ lat: 51.4779, lon: -0.0015, zone: 30, bearing: 0, direction: 'grid-to-true' }).trueAzimuth > 1.5, true);
assert.equal(C.analyze({ lat: 51.4779, lon: -0.0015, zone: 30, bearing: 358.6, direction: 'grid-to-true' }).trueAzimuth.toFixed(4), '0.9468');
assert.equal(C.analyze({ lat: 45, lon: 5, zone: 31, bearing: 360 }).trueAzimuth, 0);
assert.equal(C.analyze({ lat: 45, lon: 5, zone: 31, bearing: 360 }).gridAzimuth.toFixed(6), '358.585496');

// A zone whose meridian is far from the longitude is refused with a suggestion.
assert.throws(
  () => C.analyze({ lat: 40, lon: 0, zone: 33, bearing: 10 }),
  /^Error: This longitude is more than 6 degrees from the central meridian of zone 33\. Zone 31 contains it\.$/
);
assert.equal(C.analyze({ lat: 40, lon: -6.5, zone: 30, bearing: 90 }).outsideZone, true);
assert.equal(C.analyze({ lat: 40, lon: -6, zone: 30, bearing: 90 }).outsideZone, false);
assert.equal(C.analyze({ lat: -33.8688, lon: 145, zone: 55, bearing: 0 }).outsideZone, false);

// Formatting follows the page's display conventions.
assert.equal(C.formatDms(2.346768), '2\u00b020\u203248\u2033 E');
assert.equal(C.formatDms(-2.1223), '2\u00b007\u203220\u2033 W');
assert.equal(C.formatDms(0), '0\u00b000\u203200\u2033');
assert.equal(C.formatLongitude(-3), '3\u00b0W');
assert.equal(C.formatLongitude(9), '9\u00b0E');
assert.equal(C.formatSigned(2.9985, 4), '+2.9985\u00b0');
assert.equal(C.formatSigned(-2.1223, 4), '\u22122.1223\u00b0');
assert.equal(C.formatSigned(-0.00001, 4), '0.0000\u00b0');
assert.equal(C.formatAzimuth(87.653), '087.7\u00b0');
assert.equal(C.formatAzimuth(358.585), '358.6\u00b0');
assert.equal(C.formatAzimuth(0), '000.0\u00b0');
assert.equal(C.formatConvergence(greenwich), '2.3468\u00b0 east');
assert.equal(C.formatConvergence(C.analyze({ lat: 0, lon: 3, zone: 31, bearing: 0 })), '0.0000\u00b0');
assert.equal(greenwich.gridNorthText, 'grid north lies 2\u00b020\u203248\u2033 east of true north');
assert.equal(
  C.copyText(greenwich),
  'Grid convergence 2.3468\u00b0 east (grid north lies 2\u00b020\u203248\u2033 east of true north) in zone 30 N, ' +
  'central meridian 3\u00b0W. True azimuth 090.0\u00b0, grid azimuth 087.7\u00b0.'
);
assert.ok(!C.copyText(greenwich).includes('undefined') && !C.copyText(greenwich).includes('NaN'));

// Blank input is refused rather than silently defaulted.
assert.throws(() => C.analyze({}), /^Error: Enter the latitude\.$/);

// The page stays offline: no network, storage or raw-HTML sinks.
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write', 'onclick=']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
assert.ok(html.includes('id="site-header"'), 'shared header mount missing');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('id="direction"') && html.includes('value="grid-to-true"'), 'direction selector missing');
assert.ok(html.includes('novalidate'), 'form should not rely on native validation');

console.log(`grid convergence calculator: ${entry.testCases.length} catalog cases (${golden} golden, ${refusals} refusals), oracle sweeps, formatting and page contract OK`);
