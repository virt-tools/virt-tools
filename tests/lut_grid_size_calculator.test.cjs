/* Regression checks for the 3D LUT grid calculator core, its catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lut-grid-size-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* lut-size-core:start */');
const end = html.indexOf('/* lut-size-core:end */');
assert.ok(start > -1 && end > start, 'lut-size core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* lut-size-core:end */'.length) + '\nmodule.exports = LutSize;', sandbox);
const L = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Video');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), `not a finite number: ${actual} ${label || ''}`);
  const limit = Math.max(Math.abs(expected) * (tolerance || 1e-9), 1e-12);
  assert.ok(Math.abs(actual - expected) <= limit, `${label || 'value'}: ${actual} != ${expected} (limit ${limit})`);
};

// --- Published arithmetic anchors. ---
const d33 = L.compute({ grid: '33', precision: 'float32', decimals: '6', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
assert.equal(d33.entries, 35937);
assert.equal(d33.channelSamples, 107811);
assert.equal(d33.memoryBytes, 431244);
assert.equal(d33.cubeBytes, 970363);
assert.equal(d33.entryBytes, 27);
assert.equal(d33.step, 0.03125);
assert.equal(d33.fetchesPerFrame, 8294400);
assert.equal(d33.fetchesPerSecond, 199065600);
assert.equal(d33.cornerBytesPerSecond, 2388787200);
close(d33.cubeMb, 0.970363, 1e-12, 'cubeMb');
close(d33.memoryMib, 0.4112663269042969, 1e-12, 'memoryMib');

const d65 = L.compute({ grid: '65', precision: 'uint16', decimals: '6', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
assert.equal(d65.entries, 274625);
assert.equal(d65.memoryBytes, 1647750);
assert.equal(d65.cubeBytes, 7414939);
assert.equal(d65.step, 0.015625);

const d17 = L.compute({ grid: '17', precision: 'float16', decimals: '6', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
assert.equal(d17.entries, 4913);
assert.equal(d17.memoryBytes, 29478);
assert.equal(d17.cubeBytes, 132715);

// --- Line width grows by three bytes per extra decimal. ---
assert.equal(L.lineBytes(1), 12);
assert.equal(L.lineBytes(6), 27);
assert.equal(L.lineBytes(10), 39);
const d10 = L.compute({ grid: '33', precision: 'float32', decimals: '10', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
assert.equal(d10.cubeBytes, 35937 * 39 + 64);

// --- Memory scales with grid cube and sample width, not with decimals. ---
const narrow = L.compute({ grid: '33', precision: 'uint8', decimals: '1', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
const wide = L.compute({ grid: '33', precision: 'float32', decimals: '10', width: '1920', height: '1080', fps: '24', interpolation: 'tetrahedral' });
assert.equal(narrow.memoryBytes, 107811);
assert.equal(wide.memoryBytes, 431244);
assert.equal(narrow.memoryBytes * 4, wide.memoryBytes);

// --- Trilinear sampling doubles the corner count. ---
const tri = L.compute({ grid: '33', precision: 'float32', decimals: '6', width: '1280', height: '720', fps: '25', interpolation: 'trilinear' });
assert.equal(tri.corners, 8);
assert.equal(tri.samplesPerFrame, 921600);
assert.equal(tri.fetchesPerFrame, 7372800);
assert.equal(tri.fetchesPerSecond, 184320000);
assert.equal(tri.fetchesPerFrame, L.compute({ grid: '33', precision: 'float32', decimals: '6', width: '1280', height: '720', fps: '25', interpolation: 'tetrahedral' }).fetchesPerFrame * 2);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    const message = failure(() => L.compute(testCase.input));
    assert.equal(message, testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = L.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    close(result[key], expected, 1e-12, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Monotone growth across every supported grid size. ---
let previousEntries = 0;
for (let grid = 2; grid <= L.MAX_GRID; grid += 1) {
  const result = L.compute({ grid: String(grid), precision: 'float32', decimals: '6', width: '1', height: '1', fps: '1', interpolation: 'tetrahedral' });
  assert.equal(result.entries, grid ** 3);
  assert.ok(result.entries > previousEntries, `entries must grow at grid ${grid}`);
  assert.ok(result.step > 0 && result.step <= 1, `step out of range at grid ${grid}`);
  assert.equal(result.cubeBytes, grid ** 3 * 27 + 64);
  previousEntries = result.entries;
}

// --- The reference table always covers the presets and marks the selected grid. ---
const rows = L.tableRows(6, 'float32');
assert.deepEqual(rows.map((row) => row.grid), L.GRID_PRESETS);
for (const row of rows) {
  assert.equal(row.entries, row.grid ** 3);
  assert.equal(row.memoryBytes, row.grid ** 3 * 12);
  assert.equal(row.cubeBytes, row.grid ** 3 * 27 + 64);
}

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('class="table-wrap"'), 'table overflow wrapper');
for (const id of ['grid-input', 'precision-select', 'decimals-input', 'width-input', 'height-input',
  'fps-input', 'interpolation-select', 'calculate', 'lut-status']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or status ${id}`);
}
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');

console.log(`lut-grid-size-calculator: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed`);
