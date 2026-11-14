/* Bencode codec: replay the catalog fixtures, then cross-check every direction
   against an independent Buffer-based reference parser and encoder. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bencode-encoder-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* bencode-core:start */');
const end = html.indexOf('/* bencode-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {}, TextEncoder, TextDecoder };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = BencodeCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2277, 'catalog total');
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Bencode Encoder / Decoder');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 600, 'method must document the grammar and limits');
assert.equal(entry.sources.length, 1);
assert.match(entry.sources[0].url, /^https:\/\/www\.bittorrent\.org\/beps\/bep_0003\.html$/);
assert.equal(entry.testCases.length, 21, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 7);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 4);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 10);

function plain(value) { return JSON.parse(JSON.stringify(value)); }
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
  assert.ok(result.nodes >= 1 && result.depth >= 1, testCase.name + ' shape');
  if (testCase.input.mode === 'encode') {
    assert.deepEqual(C.run({ input: result.output }).json, result.json, testCase.name + ' round trip');
  } else {
    const reencoded = C.run({ mode: 'encode', input: result.output });
    assert.equal(reencoded.output, testCase.input.input, testCase.name + ' canonical re-encoding');
  }
}

// The markup sample and the core default must not drift apart.
const sampleStart = html.indexOf('<textarea id="input"');
const sample = html.slice(html.indexOf('>', sampleStart) + 1, html.indexOf('</textarea>', sampleStart));
assert.equal(C.run({ input: sample }).output, C.run({}).output, 'default sample differs');
assert.equal(C.run({ mode: 'encode' }).output, C.DEFAULT_BENCODE, 'default JSON does not re-encode the sample');

// ---------------------------------------------------------------------------
// Independent reference implementation: a Buffer cursor that locates delimiters
// with indexOf() instead of stepping one byte at a time, and an encoder that
// measures with Buffer.byteLength instead of TextEncoder.
// ---------------------------------------------------------------------------
function refParse(text) {
  const buf = Buffer.from(text, 'utf8');
  let i = 0;
  function value() {
    if (i >= buf.length) throw new Error('reference: truncated');
    const marker = buf[i];
    if (marker === 0x69) {
      i += 1;
      const stop = buf.indexOf(0x65, i);
      if (stop < 0) throw new Error('reference: unterminated integer');
      const digits = buf.slice(i, stop).toString('latin1');
      if (!/^(?:0|-?[1-9][0-9]*)$/.test(digits)) throw new Error('reference: bad integer ' + digits);
      i = stop + 1;
      return Number(digits);
    }
    if (marker === 0x6c) {
      i += 1;
      const items = [];
      while (buf[i] !== 0x65) items.push(value());
      i += 1;
      return items;
    }
    if (marker === 0x64) {
      i += 1;
      const out = {};
      let keys = [];
      while (buf[i] !== 0x65) {
        const key = value();
        if (typeof key !== 'string') throw new Error('reference: non-string key');
        keys.push(key);
        out[key] = value();
      }
      i += 1;
      const sorted = keys.slice().sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
      if (keys.join('\u0000') !== sorted.join('\u0000')) throw new Error('reference: unsorted keys');
      return out;
    }
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) throw new Error('reference: missing colon');
    const length = Number(buf.slice(i, colon).toString('latin1'));
    i = colon + 1;
    const bytes = buf.slice(i, i + length);
    if (bytes.length !== length) throw new Error('reference: short string');
    i += length;
    return bytes.toString('utf8');
  }
  const parsed = value();
  if (i !== buf.length) throw new Error('reference: trailing data');
  return parsed;
}

function refEncode(value) {
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return String(bytes.length) + ':' + bytes.toString('utf8');
  }
  if (typeof value === 'number') return 'i' + String(value) + 'e';
  if (Array.isArray(value)) return 'l' + value.map(refEncode).join('') + 'e';
  const keys = Object.keys(value).sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  return 'd' + keys.map((key) => refEncode(key) + refEncode(value[key])).join('') + 'e';
}

assert.equal(refEncode({ b: 2, a: [1, 'x'] }), 'd1:ali1e1:xe1:bi2ee');
assert.deepEqual(refParse('d1:ali1e1:xe1:bi2ee'), { a: [1, 'x'], b: 2 });

// Deterministic corpus: integers, ASCII and multi-byte strings, nested lists and
// dictionaries, including empty containers and keys with shared prefixes.
let seed = 0x5eed1e;
function random() { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; }
const WORDS = ['a', 'ab', 'b', 'name', 'naïve', '€', 'zzz', '', 'piece length', '0', 'spam'];
function makeValue(depth) {
  const pick = random() % 10;
  if (depth <= 0 || pick < 4) return pick < 2 ? (random() % 4000001) - 2000000 : WORDS[random() % WORDS.length];
  if (pick < 6) {
    const items = [];
    const count = random() % 4;
    for (let n = 0; n < count; n += 1) items.push(makeValue(depth - 1));
    return items;
  }
  const out = {};
  const count = random() % 4;
  for (let n = 0; n < count; n += 1) out[WORDS[random() % WORDS.length]] = makeValue(depth - 1);
  return out;
}
for (let index = 0; index < 600; index += 1) {
  const value = makeValue(1 + (index % 4));
  const encoded = C.run({ mode: 'encode', input: JSON.stringify(value) }).output;
  assert.equal(encoded, refEncode(value), 'encoder mismatch at ' + index);
  assert.deepEqual(refParse(encoded), value, 'reference decode mismatch at ' + index);
  const decoded = C.run({ input: encoded });
  assert.deepEqual(plain(decoded.json), value, 'page decode mismatch at ' + index);
  assert.equal(decoded.kind, typeof value === 'object' ? (Array.isArray(value) ? 'list' : 'dict') : (typeof value === 'number' ? 'int' : 'bytes'));
  assert.equal(C.run({ mode: 'encode', input: decoded.output }).output, encoded, 'canonical re-encoding at ' + index);
}

