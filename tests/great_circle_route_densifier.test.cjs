/* Great-circle route densifier: replay every catalog fixture against the page
   core, pin two published intermediate points, and compare random interpolation
   with an independent Rodrigues-rotation oracle. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'great-circle-route-densifier';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* route-densifier-core:start */');
const end = html.indexOf('/* route-densifier-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = RouteDensifierCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Great-Circle Route Densifier');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Conversion & generation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must document arithmetic and limits');
assert.equal(entry.sources.length, 3);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 18, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 5);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 10);

function failure(input) {
  try { C.run(input); } catch (error) { return error.message; }
  return null;
}
function close(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), label + ' is not finite: ' + actual);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': got ' + actual + ', expected ' + expected + ' ±' + tolerance);
}
function inputOf(testCase) {
  return {
    text: Object.prototype.hasOwnProperty.call(testCase.input, 'text') ? testCase.input.text : '51.5074, -0.1278\n48.8566, 2.3522\n52.5200, 13.4050',
    spacingKm: Object.prototype.hasOwnProperty.call(testCase.input, 'spacingKm') ? testCase.input.spacingKm : '100'
  };
}

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (['inputCount', 'outputCount', 'addedCount', 'zeroLegs'].includes(field)) {
      assert.equal(result[field], expected, testCase.name + ' ' + field);
    } else {
      close(result[field], expected, 1e-8, testCase.name + ' ' + field);
    }
  }
  const input = inputOf(testCase);
  const original = C.parsePoints(input.text);
  assert.equal(result.inputCount, original.length, testCase.name + ' input count');
  assert.equal(result.outputCount, result.points.length, testCase.name + ' output array');
  assert.equal(result.addedCount, result.outputCount - result.inputCount, testCase.name + ' added count');
  assert.ok(result.outputCount <= 20000, testCase.name + ' output cap');
  assert.deepEqual(Array.from(result.points[0]), Array.from(original[0]), testCase.name + ' first waypoint');
  let cursor = 0;
  for (let i = 0; i < result.legs.length; i += 1) {
    const leg = result.legs[i];
    cursor += leg.steps;
    assert.deepEqual(Array.from(result.points[cursor]), Array.from(original[i + 1]), testCase.name + ' waypoint ' + (i + 1));
    const lengths = [];
    for (let j = cursor - leg.steps + 1; j <= cursor; j += 1) {
      const distance = C.distanceKm(result.points[j - 1], result.points[j]);
      assert.ok(distance <= result.spacingKm + 1e-7, testCase.name + ' generated step exceeds spacing');
      lengths.push(distance);
    }
    for (const distance of lengths) close(distance, lengths[0], 1e-7, testCase.name + ' unequal steps within original leg');
  }
  close(result.generatedDistanceKm, result.totalDistanceKm, 1e-6, testCase.name + ' generated route distance');
  const geojson = JSON.parse(result.geojson);
  assert.equal(geojson.type, 'LineString');
  assert.equal(geojson.coordinates.length, result.outputCount);
  geojson.coordinates.forEach((pair, index) => {
    close(pair[0], result.points[index][1], 5.1e-7, testCase.name + ' GeoJSON longitude');
    close(pair[1], result.points[index][0], 5.1e-7, testCase.name + ' GeoJSON latitude');
  });
}

// The sample in the markup and the core defaults must not drift apart.
const sampleStart = html.indexOf('<textarea id="route"');
const sample = html.slice(html.indexOf('>', sampleStart) + 1, html.indexOf('</textarea>', sampleStart));
assert.equal(C.run({ text: sample, spacingKm: '100' }).geojson, C.run({}).geojson, 'default sample differs');

// Published examples from the two independent sources recorded in the catalog.
const movableType = C.intermediate([52.205, 0.119], [48.857, 2.351], 0.25);
close(movableType[0], 51.3721, 0.00005, 'Movable Type latitude');
close(movableType[1], 0.7073, 0.00005, 'Movable Type longitude');
const geoprims = C.intermediate([40.6413, -73.7781], [51.47, -0.4543], 0.25);
close(geoprims[0], 47.5784923, 1e-7, 'Geoprims latitude');
close(geoprims[1], -59.3177261, 1e-7, 'Geoprims longitude');

