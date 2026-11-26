/* Regression checks for the RJ45 pinout checker core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rj45-pinout-checker';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* rj45-core:start */');
const end = html.indexOf('/* rj45-core:end */');
assert.ok(start > -1 && end > start, 'rj45 core markers missing');
const core = html.slice(start, end + '/* rj45-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Rj45Core;', sandbox);
const C = sandbox.module.exports;

// ---- Independent expectations, read straight off the TIA-568 pin/pair table.
// Pin 1..8 wire order per standard; the wire names are the standard's own colours.
const WIRE_NAMES = {
  wb: 'White/blue', b: 'Blue', wo: 'White/orange', o: 'Orange',
  wg: 'White/green', g: 'Green', wbr: 'White/brown', br: 'Brown'
};
const WIRE_PAIRS = { wb: 1, b: 1, wo: 2, o: 2, wg: 3, g: 3, wbr: 4, br: 4 };
const EXPECTED_ORDER = {
  T568A: ['wg', 'g', 'wo', 'b', 'wb', 'o', 'wbr', 'br'],
  T568B: ['wo', 'o', 'wg', 'b', 'wb', 'g', 'wbr', 'br']
};
// Pair -> pins, per standard. Both standards group the same pins; only pairs 2 and 3 move.
const EXPECTED_PAIR_PINS = {
  T568A: { 1: [4, 5], 2: [3, 6], 3: [1, 2], 4: [7, 8] },
  T568B: { 1: [4, 5], 2: [1, 2], 3: [3, 6], 4: [7, 8] }
};

