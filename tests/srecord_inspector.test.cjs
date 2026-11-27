/* Motorola S-record inspector: independent record builder, record-type widths,
   checksum and image arithmetic, catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'srecord-inspector';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* srecord-core:start */';
const endMarker = '/* srecord-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SRecordCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const inspect = (text) => plain(C.inspect(text));
const run = (text) => plain(C.compute({ text }));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};

// ---- An independent record builder, written from the format description.
const WIDTH = { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 6: 3, 7: 4, 8: 3, 9: 2 };
function record(type, address, data) {
  const width = WIDTH[type];
  const body = [];
  for (let shift = width - 1; shift >= 0; shift -= 1) {
    body.push(Math.floor(address / 256 ** shift) % 256);
  }
  const fields = [width + data.length + 1].concat(body, data);
  const total = fields.reduce((sum, byte) => sum + byte, 0);
  const checksum = 0xFF - (total & 0xFF);
  assert.ok(0 <= checksum && checksum <= 0xFF);
  return 'S' + type + fields.concat([checksum])
    .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join('');
}
const s0 = (text) => record(0, 0, Array.from(Buffer.from(text, 'latin1')));
const s1 = (address, data) => record(1, address, data);
const s2 = (address, data) => record(2, address, data);
const s3 = (address, data) => record(3, address, data);
const s5 = (count) => record(5, count, []);
const s6 = (count) => record(6, count, []);
const s7 = (address) => record(7, address, []);
const s8 = (address) => record(8, address, []);
const s9 = (address) => record(9, address, []);

// ---- The published example checksums add up under this builder too.
const EXAMPLE = [
  'S00600004844521B',
  'S1130000285F245F2212226A000424290008237C2A',
  'S11300100002000800082629001853812341001813',
  'S113002041E900084E42234300182342000824A952',
  'S107003000144ED492',
  'S5030004F8',
  'S9030000FC',
];
assert.equal(s0('HDR'), EXAMPLE[0], 'header record');
assert.equal(record(1, 0x0000, [0x28, 0x5F, 0x24, 0x5F, 0x22, 0x12, 0x22, 0x6A,
  0x00, 0x04, 0x24, 0x29, 0x00, 0x08, 0x23, 0x7C]), EXAMPLE[1], 'first data record');
assert.equal(record(1, 0x0010, [0x00, 0x02, 0x00, 0x08, 0x00, 0x08, 0x26, 0x29,
  0x00, 0x18, 0x53, 0x81, 0x23, 0x41, 0x00, 0x18]), EXAMPLE[2], 'second data record');
assert.equal(record(1, 0x0020, [0x41, 0xE9, 0x00, 0x08, 0x4E, 0x42, 0x23, 0x43,
  0x00, 0x18, 0x23, 0x42, 0x00, 0x08, 0x24, 0xA9]), EXAMPLE[3], 'third data record');
assert.equal(record(1, 0x0030, [0x00, 0x14, 0x4E, 0xD4]), EXAMPLE[4], 'fourth data record');
assert.equal(s5(4), EXAMPLE[5], 'count record');
assert.equal(s9(0), EXAMPLE[6], 'termination record');

// ---- Constants follow the record-type table.
assert.equal(C.ADDRESS_LIMIT, 4294967296);
assert.equal(C.MAX_CHARACTERS, 1000000);
assert.equal(C.MAX_RECORDS, 50000);
assert.deepEqual(plain(C.WIDTHS), WIDTH);
for (const [type, name] of Object.entries(C.TYPE_NAMES)) {
  assert.equal(typeof name, 'string', 'type name ' + type);
}
assert.equal(C.hexValue(0), '0x0000');
assert.equal(C.hexValue(0x2FF0), '0x2FF0');
assert.equal(C.hexValue(0xFFFF), '0xFFFF');
assert.equal(C.hexValue(0x10000), '0x00010000');
assert.equal(C.hexValue(0xFFFFFFFF), '0xFFFFFFFF');

