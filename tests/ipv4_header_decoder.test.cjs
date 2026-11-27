/* IPv4 header decoder: the RFC 791 field layout, the RFC 1071 header checksum,
   the IANA protocol-number registry, parser formats, refusals, a bit-packing
   sweep, the catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipv4-header-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ipv4-header-core:start */';
const endMarker = '/* ipv4-header-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Ipv4HeaderCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text) => plain(C.decode(text));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};
const hexstr = (bytes) => bytes.map((b) => (b < 16 ? '0' : '') + b.toString(16)).join(' ');

// An independent 16-bit one's-complement sum, written from RFC 1071 section 1.
const refSum = (bytes) => {
  let total = 0;
  const pairs = bytes.length - (bytes.length % 2);
  for (let at = 0; at < pairs; at += 2) {
    total += (bytes[at] << 8) | bytes[at + 1];
  }
  if (bytes.length % 2) total += bytes[bytes.length - 1] << 8;
  while (total > 0xFFFF) total = (total & 0xFFFF) + (total >>> 16);
  return total & 0xFFFF;
};
const refChecksum = (bytes) => {
  const copy = bytes.slice();
  if (copy.length >= 12) { copy[10] = 0; copy[11] = 0; }
  return (~refSum(copy)) & 0xFFFF;
};

// A header builder that packs the fields the way RFC 791 lays them out.
const build = ({ ihlWords = 5, options = [], totalLength = null, id = 0x1234, flags = 0x40,
  offset = 0, ttl = 64, protocol = 6, src = [192, 0, 2, 1], dst = [198, 51, 100, 2], ds = 0 } = {}) => {
  const headerLength = ihlWords * 4;
  const bytes = new Array(headerLength).fill(0);
  const total = totalLength === null ? headerLength : totalLength;
  bytes[0] = (4 << 4) | ihlWords;
  bytes[1] = ds;
  bytes[2] = (total >> 8) & 0xFF;
  bytes[3] = total & 0xFF;
  bytes[4] = (id >> 8) & 0xFF;
  bytes[5] = id & 0xFF;
  bytes[6] = flags | ((offset >> 8) & 0x1F);
  bytes[7] = offset & 0xFF;
  bytes[8] = ttl;
  bytes[9] = protocol;
  src.forEach((value, index) => { bytes[12 + index] = value; });
  dst.forEach((value, index) => { bytes[16 + index] = value; });
  options.forEach((value, index) => { bytes[20 + index] = value; });
  const sum = refChecksum(bytes);
  bytes[10] = sum >> 8;
  bytes[11] = sum & 0xFF;
  return bytes;
};

// ---- Exported constants.
assert.equal(C.MAX_BYTES, 65535);
assert.equal(C.DEFAULT_HEX, '45 00 00 38 4f 0b 40 00 40 11 ed a7 7f 00 00 01 7f 00 00 01');
assert.deepEqual(plain(C.ECN_TEXT), ['not ECN-capable', 'ECT(1)', 'ECT(0)', 'CE']);
assert.equal(Object.keys(C.PROTOCOLS).length, 151, 'the registry table carries every assigned number');

// ---- The RFC 1071 worked example in section 3: 00 01 f2 03 f4 f5 f6 f7 sums to ddf2.
const rfcBytes = [0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7];
assert.equal(C.sum16(rfcBytes), 0xddf2, 'RFC 1071 sum of the published example');
assert.equal(C.checksum(rfcBytes), 0x220d, 'RFC 1071 complement of the published example');
assert.equal(refSum(rfcBytes), 0xddf2, 'the test reference agrees with RFC 1071');

