/* Latch hook rug yarn calculator: replay the catalog fixtures, recompute the
   knot and strand model independently, sweep mesh/pile/waste combinations for
   internal consistency, and pin the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'latch-hook-rug-yarn-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* latch-hook-core:start */');
const end = html.indexOf('/* latch-hook-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = LatchHookCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2250, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'Latch Hook Rug Yarn Calculator');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the model and limits');
assert.ok(entry.sources.length >= 3);
const kinds = entry.testCases.reduce((acc, testCase) => {
  acc[testCase.kind] = (acc[testCase.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(entry.testCases.length, 16, 'catalog case count');
assert.deepEqual(kinds, { golden: 6, boundary: 4, validation: 6 });

// Independent model: holes follow the mesh, one knot per hole, a strand is the
// pile twice plus a half inch of wrap, waste is a percentage of the neat yarn.
const MESH = { '3.3': 3.3, '4': 4, '5': 5 };
const WRAP = 0.5;
function halfUp(value, digits) {
  const scale = Math.pow(10, digits);
  return Math.floor(value * scale + 0.5) / scale;
}
function expectedModel(input) {
  const mesh = MESH[input.mesh];
  const columns = Math.max(1, Math.floor(Number(input.width) * mesh + 0.5));
  const rows = Math.max(1, Math.floor(Number(input.length) * mesh + 0.5));
  const knots = columns * rows;
  const strand = 2 * Number(input.pile) + WRAP;
  const neat = knots * strand;
  const gross = neat * (1 + Number(input.waste) / 100);
  const skeinInches = Number(input.skein) * 36;
  return {
    columns,
    rows,
    holes: knots,
    strandInches: halfUp(strand, 3),
    neatInches: halfUp(neat, 2),
    grossInches: halfUp(gross, 2),
    wasteInches: halfUp(gross - neat, 2),
    totalYards: halfUp(gross / 36, 1),
    totalMeters: halfUp(gross * 0.0254, 1),
    skeins: Math.ceil(gross / skeinInches - 1e-9),
    strandsPerSkein: Math.floor(skeinInches / strand + 1e-9),
    canvasWidth: halfUp(columns / mesh, 2),
    canvasLength: halfUp(rows / mesh, 2),
    areaSquareFeet: halfUp((columns / mesh) * (rows / mesh) / 144, 2),
    trimmedWidth: Math.abs(columns / mesh - Number(input.width)) > 0.005,
    trimmedLength: Math.abs(rows / mesh - Number(input.length)) > 0.005,
  };
}

function tolerance(value) { return 1e-6 * Math.max(1, Math.abs(value)); }
function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}
function compare(name, result, expected) {
  for (const [field, value] of Object.entries(expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[field] - value) <= tolerance(value),
        name + ' ' + field + ': ' + result[field] + ' vs ' + value);
    } else {
      assert.deepEqual(result[field], value, name + ' ' + field);
    }
  }
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(attempt(() => C.convert(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  compare(testCase.name, C.convert(testCase.input), testCase.expected);
  compare(testCase.name + ' (recomputed)', C.convert(testCase.input), expectedModel(testCase.input));
}

// Hand-computed anchors: 10 in at 4 holes is 40 holes each way, 1600 knots,
// 1.5 in strands, 2400 in of yarn, 66.7 yd, and 12 six-yard skeins.
const anchors = [
  [{ width: '10', length: '10', mesh: '4', pile: '0.5', waste: '0', skein: '6' },
    40, 40, 1600, 1.5, 2400, 66.7, 12, 144],
  [{ width: '6', length: '6', mesh: '5', pile: '1', waste: '0', skein: '1' },
    30, 30, 900, 2.5, 2250, 62.5, 63, 14],
  [{ width: '4', length: '4', mesh: '3.3', pile: '0.25', waste: '50', skein: '6' },
    13, 13, 169, 1, 253.5, 7, 2, 216],
  [{ width: '240', length: '240', mesh: '5', pile: '4', waste: '50', skein: '1000' },
    1200, 1200, 1440000, 8.5, 18360000, 510000, 510, 4235],
  [{ width: '24', length: '36', mesh: '3.3', pile: '1', waste: '10', skein: '6' },
    79, 119, 9401, 2.5, 25852.75, 718.1, 120, 86],
];
for (const [input, columns, rows, knots, strand, gross, yards, skeins, perSkein] of anchors) {
  const result = C.convert(input);
  assert.equal(result.columns, columns, JSON.stringify(input) + ' columns');
  assert.equal(result.rows, rows, JSON.stringify(input) + ' rows');
  assert.equal(result.holes, knots, JSON.stringify(input) + ' knots');
  assert.ok(Math.abs(result.strandInches - strand) < 1e-6, JSON.stringify(input) + ' strand');
  assert.ok(Math.abs(result.grossInches - gross) < 1e-6, JSON.stringify(input) + ' gross');
  assert.ok(Math.abs(result.totalYards - yards) < 1e-6, JSON.stringify(input) + ' yards');
  assert.equal(result.skeins, skeins, JSON.stringify(input) + ' skeins');
  assert.equal(result.strandsPerSkein, perSkein, JSON.stringify(input) + ' strands per skein');
}

// Sweep: three meshes, seven piles, five waste rates and six skein lengths over
// seven rug sizes. Every derived figure must close against the stated model.
const sizes = [[4, 4], [7.5, 9.25], [12, 18], [24, 36], [30, 48], [45, 67], [120, 180]];
const meshes = ['3.3', '4', '5'];
const piles = ['0.25', '0.5', '1', '1.5', '2', '3', '4'];
const wastes = ['0', '5', '10', '25', '50'];
const skeins = ['1', '4', '6', '8', '20', '1000'];
let swept = 0;
for (const [width, length] of sizes) {
  for (const mesh of meshes) {
    for (const pile of piles) {
      for (const waste of wastes) {
        for (const skein of skeins) {
          const input = { width: String(width), length: String(length), mesh, pile, waste, skein };
          const r = C.convert(input);
          const tag = JSON.stringify(input);
          const strand = 2 * Number(pile) + WRAP;
          assert.equal(r.holes, r.columns * r.rows, 'knots ' + tag);
          assert.equal(r.columns, Math.round(width * MESH[mesh]), 'columns ' + tag);
          assert.equal(r.rows, Math.round(length * MESH[mesh]), 'rows ' + tag);
          assert.ok(Math.abs(r.strandInches - strand) < 1e-9, 'strand ' + tag);
          assert.ok(Math.abs(r.grossInches - r.holes * strand * (1 + Number(waste) / 100)) < 0.02, 'gross ' + tag);
          assert.ok(Math.abs(r.totalYards * 36 - r.grossInches) < 2, 'yards ' + tag);
          assert.ok(Math.abs(r.totalMeters - r.grossInches * 0.0254) < 0.06, 'metres ' + tag);
          assert.equal(r.skeins, Math.ceil(r.grossInches / (Number(skein) * 36) - 1e-9), 'skeins ' + tag);
          assert.equal(r.strandsPerSkein, Math.floor(Number(skein) * 36 / strand + 1e-9), 'per skein ' + tag);
          assert.ok(r.wasteInches >= 0, 'waste cannot be negative ' + tag);
          assert.ok(Math.abs(r.wasteInches - r.grossInches + r.holes * strand) < 0.05, 'waste closes ' + tag);
          assert.ok(r.skeins * Number(skein) * 36 >= r.grossInches - 1e-6, 'skeins must cover the yarn ' + tag);
          assert.ok((r.skeins - 1) * Number(skein) * 36 < r.grossInches + 1e-6, 'skeins must be minimal ' + tag);
          assert.equal(r.trimmedWidth, Math.abs(r.columns / MESH[mesh] - width) > 0.005, 'trim flag ' + tag);
          assert.equal(r.trimmedLength, Math.abs(r.rows / MESH[mesh] - length) > 0.005, 'trim flag ' + tag);
          assert.ok(Math.abs(r.areaSquareFeet - (r.columns / MESH[mesh]) * (r.rows / MESH[mesh]) / 144) < 0.01, 'area ' + tag);
          swept += 1;
        }
      }
    }
  }
}
assert.ok(swept >= 3000, 'sweep size ' + swept);

// Refusals: each limit and the mesh whitelist must reject with its own message.
const base = { width: '24', length: '36', mesh: '3.3', pile: '1', waste: '10', skein: '6' };
const refusals = [
  ['width', '3', 'Rug width must be a number from 4 to 240 inches.'],
  ['width', '241', 'Rug width must be a number from 4 to 240 inches.'],
  ['width', '12in', 'Rug width must be a number from 4 to 240 inches.'],
  ['width', '', 'Rug width must be a number from 4 to 240 inches.'],
  ['length', '3.9', 'Rug length must be a number from 4 to 240 inches.'],
  ['length', '241', 'Rug length must be a number from 4 to 240 inches.'],
  ['pile', '0.2', 'Pile height must be a number from 0.25 to 4 inches.'],
  ['pile', '4.5', 'Pile height must be a number from 0.25 to 4 inches.'],
  ['waste', '-1', 'Waste allowance must be a number from 0 to 50 percent.'],
  ['waste', '50.5', 'Waste allowance must be a number from 0 to 50 percent.'],
  ['skein', '0.5', 'Yarn per skein must be a number from 1 to 1000 yards.'],
  ['skein', '1001', 'Yarn per skein must be a number from 1 to 1000 yards.'],
  ['mesh', '6', 'Choose a canvas mesh of 3.3, 4 or 5 holes per inch.'],
  ['mesh', '', 'Choose a canvas mesh of 3.3, 4 or 5 holes per inch.'],
];
for (const [field, value, message] of refusals) {
  const input = Object.assign({}, base, { [field]: value });
  assert.equal(attempt(() => C.convert(input)), message, field + '=' + value);
}
// Both limits are inclusive, and the extreme values must convert cleanly.
for (const input of [
  Object.assign({}, base, { width: '4', length: '4', pile: '0.25', waste: '0', skein: '1' }),
  Object.assign({}, base, { width: '240', length: '240', pile: '4', waste: '50', skein: '1000' }),
]) {
  assert.ok(C.convert(input).holes >= 1, 'inclusive limits must convert');
}

// Page contract: every id the script looks up exists, the markup starts at the
// core defaults, and the page stays self-contained.
assert.equal(C.DEFAULTS.width, '24');
assert.equal(C.DEFAULTS.length, '36');
assert.equal(C.DEFAULTS.mesh, '3.3');
assert.equal(C.DEFAULTS.pile, '1');
assert.equal(C.DEFAULTS.waste, '10');
assert.equal(C.DEFAULTS.skein, '6');
assert.equal(C.EXTRA_PER_STRAND_IN, 0.5);
assert.deepEqual(Object.keys(C.MESHES).sort(), ['3.3', '4', '5']);
const scriptText = html.slice(html.indexOf('/* latch-hook-core:end */'));
for (const match of scriptText.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'missing element #' + match[1]);
}
for (const id of ['in-width', 'in-length', 'in-mesh', 'in-pile', 'in-waste', 'in-skein']) {
  assert.ok(new RegExp('<label[^>]*for="' + id + '"').test(html), 'missing label for ' + id);
}
assert.ok(html.includes('id="in-width" inputmode="decimal" autocomplete="off" value="24"'), 'width default in markup');
assert.ok(html.includes('id="in-length" inputmode="decimal" autocomplete="off" value="36"'), 'length default in markup');
assert.ok(html.includes('id="in-pile" inputmode="decimal" autocomplete="off" value="1"'), 'pile default in markup');
assert.ok(html.includes('id="in-waste" inputmode="decimal" autocomplete="off" value="10"'), 'waste default in markup');
assert.ok(html.includes('id="in-skein" inputmode="decimal" autocomplete="off" value="6"'), 'skein default in markup');
assert.ok(/<option value="3.3" selected>/.test(html), 'mesh default');
for (const mesh of ['3.3', '4', '5']) {
  assert.ok(html.includes('<option value="' + mesh + '"'), 'mesh option ' + mesh);
}
assert.ok(html.includes('novalidate'), 'form must not block the page validation');
assert.ok(html.includes('role="alert"') && html.includes('aria-live="polite"'), 'error region');
assert.ok(!/https?:\/\//.test(html.slice(0, html.indexOf('<script src="/assets/app.js">'))), 'no external references');
assert.ok(!/<button(?![^>]*type=)/.test(html), 'every button needs an explicit type');
console.log('latch hook rug yarn: ' + entry.testCases.length + ' catalog cases, ' + swept + ' swept combinations, '
  + anchors.length + ' hand anchors, ' + refusals.length + ' refusals passed');
