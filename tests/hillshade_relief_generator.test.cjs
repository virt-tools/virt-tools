/* Hillshade relief generator: the published ESRI equations against an
   independent vector model, the page's refusals, the catalog record and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hillshade-relief-generator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hillshade-relief-core:start */';
const endMarker = '/* hillshade-relief-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\s*\(/.test(core), 'the core stays free of DOM and storage');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HillshadeReliefCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
function failure(input) {
  try { C.analyze(input); } catch (error) { return error.message; }
  return null;
}
const grid = (values) => values.map((row) => row.join(' ')).join('\n');
const run = (values, cellSize, azimuth, altitude, zFactor) =>
  plain(C.analyze({ grid: grid(values), cellSize, azimuth, altitude, zFactor }));

// ---- Independent model: the surface normal of a plane tilted by the Horn
// gradients, dotted with a sun vector built from the compass azimuth and the
// altitude. No aspect angle and no azimuth conversion appear in it, so it
// checks the page's aspect rule rather than repeating it.
function sunVector(azimuth, altitude) {
  const az = azimuth * Math.PI / 180;
  const alt = altitude * Math.PI / 180;
  return { east: Math.sin(az) * Math.cos(alt), north: Math.cos(az) * Math.cos(alt), up: Math.sin(alt) };
}
function shadeModel(values, cellSize, azimuth, altitude, zFactor) {
  const rows = values.length;
  const cols = values[0].length;
  const sun = sunVector(azimuth, altitude);
  const shades = new Array(rows * cols).fill(null);
  for (let r = 1; r < rows - 1; r += 1) {
    for (let c = 1; c < cols - 1; c += 1) {
      const a = values[r - 1][c - 1]; const b = values[r - 1][c]; const cc = values[r - 1][c + 1];
      const d = values[r][c - 1]; const f = values[r][c + 1];
      const g = values[r + 1][c - 1]; const h = values[r + 1][c]; const i = values[r + 1][c + 1];
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + g)) / (8 * cellSize);
      const dzdy = ((g + 2 * h + i) - (a + 2 * b + cc)) / (8 * cellSize);
      const gx = zFactor * dzdx;
      const gy = zFactor * dzdy;
      const length = Math.sqrt(gx * gx + gy * gy + 1);
      // dzdy grows southward, so the north component of the surface normal is +gy.
      const dot = (-gx * sun.east + gy * sun.north + sun.up) / length;
      shades[r * cols + c] = Math.max(0, Math.min(255, Math.round(255 * dot)));
    }
  }
  return shades;
}

// ---- Analytic identities that do not depend on the window kernel at all.
const flat = run([[200, 200, 200], [200, 200, 200], [200, 200, 200]], 10, 315, 45, 1);
assert.equal(flat.shade.min, 180, 'a flat surface is 255 cos 45 = 180');
assert.equal(flat.shade.max, 180);
assert.equal(flat.shade.center, 180);
assert.equal(flat.slope.meanDeg, 0);
assert.equal(flat.slope.flatCells, 1, 'the flat cell has no aspect');
assert.match(flat.warnings.join(' '), /surface is flat/, 'a flat grid is called out');

const plane = (p, q, cols = 7, rows = 6) =>
  Array.from({ length: rows }, (unused, r) => Array.from({ length: cols }, (unused2, c) => 100 + p * c + q * (rows - 1 - r)));
const east = run(plane(0.5, 0), 1, 270, 45, 1);
assert.equal(east.slope.meanDeg, 26.57, 'a 0.5 gradient is atan 0.5');
assert.equal(east.slope.maxDeg, 26.57);
assert.equal(east.shade.min, east.shade.max, 'a uniform plane shades evenly');
assert.equal(east.shade.min, Math.round(255 * Math.cos((45 - 26.56505117707799) * Math.PI / 180)),
  'a slope facing the sun at 45 degrees is lit as 255 cos(altitude - slope)');

const shadow = run(plane(0, 1), 1, 0, 45, 1);
assert.equal(shadow.slope.meanDeg, 45, 'a unit north gradient is 45 degrees');
assert.equal(shadow.shade.max, 0, 'a 45 degree slope facing away from a 45 degree sun is fully shaded');

const steep = run(plane(0.5, 0), 1, 270, 45, 2);
assert.equal(steep.slope.meanDeg, 45, 'the vertical exaggeration doubles the gradient the slope sees');
assert.equal(steep.shade.min, 255, 'a 45 degree slope facing a 45 degree sun is fully lit');

const overhead = run(plane(0.5, 0), 1, 315, 90, 1);
assert.equal(overhead.shade.min, Math.round(255 * Math.cos(26.56505117707799 * Math.PI / 180)),
  'an overhead sun sees only the slope angle');

const horizon = run(plane(0.5, 0), 1, 270, 0, 1);
assert.equal(horizon.shade.max, Math.round(255 * Math.sin(26.56505117707799 * Math.PI / 180)),
  'a sun on the horizon lights a slope by the sine of its angle');
assert.equal(run([[200, 200, 200], [200, 200, 200], [200, 200, 200]], 10, 315, 0, 1).shade.center, 0,
  'a flat surface under a sun on the horizon is unlit');

