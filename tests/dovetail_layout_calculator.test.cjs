/* Regression checks for the dovetail layout core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dovetail-layout-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* dovetail-layout-core:start */');
const end = html.indexOf('/* dovetail-layout-core:end */');
assert.ok(start > -1 && end > start, 'dovetail core markers missing');
const core = html.slice(start, end + '/* dovetail-layout-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DovetailLayoutCore;', sandbox);
const C = sandbox.module.exports;

function run(input) {
  return C.calculate(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent layout arithmetic: half pin, n tails, n-1 pins, half pin, with the
// marks accumulated left to right exactly as the method describes.
function oracle(input) {
  const width = Number(String(input.width).replace(',', '.'));
  const tails = Number(input.tails);
  const ratio = Number(String(input.ratio).replace(',', '.'));
  const tail = width / (tails * (1 + ratio));
  const pin = ratio * tail;
  const half = pin / 2;
  const marks = [];
  let position = half;
  marks.push(position);
  for (let index = 1; index <= tails; index += 1) {
    position += tail;
    marks.push(position);
    if (index < tails) {
      position += pin;
      marks.push(position);
    }
  }
  const round = (value) => Math.round(value * 1000) / 1000;
  return {
    width, tails, ratio,
    tailWidth: round(tail), pinWidth: round(pin), halfPin: round(half),
    fullPins: tails - 1, pinCount: tails + 1,
    tailsTotal: round(tails * tail), pinsTotal: round(tails * pin),
    marks: marks.map(round),
    segments: 2 * tails + 1,
  };
}

const base = { width: '200', tails: '4', ratio: '0.5' };

// Documented surface.
assert.equal(C.DEFAULTS.width, 200);
assert.equal(C.DEFAULTS.tails, 4);
assert.equal(C.DEFAULTS.ratio, 0.5);
assert.equal(C.MIN_WIDTH, 10);
assert.equal(C.MAX_WIDTH, 1000);
assert.equal(C.MAX_TAILS, 10);
assert.equal(C.MIN_RATIO, 0.2);
assert.equal(C.MAX_RATIO, 3);
assert.equal(C.MIN_FEATURE, 3);

// Golden: default 200 mm board, four tails, pins half the tail width.
const layout = run(base);
assert.equal(layout.tailWidth, 33.333);
assert.equal(layout.pinWidth, 16.667);
assert.equal(layout.halfPin, 8.333);
assert.equal(layout.fullPins, 3);
assert.equal(layout.pinCount, 5);
assert.equal(layout.segments, 9);
assert.deepEqual(Array.from(layout.marks), [8.333, 41.667, 58.333, 91.667, 108.333, 141.667, 158.333, 191.667]);
assert.ok(Math.abs(layout.tailsTotal + layout.pinsTotal - layout.width) < 0.01, 'tails plus pins fill the width');

// One tail sits between two half pins with no full pin.
const single = run({ width: '200', tails: '1', ratio: '1' });
assert.equal(single.tailWidth, 100);
assert.equal(single.pinWidth, 100);
assert.equal(single.halfPin, 50);
assert.equal(single.fullPins, 0);
assert.equal(single.pinCount, 2);
assert.deepEqual(Array.from(single.marks), [50, 150]);

// Decimal commas parse in every numeric field.
const commas = run({ width: '150,5', tails: '5', ratio: '0,75' });
assert.equal(commas.width, 150.5);
assert.equal(commas.ratio, 0.75);
assert.equal(commas.marks.length, 10);

// The feature minimum is enforced, not warned about.
assert.equal(failure({ width: '20', tails: '10', ratio: '1' }),
  'That layout leaves tails under 3 mm wide; use fewer tails, a wider board or a smaller pin ratio.');
assert.equal(failure({ width: '20', tails: '2', ratio: '0.2' }),
  'That layout leaves pins under 3 mm wide; use fewer tails or a larger pin ratio.');
assert.equal(run({ width: '18', tails: '2', ratio: '0.5' }).pinWidth, 3, 'a 3 mm pin is accepted');

// Invariants across a grid of widths, tail counts and ratios.
const widths = ['10', '12', '40', '100', '200', '333.3', '1000'];
const ratios = ['0.2', '0.5', '1', '1.5', '3'];
let checked = 0;
for (const width of widths) {
  for (let tails = 1; tails <= 6; tails += 1) {
    for (const ratio of ratios) {
      const input = { width, tails: String(tails), ratio };
      let result;
      try {
        result = run(input);
      } catch (error) {
        // Only the documented feature minimum may refuse a grid row.
        assert.ok(/under 3 mm wide/.test(error.message), error.message + ' ' + JSON.stringify(input));
        assert.ok(oracle(input).tailWidth < 3 || oracle(input).pinWidth < 3, 'refused for the wrong reason');
        continue;
      }
      const expected = oracle(input);
      for (const key of ['tailWidth', 'pinWidth', 'halfPin', 'tailsTotal', 'pinsTotal']) {
        assert.ok(Math.abs(result[key] - expected[key]) < 1e-9, key + ' ' + JSON.stringify(input));
      }
      assert.equal(result.fullPins, tails - 1);
      assert.equal(result.pinCount, tails + 1);
      assert.equal(result.marks.length, 2 * tails, 'mark count ' + JSON.stringify(input));
      for (let index = 0; index < expected.marks.length; index += 1) {
        assert.ok(Math.abs(result.marks[index] - expected.marks[index]) < 1e-9,
          'mark ' + index + ' ' + JSON.stringify(input));
      }
      assert.ok(Math.abs(result.tailsTotal + result.pinsTotal - result.width) < 0.01, 'fills the width');
      assert.ok(result.marks[0] > 0 && result.marks[result.marks.length - 1] < result.width,
        'marks sit inside the board edges');
      for (let index = 1; index < result.marks.length; index += 1) {
        assert.ok(result.marks[index] > result.marks[index - 1], 'marks increase left to right');
      }
      checked += 1;
    }
  }
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2278, 'catalog total');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 20, 'expected at least twenty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (Array.isArray(value)) {
        assert.equal(result[key].length, value.length, testCase.name + ' ' + key + ' length');
        for (let index = 0; index < value.length; index += 1) {
          assert.ok(Math.abs(result[key][index] - value[index]) < 1e-9, testCase.name + ' ' + key + '[' + index + ']');
        }
      } else if (typeof value === 'number') {
        assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
      } else {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      }
    }
  }
}

