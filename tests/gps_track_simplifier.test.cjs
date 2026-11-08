/* Regression checks for the GPS track simplifier: every catalogued case run
   against the page's own core, an independent brute-force proof that no dropped
   point is farther than the tolerance from the simplified line, a deterministic
   grid over tracks and tolerances, and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gps-track-simplifier';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* gpstrack-core:start */');
const end = html.indexOf('/* gpstrack-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GpsTrackCore;', sandbox);
const C = sandbox.module.exports;

const RAD = Math.PI / 180;
const EARTH = 6371008.8;
const run = (input) => C.run(input);
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent distance helpers for the proof, written without the page's code.
function metresBetween(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(Math.min(1, h)));
}
function metresToSegment(point, a, b) {
  const scale = Math.cos(((a[0] + b[0]) / 2) * RAD);
  const px = point[1] * RAD * EARTH * scale;
  const py = point[0] * RAD * EARTH;
  const ax = a[1] * RAD * EARTH * scale;
  const ay = a[0] * RAD * EARTH;
  const bx = b[1] * RAD * EARTH * scale;
  const by = b[0] * RAD * EARTH;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  }
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distanceToPolyline(point, line) {
  if (line.length === 1) return metresBetween(point, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i += 1) best = Math.min(best, metresToSegment(point, line[i - 1], line[i]));
  return best;
}
function polylineLength(line) {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) total += metresBetween(line[i - 1], line[i]);
  return total;
}

// --- contract of the page itself -------------------------------------------
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="simplify-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('novalidate'), 'form must let the tool report its own errors');
for (const id of ['track', 'tolerance']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + id + '-help"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'secondary buttons must not submit the form');
assert.ok(html.includes('area.readOnly = true'), 'output must be read-only');
assert.ok(/<textarea[^>]+id="in-track"[^>]*>/.test(html), 'track textarea missing');

// --- catalog entry -----------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'GPS Track Simplifier');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must explain the algorithm and limits');
assert.ok(entry.sources.length >= 2, 'expected at least two sources');
for (const source of entry.sources) assert.ok(/^https:\/\//.test(source.url), 'source URL missing');
assert.ok(entry.testCases.length >= 28, 'expected at least twenty-eight catalog cases');
for (const kind of ['golden', 'boundary', 'validation']) {
  assert.ok(entry.testCases.some((testCase) => testCase.kind === kind), 'missing ' + kind + ' case');
}
// The page's default textarea content must be the catalogued sample track.
const sampleStart = html.indexOf('<textarea id="in-track"');
const sampleText = html.slice(html.indexOf('>', sampleStart) + 1, html.indexOf('</textarea>', sampleStart));
const sampleCase = entry.testCases.find((testCase) => testCase.name.startsWith('Default sample GPX'));
assert.equal(sampleText.trim(), sampleCase.input.text.trim(), 'page sample must be the catalogued sample track');

// --- every catalogued case ----------------------------------------------------
const numericFields = ['lengthBeforeM', 'lengthAfterM', 'maxDroppedOffsetM'];
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  const expected = testCase.expected;
  for (const field of ['format', 'inputPoints', 'keptCount', 'removedCount', 'reductionPercent', 'shrinkPercent']) {
    assert.equal(result[field], expected[field], testCase.name + ' ' + field);
  }
  for (const field of numericFields) {
    assert.ok(Math.abs(result[field] - expected[field]) <= 0.051,
      testCase.name + ' ' + field + ' got ' + result[field] + ' expected ' + expected[field]);
  }
  assert.equal(result.warnings.length, expected.warningCount, testCase.name + ' warnings');
  assert.equal(JSON.stringify(result.kept), JSON.stringify(expected.kept), testCase.name + ' kept points');
  assert.equal(result.geojson, JSON.stringify({
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: expected.kept.map(([lat, lon]) => [lon, lat]) }
  }), testCase.name + ' geojson');
  // The simplified track must actually be a subset of the input, in order.
  const parsed = C.parse(testCase.input.text).points;
  let cursor = 0;
  for (const [lat, lon] of result.kept) {
    let found = -1;
    for (let index = cursor; index < parsed.length; index += 1) {
      if (Math.abs(parsed[index][0] - lat) < 1e-6 && Math.abs(parsed[index][1] - lon) < 1e-6) { found = index; break; }
    }
    assert.ok(found >= 0, testCase.name + ' kept point is not an input point in order');
    cursor = found + 1;
  }
  assert.equal(result.kept[0][0], Math.round(parsed[0][0] * 1e6) / 1e6, testCase.name + ' first point kept');
  assert.equal(result.kept[result.kept.length - 1][1], Math.round(parsed[parsed.length - 1][1] * 1e6) / 1e6,
    testCase.name + ' last point kept');
  if (result.kept.length > 2) {
    for (const point of parsed) {
      assert.ok(distanceToPolyline(point, result.kept) <= result.tolerance + 0.01,
        testCase.name + ' dropped point is farther than the tolerance');
    }
  }
  assert.ok(result.lengthAfterM <= result.lengthBeforeM + 0.05, testCase.name + ' length must not grow');
  assert.ok(Math.abs(polylineLength(result.kept) - result.lengthAfterM) <= 0.6,
    testCase.name + ' reported length must match the kept polyline');
  assert.equal(result.removedCount, result.inputPoints - result.keptCount);
  if (result.shrinkPercent > 5) assert.equal(result.warnings.length, 1, testCase.name + ' shrink warning');
}

