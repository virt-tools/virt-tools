/* Regression checks for the MPO polarity mapper core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/mpo-polarity-mapper/index.html'), 'utf8');
const start = html.indexOf('/* mpo-core:start */');
const end = html.indexOf('/* mpo-core:end */');
assert.ok(start > -1 && end > start, 'mpo core markers missing');
const core = html.slice(start, end + '/* mpo-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MpoCore;', sandbox);
const C = sandbox.module.exports;

const same = (actual, expected, message) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'mpo-polarity-mapper');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2493, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2232, 'public tools');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

// The page describes one 12-position row, six duplex pairs and four parallel lanes.
assert.equal(C.POSITIONS, 12);
assert.equal(C.PAIR_COUNT, 6);
assert.equal(C.LANE_COUNT, 4);
same(Object.keys(C.METHODS), ['A', 'B', 'C'], 'method keys');
for (const key of ['A', 'B', 'C']) {
  const method = C.METHODS[key];
  assert.equal(method.label, `Method ${key}`);
  for (const field of ['trunk', 'keys', 'adapter', 'channel']) {
    assert.ok(typeof method[field] === 'string' && method[field].length > 8, `${key}: ${field}`);
  }
}
assert.match(C.METHODS.A.trunk, /straight-through/);
assert.match(C.METHODS.B.trunk, /reversed/);
assert.match(C.METHODS.C.trunk, /pair-crossed/);
assert.match(C.METHODS.A.keys, /key-up at one end, key-down at the other/);
assert.match(C.METHODS.B.keys, /key-up at both ends/);
assert.match(C.METHODS.C.keys, /key-up at one end, key-down at the other/);
assert.match(C.METHODS.A.adapter, /Type A adapter/);
assert.match(C.METHODS.B.adapter, /Type B adapter/);
assert.match(C.METHODS.C.adapter, /Type A adapter/);

