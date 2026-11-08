/* Regression checks for the LVM extent calculator core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/lvm-extent-calculator/index.html'), 'utf8');
const start = html.indexOf('/* lvm-core:start */');
const end = html.indexOf('/* lvm-core:end */');
assert.ok(start > -1 && end > start, 'lvm core markers missing');
const core = html.slice(start, end + '/* lvm-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LvmCore;', sandbox);
const C = sandbox.module.exports;
const plan = (input) => C.plan(input);

// The documented default: four 1000 GiB disks, 1 MiB metadata, 4 MiB extents, a 3000 GiB LV.
const standard = plan({ pe: 4, meta: 1, disk: 1000, pvs: 4, lv: 3000 });
assert.equal(standard.perPv, 255999);
assert.equal(standard.vgExtents, 1023996);
assert.equal(standard.vgMib, 4095984);
assert.equal(standard.unusableMib, 4);
assert.equal(standard.lvExtents, 768000);
assert.equal(standard.allocatedMib, 3072000);
assert.equal(standard.wasteMib, 0);
assert.equal(standard.freeExtents, 255996);
assert.equal(standard.freeMib, 1023984);
assert.ok(Math.abs(standard.usablePct - 99.999609375) < 0.0001);

// One extent fewer per disk than the raw capacity implies: the metadata area eats the slack.
assert.equal(standard.perPv, 1024000 / 4 - 1);
assert.equal(standard.vgMib, standard.vgExtents * standard.pe);

// A group that is exactly filled leaves nothing free and rounds nothing.
const exact = plan({ pe: 4, meta: 1, disk: 2, pvs: 2, lv: 3.9921875 });
assert.equal(exact.freeExtents, 0);
assert.equal(exact.freeMib, 0);
assert.equal(exact.wasteMib, 0);
assert.equal(exact.full, true);

// Adding a disk adds whole extents, and a bigger LV takes more of them.
const wider = plan({ pe: 4, meta: 1, disk: 1000, pvs: 5, lv: 3000 });
assert.equal(wider.vgExtents - standard.vgExtents, standard.perPv);
assert.equal(wider.freeExtents - standard.freeExtents, standard.perPv);
const biggerLv = plan({ pe: 4, meta: 1, disk: 1000, pvs: 4, lv: 3200 });
assert.ok(biggerLv.lvExtents > standard.lvExtents);
assert.ok(biggerLv.freeExtents < standard.freeExtents);

// Bigger extents mean fewer of them on the same disk and coarser rounding.
const coarse = plan({ pe: 16, meta: 1, disk: 1000, pvs: 4, lv: 3000 });
assert.ok(coarse.perPv < standard.perPv);
assert.equal(coarse.perPv, Math.floor((1000 * 1024 - 1) / 16));

// The catalog carries the tool and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'lvm-extent-calculator');
assert.ok(record, 'catalog entry present');
assert.equal(record.name, 'LVM Extent Calculator');
assert.equal(record.category, 'System');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 25);

// Replay every canonical catalog case against the core and check the model invariants.
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') continue;
  const result = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      assert.ok(Math.abs(result[key] - value) < 0.005, `${testCase.name} ${key}: ${result[key]} != ${value}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
  const { pe, meta, disk, pvs } = testCase.input;
  assert.equal(result.vgExtents, result.perPv * pvs, `${testCase.name}: group is per-disk extents times disks`);
  assert.ok(result.perPv >= 1, `${testCase.name}: at least one extent per disk`);
  assert.equal(result.allocatedMib % pe, 0, `${testCase.name}: the LV is a whole number of extents`);
  assert.ok(result.wasteMib >= 0 && result.wasteMib < pe, `${testCase.name}: rounding waste stays under one extent`);
  assert.ok(result.freeExtents >= 0, `${testCase.name}: the LV fits`);
  assert.equal(result.freeExtents * pe, result.freeMib, `${testCase.name}: free extents match free space`);
  assert.ok(result.unusableMib < meta + pe, `${testCase.name}: unusable space is metadata plus less than one extent`);
  assert.ok(result.usablePct > 0 && result.usablePct <= 100, `${testCase.name}: usable share is a percentage`);
  assert.ok(Math.abs(result.diskMib - (disk * 1024)) < 0.01, `${testCase.name}: GiB converts as binary`);
}

// Validation cases must refuse with their exact message.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind !== 'validation') continue;
  assert.throws(() => plan(testCase.input), new RegExp(escape(testCase.expectedError)), testCase.name);
}

// The largest admissible LV is the whole group, and one more extent is refused.
const whole = plan({ pe: 4, meta: 1, disk: 4, pvs: 1, lv: 3.99609375 });
assert.equal(whole.freeExtents, 0);
assert.equal(whole.lvExtents, whole.vgExtents);
assert.ok(Math.abs(whole.allocatedMib - whole.vgMib) < 1e-9);
assert.throws(() => plan({ pe: 4, meta: 1, disk: 4, pvs: 1, lv: 4 }), /cannot be larger than the 3\.996 GiB this volume group holds/);

console.log('lvm-extent-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
