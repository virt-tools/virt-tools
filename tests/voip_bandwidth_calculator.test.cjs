/* Regression checks for the VoIP bandwidth core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'voip-bandwidth-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* voip-bandwidth-core:start */');
const end = html.indexOf('/* voip-bandwidth-core:end */');
assert.ok(start > -1 && end > start, 'voip bandwidth core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = VoipBandwidth;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F4DE}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 800, 'method documented');
assert.equal(catalog.tools.length, 2304, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 46, 'Networking count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /voip|voice over ip|rtp bandwidth|codec bandwidth|call bandwidth/i
    .test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))), 'no other VoIP bandwidth tool');

const failure = (input) => {
  try {
    C.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const close = (left, right, label, tolerance = 1e-9) => {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  assert.ok(Math.abs(Number(left) - Number(right)) <= tolerance * scale, `${label}: ${left} != ${right}`);
};

// --- Constants and conventions. ---
assert.deepEqual(Object.keys(C.CODECS).sort(), ['g711', 'g722', 'g726', 'g729']);
assert.deepEqual([C.CODECS.g711.kbps, C.CODECS.g722.kbps, C.CODECS.g726.kbps, C.CODECS.g729.kbps], [64, 64, 32, 8]);
assert.deepEqual([C.CODECS.g729.minPtime, C.CODECS.g729.step], [10, 10]);
assert.deepEqual([C.IP_VERSIONS.ipv4.bytes, C.IP_VERSIONS.ipv6.bytes], [20, 40]);
assert.deepEqual([C.LAYERS.ethernet.bytes, C.LAYERS['ethernet-preamble'].bytes, C.LAYERS.none.bytes], [18, 38, 0]);
assert.deepEqual([C.RTP_BYTES, C.UDP_BYTES], [12, 8]);
assert.deepEqual(Array.from(C.ROWS), [10, 20, 30, 40]);
assert.deepEqual([C.BOUNDS.ptime.min, C.BOUNDS.ptime.max], [5, 120]);
assert.deepEqual([C.BOUNDS.capacity.min, C.BOUNDS.capacity.max], [0.1, 100000]);
assert.deepEqual([C.OVERHEAD_LOW, C.OVERHEAD_HIGH], [0.5, 0.7]);
assert.equal(C.COMPARE_CODEC, 'g711');
assert.equal(C.classify(0.4999).key, 'payload');
assert.equal(C.classify(0.5).key, 'balanced');
assert.equal(C.classify(0.7).key, 'balanced');
assert.equal(C.classify(0.7001).key, 'header-heavy');
assert.equal(C.sig(87.2), '87.2');
assert.equal(C.sig(174400 / 1000), '174');
assert.equal(C.sig(33.333333), '33.3');
assert.equal(C.rateText(87200), '87.2 kb/s');
assert.equal(C.rateText(174400), '174 kb/s');
assert.equal(C.rateText(9520000), '9.52 Mb/s');
assert.equal(C.rateText(400), '400 b/s');
assert.equal(C.percentText(0.2660550458715596), '26.6%');
assert.equal(C.callCount(10, 174400), 57);
assert.equal(C.callCount(0.1, 174400), 0);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expected.error, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = C.compute(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.codec, expected.codec, `${testCase.name}: codec echoed`);
  assert.equal(result.ptime, expected.ptime, `${testCase.name}: packet time echoed`);
  assert.equal(result.ip, expected.ip, `${testCase.name}: IP echoed`);
  assert.equal(result.layer, expected.layer, `${testCase.name}: layer echoed`);
  assert.equal(result.payloadBytes, expected.payloadBytes, `${testCase.name}: payload bytes`);
  assert.equal(result.headerBytes, expected.headerBytes, `${testCase.name}: header bytes`);
  assert.equal(result.l2Bytes, expected.l2Bytes, `${testCase.name}: layer 2 bytes`);
  assert.equal(result.l3Bytes, expected.l3Bytes, `${testCase.name}: layer 3 bytes`);
  assert.equal(result.wireBytes, expected.wireBytes, `${testCase.name}: wire bytes`);
  close(result.pps, expected.pps, `${testCase.name}: packets per second`);
  close(result.l3Bps, expected.l3Bps, `${testCase.name}: layer 3 rate`);
  close(result.wireBps, expected.wireBps, `${testCase.name}: wire rate`);
  close(result.bidirBps, expected.bidirBps, `${testCase.name}: both directions`);
  close(result.overheadShare, expected.overheadShare, `${testCase.name}: overhead share`);
  assert.equal(result.calls, expected.calls, `${testCase.name}: calls on link`);
  assert.equal(result.compareCalls, expected.compareCalls, `${testCase.name}: G.711 comparison`);
  assert.equal(result.verdict.key, expected.verdict, `${testCase.name}: verdict`);
  assert.equal(result.rows.length, expected.rows.length, `${testCase.name}: table rows`);
  for (let index = 0; index < expected.rows.length; index += 1) {
    const row = result.rows[index];
    const want = expected.rows[index];
    assert.equal(row.ptime, want.ptime, `${testCase.name}: row ${index} packet time`);
    close(row.pps, want.pps, `${testCase.name}: row ${index} packets per second`);
    assert.equal(row.payloadBytes, want.payloadBytes, `${testCase.name}: row ${index} payload`);
    assert.equal(row.wireBytes, want.wireBytes, `${testCase.name}: row ${index} wire bytes`);
    close(row.wireBps, want.wireBps, `${testCase.name}: row ${index} wire rate`);
    assert.equal(row.isTarget, want.isTarget, `${testCase.name}: row ${index} highlight`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 13, 'expected thirteen validation cases');

// --- Three hundred generated configurations against the algebra. ---
let seed = 20261114n;
const MOD = 2147483648n;
const random = () => {
  seed = (seed * 1103515245n + 12345n) % MOD;
  return Number(seed) / 2147483648;
};
const codecKeys = Object.keys(C.CODECS);
const ipKeys = Object.keys(C.IP_VERSIONS);
const layerKeys = Object.keys(C.LAYERS);
let sweeps = 0;
for (let index = 0; index < 300; index += 1) {
  const codec = codecKeys[index % codecKeys.length];
  const spec = C.CODECS[codec];
  const steps = Math.floor((spec.maxPtime - spec.minPtime) / spec.step) + 1;
  const ptime = spec.minPtime + spec.step * Math.floor(random() * steps);
  const ip = ipKeys[Math.floor(random() * ipKeys.length)];
  const layer = layerKeys[Math.floor(random() * layerKeys.length)];
  const capacity = Number((0.1 + random() * 999.9).toFixed(2));
  const result = C.compute({
    codec: codec, ptime: String(ptime), ip: ip, layer: layer, capacity: String(capacity)
  });

  // Payload, header and frame arithmetic.
  assert.equal(result.payloadBytes, (spec.kbps * ptime) / 8, 'payload bytes follow the codec rate');
  assert.equal(result.headerBytes, 12 + 8 + C.IP_VERSIONS[ip].bytes, 'header bytes');
  assert.equal(result.l3Bytes, result.payloadBytes + result.headerBytes, 'layer 3 length');
  assert.equal(result.wireBytes, result.l3Bytes + C.LAYERS[layer].bytes, 'frame length');
  close(result.pps, 1000 / ptime, 'packets per second');
  close(result.payloadBps, result.payloadBytes * 8 * result.pps, 'payload rate');
  close(result.l3Bps, result.l3Bytes * 8 * result.pps, 'layer 3 rate');
  close(result.wireBps, result.wireBytes * 8 * result.pps, 'wire rate');
  close(result.bidirBps, 2 * result.wireBps, 'both directions');
  close(result.overheadShare, (result.wireBytes - result.payloadBytes) / result.wireBytes, 'overhead share');
  assert.equal(result.calls, Math.floor((capacity * 1e6) / result.bidirBps), 'call count');
  assert.equal(result.verdict.key, C.classify(result.overheadShare).key, 'verdict follows the overhead');
  assert.ok(/^(0|[1-9]\d*)(\.\d+)? (b\/s|kb\/s|Mb\/s|Gb\/s)$/.test(C.rateText(result.wireBps)), 'rate text form');
  assert.ok(/^(0|[1-9]\d*)(\.\d+)?%$/.test(C.percentText(result.overheadShare)), 'percent text form');

  // The comparison figure is G.711 at the same packet time and framing.
  const g711 = C.compute({ codec: 'g711', ptime: String(ptime), ip: ip, layer: layer, capacity: String(capacity) });
  assert.equal(result.compareCalls, g711.calls, 'comparison uses G.711');
  assert.ok(result.calls >= result.compareCalls, 'G.729 never fits fewer calls than G.711');
  if (codec === 'g722') {
    assert.equal(result.wireBytes, g711.wireBytes, 'G.722 and G.711 packetise identically');
  }

  // Table rows: legal packet times, sorted, exactly one highlighted row.
  const legal = Array.from(new Set([10, 20, 30, 40, ptime]))
    .filter((value) => value >= spec.minPtime && value <= spec.maxPtime && value % spec.step === 0)
    .sort((left, right) => left - right);
  assert.deepEqual(Array.from(result.rows, (row) => row.ptime), legal, 'table packet times');
  assert.equal(result.rows.filter((row) => row.isTarget).length, 1, 'one highlighted row');
  for (const row of result.rows) {
    assert.equal(row.wireBytes, result.payloadBytes + result.headerBytes + C.LAYERS[layer].bytes +
      (spec.kbps * row.ptime) / 8 - result.payloadBytes, `row ${row.ptime} length`);
  }
  assert.equal(result.notes.length, 6 + result.warnings.length, 'notes plus warnings');
  assert.equal(result.warnings.length, Number(result.calls === 0) +
    Number(result.overheadShare >= 0.7), 'warning rows');
  sweeps += 1;
}
assert.equal(sweeps, 300, 'three hundred generated configurations');

// --- Behaviour the sweep cannot reach reliably. ---
const desk = C.compute({});
assert.equal(desk.codec, 'g711');
assert.equal(desk.wireBytes, 218);
assert.equal(C.rateText(desk.wireBps), '87.2 kb/s');
assert.equal(C.rateText(desk.l3Bps), '80.0 kb/s');
assert.equal(C.rateText(desk.bidirBps), '174 kb/s');
assert.equal(desk.calls, 57);
assert.equal(desk.verdict.key, 'payload');
assert.equal(C.percentText(desk.overheadShare), '26.6%');
assert.equal(desk.notes.length, 6);
assert.equal(desk.warnings.length, 0);

const g729 = C.compute({ codec: 'g729', ptime: '20', capacity: '2' });
assert.equal(C.percentText(g729.overheadShare), '74.4%');
assert.equal(g729.verdict.key, 'header-heavy');
assert.equal(g729.warnings.length, 1, 'a header-heavy packet warns once');
assert.ok(g729.warnings[0].includes('above 70%'), 'the warning names the threshold');
assert.equal(g729.calls, 32);
assert.equal(g729.compareCalls, 11);

const tiny = C.compute({ capacity: '0.1' });
assert.equal(tiny.calls, 0);
assert.equal(tiny.warnings.length, 1, 'a call that does not fit warns once');
assert.ok(tiny.warnings[0].includes('does not fit'), 'the warning says the call does not fit');

const long = C.compute({ ptime: '120' });
assert.equal(long.rows.length, 5, 'the table adds the chosen 120 ms row');
assert.equal(long.rows[4].ptime, 120);
assert.equal(long.rows[4].isTarget, true);
assert.ok(long.notes[2].includes('Packet time is the lever'), 'the note compares the shortest and longest packet');
assert.equal(long.wireBytes, 1018);
assert.equal(long.calls, 73);

const v6 = C.compute({ ip: 'ipv6', layer: 'none' });
assert.equal(v6.wireBytes, 220, 'IPv6 without layer 2 adds forty header bytes');
assert.equal(C.rateText(v6.wireBps), '88.0 kb/s');
assert.equal(v6.rows[1].isTarget, true);
assert.equal(v6.rows[1].ptime, 20);

assert.deepEqual(Object.keys(C.DEFAULTS).sort(), ['capacity', 'codec', 'ip', 'layer', 'ptime']);

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['codec', 'ptime', 'ip', 'layer', 'capacity', 'calculate', 'reset', 'voip-status',
  'ptime-body', 'notes', 'voip-note', 'mode-cap', 'level-cap', 'bandwidth-out', 'bandwidth-sub',
  'stat-payload', 'stat-headers', 'stat-pps', 'stat-l3', 'stat-bidir', 'stat-calls',
  'verdict-title', 'verdict-text', 'copy', 'copy-status']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="voip-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="g711" selected>/.test(html), 'G.711 selected by default');
assert.ok(/<option value="ipv4" selected>/.test(html), 'IPv4 selected by default');
assert.ok(/<option value="ethernet" selected>/.test(html), 'Ethernet framing selected by default');
assert.ok(/id="copy"[^>]*disabled/.test(html), 'copy starts disabled');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no runtime compilation');
assert.ok(!/\son[a-z]+\s*=/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no inline handlers');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} generated configurations agreed on the payload sizes, the header and framing arithmetic, the packet rate, ` +
  'the overhead share and verdict, the call count, the packet-time table and the page contract');
