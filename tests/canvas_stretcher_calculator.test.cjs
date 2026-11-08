/* Regression checks for the canvas stretcher core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'canvas-stretcher-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* canvas-stretcher-core:start */');
const end = html.indexOf('/* canvas-stretcher-core:end */');
assert.ok(start > -1 && end > start, 'canvas-stretcher core markers missing');
const core = html.slice(start, end + '/* canvas-stretcher-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CanvasStretcherCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
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

const base = { mode: 'size', unit: 'in', width: '16', height: '20', depth: '1.5', turnover: '2' };

// Documented surface.
assert.deepEqual(Object.keys(C.LIMITS).sort(), ['cm', 'in']);
assert.equal(C.LIMITS.in.min, 1);
assert.equal(C.LIMITS.in.max, 240);
assert.equal(C.LIMITS.cm.max, 600);
assert.equal(C.FIT_LIMITS.in.max, 400);
assert.equal(C.FIT_LIMITS.cm.max, 1000);
assert.equal(C.UNITS.in.short, 'in');
assert.match(C.MESSAGES.tooSmall, /wider and taller/);

// Golden: face plus bar depth and fold-under on every side.
const sized = run(base);
assert.equal(sized.mode, 'size');
assert.equal(sized.unit, 'in');
assert.equal(sized.perSide, 3.5);
assert.equal(sized.added, 7);
assert.equal(sized.frontWidth, 16);
assert.equal(sized.frontHeight, 20);
assert.equal(sized.cutWidth, 23);
assert.equal(sized.cutHeight, 27);
assert.equal(sized.faceArea, 320);
assert.equal(sized.cutArea, 621);

// Fit mode inverts the same rule.
const fitted = run(Object.assign({}, base, { mode: 'fit', cutWidth: '23', cutHeight: '27' }));
assert.equal(fitted.frontWidth, 16);
assert.equal(fitted.frontHeight, 20);
assert.equal(fitted.cutWidth, 23);
assert.equal(fitted.cutHeight, 27);
assert.equal(fitted.faceArea, 320);

// Centimetres are the same geometry at the exact 2.54 conversion.
const metric = run({ mode: 'size', unit: 'cm', width: '40.64', height: '50.8', depth: '3.81', turnover: '5.08' });
assert.equal(metric.perSide, 8.89);
assert.equal(metric.added, 17.78);
assert.equal(metric.cutWidth, 58.42);
assert.equal(metric.cutHeight, 68.58);
closeTo(metric.faceArea, 40.64 * 50.8, 'metric face area');
closeTo(metric.cutArea, 58.42 * 68.58, 'metric cut area');

// Boundaries.
assert.equal(run(Object.assign({}, base, { turnover: '0' })).cutWidth, 19);
assert.equal(run(Object.assign({}, base, { depth: '0.25', turnover: '0' })).cutWidth, 16.5);
const largest = run(Object.assign({}, base, { width: '240', height: '240', depth: '4', turnover: '12' }));
assert.equal(largest.perSide, 16);
assert.equal(largest.cutWidth, 272);
assert.equal(largest.cutHeight, 272);
assert.equal(largest.cutArea, 73984);
assert.equal(run({ mode: 'fit', unit: 'in', cutWidth: '272', cutHeight: '272', depth: '4', turnover: '12' }).frontWidth, 240);
assert.equal(run({ mode: 'size', unit: 'cm', width: '2.5', height: '2.5', depth: '0.6', turnover: '0' }).cutWidth, 3.7);

// Validation refusals.
assert.equal(failure(Object.assign({}, base, { width: '' })), 'Enter the image width in inches.');
assert.equal(failure(Object.assign({}, base, { height: '   ' })), 'Enter the image height in inches.');
assert.equal(failure(Object.assign({}, base, { depth: 'deep' })), 'Bar depth must be a number in inches.');
assert.equal(failure(Object.assign({}, base, { width: '300' })), 'Image width must be between 1 and 240 inches.');
assert.equal(failure(Object.assign({}, base, { width: '0' })), 'Image width must be between 1 and 240 inches.');
assert.equal(failure(Object.assign({}, base, { height: '-2' })), 'Image height must be between 1 and 240 inches.');
assert.equal(failure(Object.assign({}, base, { depth: '5' })), 'Bar depth must be between 0.25 and 4 inches.');
assert.equal(failure(Object.assign({}, base, { turnover: '13' })), 'Fold-under must be between 0 and 12 inches.');
assert.equal(failure(Object.assign({}, base, { turnover: '-1' })), 'Fold-under must be between 0 and 12 inches.');
assert.equal(failure({ mode: 'size', unit: 'cm', width: '1', height: '20', depth: '1', turnover: '1' }),
  'Image width must be between 2.5 and 600 centimetres.');
assert.equal(failure(Object.assign({}, base, { mode: 'fit', cutWidth: '6', cutHeight: '6' })), C.MESSAGES.tooSmall);
assert.equal(failure(Object.assign({}, base, { mode: 'fit', cutWidth: '7', cutHeight: '12' })), C.MESSAGES.tooSmall);

// Decimal commas are accepted like the rest of the catalog.
assert.equal(run(Object.assign({}, base, { width: '16,5' })).cutWidth, 23.5);

// Conversion helper is exact both ways.
closeTo(C.convert(1, 'in', 'cm'), 2.54, 'inch to centimetre');
closeTo(C.convert(2.54, 'cm', 'in'), 1, 'centimetre to inch');
assert.equal(C.convert(7, 'in', 'in'), 7);

// Invariants over a grid of sizes and allowances.
const widths = [1, 4.5, 16, 60, 240];
const depths = [0.25, 0.75, 1.5, 4];
const turnovers = [0, 0.5, 2, 12];
for (const w of widths) {
  for (const h of widths) {
    for (const d of depths) {
      for (const t of turnovers) {
        const size = run({ mode: 'size', unit: 'in', width: String(w), height: String(h), depth: String(d), turnover: String(t) });
        closeTo(size.added, 2 * (d + t), 'added allowance');
        closeTo(size.cutWidth - size.frontWidth, 2 * (d + t), 'width allowance');
        closeTo(size.cutHeight - size.frontHeight, 2 * (d + t), 'height allowance');
        closeTo(size.cutArea, size.cutWidth * size.cutHeight, 'cut area');
        const back = run({ mode: 'fit', unit: 'in', cutWidth: String(size.cutWidth), cutHeight: String(size.cutHeight), depth: String(d), turnover: String(t) });
        closeTo(back.frontWidth, w, 'fit round trip width');
        closeTo(back.frontHeight, h, 'fit round trip height');
      }
    }
  }
}

// The same dimensions converted to centimetres scale every result by 2.54.
for (const [w, h, d, t] of [[16, 20, 1.5, 2], [8, 10, 0.75, 1], [40, 30, 3, 4]]) {
  const inches = run({ mode: 'size', unit: 'in', width: String(w), height: String(h), depth: String(d), turnover: String(t) });
  const cm = run({
    mode: 'size', unit: 'cm',
    width: String(C.convert(w, 'in', 'cm')), height: String(C.convert(h, 'in', 'cm')),
    depth: String(C.convert(d, 'in', 'cm')), turnover: String(C.convert(t, 'in', 'cm'))
  });
  closeTo(cm.cutWidth, C.convert(inches.cutWidth, 'in', 'cm'), 'cm cut width');
  closeTo(cm.cutHeight, C.convert(inches.cutHeight, 'in', 'cm'), 'cm cut height');
  closeTo(cm.faceArea, inches.faceArea * 2.54 * 2.54, 'cm face area');
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
      closeTo(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="canvas-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('[hidden]{display:none !important}'), 'hidden fieldsets must collapse');

console.log('canvas stretcher calculator: ' + entry.testCases.length + ' catalog cases and invariants passed');
