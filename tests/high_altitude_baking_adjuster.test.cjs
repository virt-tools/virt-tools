/* High-altitude baking adjustments: the published anchor chart, an independent
   interpolation model, range endpoints, refusals, catalog replay and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'high-altitude-baking-adjuster';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* high-altitude-baking-core:start */';
const endMarker = '/* high-altitude-baking-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HighAltitudeBakingCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
function failure(input) {
  try { C.adjust(input); } catch (error) { return error.message; }
  return null;
}
const base = (elevationFt, extra) => Object.assign({
  elevationFt, leavenerTsp: 2, sugarCups: 1, liquidCups: 1, flourCups: 2, ovenF: 350
}, extra || {});

// ---- Independent model. The anchor pairs below are transcribed from the
// published chart, separately from the page's own table, and every expected
// figure is derived from them by direct per-cup arithmetic.
const PUBLISHED = [
  { ft: 3000, leaven: [1 / 8, 1 / 8], liquid: [1, 2], sugar: [0, 1], flour: [0, 1], oven: [15, 25] },
  { ft: 5000, leaven: [1 / 8, 1 / 4], liquid: [2, 4], sugar: [0, 2], flour: [0, 2], oven: [15, 25] },
  { ft: 7000, leaven: [1 / 4, 1 / 4], liquid: [3, 4], sugar: [1, 3], flour: [2, 4], oven: [15, 25] }
];
function lerp(a, b, t) { return a + (b - a) * t; }
function modelRates(ft) {
  const keys = ['leaven', 'liquid', 'sugar', 'flour', 'oven'];
  const zero = {};
  keys.forEach((key) => { zero[key] = [0, 0]; });
  if (ft < 3000) return zero;
  if (ft >= 7000) return JSON.parse(JSON.stringify(PUBLISHED[2]));
  for (let index = 0; index < PUBLISHED.length - 1; index += 1) {
    const lower = PUBLISHED[index];
    const upper = PUBLISHED[index + 1];
    if (ft >= lower.ft && ft < upper.ft) {
      const t = (ft - lower.ft) / (upper.ft - lower.ft);
      const out = {};
      keys.forEach((key) => {
        out[key] = [lerp(lower[key][0], upper[key][0], t), lerp(lower[key][1], upper[key][1], t)];
      });
      return out;
    }
  }
  return JSON.parse(JSON.stringify(PUBLISHED[2]));
}
function model(input) {
  const rates = modelRates(input.elevationFt);
  const mid = (pair) => (pair[0] + pair[1]) / 2;
  const leaven = input.leavenerTsp;
  const sugar = input.sugarCups * 16;
  const liquid = input.liquidCups * 16;
  const flour = input.flourCups * 16;
  return {
    leavenOut: leaven - leaven * mid(rates.leaven),
    leavenLow: leaven - leaven * rates.leaven[1],
    leavenHigh: leaven - leaven * rates.leaven[0],
    sugarOut: sugar - input.sugarCups * mid(rates.sugar),
    sugarLow: sugar - input.sugarCups * rates.sugar[1],
    sugarHigh: sugar - input.sugarCups * rates.sugar[0],
    liquidOut: liquid + input.liquidCups * mid(rates.liquid),
    liquidLow: liquid + input.liquidCups * rates.liquid[0],
    liquidHigh: liquid + input.liquidCups * rates.liquid[1],
    flourOut: flour + input.flourCups * mid(rates.flour),
    flourLow: flour + input.flourCups * rates.flour[0],
    flourHigh: flour + input.flourCups * rates.flour[1],
    ovenOut: input.ovenF + mid(rates.oven),
    ovenLow: input.ovenF + rates.oven[0],
    ovenHigh: input.ovenF + rates.oven[1]
  };
}
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, label + ': ' + actual + ' != ' + expected);

// ---- Exported contract.
assert.equal(C.CHART_FT, 3000);
assert.equal(C.CAP_FT, 7000);
assert.deepEqual(plain(C.DEFAULT_INPUT),
  { elevationFt: 5000, leavenerTsp: 2, sugarCups: 1, liquidCups: 1, flourCups: 2, ovenF: 350 });
assert.equal(C.ANCHORS.length, 3);
assert.deepEqual(plain(C.ANCHORS.map((entry) => entry.ft)), [3000, 5000, 7000]);