// ---- Headers captured from the kernel on the loopback interface must verify.
const CAPTURED = [
  ['45 00 00 38 4f 0b 40 00 40 11 ed a7 7f 00 00 01 7f 00 00 01', 'UDP', 17, 'DF'],
  ['45 c0 00 54 14 67 00 00 40 01 67 80 7f 00 00 01 7f 00 00 01', 'ICMP', 1, 'none set'],
  ['45 00 00 3c bd ee 40 00 40 06 7e cb 7f 00 00 01 7f 00 00 01', 'TCP', 6, 'DF'],
  ['45 00 00 28 00 00 40 00 40 06 3c ce 7f 00 00 01 7f 00 00 01', 'TCP', 6, 'DF'],
];
for (const [text, keyword, protocol, flags] of CAPTURED) {
  const result = run(text);
  assert.equal(result.checksumValid, true, text + ' verifies');
  assert.equal(result.protocolKeyword, keyword);
  assert.equal(result.protocol, protocol);
  assert.equal(result.flagsText, flags);
  assert.equal(result.source, '127.0.0.1');
  assert.equal(result.destination, '127.0.0.1');
  assert.equal(result.ttl, 64);
  assert.equal(result.headerLength, 20);
  const bytes = C.parseBytes(text);
  assert.equal(refSum(bytes), 0xFFFF, 'the test reference verifies ' + text);
}

// The CS6 capture carries its DSCP code in the DS byte.
const cs6 = run('45 c0 00 54 14 67 00 00 40 01 67 80 7f 00 00 01 7f 00 00 01');
assert.equal(cs6.dsField, 0xc0);
assert.equal(cs6.dscp, 48);
assert.equal(cs6.ecn, 0);
assert.equal(cs6.dsFieldText, '0xc0 (DSCP 48, ECN 0 not ECN-capable)');
assert.equal(cs6.identification, 0x1467);
assert.equal(cs6.identificationText, '0x1467 (5223)');

// ---- The protocol table matches the pinned IANA registry snapshot.
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ipv4_protocol_numbers.json'), 'utf8'));
assert.equal(fixture.source, 'https://www.iana.org/assignments/protocol-numbers/protocol-numbers-1.csv');
assert.equal(fixture.rows.length, 151);
for (const row of fixture.rows) {
  assert.deepEqual(Array.from(C.PROTOCOLS[row.decimal]), [row.keyword, row.protocol],
    'registry row ' + row.decimal);
}
assert.equal(C.protocolKeyword(6), 'TCP');
assert.equal(C.protocolText(6), '6 - TCP (Transmission Control)');
assert.equal(C.protocolKeyword(17), 'UDP');
assert.equal(C.protocolKeyword(58), 'IPv6-ICMP');
assert.equal(C.protocolKeyword(89), 'OSPFIGP');
assert.equal(C.protocolKeyword(253), 'Use for experimentation and testing');
assert.equal(C.protocolKeyword(255), 'Reserved');
assert.equal(C.protocolKeyword(148), 'Unassigned', 'the gap between 148 and 252 is unassigned');
assert.equal(C.protocolText(148), '148 - Unassigned');
assert.equal(C.protocolKeyword(61), 'any host internal protocol');
assert.equal(C.protocolText(124), '124 - ISIS over IPv4');

// ---- Formatting helpers.
assert.equal(C.hexWord(0), '0x0000');
assert.equal(C.hexWord(0x4f0b), '0x4f0b');
assert.equal(C.hexWord(0x1234), '0x1234');
assert.equal(C.hexByte(0), '0x00');
assert.equal(C.hexByte(0xc0), '0xc0');
assert.equal(C.flagsText(false, false, false), 'none set');
assert.equal(C.flagsText(false, true, false), 'DF');
assert.equal(C.flagsText(true, false, false), 'MF');
assert.equal(C.flagsText(true, true, true), 'reserved bit set, DF, MF');

