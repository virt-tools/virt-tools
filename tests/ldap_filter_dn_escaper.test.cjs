/* LDAP filter and DN escaper: the RFC 4515 / RFC 4514 escape rules, an
   independent oracle over seeded strings, byte-level reading, the catalog
   replay, refusals, name/alias uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ldap-filter-dn-escaper';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ldap-escape-core:start */';
const endMarker = '/* ldap-escape-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LdapEscapeCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(Object.keys(C)).sort(),
  ['MESSAGES', 'decodeUtf8', 'escapeText', 'hex', 'solve', 'unescapeText', 'utf8Bytes']);
assert.equal(C.hex(0x2a, false), '2a');
assert.equal(C.hex(0x0, false), '00');
assert.equal(C.hex(0xc4, true), 'C4');

// ---- An independent oracle for the escape rules, written from the RFC text.
const FILTER = new Set([0x00, 0x28, 0x29, 0x2a, 0x5c]);
const DN_MUST = new Set(['"', '+', ',', ';', '<', '>', '\\']);
const oracle = (text, context, nonAscii) => {
  const points = Array.from(text);
  let output = '';
  let count = 0;
  let bytes = 0;
  let wide = 0;
  points.forEach((ch, position) => {
    const code = ch.codePointAt(0);
    const hex = (value, upper) => {
      const digits = value.toString(16).padStart(2, '0');
      return (upper ? digits.toUpperCase() : digits);
    };
    if (code === 0) { output += '\\00'; count += 1; return; }
    if (context === 'filter' && FILTER.has(code)) { output += '\\' + hex(code, false); count += 1; return; }
    if (context === 'dn') {
      if (ch === ' ' && (position === 0 || position === points.length - 1)) { output += '\\20'; count += 1; return; }
      if (ch === '#' && position === 0) { output += '\\23'; count += 1; return; }
      if (DN_MUST.has(ch)) { output += '\\' + ch; count += 1; return; }
    }
    if (nonAscii && code > 0x7f) {
      const encoded = Buffer.from(ch, 'utf8');
      output += Array.from(encoded).map((byte) => '\\' + hex(byte, context === 'dn')).join('');
      bytes += encoded.length;
      count += 1;
      wide += 1;
      return;
    }
    output += ch;
  });
  return { output, escapedCount: count, nonAsciiBytes: bytes, nonAsciiChars: wide };
};

// ---- The published examples from both RFCs.
const rfc = (text, context, nonAscii) => C.escapeText(text, context, Boolean(nonAscii));
assert.equal(rfc('Smith*', 'filter').output, 'Smith\\2a');           // RFC 4515 uses \2a
assert.equal(rfc('*', 'filter').output, '\\2a');
assert.equal(rfc('(', 'filter').output, '\\28');
assert.equal(rfc('\\', 'filter').output, '\\5c');
assert.equal(rfc('\u0000', 'filter').output, '\\00');
assert.equal(rfc('Jöhn', 'filter').output, 'Jöhn', 'valid UTF-8 may stay raw');
assert.equal(rfc('Jöhn', 'filter', true).output, 'J\\c3\\b6hn');
assert.equal(rfc('Smith, John', 'dn').output, 'Smith\\, John');
assert.equal(rfc(' John ', 'dn').output, '\\20John\\20');
assert.equal(rfc('#1', 'dn').output, '\\231');
assert.equal(rfc('a=b/c', 'dn').output, 'a=b/c', '= and / need no escape');
assert.equal(rfc('a"b', 'dn').output, 'a\\"b');
assert.equal(rfc('a+b', 'dn').output, 'a\\+b');
assert.equal(rfc('a;b', 'dn').output, 'a\\;b');
assert.equal(rfc('a<b>c', 'dn').output, 'a\\<b\\>c');
assert.equal(rfc('a\\b', 'dn').output, 'a\\\\b');
assert.equal(rfc('Lučić', 'dn', true).output, 'Lu\\C4\\8Di\\C4\\87'); // RFC 4514 section 4

// ---- An emoji is four octets, escaped as one replacement over one code point.
const emoji = rfc('\u{1f600}', 'filter', true);
assert.equal(emoji.output, '\\f0\\9f\\98\\80');
assert.equal(emoji.escapedCount, 1);
assert.equal(emoji.nonAsciiBytes, 4);