// ---- Hand-worked reference recipes straight from the published bands.
const REFERENCES = [
  {
    name: 'default 5,000 ft cake',
    input: base(5000),
    mode: 'anchor',
    perCup: { leavenTsp: 0.1875, liquidTbsp: 3, sugarTbsp: 1, flourTbsp: 1, ovenF: 20 },
    leaven: { in: 2, out: 1.625, min: 1.5, max: 1.75 },
    sugar: { out: 15, min: 14, max: 16 },
    liquid: { out: 19, min: 18, max: 20 },
    flour: { out: 34, min: 32, max: 36 },
    oven: { out: 370, min: 365, max: 375 }
  },
  {
    name: '3,000 ft, one teaspoon of leavening',
    input: base(3000, { leavenerTsp: 1, sugarCups: 1, liquidCups: 1, flourCups: 1, ovenF: 375 }),
    mode: 'anchor',
    perCup: { leavenTsp: 0.125, liquidTbsp: 1.5, sugarTbsp: 0.5, flourTbsp: 0.5, ovenF: 20 },
    leaven: { in: 1, out: 0.875, min: 0.875, max: 0.875 },
    sugar: { out: 15.5, min: 15, max: 16 },
    liquid: { out: 17.5, min: 17, max: 18 },
    flour: { out: 16.5, min: 16, max: 17 },
    oven: { out: 395, min: 390, max: 400 }
  },
  {
    name: '7,000 ft, a double batch',
    input: base(7000, { leavenerTsp: 4, sugarCups: 2, liquidCups: 2, flourCups: 3, ovenF: 400 }),
    mode: 'anchor',
    perCup: { leavenTsp: 0.25, liquidTbsp: 3.5, sugarTbsp: 2, flourTbsp: 3, ovenF: 20 },
    leaven: { in: 4, out: 3, min: 3, max: 3 },
    sugar: { out: 28, min: 26, max: 30 },
    liquid: { out: 39, min: 38, max: 40 },
    flour: { out: 57, min: 54, max: 60 },
    oven: { out: 420, min: 415, max: 425 }
  },
  {
    name: '4,000 ft, halfway between the first two bands',
    input: base(4000),
    mode: 'interp',
    perCup: { leavenTsp: 0.15625, liquidTbsp: 2.25, sugarTbsp: 0.75, flourTbsp: 0.75, ovenF: 20 },
    leaven: { in: 2, out: 1.6875, min: 1.625, max: 1.75 },
    sugar: { out: 15.25, min: 14.5, max: 16 },
    liquid: { out: 18.25, min: 17.5, max: 19 },
    flour: { out: 33.5, min: 32, max: 35 },
    oven: { out: 370, min: 365, max: 375 }
  },
  {
    name: '9,000 ft holds the 7,000 ft band',
    input: base(9000, { leavenerTsp: 1, sugarCups: 0, liquidCups: 1.5, flourCups: 3, ovenF: 425 }),
    mode: 'cap',
    perCup: { leavenTsp: 0.25, liquidTbsp: 3.5, sugarTbsp: 2, flourTbsp: 3, ovenF: 20 },
    leaven: { in: 1, out: 0.75, min: 0.75, max: 0.75 },
    sugar: { out: 0, min: 0, max: 0 },
    liquid: { out: 29.25, min: 28.5, max: 30 },
    flour: { out: 57, min: 54, max: 60 },
    oven: { out: 445, min: 440, max: 450 }
  },
  {
    name: '6,000 ft between the second and third bands',
    input: base(6000, { leavenerTsp: 1.5, sugarCups: 0.5, liquidCups: 2, flourCups: 1, ovenF: 325 }),
    mode: 'interp',
    perCup: { leavenTsp: 0.21875, liquidTbsp: 3.25, sugarTbsp: 1.5, flourTbsp: 2, ovenF: 20 },
    leaven: { in: 1.5, out: 1.171875, min: 1.125, max: 1.21875 },
    sugar: { out: 7.25, min: 6.75, max: 7.75 },
    liquid: { out: 38.5, min: 37, max: 40 },
    flour: { out: 18, min: 17, max: 19 },
    oven: { out: 345, min: 340, max: 350 }
  },
  {
    name: '3,500 ft just above the chart floor',
    input: base(3500, { leavenerTsp: 2.5, sugarCups: 2, liquidCups: 1, flourCups: 1.5, ovenF: 375 }),
    mode: 'interp',
    perCup: { leavenTsp: 0.140625, liquidTbsp: 1.875, sugarTbsp: 0.625, flourTbsp: 0.625, ovenF: 20 },
    leaven: { in: 2.5, out: 2.1484375, min: 2.109375, max: 2.1875 },
    sugar: { out: 30.75, min: 29.5, max: 32 },
    liquid: { out: 17.875, min: 17.25, max: 18.5 },
    flour: { out: 24.9375, min: 24, max: 25.875 },
    oven: { out: 395, min: 390, max: 400 }
  },
  {
    name: '2,500 ft below the chart',
    input: base(2500),
    mode: 'none',
    perCup: { leavenTsp: 0, liquidTbsp: 0, sugarTbsp: 0, flourTbsp: 0, ovenF: 0 },
    leaven: { in: 2, out: 2, min: 2, max: 2 },
    sugar: { out: 16, min: 16, max: 16 },
    liquid: { out: 16, min: 16, max: 16 },
    flour: { out: 32, min: 32, max: 32 },
    oven: { out: 350, min: 350, max: 350 }
  }
];
for (const reference of REFERENCES) {
  const result = C.adjust(reference.input);
  const expected = model(reference.input);
  assert.equal(result.mode, reference.mode, reference.name + ' mode');
  for (const [key, value] of Object.entries(reference.perCup)) {
    assert.equal(result.perCup[key], value, reference.name + ' per cup ' + key);
  }
  assert.equal(result.leavener.inTsp, reference.leaven.in, reference.name + ' leavening in');
  close(result.leavener.outTsp, reference.leaven.out, reference.name + ' leavening out');
  close(result.leavener.minTsp, reference.leaven.min, reference.name + ' leavening min');
  close(result.leavener.maxTsp, reference.leaven.max, reference.name + ' leavening max');
  close(result.sugar.outTbsp, reference.sugar.out, reference.name + ' sugar out');
  close(result.sugar.minTbsp, reference.sugar.min, reference.name + ' sugar min');
  close(result.sugar.maxTbsp, reference.sugar.max, reference.name + ' sugar max');
  close(result.liquid.outTbsp, reference.liquid.out, reference.name + ' liquid out');
  close(result.liquid.minTbsp, reference.liquid.min, reference.name + ' liquid min');
  close(result.liquid.maxTbsp, reference.liquid.max, reference.name + ' liquid max');
  close(result.flour.outTbsp, reference.flour.out, reference.name + ' flour out');
  close(result.flour.minTbsp, reference.flour.min, reference.name + ' flour min');
  close(result.flour.maxTbsp, reference.flour.max, reference.name + ' flour max');
  close(result.oven.outF, reference.oven.out, reference.name + ' oven out');
  close(result.oven.minF, reference.oven.min, reference.name + ' oven min');
  close(result.oven.maxF, reference.oven.max, reference.name + ' oven max');

  close(result.leavener.outTsp, expected.leavenOut, reference.name + ' model leavening');
  close(result.sugar.outTbsp, expected.sugarOut, reference.name + ' model sugar');
  close(result.liquid.outTbsp, expected.liquidOut, reference.name + ' model liquid');
  close(result.flour.outTbsp, expected.flourOut, reference.name + ' model flour');
  close(result.oven.outF, expected.ovenOut, reference.name + ' model oven');
  close(result.leavener.minTsp, expected.leavenLow, reference.name + ' model leavening low');
  close(result.leavener.maxTsp, expected.leavenHigh, reference.name + ' model leavening high');
  close(result.sugar.minTbsp, expected.sugarLow, reference.name + ' model sugar low');
  close(result.sugar.maxTbsp, expected.sugarHigh, reference.name + ' model sugar high');
  close(result.liquid.minTbsp, expected.liquidLow, reference.name + ' model liquid low');
  close(result.liquid.maxTbsp, expected.liquidHigh, reference.name + ' model liquid high');
  close(result.flour.minTbsp, expected.flourLow, reference.name + ' model flour low');
  close(result.flour.maxTbsp, expected.flourHigh, reference.name + ' model flour high');
  close(result.oven.minF, expected.ovenLow, reference.name + ' model oven low');
  close(result.oven.maxF, expected.ovenHigh, reference.name + ' model oven high');

  // The published range must bracket the midpoint figure.
  assert.ok(result.leavener.minTsp <= result.leavener.outTsp + 1e-9);
  assert.ok(result.leavener.outTsp <= result.leavener.maxTsp + 1e-9);
  assert.ok(result.sugar.minTbsp <= result.sugar.outTbsp + 1e-9);
  assert.ok(result.sugar.outTbsp <= result.sugar.maxTbsp + 1e-9);
  assert.ok(result.liquid.minTbsp <= result.liquid.outTbsp + 1e-9);
  assert.ok(result.liquid.outTbsp <= result.liquid.maxTbsp + 1e-9);
  assert.ok(result.flour.minTbsp <= result.flour.outTbsp + 1e-9);
  assert.ok(result.flour.outTbsp <= result.flour.maxTbsp + 1e-9);
  assert.ok(result.oven.minF <= result.oven.outF + 1e-9);
  assert.ok(result.oven.outF <= result.oven.maxF + 1e-9);
}

