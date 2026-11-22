/* Register bit-field packing: most-significant-first layout, zero-filled low bits,
   an independent bit-string model, round trips, refusals, catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'register-bit-field-packer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* register-bit-field-core:start */';
const endMarker = '/* register-bit-field-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RegisterBitFieldCore;', sandbox);
const C = sandbox.module.exports;

const pack = (size, fields) => C.pack(size, fields);
const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (size, fields) => {
  try { pack(size, fields); } catch (error) { return error.message; }
  return null;
};
const field = (name, width, value) => ({ name, width, value });

// ---- Independent model: concatenate each field's binary text, pad the word with
// zeros at the bottom, then read the whole string back as one number. This shares
// no shift arithmetic with the page core.
function intValue(text) {
  const raw = String(text).trim();
  if (/^0[xX][0-9a-fA-F]+$/.test(raw)) return BigInt('0x' + raw.slice(2));
  if (/^0[bB][01]+$/.test(raw)) return BigInt('0b' + raw.slice(2));
  assert.match(raw, /^\d+$/, 'model only sees valid values');
  return BigInt(raw);
}
function model(size, fields) {
  let bits = '';
  for (const entry of fields) {
    bits += intValue(entry.value).toString(2).padStart(Number(entry.width), '0');
  }
  bits = bits.padEnd(size, '0');
  const value = BigInt('0b' + bits);
  const digits = size / 4;
  const hex = '0x' + value.toString(16).toUpperCase().padStart(digits, '0');
  const bytes = [];
  for (let index = 2; index < hex.length; index += 2) bytes.push(hex.slice(index, index + 2));
  return {
    hex,
    decimal: value.toString(),
    binary: bits.match(/.{8}/g).join(' '),
    bytesBigEndian: bytes.join(' '),
    bytesLittleEndian: bytes.slice().reverse().join(' '),
    unusedBits: size - fields.reduce((sum, entry) => sum + Number(entry.width), 0)
  };
}

// ---- Exported contract.
assert.deepEqual(Array.from(C.WORD_SIZES), [8, 16, 32, 64]);
assert.equal(C.DEFAULT_WORD_SIZE, 32);
assert.equal(C.DEFAULT_FIELDS.length, 4);
assert.deepEqual(plain(C.DEFAULT_FIELDS.map((entry) => [entry.name, entry.width, entry.value])),
  [['enable', 1, '1'], ['mode', 3, '5'], ['prescaler', 12, '0x2A5'], ['threshold', 16, '1000']]);