// ---- The bit layout survives a sweep of fields.
const PROTOCOL_SAMPLE = [0, 1, 2, 6, 17, 41, 47, 50, 58, 89, 103, 132, 143, 147, 253, 255];
let sweep = 0;
for (const ihlWords of [5, 6, 7, 9, 11, 15]) {
  for (const offset of [0, 1, 185, 1480, 4096, 8191]) {
    for (const flags of [0x00, 0x20, 0x60, 0x40, 0xc0]) {
      for (const protocol of [6, 17, 58, 132, 253]) {
        const ihl = ihlWords;
        const options = new Array((ihl - 5) * 4).fill(0x01);
        const totalLength = Math.min(65535, ihl * 4 + ((offset + protocol) % 400));
        const src = [10, (offset >> 8) & 0xFF, offset & 0xFF, protocol];
        const dst = [172, 16, ihlWords, (flags >> 5) & 0xFF];
        const bytes = build({ ihlWords: ihl, options, totalLength,
          id: (offset * 7 + protocol) & 0xFFFF, flags, offset, ttl: (offset + 1) & 0xFF,
          protocol, src, dst, ds: (protocol * 3) & 0xFF });
        const result = run(hexstr(bytes));
        assert.equal(result.version, 4);
        assert.equal(result.headerWords, ihl);
        assert.equal(result.headerLength, ihl * 4);
        assert.equal(result.totalLength, totalLength);
        assert.equal(result.payloadLength, totalLength - ihl * 4);
        assert.equal(result.identification, (offset * 7 + protocol) & 0xFFFF);
        assert.equal(result.flagsDf, (flags & 0x40) !== 0);
        assert.equal(result.flagsMf, (flags & 0x20) !== 0);
        assert.equal(result.flagsReserved, (flags & 0x80) !== 0);
        assert.equal(result.fragmentOffset, offset);
        assert.equal(result.fragmentOffsetBytes, offset * 8);
        assert.equal(result.ttl, (offset + 1) & 0xFF);
        assert.equal(result.protocol, protocol);
        assert.equal(result.dscp, ((protocol * 3) & 0xFF) >> 2);
        assert.equal(result.ecn, (protocol * 3) & 3);
        assert.equal(result.source, src.join('.'));
        assert.equal(result.destination, dst.join('.'));
        assert.equal(result.optionsBytes, (ihl - 5) * 4);
        assert.equal(result.checksumValid, true, 'a built header verifies');
        assert.equal(result.checksum, refChecksum(bytes), 'the recorded checksum is the complement');
        assert.equal(refSum(bytes), 0xFFFF);
        sweep += 1;
      }
    }
  }
}
assert.ok(sweep >= 700, 'the sweep covers the field space: ' + sweep);

// ---- Fragment notes follow the flags.
const firstFragment = run(hexstr(build({ flags: 0x20, offset: 0, totalLength: 1500 })));
assert.equal(firstFragment.fragmentText, '0 (start of the datagram)');
assert.ok(firstFragment.noteText.includes('First fragment: MF is set'));
const middle = run(hexstr(build({ flags: 0x20, offset: 185, totalLength: 1500 })));
assert.equal(middle.fragmentText, '185 (1480 bytes into the original datagram)');
assert.ok(middle.noteText.includes('Middle fragment: the data starts at byte 1480'));
const last = run(hexstr(build({ flags: 0x00, offset: 400, totalLength: 400 })));
assert.ok(last.noteText.includes('Last fragment: the data starts at byte 3200'));
assert.equal(run(hexstr(build({ totalLength: 20 }))).noteText.includes('fragment'), false,
  'an unfragmented header carries no fragment note');

// ---- The checksum verdict is reported, never hidden behind a refusal.
const corrupted = build({ totalLength: 20 });
corrupted[5] ^= 0x01;
const broken = run(hexstr(corrupted));
assert.equal(broken.checksumValid, false);
assert.match(broken.checksumText, /^0x[0-9a-f]{4} \(does not verify; 0x[0-9a-f]{4} expected\)$/);
assert.ok(broken.protocolText.startsWith('6 - TCP'), 'the fields are still decoded');
assert.ok(broken.noteText.includes('does not verify'));
assert.equal(broken.expectedChecksum, refChecksum(corrupted));

// ---- Pasted length versus the total-length field.
const headerOnly = run(hexstr(build({ totalLength: 1500 })));
assert.ok(headerOnly.noteText.includes('Header only: the total-length field says 1500 bytes'));
const partial = run(hexstr(build({ totalLength: 40 }).concat(new Array(4).fill(0))));
assert.ok(partial.noteText.includes('Pasted 24 of the 40 bytes'));
const padded = run(hexstr(build({ totalLength: 24 }).concat(new Array(36).fill(0xaa))));
assert.ok(padded.noteText.includes('were pasted but the total-length field says 24'));
const whole = run(hexstr(build({ totalLength: 44 }).concat(new Array(24).fill(0))));
assert.equal(whole.notes.length, 0, 'a whole packet needs no note');

