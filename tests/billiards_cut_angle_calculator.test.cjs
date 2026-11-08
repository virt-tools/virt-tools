/* Regression checks for the billiards cut angle core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'billiards-cut-angle-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* billiards-cut-angle-core:start */');
const end = html.indexOf('/* billiards-cut-angle-core:end */');
assert.ok(start > -1 && end > start, 'billiards core markers missing');
const core = html.slice(start, end + '/* billiards-cut-angle-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BilliardsCore;', sandbox);
const C = sandbox.module.exports;

const DEG = Math.PI / 180;
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

const base = { table: '9', pocket: 'tr', unit: 'in', cueX: '30', cueY: '25', objX: '70', objY: '25' };

// Documented surface.
assert.deepEqual(Object.keys(C.UNITS).sort(), ['cm', 'in']);
assert.equal(C.UNITS.in.name, 'inches');
assert.equal(C.UNITS.cm.short, 'cm');
assert.deepEqual(Object.keys(C.TABLES).sort(), ['7', '8', '9']);
assert.equal(C.TABLES['7'].lengthIn, 78);
assert.equal(C.TABLES['8'].widthIn, 44);
assert.equal(C.TABLES['9'].lengthIn, 100);
assert.equal(C.BALL_DIAMETER_IN, 2.25);
assert.deepEqual(Object.keys(C.POCKETS).sort(), ['bl', 'bm', 'br', 'tl', 'tm', 'tr']);
assert.match(C.MESSAGES.noDirectCut, /pocket side/);
assert.match(C.MESSAGES.extreme, /thin edge/);

// Golden: the default moderate cut on a 9 ft table.
const sized = run(base);
assert.equal(sized.unit, 'in');
assert.equal(sized.tableLabel, '9 ft');
assert.equal(sized.pocketName, 'top-right corner');
closeTo(sized.ghostX, 68.271502, 'default ghost x', 1e-6);
closeTo(sized.ghostY, 23.559585, 'default ghost y', 1e-6);
closeTo(sized.contactX, 69.135751, 'default contact x', 1e-6);
closeTo(sized.contactY, 24.279793, 'default contact y', 1e-6);
closeTo(sized.cueDistance, 38.298599, 'default cue distance', 1e-6);
closeTo(sized.objectDistance, 39.051248, 'default object distance', 1e-6);
closeTo(sized.cutAngle, 41.960981, 'default cut', 1e-6);
closeTo(sized.aimOffset, 1.504405, 'default aim offset', 1e-6);
assert.equal(sized.feasible, true);

// A straight-in shot has no cut and the ghost ball sits on the same line.
const straight = run({ table: '9', pocket: 'bm', unit: 'in', cueX: '50', cueY: '30', objX: '50', objY: '10' });
closeTo(straight.cutAngle, 0, 'straight cut');
closeTo(straight.ghostX, 50, 'straight ghost x');
closeTo(straight.ghostY, 12.25, 'straight ghost y');
closeTo(straight.cueDistance, 17.75, 'straight cue distance');
closeTo(straight.objectDistance, 10, 'straight object distance');
closeTo(straight.aimOffset, 0, 'straight offset');
assert.equal(straight.feasible, true);

// A cue ball on the pocket side cannot cut the ball toward that pocket.
const blocked = run({ table: '9', pocket: 'tr', unit: 'in', cueX: '85', cueY: '40', objX: '70', objY: '25' });
closeTo(blocked.cutAngle, 175.303191, 'blocked cut', 1e-6);
assert.equal(blocked.feasible, false);

// Centimetres are the same geometry at the exact 2.54 conversion.
const cm = run({ table: '9', pocket: 'tr', unit: 'cm', cueX: '60', cueY: '50', objX: '200', objY: '60' });
closeTo(cm.tableLength, 254, 'cm length');
closeTo(cm.tableWidth, 127, 'cm width');
closeTo(cm.cutAngle, 48.80229, 'cm cut', 1e-6);
closeTo(cm.objectDistance, 86.05231, 'cm object distance', 1e-6);
closeTo(cm.ballRadius, 2.8575, 'cm radius');

// Both rails margins are allowed, and decimal commas are accepted.
const margins = run({ table: '7', pocket: 'tr', unit: 'in', cueX: '1.125', cueY: '1.125', objX: '76.875', objY: '37.875' });
closeTo(margins.cueDistance, 82.0714, 'margin cue distance', 1e-6);
closeTo(margins.cutAngle, 19.634229, 'margin cut', 1e-6);
const comma = run({ table: '9', pocket: 'br', unit: 'in', cueX: '30,5', cueY: '25,5', objX: '70,5', objY: '28,5' });
closeTo(comma.cutAngle, 50.792475, 'comma cut', 1e-6);

// Validation refusals.
assert.equal(failure(Object.assign({}, base, { cueX: '' })), 'Enter a value for cue ball x in inches.');
assert.equal(failure(Object.assign({}, base, { objY: '   ' })), 'Enter a value for object ball y in inches.');
assert.equal(failure(Object.assign({}, base, { cueY: 'high' })), 'Cue ball y must be a number in inches.');
assert.equal(failure(Object.assign({}, base, { objX: '1e2' })), 'Object ball x must be a number in inches.');
assert.equal(failure(Object.assign({}, base, { cueX: '-5' })), 'Cue ball x must be a number in inches.');
assert.equal(failure(Object.assign({}, base, { cueX: '101' })), 'Cue ball x must be between 0 and 100 inches.');
assert.equal(failure(Object.assign({}, base, { cueY: '0.5' })),
  'The cue ball must be at least one ball radius (1.125 in) inside the rails.');