// ---- The 3,000 ft band is where the chart starts: one foot lower changes nothing.
const below = C.adjust(base(2999));
const atFloor = C.adjust(base(3000));
assert.equal(below.mode, 'none');
assert.equal(below.leavener.outTsp, below.leavener.inTsp);
assert.equal(below.oven.outF, below.oven.inF);
assert.equal(atFloor.mode, 'anchor');
assert.equal(atFloor.leavener.outTsp, 1.75);
assert.equal(atFloor.perCup.liquidTbsp, 1.5);
const atCap = C.adjust(base(7000));
const above = C.adjust(base(7001));
const farAbove = C.adjust(base(20000));
assert.equal(atCap.mode, 'anchor');
assert.equal(above.mode, 'cap');
assert.deepEqual(plain(above.perCup), plain(atCap.perCup));
assert.deepEqual(plain(farAbove.perCup), plain(atCap.perCup));

// ---- Random sweep against the independent model, including off-chart elevations.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const random = prng(20261120);
let sweep = 0;
for (let trial = 0; trial < 400; trial += 1) {
  const input = {
    elevationFt: Math.round(random() * 200000) / 10,
    leavenerTsp: Math.round(random() * 800) / 100,
    sugarCups: Math.round(random() * 800) / 100,
    liquidCups: Math.round(random() * 1600) / 100,
    flourCups: Math.round(random() * 1600) / 100,
    ovenF: 150 + Math.round(random() * 4000) / 10
  };
  const result = C.adjust(input);
  const expected = model(input);
  close(result.leavener.outTsp, expected.leavenOut, 'sweep leavening');
  close(result.sugar.outTbsp, expected.sugarOut, 'sweep sugar');
  close(result.liquid.outTbsp, expected.liquidOut, 'sweep liquid');
  close(result.flour.outTbsp, expected.flourOut, 'sweep flour');
  close(result.oven.outF, expected.ovenOut, 'sweep oven');
  close(result.leavener.minTsp, expected.leavenLow, 'sweep leavening low');
  close(result.leavener.maxTsp, expected.leavenHigh, 'sweep leavening high');
  close(result.sugar.minTbsp, expected.sugarLow, 'sweep sugar low');
  close(result.sugar.maxTbsp, expected.sugarHigh, 'sweep sugar high');
  close(result.liquid.minTbsp, expected.liquidLow, 'sweep liquid low');
  close(result.liquid.maxTbsp, expected.liquidHigh, 'sweep liquid high');
  close(result.flour.minTbsp, expected.flourLow, 'sweep flour low');
  close(result.flour.maxTbsp, expected.flourHigh, 'sweep flour high');
  close(result.oven.minF, expected.ovenLow, 'sweep oven low');
  close(result.oven.maxF, expected.ovenHigh, 'sweep oven high');
  for (const section of [result.leavener, result.sugar, result.liquid, result.flour, result.oven]) {
    Object.values(section).forEach((value) => {
      assert.ok(Number.isFinite(value), 'every figure is finite');
      assert.ok(value >= 0, 'every figure is non-negative');
    });
  }
  if (input.elevationFt < 3000) {
    assert.equal(result.leavener.outTsp, input.leavenerTsp);
    assert.equal(result.oven.outF, input.ovenF);
  } else {
    assert.ok(result.leavener.outTsp <= input.leavenerTsp + 1e-9, 'leavening never rises');
    assert.ok(result.sugar.outTbsp <= input.sugarCups * 16 + 1e-9, 'sugar never rises');
    assert.ok(result.liquid.outTbsp >= input.liquidCups * 16 - 1e-9, 'liquid never falls');
    assert.ok(result.flour.outTbsp >= input.flourCups * 16 - 1e-9, 'flour never falls');
    assert.ok(result.oven.outF >= input.ovenF - 1e-9, 'oven never cools');
  }
  sweep += 1;
}