// --- deterministic grid ------------------------------------------------------
let rows = 0;
function makeTrack(kind, count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    let lat, lon;
    if (kind === 'arc') {
      lat = 48.1000 + 0.0200 * t;
      lon = -121.9000 + 0.0300 * Math.sin(Math.PI * t);
    } else if (kind === 'zigzag') {
      lat = 35.0000 + 0.0008 * i;
      lon = 139.0000 + 0.0010 * (i % 3);
    } else if (kind === 'line') {
      lat = -12.0000 + 0.0012 * i;
      lon = 130.0000 - 0.0009 * i;
    } else {
      lat = 64.1000 + 0.0006 * i + 0.00002 * Math.sin(i * 3.1);
      lon = -21.8000 + 0.0004 * i + 0.00002 * Math.cos(i * 1.7);
    }
    points.push([Number(lat.toFixed(6)), Number(lon.toFixed(6))]);
  }
  return '#' + kind + '\n' + points.map(([a, b]) => a.toFixed(6) + ', ' + b.toFixed(6)).join('\n');
}
function checkTrack(kind, count, tolerance) {
  const text = makeTrack(kind, count);
  const parsed = C.parse(text).points;
  const result = run({ text, tolerance: String(tolerance) });
  assert.equal(result.format, 'Coordinate list');
  assert.equal(result.inputPoints, parsed.length);
  assert.equal(result.keptCount + result.removedCount, parsed.length);
  assert.equal(result.kept[0][0], parsed[0][0]);
  assert.ok(result.keptCount >= 2, 'endpoints always kept');
  if (result.kept.length > 2) {
    for (const point of parsed) {
      assert.ok(distanceToPolyline(point, result.kept) <= tolerance + 0.05,
        kind + ' dropped point beyond tolerance at ' + tolerance + ' m');
    }
  }
  for (let i = 1; i < result.kept.length; i += 1) {
    assert.ok(result.kept[i][0] >= result.kept[i - 1][0] - 1e-6 || result.kept[i][1] >= result.kept[i - 1][1] - 1e-6,
      'kept order must follow the input');
  }
  if (result.kept.length > 2) {
    for (let i = 1; i < result.kept.length; i += 1) {
      const a = parsed.find((point) => point[0] === result.kept[i - 1][0] && point[1] === result.kept[i - 1][1]);
      const b = parsed.find((point) => point[0] === result.kept[i][0] && point[1] === result.kept[i][1]);
      assert.ok(a && b, 'kept points come from the input');
    }
  }
  rows += 1;
  return result;
}
for (const kind of ['arc', 'zigzag', 'line', 'wobbly']) {
  for (const count of [2, 3, 8, 21, 60]) {
    let previousKept = Infinity;
    for (const tolerance of [0.5, 2, 5, 10, 25, 100]) {
      const result = checkTrack(kind, count, tolerance);
      assert.ok(result.keptCount <= previousKept + 2, 'larger tolerance must not keep many more points');
      previousKept = result.keptCount;
    }
  }
}
assert.ok(rows >= 120, 'grid must cover at least a hundred and twenty rows, got ' + rows);

