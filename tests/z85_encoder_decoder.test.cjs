/* Z85 codec: replay catalog fixtures, pin the ZeroMQ RFC vector, and compare
   random groups with a fixed-divisor independent reference implementation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'z85-encoder-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* z85-core:start */');
const end = html.indexOf('/* z85-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = Z85Core;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Z85 Encoder / Decoder');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 600, 'method must document byte order and limits');
assert.equal(entry.sources.length, 2);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 19, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 5);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 11);

function failure(input) {
  try { C.run(input); } catch (error) { return error.message; }
  return null;
}
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
  assert.equal(result.bytes.length % 4, 0, testCase.name + ' byte groups');
  assert.equal(result.z85.length % 5, 0, testCase.name + ' character groups');
  assert.equal(result.groups * 4, result.bytes.length, testCase.name + ' group byte count');
  assert.equal(result.groups * 5, result.z85.length, testCase.name + ' group character count');
  if (result.mode === 'encode') {
    assert.equal(C.decode(result.output).length, result.inputUnits, testCase.name + ' decode length');
    assert.equal(C.hex(C.decode(result.output)), C.hex(C.parseHex(testCase.input.input)), testCase.name + ' round trip');
  } else {
    assert.equal(C.encode(result.bytes), testCase.input.input, testCase.name + ' round trip');
  }
}

// The markup sample and the core default must not drift apart.
const sampleStart = html.indexOf('<textarea id="input"');
const sample = html.slice(html.indexOf('>', sampleStart) + 1, html.indexOf('</textarea>', sampleStart));
assert.equal(C.run({ input: sample }).output, C.run({}).output, 'default sample differs');

// ZeroMQ RFC 32's published eight-byte example, independently pinned.
assert.equal(C.run({ mode: 'encode', input: '86 4F D2 6F B5 59 F7 5B' }).output, 'HelloWorld');
assert.equal(C.run({ mode: 'decode', input: 'HelloWorld' }).output, '864FD26FB559F75B');
assert.equal(C.alphabet, '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#');
assert.equal(C.alphabet.length, 85);
assert.equal(new Set(C.alphabet).size, 85);

// Independent encoder: fixed powers and division at each digit, rather than
// the page core's repeated modulo/division loop.
const DIVISORS = [52200625n, 614125n, 7225n, 85n, 1n];
function referenceEncode(bytes) {
  let output = '';
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const word = BigInt(bytes[offset]) * 16777216n + BigInt(bytes[offset + 1]) * 65536n + BigInt(bytes[offset + 2]) * 256n + BigInt(bytes[offset + 3]);
    for (const divisor of DIVISORS) output += C.alphabet[Number((word / divisor) % 85n)];
  }
  return output;
}
let seed = 0x85c0de;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; }
for (let index = 0; index < 2000; index += 1) {
  const bytes = [];
  const groups = 1 + index % 16;
  for (let i = 0; i < groups * 4; i += 1) bytes.push(random() & 255);
  const expected = referenceEncode(bytes);
  const encoded = C.encode(bytes);
  assert.equal(encoded, expected, 'independent encoding vector ' + index);
  assert.deepEqual(Array.from(C.decode(encoded)), bytes, 'independent decoding vector ' + index);
  assert.equal(C.run({ mode: 'encode', input: C.hex(bytes) }).output, expected, 'hex parser vector ' + index);
}
assert.equal(C.encode([0, 0, 0, 0]), '00000');
assert.equal(C.encode([255, 255, 255, 255]), '%nSc0');
assert.equal(failure({ mode: 'decode', input: '%nSc1' }), 'Z85 group 1 exceeds the maximum 32-bit value.');
assert.equal(failure({ mode: 'decode', input: '0000\n' }), 'Invalid Z85 character at position 5.');
assert.equal(failure({ mode: 'decode', input: '0000 ' }), 'Invalid Z85 character at position 5.');
assert.throws(() => C.encode([0, 0, 0]));
assert.throws(() => C.encode([0, 0, 0, 256]));
assert.throws(() => C.encode([0, 0, 0, -1]));
assert.equal(C.encode([]), '', 'the mathematical empty frame remains empty at the API boundary');
assert.equal(C.hex(C.parseHex('00\r\nff\t10 20')), '00FF1020');

// Page contract: shared shell, accessible controls and no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="input"'), 'input label missing');
assert.ok(html.includes('aria-describedby="input-help"'), 'help reference missing');
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'script references missing id ' + match[1]);
}
assert.ok(html.includes('<form id="codec-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('id="output" readonly'), 'read-only output missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');

console.log('z85-encoder-decoder: 19 catalog cases, published RFC vector, and 2000 independent round trips passed');