// The published position tables: straight, reversed, and adjacent pairs crossed.
same(C.positionMap('A'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 'Method A table');
same(C.positionMap('B'), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'Method B table');
same(C.positionMap('C'), [2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11], 'Method C table');

// Every method is an involution: a return path through a second identical trunk restores the row.
for (const key of ['A', 'B', 'C']) {
  const table = C.positionMap(key);
  assert.equal(table.length, C.POSITIONS, `${key}: table length`);
  same([...table].sort((a, b) => a - b), [...Array(12)].map((_, i) => i + 1), `${key}: permutation`);
  for (let position = 1; position <= C.POSITIONS; position++) {
    assert.equal(table[table[position - 1] - 1], position, `${key}: involution at ${position}`);
  }
}

// Replay every catalog case: refusals by exact message, results by the documented fields.
const keys = ['method', 'methodLabel', 'trunkLabel', 'keyEnds', 'adapterLabel', 'mode', 'index',
  'nearFibers', 'farFibers', 'farPair', 'withinPairFlip', 'laneReceive', 'verdict', 'verdictText'];
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.map(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.map(Object.assign({}, testCase.input));
  for (const key of keys) {
    if (!(key in testCase.expected)) continue;
    assert.deepEqual(JSON.parse(JSON.stringify(result[key])), testCase.expected[key], `${label}: ${key}`);
  }
  if (testCase.expected.map) same(result.map, testCase.expected.map, `${label}: map`);
  assert.ok(!JSON.stringify(result).includes('undefined'), `${label}: missing value`);
}

// Method A leaves every duplex pair in place with its fibres in order.
for (let pair = 1; pair <= C.PAIR_COUNT; pair++) {
  const result = C.map({ method: 'A', mode: 'duplex', index: pair });
  assert.equal(result.farPair, pair, `A pair ${pair}: position kept`);
  same(result.farFibers, [pair * 2 - 1, pair * 2], `A pair ${pair}: order kept`);
  assert.equal(result.withinPairFlip, false, `A pair ${pair}: no flip`);
  assert.equal(result.verdict, 'needs-flip', `A pair ${pair}: verdict`);
}

// Method B mirrors the pair number and swaps the two fibres, so the six pairs stay a bijection.
const landed = new Set();
for (let pair = 1; pair <= C.PAIR_COUNT; pair++) {
  const result = C.map({ method: 'B', mode: 'duplex', index: pair });
  assert.equal(result.farPair, C.PAIR_COUNT + 1 - pair, `B pair ${pair}: mirrored pair`);
  same(result.farFibers, [13 - (pair * 2 - 1), 13 - pair * 2], `B pair ${pair}: fibres`);
  assert.equal(result.withinPairFlip, true, `B pair ${pair}: flipped`);
  assert.equal(result.verdict, 'trunk-flips', `B pair ${pair}: verdict`);
  assert.equal(result.farFibers[0], 2 * result.farPair, `B pair ${pair}: transmit lands on receive`);
  landed.add(result.farPair);
}
assert.equal(landed.size, C.PAIR_COUNT, 'B pairs cover every far pair once');

// Method C keeps every pair in place and swaps only the fibres inside it.
for (let pair = 1; pair <= C.PAIR_COUNT; pair++) {
  const result = C.map({ method: 'C', mode: 'duplex', index: pair });
  assert.equal(result.farPair, pair, `C pair ${pair}: position kept`);
  same(result.farFibers, [pair * 2, pair * 2 - 1], `C pair ${pair}: fibres swapped`);
  assert.equal(result.withinPairFlip, true, `C pair ${pair}: flipped`);
}

// Parallel optics: only the reversed row brings a transmitter to a receiver.
for (let lane = 1; lane <= C.LANE_COUNT; lane++) {
  assert.equal(C.map({ method: 'A', mode: 'parallel', index: lane }).laneReceive, false, `A lane ${lane}`);
  assert.equal(C.map({ method: 'B', mode: 'parallel', index: lane }).laneReceive, true, `B lane ${lane}`);
  assert.equal(C.map({ method: 'C', mode: 'parallel', index: lane }).laneReceive, false, `C lane ${lane}`);
  const reversed = C.map({ method: 'B', mode: 'parallel', index: lane });
  assert.equal(reversed.farFibers[0], 13 - lane, `B lane ${lane}: far fibre`);
  assert.ok(reversed.farFibers[0] >= 9 && reversed.farFibers[0] <= 12, `B lane ${lane}: receive side`);
}

// The table's "use" column follows the application and the position.
assert.equal(C.useOf('duplex', 1), 'Tx · pair 1');
assert.equal(C.useOf('duplex', 6), 'Rx · pair 3');
assert.equal(C.useOf('parallel', 1), 'Tx lane 1');
assert.equal(C.useOf('parallel', 4), 'Tx lane 4');
assert.equal(C.useOf('parallel', 5), 'unused');
assert.equal(C.useOf('parallel', 8), 'unused');
assert.equal(C.useOf('parallel', 9), 'Rx lane 1');
assert.equal(C.useOf('parallel', 12), 'Rx lane 4');

// Defaults match the documented Method B example, and trimming keeps quoted numbers working.
same(C.map({}), C.map({ method: 'B', mode: 'duplex', index: 1 }), 'documented defaults');
assert.equal(C.map({ mode: 'parallel', index: 2 }).method, 'B');
same(C.map({ index: '02' }), C.map({ index: 2 }), 'leading zero');

// The copyable mapping names the pair, both fibre orders, the trunk and the adapter.
const duplex = C.copyText(C.map({ method: 'B', mode: 'duplex', index: 1 }));
assert.match(duplex, /^MPO-12 Method B, duplex pair 1 \(fibres 1 and 2\) arrives as pair 6 \(fibres 12 and 11\)\./);
assert.match(duplex, /Type B reversed trunk, key-up at both ends\./);
assert.match(duplex, /Adapter: Type B adapter \(mates key-up to key-up\)\./);
const parallel = C.copyText(C.map({ method: 'C', mode: 'parallel', index: 2 }));
assert.match(parallel, /^MPO-12 Method C, transmit lane 2 \(fibre 2\) arrives at fibre 1\./);
assert.ok(!duplex.includes('undefined') && !parallel.includes('undefined'));

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) {
  assert.ok(!alias.toLowerCase().includes('trunk calculator'), `alias overreaches: ${alias}`);
}
assert.ok(entry.tags.includes('mpo') && entry.tags.includes('polarity'));
assert.equal(entry.category, 'IT & Networking');
assert.equal(catalog.tools.filter((tool) => tool.category === 'IT & Networking').length, 56, 'IT & Networking count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.filter((source) => source.url).every((source) => source.url.startsWith('https://')));

// Page contract: the shared shell, one labelled form, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /href="\/assets\/tool-css\/tool-form-[0-9a-f]+\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/(?:https?:)?\/\/(?!www\.w3\.org)/.test(html.replace(/https?:\/\/[^\s"'<>]+/g, (url) => url)), 'page markup is offline');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
for (const id of ['in-method', 'in-mode', 'in-index']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['err', 'out', 'map-body']) assert.ok(html.includes(`id="${id}"`), `container ${id}`);
assert.equal((html.match(/<button\b/g) || []).length, 2);
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);

console.log(`mpo polarity mapper: ${entry.testCases.length} catalog cases replayed`);
