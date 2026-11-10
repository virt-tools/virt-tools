/* Yeast conversion regression checks: published substitution anchors,
   independent fresh-equivalent arithmetic, boundaries and catalog replay. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'yeast-conversion-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* yeast-conversion-core:start */';
const endMarker = '/* yeast-conversion-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'yeast conversion core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = YeastConversionCore;', sandbox);
const C = sandbox.module.exports;

const GRAMS_PER_OUNCE = 28.349523125;
const GRAMS_PER_PACKET = 7;
const GRAMS_PER_TEASPOON = 7 / 2.25;
const FACTOR = { fresh: 1, active: 0.4, instant: 0.33 };
const UNIT_GRAMS = { grams: 1, ounces: GRAMS_PER_OUNCE, teaspoons: GRAMS_PER_TEASPOON, packets: GRAMS_PER_PACKET };
const closeTo = (actual, expected, label, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} vs ${expected}`);
const convert = (input) => C.convert({ ...C.DEFAULTS, ...(input || {}) });
const failure = (input) => {
  try { convert(input); } catch (error) { return error.message; }
  return null;
};

// Independent oracle from the published fresh-to-dry multipliers and packet
// convention. It does not reuse the page's conversion function or outputs.
function oracle(input) {
  const value = { ...C.DEFAULTS, ...(input || {}) };
  const inputGrams = Number(String(value.amount).replace(',', '.')) * UNIT_GRAMS[value.unit];
  const freshGrams = inputGrams / FACTOR[value.source];
  const activeDryGrams = freshGrams * 0.4;
  const instantGrams = freshGrams * 0.33;
  return {
    source: value.source,
    unit: value.unit,
    amount: Number(String(value.amount).replace(',', '.')),
    inputGrams,
    freshGrams,
    activeDryGrams,
    instantGrams,
    freshOunces: freshGrams / GRAMS_PER_OUNCE,
    activeDryOunces: activeDryGrams / GRAMS_PER_OUNCE,
    instantOunces: instantGrams / GRAMS_PER_OUNCE,
    activeDryTeaspoons: activeDryGrams / GRAMS_PER_TEASPOON,
    instantTeaspoons: instantGrams / GRAMS_PER_TEASPOON,
    activeDryPackets: activeDryGrams / GRAMS_PER_PACKET,
    instantPackets: instantGrams / GRAMS_PER_PACKET,
  };
}
function checkExpected(result, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') closeTo(result[key], value, `${label} ${key}`, 1e-8);
    else assert.equal(result[key], value, `${label} ${key}`);
  }
}

assert.equal(C.DEFAULTS.source, 'fresh');
assert.equal(C.DEFAULTS.amount, '10');
assert.equal(C.DEFAULTS.unit, 'grams');
assert.equal(C.GRAMS_PER_OUNCE, GRAMS_PER_OUNCE);
assert.equal(C.GRAMS_PER_PACKET, GRAMS_PER_PACKET);
closeTo(C.GRAMS_PER_TEASPOON, GRAMS_PER_TEASPOON, 'packet teaspoon convention');

// King Arthur Baking's professional reference: fresh × 0.4 = active dry and
// fresh × 0.33 = instant. Red Star: 7 g dry yeast = 2 1/4 tsp = one packet.
const publishedFresh = convert({});
checkExpected(publishedFresh, {
  freshGrams: 10, activeDryGrams: 4, instantGrams: 3.3,
  activeDryTeaspoons: 9 / 7, instantTeaspoons: 3.3 * 9 / 28,
  activeDryPackets: 4 / 7, instantPackets: 3.3 / 7,
}, 'published fresh conversion');
const publishedActive = convert({ source: 'active', amount: '4' });
closeTo(publishedActive.freshGrams, 10, 'active back to fresh');
closeTo(publishedActive.instantGrams, 3.3, 'active to instant through fresh');
const publishedInstant = convert({ source: 'instant', amount: '3.3' });
closeTo(publishedInstant.freshGrams, 10, 'instant back to fresh');
closeTo(publishedInstant.activeDryGrams, 4, 'instant to active through fresh');
const packet = convert({ source: 'active', amount: '1', unit: 'packets' });
closeTo(packet.activeDryGrams, 7, 'standard packet weight');
closeTo(packet.activeDryTeaspoons, 2.25, 'standard packet volume');
closeTo(packet.freshGrams, 17.5, 'packet fresh equivalent');
const teaspoons = convert({ source: 'instant', amount: '2.25', unit: 'teaspoons' });
closeTo(teaspoons.instantGrams, 7, '2.25 teaspoon weight');
closeTo(teaspoons.instantPackets, 1, '2.25 teaspoon packets');
const ounce = convert({ amount: '1', unit: 'ounces' });
closeTo(ounce.freshGrams, GRAMS_PER_OUNCE, 'fresh ounce weight');
closeTo(ounce.activeDryGrams, GRAMS_PER_OUNCE * 0.4, 'active from fresh ounce');
closeTo(ounce.instantGrams, GRAMS_PER_OUNCE * 0.33, 'instant from fresh ounce');

// Decimal commas, whitespace and leading zeroes are accepted.
closeTo(convert({ amount: ' 0010,0 ' }).activeDryGrams, 4, 'decimal comma');
assert.equal(convert({ amount: '0.1' }).freshGrams, 0.1, 'minimum grams');
assert.equal(convert({ amount: '1000' }).freshGrams, 1000, 'maximum grams');
assert.equal(convert({ amount: '0.01', unit: 'ounces' }).unit, 'ounces', 'minimum ounces');
assert.equal(convert({ amount: '35', unit: 'ounces' }).unit, 'ounces', 'maximum ounces');
assert.equal(convert({ source: 'active', amount: '0.1', unit: 'teaspoons' }).unit, 'teaspoons');
assert.equal(convert({ source: 'active', amount: '300', unit: 'teaspoons' }).unit, 'teaspoons');
assert.equal(convert({ source: 'instant', amount: '0.1', unit: 'packets' }).unit, 'packets');
assert.equal(convert({ source: 'instant', amount: '100', unit: 'packets' }).unit, 'packets');

// Every valid combination round-trips through its fresh equivalent and agrees
// with the independently recomputed source values.
let rows = 0;
for (const source of Object.keys(FACTOR)) {
  for (const unit of Object.keys(UNIT_GRAMS)) {
    if (source === 'fresh' && (unit === 'teaspoons' || unit === 'packets')) continue;
    for (const amount of ['0.5', '1', '2.25', '7', '10', '33.3333']) {
      const input = { source, unit, amount };
      const result = convert(input);
      const expected = oracle(input);
      checkExpected(result, expected, JSON.stringify(input));
      closeTo(result.freshGrams * FACTOR[source], result.inputGrams, 'source identity');
      closeTo(result.activeDryGrams / 0.4, result.freshGrams, 'active identity');
      closeTo(result.instantGrams / 0.33, result.freshGrams, 'instant identity');
      const back = convert({ source, unit: 'grams', amount: result.inputGrams.toFixed(4) });
      closeTo(back.freshGrams, result.freshGrams, 'gram round trip', 0.002);
      rows += 1;
    }
  }
}
assert.equal(rows, 60);

// Input refusals, including fresh yeast's weight-only restriction.
assert.equal(failure({ amount: '' }), 'Amount is required.');
assert.equal(failure({ amount: '.5' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ amount: '-1' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ amount: '1e1' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ amount: '1.00001' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ amount: '0.09' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ amount: '1000.1' }), 'Amount must be a number from 0.1 to 1000 grams.');
assert.equal(failure({ source: 'cake' }), 'Choose fresh, active dry or instant yeast.');
assert.equal(failure({ unit: 'ml' }), 'Choose grams, ounces, teaspoons or standard packets.');
assert.equal(failure({ unit: 'teaspoons' }), 'Fresh yeast is converted by weight; choose grams or ounces.');
assert.equal(failure({ unit: 'packets' }), 'Fresh yeast is converted by weight; choose grams or ounces.');
assert.equal(failure({ unit: 'ounces', amount: '0.001' }), 'Amount must be a number from 0.01 to 35 ounces.');
assert.equal(failure({ source: 'active', unit: 'teaspoons', amount: '301' }), 'Amount must be a number from 0.1 to 300 teaspoons.');
assert.equal(failure({ source: 'instant', unit: 'packets', amount: '101' }), 'Amount must be a number from 0.1 to 100 standard packets.');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Yeast Conversion Calculator');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 2);
assert.ok(entry.method.includes('0.4') && entry.method.includes('0.33'));
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 7, boundary: 6, validation: 10 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = convert(testCase.input);
    checkExpected(result, testCase.expected, testCase.name);
    checkExpected(oracle(testCase.input), testCase.expected, `${testCase.name} independent oracle`);
  }
}

// Static offline, accessibility and DOM-wiring contract.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('<form id="yeast-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="alert"'), 'error alert missing');
for (const id of ['source', 'amount', 'unit']) {
  assert.ok(html.includes(`id="in-${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="in-${id}"`), `label ${id} missing`);
  assert.ok(html.includes(`aria-describedby="${id}-help"`), `help reference ${id} missing`);
  assert.ok(html.includes(`id="${id}-help"`), `help text ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('@media (max-width:400px)'), 'mobile result rows must stack');

console.log(`Yeast conversion: ${entry.testCases.length} catalog cases, ${rows} independent grid rows and published anchors passed`);