// ---- Parser formats: one header, six spellings.
const udp = '45 00 00 38 4f 0b 40 00 40 11 ed a7 7f 00 00 01 7f 00 00 01';
const spellings = [
  udp,
  '45:00:00:38:4f:0b:40:00:40:11:ed:a7:7f:00:00:01:7f:00:00:01',
  '450000384f0b40004011eda77f0000017f000001',
  '0x45 0x00 0x00 0x38 0x4f 0x0b 0x40 0x00 0x40 0x11 0xed 0xa7 0x7f 0x00 0x00 0x01 0x7f 0x00 0x00 0x01',
  '0x0000: 4500 0038 4f0b 4000 4011 eda7 7f00 0001\n0x0010: 7f00 0001',
  '4500,0038,4f0b,4000,4011,eda7,7f00,0001,7f00,0001',
  '  45\t00\n00 38 4f 0b 40 00 40 11 ed a7 7f 00 00 01 7f 00 00 01  ',
];
for (const text of spellings) {
  const result = run(text);
  assert.equal(result.checksum, 0xeda7, 'parsed: ' + text);
  assert.equal(result.protocolKeyword, 'UDP');
  assert.equal(C.parseOnly(text).length, 20);
}

// ---- Refusals carry the reason and nothing else.
assert.equal(failure(''), 'Paste the hex bytes of an IPv4 header, such as 45 00 00 3c.');
assert.equal(failure('   \n\t '), 'Paste the hex bytes of an IPv4 header, such as 45 00 00 3c.');
assert.equal(failure('45 00 00 38 zz 0b'), '"zz" is not a hex byte.');
assert.equal(failure('45 0'), '"0" has an odd number of hex digits.');
assert.equal(failure('45:00:0'), '"0" has an odd number of hex digits.');
assert.equal(failure('0xzz: 45 00'), 'The offset label "0xzz:" is not hex.');
assert.equal(failure('60 00 00 00 00 14 06 40 20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 01'),
  'The version nibble reads 6, so this is not an IPv4 header.');
assert.equal(failure('45 00 00 38 4f 0b 40 00 40 11 ed a7 7f 00 00 01'),
  'An IPv4 header is at least 20 bytes; 16 were pasted.');
assert.equal(failure(hexstr([0x44].concat(new Array(19).fill(0)))),
  'The header length field reads 4 words (16 bytes), below the 20-byte minimum.');
assert.equal(failure('46 00 00 14 00 00 00 00 40 06 00 00 7f 00 00 01 7f 00 00 01'),
  'The header length field reads 24 bytes, but only 20 were pasted.');
assert.equal(failure('45 00 00 10 00 00 00 00 40 06 00 00 7f 00 00 01 7f 00 00 01'),
  'The total-length field reads 16 bytes, shorter than the 20-byte header.');

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'IPv4 Header Decoder');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-18T01:30:00Z');
assert.ok(record.method.includes('RFC 791'), 'method names the field layout');
assert.ok(record.method.includes('RFC 1071'), 'method names the checksum algorithm');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.equal(record.sources.length, 4, 'four sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 27, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const text = testCase.input.hex;
  if (testCase.kind === 'validation') {
    assert.equal(failure(text), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, testCase.name + ' ' + key);
    checked += 1;
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
for (const tag of ['networking', 'ipv4', 'packet-analysis', 'checksum', 'tcp-ip']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2497, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2236, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 57, 'networking records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 14, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="hex">/.test(html), 'the byte field has a label');
assert.ok(/<textarea id="hex"/.test(html), 'the header is pasted into a textarea');
assert.ok(/rows="4"/.test(html), 'the textarea starts at four rows');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="row">/.test(html), 'the field table is described');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/pre-wrap/.test(html), 'the pasted bytes wrap instead of clipping');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one textarea');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('ipv4 header decoder: RFC 791 layout, RFC 1071 checksum, ' + sweep + ' sweep plans, '
  + record.testCases.length + ' catalog cases, ' + checked + ' replayed values and the page contract pass');
