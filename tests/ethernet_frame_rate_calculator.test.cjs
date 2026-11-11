/* Ethernet frame rate calculator: replay catalog fixtures, compare against an
   exact rational model of the IEEE 802.3 wire budget, pin the published
   frames-per-second anchors and check the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ethernet-frame-rate-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* ethernet-frame-core:start */');
const end = html.indexOf('/* ethernet-frame-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = EthernetFrameCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Ethernet Frame Rate Calculator');
assert.equal(entry.category, 'Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the wire budget and limits');
assert.ok(entry.sources.length >= 3);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 31, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 9);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 9);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 13);

function failure(input) {
  try { C.frame(input.rate, input.unit, input.payload, input.vlans); } catch (error) { return error.message; }
  return null;
}

const close = (actual, expected, label, scale = 1e-6) => {
  const tolerance = Math.max(Math.abs(expected), 1) * scale;
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
};

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    assert.throws(() => C.compute(testCase.input), testCase.name + ' via compute');
    continue;
  }
  const model = C.compute(testCase.input);
  const result = model.result;
  for (const [field, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'boolean' || Number.isInteger(expected) && field !== 'framesPerSecond'
        && field !== 'payloadBps' && field !== 'l2Bps' && field !== 'frameTimeNs' && field !== 'efficiency') {
      assert.equal(result[field], expected, testCase.name + ' ' + field);
    } else {
      close(result[field], expected, testCase.name + ' ' + field);
    }
  }
  assert.equal(model.rows.length, 9, testCase.name + ' table rows');
  const current = model.rows.filter((row) => row.current);
  assert.equal(current.length, Array.from(C.tableSizes).includes(result.payloadBytes) ? 1 : 0,
    testCase.name + ' current row');
  if (current.length) assert.equal(current[0].payloadBytes, result.payloadBytes, testCase.name + ' current row payload');
}

// Independent wire budget in exact integer arithmetic, mirroring the standard:
// 8 preamble/SFD + 14 header + 4/tag + payload + 4 FCS + 12 IFG, 64-byte minimum.
const RATES_KBPS = [1, 10000, 100000, 1000000, 2500000, 5000000, 10000000, 25000000, 40000000,
  50000000, 100000000, 400000000, 1600000000];
const PAYLOADS = [1, 18, 42, 46, 47, 64, 65, 128, 256, 512, 576, 1024, 1280, 1500, 1501, 2048, 9000, 65535];
let checks = 0;
for (const kbps of RATES_KBPS) {
  const rateText = String(kbps / 1000);
  for (const vlans of [0, 1, 2]) {
    for (const payload of PAYLOADS) {
      const model = C.compute({ rate: rateText, unit: 'mbps', payload, vlans });
      const r = model.result;
      const frameBytes = 14 + 4 * vlans + payload + 4;
      const l2Bytes = Math.max(frameBytes, 64);
      const wireBytes = 8 + l2Bytes + 12;
      assert.equal(r.frameBytes, frameBytes);
      assert.equal(r.l2Bytes, l2Bytes);
      assert.equal(r.wireBytes, wireBytes);
      assert.equal(r.paddingBytes, l2Bytes - frameBytes);
      assert.equal(r.overheadBytes, wireBytes - payload);
      assert.equal(r.jumbo, payload > 1500);
      // pps × wire bits must reproduce the line rate exactly.
      close(r.framesPerSecond * wireBytes * 8, kbps * 1000, 'line rate identity');
      // payload throughput is the line rate scaled by payload/wire bytes.
      close(r.payloadBps, (kbps * 1000) * payload / wireBytes, 'payload throughput identity');
      close(r.l2Bps, (kbps * 1000) * l2Bytes / wireBytes, 'l2 throughput identity');
      close(r.efficiency * wireBytes, payload, 'efficiency identity');
      close(r.frameTimeNs * r.framesPerSecond, 1e9, 'frame time identity');
      assert.equal(r.framesPerSecondWhole, Math.floor(r.framesPerSecond));
      checks += 1;
    }
  }
}