// ---- Refusals: every message is the page's own wording.
assert.equal(failure(base(0, { elevationFt: -1 })),
  'Enter an elevation from 0 to 20,000 ft (0 to 6,096 m).');
assert.equal(failure(base(0, { elevationFt: 20001 })),
  'Enter an elevation from 0 to 20,000 ft (0 to 6,096 m).');
assert.equal(failure(base(0, { elevationFt: 'high' })),
  'Enter the elevation as a number of feet, such as 5000.');
assert.equal(failure(base(0, { elevationFt: '' })), 'Enter the elevation.');
assert.equal(failure(base(5000, { leavenerTsp: -0.5 })), 'Enter the leavening amount from 0 to 8 tsp.');
assert.equal(failure(base(5000, { sugarCups: 9 })), 'Enter the sugar from 0 to 8 cups.');
assert.equal(failure(base(5000, { liquidCups: 'one' })),
  'Enter the liquid as a number of cups, such as 1.');
assert.equal(failure(base(5000, { flourCups: 20 })), 'Enter the flour from 0 to 16 cups.');
assert.equal(failure(base(5000, { ovenF: 100 })),
  'Enter an oven temperature from 150 to 550 \u00b0F (65 to 288 \u00b0C).');
assert.equal(failure(base(5000, { ovenF: '' })), 'Enter the oven temperature.');
assert.equal(failure(base(5000, { sugarCups: '' })), 'Enter the sugar; use 0 when the recipe has none.');
assert.equal(failure(base(5000, { leavenerTsp: '2,5' })),
  'Enter the leavening amount as a number of teaspoons, such as 2.');