// A larger tolerance never keeps more points than a smaller one on one track.
const track = makeTrack('wobbly', 80);
const ladder = [0.5, 1, 2, 4, 8, 16, 32, 64, 128].map((tolerance) => run({ text: track, tolerance: String(tolerance) }).keptCount);
for (let i = 1; i < ladder.length; i += 1) assert.ok(ladder[i] <= ladder[i - 1], 'kept count must be monotone in the tolerance');
assert.ok(ladder[0] >= 30 && ladder[0] <= 80, 'a half-metre tolerance keeps most vertices, got ' + ladder[0]);
assert.ok(ladder[3] < ladder[0], 'a four-metre tolerance must drop more points than a half-metre one');
assert.equal(ladder[ladder.length - 1], 2, 'a large tolerance leaves the endpoints');

// Antipodal-scale longitude wrap: points either side of the date line stay short.
const wrap = run({ text: '-16.5, 179.9990\n-16.5, 179.9995\n-16.5, -179.9998', tolerance: '5' });
assert.ok(wrap.lengthBeforeM < 130, 'the date line must not add a false world-spanning leg, got ' + wrap.lengthBeforeM);
assert.ok(wrap.lengthBeforeM > 90, 'the wrapped leg must still be measured, got ' + wrap.lengthBeforeM);

// Duplicate runs collapse even at the smallest tolerance, and a two-point track never changes.
assert.equal(run({ text: '1,1\n1,1\n1,1\n2,2', tolerance: '0.001' }).keptCount, 2);
assert.equal(run({ text: '1,1\n2,2', tolerance: '100000' }).keptCount, 2);
assert.equal(run({ text: '1,1\n2,2', tolerance: '100000' }).removedCount, 0);

// Refusals name the problem and never fall through with a wrong answer.
assert.match(failure({ text: '47.6,-122.4\n47.7,-122.4', tolerance: '0' }), /greater than zero/);
assert.match(failure({ text: '47.6,-122.4\n47.7,-122.4', tolerance: '-1' }), /greater than zero/);
assert.match(failure({ text: '47.6,-122.4\n47.7,-122.4', tolerance: 'abc' }), /Enter a tolerance/);
assert.match(failure({ text: '47.6,-122.4\n47.7,-122.4', tolerance: '100000.5' }), /100 km/);
assert.match(failure({ text: '91,0\n0,0', tolerance: '1' }), /outside -90 to 90/);
assert.match(failure({ text: '0,181\n0,0', tolerance: '1' }), /outside -180 to 180/);
assert.match(failure({ text: '0,0', tolerance: '1' }), /At least two points/);
assert.match(failure({ text: '<gpx></gpx>', tolerance: '1' }), /No GPX/);
assert.match(failure({ text: '{"type":"Polygon","coordinates":[]}', tolerance: '1' }), /Polygon/);
assert.match(failure({ text: '{"type":"LineString","coordinates":[[0,0],[1]]}', tolerance: '1' }), /Coordinate 2/);
assert.match(failure({ text: 'not a track', tolerance: '1' }), /Line 1 has a value that is not a number/);

// The point cap is enforced before any work is done.
const huge = new Array(C.MAX_POINTS + 1).fill('0,0').join('\n');
assert.match(failure({ text: huge, tolerance: '1' }), /more than 20000 points/);
assert.equal(C.MAX_TOLERANCE, 100000);
assert.equal(C.MAX_POINTS, 20000);
assert.equal(C.EARTH_RADIUS, 6371008.8);

console.log('GPS track simplifier: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows, monotonicity, date-line, cap and offline invariants passed');
