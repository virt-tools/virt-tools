/* Spanning tree checks: the page core against an independent reference model,
   spanning-tree invariants on random topologies, validation messages, catalog
   replay and the page's offline, accessible contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'spanning-tree-root-bridge-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* spanning-tree-core:start */';
const endMarker = '/* spanning-tree-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'spanning tree core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StpTopologyCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.plan(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const sw = (name, priority, mac) => ({ name, priority: String(priority), mac });
const link = (a, b, speed, custom) => (custom === undefined ? { a, b, speed } : { a, b, speed, custom });
const resolve = (value, dotted) => dotted.split('.').reduce(
  (acc, part) => (Array.isArray(acc) ? acc[Number(part)] : acc[part]), value);

// ---- Exported contract.
assert.equal(C.COST_BASE, 20000000);
assert.equal(C.MIN_MBPS, 10);
assert.equal(C.MAX_MBPS, 1000000);
assert.equal(C.MAX_SWITCHES, 8);
assert.equal(C.MAX_LINKS, 12);
assert.deepEqual(plain(C.SPEEDS).map((speed) => speed.id),
  ['10', '100', '1000', '2500', '10000', '40000', '100000', 'custom']);
assert.deepEqual(plain(C.SPEEDS).slice(0, 7).map((speed) => C.speedValue(speed.id, '').cost),
  [2000000, 200000, 20000, 8000, 2000, 500, 200]);
assert.equal(C.speedValue('custom', '25000').cost, 800);
assert.equal(C.speedValue('custom', '25000').label, '25,000 Mb/s');
assert.deepEqual(plain(C.DEFAULTS.switches).map((item) => item.name), ['SW1', 'SW2', 'SW3', 'SW4']);
assert.deepEqual(plain(C.DEFAULTS.links).map((item) => [item.a, item.b, item.speed]),
  [['SW1', 'SW2', '1000'], ['SW2', 'SW3', '1000'], ['SW3', 'SW4', '1000'], ['SW4', 'SW1', '1000'], ['SW2', 'SW4', '100']]);
assert.equal(C.bridgeId({ priority: 32768, mac: '02:00:00:00:00:11' }), '32768.0200.0000.0011');
assert.equal(C.bridgeId({ priority: 0, mac: '02:00:00:00:00:11' }), '0.0200.0000.0011');
assert.equal(C.macValue('0200.0000.00AA'), '02:00:00:00:00:aa');
assert.equal(C.macValue('02-00-00-00-00-BB'), '02:00:00:00:00:bb');
assert.equal(C.comma(2000000), '2,000,000');
assert.equal(C.comma(200), '200');

// ---- Default topology: a square with a slow diagonal.
const published = run(C.DEFAULTS);
assert.equal(published.rootName, 'SW1');
assert.equal(published.rootBridgeId, '32768.0200.0000.0011');
assert.equal(published.switchCount, 4);
assert.equal(published.linkCount, 5);
assert.equal(published.blockedCount, 2);
assert.deepEqual(published.blockedNames, ['SW3 port 2', 'SW4 port 3']);
assert.equal(published.blockedText, '2 blocked ports');
assert.equal(published.forwardingCount, 3);
assert.deepEqual(published.switches.map((item) => item.pathCost), [0, 20000, 40000, 20000]);
assert.deepEqual(published.switches.map((item) => item.rootPortText),
  ['Root bridge', 'Port 1 to SW1', 'Port 1 to SW2', 'Port 2 to SW1']);
assert.deepEqual(published.links.map((item) => item.designated), ['SW1', 'SW2', 'SW4', 'SW1', 'SW2']);
assert.deepEqual(published.links.map((item) => item.aRole),
  ['Designated', 'Designated', 'Alternate (blocked)', 'Root', 'Designated']);
assert.deepEqual(published.links.map((item) => item.bRole),
  ['Root', 'Root', 'Designated', 'Designated', 'Alternate (blocked)']);
assert.deepEqual(published.links.map((item) => item.state),
  ['Forwarding', 'Forwarding', 'Blocked on SW3', 'Forwarding', 'Blocked on SW4']);
assert.equal(published.links[4].cost, 200000);
assert.equal(published.links[4].costText, '200,000');

// ---- Reference topologies computed by an independent Python model.
const REFERENCE = [
  {
    name: 'five-switch mesh',
    input: {
      switches: [sw('A', 32768, '02:00:00:00:01:01'), sw('B', 8192, '02:00:00:00:01:02'),
        sw('C', 32768, '02:00:00:00:01:03'), sw('D', 36864, '02:00:00:00:01:04'),
        sw('E', 32768, '02:00:00:00:01:05')],
      links: [link('A', 'B', '1000'), link('B', 'C', '1000'), link('C', 'D', '10000'),
        link('D', 'E', '1000'), link('E', 'A', '100'), link('B', 'E', '1000')],
    },
    root: 'B',
    blocked: ['D port 2', 'E port 2'],
    costs: [['A', 20000, 'Port 1 to B'], ['B', 0, 'Root bridge'], ['C', 20000, 'Port 1 to B'],
      ['D', 22000, 'Port 1 to C'], ['E', 20000, 'Port 3 to B']],
    designated: ['B', 'B', 'C', 'E', 'A', 'B'],
    states: [[0, 20000, 'Root', 'Designated'], [1, 20000, 'Designated', 'Root'],
      [2, 2000, 'Designated', 'Root'], [3, 20000, 'Alternate (blocked)', 'Designated'],
      [4, 200000, 'Alternate (blocked)', 'Designated'], [5, 20000, 'Designated', 'Root']],
  },
  {
    name: 'priority zero star',
    input: {
      switches: [sw('HUB', 0, '02:00:00:00:02:01'), sw('S1', 32768, '02:00:00:00:02:02'),
        sw('S2', 32768, '02:00:00:00:02:03'), sw('S3', 4096, '02:00:00:00:02:04')],
      links: [link('HUB', 'S1', '10'), link('HUB', 'S2', '1000'), link('HUB', 'S3', '40000')],
    },
    root: 'HUB',
    blocked: [],
    costs: [['HUB', 0, 'Root bridge'], ['S1', 2000000, 'Port 1 to HUB'],
      ['S2', 20000, 'Port 1 to HUB'], ['S3', 500, 'Port 1 to HUB']],
    designated: ['HUB', 'HUB', 'HUB'],
    states: [[0, 2000000, 'Designated', 'Root'], [1, 20000, 'Designated', 'Root'],
      [2, 500, 'Designated', 'Root']],
  },
  {
    name: 'six-switch ring',
    input: {
      switches: [1, 2, 3, 4, 5, 6].map((i) => sw('R' + i, 32768, '02:00:00:00:03:0' + i)),
      links: [1, 2, 3, 4, 5, 6].map((i) => link('R' + i, 'R' + (i % 6 + 1), '1000')),
    },
    root: 'R1',
    blocked: ['R4 port 2'],
    costs: [['R1', 0, 'Root bridge'], ['R2', 20000, 'Port 1 to R1'], ['R3', 40000, 'Port 1 to R2'],
      ['R4', 60000, 'Port 1 to R3'], ['R5', 40000, 'Port 2 to R6'], ['R6', 20000, 'Port 2 to R1']],
    designated: ['R1', 'R2', 'R3', 'R5', 'R6', 'R1'],
    states: [[0, 20000, 'Designated', 'Root'], [1, 20000, 'Designated', 'Root'],
      [2, 20000, 'Designated', 'Root'], [3, 20000, 'Alternate (blocked)', 'Designated'],
      [4, 20000, 'Root', 'Designated'], [5, 20000, 'Root', 'Designated']],
  },
  {
    name: 'custom 25 Gb/s triangle',
    input: {
      switches: [sw('SW1', 40960, '02:00:00:00:04:01'), sw('SW2', 40960, '02:00:00:00:04:02'),
        sw('SW3', 32768, '02:00:00:00:04:03')],
      links: [link('SW1', 'SW2', 'custom', '25000'), link('SW2', 'SW3', 'custom', '25000'),
        link('SW1', 'SW3', 'custom', '25000')],
    },
    root: 'SW3',
    blocked: ['SW2 port 1'],
    costs: [['SW1', 800, 'Port 2 to SW3'], ['SW2', 800, 'Port 2 to SW3'], ['SW3', 0, 'Root bridge']],
    designated: ['SW1', 'SW3', 'SW3'],
    states: [[0, 800, 'Designated', 'Alternate (blocked)'], [1, 800, 'Root', 'Designated'],
      [2, 800, 'Root', 'Designated']],
  },
  {
    name: 'fractional custom speed',
    input: {
      switches: [sw('SW1', 32768, '02:00:00:00:05:01'), sw('SW2', 32768, '02:00:00:00:05:02')],
      links: [link('SW1', 'SW2', 'custom', '1234.5')],
    },
    root: 'SW1',
    blocked: [],
    costs: [['SW1', 0, 'Root bridge'], ['SW2', 16201, 'Port 1 to SW1']],
    designated: ['SW1'],
    states: [[0, 16201, 'Designated', 'Root']],
  },
];
for (const reference of REFERENCE) {
  const result = run(reference.input);
  assert.equal(result.rootName, reference.root, reference.name + ' root');
  assert.deepEqual(result.blockedNames, reference.blocked, reference.name + ' blocked ports');
  assert.deepEqual(result.switches.map((item) => [item.name, item.pathCost, item.rootPortText]),
    reference.costs, reference.name + ' costs');
  assert.deepEqual(result.links.map((item) => item.designated), reference.designated, reference.name + ' designated');
  assert.deepEqual(result.links.map((item) => [item.index, item.cost, item.aRole, item.bRole]),
    reference.states, reference.name + ' port roles');
}

// ---- Spanning tree invariants across deterministic pseudo-random topologies.
let seed = 20261111;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (items) => items[Math.floor(rand() * items.length)];
const SPEED_IDS = ['10', '100', '1000', '2500', '10000', '40000', '100000'];
const PRIORITIES = [0, 4096, 32768, 32768, 61440];
for (let iteration = 0; iteration < 60; iteration += 1) {
  const count = 3 + Math.floor(rand() * 4);
  const switches = [];
  for (let i = 0; i < count; i += 1) {
    switches.push(sw('T' + i, pick(PRIORITIES),
      '02:00:00:' + iteration.toString(16).padStart(2, '0') + ':' + i.toString(16).padStart(2, '0') + ':01'));
  }
  const pairs = [];
  const addPair = (a, b) => {
    const key = [a, b].sort((x, y) => x - y).join('-');
    if (pairs.some((pair) => pair.key === key)) return;
    pairs.push({ key, a, b });
  };
  for (let i = 1; i < count; i += 1) addPair(i, Math.floor(rand() * i));
  const extras = Math.floor(rand() * 3);
  for (let extra = 0; extra < extras; extra += 1) {
    const a = Math.floor(rand() * count);
    const b = Math.floor(rand() * count);
    if (a !== b) addPair(a, b);
  }
  const links = pairs.map((pair) => link(switches[pair.a].name, switches[pair.b].name, pick(SPEED_IDS)));
  const input = { switches, links };
  const result = run(input);
  const label = 'random topology ' + iteration;

  assert.equal(result.blockedCount, result.linkCount - result.switchCount + 1, label + ' blocked equals loops');
  assert.equal(result.forwardingCount + result.blockedCount, result.linkCount, label + ' every link is classified');
  assert.equal(result.switches.filter((item) => item.isRoot).length, 1, label + ' one root');
  assert.equal(result.switches.find((item) => item.isRoot).pathCost, 0, label + ' root cost is zero');

  // Forwarding links must form a tree that connects every switch.
  const parent = new Map(result.switches.map((item) => [item.name, item.name]));
  const find = (name) => (parent.get(name) === name ? name : find(parent.get(name)));
  for (const row of result.links) {
    if (row.blocked) continue;
    parent.set(find(row.a), find(row.b));
  }
  const roots = new Set(result.switches.map((item) => find(item.name)));
  assert.equal(roots.size, 1, label + ' forwarding links connect every switch');

  for (const row of result.links) {
    const pair = [row.aRole, row.bRole].sort().join('/');
    assert.ok(['Alternate (blocked)/Designated', 'Designated/Root'].includes(pair),
      label + ' unexpected port role pair ' + pair);
    assert.equal(row.designated === row.a ? row.aRole : row.bRole, 'Designated', label + ' designated side');
    assert.equal(row.blocked, row.blockedName !== null, label + ' blocked flag matches the name');
    if (row.blocked) assert.equal(row.state, 'Blocked on ' + row.blockedName, label + ' blocked state text');
    else assert.equal(row.state, 'Forwarding', label + ' forwarding state text');
  }
  for (const item of result.switches) {
    if (!item.isRoot) {
      assert.ok(item.pathCost > 0, label + ' non-root cost is positive');
      assert.ok(/^Port \d+ to /.test(item.rootPortText), label + ' non-root has a root port');
    }
  }
  assert.deepEqual(plain(C.plan(input)), plain(C.plan(input)), label + ' plan is deterministic');
}

// ---- Validation messages.
const two = { switches: [sw('SW1', 32768, '02:00:00:00:00:11'), sw('SW2', 32768, '02:00:00:00:00:22')], links: [link('SW1', 'SW2', '1000')] };
assert.equal(failure({ switches: [sw('SW1', 32768, '02:00:00:00:00:11')], links: [] }), 'Add at least two switches.');
assert.equal(failure({ switches: [], links: [] }), 'Add at least two switches.');
assert.equal(failure({ switches: [sw('SW1', 32768, '02:00:00:00:00:11'), sw('SW1', 32768, '02:00:00:00:00:22')], links: [] }),
  'Switch names must be unique.');
assert.equal(failure({ switches: [sw('', 32768, '02:00:00:00:00:11'), sw('SW2', 32768, '02:00:00:00:00:22')], links: [] }),
  'Switch 1 needs a name.');
assert.equal(failure({ switches: [sw('SW1', 32769, '02:00:00:00:00:11'), sw('SW2', 32768, '02:00:00:00:00:22')], links: [] }),
  'Bridge priority must be 0 to 61440 in steps of 4096.');
assert.equal(failure({ switches: [sw('SW1', 'high', '02:00:00:00:00:11'), sw('SW2', 32768, '02:00:00:00:00:22')], links: [] }),
  'Bridge priority must be a whole number.');
assert.equal(failure({ switches: [sw('SW1', 32768, '02:00:00:00:00'), sw('SW2', 32768, '02:00:00:00:00:22')], links: [] }),
  'MAC addresses must be 12 hexadecimal digits.');
assert.equal(failure({ switches: [sw('SW1', 32768, '02:00:00:00:00:11'), sw('SW2', 32768, '02:00:00:00:00:11')], links: [] }),
  'Two switches cannot share the same MAC address.');
assert.equal(failure({ switches: two.switches, links: [] }), 'Add at least one link between the switches.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW1', '1000')] }),
  'A link must join two different switches.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'NOPE', '1000')] }),
  'Each link must connect two named switches.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', '1000'), link('SW2', 'SW1', '100')] }),
  'Only one link between SW1 and SW2 is supported.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', '5000')] }),
  'Choose a link speed from the list.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', 'custom', '')] }),
  'Enter a custom link speed in Mb/s.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', 'custom', 'fast')] }),
  'Custom link speed must be a number of Mb/s.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', 'custom', '5')] }),
  'Custom link speed must be from 10 to 1000000 Mb/s.');
assert.equal(failure({ switches: two.switches, links: [link('SW1', 'SW2', 'custom', '1000001')] }),
  'Custom link speed must be from 10 to 1000000 Mb/s.');
assert.equal(failure({ switches: two.switches.concat([sw('SW3', 32768, '02:00:00:00:00:33')]), links: [link('SW1', 'SW2', '1000')] }),
  'SW3 cannot reach the root bridge; connect it to the topology.');
assert.equal(C.speedValue('custom', '1000000').cost, 20, 'fastest custom speed clamps to 20');
assert.equal(C.speedValue('custom', '12.5').label, '12.5 Mb/s');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2220, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Spanning Tree Root Bridge Calculator');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(resolve(result, key), value, testCase.name + ' ' + key);
  }
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

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok((html.match(/setAttribute\("aria-label"/g) || []).length >= 2, 'generated controls are labelled');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/scope="col"/.test(html), 'table headers are scoped');
assert.ok(/overflow-x:auto/.test(html), 'wide tables scroll instead of overflowing');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[←—–·×]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('spanning-tree-root-bridge-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + REFERENCE.length + ' reference topologies, '
  + '60 random invariant sweeps and the offline page contract)');
