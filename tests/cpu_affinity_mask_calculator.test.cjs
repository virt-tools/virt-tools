/* Regression checks for the CPU affinity mask core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/cpu-affinity-mask-calculator/index.html'), 'utf8');
const start = html.indexOf('/* cpu-affinity-core:start */');
const end = html.indexOf('/* cpu-affinity-core:end */');
assert.ok(start > -1 && end > start, 'cpu-affinity core markers missing');
const core = html.slice(start, end + '/* cpu-affinity-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CpuAffinityCore;', sandbox);
const C = sandbox.module.exports;

const mask = (cpus, value) => C.convert({ cpus, source: 'mask', value });
const list = (cpus, value) => C.convert({ cpus, source: 'list', value });
const plain = (value) => JSON.parse(JSON.stringify(value));

// Every CPU of an eight-CPU machine, expressed as a mask.
const all = mask(8, '0xFF');
assert.equal(all.count, 8);
assert.equal(all.list, '0-7');
assert.equal(all.hex, '0xFF');
assert.equal(all.bare, 'ff');
assert.equal(all.decimal, '255');
assert.equal(all.binary, '1111 1111');
assert.equal(all.cpuCount, 8);
assert.deepEqual(plain(all.indices), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(plain(all.warnings), []);

// Bit order: 0x5 means CPU 0 and CPU 2, never CPU 1 or CPU 3.
assert.deepEqual(plain(mask(8, '0x5').indices), [0, 2]);
assert.equal(mask(8, '0x5').list, '0,2');
assert.equal(mask(8, '0x5').tasksetList, 'taskset -c 0,2 ./app');

// Optional prefixes, spaces and underscores are tolerated.
assert.deepEqual(plain(mask(8, '0x0F').indices), [0, 1, 2, 3]);
assert.deepEqual(plain(mask(8, '0x0f').indices), [0, 1, 2, 3]);
assert.deepEqual(plain(mask(16, '0xF_F').indices), [0, 1, 2, 3, 4, 5, 6, 7]);
assert.equal(mask(8, '00FF').hex, '0xFF');

// Ranges, spaces and overlapping duplicates normalise to one sorted set.
assert.deepEqual(plain(list(8, '7, 0-2, 2-3').indices), [0, 1, 2, 3, 7]);
assert.equal(list(8, '7, 0-2, 2-3').list, '0-3,7');
assert.equal(list(8, '0 2 4').list, '0,2,4');
assert.equal(C.formatRanges([0, 1, 2, 5, 7, 8], ','), '0-2,5,7-8');
assert.equal(C.formatRanges([0, 1, 2, 5, 7, 8], ' '), '0-2 5 7-8');
assert.equal(C.formatRanges([], ','), '');

// Round trip: a mask read from hex formats back to the same value.
for (const value of ['0x0', '0x1', '0x2A', '0xCF', '0xFFFFFFFF']) {
  const parsed = C.parseMask(value, 32);
  assert.equal(parsed.mask, BigInt(value));
  assert.equal(C.maskFromIndices(parsed.indices), BigInt(value), value + ' round trip');
  assert.deepEqual(plain(C.indicesFromMask(parsed.mask)), plain(parsed.indices), value + ' index list');
}

// Masks beyond 32 bits must not be truncated; BigInt keeps all 64 bits.
const wide = mask(64, '0x8000000000000000');
assert.equal(wide.count, 1);
assert.equal(wide.list, '63');
assert.equal(wide.decimal, '9223372036854775808');
assert.equal(C.parseMask('0xFFFFFFFFFFFFFFFF', 64).mask, BigInt('0xFFFFFFFFFFFFFFFF'));

// The upper bound is the kernel CPU_SETSIZE of 1024 CPUs.
assert.equal(C.MAX_CPUS, 1024);
const top = list(1024, '1023');
assert.equal(top.count, 1);
assert.equal(top.list, '1023');
assert.equal(C.parseMask(top.hex, 1024).mask, BigInt(1) << BigInt(1023));
assert.throws(() => mask(1024, '0x1' + '0'.repeat(256)), /only 1024 CPUs are configured/);

// Empty selections are reported, with a warning, rather than invented.
const empty = mask(8, '0x0');
assert.equal(empty.count, 0);
assert.equal(empty.list, '');
assert.equal(empty.hex, '0x0');
assert.equal(empty.decimal, '0');
assert.equal(empty.binary, '0');
assert.equal(empty.warnings.length, 1);
assert.match(empty.warnings[0], /No CPUs are selected/);
assert.equal(list(8, '').warnings.length, 1);

// Bad input fails with an actionable message.
assert.throws(() => mask(4, '0x10'), /The mask sets CPU 4, but only 4 CPUs are configured/);
assert.throws(() => mask(8, '0xGG'), /only hexadecimal digits/);
assert.throws(() => list(8, '5-3'), /is descending/);
assert.throws(() => list(8, '0-9'), /only 8 CPUs are configured/);
assert.throws(() => list(8, 'cpu7'), /is not a CPU index/);
assert.throws(() => list(8, '9-2'), /only 8 CPUs are configured|is descending/);
assert.throws(() => C.convert({ cpus: 1.5, source: 'mask', value: '0x1' }), /whole number/);
assert.throws(() => C.convert({ cpus: 0, source: 'mask', value: '0x1' }), /at least 1/);
assert.throws(() => C.convert({ cpus: 2048, source: 'mask', value: '0x1' }), /1024 or fewer/);

// Command strings keep their documented shapes.
const six = list(8, '0-3,6,7');
assert.equal(six.list, '0-3,6-7');
assert.equal(six.tasksetList, 'taskset -c 0-3,6-7 ./app');
assert.equal(six.tasksetMask, 'taskset cf ./app');
assert.equal(six.docker, '--cpuset-cpus=0-3,6-7');
assert.equal(six.systemd, 'CPUAffinity=0-3 6-7');
assert.equal(six.cgroup, 'cpuset.cpus = 0-3,6-7');
assert.equal(all.systemd, 'CPUAffinity=0-7');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'cpu-affinity-mask-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'System');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 15, 'catalog has the full test case set');
for (const testCase of record.testCases) {
  const options = { source: testCase.input.source, value: testCase.input.value, cpus: testCase.input.cpus };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.convert(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.convert(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('cpu-affinity-mask-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