// ---- Hand-worked reference words. Each figure is the concatenation of the field
// values below, read as one binary number.
const REFERENCES = [
  {
    size: 32,
    fields: [field('enable', 1, '1'), field('mode', 3, '5'), field('prescaler', 12, '0x2A5'), field('threshold', 16, '1000')],
    hex: '0xD2A503E8', decimal: '3534029800', binary: '11010010 10100101 00000011 11101000',
    bytesBigEndian: 'D2 A5 03 E8', bytesLittleEndian: 'E8 03 A5 D2', unusedBits: 0
  },
  {
    size: 8,
    fields: [field('high', 4, '0xA'), field('low', 4, '0x5')],
    hex: '0xA5', decimal: '165', binary: '10100101',
    bytesBigEndian: 'A5', bytesLittleEndian: 'A5', unusedBits: 0
  },
  {
    size: 16,
    fields: [field('mode', 4, '0b1010'), field('gain', 8, '255'), field('flag', 1, '1'), field('spare', 3, '0')],
    hex: '0xAFF8', decimal: '45048', binary: '10101111 11111000',
    bytesBigEndian: 'AF F8', bytesLittleEndian: 'F8 AF', unusedBits: 0
  },
  {
    size: 64,
    fields: [field('id', 32, '0xDEADBEEF'), field('epoch', 16, '0x1234'), field('flags', 8, '0b10100001'), field('kind', 8, '7')],
    hex: '0xDEADBEEF1234A107', decimal: '16045690981402845447',
    binary: '11011110 10101101 10111110 11101111 00010010 00110100 10100001 00000111',
    bytesBigEndian: 'DE AD BE EF 12 34 A1 07', bytesLittleEndian: '07 A1 34 12 EF BE AD DE', unusedBits: 0
  },
  {
    size: 32,
    fields: [field('opcode', 8, '0xFF')],
    hex: '0xFF000000', decimal: '4278190080', binary: '11111111 00000000 00000000 00000000',
    bytesBigEndian: 'FF 00 00 00', bytesLittleEndian: '00 00 00 FF', unusedBits: 24
  },
  {
    size: 8,
    fields: [field('reserved', 7, '0'), field('ready', 1, '1')],
    hex: '0x01', decimal: '1', binary: '00000001',
    bytesBigEndian: '01', bytesLittleEndian: '01', unusedBits: 0
  },
  {
    size: 16,
    fields: [field('mask', 8, '0xFF'), field('data', 8, '0')],
    hex: '0xFF00', decimal: '65280', binary: '11111111 00000000',
    bytesBigEndian: 'FF 00', bytesLittleEndian: '00 FF', unusedBits: 0
  },
  {
    size: 64,
    fields: [field('pattern', 64, '0xFFFFFFFFFFFFFFFF')],
    hex: '0xFFFFFFFFFFFFFFFF', decimal: '18446744073709551615',
    binary: '11111111 11111111 11111111 11111111 11111111 11111111 11111111 11111111',
    bytesBigEndian: 'FF FF FF FF FF FF FF FF', bytesLittleEndian: 'FF FF FF FF FF FF FF FF', unusedBits: 0
  },
  {
    size: 16,
    fields: [field('offset', 4, '0'), field('limit', 12, '4095')],
    hex: '0x0FFF', decimal: '4095', binary: '00001111 11111111',
    bytesBigEndian: '0F FF', bytesLittleEndian: 'FF 0F', unusedBits: 0
  },
  {
    size: 16,
    fields: [field('channel', 6, '0'), field('level', 6, '0')],
    hex: '0x0000', decimal: '0', binary: '00000000 00000000',
    bytesBigEndian: '00 00', bytesLittleEndian: '00 00', unusedBits: 4
  },
  {
    size: 8,
    fields: [field('enable', 1, '0b1'), field('rate', 7, '0b0100000')],
    hex: '0xA0', decimal: '160', binary: '10100000',
    bytesBigEndian: 'A0', bytesLittleEndian: 'A0', unusedBits: 0
  },
  {
    size: 16,
    fields: [field('window', 4, '15'), field('count', 12, '3000')],
    hex: '0xFBB8', decimal: '64440', binary: '11111011 10111000',
    bytesBigEndian: 'FB B8', bytesLittleEndian: 'B8 FB', unusedBits: 0
  }
];
for (const reference of REFERENCES) {
  const result = pack(reference.size, reference.fields);
  const expected = model(reference.size, reference.fields);
  for (const key of ['hex', 'decimal', 'binary', 'bytesBigEndian', 'bytesLittleEndian', 'unusedBits']) {
    assert.equal(result[key], reference[key], reference.size + '-bit word ' + key);
    assert.equal(result[key], expected[key], 'model agrees on ' + key);
  }
  assert.equal(result.wordSize, reference.size);
  assert.equal(result.fields.length, reference.fields.length);
}

// ---- Bit ranges run downward from the most significant bit and cover every field.
const ranged = pack(32, REFERENCES[0].fields);
assert.deepEqual(plain(ranged.fields.map((entry) => entry.range)), ['31', '30..28', '27..16', '15..0']);
assert.deepEqual(plain(ranged.fields.map((entry) => entry.high)), [31, 30, 27, 15]);
assert.deepEqual(plain(ranged.fields.map((entry) => entry.low)), [31, 28, 16, 0]);
assert.deepEqual(plain(ranged.fields.map((entry) => entry.value)), ['1', '5', '677', '1000']);
assert.deepEqual(plain(ranged.fields.map((entry) => entry.hex)), ['0x1', '0x5', '0x2A5', '0x3E8']);
assert.equal(ranged.totalBits, 32);
assert.equal(ranged.hex.length, 10, 'eight hex digits plus the prefix');
assert.equal(pack(64, [field('all', 64, '0')]).hex.length, 18);
assert.equal(pack(8, [field('all', 8, '0')]).hex, '0x00');

// ---- Round trip: every field reads back exactly as it was entered.
function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const random = prng(20261120);
function randomBits(width) {
  let bits = '';
  for (let index = 0; index < width; index += 1) bits += random() < 0.5 ? '0' : '1';
  return '0b' + bits;
}
let randomCases = 0;
for (const size of [8, 16, 32, 64]) {
  for (let trial = 0; trial < 60; trial += 1) {
    const fields = [];
    let left = size;
    let counter = 0;
    while (left > 0) {
      const width = 1 + Math.floor(random() * Math.min(left, 13));
      fields.push(field('f' + counter, width, randomBits(width)));
      left -= width;
      counter += 1;
    }
    const result = pack(size, fields);
    const expected = model(size, fields);
    for (const key of ['hex', 'decimal', 'binary', 'bytesBigEndian', 'bytesLittleEndian']) {
      assert.equal(result[key], expected[key], size + '-bit random ' + key);
    }
    assert.equal(result.unusedBits, 0);
    assert.deepEqual(plain(result.fields.map((entry) => entry.value)),
      fields.map((entry) => intValue(entry.value).toString()));
    assert.equal(result.binary.split(' ').join('').length, size);
    assert.equal(result.bytesBigEndian.split(' ').length, size / 8);
    assert.equal(BigInt('0x' + result.hex.slice(2)), BigInt(result.decimal));
    randomCases += 1;
  }
  // Partial fills leave the low bits zero.
  for (let trial = 0; trial < 10; trial += 1) {
    const width = 1 + Math.floor(random() * size);
    const result = pack(size, [field('only', width, randomBits(width))]);
    assert.equal(result.unusedBits, size - width);
    const lowBits = BigInt(result.decimal) & ((BigInt(1) << BigInt(size - width)) - BigInt(1));
    assert.equal(lowBits, BigInt(0), 'unused low bits stay zero');
    randomCases += 1;
  }
}

