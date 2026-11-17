/* Intel HEX inspector: record layout and checksum rules, published vector, the
   address arithmetic the specification defines, defect messages, randomised
   invariants, catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'intel-hex-inspector';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* intel-hex-core:start */';
const endMarker = '/* intel-hex-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = IntelHexCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const inspect = (text) => plain(C.compute({ text }));
const failure = (text) => {
  try { inspect(text); } catch (error) { return error.message; }
  return null;
};
const record = (offset, type, bytes) => {
  const body = [bytes.length, (offset >> 8) & 0xFF, offset & 0xFF, type, ...bytes];
  const sum = body.reduce((total, value) => (total + value) & 0xFF, 0);
  return ':' + body.concat([(0x100 - sum) & 0xFF]).map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join('');
};
const eof = record(0, 1, []);
const file = (...lines) => lines.join('\n') + '\n';

// ---- The record builder agrees with the published Wikipedia example record.
assert.equal(record(0x0010, 0, [...Buffer.from('address gap')]), ':0B0010006164647265737320676170A7');
assert.equal(record(0, 1, []), ':00000001FF');
assert.equal(record(0, 5, [0x08, 0x00, 0x00, 0x00]), ':0400000508000000EF');
assert.equal(record(0, 4, [0x08, 0x00]), ':020000040800F2');

// ---- Constants and the value formatter.
assert.equal(C.MAX_CHARACTERS, 1000000);
assert.equal(C.MAX_RECORDS, 50000);
assert.equal(C.hexValue(0), '0x0000');
assert.equal(C.hexValue(0xFFFF), '0xFFFF');
assert.equal(C.hexValue(0x10000), '0x00010000');
assert.deepEqual(plain(C.TYPE_NAMES), { 0: 'data', 1: 'end of file', 2: 'extended segment address', 3: 'start segment address', 4: 'extended linear address', 5: 'start linear address' });

// ---- A plain image, and the summary every field of it.
const simple = inspect(file(record(0x0000, 0, [0x11, 0x22, 0x33, 0x44]), record(0x0004, 0, [0x55, 0x66]), eof));
assert.deepEqual(simple, {
  records: 3, dataRecords: 2, dataBytes: 6, uniqueBytes: 6, overlapBytes: 0,
  segments: 1, holes: 0, largestGap: 0, spanBytes: 6,
  addressStart: '0x0000', addressEnd: '0x0005',
  entryPoint: null, entryKind: null, eofRecords: 1,
  errors: [], errorLines: [], errorCount: 0, valid: true
});

// ---- Extended linear addressing sets bits 16-31 of the base.
const linear = inspect(file(record(0, 4, [0x08, 0x00]), record(0x0100, 0, [0xAA, 0xBB]), eof));
assert.equal(linear.addressStart, '0x08000100');
assert.equal(linear.addressEnd, '0x08000101');
assert.equal(linear.segments, 1);

// ---- A second extended linear address moves the base for later records.
const moved = inspect(file(record(0, 4, [0x00, 0x01]), record(0x0000, 0, [1, 2]), record(0, 4, [0x00, 0x02]), record(0x0000, 0, [3, 4]), eof));
assert.equal(moved.addressStart, '0x00010000');
assert.equal(moved.addressEnd, '0x00020001');
assert.equal(moved.segments, 2);
assert.equal(moved.holes, 0x10000 - 2);

// ---- Segmented addressing: the base is the upper segment word shifted left
// four places, and offsets wrap inside the 64 KiB segment rather than past it.
const segmented = inspect(file(record(0, 2, [0x10, 0x00]), record(0xFFF8, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), eof));
assert.equal(segmented.addressStart, '0x00010000');
assert.equal(segmented.addressEnd, '0x0001FFFF');
assert.equal(segmented.uniqueBytes, 16);
assert.equal(segmented.segments, 2, 'the tail of the segment and its start are separate blocks');
assert.equal(segmented.holes, 65520);

// ---- A data record's addresses wrap at 4 GiB in linear mode.
const wrapped = inspect(file(record(0, 4, [0xFF, 0xFF]), record(0xFFF8, 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]), eof));
assert.equal(wrapped.addressStart, '0x0000');
assert.equal(wrapped.addressEnd, '0xFFFFFFFF');
assert.equal(wrapped.uniqueBytes, 16);
assert.equal(wrapped.segments, 2);