// Published figures: 64-byte frames carry 1.488 Mpps at 1 GbE and 14.88 Mpps at
// 10 GbE; 1,500-byte payloads carry 81,274 pps at 1 GbE.
const gigabit = C.compute({ rate: '1', unit: 'gbps', payload: 46, vlans: 0 }).result;
assert.equal(gigabit.wireBytes, 84);
close(gigabit.framesPerSecond, 1488095.238095238, '1 GbE minimum frame rate');
close(gigabit.payloadBps, 547619047.6190476, '1 GbE minimum frame payload rate');
close(gigabit.efficiency, 46 / 84, '1 GbE minimum frame efficiency');
const tenGig = C.compute({ rate: '10', unit: 'gbps', payload: 46, vlans: 0 }).result;
close(tenGig.framesPerSecond, 14880952.380952381, '10 GbE minimum frame rate');
const fifteenHundred = C.compute({ rate: '1', unit: 'gbps', payload: 1500, vlans: 0 }).result;
assert.equal(fifteenHundred.wireBytes, 1538);
close(fifteenHundred.framesPerSecond, 81274.38231469441, '1 GbE 1,500-byte frame rate');
close(fifteenHundred.payloadBps, 975292587.7763445, '1 GbE 1,500-byte payload rate');
close(fifteenHundred.efficiency, 1500 / 1538, '1 GbE 1,500-byte efficiency');
close(fifteenHundred.frameTimeNs, 12304, '1 GbE 1,500-byte frame time');
// A tag costs 4 bytes and a jumbo payload leaves the standard size.
const tagged = C.compute({ rate: '1', unit: 'gbps', payload: 1500, vlans: 1 }).result;
assert.equal(tagged.wireBytes, fifteenHundred.wireBytes + 4);
assert.equal(tagged.frameBytes, 1522);
assert.equal(C.parseRate('2.5', 'gbps'), 2500000);
assert.equal(C.parseRate('0.001', 'mbps'), 1);
assert.equal(C.parseRate('1600', 'gbps'), 1600000000);
assert.equal(C.parsePayload('46'), 46);
assert.equal(C.parseVlans(2), 2);

// Defaults, table and validation edges.
const defaults = C.compute({}).result;
assert.equal(defaults.linkBits, 1e9);
assert.equal(defaults.payloadBytes, 1500);
assert.equal(defaults.vlanTags, 0);
assert.equal(defaults.framesPerSecondWhole, 81274);
assert.deepEqual(Array.from(C.tableSizes), [46, 64, 100, 128, 256, 512, 1024, 1500, 9000]);
assert.equal(failure({ rate: '1.5.0', unit: 'gbps', payload: 1500, vlans: 0 }),
  'Enter a link rate as a number, for example 1 or 2.5.');
assert.equal(failure({ rate: ' 2.5 ', unit: 'gbps', payload: 10, vlans: 0 }), null);
assert.equal(failure({ rate: '1', unit: 'gbps', payload: '01500', vlans: 0 }), null);
assert.equal(C.parsePayload(' 42 '), 42);
assert.equal(failure({ rate: '1', unit: 'gbps', payload: 1500, vlans: 0 }), null);
assert.equal(failure({ rate: '1', unit: 'gbps', payload: 1500, vlans: '' }), 'VLAN tags must be 0, 1 or 2.');
assert.equal(failure({ rate: '1', unit: 'gbps', payload: 1500, vlans: 0.5 }), 'VLAN tags must be 0, 1 or 2.');
assert.equal(failure({ rate: '1', unit: 'gbps', payload: 1500, vlans: 4 }), 'VLAN tags must be 0, 1 or 2.');
assert.equal(failure({ rate: '1.234', unit: 'mbps', payload: 64, vlans: 0 }), null);
assert.equal(failure({ rate: '1.2345', unit: 'mbps', payload: 64, vlans: 0 }),
  'Link rate must be a whole number of kb/s.');
assert.equal(failure({ rate: '1.000001', unit: 'gbps', payload: 64, vlans: 0 }), null);
assert.equal(failure({ rate: '1600.001', unit: 'gbps', payload: 64, vlans: 0 }),
  'Link rate must be at most 1,600 Gb/s (1,600,000 Mb/s).');

// Page contract: shared shell, accessible controls, no foreign or unsafe APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|navigator\.sendBeacon/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="rate"') && html.includes('for="rate-unit"') && html.includes('for="vlans"') && html.includes('for="payload"'), 'input labels missing');
assert.ok(html.includes('aria-describedby="rate-help"') && html.includes('aria-describedby="payload-help"'), 'help references missing');
assert.ok(html.includes('<form id="frame-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('<caption>'), 'table caption missing');
assert.equal((html.match(/scope="col"/g) || []).length, 5, 'five column headers');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
const ids = new Set([...html.matchAll(/id="([a-z0-9-]+)"/g)].map((match) => match[1]));
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(ids.has(match[1]), 'script references missing id ' + match[1]);
const vlanOptions = [...html.matchAll(/<option value="([0-9])"( selected)?>/g)].map((match) => match[1]);
assert.deepEqual(vlanOptions, ['0', '1', '2'], 'VLAN options');
assert.ok(html.includes('<option value="gbps" selected>Gb/s</option>'), 'Gb/s default');
assert.ok(html.includes('<option value="mbps">Mb/s</option>'), 'Mb/s option');
assert.ok(html.includes('id="rate" type="number"') && html.includes('value="1"'), 'rate default');
assert.ok(html.includes('id="payload" type="number"') && html.includes('value="1500"'), 'payload default');

console.log(`ethernet-frame-rate-calculator: 31 catalog cases, ${checks} exact wire-budget checks and published anchors passed`);
