/* NTP clock offset: the RFC 5905 formulas against an independent simulation of
   an exchange, the offset/delay invariants, validation messages, the catalog
   record and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ntp-offset-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ntp-core:start */';
const endMarker = '/* ntp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = NtpCore;', sandbox);
const C = sandbox.module.exports;

const failure = (fn) => {
  try { fn(); } catch (error) { return error.message; }
  return null;
};
const close = (got, expected, label, tolerance = 1e-9) =>
  assert.ok(Math.abs(got - expected) <= tolerance, label + ': got ' + got + ', expected ' + expected);
const run = (input) => C.compute(input);
const base = { t1: '1700000000', t2: '1700000000.0125', t3: '1700000000.0126', t4: '1700000000.0255' };
const withInput = (patch) => Object.assign({}, base, patch);

// ---- Constants: 12 decimal places of input, 1e12 seconds of range.
assert.equal(C.DECIMAL_LIMIT, 12);
assert.equal(C.MAX_SECONDS.toString(), '1000000000000');
assert.equal(C.SCALE.toString(), '1000000000000');

// ---- The RFC 5905 section 8 definition, checked against a simulated exchange.
// Each vector is built from a true send instant, the client error c, the server
// error s and the one-way delays d1, d2, d3:
//   T1 = ta + c, T2 = ta + d1 + s, T3 = ta + d1 + d2 + s, T4 = ta + d1 + d2 + d3 + c
// so the offset must come out at s - c + (d1 - d3) / 2 and the delay at d1 + d3.
const pinned = [
  ['server 25 ms ahead over a symmetric 20 ms path',
    { t1: '100', t2: '100.035', t3: '100.037', t4: '100.022' }, 0.025, 0.02, 100.047],
  ['client 1.5 s fast, so the server stamps precede the request',
    { t1: '501.5', t2: '500.06', t3: '500.061', t4: '501.62' }, -1.4995, 0.119, 500.1205],
  ['a 250 microsecond offset over an 8 microsecond path',
    { t1: '0', t2: '0.00000425', t3: '0.00000525', t4: '0.000009' }, 2.5e-7, 8e-6, 9.25e-6],
  ['a Unix epoch exchange with an asymmetric path',
    { t1: '1763000000.000123456', t2: '1763000000.016210988', t3: '1763000000.020210988', t4: '1763000000.034123456' },
    0.001087532, 0.03, 1763000000.035211],
];
for (const [label, input, offset, delay, serverAtT4] of pinned) {
  const result = run(input);
  close(result.offset, offset, label + ' offset');
  close(result.delay, delay, label + ' delay');
  close(result.oneWay, delay / 2, label + ' one-way');
  close(result.serverAtT4Ps >= 0n ? Number(result.serverAtT4Ps) / 1e12 : NaN, serverAtT4,
    label + ' server clock at T4', 1e-6);
  assert.equal(result.ahead, offset > 0, label + ' direction');
}

// ---- The definitions recomputed in the test from the BigInt picoseconds.
for (const input of [base, { t1: '0', t2: '5', t3: '5', t4: '1' }, { t1: '2', t2: '2.2', t3: '2.4', t4: '2.7' }]) {
  const result = run(input);
  const t = [result.t1Ps, result.t2Ps, result.t3Ps, result.t4Ps];
  assert.equal(result.delayPs, (t[3] - t[0]) - (t[2] - t[1]), 'delay is (T4 - T1) - (T3 - T2)');
  assert.equal(result.roundTripPs, t[3] - t[0], 'round trip is T4 - T1');
  assert.equal(result.dwellPs, t[2] - t[1], 'dwell is T3 - T2');
  assert.equal(result.serverAtT4Ps, t[3] + result.offsetPs, 'the server reading at T4 is T4 + offset');
  close(result.offset, Number(result.offsetPs) / 1e12, 'the offset in seconds matches the integer');
  close(result.oneWay, result.delay / 2, 'one-way is half the delay', 1e-12);
}

