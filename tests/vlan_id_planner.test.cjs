/* Regression checks for the VLAN ID planner: every catalog case, an
   independent allocation oracle, hand-checked tag anchors and refusals
   outside the catalog. The core runs in a vm context, so arrays and objects
   are compared through JSON to avoid cross-realm prototype mismatches. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/vlan-id-planner/index.html'), 'utf8');
const start = html.indexOf('/* vlan-core:start */');
const end = html.indexOf('/* vlan-core:end */');
assert.ok(start > -1 && end > start, 'vlan core markers missing');
const core = html.slice(start, end + '/* vlan-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VlanCore;', sandbox);
const C = sandbox.module.exports;

const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'vlan-id-planner');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'VLAN ID Planner', 'catalog name');
assert.equal(entry.category, 'IT & Networking', 'catalog category');
assert.equal(entry.subcategory, 'Planning', 'catalog subcategory');
assert.equal(entry.risk, 'low', 'catalog risk');
assert.equal(entry.maturity, 'draft', 'catalog maturity');
assert.equal(entry.listed, true, 'catalog listed');
assert.ok(entry.testCases.length >= 26, `expected at least 26 cases, found ${entry.testCases.length}`);

// Independent oracle: build the free list from the 12-bit VID space and the
// documented legacy reservation, then take the lowest IDs. Deliberately does
// not reuse any page logic.
const LEGACY = [1002, 1003, 1004, 1005];
function oracle({ start: first, end: last, count, used = '' }) {
  const reserved = LEGACY.filter((id) => id >= first && id <= last);
  const usedIds = new Set();
  for (const token of String(used).trim().split(/[\s,]+/).filter(Boolean)) {
    const parts = token.split('-').map(Number);
    const lastId = parts.length > 1 ? parts[1] : parts[0];
    for (let id = parts[0]; id <= lastId; id += 1) usedIds.add(id);
  }
  const free = [];
  for (let id = first; id <= last; id += 1) {
    if (!reserved.includes(id) && !usedIds.has(id)) free.push(id);
  }
  return { freeCount: free.length, allocated: free.slice(0, count) };
}

const NUMERIC = [
  'usableInRange', 'reservedSkipped', 'usedInRange', 'usedIgnored',
  'freeBefore', 'freeAfter', 'blockCount',
];

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.kind === 'validation') {
    assert.throws(() => C.calculate(testCase.input), (error) => error.message === testCase.expected.error,
      `${label}: expected refusal "${testCase.expected.error}"`);
    continue;
  }
  const got = C.calculate(testCase.input);
  const expected = testCase.expected;
  same(got.allocated, expected.allocated, `${label}: allocated`);
  assert.equal(got.allocationLabel, expected.allocationLabel, `${label}: label`);
  assert.equal(got.requested, Number(testCase.input.count), `${label}: requested`);
  for (const key of NUMERIC) {
    assert.equal(got[key], expected[key], `${label}: ${key}`);
  }
  same(got.largestBlock, expected.largestBlock, `${label}: largest block`);
  same(got.warnings, expected.warnings, `${label}: warnings`);
  assert.equal(got.tags.length, expected.allocated.length, `${label}: tag count`);
  got.tags.forEach((tag, index) => {
    assert.equal(tag.id, expected.allocated[index], `${label}: tag id`);
    const expectedTag = got.priority * 8192 + got.dei * 4096 + tag.id;
    assert.equal(tag.tag, expectedTag, `${label}: tag arithmetic`);
    assert.equal(tag.hex, '0x' + expectedTag.toString(16).toUpperCase().padStart(4, '0'), `${label}: tag hex`);
  });
  if (expected.tags) {
    same(got.tags, expected.tags, `${label}: tags`);
  }

  // Oracle agreement on the allocation itself.
  const check = oracle({
    start: got.start, end: got.end, count: Number(testCase.input.count), used: testCase.input.used || '',
  });
  assert.equal(got.freeBefore, check.freeCount, `${label}: oracle free count`);
  same(got.allocated, check.allocated, `${label}: oracle allocation`);
}

// Anchors computed by hand from the 802.1Q layout.
assert.equal(C.calculate({ priority: '5', dei: '1', start: '100', end: '100', count: '1' }).tags[0].tag, 45156);
assert.equal(C.calculate({ priority: '7', dei: '1', start: '4094', end: '4094', count: '1' }).tags[0].hex, '0xFFFE');
assert.equal(C.calculate({ priority: '0', dei: '0', start: '1', end: '4094', count: '1' }).usableInRange, 4090);

const defaults = C.calculate({});
same(defaults.allocated, [10, 11, 12, 13], 'defaults');
assert.equal(defaults.priority, 0, 'default priority');
assert.equal(defaults.dei, 0, 'default DEI');

// Parsing helpers.
same(C.parseUsed('30-32, 31, 30'), [30, 31, 32], 'used dedupe and sort');
same(C.parseUsed(''), [], 'empty used');
assert.equal(C.parseUsed('0-4095').length, 4096, 'full space expansion');

// Refusals outside the catalog.
const refusals = [
  [{ start: '-5' }, 'Range start must be a whole number from 1 to 4094.'],
  [{ start: '  ' }, 'Range start must be a whole number from 1 to 4094.'],
  [{ end: '4094.0' }, 'Range end must be a whole number from 1 to 4094.'],
  [{ count: '  ' }, 'VLANs needed must be a whole number from 1 to 32.'],
  [{ used: '10--12' }, 'In-use VLANs must be numbers or ranges such as 20 or 30-39.'],
  [{ used: '1e3' }, 'In-use VLANs must be numbers or ranges such as 20 or 30-39.'],
  [{ used: '4000-4095' }, null],
  [{ dei: 'maybe' }, 'Drop eligible must be yes or no.'],
  [{ start: '10', end: '10', count: '2' }, 'Only 1 of 2 requested VLAN IDs are free in 10-10.'],
  [{ start: '1002', end: '1003', count: '1' }, 'Only 0 of 1 requested VLAN IDs are free in 1002-1003.'],
];
for (const [input, message] of refusals) {
  if (message === null) {
    assert.doesNotThrow(() => C.calculate(input), `should accept ${JSON.stringify(input)}`);
    continue;
  }
  assert.throws(() => C.calculate(input), (error) => error.message === message,
    `refusal for ${JSON.stringify(input)}`);
}

// Reserved block is never allocated across its whole span.
same(C.calculate({ start: '1000', end: '1005', count: '2' }).allocated, [1000, 1001]);

console.log(`vlan-id-planner: ${entry.testCases.length} catalog cases, ${refusals.length} extra refusals, anchors ok`);
