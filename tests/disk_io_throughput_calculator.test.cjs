/* Regression checks for the disk I/O throughput calculator: the IOPS, block
   size and Little's law arithmetic, the catalogue cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'disk-io-throughput-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* disk-io-throughput-core:start */');
const end = html.indexOf('/* disk-io-throughput-core:end */');
assert.ok(start > -1 && end > start, 'disk I/O core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DiskIoCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) <= (epsilon === undefined ? 1e-9 : epsilon)
    + 1e-9 * Math.abs(expected),
  label + ': ' + actual + ' vs ' + expected);

const base = { iops: '10000', block: '4096', latency: '0.2', queue: '' };
const run = (input) => C.analyze(input);

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

// Independent transcription of the documented method using a different
// multiplication order from the page.
const TIB = 1024 ** 4;
const BLOCKS = { 512: 512, 4096: 4096, 8192: 8192, 16384: 16384, 32768: 32768, 65536: 65536, 131072: 131072, 262144: 262144, 1048576: 1048576 };

function oracle(input) {
  const num = (value) => Number(String(value).trim().replace(',', '.'));
  const iops = num(input.iops);
  const block = BLOCKS[Number(input.block)];
  const latencyMs = num(input.latency);
  const queueText = String(input.queue === undefined || input.queue === null ? '' : input.queue).trim();
  const queue = queueText === '' ? null : Number(queueText);
  const rate = block * iops;
  const latency = latencyMs / 1000;
  return {
    bytesPerSecond: rate,
    megabytesPerSecond: rate / 1000000,
    mebibytesPerSecond: rate / 1048576,
    gigabytesPerHour: rate / 1000000000 * 3600,
    terabytesPerDay: rate / 1000000000000 * 86400,
    secondsPerIO: 1 / iops,
    microsecondsPerIO: 1 / iops * 1000000,
    latencySeconds: latency,
    requiredQueueDepth: latency * iops,
    hoursPerTiB: TIB / 3600 / rate,
    queueDepth: queue,
    maxIopsAtQueueDepth: queue === null ? null : queue / latency,
    queueHeadroom: queue === null ? null : queue / latency - iops,
    queueCovers: queue === null ? null : iops <= queue / latency * (1 + 1e-12),
    queueUtilization: queue === null ? null : iops / (queue / latency),
  };
}

// Documented surface.
assert.deepEqual(Object.keys(C.BLOCK_SIZES).map(Number).sort((a, b) => a - b),
  [512, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 1048576]);
assert.deepEqual([...C.LIMITS.iops], [0.001, 100000000]);
assert.deepEqual([...C.LIMITS.latency], [0.001, 60000]);
assert.deepEqual([...C.LIMITS.queueDepth], [1, 65536]);
assert.deepEqual([...C.TABLE_IOPS], [1000, 10000, 100000]);
assert.match(C.MESSAGES.queueRange, /65536/);
assert.match(C.MESSAGES.latencyRange, /60000/);

// Golden: the default 10,000 IOPS of 4 KiB at 0.2 ms.
const plain = run(base);
closeTo(plain.bytesPerSecond, 40960000, 'default byte rate');
closeTo(plain.megabytesPerSecond, 40.96, 'default MB/s');
closeTo(plain.mebibytesPerSecond, 39.0625, 'default MiB/s');
closeTo(plain.gigabytesPerHour, 147.456, 'default GB per hour');
closeTo(plain.terabytesPerDay, 3.538944, 'default TB per day');
closeTo(plain.microsecondsPerIO, 100, 'default time per I/O');
closeTo(plain.requiredQueueDepth, 2, 'default queue depth needed');
closeTo(plain.hoursPerTiB, 7.456540444444445, 'default time for 1 TiB');
assert.equal(plain.queueDepth, null);
assert.equal(plain.maxIopsAtQueueDepth, null);
assert.equal(plain.queueCovers, null);

// Little's law equality is covered, one less is a shortfall.
const exact = run({ ...base, queue: '2' });
assert.equal(exact.queueCovers, true);
closeTo(exact.queueHeadroom, 0, 'exact queue has no headroom');
closeTo(exact.queueUtilization, 1, 'exact queue is fully used');
const shallow = run({ ...base, queue: '1' });
assert.equal(shallow.queueCovers, false);
closeTo(shallow.maxIopsAtQueueDepth, 5000, 'one outstanding request halves the rate');
closeTo(shallow.queueHeadroom, -5000, 'shallow queue shortfall');

// A 512-byte transfer halves the byte rate of the same IOPS.
closeTo(run({ ...base, block: '512' }).megabytesPerSecond, 40.96 / 8, '512 B blocks');

// Decimal commas and a zero-padded IOPS string.
const comma = run({ ...base, iops: '12,5', latency: '0,4' });
closeTo(comma.iops, 12.5, 'comma IOPS');
closeTo(comma.requiredQueueDepth, 12.5 * 0.0004, 'comma latency');

// Time to move 1 TiB halves when the byte rate doubles.
const double = run({ ...base, block: '8192' });
closeTo(double.hoursPerTiB, plain.hoursPerTiB / 2, 'double block halves the TiB time');