// ---- Each clock's origin shifts the offset by exactly that amount and leaves
// the delay alone; only the differences inside each clock's pair matter.
const shiftedClient = run({ t1: '900', t2: '900.0125', t3: '900.0126', t4: '900.0255' });
close(shiftedClient.offset, -0.0002, 'a common origin leaves the offset alone');
close(shiftedClient.delay, 0.0254, 'the delay survives the change of origin');
const shiftedServer = run({ t1: '100', t2: '100.0125', t3: '100.0126', t4: '100.0255' });
close(shiftedServer.offset, -0.0002, 'a common origin on the server side too');
const clientLater = run({ t1: '500', t2: '1700000000.0125', t3: '1700000000.0126', t4: '500.0255' });
close(clientLater.delay, 0.0254, 'the delay ignores the client origin');
const serverLater = run({ t1: '500', t2: '700.0125', t3: '700.0126', t4: '500.0255' });
close(serverLater.delay, 0.0254, 'the delay ignores the server origin');
assert.equal(BigInt(serverLater.offsetPs) - BigInt(clientLater.offsetPs),
  BigInt(-(1700000000 - 700)) * 1000000000000n, 'the offset is the difference between the readings');

// ---- The page's example exchange.
const example = run(base);
close(example.offset, -0.0002, 'the example offset is 200 microseconds behind');
close(example.delay, 0.0254, 'the example delay');
assert.equal(C.formatPs(example.offsetPs, 9), '-0.000200000', 'the exact offset string');
assert.equal(C.formatPs(example.serverAtT4Ps, 6), '1700000000.025300', 'the server reading at T4');

// ---- An echo: four identical readings give no offset and no delay.
const echo = run({ t1: '42.5', t2: '42.5', t3: '42.5', t4: '42.5' });
assert.equal(echo.offset, 0);
assert.equal(echo.delay, 0);
assert.equal(echo.ahead, false);

// ---- Twelve decimal places are honoured; longer input is rounded to them.
const precise = run({ t1: '1.000000000001', t2: '1.000000004001', t3: '1.000000005001', t4: '1.000000009001' });
close(precise.delay, 8e-9, 'nanoseconds survive the 12 decimal parse', 1e-12);
assert.equal(C.parse('1.1234567890123', 'T1', 'the time the request was sent').toString(), '1123456789012',
  'a thirteenth decimal is rounded away');
assert.equal(C.parse('1,5', 'T1', 'the time the request was sent').toString(), '1500000000000',
  'commas are accepted as decimal separators');

// ---- Formatting stays exact and signed.
assert.equal(C.formatPs(1500000000000n, 9), '1.500000000');
assert.equal(C.formatPs(-1500000000000n, 3), '-1.500');
assert.equal(C.formatPs(0n, 9), '0.000000000');
assert.equal(C.formatPs(-1n, 4), '0.0000');

// ---- Validation messages, exactly as the page shows them.
assert.equal(failure(() => run(withInput({ t1: '' }))), 'Enter T1, the time the request was sent.');
assert.equal(failure(() => run(withInput({ t2: '' }))), 'Enter T2, the time the server received it.');
assert.equal(failure(() => run(withInput({ t3: '' }))), 'Enter T3, the time the server sent the reply.');
assert.equal(failure(() => run(withInput({ t4: '' }))), 'Enter T4, the time the reply arrived.');
assert.equal(failure(() => run(withInput({ t1: 'abc' }))), 'T1 must be a number of seconds.');
assert.equal(failure(() => run(withInput({ t2: '1e3' }))), 'T2 must be a number of seconds.');
assert.equal(failure(() => run(withInput({ t4: '1.2.3' }))), 'T4 must be a number of seconds.');
assert.equal(failure(() => run(withInput({ t3: '-1' }))), 'T3 must be between 0 and 1,000,000,000,000 seconds.');
assert.equal(failure(() => run(withInput({ t1: '1000000000001' }))),
  'T1 must be between 0 and 1,000,000,000,000 seconds.');