// ---- Wire table itself.
assert.deepEqual(Object.keys(C.WIRES).sort(), Object.keys(WIRE_NAMES).sort(), 'wire ids');
for (const [id, name] of Object.entries(WIRE_NAMES)) {
  const wire = C.WIRES[id];
  assert.equal(wire.id, id, `${id}: wire id`);
  assert.equal(wire.name, name, `${id}: wire name`);
  assert.equal(wire.pair, WIRE_PAIRS[id], `${id}: wire pair`);
  assert.match(wire.hex, /^#[0-9a-f]{6}$/, `${id}: swatch colour`);
  assert.equal(C.PAIR_NAMES[wire.pair], ['Blue', 'Orange', 'Green', 'Brown'][wire.pair - 1], `${id}: pair name`);
}
assert.equal(Object.keys(C.PAIR_NAMES).length, 4, 'four pairs');
assert.deepEqual(Object.keys(C.PINOUTS).sort(), ['T568A', 'T568B'], 'two standards');

// ---- Pin order and pair placement follow ANSI/TIA-568.
for (const standard of ['T568A', 'T568B']) {
  const rows = C.pinout(standard);
  assert.equal(rows.length, 8, `${standard}: eight pins`);
  rows.forEach((row, index) => {
    assert.equal(row.pin, index + 1, `${standard}: pin ${index + 1}`);
    assert.equal(row.id, EXPECTED_ORDER[standard][index], `${standard} pin ${index + 1}: wire`);
    assert.equal(row.name, WIRE_NAMES[EXPECTED_ORDER[standard][index]], `${standard} pin ${index + 1}: colour name`);
  });
  for (const pair of [1, 2, 3, 4]) {
    const pins = rows.filter((row) => row.pair === pair).map((row) => row.pin);
    assert.deepEqual(Array.from(pins), EXPECTED_PAIR_PINS[standard][pair], `${standard}: pair ${pair} pins`);
  }
  const ids = rows.map((row) => row.id);
  assert.equal(new Set(ids).size, 8, `${standard}: every wire used once`);
}

// ---- Straight-through: same standard both ends, every pin and pair continuous.
for (const standard of ['T568A', 'T568B']) {
  const result = C.check({ left: standard, right: standard });
  assert.equal(result.left, standard, `${standard}: left echoed`);
  assert.equal(result.right, standard, `${standard}: right echoed`);
  assert.equal(result.kind, 'straight', `${standard}: straight-through`);
  assert.equal(result.movedPairs.join(','), '', `${standard}: nothing moves`);
  for (const pair of result.pairs) assert.equal(pair.continuous, true, `${standard}: pair ${pair.number} continuous`);
  for (const row of result.pins) {
    assert.equal(row.left.id, row.right.id, `${standard} pin ${row.pin}: same wire`);
    assert.equal(row.samePair, true, `${standard} pin ${row.pin}: same pair`);
  }
}

// ---- Crossover: pairs 2 and 3 swap, pairs 1 and 4 keep their pins.
for (const [left, right] of [['T568A', 'T568B'], ['T568B', 'T568A']]) {
  const result = C.check({ left, right });
  assert.equal(result.kind, 'crossover', `${left}/${right}: crossover`);
  assert.equal(result.movedPairs.join(','), '2,3', `${left}/${right}: pairs 2 and 3 move`);
  const byNumber = new Map(result.pairs.map((pair) => [pair.number, pair]));
  assert.equal(byNumber.get(1).continuous, true, `${left}/${right}: pair 1 stays`);
  assert.equal(byNumber.get(4).continuous, true, `${left}/${right}: pair 4 stays`);
  const pairPins = (standard, pair) => (pair === 1 ? [4, 5] : pair === 4 ? [7, 8] : pair === 2 ? (standard === 'T568B' ? [1, 2] : [3, 6]) : (standard === 'T568B' ? [3, 6] : [1, 2]));
  assert.deepEqual(Array.from(byNumber.get(2).leftPins), pairPins(left, 2), `${left}/${right}: pair 2 left pins`);
  assert.deepEqual(Array.from(byNumber.get(2).rightPins), pairPins(right, 2), `${left}/${right}: pair 2 right pins`);
  assert.equal(byNumber.get(2).counterpart, 3, `${left}/${right}: pair 2 meets pair 3`);
  assert.deepEqual(Array.from(byNumber.get(3).leftPins), pairPins(left, 3), `${left}/${right}: pair 3 left pins`);
  assert.deepEqual(Array.from(byNumber.get(3).rightPins), pairPins(right, 3), `${left}/${right}: pair 3 right pins`);
  assert.equal(byNumber.get(3).counterpart, 2, `${left}/${right}: pair 3 meets pair 2`);
  // Pins 1-2 and 3-6 carry a different pair at each end; pins 4-5 and 7-8 keep theirs.
  for (const index of [0, 1, 2, 5]) assert.equal(result.pins[index].samePair, false, `${left}/${right} pin ${index + 1}: pair changes`);
  for (const index of [3, 4, 6, 7]) assert.equal(result.pins[index].samePair, true, `${left}/${right} pin ${index + 1}: pair kept`);
  assert.equal(result.pins[0].left.name, left === 'T568A' ? 'White/green' : 'White/orange', `${left}/${right}: pin 1 left`);
  assert.equal(result.pins[0].right.name, right === 'T568A' ? 'White/green' : 'White/orange', `${left}/${right}: pin 1 right`);
}

// ---- Pin-by-pin mapping is the straight pin-to-pin join of the two orders.
for (const left of ['T568A', 'T568B']) {
  for (const right of ['T568A', 'T568B']) {
    const result = C.check({ left, right });
    for (const row of result.pins) {
      assert.equal(row.left.id, EXPECTED_ORDER[left][row.pin - 1], `${left}/${right} pin ${row.pin}: left wire`);
      assert.equal(row.right.id, EXPECTED_ORDER[right][row.pin - 1], `${left}/${right} pin ${row.pin}: right wire`);
    }
  }
}

// ---- Classification: only pairs 2 and 3 moving is a crossover; anything else is mixed.
const pairMap = (map) => Object.keys(map).sort().map((number) => ({
  number: Number(number), continuous: map[number]
}));
assert.equal(C.classify(pairMap({ 1: true, 2: true, 3: true, 4: true })), 'straight');
assert.equal(C.classify(pairMap({ 1: true, 2: false, 3: false, 4: true })), 'crossover');
assert.equal(C.classify(pairMap({ 1: false, 2: true, 3: false, 4: true })), 'mixed');
assert.equal(C.classify(pairMap({ 1: false, 2: false, 3: false, 4: false })), 'mixed');

// ---- Defaults, case tolerance and refusals.
const fallback = C.check({});
assert.equal(fallback.left, 'T568B');
assert.equal(fallback.right, 'T568B');
assert.equal(fallback.kind, 'straight');
assert.equal(C.check({ left: 'a' }).right, 'T568B', 'right defaults to T568B');
assert.equal(C.check({ left: 'a' }).kind, 'crossover', 'A to the default B is a crossover');
assert.equal(C.check({ left: 't568b', right: 'T568A' }).left, 'T568B', 'lowercase code');
assert.equal(C.check({ left: ' T568A ', right: 'T568A' }).kind, 'straight', 'surrounding space');

const bad = (input, message) => assert.throws(() => C.check(input), (error) => {
  assert.equal(error.message, message);
  return true;
});
bad({ left: '' }, 'Choose T568A or T568B for the left end.');
bad({ left: 'T568C' }, 'Choose T568A or T568B for the left end.');
bad({ left: 'cat6' }, 'Choose T568A or T568B for the left end.');
bad({ left: null }, 'Choose T568A or T568B for the left end.');
bad({ left: 'T568A', right: '' }, 'Choose T568A or T568B for the right end.');
bad({ left: 'T568A', right: 'RJ45' }, 'Choose T568A or T568B for the right end.');
bad({ left: 'T568A', right: 8 }, 'Choose T568A or T568B for the right end.');

// ---- The copyable summary names the standard, the verdict and the pin colours.
const straightText = C.copyText(C.check({ left: 'T568B', right: 'T568B' }));
assert.match(straightText, /^T568B to T568B: straight-through\. Pins 1-8 at both ends: white\/orange, orange, white\/green, blue, white\/blue, green, white\/brown, brown\.$/);
assert.match(C.copyText(C.check({ left: 'T568A', right: 'T568B' })), /crossover, with pairs 2 \(orange\) and 3 \(green\) swapped/);
assert.match(C.copyText(C.check({ left: 'T568A', right: 'T568B' })), /at the right end: white\/orange, orange, white\/green, blue, white\/blue, green, white\/brown, brown\./);
for (const left of ['T568A', 'T568B']) {
  for (const right of ['T568A', 'T568B']) {
    const text = C.copyText(C.check({ left, right }));
    assert.ok(!/undefined|NaN|null/.test(text), `${left}/${right}: clean summary`);
    assert.equal(text.indexOf(left + ' to ' + right), 0, `${left}/${right}: summary names both ends`);
  }
}

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'RJ45 Pinout Checker');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'sources present');
assert.ok(record.sources.some((source) => typeof source.url === 'string' && /^https?:\/\//.test(source.url)), 'a fetched source URL');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.ok(record.testCases.length >= 8, `expected at least 8 cases, found ${record.testCases.length}`);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2217, 'public tools');

for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.check(Object.assign({}, testCase.input)), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.check(Object.assign({}, testCase.input));
  assert.equal(result.left, testCase.expected.left, `${label}: left`);
  assert.equal(result.right, testCase.expected.right, `${label}: right`);
  assert.equal(result.kind, testCase.expected.kind, `${label}: kind`);
  assert.equal(result.movedPairs.join(','), testCase.expected.movedPairs, `${label}: moved pairs`);
}

// ---- Page contract: an input, an action, a live result, no network or storage.
assert.match(html, /<label class="f" for="in-left">/, 'left label');
assert.match(html, /<label class="f" for="in-right">/, 'right label');
assert.match(html, /<button type="submit">Check lead<\/button>/, 'submit button');
assert.match(html, /id="out" aria-live="polite"/, 'live result region');
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\/(?!en\.wikipedia)/.test(html), 'no third-party requests in the page');