// Refusals name the field and rule.
assert.equal(failure({ ...base, width: '' }), 'Enter the board width.');
assert.equal(failure({ ...base, width: 'wide' }), 'Board width must be a number from 10 to 1000 mm.');
assert.equal(failure({ ...base, width: '9.5' }), 'Board width must be a number from 10 to 1000 mm.');
assert.equal(failure({ ...base, width: '2e2' }), 'Board width must be a number from 10 to 1000 mm.');
assert.equal(failure({ ...base, tails: '' }), 'Enter the number of tails.');
assert.equal(failure({ ...base, tails: '0' }), 'Number of tails must be a whole number from 1 to 10.');
assert.equal(failure({ ...base, tails: '4.5' }), 'Number of tails must be a whole number from 1 to 10.');
assert.equal(failure({ ...base, tails: '11' }), 'Number of tails must be a whole number from 1 to 10.');
assert.equal(failure({ ...base, ratio: '' }), 'Enter the pin to tail ratio.');
assert.equal(failure({ ...base, ratio: '0.1' }), 'Pin to tail ratio must be a number from 0.2 to 3.');
assert.equal(failure({ ...base, ratio: '3.5' }), 'Pin to tail ratio must be a number from 0.2 to 3.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="dovetail-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['in-width', 'in-tails', 'in-ratio']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('dovetail layout calculator: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