// ---- The published example is the page's own example and reads back clean.
const example = run(EXAMPLE.join('\n'));
assert.equal(example.records, 7);
assert.equal(example.dataRecords, 4);
assert.equal(example.dataBytes, 52);
assert.equal(example.uniqueBytes, 52);
assert.equal(example.overlapBytes, 0);
assert.equal(example.segments, 1);
assert.equal(example.holes, 0);
assert.equal(example.largestGap, 0);
assert.equal(example.addressStart, '0x0000');
assert.equal(example.addressEnd, '0x0033');
assert.equal(example.startAddress, '0x0000');
assert.equal(example.termination, 'S9');
assert.equal(example.header, 'HDR');
assert.equal(example.countRecords, 1);
assert.equal(example.declaredCount, 4);
assert.equal(example.mix, 'S0 1 \u00b7 S1 4 \u00b7 S5 1 \u00b7 S9 1');
assert.equal(example.errorCount, 0);
assert.equal(example.valid, true);

// ---- Record widths, checksums and the image arithmetic over a sweep.
const widths = [[1, 0xFFFF], [2, 0xFFFFFF], [3, 0xFFFFFFFF]];
let comparisons = 0;
for (const [type, top] of widths) {
  for (const length of [1, 2, 3, 4, 7, 16, 32, 64]) {
    for (const address of [0, 1, 0x10, Math.floor(top / 2), top - length + 1]) {
      if (address < 0) continue;
      const data = Array.from({ length }, (_, index) => (address + index * 37) & 0xFF);
      const endType = { 2: 9, 3: 8, 4: 7 }[WIDTH[type]];
      const text = [record(type, address, data), record(endType, address, [])].join('\n');
      const result = inspect(text);
      const expectedBlock = Array.from({ length }, (_, index) => address + index);
      comparisons += 1;
      assert.equal(result.valid, true, 'valid at ' + type + '/' + length + '/' + address + ': ' + JSON.stringify(result.errors));
      assert.equal(result.dataBytes, length, 'data bytes');
      assert.equal(result.dataRecords, 1, 'data records');
      assert.equal(result.uniqueBytes, new Set(expectedBlock).size, 'unique addresses');
      assert.equal(result.segments, 1, 'one block');
      assert.equal(result.overlapBytes, 0, 'no overlap');
      assert.equal(result.addressStart, C.hexValue(address), 'lowest address');
      assert.equal(result.addressEnd, C.hexValue(address + length - 1), 'highest address');
      assert.equal(result.startAddress, C.hexValue(address), 'start address');
      comparisons += 5;
    }
  }
}

// ---- Blocks, holes and overlaps against an independent address set.
let seed = 20261122;
const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
for (let round = 0; round < 40; round += 1) {
  const records = [];
  const occupied = new Set();
  let written = 0;
  const count = 1 + (next() % 6);
  for (let index = 0; index < count; index += 1) {
    const length = 1 + (next() % 20);
    const address = (next() % 200) * 2;
    const data = Array.from({ length }, (_, step) => (next() >> 8) & 0xFF);
    records.push(record(1, address, data));
    written += length;
    for (let step = 0; step < length; step += 1) occupied.add(address + step);
  }
  const text = records.concat([s5(count), s9(0)]).join('\n');
  const result = inspect(text);
  const ordered = Array.from(occupied).sort((a, b) => a - b);
  let blocks = 0;
  let holes = 0;
  let largest = 0;
  ordered.forEach((value, index) => {
    if (index === 0 || value !== ordered[index - 1] + 1) {
      blocks += 1;
      if (index) {
        const gap = value - ordered[index - 1] - 1;
        holes += gap;
        largest = Math.max(largest, gap);
      }
    }
  });
  assert.equal(result.valid, true, 'round ' + round + ': ' + JSON.stringify(result.errors));
  assert.equal(result.uniqueBytes, ordered.length, 'distinct addresses, round ' + round);
  assert.equal(result.segments, blocks, 'blocks, round ' + round);
  assert.equal(result.holes, holes, 'holes, round ' + round);
  assert.equal(result.largestGap, largest, 'largest gap, round ' + round);
  assert.equal(result.overlapBytes, written - occupied.size, 'overlap, round ' + round);
  comparisons += 4;
}