// ---- Sweep: the page against the vector model over random grids.
function seeded(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const next = seeded(20261120);
function randomGrid(rows, cols, amplitude) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () =>
    Math.round((next() - 0.5) * 2 * amplitude * 100) / 100));
}
const cellChoices = [1, 5, 12.5, 30, 90];
const azimuthChoices = [0, 45, 90, 137.5, 180, 225, 270, 315, 360];
const altitudeChoices = [0, 10, 45, 70, 90];
const zChoices = [0.5, 1, 2, 5];
let sweep = 0;
for (let iteration = 0; iteration < 240; iteration += 1) {
  const rows = 3 + Math.floor(next() * 7);
  const cols = 3 + Math.floor(next() * 7);
  const values = randomGrid(rows, cols, [0, 3, 40, 400][Math.floor(next() * 4)]);
  const cellSize = cellChoices[Math.floor(next() * cellChoices.length)];
  const azimuth = azimuthChoices[Math.floor(next() * azimuthChoices.length)];
  const altitude = altitudeChoices[Math.floor(next() * altitudeChoices.length)];
  const zFactor = zChoices[Math.floor(next() * zChoices.length)];
  const result = run(values, cellSize, azimuth, altitude, zFactor);
  assert.deepEqual(Array.from(result.shades), shadeModel(values, cellSize, azimuth, altitude, zFactor),
    'shades match the vector model at ' + rows + 'x' + cols + ' az ' + azimuth + ' alt ' + altitude + ' z ' + zFactor);
  assert.equal(result.shades.length, rows * cols, 'one shade slot per cell');
  assert.equal(result.grid.interior, (rows - 2) * (cols - 2), 'interior window count');
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const value = result.shades[r * cols + c];
      const edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      if (edge) assert.equal(value, null, 'edge cells stay blank');
      else assert.ok(Number.isInteger(value) && value >= 0 && value <= 255, 'every interior shade is 0 to 255');
    }
  }
  assert.deepEqual(run(values, cellSize, azimuth, altitude, zFactor).shades, result.shades,
    'the same grid and sun give the same image');
  sweep += 1;
}

// ---- Rotating the grid a quarter turn and the sun with it cannot change the
// shades, because only the relative angle matters.
const turned = [[180, 190, 200, 195], [175, 205, 215, 190], [170, 200, 210, 185], [160, 180, 190, 175]];
const original = run(turned, 20, 315, 40, 1);
const turnedQuarter = turned[0].map((unused, index) => turned.map((row) => row[index]).reverse());
const rotated = run(turnedQuarter, 20, 45, 40, 1);
assert.deepEqual(Array.from(rotated.shades).slice().sort((a, b) => a - b),
  Array.from(original.shades).slice().sort((a, b) => a - b), 'a quarter turn with the sun keeps the shading');

// ---- Area, cell size and the central cell.
const example = plain(C.DEFAULT_INPUT);
const first = plain(C.analyze(example));
assert.equal(first.grid.cols, 12);
assert.equal(first.grid.rows, 9);
assert.equal(first.grid.interior, 70);
assert.equal(first.areaKm2, 0.0792, '11 by 8 cells at 30 m is 79,200 square metres');
assert.equal(first.elevation.min, 135);
assert.equal(first.elevation.max, 234);
assert.equal(first.elevation.range, 99);
assert.equal(first.sun.azimuth, 315);
assert.equal(first.sun.altitude, 45);
assert.equal(first.sun.zFactor, 1);
assert.ok(first.shade.center >= 0 && first.shade.center <= 255, 'the central cell has a shade');
assert.equal(first.shade.min <= first.shade.mean && first.shade.mean <= first.shade.max, true, 'mean lies inside the range');
assert.equal(first.warnings.length, 0, 'the example grid raises no warning');

const wide = run([[100, 110, 120], [100, 110, 120], [100, 110, 120]], 1, 0, 45, 1);
assert.equal(wide.grid.interior, 1, 'three by three has one window');
assert.equal(wide.areaKm2, 0.000004, 'two by two cells at one metre');