// ---- Reading back, including the RFC's own DN example.
assert.equal(C.unescapeText('\\2a', 'filter').output, '*');
assert.equal(C.unescapeText('\\2A', 'filter').output, '*', 'hex case is free');
assert.equal(C.unescapeText('Lu\\C4\\8Di\\C4\\87', 'dn').output, 'Lučić');
assert.equal(C.unescapeText('Smith\\2c John', 'dn').output, 'Smith, John');
assert.equal(C.unescapeText('\\ ', 'dn').output, ' ');
assert.equal(C.unescapeText('\\=', 'dn').output, '=');
assert.equal(C.unescapeText('a\\20b', 'dn').output, 'a b');
assert.equal(C.unescapeText('\\c3\\b6', 'filter').output, 'ö');
assert.equal(C.unescapeText('\\f0\\9f\\98\\80', 'filter').output, '\u{1f600}');
assert.equal(C.unescapeText('plain', 'filter').decodedCount, 0);

// ---- UTF-8 helpers against Node's own encoder and a strict decoder.
const points = [0x0, 0x41, 0x7f, 0x80, 0x7ff, 0x800, 0x20ac, 0xffff, 0x10000, 0x1f600, 0x10ffff];
for (const code of points) {
  const expected = Array.from(Buffer.from(String.fromCodePoint(code), 'utf8'));
  assert.deepEqual(plain(C.utf8Bytes(code)), expected, 'utf8 bytes for ' + code);
  assert.equal(C.decodeUtf8(expected), String.fromCodePoint(code), 'decode ' + code);
}
for (const bad of [[0x80], [0xc0, 0x80], [0xc1, 0xbf], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
  [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
  [0xe2, 0x82], [0xff], [0xc3]]) {
  assert.equal(C.decodeUtf8(bad), null, 'refuses ' + bad.map((b) => b.toString(16)).join(' '));
}

// ---- Seeded strings: the oracle agrees and every escape reads back exactly.
let seed = 20261118;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pool = ['a', 'Z', '0', ' ', '*', '(', ')', '\\', '\u0000', 'ö', 'Ж', '\u{1f600}',
  '-', '=', '#', ',', ';', '<', '>', '"', '/', '+', '\t', '&'];
let checked = 0;
for (let index = 0; index < 300; index += 1) {
  const length = Math.floor(random() * 13);
  let text = '';
  for (let step = 0; step < length; step += 1) {
    text += pool[Math.floor(random() * pool.length)];
  }
  for (const context of ['filter', 'dn']) {
    for (const nonAscii of [false, true]) {
      const actual = plain(C.escapeText(text, context, nonAscii));
      const expected = oracle(text, context, nonAscii);
      assert.equal(actual.output, expected.output, 'oracle output ' + JSON.stringify(text) + ' ' + context);
      assert.equal(actual.escapedCount, expected.escapedCount, 'oracle count ' + JSON.stringify(text));
      assert.equal(actual.nonAsciiBytes, expected.nonAsciiBytes, 'oracle bytes ' + JSON.stringify(text));
      const back = C.unescapeText(actual.output, context);
      assert.equal(back.output, text, 'round trip ' + JSON.stringify(text) + ' ' + context);
      assert.equal(back.decodedCount,
        actual.escapedCount - expected.nonAsciiChars + expected.nonAsciiBytes,
        'round trip count ' + JSON.stringify(text));
      checked += 1;
    }
  }
}
assert.ok(checked === 1200, 'both contexts, both switches, 300 strings');

// A value with every filter special, and the same value read back.
const dense = '(*)\\\u0000';
const denseOut = C.escapeText(dense, 'filter');
assert.equal(denseOut.output, '\\28\\2a\\29\\5c\\00');
assert.equal(C.unescapeText(denseOut.output, 'filter').output, dense);

// ---- Refusals stay specific.
assert.equal(failure({ direction: 'escape', context: 'filter', text: '' }),
  'Enter the text to escape.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: '' }),
  'Enter the escaped text to read.');
assert.equal(failure({ direction: 'escape', context: 'filter', text: '\ud800' }),
  'That text contains an unpaired surrogate, which has no UTF-8 encoding.');
assert.equal(failure({ direction: 'escape', context: 'filter', text: 'a\udc00b' }),
  'That text contains an unpaired surrogate, which has no UTF-8 encoding.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: 'abc\\' }),
  'The escaped text ends with a single backslash.');
assert.equal(failure({ direction: 'unescape', context: 'dn', text: 'abc\\' }),
  'The escaped text ends with a single backslash.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: '\\2' }),
  'A backslash escape needs two hex digits after it.');
assert.equal(failure({ direction: 'unescape', context: 'dn', text: '\\4' }),
  'A backslash escape needs two hex digits after it.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: 'a\\zz' }),
  'A backslash in a filter value must be followed by two hex digits.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: 'a\\(' }),
  'A backslash in a filter value must be followed by two hex digits.');
assert.equal(failure({ direction: 'unescape', context: 'dn', text: 'a\\q' }),
  'A backslash in a DN value must be followed by one of  " # + , ; < = > \\ or two hex digits.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: '\\ff' }),
  'Those escaped bytes are not valid UTF-8, so they cannot be shown as text.');
assert.equal(failure({ direction: 'unescape', context: 'filter', text: '\\ed\\a0\\80' }),
  'Those escaped bytes are not valid UTF-8, so they cannot be shown as text.');
assert.equal(failure({ direction: 'escape', context: 'xml', text: 'Smith' }),
  'Choose where the value goes: a filter value or a DN value.');
assert.equal(failure({ direction: 'encode', context: 'filter', text: 'Smith' }),
  'Choose whether to escape the text or read an escaped value.');

// ---- Reading warns about characters that an escape would still change.
const warned = C.unescapeText('Smith* and (Sales)', 'filter');
assert.equal(warned.output, 'Smith* and (Sales)');
assert.equal(warned.warningTotal, 3);
assert.ok(/wildcard/.test(warned.warnings[0]), 'the wildcard is named');
const dnWarned = C.unescapeText('Smith, John', 'dn');
assert.equal(dnWarned.warningTotal, 1);
const quiet = C.unescapeText('Smith\\, John', 'dn');
assert.equal(quiet.warningTotal, 0, 'an escaped comma is not warned about');

// ---- Catalog replay of the published cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'LDAP Filter & DN Escaper');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.sources.length, 2, 'both RFCs are cited');
assert.equal(record.sources[0].url, 'https://www.rfc-editor.org/rfc/rfc4515.html');
assert.equal(record.sources[1].url, 'https://www.rfc-editor.org/rfc/rfc4514.html');
assert.equal(record.testCases.length, 24, '24 catalog cases');
assert.equal(record.testCases.filter((entry) => entry.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((entry) => entry.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((entry) => entry.kind === 'validation').length, 10);

for (const testCase of record.testCases) {
  const input = {
    direction: testCase.input.direction,
    context: testCase.input.context,
    text: testCase.input.text,
    escapeNonAscii: Boolean(testCase.input.escapeNonAscii)
  };
  if (testCase.expectedError) {
    assert.equal(failure(input), testCase.expectedError, 'refusal: ' + testCase.name);
    continue;
  }
  const result = run(input);
  const expected = testCase.expected;
  assert.equal(result.output, expected.output, testCase.name + ' output');
  if (input.direction === 'escape') {
    assert.equal(result.escapedCount, expected.escapedCount, testCase.name + ' count');
    assert.equal(result.nonAsciiBytes, expected.nonAsciiBytes, testCase.name + ' bytes');
    assert.equal(result.preview, expected.preview, testCase.name + ' preview');
  } else {
    assert.equal(result.decodedCount, expected.decodedCount, testCase.name + ' escapes');
  }
}

// ---- The catalog is the single place a slug, name or alias may live.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [record.name, ...record.aliases]) {
  const owners = names.get(value.toLowerCase());
  assert.equal(owners.size, 1, 'name or alias belongs to one tool: ' + value);
  assert.ok(owners.has(slug), 'name or alias belongs to this tool: ' + value);
}

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'language');
assert.ok(/<h1>LDAP Filter &amp; DN Escaper<\/h1>/.test(html), 'heading');
assert.ok(/<form id="escape-form" novalidate>/.test(html), 'form');
for (const id of ['dir-escape', 'dir-unescape', 'in-text', 'input-label', 'input-hint',
  'ctx-filter', 'ctx-dn', 'opt-nonascii', 'nonascii-row', 'err', 'run', 'copy', 'status',
  'out', 'out-label', 'headline', 'sub', 'preview-wrap', 'preview-label', 'preview',
  'facts', 'warn', 'table-wrap', 'table-caption', 'rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Text to escape', 'Search filter value (RFC 4515)',
  'Distinguished name value (RFC 4514)']) {
  assert.ok(html.includes('>' + label + '</span></label>') || html.includes('>' + label + '</label>'),
    'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Escape text<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'the error is announced');
assert.ok(/nothing is sent or stored/.test(html), 'the note states local only');
assert.ok(/RFC 4515/.test(html) && /RFC 4514/.test(html), 'both standards are named');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one input area');
assert.ok(/<input type="radio" name="context"/.test(html), 'the context is a radio group');
assert.ok(/<input type="checkbox" id="opt-nonascii">/.test(html), 'the byte switch is a checkbox');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('ldap filter and DN escaper: all assertions passed');