// Grid across IOPS, block size, latency and queue depth against the oracle.
const iopss = ['1', '120', '10000', '500000', '100000000'];
const blocks = Object.keys(BLOCKS);
const latencies = ['0.001', '0.2', '8', '60000'];
const queues = ['', '1', '2', '8', '65536'];
const fields = ['bytesPerSecond', 'megabytesPerSecond', 'mebibytesPerSecond', 'gigabytesPerHour',
  'terabytesPerDay', 'secondsPerIO', 'microsecondsPerIO', 'latencySeconds', 'requiredQueueDepth',
  'hoursPerTiB', 'queueDepth', 'maxIopsAtQueueDepth', 'queueHeadroom', 'queueCovers', 'queueUtilization'];
let checked = 0;
for (const iops of iopss) {
  for (const block of blocks) {
    for (const latency of latencies) {
      for (const queue of queues) {
        const input = { iops, block, latency, queue };
        const result = run(input);
        const expected = oracle(input);
        for (const field of fields) {
          if (typeof expected[field] === 'boolean') assert.equal(result[field], expected[field], field + ' ' + JSON.stringify(input));
          else if (expected[field] === null) assert.equal(result[field], null, field + ' ' + JSON.stringify(input));
          else closeTo(result[field], expected[field], field + ' ' + JSON.stringify(input));
        }
        closeTo(result.bytesPerSecond, result.iops * result.blockBytes, 'rate identity');
        closeTo(result.requiredQueueDepth, result.iops * result.latencySeconds, 'Little law identity');
        if (result.queueDepth !== null) {
          closeTo(result.maxIopsAtQueueDepth * result.latencySeconds, result.queueDepth, 'queue identity');
          assert.equal(result.queueCovers, result.iops <= result.maxIopsAtQueueDepth * (1 + 1e-12), 'cover verdict');
          closeTo(result.queueHeadroom, result.maxIopsAtQueueDepth - result.iops, 'headroom identity');
        }
        assert.ok(result.hoursPerTiB > 0, 'positive TiB time');
        checked += 1;
      }
    }
  }
}
assert.ok(checked >= 250, 'expected at least 250 grid rows');

// The reference table is IOPS times block size.
const table = C.table();
assert.equal(table.length, 9);
for (const row of table) {
  assert.ok(row.blockKiB > 0, 'table block size');
  row.throughput.forEach((megabytes, index) => {
    closeTo(megabytes, C.TABLE_IOPS[index] * row.blockBytes / 1000000, 'table cell');
  });
}

// Refusals name the field in the order it appears on the page.
assert.equal(failure({ ...base, iops: '' }), 'Enter the sustained IOPS.');
assert.equal(failure({ ...base, iops: 'ten thousand' }), 'IOPS must be a number.');
assert.equal(failure({ ...base, iops: '-100' }), 'IOPS must be a number.');
assert.equal(failure({ ...base, iops: '0' }), 'IOPS must be between 0.001 and 100000000.');
assert.equal(failure({ ...base, iops: '100000001' }), 'IOPS must be between 0.001 and 100000000.');
assert.equal(failure({ ...base, iops: '1e4' }), 'IOPS must be a number.');
assert.equal(failure({ ...base, block: '1024' }), 'Choose a block size from the list.');
assert.equal(failure({ ...base, block: '' }), 'Choose a block size from the list.');
assert.equal(failure({ ...base, latency: '' }), 'Enter the average latency.');
assert.equal(failure({ ...base, latency: '0.2ms' }), 'Latency must be a number of milliseconds.');
assert.equal(failure({ ...base, latency: '0' }), 'Latency must be between 0.001 and 60000 ms.');
assert.equal(failure({ ...base, latency: '-1' }), 'Latency must be a number of milliseconds.');
assert.equal(failure({ ...base, latency: '60001' }), 'Latency must be between 0.001 and 60000 ms.');
assert.equal(failure({ ...base, queue: '2.5' }), 'Queue depth must be a whole number.');
assert.equal(failure({ ...base, queue: 'abc' }), 'Queue depth must be a whole number.');
assert.equal(failure({ ...base, queue: '0' }), 'Queue depth must be between 1 and 65536.');
assert.equal(failure({ ...base, queue: '65537' }), 'Queue depth must be between 1 and 65536.');
// The block is checked before the latency, and the latency before the queue.
assert.equal(failure({ ...base, block: '1024', latency: '' }), 'Choose a block size from the list.');
assert.equal(failure({ ...base, latency: '', queue: '0' }), 'Enter the average latency.');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 24, 'expected at least twenty-four catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (typeof value === 'string') assert.equal(result[key], value, testCase.name + ' ' + key);
      else if (typeof value === 'boolean') assert.equal(result[key], value, testCase.name + ' ' + key);
      else if (value === null) assert.equal(result[key], null, testCase.name + ' ' + key);
      else closeTo(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="io-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['iops', 'block', 'latency', 'queue']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');

console.log('disk I/O throughput calculator: ' + entry.testCases.length + ' catalog cases, '
  + checked + ' grid rows and invariants passed');
