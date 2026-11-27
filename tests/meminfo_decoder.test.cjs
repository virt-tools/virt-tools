/* meminfo decoder: the /proc/meminfo field semantics from proc_meminfo(5) and the
   free(1) column definitions, the MemAvailable fallback, share rounding, parser
   spellings, refusals, a real captured dump, the catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'meminfo-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* meminfo-core:start */';
const endMarker = '/* meminfo-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MeminfoCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text) => plain(C.decode(text));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};

// An independent reading of the free(1) column rules and the proc_meminfo(5) fields.
const parseRef = (dump) => {
  const fields = {};
  for (const raw of dump.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const at = raw.indexOf(':');
    const key = raw.slice(0, at).trim();
    fields[key] = parseInt(raw.slice(at + 1).trim().split(/\s+/)[0], 10);
  }
  return fields;
};
const oracle = (dump) => {
  const fields = parseRef(dump);
  const total = fields.MemTotal;
  const free = fields.MemFree;
  const buffers = fields.Buffers || 0;
  const cached = fields.Cached || 0;
  const sreclaim = fields.SReclaimable || 0;
  const available = Object.prototype.hasOwnProperty.call(fields, 'MemAvailable')
    ? fields.MemAvailable
    : Math.min(total, free + buffers + cached);
  return {
    totalKb: total,
    usedKb: Math.max(0, total - available),
    availableKb: available,
    buffCacheKb: buffers + cached + sreclaim,
    swapUsedKb: (fields.SwapTotal || 0) - (fields.SwapFree || 0),
  };
};
// Round half up on the tenth grid, entirely in integers.
const tenths = (value, base) => {
  const num = value * 1000;
  const quotient = Math.floor(num / base);
  const rest = num - quotient * base;
  return (quotient + (2 * rest >= base ? 1 : 0)) / 10;
};

// ---- Exported surface.
assert.equal(C.REQUIRED.join(','), 'MemTotal,MemFree');
assert.ok(C.DEFAULT_DUMP.includes('MemAvailable:'));
assert.ok(C.DISPLAYED.includes('SReclaimable') && C.DISPLAYED.includes('SecPageTables'));

// ---- Size formatting by magnitude.
assert.equal(C.formatKb(0), '0 KiB');
assert.equal(C.formatKb(1023), '1023 KiB');
assert.equal(C.formatKb(1024), '1.0 MiB');
assert.equal(C.formatKb(1048575), '1024.0 MiB');
assert.equal(C.formatKb(1048576), '1.00 GiB');
assert.equal(C.formatKb(16316312), '15.56 GiB');

// ---- Shares round half up, not to even.
assert.equal(C.percent(1, 8), 12.5);
assert.equal(C.percent(1, 16), 6.3, '6.25 rounds up');
assert.equal(C.percent(3, 16), 18.8, '18.75 rounds up');
assert.equal(C.percent(0, 100), 0);
assert.equal(C.percent(5, 0), 0, 'a zero base reports no share');

// ---- The default sample decodes to the free(1) breakdown.
const sample = run(C.DEFAULT_DUMP);
const sampleRef = oracle(C.DEFAULT_DUMP);
for (const key of Object.keys(sampleRef)) {
  assert.equal(sample[key], sampleRef[key], 'default sample ' + key);
}
assert.equal(sample.totalKb, 16316312);
assert.equal(sample.usedKb, 6971192, 'in use is MemTotal minus MemAvailable');
assert.equal(sample.availableKb, 9345120);
assert.equal(sample.freeKb, 1212488);
assert.equal(sample.buffersKb, 412336);
assert.equal(sample.cachedKb, 5821440);
assert.equal(sample.sreclaimableKb, 502184);
assert.equal(sample.buffCacheKb, 412336 + 5821440 + 502184);
assert.equal(sample.sharedKb, 364088);
assert.equal(sample.slabKb, 664212);
assert.equal(sample.kernelKb, 9216 + 41880);
assert.equal(sample.swapTotalKb, 2097148);
assert.equal(sample.swapUsedKb, 2097148 - 1048182);
assert.equal(sample.usedPercent, 42.7);
assert.equal(sample.buffCachePercent, tenths(412336 + 5821440 + 502184, 16316312));
assert.equal(sample.swapUsedPercent, tenths(2097148 - 1048182, 2097148));
assert.equal(sample.headline, '42.7 % of RAM in use');
assert.equal(sample.subline, '15.56 GiB total, 6.65 GiB in use, 8.91 GiB available, swap 1.00 GiB of 2.00 GiB used');
assert.equal(sample.hasAvailable, true);
assert.equal(sample.commitLimitKb, 10261272);
assert.equal(sample.committedAsKb, 7012844);
assert.ok(sample.noteText.includes('In use is MemTotal minus MemAvailable'), 'the used formula is stated');
assert.ok(sample.noteText.includes('Swap holds 1.00 GiB in use of 2.00 GiB (50.0 %)'), 'the swap note carries the figures');
assert.ok(sample.noteText.includes('Committed_AS is 6.69 GiB against a CommitLimit of 9.79 GiB (68.3 %)'),
  'the commit note carries the figures');