assert.equal(failure(base(NaN)), 'Enter the elevation as a number of feet, such as 5000.');
assert.equal(C.adjust(base(5000, { elevationFt: ' 5000 ' })).elevationFt, 5000, 'surrounding spaces are accepted');
assert.equal(C.adjust(base(5000, { sugarCups: 0 })).sugar.outTbsp, 0, 'a sugar-free recipe stays at zero');
assert.equal(C.adjust(base(5000, { leavenerTsp: 0 })).leavener.outTsp, 0, 'a leavening-free recipe stays at zero');

// ---- Catalog record and its cases must agree with the page core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2475, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2214, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Food').length, 55, 'Food count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'High-Altitude Baking Adjuster');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('3,000'), 'method names the chart floor');
assert.ok(record.method.includes('7,000'), 'method names the chart ceiling');
assert.ok(Array.isArray(record.sources) && record.sources.length === 2, 'two published sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'sources use https');
}

function subset(actual, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      assert.ok(actual[key] !== undefined, label + ' missing ' + key);
      subset(actual[key], value, label + ' ' + key);
    } else {
      assert.equal(actual[key], value, label + ' ' + key);
    }
  }
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 7, 'seven validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  subset(plain(C.adjust(testCase.input)), testCase.expected, testCase.name);
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['altitude', 'baking', 'leavening', 'oven-temperature']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [
  ...[...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
  ...[...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1])
];
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of new Set(requestedIds)) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['elevation', 'oven', 'leaven', 'sugar', 'liquid', 'flour']) {
  assert.ok(new RegExp('<label for="' + id + '">').test(html), 'visible label for ' + id);
  assert.ok(new RegExp('<input id="' + id + '" type="number"').test(html), 'numeric input for ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'the confirmation is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/id="elevation-unit"/.test(html) && /id="oven-unit"/.test(html), 'unit pickers exist');
assert.equal((html.match(/<select /g) || []).length, 2, 'two unit pickers');
assert.equal((html.match(/<input /g) || []).length, 6, 'six numeric inputs');
assert.ok(/novalidate/.test(html), 'the page owns its validation');
assert.ok(/1 cup = 16 tbsp/.test(html), 'the cup convention is stated');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('high-altitude baking adjuster: 8 reference recipes, ' + sweep
  + ' model sweeps, 19 catalog cases and the page contract pass');