// ---- Overlapping writes are counted once and reported.
const overlap = inspect(file(record(0x0000, 0, [1, 2, 3, 4]), record(0x0002, 0, [9, 9, 9, 9]), eof));
assert.equal(overlap.dataBytes, 8);
assert.equal(overlap.uniqueBytes, 6);
assert.equal(overlap.overlapBytes, 2);
assert.equal(overlap.valid, true, 'an overlap is reported, not treated as a defect');

// ---- Start addresses: type 05 gives EIP, type 03 gives CS:IP as a linear address.
const startLinear = inspect(file(record(0, 0, [1]), record(0, 5, [0x12, 0x34, 0x56, 0x78]), eof));
assert.equal(startLinear.entryPoint, '0x12345678');
assert.equal(startLinear.entryKind, 'start linear address (EIP)');
const startSegment = inspect(file(record(0, 0, [1]), record(0, 3, [0x12, 0x34, 0x56, 0x78]), eof));
assert.equal(startSegment.entryPoint, '0x000179B8');
assert.equal(startSegment.entryKind, 'start segment address (CS:IP)');

// ---- Blank lines and CRLF line endings are tolerated.
assert.deepEqual(inspect('\r\n\r\n' + record(0, 0, [1, 2]) + '\r\n' + eof + '\r\n').errorCount, 0);
assert.equal(inspect('\r\n\r\n' + record(0, 0, [1, 2]) + '\r\n' + eof + '\r\n').records, 2);

// ---- Refusals that throw: empty input and input past the documented limits.
assert.equal(failure(''), 'Paste Intel HEX records to inspect.');
assert.equal(failure('   \n\t\n'), 'Paste Intel HEX records to inspect.');
assert.equal(failure('0'.repeat(1000001)), 'The text is longer than 1,000,000 characters; inspect a smaller file.');
assert.equal(failure(file(...Array.from({ length: 50001 }, () => eof))),
  'The file has more than 50,000 records; inspect a smaller file.');

// ---- Every defect a record can carry is reported with its line number.
const defects = [
  [':040000001122334400' + '\n' + eof, 'The checksum is 0x00 but the record\'s bytes need 0x52.'],
  ['10000011223344BB\n' + eof, 'A record must start with a colon.'],
  [':04000000GG3344B0\n' + eof, 'The record contains a character that is not a hexadecimal digit.'],
  [':040000011223344B6\n' + eof, 'The record has an odd number of hexadecimal digits.'],
  [':04000000\n' + eof, 'The record is shorter than the 10 digits a header and checksum need.'],
  [record(0, 0, [1, 2, 3, 4]).slice(0, -2) + '\n' + eof, 'The byte count says 4 data bytes, so the record needs 9 bytes and it carries 8.'],
  [record(0, 0, []) + '\n' + record(0, 0, [1]) + '\n' + eof, 'A data record with a byte count of zero carries nothing.'],
  [record(0, 1, [0xAA]) + '\n', 'An end-of-file record must be :00000001FF.'],
  [record(0, 6, [1, 2]) + '\n' + record(0, 0, [1]) + '\n' + eof, 'Record type 0x0006 is not one of the six types the format defines.'],
  [record(0, 4, [8]) + '\n' + record(0, 0, [1]) + '\n' + eof, 'An extended linear address record needs exactly 2 data bytes.'],
  [record(0, 2, [0x10]) + '\n' + record(0, 0, [1]) + '\n' + eof, 'An extended segment address record needs exactly 2 data bytes.'],
  [record(0, 3, [1, 2]) + '\n' + record(0, 0, [1]) + '\n' + eof, 'A start segment address record needs exactly 4 data bytes.'],
  [record(0, 5, [1, 2]) + '\n' + record(0, 0, [1]) + '\n' + eof, 'A start linear address record needs exactly 4 data bytes.']
];
for (const [text, message] of defects) {
  const result = inspect(text);
  assert.equal(result.valid, false, message);
  assert.ok(result.errors.some((item) => item.message === message), 'message present: ' + message);
  assert.equal(result.errors[0].line, 1, 'the defect is pinned to line 1: ' + message);
}

