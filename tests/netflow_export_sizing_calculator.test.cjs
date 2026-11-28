/* NetFlow/IPFIX export sizing calculator: replays every catalog case, re-derives the
   sampling and volume arithmetic independently, and pins the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'netflow-export-sizing-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* flow-export-core:start */';
const endMarker = '/* flow-export-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FlowExportCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2519, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2258, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 58, 'Networking count');
assert.equal(entry.category, 'Networking', 'category');
assert.equal(entry.subcategory, 'Planning', 'subcategory');
assert.equal(entry.risk, 'moderate', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.equal(entry.testCases.length, 28, `expected 28 cases, found ${entry.testCases.length}`);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'goldens pinned');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 18, 'refusals pinned');
assert.ok(entry.sources.some((source) => /rfc7011\.html$/.test(source.url || '')), 'RFC 7011 cited');
assert.ok(entry.sources.some((source) => /rfc5476\.html$/.test(source.url || '')), 'RFC 5476 cited');
assert.ok(/NetFlow/.test(entry.description) && /IPFIX/.test(entry.description), 'description names both protocols');

// ---- Catalog cases: every golden and every refusal, replayed through the page core.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.run(testCase.input), (error) => error.message === testCase.expected.error, label);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, `${label}: ${key}`);
  }
  assert.equal(result.warnings.length, testCase.expected.warningCount, `${label}: warning array`);
}

// ---- Independent re-derivation: packet rate, flow rate and sampling probability.
const base = () => ({ throughput: '100', packetSize: '500', packetsPerFlow: '20', sampling: '1000',
  activeTimeout: '60', recordSize: '200', retention: '30' });
const run = (over) => C.run(Object.assign(base(), over));

const sample = run({});
assert.equal(sample.packetsPerSecond, 25000, '100 Mbit/s at 500 B is 25,000 packets per second');
assert.equal(sample.flowsPerSecond, 1250, '20 packets per flow gives 1,250 flows per second');

// The probability that a k-packet flow is sampled at least once, computed as a product
// rather than with Math.pow, must agree with the reported coverage.
const coverage = (n, k) => {
  let miss = 1;
  for (let i = 0; i < k; i += 1) miss *= 1 - 1 / n;
  return (1 - miss) * 100;
};
for (const [n, k] of [[1000, 20], [100, 4], [10, 3], [2, 1]]) {
  const result = run({ sampling: String(n), packetsPerFlow: String(k) });
  assert.ok(Math.abs(result.coveragePercent - coverage(n, k)) < 0.01,
    `coverage for 1 in ${n} over ${k} packets: ${result.coveragePercent} vs ${coverage(n, k)}`);
}

// Unsampled traffic observes every flow and reports full coverage.
const full = run({ sampling: '1' });
assert.equal(full.coveragePercent, 100, 'no sampling sees every flow');
assert.equal(full.observedFlowsPerSecond, full.flowsPerSecond, 'no sampling observes every flow');
assert.equal(full.exportRecordsPerSecond, full.observedFlowsPerSecond, 'one record per observed flow');
assert.equal(full.warningCount, 0, 'an unsampled, high-coverage export needs no warning');

// Rates scale linearly with throughput and inversely with packets per flow.
const doubled = run({ throughput: '200' });
assert.ok(Math.abs(doubled.packetsPerSecond - 2 * sample.packetsPerSecond) <= 1, 'packets scale with throughput');
assert.ok(Math.abs(doubled.exportRecordsPerSecond - 2 * sample.exportRecordsPerSecond) < 0.002,
  'export records scale with throughput');
const bigger = run({ packetsPerFlow: '40' });
assert.ok(bigger.flowsPerSecond < sample.flowsPerSecond, 'more packets per flow means fewer flows');

// Derived quantities stay consistent with the reported rates.
for (const result of [sample, run({ sampling: '1' }), run({ throughput: '9.6', packetSize: '1200' })]) {
  const approxBits = result.exportRecordsPerSecond * result.recordSize * 8;
  assert.ok(Math.abs(result.exportBitsPerSecond - approxBits) <= 4 * result.recordSize,
    'bit rate follows records times record size');
  const approxBytes = result.exportRecordsPerSecond * result.recordSize * 86400;
  assert.ok(Math.abs(result.bytesPerDay - approxBytes) <= 86400 * result.recordSize,
    'daily volume follows records times record size');
  const approxStorage = result.bytesPerDay * result.retention / 1e9;
  assert.ok(Math.abs(result.storageGB - approxStorage) < 0.01, 'retained volume follows daily volume');
  const approxCache = result.observedFlowsPerSecond * result.activeTimeout;
  assert.ok(Math.abs(result.cacheEntries - approxCache) <= Math.max(1, approxCache * 0.001),
    'cache follows observed flows times the timeout');
}

// The packet rate identity: pps * 8 * packetSize == throughput * 1e6.
assert.ok(Math.abs(sample.packetsPerSecond * 8 * sample.packetSize - 100 * 1e6) < 1e6 * 0.0001,
  'packet rate identity');

// ---- Determinism: the same input returns the same object, and the input is untouched.
const frozen = Object.freeze(base());
const first = C.run(frozen);
const second = C.run(frozen);
assert.deepEqual(first, second, 'repeated calls agree');
assert.equal(frozen.throughput, '100', 'the input object is not modified');
assert.equal(typeof C.run({ throughput: 100, packetSize: 500, packetsPerFlow: 20, sampling: 1,
  activeTimeout: 60, recordSize: 200, retention: 30 }).exportRecordsPerSecond, 'number',
  'numeric values are accepted as well as strings');

// ---- Page contract: labelled fields, announced results, no outbound requests.
assert.ok(/<form id="flow-form"/.test(html), 'form present');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
for (const id of ['in-throughput', 'in-packet', 'in-perflow', 'in-sampling', 'in-timeout', 'in-record', 'in-retention']) {
  assert.ok(new RegExp(`<label class="f" for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/app.js'), 'shared assets');
assert.ok(!/https?:\/\//.test(html), 'the page itself makes no external reference');
assert.ok(!/\son(click|change|input|submit|load|error|focus|blur|keydown|keyup)\s*=/.test(html), 'no inline event handlers');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no dynamic code evaluation');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(/<button class="primary" type="submit">/.test(html), 'a submit button');
assert.ok(/id="reset"/.test(html), 'a reset button');
assert.ok(/id="copy"/.test(html), 'a copy button');
assert.ok(!/class="back"|← All tools/.test(html), 'navigation stays in the shared shell');

console.log('netflow export sizing suite ok');