assert.equal(failure(() => run(withInput({ t4: '1699999999' }))),
  'T4 cannot be earlier than T1: the reply cannot arrive before the request was sent.');
assert.equal(failure(() => run(withInput({ t2: '1700000000.02', t3: '1700000000.01' }))),
  'T3 cannot be earlier than T2: the server cannot send the reply before it received the request.');
assert.equal(failure(() => run({ t1: '0', t2: '0.1', t3: '0.5', t4: '0.2' })),
  'The round-trip delay works out negative, so these four timestamps cannot come from one exchange. '
  + 'Check that T1 and T4 are from your clock and T2 and T3 from the server\'s.');
assert.equal(failure(() => run({ t1: '0', t2: '0', t3: '0.0064', t4: '0' })),
  'The round-trip delay works out negative, so these four timestamps cannot come from one exchange. '
  + 'Check that T1 and T4 are from your clock and T2 and T3 from the server\'s.');
assert.equal(failure(() => run(null)), 'Enter T1, the time the request was sent.');
assert.equal(failure(() => run({})), 'Enter T1, the time the request was sent.');

// ---- Catalog record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'NTP Offset Calculator');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.tags.includes('ntp'), 'the protocol tag');
assert.ok(record.aliases.some((alias) => /clock offset/i.test(alias)), 'the clock offset alias');
assert.equal(record.sources.length, 2, 'two sources');
assert.ok(record.sources[0].url.startsWith('https://www.rfc-editor.org/'), 'cites RFC 5905');
assert.ok(record.sources[1].url.startsWith('https://www.ntp.org/'), 'cites the NTP documentation');
assert.ok(record.method.includes('(T2 - T1) + (T3 - T4)'), 'method states the offset formula');
assert.ok(record.method.includes('(T4 - T1) - (T3 - T2)'), 'method states the delay formula');
assert.ok(record.description.length > 80 && record.description.endsWith('browser.'),
  'the description says the page runs locally');
assert.ok(record.testCases.length >= 20, 'the catalog carries the test cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug is unique');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'the name is unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 50, 'Time count');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2120, 'public tools');

// ---- Replay every case stored in the record.
for (const item of record.testCases) {
  if (item.kind === 'validation') {
    assert.equal(failure(() => run(item.input)), item.expected.error, 'replay ' + item.name);
    continue;
  }
  const got = run(item.input);
  for (const field of ['offset', 'delay', 'oneWay']) {
    if (item.expected[field] !== undefined) close(got[field], item.expected[field], 'replay ' + item.name + ' ' + field);
  }
}

// ---- Page contract.
assert.ok(html.includes('<div id="site-header"></div>'), 'the shared header mount is present');
assert.ok(html.includes('/assets/app.js'), 'the shared shell script is loaded');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is loaded');
assert.ok(!/https?:\/\//.test(html), 'the page makes no third-party request');
assert.ok(!html.includes('\u0000'), 'no NUL bytes');
assert.ok(html.includes('<h1>NTP Offset Calculator</h1>'), 'the page heading');
assert.ok(html.includes('RFC 5905'), 'the note names the standard');
assert.ok(html.includes('Nothing is uploaded'), 'the note stays local');
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const control of ['t1', 't2', 't3', 't4']) {
  assert.ok(new RegExp('<label\\b[^>]*\\bfor="' + control + '"').test(html), 'label for ' + control);
  assert.ok(ids.includes(control), 'control id ' + control);
}
for (const id of ['ntp-form', 'err', 'out', 'facts']) {
  assert.ok(ids.includes(id), 'element id ' + id);
}
assert.equal((html.match(/inputmode="decimal"/g) || []).length, 4, 'numeric keyboards on all four fields');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external script');

console.log('ntp offset calculator: all checks passed');