// ---- File-level defects are reported without a line number.
const noEof = inspect(file(record(0, 0, [1, 2, 3, 4])));
assert.equal(noEof.errorCount, 1);
assert.deepEqual(noEof.errorLines, [null]);
assert.equal(noEof.errors[0].message, 'The file has no end-of-file record (:00000001FF).');
const afterEof = inspect(file(record(0, 0, [1]), eof, record(0x10, 0, [2])));
assert.deepEqual(afterEof.errorLines, [3]);
assert.equal(afterEof.errors[0].message, 'A data record follows the end-of-file record.');
const twice = inspect(file(record(0, 0, [1]), eof, eof));
assert.deepEqual(twice.errorLines, [3]);
assert.equal(twice.errors[0].message, 'The file already ended on an earlier record.');
const empty = inspect(eof);
assert.deepEqual(empty.errorLines, [null]);
assert.equal(empty.errors[0].message, 'The file carries no data records.');

// ---- Randomised invariants: the record builder round-trips, addresses stay
// inside the reported range, and flipping one checksum is always caught.
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
let comparedBytes = 0;
for (let trial = 0; trial < 200; trial += 1) {
  const lines = [];
  const written = new Set();
  let cursor = Math.floor(random() * 0x2000);
  for (let block = 0; block < 1 + Math.floor(random() * 4); block += 1) {
    const size = 1 + Math.floor(random() * 64);
    const bytes = Array.from({ length: size }, () => Math.floor(random() * 256));
    lines.push(record(cursor, 0, bytes));
    for (let step = 0; step < size; step += 1) written.add(cursor + step);
    cursor += size + Math.floor(random() * 8);
  }
  lines.push(eof);
  const result = inspect(file(...lines));
  assert.equal(result.valid, true, 'generated image is valid: ' + trial);
  assert.equal(result.uniqueBytes, written.size, 'every address is counted once: ' + trial);
  assert.equal(result.dataBytes, written.size, 'no overlaps were generated: ' + trial);
  assert.equal(result.spanBytes, written.size + result.holes, 'span is data plus gaps: ' + trial);
  const low = parseInt(result.addressStart, 16);
  const high = parseInt(result.addressEnd, 16);
  assert.equal(high - low + 1, result.spanBytes, 'the range matches its ends: ' + trial);
  comparedBytes += result.uniqueBytes;

  // Corrupting the checksum of the first record must be caught on line 1.
  const broken = lines.slice();
  const lastPair = broken[0].slice(-2);
  broken[0] = broken[0].slice(0, -2) + (lastPair === '00' ? '01' : '00');
  const caught = inspect(file(...broken));
  assert.equal(caught.valid, false, 'a corrupted checksum is caught: ' + trial);
  assert.equal(caught.errorLines[0], 1, 'the corrupted line is named: ' + trial);
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2117, 'public tools');
assert.ok(catalog.tools.some((tool) => tool.slug === slug), 'the new record is present');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.equal(entry.name, 'Intel HEX Inspector');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.includes('browser'), 'method documents local execution');
assert.ok(entry.method.includes("two's complement"), 'method states the checksum rule');
assert.ok(entry.method.includes('modulo 4 GiB'), 'method states the linear wrap');
assert.ok(entry.description.length > 80, 'description is descriptive');
assert.ok(entry.sources.length >= 2, 'sources are cited');
for (const source of entry.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(entry.sources.some((source) => source.url.includes('srec_intel.5')), 'the specification is cited');
assert.ok(entry.sources.some((source) => source.url.includes('wikipedia.org/wiki/Intel_HEX')), 'the format overview is cited');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(entry.testCases.length, 17, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 6, 'six validation cases');
for (const testCase of entry.testCases) {
  const result = inspect(testCase.input.text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
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
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['encoding', 'firmware', 'file-format']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 5, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="hex-text">/.test(html), 'the textarea has a visible label');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'refusals are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/<form id="hex-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/<textarea id="hex-text" name="hex"/.test(html), 'the records go into a named textarea');
assert.ok(/<button type="button" class="ghost" id="example">/.test(html), 'the example button is typed');
assert.ok(/<button type="button" class="ghost" id="clear">/.test(html), 'the clear button is typed');
assert.ok(/role="alert" aria-live="polite"/.test(html), 'the error line is announced');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(html), 'the page source stays ASCII');

console.log('intel hex inspector: record layout, checksums, 200 random images, ' +
  comparedBytes + ' generated bytes, 17 catalog cases and the page contract pass');