// ---- A real /proc/meminfo captured from this host, pasted whole.
const HOST_DUMP = [
  'MemTotal:        8132800 kB',
  'MemFree:         1147032 kB',
  'MemAvailable:    3375400 kB',
  'Buffers:         1268688 kB',
  'Cached:           896048 kB',
  'SwapCached:            0 kB',
  'Active:          2281664 kB',
  'Inactive:        3502596 kB',
  'Active(anon):    2005360 kB',
  'Inactive(anon):  1920952 kB',
  'Active(file):     276304 kB',
  'Inactive(file):  1581644 kB',
  'Unevictable:           0 kB',
  'Mlocked:               0 kB',
  'SwapTotal:             0 kB',
  'SwapFree:              0 kB',
  'Zswap:                 0 kB',
  'Zswapped:              0 kB',
  'Dirty:               592 kB',
  'Writeback:             0 kB',
  'AnonPages:       3615504 kB',
  'Mapped:           182644 kB',
  'Shmem:            306864 kB',
  'KReclaimable:     869920 kB',
  'Slab:            1046120 kB',
  'SReclaimable:     869920 kB',
  'SUnreclaim:       176200 kB',
  'KernelStack:        6528 kB',
  'PageTables:        28920 kB',
  'SecPageTables:         0 kB',
  'NFS_Unstable:          0 kB',
  'Bounce:                0 kB',
  'WritebackTmp:          0 kB',
  'CommitLimit:     4066400 kB',
  'Committed_AS:    7341828 kB',
  'VmallocTotal:   34359738367 kB',
  'VmallocUsed:       27348 kB',
  'VmallocChunk:          0 kB',
  'Percpu:             1928 kB',
  'HardwareCorrupted:     0 kB',
  'AnonHugePages:   1822720 kB',
  'ShmemHugePages:        0 kB',
  'ShmemPmdMapped:        0 kB',
  'FileHugePages:         0 kB',
  'FilePmdMapped:         0 kB',
  'Unaccepted:            0 kB',
  'HugePages_Total:       0',
  'HugePages_Free:        0',
  'HugePages_Rsvd:        0',
  'HugePages_Surp:        0',
  'Hugepagesize:       2048 kB',
  'Hugetlb:               0 kB',
  'DirectMap4k:      156236 kB',
  'DirectMap2M:     6129664 kB',
  'DirectMap1G:     4194304 kB',
].join('\n');
const host = run(HOST_DUMP);
const hostRef = oracle(HOST_DUMP);
for (const key of Object.keys(hostRef)) {
  assert.equal(host[key], hostRef[key], 'captured dump ' + key);
}
assert.equal(host.usedKb, 4757400);
assert.equal(host.buffCacheKb, 3034656);
assert.equal(host.usedPercent, 58.5);
assert.equal(host.swapTotalKb, 0);
assert.equal(host.swapUsedKb, 0);
assert.equal(host.hasAvailable, true);
assert.ok(host.noteText.includes('No swap is configured'));
assert.ok(host.noteText.includes('Committed_AS is 7.00 GiB against a CommitLimit of 3.88 GiB (180.5 %)'));
assert.ok(host.otherCount >= 20, 'the unshown fields are counted: ' + host.otherCount);
assert.ok(host.noteText.includes(host.otherCount + ' other fields in this dump are not shown'));

// ---- Without MemAvailable the fallback is free plus buffers and cached.
const fallbackDump = 'MemTotal:  4100000 kB\nMemFree:    200000 kB\nBuffers:    120000 kB\nCached:   1500000 kB';
const fallback = run(fallbackDump);
assert.equal(fallback.hasAvailable, false);
assert.equal(fallback.availableKb, 1820000);
assert.equal(fallback.usedKb, 2280000);
assert.equal(fallback.usedPercent, 55.6);
assert.ok(fallback.noteText.includes('no MemAvailable line'), 'the fallback is explained');
assert.ok(!fallback.noteText.includes('MemTotal minus MemAvailable'));

// ---- Swap rows are shares of swap, RAM rows of RAM.
const swapped = run('MemTotal:  8000000 kB\nMemFree:    600000 kB\nMemAvailable:  2400000 kB\nSwapTotal:  4000000 kB\nSwapFree:  2000000 kB');
assert.equal(swapped.swapUsedKb, 2000000);
assert.equal(swapped.swapUsedPercent, 50);
assert.equal(swapped.usedPercent, 70);
assert.ok(swapped.noteText.includes('Swap holds 1.91 GiB in use of 3.81 GiB (50.0 %)'));
const noSwap = run('MemTotal:  1000000 kB\nMemFree:  900000 kB\nMemAvailable:  950000 kB');
assert.equal(noSwap.swapUsedPercent, 0, 'a zero swap total reports no share');
assert.ok(noSwap.noteText.includes('No swap is configured'));