assert.equal(failure(Object.assign({}, base, { objX: '1' })),
  'The object ball must be at least one ball radius (1.125 in) inside the rails.');
assert.equal(failure(Object.assign({}, base, { cueX: '70', cueY: '25', objX: '70', objY: '25' })),
  'The cue ball and object ball cannot overlap; move them at least 2.25 in apart.');
assert.equal(failure({ table: '9', pocket: 'tr', unit: 'cm', cueX: '', cueY: '25', objX: '70', objY: '25' }),
  'Enter a value for cue ball x in centimetres.');
assert.equal(failure({ table: '7', pocket: 'tr', unit: 'in', cueX: '80', cueY: '25', objX: '70', objY: '25' }),
  'Cue ball x must be between 0 and 78 inches.');

// Independent oracle: same geometry via atan2 of the cross and dot products,
// with no shared code or constants from the page core.
function oracle(input) {
  const tables = { 7: [78, 39], 8: [88, 44], 9: [100, 50] };
  const pockets = { bl: [0, 0], bm: [0.5, 0], br: [1, 0], tl: [0, 1], tm: [0.5, 1], tr: [1, 1] };
  const scale = input.unit === 'cm' ? 2.54 : 1;
  const [lengthIn, widthIn] = tables[input.table || '9'];
  const length = lengthIn * scale;
  const width = widthIn * scale;
  const radius = 1.125 * scale;
  const num = (value) => Number(String(value).replace(',', '.'));
  const cueX = num(input.cueX), cueY = num(input.cueY);
  const objX = num(input.objX), objY = num(input.objY);
  const [fx, fy] = pockets[input.pocket || 'tr'];
  const pocketX = fx * length, pocketY = fy * width;
  const objectDistance = Math.hypot(pocketX - objX, pocketY - objY);
  const ux = (pocketX - objX) / objectDistance;
  const uy = (pocketY - objY) / objectDistance;
  const ghostX = objX - 2 * radius * ux;
  const ghostY = objY - 2 * radius * uy;
  const contactX = objX - radius * ux;
  const contactY = objY - radius * uy;
  const vx = ghostX - cueX, vy = ghostY - cueY;
  const cueDistance = Math.hypot(vx, vy);
  const cutAngle = cueDistance < 1e-9
    ? 0
    : Math.atan2(Math.abs(vx * uy - vy * ux), vx * ux + vy * uy) / DEG;
  return {
    tableLength: length, tableWidth: width, ballRadius: radius, pocketX, pocketY,
    ghostX, ghostY, contactX, contactY, cueDistance, objectDistance, cutAngle,
    feasible: cutAngle <= 90 + 1e-9,
    aimOffset: 2 * radius * Math.sin(cutAngle * DEG),
  };
}

// Invariants over a grid of tables, pockets and ball positions.
const tables = ['7', '8', '9'];
const pockets = ['bl', 'bm', 'br', 'tl', 'tm', 'tr'];
const cueFractions = [[0.2, 0.2], [0.2, 0.8], [0.8, 0.2], [0.8, 0.8], [0.5, 0.3], [0.35, 0.65]];
const objFractions = [[0.3, 0.3], [0.55, 0.55], [0.75, 0.4], [0.45, 0.75], [0.65, 0.2]];
let checked = 0;
for (const table of tables) {
  const { lengthIn, widthIn } = C.TABLES[table];
  for (const pocket of pockets) {
    for (const [cx, cy] of cueFractions) {
      for (const [ox, oy] of objFractions) {
        const input = {
          table, pocket, unit: 'in',
          cueX: String(cx * lengthIn), cueY: String(cy * widthIn),
          objX: String(ox * lengthIn), objY: String(oy * widthIn),
        };
        const result = run(input);
        const expected = oracle(input);
        for (const key of ['tableLength', 'tableWidth', 'ballRadius', 'pocketX', 'pocketY',
          'ghostX', 'ghostY', 'contactX', 'contactY', 'cueDistance', 'objectDistance',
          'cutAngle', 'aimOffset']) {
          closeTo(result[key], expected[key], table + '/' + pocket + ' ' + key + ' ' + JSON.stringify(input),
            key === 'cutAngle' || key === 'aimOffset' ? 1e-5 : 1e-9);
        }
        assert.equal(result.feasible, expected.feasible, 'feasible flag ' + JSON.stringify(input));
        assert.ok(result.cutAngle >= 0 && result.cutAngle <= 180, 'cut angle range');
        closeTo(Math.hypot(result.ghostX - result.objX, result.ghostY - result.objY),
          2 * result.ballRadius, 'ghost separation');
        closeTo(Math.hypot(result.contactX - result.objX, result.contactY - result.objY),
          result.ballRadius, 'contact separation');
        checked += 1;
      }
    }
  }
}

// Inches and centimetres describe the same shot.
const inCase = run(base);
const cmCase = run({
  table: '9', pocket: 'tr', unit: 'cm',
  cueX: String(30 * 2.54), cueY: String(25 * 2.54),
  objX: String(70 * 2.54), objY: String(25 * 2.54),
});
closeTo(cmCase.cutAngle, inCase.cutAngle, 'unit cut agreement');
closeTo(cmCase.cueDistance, inCase.cueDistance * 2.54, 'unit cue distance agreement', 1e-9);
closeTo(cmCase.objectDistance, inCase.objectDistance * 2.54, 'unit object distance agreement', 1e-9);
closeTo(cmCase.aimOffset, inCase.aimOffset * 2.54, 'unit aim offset agreement', 1e-9);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
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
      if (typeof value === 'boolean') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
      }
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="cut-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['cueX', 'cueY', 'objX', 'objY']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');

console.log('billiards cut angle calculator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
