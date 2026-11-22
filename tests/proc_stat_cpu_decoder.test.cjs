/* proc/stat CPU utilization: the /proc/stat counter semantics from proc_stat(5), the
   two-sample difference, half-up shares and the busy/idle complement, iowait clamping,
   a 200-plan independent integer sweep, a captured host pair, refusals, the catalog
   replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'proc-stat-cpu-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* procstat-core:start */';
const endMarker = '/* procstat-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ProcStatCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text) => plain(C.decode(text));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};

// ---- An independent model: integer arithmetic only, BigInt for the shares.
const refParse = (text) => {
  const samples = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const label = parts[0];
    if (!/^cpu[0-9]*$/.test(label)) continue;
    const values = parts.slice(1).map((token) => BigInt(token));
    if (current === null || Object.prototype.hasOwnProperty.call(current, label)) {
      current = Object.create(null);
      samples.push(current);
    }
    current[label] = values;
  }
  return samples;
};
const tenths = (part, whole) => {
  const scaled = BigInt(part) * 1000n;
  const base = BigInt(whole);
  const quotient = scaled / base;
  const rest = scaled % base;
  return Number(quotient + (2n * rest >= base ? 1n : 0n));
};
const refRow = (label, one, two) => {
  const get = (row, at) => (at < row.length ? row[at] : 0n);
  const diff = [];
  for (let at = 0; at < 8; at += 1) {
    const delta = get(two, at) - get(one, at);
    diff.push(delta > 0n ? delta : 0n);
  }
  const total = diff.reduce((sum, value) => sum + value, 0n);
  const idle = diff[3] + diff[4];
  const busy = total - idle;
  const busyTenths = tenths(busy, total);
  return {
    label,
    totalJiffies: Number(total),
    busyPercent: busyTenths / 10,
    idlePercent: (1000 - busyTenths) / 10,
    userPercent: tenths(diff[0], total) / 10,
    systemPercent: tenths(diff[2], total) / 10,
    iowaitPercent: tenths(diff[4], total) / 10,
    stealPercent: tenths(diff[7], total) / 10,
  };
};
const refDecode = (text) => {
  const samples = refParse(text);
  const [one, two] = samples;
  const labels = Object.keys(one);
  const rows = new Map(labels.map((label) => [label, refRow(label, one[label], two[label])]));
  const cpus = labels.filter((label) => label !== 'cpu').sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const aggregate = rows.get('cpu');
  return { rows, cpus, aggregate };
};

// ---- Exported surface.
assert.equal(C.USER_HZ, 100);
assert.equal(C.COLUMNS.length, 10);
assert.equal(C.COLUMNS[0], 'user');
assert.equal(C.COLUMNS[9], 'guest_nice');
assert.ok(C.DEFAULT_SAMPLES.split('\n').filter((line) => /^cpu/.test(line)).length === 10,
  'the example carries two samples of five lines');

// ---- The default four-CPU example.
const sample = run(C.DEFAULT_SAMPLES);
const refSample = refDecode(C.DEFAULT_SAMPLES);
assert.equal(sample.busyPercent, 50.3);
assert.equal(sample.idlePercent, 49.7);
assert.equal(sample.windowSeconds, 2);
assert.equal(sample.cpuCount, 4);
assert.equal(sample.headline, '50.3 % busy across 4 CPUs');
assert.equal(sample.subline, '2.00 s window at USER_HZ = 100 across 4 CPUs, cpu0 busiest at 89.0 %');
assert.equal(sample.rows.length, 4);
assert.equal(sample.rows.map((row) => row.label).join(','), 'cpu0,cpu1,cpu2,cpu3');
for (const key of ['busyPercent', 'idlePercent', 'userPercent', 'systemPercent', 'iowaitPercent', 'stealPercent']) {
  assert.equal(sample.aggregate[key], refSample.aggregate[key], 'aggregate ' + key);
  for (let at = 0; at < sample.rows.length; at += 1) {
    assert.equal(sample.rows[at][key], refSample.rows.get(sample.rows[at].label)[key],
      sample.rows[at].label + ' ' + key);
  }
}
assert.equal(sample.rows[2].iowaitPercent, 60, 'the I/O-bound CPU spends most of its window waiting');
assert.equal(sample.rows[3].stealPercent, 15, 'the virtual machine loses a seventh of its time to steal');
assert.equal(sample.rows[0].busyPercent + sample.rows[0].idlePercent, 100, 'busy and idle are complements');
assert.ok(sample.noteText.includes('counts as idle'), 'the busy definition is stated');
assert.ok(sample.noteText.includes('Guest time is reported under user and nice') === false,
  'a sample without guest time does not claim any');