// ---- Refusals: nothing is truncated or silently repaired.
assert.equal(failure(32, []), 'Add at least one field to pack.');
assert.equal(failure(32, [field('', 4, '0')]), 'Give every field a name.');
assert.equal(failure(32, [field('mode', 4, '0'), field('MODE', 4, '0')]), 'Two fields are both named "MODE".');
assert.equal(failure(12, [field('a', 4, '0')]), 'Choose an 8-, 16-, 32- or 64-bit word.');
assert.equal(failure('', [field('a', 4, '0')]), 'Choose an 8-, 16-, 32- or 64-bit word.');
assert.equal(failure(8, [field('a', 0, '0')]), 'Field "a" needs a whole width from 1 to 8 bits.');
assert.equal(failure(8, [field('a', 9, '0')]), 'Field "a" needs a whole width from 1 to 8 bits.');
assert.equal(failure(8, [field('a', '2.5', '0')]), 'Field "a" needs a whole width from 1 to 8 bits.');
assert.equal(failure(8, [field('a', 5, '0'), field('b', 4, '0')]),
  'The fields add up to 9 bits, but an 8-bit word holds only 8. Shorten a width or remove a field.');
assert.equal(failure(16, [field('a', 9, '0'), field('b', 8, '0')]),
  'The fields add up to 17 bits, but a 16-bit word holds only 16. Shorten a width or remove a field.');
assert.equal(failure(32, [field('a', 3, '8')]), 'The value for "a" does not fit in 3 bits.');
assert.equal(failure(8, [field('a', 8, '0x100')]), 'The value for "a" does not fit in 8 bits.');
assert.equal(failure(8, [field('a', 1, '2')]), 'The value for "a" does not fit in 1 bit.');
assert.equal(failure(8, [field('a', 4, '-1')]), 'Values are unsigned; enter "a" as zero or more.');
assert.equal(failure(8, [field('a', 4, '')]), 'Enter a value for "a"; use 0 when the field is unused.');
assert.equal(failure(8, [field('a', 4, 'ten')]),
  'Enter "a" as a decimal, 0x hex or 0b binary number, such as 12, 0x1F or 0b1010.');
assert.equal(failure(8, [field('a', 4, '1 0')]),
  'Enter "a" as a decimal, 0x hex or 0b binary number, such as 12, 0x1F or 0b1010.');
assert.equal(pack(8, [field('a', 4, ' 0xA ')]).hex, '0xA0', 'surrounding spaces and mixed case are accepted');
assert.equal(pack(8, [field('a', 4, '0b0011')]).fields[0].value, '3');
assert.equal(pack(64, [field('a', 64, '18446744073709551615')]).hex, '0xFFFFFFFFFFFFFFFF');

// ---- Catalog record and its cases must agree with the page core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.length, 2455, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2194, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Encoding').length, 54,
  'Encoding count');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Register Bit-Field Packer');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.method.includes('64'), 'method covers the widest word');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 17, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 5, 'five validation cases');
for (const testCase of record.testCases) {
  const fields = testCase.input.fields;
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.wordSize, fields), testCase.expectedError, testCase.name);
    continue;
  }
  const result = pack(testCase.input.wordSize, fields);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(plain(result[key]), expected, testCase.name + ' ' + key);
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
for (const tag of ['bit-field', 'register', 'bit-packing', 'firmware', 'embedded']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="word-size">/.test(html), 'the word size has a visible label');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/makeInput\("fwidth"[\s\S]*?"numeric"\)/.test(html), 'a numeric keyboard is offered for widths');
assert.ok(/setAttribute\("inputmode", inputMode\)/.test(html), 'the input mode is applied to the row inputs');
assert.equal((html.match(/<option value="/g) || []).length, 4, 'four word sizes in the picker');
for (const size of C.WORD_SIZES) {
  assert.ok(html.includes('<option value="' + size + '"'), 'word size option present: ' + size);
}
assert.ok(/id="add"/.test(html) && /id="reset"/.test(html) && /id="copy"/.test(html), 'the row and copy controls exist');
assert.ok(/setAttribute\("aria-label", "Field " \+ number/.test(html), 'dynamic rows stay labelled');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('register bit-field packer: 12 reference words, ' + randomCases
  + ' random packs, 17 catalog cases and the page contract pass');