// ---- Refusals: the page's own messages.
const refusals = [
  [{ grid: '' }, 'Paste an elevation grid of at least 3 rows and 3 columns.'],
  [{ grid: '1 2 3\n4 5 6' },
    'The grid needs at least 3 rows and 3 columns; this one has 2 rows and 3 columns.'],
  [{ grid: '1 2\n3 4\n5 6' },
    'The grid needs at least 3 rows and 3 columns; this one has 3 rows and 2 columns.'],
  [{ grid: '1 2 3\n4 5\n7 8 9' },
    'Row 2 has 2 values but row 1 has 3; every row needs the same number of columns.'],
  [{ grid: '1 2 3\n4 x 6\n7 8 9' },
    'Row 2, column 2 is "x", which is not an elevation number.'],
  [{ grid: '1 2 3\n4 25000 6\n7 8 9' },
    'Row 2, column 2 is 25000, beyond the -20,000 to 20,000 m range this renderer takes.'],
  [{ grid: Array.from({ length: 3 }, () => '1 '.repeat(65).trim()).join('\n') },
    'This renderer takes at most 64 rows and 64 columns; the grid has 3 rows and 65 columns.'],
  [{ grid: Array.from({ length: 65 }, () => '1 2 3').join('\n') },
    'This renderer takes at most 64 rows and 64 columns; the grid has 65 rows and 3 columns.'],
  [{ cellSize: '0' }, 'Cell size must be greater than 0 and at most 1,000,000 metres.'],
  [{ cellSize: 'thirty' }, 'Cell size must be a number of metres.'],
  [{ azimuth: '361' }, 'Sun azimuth must be from 0 to 360 degrees measured clockwise from north.'],
  [{ azimuth: '-10' }, 'Sun azimuth must be from 0 to 360 degrees measured clockwise from north.'],
  [{ altitude: '91' }, 'Sun altitude must be from 0 to 90 degrees above the horizon.'],
  [{ zFactor: '0' }, 'Vertical exaggeration must be greater than 0 and at most 100.'],
  [{ zFactor: 'lots' }, 'Vertical exaggeration must be a number.']
];
for (const [override, message] of refusals) {
  const input = Object.assign({}, example, override);
  assert.equal(failure(input), message, message);
}
assert.equal(refusals.length, 15, 'fifteen refusals');
assert.equal(C.MAX_SIZE, 64, 'the grid limit the messages name');
assert.equal(C.MAX_ELEVATION, 20000, 'the elevation limit the messages name');
const tooWide = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]];
assert.ok(Array.isArray(run(tooWide, 1, 0, 45, 1).shades), 'a ten column grid is accepted');

// ---- Catalog record, category balance, and every stored case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend/tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2498, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2237, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Geography').length, 56, 'Geography count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Hillshade Relief Generator');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('3 by 3 window'), 'method names the window');
assert.ok(record.method.includes('8 * cellsize'), 'method names the gradient divisor');
assert.ok(record.method.includes('atan2(dzdy, -dzdx)'), 'method names the aspect rule');
assert.ok(record.method.includes('clamped to 0'), 'method names the shadow clamp');
assert.ok(record.method.includes('does not resample'), 'method states what it does not do');
assert.equal(record.sources.length, 2, 'two documented sources');
assert.match(record.sources[0].url, /^https:\/\/desktop\.arcgis\.com\/en\/arcmap\/latest\//);
assert.match(record.sources[1].url, /^https:\/\/gdal\.org\/en\/stable\/programs\/gdaldem\.html$/);

function subset(actualValue, expectedValue, label) {
  if (Array.isArray(expectedValue)) {
    assert.ok(Array.isArray(actualValue), label + ' should be an array');
    assert.equal(actualValue.length, expectedValue.length, label + ' length');
    expectedValue.forEach((item, index) => subset(actualValue[index], item, label + '[' + index + ']'));
    return;
  }
  if (expectedValue !== null && typeof expectedValue === 'object') {
    assert.ok(actualValue !== null && typeof actualValue === 'object', label + ' should be an object');
    for (const [key, value] of Object.entries(expectedValue)) {
      assert.ok(Object.prototype.hasOwnProperty.call(actualValue, key), label + ' missing ' + key);
      subset(actualValue[key], value, label + '.' + key);
    }
    return;
  }
  assert.equal(actualValue, expectedValue, label);
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 14, 'fourteen validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  subset(plain(C.analyze(testCase.input)), testCase.expected, testCase.name);
}
const northAt360 = C.analyze(Object.assign({}, example, { azimuth: '360' }));
const northAt0 = C.analyze(Object.assign({}, example, { azimuth: '0' }));
assert.deepEqual(northAt360.shades, northAt0.shades, 'azimuth 360 wraps back to north');

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
for (const tag of ['geography', 'hillshade', 'dem', 'terrain']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [
  ...[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
  ...[...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]),
];
assert.ok(requestedIds.length >= 8, 'the page looks up its controls');
for (const id of new Set(requestedIds)) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
for (const id of ['grid', 'cellSize', 'azimuth', 'altitude', 'zFactor']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + id + '"').test(html), 'visible label for ' + id);
}
for (const id of ['cellSize', 'azimuth', 'altitude', 'zFactor']) {
  assert.ok(new RegExp('<input id="' + id + '"').test(html), 'input for ' + id);
}
assert.ok(/<textarea id="grid"/.test(html), 'the grid is a textarea');
assert.ok(/novalidate/.test(html), 'the page owns its validation');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'the confirmation is announced');
assert.ok(/<canvas id="relief"[^>]*role="img"[^>]*aria-label="/.test(html), 'the relief is an image with a label');
assert.ok(/<p class="legend">/.test(html), 'the image carries its scale');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible|:focus\{/.test(html), 'keyboard focus is visible');
assert.ok(/no storage, uploads or network access/.test(html), 'the page states the local-only scope');
assert.ok(/illumination model, not a terrain survey/.test(html), 'the page states what a hillshade is not');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('hillshade relief generator: ' + record.testCases.length + ' catalog cases, ' + sweep
  + ' model sweeps, ' + refusals.length + ' refusals and the page contract pass');
