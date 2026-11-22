/* Code 39 barcode generator: published pattern table, independent decoder, catalog fixtures and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'code39-barcode-generator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* code39-core:start */';
const endMarker = '/* code39-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = Code39Core;', sandbox);
const C = sandbox.module.exports;

// ZXing Code39Reader: ALPHABET_STRING and CHARACTER_ENCODINGS, 1 = wide.
const ZXING_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
const ZXING_ENCODINGS = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064,
  0x109, 0x049, 0x148, 0x019, 0x118, 0x058, 0x00D, 0x10C, 0x04C, 0x01C,
  0x103, 0x043, 0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016,
  0x181, 0x0C1, 0x1C0, 0x091, 0x190, 0x0D0, 0x085, 0x184, 0x0C4, 0x0A8,
  0x0A2, 0x08A, 0x02A,
];
const ZXING_ASTERISK = 0x094;

assert.equal(C.ALPHABET, ZXING_ALPHABET, 'the character set matches the published alphabet');
assert.equal(C.PATTERNS.length, 43, 'forty-three data patterns');
assert.deepEqual(Array.from(C.PATTERNS), ZXING_ENCODINGS, 'every pattern matches the published table');
assert.equal(C.ASTERISK, ZXING_ASTERISK, 'the asterisk pattern matches');
assert.equal(C.RATIO, 3, 'three-to-one wide ratio');
assert.equal(C.QUIET_MODULES, 10, 'ten-module quiet zones');

// The published table has exactly three wide elements and fifteen modules per symbol.
for (const code of [...ZXING_ENCODINGS, ZXING_ASTERISK]) {
  const widths = Array.from({ length: 9 }, (_, i) => ((code >> (8 - i)) & 1) ? 3 : 1);
  assert.equal(widths.length, 9, 'nine elements');
  assert.equal(widths.filter((w) => w === 3).length, 3, 'three wide elements');
  assert.equal(widths.reduce((a, b) => a + b, 0), 15, 'fifteen modules per symbol');
}
assert.equal(new Set([...ZXING_ENCODINGS, ZXING_ASTERISK]).size, 44, 'patterns are unique');

// Independent decoder: read runs of the bit stream back into symbols.
const CHAR_BY_PATTERN = new Map();
for (let i = 0; i < ZXING_ENCODINGS.length; i += 1) CHAR_BY_PATTERN.set(ZXING_ENCODINGS[i], ZXING_ALPHABET[i]);
CHAR_BY_PATTERN.set(ZXING_ASTERISK, '*');

function decode(result) {
  assert.equal(result.bits.length, result.modules - 20, 'quiet zones are ten modules each');
  const bits = '0'.repeat(10) + result.bits + '0'.repeat(10);
  const runs = [];
  let i = 0;
  while (i < bits.length) {
    const bit = bits[i];
    let run = 1;
    while (i + run < bits.length && bits[i + run] === bit) run += 1;
    runs.push({ bit, run });
    i += run;
  }
  assert.equal(runs[0].bit, '0');
  assert.equal(runs[0].run, 10, 'leading quiet zone');
  assert.equal(runs[runs.length - 1].bit, '0');
  assert.equal(runs[runs.length - 1].run, 10, 'trailing quiet zone');
  const symbols = [];
  let index = 1;
  const last = runs.length - 1;
  while (index < last) {
    const elements = runs.slice(index, index + 9);
    assert.equal(elements.length, 9, 'symbol has nine elements');
    let code = 0;
    elements.forEach((element, position) => {
      assert.equal(element.bit, position % 2 === 0 ? '1' : '0', 'elements alternate bar and space');
      assert.ok(element.run === 1 || element.run === 3, 'runs are one or three modules');
      code = (code << 1) | (element.run === 3 ? 1 : 0);
    });
    assert.ok(CHAR_BY_PATTERN.has(code), 'pattern is in the published table');
    symbols.push(CHAR_BY_PATTERN.get(code));
    index += 9;
    if (index < last) {
      const gap = runs[index];
      assert.equal(gap.bit, '0', 'gap is a space');
      assert.equal(gap.run, 1, 'gap is one module');
      index += 1;
    }
  }
  return symbols;
}

function checkChar(text) {
  let total = 0;
  for (const ch of text) total += ZXING_ALPHABET.indexOf(ch);
  return ZXING_ALPHABET[total % 43];
}

// -------------------------------------------------- default plan
const base = C.calculate({ text: 'VT-2026-001' });
assert.equal(base.encoded, 'VT-2026-001E');
assert.equal(base.check, 'E');
assert.equal(base.checkValue, 14);
assert.equal(base.characters, 14);
assert.equal(base.modules, 243);
assert.equal(base.widthMm, 60.8);
assert.equal(base.bits.length, 223, 'bar field is characters x 15 + gaps');
assert.deepEqual(decode(base), ['*', ...'VT-2026-001E'.split(''), '*']);
assert.equal(C.calculate({}).encoded, base.encoded, 'the default text is the same label');