// ---- Every row's shares add up to 100 on the tenth grid, and each row is a partition.
for (const row of sample.rows.concat([sample.aggregate])) {
  const parts = ['userPercent', 'systemPercent', 'iowaitPercent', 'stealPercent'].reduce(
    (sum, key) => sum + Math.round(row[key] * 10), 0);
  assert.ok(parts <= 1000, row.label + ' shares do not exceed the whole');
  assert.equal(row.busyPercent + row.idlePercent, 100, row.label + ' busy and idle sum to 100');
}

// ---- A real pair captured on this host about a second apart.
const HOST = [
  'cpu  23852485 26876 19605396 170401749 9017849 0 1263950 64213 0 0',
  'cpu0 11974919 13554 9788562 85256528 4521991 0 610709 32052 0 0',
  'cpu1 11877565 13321 9816834 85145221 4495857 0 653241 32161 0 0',
  'ctxt 2450529657',
  'btime 1793937792',
  'cpu  23852564 26876 19605447 170401782 9017886 0 1263953 64213 0 0',
  'cpu0 11974947 13554 9788589 85256549 4522013 0 610712 32052 0 0',
  'cpu1 11877616 13321 9816858 85145233 4495872 0 653241 32161 0 0',
  'ctxt 2450534004',
  'btime 1793937792',
].join('\n');
const host = run(HOST);
assert.equal(host.cpuCount, 2);
assert.equal(host.busyPercent, 65.5);
assert.equal(host.windowSeconds, 1.02);
assert.equal(host.rows[1].busyPercent, 73.5);
assert.equal(host.rows[0].busyPercent, 57.4);
const refHost = refDecode(HOST);
assert.equal(host.aggregate.iowaitPercent, refHost.aggregate.iowaitPercent);
assert.equal(host.rows[1].userPercent, refHost.rows.get('cpu1').userPercent);

// ---- The 200-plan sweep against the integer model.
const sweepFailure = [];
let sweepRows = 0;
for (let plan = 0; plan < 200; plan += 1) {
  const cpus = 1 + (plan % 6);
  const lines = [];
  const base = [];
  for (let cpu = 0; cpu < cpus; cpu += 1) {
    const row = [];
    for (let at = 0; at < 8; at += 1) row.push(1000 + ((plan * 37 + cpu * 101 + at * 13) % 9000));
    base.push(row);
    lines.push('cpu' + cpu + ' ' + row.join(' '));
  }
  const second = [];
  for (let cpu = 0; cpu < cpus; cpu += 1) {
    const row = [];
    for (let at = 0; at < 8; at += 1) {
      const step = (plan * 7 + cpu * 3 + at * 5) % 240;
      row.push(base[cpu][at] + step);
    }
    second.push(row);
    lines.push('cpu' + cpu + ' ' + row.join(' '));
  }
  const text = lines.slice(0, cpus).join('\n') + '\n' + lines.slice(cpus).join('\n');
  const result = run(text);
  const ref = refDecode(text);
  for (const row of result.rows) {
    const expected = ref.rows.get(row.label);
    for (const key of ['busyPercent', 'idlePercent', 'userPercent', 'systemPercent', 'iowaitPercent', 'stealPercent']) {
      if (row[key] !== expected[key]) sweepFailure.push(plan + ' ' + row.label + ' ' + key + ' ' + row[key] + ' != ' + expected[key]);
    }
    sweepRows += 1;
  }
  const total = second.reduce((sum, row) => sum + row.slice(0, 8).reduce((a, b) => a + b, 0), 0)
    - base.reduce((sum, row) => sum + row.slice(0, 8).reduce((a, b) => a + b, 0), 0);
  if (Math.abs(result.windowSeconds - total / (100 * cpus)) > 0.0050001) {
    sweepFailure.push(plan + ' window ' + result.windowSeconds + ' vs ' + total / (100 * cpus));
  }
  if (result.rows.length !== cpus) sweepFailure.push(plan + ' row count');
}
assert.equal(sweepFailure.length, 0, sweepFailure.slice(0, 4).join(' | '));
assert.ok(sweepRows >= 600, 'the sweep covers every row: ' + sweepRows);

