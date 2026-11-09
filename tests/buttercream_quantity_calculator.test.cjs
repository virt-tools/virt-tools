/* Regression checks for the buttercream quantity calculator core: an independent
   geometry oracle, the catalog cases, formatting and refusals. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/buttercream-quantity-calculator/index.html'), 'utf8');
const start = html.indexOf('/* bq-core:start */');
const end = html.indexOf('/* bq-core:end */');
assert.ok(start > -1 && end > start, 'buttercream core markers missing');
const core = html.slice(start, end + '/* bq-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ButtercreamCore;', sandbox);
const C = sandbox.module.exports;

const G_PER_ML = 1.05;
const CUP_ML = 236.5882365;
const IN2 = 6.4516;
const CRUMB = 0.2;
const num = (value) => Number(String(value).trim().replace(',', '.'));

// Independent transcription of the documented method: work from a circle area
// and a side perimeter rather than the page's combined expressions.
function oracle(input) {
  const height = num(input.height);
  const thickness = num(input.thickness);
  let area;
  if (input.shape === 'round') {
    const d = num(input.diameter);
    const top = Math.PI * Math.pow(d / 2, 2);
    const side = Math.PI * d * (height / 1);
    area = top + side;
  } else if (input.shape === 'square') {
    const s = num(input.side);
    area = s * s + 4 * (s * height);
  } else {
    const l = num(input.length);
    const w = num(input.width);
    area = l * w + 2 * l * height + 2 * w * height;
  }
  const finish = area * (thickness / 10);
  const crumb = input.crumb ? area * CRUMB : 0;
  const total = finish + crumb;
  return {
    areaCm2: area,
    areaIn2: area / IN2,
    finishMl: finish,
    crumbMl: crumb,
    totalMl: total,
    weightG: total * G_PER_ML,
    cups: total / CUP_ML,
  };
}

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-6 : epsilon),
  `${label}: ${actual} vs ${expected}`
);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'buttercream-quantity-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Food', 'catalog category');
assert.ok(entry.testCases.length >= 20, `expected at least 20 cases, found ${entry.testCases.length}`);

const NUMERIC = ['areaCm2', 'areaIn2', 'finishMl', 'crumbMl', 'totalMl', 'weightG', 'cups'];

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
  assert.equal(result.crumb, testCase.expected.crumb, `${label}: crumb flag`);
}
assert.ok(goldenCount >= 10, `expected at least 10 golden cases, found ${goldenCount}`);

// The independent geometry oracle agrees with the page core across every golden
// catalog case and across extra cakes of each shape.
for (const testCase of entry.testCases) {
  if (testCase.expected.error) continue;
  const expected = oracle(testCase.input);
  const actual = C.analyze(Object.assign({}, testCase.input));
  for (const key of NUMERIC) closeTo(actual[key], expected[key], `oracle ${testCase.name}: ${key}`, 1e-5);
}

const grid = [
  { shape: 'round', diameter: 16, height: 9, thickness: 3.5, crumb: false },
  { shape: 'round', diameter: 26.5, height: 11.5, thickness: 6, crumb: true },
  { shape: 'square', side: 18, height: 7, thickness: 5, crumb: true },
  { shape: 'square', side: 25.4, height: 10.2, thickness: 2.5, crumb: false },
  { shape: 'rect', length: 35, width: 25, height: 8, thickness: 4.5, crumb: true },
  { shape: 'rect', length: 45.5, width: 31.5, height: 12.5, thickness: 7.5, crumb: true },
  { shape: 'round', diameter: 12, height: 6, thickness: 1, crumb: true },
  { shape: 'rect', length: 20, width: 20, height: 5, thickness: 20, crumb: false },
];
for (const input of grid) {
  const expected = oracle(input);
  const actual = C.analyze(input);
  for (const key of NUMERIC) closeTo(actual[key], expected[key], `grid ${JSON.stringify(input)}: ${key}`, 1e-6);
}

// The frosted area is the side plus the top only: the base is never included.
const round = C.analyze({ shape: 'round', diameter: 20, height: 10, thickness: 4, crumb: true });
closeTo(round.areaCm2, Math.PI * 20 * 10 + Math.PI * 100, 'round area', 1e-9);
const square = C.analyze({ shape: 'square', side: 20, height: 10, thickness: 4, crumb: false });
closeTo(square.areaCm2, 4 * 20 * 10 + 400, 'square area', 1e-9);
const sheet = C.analyze({ shape: 'rect', length: 30, width: 20, height: 10, thickness: 4, crumb: false });
closeTo(sheet.areaCm2, 2 * (30 + 20) * 10 + 600, 'sheet area', 1e-9);

// A crumb coat adds exactly 2 mm over the same surface, and switching it off
// changes nothing else.
const withCrumb = C.analyze({ shape: 'round', diameter: 20, height: 10, thickness: 4, crumb: true });
const withoutCrumb = C.analyze({ shape: 'round', diameter: 20, height: 10, thickness: 4, crumb: false });
closeTo(withCrumb.crumbMl, withoutCrumb.areaCm2 * 0.2, 'crumb volume', 1e-9);
closeTo(withCrumb.totalMl - withoutCrumb.totalMl, withCrumb.crumbMl, 'crumb adds only its own layer', 1e-9);

// Formatting is fixed to the documented display conventions.
assert.equal(C.formatArea(withCrumb), '942.5 cm\u00b2 (146.1 in\u00b2)');
assert.equal(C.formatVolume(withCrumb.totalMl), '565 mL');
assert.equal(C.formatVolume(withCrumb.finishMl), '377 mL');
assert.equal(C.formatVolume(1630), '1.63 L');
assert.equal(C.formatCups(withCrumb.totalMl), '2.4 US cups');
assert.equal(C.formatWeight(withCrumb.weightG), '594 g');
assert.equal(C.formatWeight(1713.6), '1,714 g');

// The copyable summary names the shape, size, coat and all three units.
assert.equal(
  C.copyText(withCrumb),
  '2.4 US cups (565 mL, 594 g) of buttercream for a round cake 20.0 cm across and 10.0 cm high, with a 4.0 mm finish coat and a 2 mm crumb coat.'
);
assert.equal(
  C.copyText(sheet),
  '2.7 US cups (640 mL, 672 g) of buttercream for a 30.0 by 20.0 cm sheet cake and 10.0 cm high, with a 4.0 mm finish coat.'
);
assert.ok(!C.copyText(withCrumb).includes('undefined') && !C.copyText(withCrumb).includes('NaN'));

// Blank input is refused rather than silently defaulted.
assert.throws(() => C.analyze({}), /^Error: Choose a round, square or rectangular cake\.$/);

// The page stays offline: no network, storage or raw-HTML sinks.
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
for (const id of ['shape', 'diameter', 'side', 'length', 'width', 'height', 'thickness', 'crumb']) {
  assert.ok(html.includes(`id="${id}"`), `missing control ${id}`);
}
assert.ok(html.includes('id="site-header"'), 'shared header mount missing');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');

console.log(`buttercream quantity calculator: ${entry.testCases.length} catalog cases, ${grid.length} oracle grid cases, formatting and refusals OK`);
