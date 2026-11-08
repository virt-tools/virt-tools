/* Regression checks for the dough temperature core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dough-temperature-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* dough-temperature-core:start */');
const end = html.indexOf('/* dough-temperature-core:end */');
assert.ok(start > -1 && end > start, 'dough temperature core markers missing');
const core = html.slice(start, end + '/* dough-temperature-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DoughTemperatureCore;', sandbox);
const T = sandbox.module.exports;

const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

function run(input) {
  return T.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { target: '24', factors: '3', flour: '20', room: '21', friction: '4' };

// Documented surface.
assert.equal(T.LIMITS.target[0], 1);
assert.equal(T.LIMITS.target[1], 45);
assert.equal(T.LIMITS.flour[0], -20);
assert.equal(T.LIMITS.flour[1], 50);
assert.equal(T.LIMITS.room[0], -20);
assert.equal(T.LIMITS.room[1], 50);
assert.equal(T.LIMITS.preferment[0], -20);
assert.equal(T.LIMITS.preferment[1], 50);
assert.equal(T.LIMITS.friction[0], 0);
assert.equal(T.LIMITS.friction[1], 30);
assert.match(T.MESSAGES.plan, /thermometer/);
assert.match(T.MESSAGES.ice, /Below 0/);
assert.match(T.MESSAGES.hot, /tap water/);

// Golden: a straight dough at 24 °C from 20 °C flour, a 21 °C room and 4 °C of friction.
const straight = run(base);
assert.equal(straight.factors, 3);
assert.equal(straight.preferment, null);
assert.equal(straight.other, 45);
assert.equal(straight.total, 72);
assert.equal(straight.water, 27);
assert.equal(straight.gap, 6);
assert.equal(straight.roomWaterDough, 22);

// Golden: the same target with a preferment counted as the fourth temperature.
const prefermented = run({ target: '24', factors: '4', flour: '18', room: '22', preferment: '16', friction: '6' });
assert.equal(prefermented.factors, 4);
assert.equal(prefermented.other, 62);
assert.equal(prefermented.total, 96);
assert.equal(prefermented.water, 34);
assert.equal(prefermented.gap, 12);
assert.equal(prefermented.roomWaterDough, 21);

// Golden: a cold kitchen with heavy friction asks for warmer water.
const cold = run({ target: '26', factors: '3', flour: '12.5', room: '14', friction: '12' });
closeTo(cold.other, 38.5, 'cold other');
closeTo(cold.water, 39.5, 'cold water');
closeTo(cold.gap, 25.5, 'cold gap');
closeTo(cold.roomWaterDough, 17.5, 'cold room-water dough');

// Golden: warm flour and room with heavy friction cannot be met with liquid water.
const icy = run({ target: '18', factors: '3', flour: '24', room: '26', friction: '10' });
closeTo(icy.water, -6, 'ice case water');
closeTo(icy.gap, -32, 'ice case gap');
closeTo(icy.roomWaterDough, 86 / 3, 'ice case room-water dough');
assert.ok(icy.water < 0, 'the ice case must fall below freezing');

// The formula in both directions: the dough is the average of the factors.
for (const target of [1, 12, 24, 30, 45]) {
  for (const factors of ['3', '4']) {
    for (const [flour, room, preferment, friction] of [
      [-20, -20, -20, 0], [0, 0, 0, 0], [12.5, 14, 16, 6], [20, 21, 18, 4], [50, 50, 50, 30],
    ]) {
      const input = { target: String(target), factors, flour: String(flour), room: String(room), friction: String(friction) };
      if (factors === '4') input.preferment = String(preferment);
      const result = run(input);
      const other = flour + room + friction + (factors === '4' ? preferment : 0);
      closeTo(result.other, other, 'sum of other temperatures');
      closeTo(result.total, target * Number(factors), 'target times factors');
      closeTo(result.water, target * Number(factors) - other, 'water temperature identity');
      closeTo(result.water, result.total - result.other, 'water from total and sum');
      closeTo(result.gap, result.water - room, 'gap to the room');
      closeTo(result.roomWaterDough, (result.other + room) / Number(factors), 'room-water dough identity');
      closeTo((result.other + result.water) / Number(factors), target, 'mixed dough averages to the target');
    }
  }
}

// Water moves one degree for one degree of target, and one degree the other way
// for every degree the flour, room, preferment or friction gains.
for (const factors of ['3', '4']) {
  const input = Object.assign({}, base, { factors });
  if (factors === '4') input.preferment = '16';
  const result = run(input);
  closeTo(run(Object.assign({}, input, { target: '25' })).water, result.water + Number(factors),
    'target sensitivity ' + factors);
  closeTo(run(Object.assign({}, input, { flour: '21' })).water, result.water - 1, 'flour sensitivity ' + factors);
  closeTo(run(Object.assign({}, input, { room: '22' })).water, result.water - 1, 'room sensitivity ' + factors);
  closeTo(run(Object.assign({}, input, { friction: '5' })).water, result.water - 1, 'friction sensitivity ' + factors);
  if (factors === '4') {
    closeTo(run(Object.assign({}, input, { preferment: '17' })).water, result.water - 1,
      'preferment sensitivity');
  }
}

// A preferment temperature is ignored when only three temperatures are averaged.
const ignored = run(Object.assign({}, base, { preferment: '-10' }));
assert.equal(ignored.water, straight.water);
assert.equal(ignored.preferment, null);

// Warmer surroundings always allow cooler water.
let previous = -Infinity;
for (const room of [-20, 0, 10, 21, 35, 50]) {
  const water = run(Object.assign({}, base, { room: String(room) })).water;
  assert.ok(water < previous || previous === -Infinity, 'water must fall as the room warms at ' + room);
  previous = water;
}
assert.ok(run(Object.assign({}, base, { target: '26' })).water > straight.water, 'a warmer target needs warmer water');

// Boundaries: both ends of every accepted range compute.
closeTo(run({ target: '1', factors: '3', flour: '-20', room: '-20', friction: '0' }).water, 43, 'minimum water');
closeTo(run({ target: '1', factors: '3', flour: '-20', room: '-20', friction: '0' }).gap, 63, 'minimum gap');
closeTo(run({ target: '45', factors: '3', flour: '50', room: '50', friction: '30' }).water, 5, 'maximum water');
closeTo(run({ target: '45', factors: '4', flour: '50', room: '50', preferment: '50', friction: '30' }).water, 0,
  'water at the highest accepted everything');
closeTo(run({ target: '45', factors: '4', flour: '-20', room: '-20', preferment: '-20', friction: '0' }).other, -60,
  'minimum sum with a preferment');

// Validation refusals, in the order the page reports them.
assert.equal(failure(Object.assign({}, base, { target: '' })), 'Enter the target dough temperature in °C.');
assert.equal(failure(Object.assign({}, base, { target: 'warm' })), 'Target dough temperature must be a number in °C.');
assert.equal(failure(Object.assign({}, base, { target: '1e1' })), 'Target dough temperature must be a number in °C.');
assert.equal(failure(Object.assign({}, base, { target: '0' })), 'Target dough temperature must be between 1 and 45 °C.');
assert.equal(failure(Object.assign({}, base, { target: '46' })), 'Target dough temperature must be between 1 and 45 °C.');
assert.equal(failure(Object.assign({}, base, { factors: '' })), 'Choose 3 or 4 temperatures to average.');
assert.equal(failure(Object.assign({}, base, { factors: '2' })), 'Choose 3 or 4 temperatures to average.');
assert.equal(failure(Object.assign({}, base, { factors: '4', preferment: '' })), 'Enter the preferment temperature in °C.');
assert.equal(failure(Object.assign({}, base, { flour: '' })), 'Enter the flour temperature in °C.');
assert.equal(failure(Object.assign({}, base, { flour: '51' })), 'Flour temperature must be between -20 and 50 °C.');
assert.equal(failure(Object.assign({}, base, { room: '-21' })), 'Room temperature must be between -20 and 50 °C.');
assert.equal(failure(Object.assign({}, base, { factors: '4', preferment: '51' })),
  'Preferment temperature must be between -20 and 50 °C.');
assert.equal(failure(Object.assign({}, base, { friction: '' })), 'Enter the friction rise in °C.');
assert.equal(failure(Object.assign({}, base, { friction: '-1' })), 'Friction rise must be between 0 and 30 °C.');
// Target is checked first, then the factor count, then flour, room, preferment and friction.
assert.equal(failure({ target: '', factors: '', flour: '', room: '', friction: '' }),
  'Enter the target dough temperature in °C.');
assert.equal(failure({ target: '24', factors: '', flour: '', room: '', friction: '' }),
  'Choose 3 or 4 temperatures to average.');
assert.equal(failure({ target: '24', factors: '3', flour: '', room: '', friction: '' }),
  'Enter the flour temperature in °C.');

// Decimal commas are accepted like the rest of the catalog.
const comma = run({ target: '24,5', factors: '3', flour: '19,5', room: '20,5', friction: '4,5' });
closeTo(comma.water, 73.5 - 44.5, 'decimal comma water');
closeTo(comma.target, 24.5, 'decimal comma target');

// Round trip: the reported water rebuilds the target through the average.
for (const target of [1, 8.5, 18, 24, 31.5, 45]) {
  const result = run(Object.assign({}, base, { target: String(target) }));
  closeTo((result.other + result.water) / result.factors, target, 'target round trip at ' + target);
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 10, 'expected at least ten catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'number') closeTo(result[key], value, testCase.name + ' ' + key);
      else assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page must not build raw HTML');
assert.ok(html.includes('<form id="dough-temp-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('aria-describedby="friction-help"'), 'friction field must reference its help text');
assert.ok(html.includes('id="reset"'), 'reset control missing');
assert.ok(html.includes('<option value="3" selected>3</option>'), 'three-factor option is a bare count');
assert.ok(html.includes('<option value="4">4</option>'), 'four-factor option is a bare count');
assert.ok(html.includes('id="prefer-field" hidden'), 'preferment field must start hidden');

console.log('dough temperature calculator: ' + entry.testCases.length + ' catalog cases and invariants passed');