// Width rule: 15 modules per symbol, a one-module gap between symbols, ten-module quiet zones.
for (const text of ['A', 'AB', 'ABC-1234', '0123456789', '$/+%.-']) {
  for (const checkDigit of [true, false]) {
    const result = C.calculate({ text, checkDigit });
    const expected = 15 * result.characters + (result.characters - 1) + 20;
    assert.equal(result.modules, expected, text + ' modules');
    assert.equal(result.bits.length, expected - 20, text + ' bit width');
    assert.equal(result.characters, text.length + (checkDigit ? 1 : 0) + 2, text + ' symbols');
  }
}

// Every character encodes to its own pattern; a one-character label's check character is itself.
for (const ch of ZXING_ALPHABET) {
  const result = C.calculate({ text: ch });
  assert.equal(result.check, checkChar(ch), ch + ' check character');
  const symbols = decode(result);
  assert.deepEqual(symbols, ['*', ch, result.check, '*'], ch + ' symbols');
  assert.equal(symbols[2], ch, ch + ' value maps back to itself');
}

// Swapping the check character off removes exactly one symbol.
const noCheck = C.calculate({ text: 'ABC-1234', checkDigit: false });
assert.equal(noCheck.encoded, 'ABC-1234');
assert.equal(noCheck.check, null);
assert.equal(noCheck.checkValue, null);
assert.equal(noCheck.characters, 10);
assert.equal(noCheck.modules, 15 * 10 + 9 + 20);
assert.deepEqual(decode(noCheck), ['*', ...'ABC-1234'.split(''), '*']);

// -------------------------------------------------- randomized round trips
let seed = 20261119;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
for (let n = 0; n < 400; n += 1) {
  const length = 1 + Math.floor(rand() * 40);
  let text = '';
  for (let i = 0; i < length; i += 1) text += ZXING_ALPHABET[Math.floor(rand() * 43)];
  const checkDigit = rand() < 0.5;
  const result = C.calculate({ text, checkDigit });
  const symbols = decode(result);
  assert.equal(symbols[0], '*', 'start symbol');
  assert.equal(symbols[symbols.length - 1], '*', 'stop symbol');
  assert.equal(symbols.slice(1, -1).join(''), result.encoded, 'round trip');
  assert.equal(result.encoded, checkDigit ? text + checkChar(text) : text, 'check character');
}

// -------------------------------------------------- catalog record replay
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'exactly one catalog record');
const record = records[0];
assert.equal(record.name, 'Code 39 Barcode Generator');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the symbology and its limits');
assert.match(record.method, /nine elements/);
assert.match(record.method, /modulo 43/);
assert.match(record.method, /40 characters/);
assert.equal(record.sources.length, 2, 'two named sources');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Code_39');
assert.match(record.sources[1].url, /zxing\/.*Code39Reader\.java$/);
assert.ok(record.sources.every((item) => /^https:\/\//.test(item.url)), 'source URLs are https');
assert.equal(record.testCases.length, 22, 'the full catalog case set');
assert.equal(record.testCases.filter((item) => item.kind === 'golden').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'validation').length, 12);
assert.equal(catalog.tools.length, 2455, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2194, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Encoding').length, 54, 'Encoding count');

// No other record claims this slug, name, alias or distinctive tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((value) => value.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  for (const tag of ['code-39', 'logmars']) {
    assert.ok(!other.tags.includes(tag), tag + ' tag is unique: ' + other.slug);
  }
}

for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    let caught = null;
    try { C.calculate(options); } catch (error) { caught = error; }
    assert.ok(caught, testCase.name + ' was not refused');
    assert.equal(caught.message, testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
  assert.equal(decode(result).join(''), '*' + result.encoded + '*', testCase.name + ' decode');
}

// -------------------------------------------------- page contract
assert.ok(!/[^\x00-\x7F]/.test(html), 'page source is ASCII');
assert.match(html, /<title>Code 39 Barcode Generator/);
assert.match(html, /name="description"/);
assert.match(html, /id="in-text"/);
assert.match(html, /<label class="f" for="in-text"/);
assert.match(html, /aria-describedby="text-help"/);
assert.match(html, /id="in-check" checked/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="alert"/);
assert.match(html, /min-height:44px/);
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|https?:\/\/(?!www\.w3\.org)/.test(html),
  'no network, storage or remote assets in the page');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids in the page');
for (const id of Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), (match) => match[1])) {
  assert.ok(ids.includes(id), 'script looks up a missing id: ' + id);
}
assert.match(html, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/, 'the page draws an SVG');

console.log('code39-barcode-generator: all checks passed (' + record.testCases.length
  + ' catalog cases, 400 round trips)');
