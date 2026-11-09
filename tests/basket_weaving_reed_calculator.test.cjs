/* Regression checks for the basket weaving reed calculator: every catalog case,
   an independently derived closed-form oracle, hand-checked anchors and
   refusals outside the catalog. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/basket-weaving-reed-calculator/index.html'), 'utf8');
const start = html.indexOf('/* basket-reed-core:start */');
const end = html.indexOf('/* basket-reed-core:end */');
assert.ok(start > -1 && end > start, 'basket reed core markers missing');
const core = html.slice(start, end + '/* basket-reed-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BasketReedCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'basket-weaving-reed-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Crafts & Hobbies', 'catalog category');
assert.equal(entry.subcategory, 'Estimation & calculation', 'catalog subcategory');
assert.equal(entry.risk, 'low', 'catalog risk');
assert.equal(entry.maturity, 'draft', 'catalog maturity');
assert.equal(entry.listed, true, 'catalog listed');
assert.ok(entry.testCases.length >= 34, `expected at least 34 cases, found ${entry.testCases.length}`);

const NUMERIC = [
  'rows', 'wovenHeight', 'heightRatio', 'weft', 'stakeLength', 'stakeReed', 'rimReed',
  'total', 'totalMetres', 'totalFeet', 'spacingBase', 'spacingRim', 'spacingGrowth',
  'slopeDeg', 'smallestRow', 'largestRow',
];

function close(actual, expected, label) {
  const tolerance = Math.max(Math.abs(expected) * 1e-6, 1e-5);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`);
}

// Independent oracle: the rows are equally spaced diameters, so their sum is the
// row count times the mean of the base and rim diameters. No row loop is used.
function oracle(input) {
  const given = input || {};
  const pick = (key) => (given[key] === undefined ? C.DEFAULTS[key] : given[key]);
  const base = Number(String(pick('base')).trim());
  const height = Number(String(pick('height')).trim());
  const rim = Number(String(pick('rim')).trim());
  const reed = Number(String(pick('reed')).trim());
  const stakes = Number(String(pick('stakes')).trim());
  const slack = Number(String(pick('slack')).trim());
  const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;
  const factor = 1 + slack / 100;
  const rows = Math.round(height / reed);
  const meanDiameter = (base + rim) / 2;
  const weft = Math.PI * factor * rows * meanDiameter;
  const slant = Math.sqrt(height ** 2 + ((rim - base) / 2) ** 2);
  const stakeLength = slant + 4 * reed;
  const rimReed = 3 * Math.PI * rim * factor;
  const total = weft + stakes * stakeLength + rimReed;
  return {
    rows,
    wovenHeight: round(rows * reed, 4),
    heightRatio: round((rows * reed) / height, 6),
    weft: round(weft, 4),
    stakeLength: round(stakeLength, 4),
    stakeReed: round(stakes * stakeLength, 4),
    rimReed: round(rimReed, 4),
    total: round(total, 4),
    totalMetres: round(total / 1000, 6),
    totalFeet: round(total / 304.8, 6),
    spacingBase: round((Math.PI * base) / stakes, 4),
    spacingRim: round((Math.PI * rim) / stakes, 4),
    spacingGrowth: round(((Math.PI * rim) / stakes) / ((Math.PI * base) / stakes) - 1, 6),
    slopeDeg: round((Math.atan2((rim - base) / 2, height) * 180) / Math.PI, 4),
    smallestRow: round(base + ((rim - base) * 0.5) / rows, 4),
    largestRow: round(base + ((rim - base) * (rows - 0.5)) / rows, 4),
  };
}

let golden = 0;
let refused = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expected && typeof testCase.expected.error === 'string',
      `${testCase.name}: validation case needs an error string`);
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${testCase.name}: refusal text`);
      return true;
    }, `${testCase.name}: expected a refusal`);
    refused += 1;
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const key of NUMERIC) {
    if (testCase.expected[key] === undefined) continue;
    close(result[key], testCase.expected[key], `${testCase.name} / ${key}`);
  }
  const mirror = oracle(testCase.input);
  for (const key of NUMERIC) {
    close(mirror[key], result[key], `${testCase.name} / oracle ${key}`);
  }
  golden += 1;
}
assert.equal(golden + refused, entry.testCases.length, 'every case ran');