// ---- Clamping: the kernel may lower iowait, so a decrease becomes zero and is reported.
const clamped = run('cpu  1000 0 500 40000 900 0 0 0 0 0\ncpu0 1000 0 500 40000 900 0 0 0 0 0\n'
  + 'cpu  1100 0 520 40060 850 0 0 0 0 0\ncpu0 1100 0 520 40060 850 0 0 0 0 0');
assert.equal(clamped.clamped, 2, 'the decrease is counted on the aggregate line and on cpu0');
assert.equal(clamped.rows[0].iowaitPercent, 0, 'the clamped column contributes nothing');
assert.equal(clamped.rows[0].busyPercent, 66.7);
assert.ok(clamped.noteText.includes('2 counters decreased'), 'the clamp is reported');
assert.ok(clamped.noteText.includes('clamped to zero'));

// ---- Guest time is a subset of user and nice, never added twice.
const guest = run('cpu  3000 0 1000 20000 0 0 200 0 400 0\ncpu  3100 0 1050 20050 0 0 210 0 460 0');
assert.equal(guest.busyPercent, 76.2, 'guest time stays inside user and is not added again');
assert.equal(guest.rows.length, 0, 'an aggregate-only paste has no per-CPU rows');
assert.equal(guest.windowSeconds, null, 'an aggregate-only paste cannot fix a window');
assert.equal(guest.headline, '76.2 % busy across all CPUs');
assert.ok(guest.noteText.includes('Guest time is reported under user and nice'));
assert.ok(guest.noteText.includes('only the aggregate cpu line'));

// ---- Without the aggregate line the all-CPU row is the sum of the per-CPU rows.
const perCpu = run('cpu0 100000 200 40000 900000 8000 100 6000 0 0 0\n'
  + 'cpu1 90000 100 30000 950000 1000 90 5000 0 0 0\n'
  + 'cpu0 100120 200 40020 900050 8010 102 6004 0 0 0\n'
  + 'cpu1 90000 100 30000 950200 1000 90 5000 0 0 0');
assert.equal(perCpu.busyPercent, 36);
assert.equal(perCpu.cpuCount, 2);
assert.equal(perCpu.windowSeconds, 2.03);
assert.ok(perCpu.noteText.includes('no aggregate cpu line'));
const summedTotal = perCpu.rows.reduce((sum, row) => sum + row.totalJiffies, 0);
assert.equal(perCpu.aggregate.totalJiffies, summedTotal, 'the all-CPU row is the sum of the differences');

// ---- Refusals carry the page's own wording and nothing else.
assert.equal(failure(''), 'Paste two captures of /proc/stat, one taken before the interval and one after it.');
assert.equal(failure('  \n\t\n'), 'Paste two captures of /proc/stat, one taken before the interval and one after it.');
assert.equal(failure('cpu 0 0 0 100'), 'Only one sample is present. Paste a second capture taken a few seconds later, so there are two sets of cpu lines.');
assert.equal(failure('cpu 0 0 0 100\ncpu 0 0 0 200\ncpu 0 0 0 300'),
  'Three or more samples are present. Paste exactly two captures: one before the interval and one after it.');
assert.equal(failure('intr 1 2 3\nctxt 9'), 'No cpu lines were found. Paste the output of cat /proc/stat, including its cpu and cpuN lines.');
assert.equal(failure('cpu  lots 0 0 100'), 'Line 1 (cpu) has a counter that is not a whole number: "lots".');
assert.equal(failure('cpu 100 0 200'), 'Line 1 (cpu) lists 3 counters; /proc/stat prints at least user, nice, system and idle.');
assert.equal(failure('cpu 1 2 3 4 5 6 7 8 9 10 11'),
  'Line 1 (cpu) lists 11 counters; /proc/stat prints at most ten, from user through guest_nice.');
assert.equal(failure('cpu\n'),
  'Line 1 names cpu but has no counters after it.');