// ---- A rewritten byte is counted as an overlap, not as a new address.
const overlap = inspect([s1(0x0010, [1, 2, 3, 4]), s1(0x0012, [9, 9, 9]), s9(0)].join('\n'));
assert.equal(overlap.dataBytes, 7);
assert.equal(overlap.uniqueBytes, 5);
assert.equal(overlap.overlapBytes, 2);
assert.equal(overlap.segments, 1);
assert.equal(overlap.addressStart, '0x0010');
assert.equal(overlap.addressEnd, '0x0014');

// ---- The header, count and termination records have their own meanings.
const header = inspect([s0('APP'), s1(0, [1]), s9(0)].join('\n'));
assert.equal(header.header, 'APP');
assert.equal(header.mix, 'S0 1 \u00b7 S1 1 \u00b7 S9 1');
assert.equal(inspect([s1(0, [1]), s9(0)].join('\n')).header, null, 'no header is null');
assert.equal(inspect([s0('A\u0001B'), s1(0, [1]), s9(0)].join('\n')).header, 'A\u00b7B', 'unprintable header bytes are dotted');

const s6File = inspect([s2(0, [1]), s2(1, [2]), s2(2, [3]), s6(3), s8(0)].join('\n'));
assert.equal(s6File.countRecords, 1);
assert.equal(s6File.declaredCount, 3);
assert.equal(s6File.termination, 'S8');
assert.equal(s6File.valid, true);

const noStart = inspect([s1(0, [1]), s7(0)].join('\n'));
assert.equal(noStart.startAddress, '0x0000');
assert.equal(noStart.termination, 'S7');
assert.equal(inspect([s1(0, [1])].join('\n')).startAddress, null, 'no termination, no start address');

// ---- Lower-case digits, blank lines and CRLF endings are accepted.
const loose = inspect(['s1130000285f245f2212226a000424290008237c2a', '', 's9030000fc'].join('\r\n'));
assert.equal(loose.valid, true);
assert.equal(loose.dataBytes, 16);
assert.equal(loose.dataRecords, 1);

// ---- A data record may be empty; the file then has no distinct addresses.
const empties = inspect([s1(0x20, []), s9(0x20)].join('\n'));
assert.equal(empties.valid, true);
assert.equal(empties.dataBytes, 0);
assert.equal(empties.uniqueBytes, 0);
assert.equal(empties.segments, 0);
assert.equal(empties.addressStart, null);

// ---- Inputs the page refuses before reading records.
assert.equal(failure(''), 'Paste S-record lines to inspect.');
assert.equal(failure('  \n\n'), 'Paste S-record lines to inspect.');
assert.equal(failure('S'.repeat(C.MAX_CHARACTERS + 1)),
  'The text is longer than 1,000,000 characters; inspect a smaller file.');
assert.equal(failure(Array(50001).fill(s9(0)).join('\n')),
  'The file has more than 50,000 records; inspect a smaller file.');
assert.equal(failure(Array(50000).fill(s9(0)).join('\n')), null, 'the record limit itself is accepted');