// Independent vector oracle: Rodrigues rotation about the normalized cross
// product, rather than the page's weighted-sum slerp expression.
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
function vector(point) {
  const lat = point[0] * RAD, lon = point[1] * RAD;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function oracle(a, b, fraction) {
  const u = vector(a), v = vector(b), w = cross(u, v);
  const sine = Math.hypot(...w), cosine = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const angle = Math.atan2(sine, cosine);
  if (angle < 1e-12) return a;
  const axis = w.map((value) => value / sine), crossed = cross(axis, u);
  const theta = fraction * angle, c = Math.cos(theta), s = Math.sin(theta);
  const q = u.map((value, index) => value * c + crossed[index] * s);
  return [Math.atan2(q[2], Math.hypot(q[0], q[1])) * DEG, Math.atan2(q[1], q[0]) * DEG];
}
let seed = 0x51a7c3;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
let randomChecks = 0;
for (let i = 0; i < 1000; i += 1) {
  const a = [random() * 178 - 89, random() * 360 - 180];
  const b = [random() * 178 - 89, random() * 360 - 180];
  const fraction = random();
  const angle = C.distanceKm(a, b) / 6371.0088;
  if (angle < 1e-7 || Math.PI - angle < 1e-7) continue;
  const actual = C.intermediate(a, b, fraction), expected = oracle(a, b, fraction);
  close(actual[0], expected[0], 2e-8, 'random latitude ' + i);
  close(actual[1], expected[1], 2e-8, 'random longitude ' + i);
  randomChecks += 1;
}
assert.equal(randomChecks, 1000);

// Integer-ratio spacing must not acquire an extra floating-point step.
for (let i = 0; i < 250; i += 1) {
  const a = [random() * 150 - 75, random() * 360 - 180];
  const b = [random() * 150 - 75, random() * 360 - 180];
  const angle = C.distanceKm(a, b) / 6371.0088;
  if (angle < 1e-7 || Math.PI - angle < 1e-7) continue;
  const distance = C.distanceKm(a, b);
  let steps = 1 + Math.floor(random() * 20);
  if (distance / steps > 1000) steps = Math.ceil(distance / 1000);
  const result = C.run({ text: a.join(',') + '\n' + b.join(','), spacingKm: String(distance / steps) });
  assert.equal(result.outputCount, steps + 1, 'exact ratio acquired an extra step');
}

// Antimeridian interpolation takes the short arc and emits valid GeoJSON order.
const wrapped = C.run({ text: '10,179\n10,-179', spacingKm: '100' });
close(wrapped.points[1][1], 179.6666657592614, 1e-9, 'first antimeridian intermediate');
close(wrapped.points[2][1], -179.6666657592614, 1e-9, 'second antimeridian intermediate');
assert.ok(wrapped.totalDistanceKm < 220, 'antimeridian leg went the long way');

// Caps and degeneracies fail before producing an unbounded result.
assert.match(failure({ text: '0,0\n0,1', spacingKm: '0.001' }), /would create \d+ points/);
assert.match(failure({ text: Array(2001).fill('1,2').join('\n') }), /at most 2000 input waypoints/);
assert.match(failure({ text: '0,0\n0,180', spacingKm: '100' }), /unique great-circle route/);
assert.equal(C.run({ text: '# comment\n0;0\n\n0 1', spacingKm: '200' }).outputCount, 2, 'comments and separators');

// Page contract: shared shell, accessible controls and no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
for (const id of ['route', 'spacing']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'missing help reference ' + id);
}
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'script references missing id ' + match[1]);
}
assert.ok(html.includes('<form id="densify-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('id="geojson" readonly'), 'read-only output missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');

console.log('great-circle-route-densifier: 18 catalog cases, 2 published examples, 1000 independent vector checks and integer-ratio grid passed');