assert.equal(failure('cpu  100 0 50 1000\ncpu0 100 0 50 1000\ncpu1 100 0 50 1000\n'
  + 'cpu  200 0 70 1020\ncpu0 200 0 70 1020'),
  'cpu1 appears in the first sample but not the second; paste two captures of the same machine.');
assert.equal(failure('cpu  100 0 50 1000\ncpu0 100 0 50 1000\n'
  + 'cpu  200 0 70 1020\ncpu0 200 0 70 1020\ncpu1 0 0 0 0'),
  'cpu1 appears in the second sample but not the first; paste two captures of the same machine.');
assert.equal(failure('cpu0 100 0 50 1000\ncpu0 100 0 50 1000'),
  'No CPU time passed between the two samples for cpu0, so there is no utilization to work out.');

// ---- Parsing: CRLF, tabs, leading spaces, a shorter tail, and a missing tail column.
const parseShapes = [
  ['cpu  100 0 50 1000 20 0 5 0 0 0', 'cpu  200 0 70 1020 30 0 7 0 0 0'],
  ['  cpu 100 0 50 1000 20 0 5 0', '  cpu 200 0 70 1020 30 0 7 0'],
  ['cpu\t100\t0\t50\t1000\t20\t0\t5', 'cpu\t200\t0\t70\t1020\t30\t0\t7'],
  ['# cat /proc/stat\ncpu 100 0 50 1000\n\ncpu 140 0 70 1020\n'],
];
for (const [one, two] of parseShapes) {
  const shaped = run(one + '\r\n' + two);
  assert.ok(shaped.busyPercent > 0 && shaped.busyPercent <= 100, 'parsed: ' + JSON.stringify(one));
  assert.equal(shaped.cpuCount, 0, 'no per-CPU rows in a single-line paste');
  assert.equal(shaped.windowSeconds, null, 'a single line cannot fix a window');
}

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'proc/stat CPU Utilization Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-19T04:20:00Z');
assert.ok(record.description.includes('/proc/stat'));
assert.ok(record.method.includes('USER_HZ'), 'method names the tick unit');
assert.ok(record.method.includes('half up'), 'method states the rounding rule');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 2, 'two sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
assert.ok(record.sources.some((source) => source.url.includes('proc_stat.5')), 'the man page is cited');
assert.ok(record.sources.some((source) => source.url.includes('filesystems/proc')), 'the kernel doc is cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 28, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 7, 'seven boundary cases');
assert.equal(kinds('validation'), 11, 'eleven validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const text = testCase.input.stat;
  if (testCase.kind === 'validation') {
    assert.equal(failure(text), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, testCase.name + ' ' + key);
    checked += 1;
  }
  if (testCase.kind === 'golden') {
    const ref = refDecode(text);
    if (ref.aggregate) {
      assert.equal(actual.aggregate.busyPercent, ref.aggregate.busyPercent, testCase.name + ' aggregate against the model');
    }
    for (const row of actual.rows) {
      assert.equal(row.busyPercent, ref.rows.get(row.label).busyPercent, testCase.name + ' ' + row.label);
    }
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
for (const tag of ['system', 'linux', 'cpu', 'procfs', 'utilization']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2459, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2198, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 55, 'System count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="stat">/.test(html), 'the sample field has a label');
assert.ok(/<textarea id="stat"/.test(html), 'the samples are pasted into a textarea');
assert.ok(/rows="14"/.test(html), 'the textarea starts at fourteen rows');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/aria-labelledby="rows-title"/.test(html) && /head\.scope = "row"/.test(html), 'the CPU table is described');
assert.ok(/data-label/.test(html) && /td::before/.test(html), 'stacked cells keep their column name');
assert.ok(/\.rows\[hidden\]\{display:none\}/.test(html), 'the display:table rule cannot defeat the hidden attribute');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/pre-wrap/.test(html), 'the pasted dump wraps instead of clipping');
assert.ok(/addEventListener\("input", function\(\)\{ fit\(\); decode\(false\); \}\)/.test(html),
  'the box resizes as the value changes, so the action button cannot jump away from the first click');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one textarea');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('proc/stat CPU decoder: ' + record.testCases.length + ' catalog cases, ' + checked
  + ' replayed values, a 200-plan integer sweep (' + sweepRows + ' rows), a captured host pair and the page contract pass');