// ---- Every structural problem is reported against its own line.
const problems = [
  { text: [s1(0, [0x12, 0x34]), s1(4, [0x56, 0x78]).slice(0, -2) + '00', s9(0)].join('\n'),
    line: 2, message: "The checksum is 0x00 but the record's bytes need 0x28." },
  { text: ['S4030000FB', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'Record type S4 is not defined; the types run S0 to S3 and S5 to S9.' },
  { text: ['X1130000FF', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'A record must start with the letter S.' },
  { text: ['S', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The character after S must be a record type digit from 0 to 9.' },
  { text: ['SX030000FF', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The character after S must be a record type digit from 0 to 9.' },
  { text: ['S1130000285F245F2212226A000424290008237C2G', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The record contains a character that is not a hexadecimal digit.' },
  { text: ['S1130000285F245F2212226A000424290008237C2', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The record has an odd number of hexadecimal digits.' },
  { text: ['S1', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The record is too short to hold the two-digit byte count.' },
  { text: ['S1140000285F245F2212226A000424290008237C2A', s1(0, [1]), s9(0)].join('\n'),
    line: 1, message: 'The byte count says 20 bytes, so the record needs 42 characters after its type and it carries 40.' },
  { text: ['S3030000FF', s1(0, [1]), s7(0)].join('\n'),
    line: 1, message: 'A byte count of 3 leaves no room for the 4-byte address and the checksum byte.' },
  { text: [s1(0, [1]), s9(0), s9(0)].join('\n'),
    line: 3, message: 'The file already ended on an earlier termination record.' },
  { text: [s1(0, [1]), s9(0), s1(2, [2])].join('\n'),
    line: 3, message: 'A data record follows the termination record.' },
  { text: [s1(0, [1]), s1(2, [2]), s5(3), s9(0)].join('\n'),
    line: 3, message: 'The count record says 3 data records precede it and the file carries 2 so far.' },
  { text: [s1(0, [1]), record(5, 1, [7]), s9(0)].join('\n'),
    line: 2, message: 'A count record carries the number of data records and no data bytes.' },
  { text: [s1(0, [1]), record(9, 0, [0xAA])].join('\n'),
    line: 2, message: 'A termination record carries a start address and no data bytes.' },
  { text: [s3(0xFFFFFFFE, [1, 2, 3, 4]), s7(0)].join('\n'),
    line: 1, message: 'The data record runs past the 32-bit address space at 0xFFFFFFFE.' },
];
for (const problem of problems) {
  const result = inspect(problem.text);
  assert.equal(result.valid, false, problem.message);
  assert.equal(result.errorCount, 1, 'one problem: ' + problem.message + ' ' + JSON.stringify(result.errors));
  assert.deepEqual(result.errorLines, [problem.line], 'line for: ' + problem.message);
  assert.deepEqual(result.errors, [{ line: problem.line, message: problem.message }]);
}

// ---- File-level problems carry no line number.
const noTermination = inspect([s1(0, [1]), s1(2, [2])].join('\n'));
assert.deepEqual(noTermination.errors,
  [{ line: null, message: 'The file has no termination record (S7, S8 or S9).' }]);
assert.equal(noTermination.startAddress, null);
assert.equal(noTermination.termination, null);
const noData = inspect([s9(0)].join('\n'));
assert.equal(noData.errorCount, 1, 'a file with only a termination record has no data');
assert.deepEqual(noData.errors, [{ line: null, message: 'The file carries no data records.' }]);

// ---- A record crossing the 32-bit boundary keeps only the addresses inside it.
const boundary = inspect([s3(0xFFFFFFFE, [1, 2, 3, 4]), s7(0xFFFFFFFE)].join('\n'));
assert.equal(boundary.uniqueBytes, 2);
assert.equal(boundary.addressEnd, '0xFFFFFFFF');
assert.equal(boundary.dataBytes, 4);

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2511, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2250, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Encoding').length, 57, 'Encoding count');
assert.equal(entry.category, 'Encoding');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.testCases.length, 23, 'catalog case count');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 5);
assert.equal(kinds('validation'), 12);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.text), testCase.expectedError, testCase.name);
    continue;
  }
  const result = inspect(testCase.input.text);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// The two cited sources stay absolute and name the documents they rely on.
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources missing');
for (const source of entry.sources) {
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
  assert.ok(source.title.length > 40, 'a source names the document and the part used');
}
assert.ok(entry.sources.some((source) => source.url.includes('wikipedia.org/wiki/SREC')), 'the format overview is cited');
assert.ok(entry.sources.some((source) => source.url.includes('srec_motorola.5')), 'the format manual is cited');

// ---- Uniqueness: no other record claims this slug, name or alias.
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
for (const tag of ['s-record', 'srec', 'firmware', 'checksum']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="srec-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
for (const id of ['srec-text']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 3, 'three buttons');
assert.ok(!/autocomplete="on"/.test(html), 'the textarea is not autocompleted');

console.log('srecord inspector: ' + entry.testCases.length + ' catalog cases, ' + comparisons
  + ' swept comparisons, ' + problems.length + ' problem paths and the page contract pass');