// ---- Available above total clamps in use at zero and says so.
const clamped = run('MemTotal:  1000000 kB\nMemFree:    500000 kB\nMemAvailable:  1200000 kB');
assert.equal(clamped.usedKb, 0);
assert.equal(clamped.usedPercent, 0);
assert.ok(clamped.noteText.includes('MemAvailable reads more than MemTotal'));

// ---- Parser spellings: one dump, six shapes.
const base = 'MemTotal:  2000000 kB\nMemFree:    400000 kB\nMemAvailable:  1200000 kB';
const spellings = [
  base,
  base.replace(/\n/g, '\r\n'),
  'MemTotal:\t2000000\tkB\nMemFree:\t400000\tkB\nMemAvailable:\t1200000\tkB',
  '   MemTotal:  2000000 kB  \n\n  MemFree: 400 kB\nMemAvailable: 1200000 KB\n',
  '# cat /proc/meminfo\n' + base + '\n\n',
  base.replace(/ kB/g, ' KiB'),
];
for (const text of spellings) {
  const result = run(text);
  assert.equal(result.totalKb, 2000000, 'parsed: ' + JSON.stringify(text));
  assert.equal(result.usedKb, 800000, 'parsed: ' + JSON.stringify(text));
}
assert.equal(run('MemTotal:  1000 kB\nHugePages_Total:  0\nMemFree:  400 kB').totalKb, 1000,
  'a unit-less counter does not break the parse');

// ---- Refusals carry the reason and nothing else.
assert.equal(failure(''), 'Paste the contents of /proc/meminfo, one field per line.');
assert.equal(failure('   \n\t\n  '), 'Paste the contents of /proc/meminfo, one field per line.');
assert.equal(failure('MemFree:  1000 kB'), 'This does not look like /proc/meminfo: the MemTotal line is missing.');
assert.equal(failure('MemTotal:  1000 kB'), 'This does not look like /proc/meminfo: the MemFree line is missing.');
assert.equal(failure('MemTotal:  1000 kB\nthis is not a field\nMemFree:  400 kB'),
  'Line 2 does not look like a /proc/meminfo field: "this is not a field".');
assert.equal(failure('MemTotal:  1000 kB\nMemFree:   plenty kB'),
  'MemFree reads "plenty kB"; /proc/meminfo values are whole numbers of kB.');
assert.equal(failure('MemTotal:  1000 MB\nMemFree:  400 kB'),
  '"MB" is not a unit /proc/meminfo uses; values are in kB.');
assert.equal(failure('MemTotal:  1000 kB\nMemFree:  400 kB\nMemFree:  300 kB'),
  'MemFree appears twice; paste a single copy of /proc/meminfo.');
assert.equal(failure('MemTotal:  0 kB\nMemFree:  0 kB'),
  'MemTotal reads 0 kB, so there is no RAM to divide.');
assert.equal(failure('MemTotal:  1000 kB\nMemFree:  400 kB\nSwapTotal:  100 kB\nSwapFree:  200 kB'),
  'SwapFree reads more than SwapTotal, so the dump is inconsistent.');
assert.equal(failure('MemTotal:  1000 kB\nMemFree:  2000 kB'),
  'MemFree reads more than MemTotal, so the dump is inconsistent.');
assert.equal(failure('MemTotal:  1000 kB\nMemFree:'), 'MemFree has no value; /proc/meminfo writes a number after the colon.');

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'meminfo Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-18T02:45:00Z');
assert.ok(record.description.includes('/proc/meminfo'));
assert.ok(record.method.includes('free(1)'), 'method names the free column rules');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('half up'), 'method states the rounding rule');
assert.equal(record.sources.length, 3, 'three sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
assert.ok(record.sources.some((source) => source.url.includes('proc_meminfo')));
assert.ok(record.sources.some((source) => source.url.includes('free.1')));
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 29, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 11, 'eleven validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const text = testCase.input.meminfo;
  if (testCase.kind === 'validation') {
    assert.equal(failure(text), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(text);
  const reference = oracle(text);
  for (const key of Object.keys(reference)) {
    assert.equal(actual[key], reference[key], testCase.name + ' ' + key + ' against the free(1) model');
  }
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, testCase.name + ' ' + key);
    checked += 1;
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
for (const tag of ['system', 'linux', 'memory', 'meminfo', 'procfs']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2512, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2251, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 57, 'System count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 20, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="meminfo">/.test(html), 'the dump field has a label');
assert.ok(/<textarea id="meminfo"/.test(html), 'the dump is pasted into a textarea');
assert.ok(/rows="8"/.test(html), 'the textarea starts at eight rows');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/aria-labelledby="rows-title"/.test(html) && /<th scope="row">/.test(html), 'the field table is described');
assert.ok(/\.rows\[hidden\]\{display:none\}/.test(html), 'the display:table rule cannot defeat the hidden attribute');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/pre-wrap/.test(html), 'the pasted dump wraps instead of clipping');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one textarea');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('meminfo decoder: free(1) breakdown, MemAvailable fallback, ' + record.testCases.length
  + ' catalog cases, ' + checked + ' replayed values, a captured host dump and the page contract pass');
