/* Regression checks for the leather belt sizing core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'leather-belt-sizing-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* belt-core:start */');
const end = html.indexOf('/* belt-core:end */');
assert.ok(start > -1 && end > start, 'belt core markers missing');
const core = html.slice(start, end + '/* belt-core:end */'.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BeltCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.calculate(input));
const failure = (input) => {
  try { C.calculate(input); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, (label || '') + ': ' + actual + ' != ' + expected);

// ---- Exported contract.
assert.equal(C.MIN_HOLE_FROM_FOLD_MM, 25.4);
assert.deepEqual(Object.keys(C.UNITS).sort(), ['cm', 'in', 'mm']);
assert.equal(C.UNITS.in.mm, 25.4);
assert.equal(C.UNITS.cm.mm, 10);
assert.equal(C.UNITS.mm.mm, 1);
for (const unit of Object.values(C.UNITS)) {
  for (const key of ['waist', 'allowance', 'spacing', 'tip', 'fold']) {
    assert.ok(Array.isArray(unit[key]) && unit[key][0] < unit[key][1], 'bounds are ordered: ' + unit.id + ' ' + key);
  }
  assert.ok(unit.digits >= 0 && unit.digits <= 3, 'display digits stay small: ' + unit.id);
}

// ---- The default 36 in waist lands on whole inches.
const base = run({});
assert.equal(base.unit, 'in');
assert.equal(base.unitLabel, 'in');
assert.equal(base.digits, 2);
assert.equal(base.holes, 5);
assert.equal(base.waist, 36);
assert.equal(base.allowance, 1);
assert.equal(base.spacing, 1);
assert.equal(base.tip, 4);
assert.equal(base.fold, 1.75);
assert.equal(base.centreHole, 37);
assert.equal(base.firstHole, 35);
assert.equal(base.lastHole, 39);
assert.equal(base.beltLength, 43);
assert.equal(base.blankLength, 44.75);
assert.equal(base.spread, 4);
assert.equal(base.positions.length, 5);
assert.deepEqual(base.positions.map((place) => place.hole), [1, 2, 3, 4, 5]);
assert.deepEqual(base.positions.map((place) => place.fromFold), [35, 36, 37, 38, 39]);
assert.deepEqual(base.positions.map((place) => place.fitsWaist), [34, 35, 36, 37, 38]);
assert.equal(base.positions[2].fitsWaist, base.waist);

// ---- Geometry identities hold in millimetres for every unit system.
const identity = (result, input) => {
  const unit = C.UNITS[result.unit];
  close(result.centreHoleMm, input.waist * unit.mm + input.allowance * unit.mm, 'centre hole');
  close(result.spreadMm, (input.holes - 1) * input.spacing * unit.mm, 'hole span');
  close(result.firstHoleMm, result.centreHoleMm - result.spreadMm / 2, 'first hole');
  close(result.lastHoleMm, result.centreHoleMm + result.spreadMm / 2, 'last hole');
  close(result.beltLengthMm, result.lastHoleMm + input.tip * unit.mm, 'belt length');
  close(result.blankLengthMm, result.beltLengthMm + input.fold * unit.mm, 'blank length');
  assert.equal(result.positions.length, input.holes);
  assert.ok(result.positions[0].fromFold <= result.positions[input.holes - 1].fromFold);
};
identity(base, { waist: 36, allowance: 1, spacing: 1, holes: 5, tip: 4, fold: 1.75 });

// ---- The same belt expressed in inches, centimetres and millimetres agrees.
const inches = C.calculate({ unit: 'in', waist: '36', allowance: '1', spacing: '1', holes: '5', tip: '4', fold: '1.75' });
const centimetres = C.calculate({ unit: 'cm', waist: '91.44', allowance: '2.54', spacing: '2.54', holes: '5', tip: '10.16', fold: '4.445' });
const millimetres = C.calculate({ unit: 'mm', waist: '914.4', allowance: '25.4', spacing: '25.4', holes: '5', tip: '101.6', fold: '44.45' });
for (const key of ['centreHoleMm', 'firstHoleMm', 'lastHoleMm', 'beltLengthMm', 'blankLengthMm', 'spreadMm', 'allowanceMm', 'spacingMm']) {
  close(centimetres[key], inches[key], 'centimetres ' + key);
  close(millimetres[key], inches[key], 'millimetres ' + key);
}
// Display rounding follows the unit, so whole inches stay whole and millimetres keep a decimal.
assert.equal(inches.beltLength, 43);
assert.equal(centimetres.beltLength, 109.2);
assert.equal(millimetres.beltLength, 1092.2);

// ---- A 25 mm pitch on a metric belt is a clean 40 mm per hole step.
const metric = run({ unit: 'mm', waist: '400', allowance: '0', spacing: '25', holes: '7', tip: '100', fold: '45' });
assert.equal(metric.centreHole, 400);
assert.equal(metric.firstHole, 325);
assert.equal(metric.lastHole, 475);
assert.equal(metric.beltLength, 575);
assert.equal(metric.blankLength, 620);
assert.deepEqual(metric.positions.map((place) => place.fromFold), [325, 350, 375, 400, 425, 450, 475]);

// ---- Three holes put the centre hole on the waist and one each side.
const three = run({ waist: '32', allowance: '0.5', spacing: '1.25', holes: '3', tip: '2.5', fold: '1.5' });
assert.equal(three.centreHole, 32.5);
assert.equal(three.firstHole, 31.25);
assert.equal(three.lastHole, 33.75);
assert.equal(three.beltLength, 36.25);
assert.equal(three.blankLength, 37.75);
assert.deepEqual(three.positions.map((place) => place.fitsWaist), [30.75, 32, 33.25]);

// ---- Eleven holes is the widest layout and still ordered.
const wide = run({ waist: '79', allowance: '4', spacing: '3', holes: '11', tip: '10', fold: '4' });
assert.equal(wide.holes, 11);
assert.equal(wide.centreHole, 83);
assert.equal(wide.firstHole, 68);
assert.equal(wide.lastHole, 98);
assert.equal(wide.beltLength, 108);
assert.equal(wide.blankLength, 112);
assert.equal(wide.positions[10].fromFold, 98);

// ---- A negative allowance shortens the belt without changing the layout.
const tight = run({ waist: '34', allowance: '-0.5', spacing: '1', holes: '5', tip: '3.5', fold: '1.75' });
assert.equal(tight.centreHole, 33.5);
assert.equal(tight.beltLength, 39);
assert.equal(tight.blankLength, 40.75);
identity(tight, { waist: 34, allowance: -0.5, spacing: 1, holes: 5, tip: 3.5, fold: 1.75 });

// ---- Inclusive bounds at both ends of every range.
const low = run({ unit: 'mm', waist: '300', allowance: '-50', spacing: '12.7', holes: '3', tip: '25', fold: '20' });
assert.equal(low.centreHole, 250);
assert.equal(low.firstHole, 237.3);
assert.equal(low.lastHole, 262.7);
assert.equal(low.beltLength, 287.7);
const high = run({ unit: 'cm', waist: '200', allowance: '10', spacing: '7.62', holes: '11', tip: '25', fold: '10' });
assert.equal(high.centreHole, 210);
assert.equal(high.firstHole, 171.9);
assert.equal(high.lastHole, 248.1);
assert.equal(high.beltLength, 273.1);
assert.equal(high.blankLength, 283.1);

// ---- Bad input fails with an actionable message, never a silent default.
assert.match(failure({ waist: '' }), /^Waist is required\.$/);
assert.match(failure({ waist: 'thirty six' }), /^Waist must be a number from 12 to 79 in\.$/);
assert.match(failure({ waist: '11.9' }), /^Waist must be a number from 12 to 79 in\.$/);
assert.match(failure({ waist: '79.01' }), /^Waist must be a number from 12 to 79 in\.$/);
assert.match(failure({ spacing: '1,5' }), /^Hole spacing must be a number from 0.5 to 3 in\.$/);
assert.match(failure({ spacing: '2e0' }), /^Hole spacing must be a number from 0.5 to 3 in\.$/);
assert.match(failure({ holes: '6' }), /^Hole count must be odd so one hole sits at the centre\.$/);
assert.match(failure({ holes: '13' }), /^Hole count must be a whole number from 3 to 11\.$/);
assert.match(failure({ fold: '0.7' }), /^Fold-back must be a number from 0.8 to 4 in\.$/);
assert.match(failure({ tip: '' }), /^Tip allowance is required\.$/);
assert.match(failure({ unit: 'yds' }), /^Choose inches, centimetres or millimetres\.$/);
assert.match(
  failure({ waist: '12', allowance: '0', spacing: '3', holes: '11' }),
  /^The hole span does not fit: with 11 holes at 3 in the first hole falls before the buckle fold\. Use fewer holes or a tighter spacing\.$/
);
// A hole that would sit inside the buckle fold is refused, not clamped.
assert.match(
  failure({ waist: '12', allowance: '0', spacing: '2.35', holes: '11' }),
  /^The first hole would sit 0\.25 in from the fold: the buckle needs about 1 in of strap\. Use fewer holes, a tighter spacing or a longer waist\.$/
);
// Exactly one inch of strap before the first hole is allowed.
assert.equal(run({ waist: '12', allowance: '0', spacing: '2.2', holes: '11' }).firstHole, 1);

// ---- Seeded sweep: thousands of legal layouts keep every identity.
const random = (() => {
  let state = 0x5eed1234;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
})();
const between = (min, max) => min + random() * (max - min);
const round3 = (number) => Math.round(number * 1000) / 1000;
let sweep = 0;
let refused = 0;
for (let index = 0; index < 400; index += 1) {
  const unitId = ['in', 'cm', 'mm'][index % 3];
  const unit = C.UNITS[unitId];
  const holes = [3, 5, 7, 9, 11][Math.floor(random() * 5)];
  const input = {
    unit: unitId,
    waist: round3(between(unit.waist[0], unit.waist[1])).toString(),
    allowance: (Math.round(between(unit.allowance[0], unit.allowance[1]) * 100) / 100).toString(),
    spacing: round3(between(unit.spacing[0], unit.spacing[1])).toString(),
    holes: String(holes),
    tip: round3(between(unit.tip[0], unit.tip[1])).toString(),
    fold: round3(between(unit.fold[0], unit.fold[1])).toString()
  };
  if (failure(input)) { refused += 1; continue; }
  const result = C.calculate(input);
  sweep += 1;
  identity(result, {
    waist: Number(input.waist), allowance: Number(input.allowance), spacing: Number(input.spacing),
    holes, tip: Number(input.tip), fold: Number(input.fold)
  });
  // Display values trail the exact millimetre figures by at most half a display step.
  const step = Math.pow(10, -unit.digits);
  for (const [display, exact] of [
    ['centreHole', 'centreHoleMm'], ['firstHole', 'firstHoleMm'], ['lastHole', 'lastHoleMm'],
    ['beltLength', 'beltLengthMm'], ['blankLength', 'blankLengthMm'], ['spread', 'spreadMm']
  ]) {
    assert.ok(Math.abs(result[display] - result[exact] / unit.mm) <= step / 2 + 1e-9, display + ' rounds within its step');
  }
}
assert.ok(sweep > 300, 'the sweep exercises the core (' + sweep + ' layouts)');

// ---- The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
for (const id of ['belt-form', 'in-unit', 'in-waist', 'in-allowance', 'in-spacing', 'in-holes', 'in-tip', 'in-fold', 'err', 'out', 'warn']) {
  assert.ok(html.includes('id="' + id + '"'), 'page keeps the element ' + id);
}
assert.ok(html.includes('<div id="site-header"></div>'), 'page uses the shared header');
assert.ok(html.includes('/assets/style.css') && html.includes('/assets/app.js'), 'page uses the shared assets');

// ---- Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('leather-belt-sizing-calculator: all checks passed (' + record.testCases.length + ' catalog cases, ' + sweep + ' swept layouts)');