// Raw byte strings that are not valid UTF-8 still parse and are shown as hex.
const binaryInput = new Uint8Array([0x64, 0x34, 0x3a, 0x6e, 0x61, 0x6d, 0x65, 0x35, 0x3a, 0x68, 0x65, 0x6c, 0x6c, 0x6f,
  0x36, 0x3a, 0x70, 0x69, 0x65, 0x63, 0x65, 0x73, 0x32, 0x3a, 0xff, 0xfe, 0x65]);
const binary = C.parse(binaryInput);
assert.equal(binary.root.kind, 'dict');
assert.deepEqual(plain(C.toJson(binary.root)), { name: 'hello', pieces: '0xFFFE' });
assert.equal(binary.nodes, 5);
assert.equal(binary.depth, 2);
assert.equal(C.displayText(new Uint8Array([0x80])), '0x80');
assert.equal(C.displayText(new Uint8Array([0xc3, 0xa9])), 'é');
assert.equal(C.hex(new Uint8Array([0, 15, 255])), '000FFF');

// Structural errors the catalog does not carry.
assert.equal(failure({ input: 'i42' }), "Integer at byte 0 is not closed with 'e'.");
assert.equal(failure({ input: 'ie' }), 'Integer at byte 0 has no digits.');
assert.equal(failure({ input: 'i4x2e' }), 'Integer at byte 0 contains a non-digit character.');
assert.equal(failure({ input: 'i99999999999999999999e' }), 'Integer at byte 0 is outside the safe integer range.');
assert.equal(failure({ input: '03:abc' }), 'Byte string at byte 0 has a leading zero in its length.');
assert.equal(failure({ input: '3abc' }), "Byte string at byte 0 is missing its ':' separator.");
assert.equal(failure({ input: 'l4:spam' }), "List at byte 0 is not closed with 'e'.");
assert.equal(failure({ input: 'd1:ai1e' }), "Dictionary at byte 0 is not closed with 'e'.");
assert.equal(failure({ input: 'di1ei2ee' }), 'Dictionary key at byte 1 is not a byte string.');
assert.equal(failure({ input: 'x' }), 'Invalid bencode at byte 0: a value must start with i, l, d or a digit.');
assert.equal(failure({ input: 'l4:spamx' }), 'Invalid bencode at byte 7: a value must start with i, l, d or a digit.');
assert.equal(failure({ mode: 'other' }), 'Choose either decode or encode mode.');
assert.equal(failure({ mode: 'encode', input: '[true]' }), 'Bencode has no booleans; use 1 or 0 instead.');
assert.equal(failure({ mode: 'encode', input: '' }), 'Enter JSON to encode.');
assert.equal(failure({ mode: 'encode', input: '[]' }), null);

// Nesting and size caps are enforced before any recursion can overflow.
const deep = 'l'.repeat(C.MAX_DEPTH + 1) + 'e'.repeat(C.MAX_DEPTH + 1);
assert.equal(failure({ input: deep }), 'Nesting deeper than 64 levels at byte ' + C.MAX_DEPTH + '.');
assert.equal(failure({ input: 'l'.repeat(C.MAX_DEPTH) + 'e'.repeat(C.MAX_DEPTH) }), null);
let deepJson = '';
for (let n = 0; n < C.MAX_DEPTH + 1; n += 1) deepJson += '[';
deepJson += '1' + ']'.repeat(C.MAX_DEPTH + 1);
assert.equal(failure({ mode: 'encode', input: deepJson }), 'JSON nesting is deeper than 64 levels.');
assert.equal(failure({ input: 'i' + '1'.repeat(C.MAX_INPUT_CHARS) + 'e' }), 'Input must be 200,000 characters or fewer.');

// Page contract: shared shell, accessible controls and no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="input"'), 'input label missing');
assert.ok(html.includes('aria-describedby="input-help"'), 'help reference missing');
assert.ok(html.includes('role="group"') && html.includes('aria-pressed'), 'mode toggle semantics missing');
assert.ok(html.includes('[hidden]{display:none!important}'), 'hidden panel styling missing');
assert.ok(!/autofocus/i.test(html), 'autofocus would steal keyboard context');
assert.ok(html.includes('min-height:44px'), 'controls below the 44 px target');

console.log('bencode codec: ' + entry.testCases.length + ' catalog cases, 600 corpus round trips and structural guards passed');
