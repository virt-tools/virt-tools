/* Regression checks for the pillow cover core, its catalog cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pillow-cover-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* pillow-cover-core:start */');
const end = html.indexOf('/* pillow-cover-core:end */');
assert.ok(start > -1 && end > start, 'pillow cover core markers missing');
const core = html.slice(start, end + '/* pillow-cover-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PillowCoverCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

function run(input) {
  return C.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { unit: 'in', insertWidth: '18', insertHeight: '18', ease: '0.5', seam: '0.5', overlap: '4', hem: '0.5' };

// Documented surface.
assert.deepEqual(Object.keys(C.LIMITS).sort(), ['cm', 'in']);
assert.equal(C.LIMITS.in.insertMin, 2);
assert.equal(C.LIMITS.in.insertMax, 60);
assert.equal(C.LIMITS.cm.insertMax, 152);
assert.equal(C.LIMITS.in.overlapMin, 1);
assert.equal(C.UNITS.in.fabricWidth, 44);
assert.equal(C.UNITS.cm.fabricWidth, 112);
assert.equal(C.UNITS.cm.short, 'cm');
assert.match(C.MESSAGES.panelWide, /44 in/);

// Golden: an 18 inch square insert with half-inch ease and seam.
const sized = run(base);
assert.equal(sized.unit, 'in');
assert.equal(sized.coverWidth, 19);
assert.equal(sized.coverHeight, 19);
assert.equal(sized.frontWidth, 20);
assert.equal(sized.frontHeight, 20);
assert.equal(sized.backPanelWidth, 20);
assert.equal(sized.backPanelHeight, 12.5);
assert.equal(sized.backTotalHeight, 25);
assert.equal(sized.totalArea, 900);
assert.equal(sized.fabricLength, 45);
assert.equal(sized.panelWide, false);
assert.equal(sized.overlapLarge, false);

// Lumbar insert keeps the two dimensions independent.
const lumbar = run(Object.assign({}, base, { insertWidth: '12', insertHeight: '20' }));
assert.equal(lumbar.coverWidth, 13);
assert.equal(lumbar.coverHeight, 21);
assert.equal(lumbar.frontWidth, 14);
assert.equal(lumbar.frontHeight, 22);
assert.equal(lumbar.backPanelHeight, 13.5);
assert.equal(lumbar.totalArea, 686);
assert.equal(lumbar.fabricLength, 49);

// Centimetres are the same geometry at the exact 2.54 conversion.
const metric = run({
  unit: 'cm', insertWidth: '45', insertHeight: '45',
  ease: '1.27', seam: '1.27', overlap: '10.16', hem: '1.27'
});
closeTo(metric.coverWidth, 47.54, 'metric cover width');
closeTo(metric.frontWidth, 50.08, 'metric front width');
closeTo(metric.backPanelHeight, 31.39, 'metric back height');
closeTo(metric.fabricLength, 112.86, 'metric fabric length');
assert.equal(metric.fabricWidth, 112);

// Boundaries.
const smallest = run({ unit: 'in', insertWidth: '2', insertHeight: '2', ease: '0', seam: '0', overlap: '1', hem: '0' });
assert.equal(smallest.frontWidth, 2);
assert.equal(smallest.backPanelHeight, 1.5);
assert.equal(smallest.totalArea, 10);
const largest = run({ unit: 'in', insertWidth: '60', insertHeight: '60', ease: '3', seam: '2', overlap: '10', hem: '2' });
assert.equal(largest.coverWidth, 66);
assert.equal(largest.frontWidth, 70);
assert.equal(largest.backPanelHeight, 42);
assert.equal(largest.totalArea, 10780);
assert.equal(largest.fabricLength, 154);
assert.equal(largest.panelWide, true);
const halfOverlap = run(Object.assign({}, base, { overlap: '10' }));
assert.equal(halfOverlap.overlapLarge, false);
assert.equal(halfOverlap.backPanelHeight, 15.5);
const tightOverlap = run(Object.assign({}, base, { insertHeight: '6', overlap: '10' }));
assert.equal(tightOverlap.overlapLarge, true);

// Validation refusals.
assert.equal(failure(Object.assign({}, base, { insertWidth: '' })), 'Enter the insert width in inches.');
assert.equal(failure(Object.assign({}, base, { insertHeight: '   ' })), 'Enter the insert height in inches.');
assert.equal(failure(Object.assign({}, base, { insertWidth: 'wide' })), 'Insert width must be a number in inches.');
assert.equal(failure(Object.assign({}, base, { insertWidth: '1' })), 'Insert width must be between 2 and 60 inches.');
assert.equal(failure(Object.assign({}, base, { insertHeight: '61' })), 'Insert height must be between 2 and 60 inches.');
assert.equal(failure(Object.assign({}, base, { ease: '4' })), 'Ease must be between 0 and 3 inches.');
assert.equal(failure(Object.assign({}, base, { ease: '-1' })), 'Ease must be between 0 and 3 inches.');
assert.equal(failure(Object.assign({}, base, { seam: '3' })), 'Seam allowance must be between 0 and 2 inches.');
assert.equal(failure(Object.assign({}, base, { overlap: '0.5' })), 'Back overlap must be between 1 and 10 inches.');
assert.equal(failure(Object.assign({}, base, { overlap: '11' })), 'Back overlap must be between 1 and 10 inches.');
assert.equal(failure(Object.assign({}, base, { hem: '2.5' })), 'Opening hem must be between 0 and 2 inches.');
assert.equal(failure({ unit: 'cm', insertWidth: '4', insertHeight: '40', ease: '1', seam: '1', overlap: '5', hem: '1' }),
  'Insert width must be between 5 and 152 centimetres.');

// Decimal commas are accepted like the rest of the catalog.
const comma = run({ unit: 'in', insertWidth: '16,5', insertHeight: '12,5', ease: '0,75', seam: '0,5', overlap: '3,5', hem: '0,25' });
assert.equal(comma.coverWidth, 18);
assert.equal(comma.coverHeight, 14);
assert.equal(comma.frontHeight, 15);
assert.equal(comma.backPanelHeight, 9.5);

// Conversion helper is exact both ways.
closeTo(C.convert(1, 'in', 'cm'), 2.54, 'inch to centimetre');
closeTo(C.convert(2.54, 'cm', 'in'), 1, 'centimetre to inch');
assert.equal(C.convert(7, 'in', 'in'), 7);

// Invariants over a grid of inserts and allowances.
const inserts = [2, 12, 18, 26, 60];
const eases = [0, 0.5, 1, 3];
const seams = [0, 0.25, 0.5, 2];
const overlaps = [1, 4, 10];
const hems = [0, 0.5, 2];
let checked = 0;
for (const iw of inserts) {
  for (const ih of inserts) {
    for (const e of eases) {
      for (const s of seams) {
        for (const o of overlaps) {
          for (const h of hems) {
            const result = run({
              unit: 'in', insertWidth: String(iw), insertHeight: String(ih),
              ease: String(e), seam: String(s), overlap: String(o), hem: String(h)
            });
            closeTo(result.coverWidth, iw + 2 * e, 'cover width');
            closeTo(result.coverHeight, ih + 2 * e, 'cover height');
            closeTo(result.frontWidth, result.coverWidth + 2 * s, 'front width');
            closeTo(result.frontHeight, result.coverHeight + 2 * s, 'front height');
            closeTo(result.backPanelWidth, result.frontWidth, 'back panel width');
            closeTo(result.backTotalHeight, result.frontHeight + o + 2 * h, 'back total height');
            closeTo(result.backPanelHeight * 2, result.backTotalHeight, 'back panels add up');
            closeTo(result.totalArea, result.frontArea + 2 * result.backPanelArea, 'total area');
            closeTo(result.fabricLength, result.frontHeight + result.backTotalHeight, 'fabric length');
            closeTo(result.frontArea, result.frontWidth * result.frontHeight, 'front area');
            closeTo(result.backPanelArea, result.backPanelWidth * result.backPanelHeight, 'back area');
            assert.equal(result.panelWide, result.frontWidth > 44);
            assert.equal(result.overlapLarge, o > result.frontHeight / 2);
            checked += 1;
          }
        }
      }
    }
  }
}

// The same dimensions in centimetres scale every result by 2.54.
for (const [iw, ih, e, s, o, h] of [[18, 18, 0.5, 0.5, 4, 0.5], [12, 20, 1, 0.25, 6, 1], [26, 26, 2, 1, 8, 2]]) {
  const inches = run({ unit: 'in', insertWidth: String(iw), insertHeight: String(ih), ease: String(e), seam: String(s), overlap: String(o), hem: String(h) });
  const cm = run({
    unit: 'cm',
    insertWidth: String(C.convert(iw, 'in', 'cm')), insertHeight: String(C.convert(ih, 'in', 'cm')),
    ease: String(C.convert(e, 'in', 'cm')), seam: String(C.convert(s, 'in', 'cm')),
    overlap: String(C.convert(o, 'in', 'cm')), hem: String(C.convert(h, 'in', 'cm'))
  });
  closeTo(cm.frontWidth, C.convert(inches.frontWidth, 'in', 'cm'), 'cm front width');
  closeTo(cm.frontHeight, C.convert(inches.frontHeight, 'in', 'cm'), 'cm front height');
  closeTo(cm.fabricLength, C.convert(inches.fabricLength, 'in', 'cm'), 'cm fabric length');
  closeTo(cm.totalArea, inches.totalArea * 2.54 * 2.54, 'cm total area');
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 8, 'expected at least eight catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="pillow-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');

console.log('pillow cover calculator: ' + entry.testCases.length + ' catalog cases, ' + checked + ' grid rows and invariants passed');