// Hand-checked anchors, worked out from the documented geometry rather than the code.
const dflt = C.calculate({});
assert.equal(dflt.rows, 50, 'default rows');
close(dflt.weft, 12880 * Math.PI, 'default weft is pi times 12880');
close(dflt.stakeLength, Math.sqrt(150 * 150 + 30 * 30) + 12, 'default stake length');
close(dflt.rimReed, 3 * Math.PI * 260 * 1.12, 'default rim wale');
close(dflt.totalMetres, 45.847738, 'default total in metres');
close(dflt.totalFeet, 150.419088, 'default total in feet');
close(dflt.spacingBase, (Math.PI * 200) / 16, 'default base spacing');
close(dflt.spacingGrowth, 0.3, 'default spacing growth from 200 to 260 mm');

// A straight wall repeats one diameter, so the weft is simply that circle per row.
const straight = C.calculate({ base: 240, height: 200, rim: 240, reed: 4, stakes: 20, slack: 10 });
assert.equal(straight.rows, 50, 'straight wall rows');
close(straight.weft, 50 * Math.PI * 240 * 1.1, 'straight wall weft');
close(straight.stakeLength, 200 + 16, 'straight wall stake is the height plus the border');
close(straight.totalMetres, (50 * Math.PI * 240 * 1.1 + 20 * 216 + 3 * Math.PI * 240 * 1.1) / 1000,
  'straight wall total');
assert.equal(straight.slopeDeg, 0, 'a straight wall has no slope');
assert.equal(straight.smallestRow, straight.largestRow, 'a straight wall has one row diameter');

// A single row takes the mid diameter, which for one row is the mean.
const single = C.calculate({ base: 300, height: 20, rim: 300, reed: 15, stakes: 12, slack: 0 });
assert.equal(single.rows, 1, 'one-row wall');
close(single.weft, Math.PI * 300, 'one-row weft is one circumference');
close(single.stakeReed, 12 * (20 + 60), 'one-row stake reed');
close(single.totalMetres, 4.729911, 'one-row total');

// An inward taper narrows the rows and the rim, and reports a negative slope.
const inward = C.calculate({ base: 280, height: 180, rim: 200, reed: 3.5, stakes: 18, slack: 15 });
assert.ok(inward.slopeDeg < 0, 'inward taper has a negative slope');
assert.ok(inward.smallestRow > inward.largestRow, 'inward taper rows shrink upward');
close(inward.rimReed, 3 * Math.PI * 200 * 1.15, 'inward rim wale');
assert.ok(inward.spacingGrowth < 0, 'inward taper tightens the stake spacing');

// Refusals that are not in the catalog keep the same wording and never throw raw errors.
const refusals = [
  [{ base: 0 }, 'Base diameter must be a number from 40 to 800 mm.'],
  [{ base: '  ' }, 'Base diameter is required.'],
  [{ rim: '39' }, 'Rim diameter must be a number from 40 to 1000 mm.'],
  [{ slack: '41' }, 'Weave slack must be a number from 0 to 40 percent.'],
  [{ slack: '-1' }, 'Weave slack must be a number from 0 to 40 percent.'],
  [{ stakes: '6.0' }, 'Stakes must be a whole number from 6 to 64.'],
  [{ stakes: '' }, 'Stakes is required.'],
  [{ reed: '16' }, 'Reed width must be a number from 1 to 15 mm.'],
  [{ reed: '1,5' }, 'Reed width must be a number from 1 to 15 mm.'],
  [{ base: 60, height: 60, rim: 60, reed: 5, stakes: 20, slack: 0 },
    'Stakes sit 9.4 mm apart at the base, less than twice the 5 mm reed. Use fewer stakes or a thinner reed.'],
];
for (const [input, message] of refusals) {
  assert.throws(() => C.calculate(input), (error) => {
    assert.equal(error.message, message, `refusal for ${JSON.stringify(input)}`);
    return true;
  }, `expected a refusal for ${JSON.stringify(input)}`);
}

// Trimming is tolerated on otherwise valid numbers.
close(C.calculate({ base: ' 180 ', height: ' 120 ', rim: ' 220 ', reed: ' 3 ', stakes: ' 14 ', slack: ' 12 ' }).totalMetres,
  C.calculate({ base: 180, height: 120, rim: 220, reed: 3, stakes: 14, slack: 12 }).totalMetres,
  'padded numbers match trimmed numbers');

console.log(`basket-weaving-reed-calculator: ${golden} calculation cases and ${refused} catalog refusals pass, plus ${refusals.length} extra refusals and 6 anchors`);
