/* DNS message decoder: the RFC 1035 layout, name compression rules, the
   rendered record data, a builder-driven sweep, the catalog replay and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dns-message-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* dns-message-core:start */';
const endMarker = '/* dns-message-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DNSMessageCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text) => plain(C.decode(text));
const failure = (text) => {
  try { run(text); } catch (error) { return error.message; }
  return null;
};
const hexstr = (bytes) => bytes.map((b) => (b < 16 ? '0' : '') + b.toString(16)).join(' ');

// ---- An independent encoder, written from RFC 1035 section 4.
const labels = (name) => {
  const out = [];
  if (name !== '.' && name !== '') {
    for (const part of name.replace(/\.$/, '').split('.')) {
      out.push(part.length, ...Array.from(Buffer.from(part, 'latin1')));
    }
  }
  out.push(0);
  return out;
};
const word = (value) => [(value >> 8) & 0xFF, value & 0xFF];
const dword = (value) => [(value >>> 24) & 0xFF, (value >>> 16) & 0xFF, (value >>> 8) & 0xFF, value & 0xFF];
const rr = (name, type, klass, ttl, rdata) => [...labels(name), ...word(type), ...word(klass), ...dword(ttl),
  ...word(rdata.length), ...rdata];
const header = (id, flags, qd, an, ns, ar) => [...word(id), ...word(flags), ...word(qd), ...word(an), ...word(ns), ...word(ar)];
const question = (name, type, klass = 1) => [...labels(name), ...word(type), ...word(klass)];
const message = (id, flags, questions, answers = [], authority = [], additional = []) => [
  ...header(id, flags, questions.length, answers.length, authority.length, additional.length),
  ...questions.flatMap((q) => question(...q)),
  ...answers.flatMap((r) => rr(...r)),
  ...authority.flatMap((r) => rr(...r)),
  ...additional.flatMap((r) => rr(...r))
];
const aBytes = (text) => text.split('.').map(Number);
const nameBytes = (name) => labels(name);
const txtBytes = (strings) => strings.flatMap((text) => [text.length, ...Array.from(Buffer.from(text, 'latin1'))]);

// ---- Exported constants.
assert.equal(C.MAX_BYTES, 65535);
assert.equal(C.DEFAULT_HEX, '2b c2 81 80 00 01 00 02 00 00 00 00 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00 00 01 00 01 c0 0c 00 01 00 01 00 00 01 2c 00 04 ac 42 93 f3 c0 0c 00 01 00 01 00 00 01 2c 00 04 68 14 17 9a');
assert.equal(Object.keys(C.TYPES).length, 103, 'the IANA type table carries every assigned type');
assert.equal(C.TYPES[1][0], 'A');
assert.equal(C.TYPES[28][0], 'AAAA');
assert.equal(C.TYPES[41][0], 'OPT');
assert.equal(C.TYPES[257][0], 'CAA');
assert.equal(C.TYPES[65280], undefined, 'an unassigned number is not in the table');
assert.equal(C.typeText(65280), 'TYPE65280', 'RFC 3597 form');
assert.equal(C.classText(3), 'CH');
assert.equal(C.classText(1232), 'CLASS1232');

// ---- Two messages captured from the local resolver.
const CAPTURED = {
  a: '2bc281800001000200000000076578616d706c6503636f6d0000010001c00c000100010000012c0004ac4293f3c00c000100010000012c00046814179a',
  aaaa: '83cf81800001000300000001076578616d706c6503636f6d00001c0001c00c001c00010000012b0010260647000010000000000000ac4293f3c00c001c00010000012b00102606470000100000000000006814179ac00c002e00010000012b005f001c0d020000012c6affb3616afcf44186c9076578616d706c6503636f6d00a82c9287120f63c00a4d4eaadd829f9c2d542a0bb41af0cc2c25bb488f42490a3b7d8c77959616efe2197b14ca046fe8d2d2a0291a8417c61b94eb2864d64d68000029ffd6000080000000'
};
const first = run(CAPTURED.a);
assert.equal(first.id, 0x2bc2);
assert.equal(first.flagsText, 'QR RD RA');
assert.equal(first.countsText, '1 question, 2 answers, 0 authority records, 0 additional records');
assert.equal(first.questionText, 'example.com. IN A');
assert.deepEqual(first.lines, [
  'answer | example.com. | 300 | IN | A | 172.66.147.243',
  'answer | example.com. | 300 | IN | A | 104.20.23.154'
]);
assert.equal(first.notes.length, 0);

const second = run(CAPTURED.aaaa);
assert.equal(second.questions.length, 1);
assert.equal(second.questions[0].name, 'example.com.');
assert.deepEqual(second.lines.slice(0, 2), [
  'answer | example.com. | 299 | IN | AAAA | 2606:4700:10::ac42:93f3',
  'answer | example.com. | 299 | IN | AAAA | 2606:4700:10::6814:179a'
]);
assert.equal(second.lines[2].startsWith('answer | example.com. | 299 | IN | RRSIG | 95 bytes, not decoded:'), true);
assert.equal(second.records[2].type, 46);
assert.equal(second.edns, true);
assert.equal(second.ednsText, 'UDP payload 65494, version 0, flags 0x8000');
assert.equal(second.lines[3], 'additional | . | - | 65494 | OPT | no options');

// ---- AAAA is rendered in the RFC 5952 shortest form. Vectors from section 4.
const aaaaVectors = [
  ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
  ['2001:0db8:0000:0000:0001:0000:0000:0001', '2001:db8::1:0:0:1'],
  ['2001:0db8:0000:0000:0001:0000:0000:0000', '2001:db8:0:0:1::'],
  ['2001:0db8:0000:0001:0001:0001:0001:0001', '2001:db8:0:1:1:1:1:1'],
  ['0000:0000:0000:0000:0000:0000:0000:0000', '::'],
  ['0000:0000:0000:0000:0000:0000:0000:0001', '::1'],
  ['fe80:0000:0000:0000:0202:b3ff:fe1e:8329', 'fe80::202:b3ff:fe1e:8329']
];
for (const [text, expected] of aaaaVectors) {
  const groups = text.split(':').map((group) => parseInt(group, 16));
  const bytes = groups.flatMap((group) => word(group));
  const built = message(0x0102, 0x8180, [['example.com.', 28, 1]], [['example.com.', 28, 1, 60, bytes]]);
  const record = run(hexstr(built));
  assert.equal(record.lines[0].split(' | ')[5], expected, text);
}

// ---- Each decoded type carries the fields RFC 1035 (and its registry) defines.
const typeCases = [
  [2, nameBytes('ns1.example.com.'), 'ns1.example.com.'],
  [5, nameBytes('target.example.com.'), 'target.example.com.'],
  [12, nameBytes('host.example.com.'), 'host.example.com.'],
  [15, [...word(10), ...nameBytes('mail.example.com.')], '10 mail.example.com.'],
  [16, txtBytes(['hello', 'a "quote"']), '"hello" "a \\"quote\\""'],
  [33, [...word(10), ...word(5), ...word(5060), ...nameBytes('sip.example.com.')], '10 5 5060 sip.example.com.'],
  [257, [0, 5, ...Array.from(Buffer.from('issue')), ...Array.from(Buffer.from('letsencrypt.org'))], '0 issue "letsencrypt.org"']
];
for (const [type, rdata, expected] of typeCases) {
  const built = message(0x0203, 0x8180, [['example.com.', type, 1]], [['example.com.', type, 1, 900, rdata]]);
  const record = run(hexstr(built));
  assert.equal(record.records.length, 1);
  assert.equal(record.records[0].data, expected, 'type ' + type);
  assert.equal(record.records[0].ttl, 900);
  assert.equal(record.records[0].className, 'IN');
}

// SOA: two names and five 32-bit fields.
const soaData = [...nameBytes('ns1.example.com.'), ...nameBytes('hostmaster.example.com.'),
  ...dword(2024010101), ...dword(7200), ...dword(3600), ...dword(1209600), ...dword(300)];
const soaRecord = run(hexstr(message(0x0304, 0x8183, [['example.com.', 6, 1]], [], [['example.com.', 6, 1, 3600, soaData]])));
assert.equal(soaRecord.rcodeText, 'NXDOMAIN (3)');
assert.equal(soaRecord.lines[0], 'authority | example.com. | 3600 | IN | SOA | ns1.example.com. hostmaster.example.com. 2024010101 7200 3600 1209600 300');

// ---- Compression: a pointer to the question name, and a pointer to a pointer.
const q = [...header(0x0405, 0x8180, 1, 2, 0, 0), ...question('www.example.com.', 1)];
const cnameData = nameBytes('example.com.');
const pointerToRdata = q.length + 12;
const compressed = [
  ...q,
  0xC0, 0x0C, ...word(5), ...word(1), ...dword(60), ...word(cnameData.length), ...cnameData,
  (0xC0 | (pointerToRdata >> 8)), pointerToRdata & 0xFF, ...word(1), ...word(1), ...dword(60), ...word(4), ...aBytes('93.184.216.34')
];
const chained = run(hexstr(compressed));
assert.deepEqual(chained.lines, [
  'answer | www.example.com. | 60 | IN | CNAME | example.com.',
  'answer | example.com. | 60 | IN | A | 93.184.216.34'
]);

// A second pointer hop: the answer name points at the CNAME rdata, which itself is a pointer.
const twoHopRecord = run(hexstr([...q,
  0xC0, 0x0C, ...word(5), ...word(1), ...dword(60), ...word(2), 0xC0, 0x10,
  0xC0, 0x2D, ...word(1), ...word(1), ...dword(60), ...word(4), ...aBytes('198.51.100.1')]));
assert.equal(twoHopRecord.records[0].name, 'www.example.com.');
assert.equal(twoHopRecord.records[1].name, 'example.com.', 'a pointer through a pointer resolves');

// ---- Header fields and counts.
const queryOnly = run(hexstr(message(0xBEEF, 0x0100, [['example.com.', 1, 1]])));
assert.equal(queryOnly.headline, 'Query, NOERROR (0)');
assert.equal(queryOnly.flagsText, 'RD');
assert.equal(queryOnly.opcodeText, 'QUERY (0)');
assert.equal(queryOnly.id, 0xBEEF);
assert.equal(queryOnly.idText, '0xbeef (48879)');
assert.equal(queryOnly.questionLines[0], 'example.com. | IN | A');

const allFlags = run(hexstr(message(0x0506, 0x87F0, [['example.com.', 1, 1]])));
assert.equal(allFlags.flagsText, 'QR AA TC RD RA Z AD CD');
assert.equal(allFlags.notes.some((note) => note.includes('TC bit')), true);

// ---- Two questions are decoded in order.
const twoQuestions = run(hexstr(message(0x0607, 0x0100, [['example.com.', 1, 1], ['example.net.', 28, 1]])));
assert.equal(twoQuestions.questions.length, 2);
assert.deepEqual(twoQuestions.questionLines, ['example.com. | IN | A', 'example.net. | IN | AAAA']);
assert.equal(twoQuestions.countsText, '2 questions, 0 answers, 0 authority records, 0 additional records');

// ---- EDNS0: payload size, DO bit, options and the extended response code.
const cookie = [0x00, 0x0A, 0x00, 0x08, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6, 0x07, 0x08];
const optHeader = (payload, ttl, rdata) => [0, ...word(41), ...word(payload), ...dword(ttl), ...word(rdata.length), ...rdata];
const edns = run(hexstr([...header(0x0708, 0x8180, 1, 0, 0, 1), ...question('example.com.', 1), ...optHeader(1232, 0x00008000, cookie)]));
assert.equal(edns.edns, true);
assert.equal(edns.ednsText, 'UDP payload 1232, version 0, flags 0x8000');
assert.equal(edns.records[0].typeText, 'OPT');
assert.equal(edns.records[0].className, '1232');
assert.equal(edns.records[0].data, 'option 10 (8 bytes): a1 b2 c3 d4 e5 f6 07 08');
assert.equal(edns.notes[0].includes('DO bit set'), true);

const badvers = run(hexstr([...header(0x0809, 0x8180, 1, 0, 0, 1), ...question('example.com.', 1), ...optHeader(1232, 1 << 24, [])]));
assert.equal(badvers.rcode, 16);
assert.equal(badvers.rcodeText, 'BADVERS (16)');
assert.equal(badvers.notes.some((note) => note.includes('extended by the OPT record')), true);

// ---- Trailing bytes are a note, not a failure.
const trailing = run(hexstr(message(0x090A, 0x8180, [['example.com.', 1, 1]], [['example.com.', 1, 1, 60, aBytes('203.0.113.9')]]).concat([0xAA, 0xBB])));
assert.equal(trailing.notes[0], '2 bytes after the last record are not part of any section.');
assert.equal(trailing.records.length, 1);

// ---- Unknown types keep their bytes.
const unknown = run(hexstr(message(0x0A0B, 0x8180, [['example.com.', 65280, 1]], [['example.com.', 65280, 1, 60, [1, 2, 3]]])));
assert.equal(unknown.lines[0], 'answer | example.com. | 60 | IN | TYPE65280 | 3 bytes, not decoded: 01 02 03');

// ---- Refusals name the reason and the byte.
assert.equal(failure(''), 'Paste the hex bytes of a DNS message, such as 12 34 81 80 00 01 00 01.');
assert.equal(failure('  \n\t '), 'Paste the hex bytes of a DNS message, such as 12 34 81 80 00 01 00 01.');
assert.equal(failure('12 34 zz'), '"zz" is not a hex byte.');
assert.equal(failure('12 34 8'), '"8" has an odd number of hex digits.');
assert.equal(failure('0xzz: 12 34'), 'The offset label "0xzz:" is not hex.');
assert.equal(failure('12 34 81 80 00 01 00 00 00 00 00'), 'A DNS message is at least 12 bytes; 11 were pasted.');
assert.equal(failure(hexstr([...header(1, 0x0100, 1), 0x47, ...Array.from(Buffer.from('xample')), 0])),
  'The length byte at byte 12 sets the top two bits, so it is neither a label nor a compression pointer.');
assert.match(failure(hexstr([...header(1, 0x0100, 1), 0xC0, 0xF0])), /points to byte 240, past the end of the 14-byte message/);
assert.match(failure(hexstr([...header(1, 0x0100, 1), 0xC0, 0x0E, ...new Array(26).fill(0)])), /points forward to byte 14/);
assert.match(failure(hexstr([...header(1, 0x0100, 1), 0xC0, 0x0C])), /points forward to byte 12/);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 1), 0xC0, 0x0C, ...word(1), ...word(1), ...dword(60), ...word(3), 1, 2, 3])),
  /An A record must carry 4 bytes of address; this one declares 3\./);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 28), 0xC0, 0x0C, ...word(28), ...word(1), ...dword(60), ...word(15), ...new Array(15).fill(0)])),
  /An AAAA record must carry 16 bytes of address; this one declares 15\./);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 1)])),
  /declares 1 answer record but the message ends after 0\./);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 0, 0, 1), ...question('example.com.', 1), ...labelName('example.com.'), ...word(41), ...word(1232), ...dword(0), ...word(0)])),
  /The OPT record's name must be the root/);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 5), ...labelName('example.com.'), ...word(5), ...word(1), ...dword(60), ...word(4), ...nameBytes('a.'), 0, 0])),
  /must be one domain name; the record carries 1 byte after it\./);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 16), ...labelName('example.com.'), ...word(16), ...word(1), ...dword(60), ...word(4), 5, 97, 98, 99])),
  /claims 5 bytes, past the end of the record data/);
assert.match(failure(hexstr([...header(1, 0x8180, 1, 1, 0, 0), ...question('example.com.', 1), ...labelName('example.com.'), ...word(1), ...word(1), ...dword(60), ...word(20), 1, 2])),
  /declares 20 bytes of data but only 2 remain/);

function labelName(name) { return labels(name); }

// A 255-byte name is the limit; 256 is refused.
const maxName = [63, 63, 63, 61].map((n) => 'a'.repeat(n)).join('.') + '.';
const longOk = run(hexstr([...header(1, 0x0100, 1), ...question(maxName, 1)]));
assert.equal(longOk.questions[0].name.length, 254);
assert.match(failure(hexstr([...header(1, 0x0100, 1), ...question('a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.', 1)])),
  /longer than the 255-byte DNS limit/);

// ---- A builder sweep: random names, TTLs and record types, compared with what was encoded.
let seed = 20261119;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const randomLabel = () => {
  const length = 1 + Math.floor(random() * 12);
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += pick('abcdefghijklmnopqrstuvwxyz0123456789-');
  }
  return text.replace(/^-|-$/g, 'x');
};
let sweep = 0;
let sweepCases = 0;
for (let iteration = 0; iteration < 800; iteration += 1) {
  const name = randomLabel() + '.' + randomLabel() + '.example.';
  const answers = [];
  const expected = [];
  const answerCount = Math.floor(random() * 3);
  for (let index = 0; index < answerCount; index += 1) {
    const ttl = Math.floor(random() * 86400);
    const type = pick([1, 2, 5, 15, 16]);
    if (type === 1) {
      const address = [Math.floor(random() * 256), 203, 113, Math.floor(random() * 256)];
      answers.push([name, 1, 1, ttl, address]);
      expected.push('answer | ' + name + ' | ' + ttl + ' | IN | A | ' + address.join('.'));
    } else if (type === 15) {
      const preference = Math.floor(random() * 100);
      const exchange = randomLabel() + '.example.';
      answers.push([name, 15, 1, ttl, [...word(preference), ...nameBytes(exchange)]]);
      expected.push('answer | ' + name + ' | ' + ttl + ' | IN | MX | ' + preference + ' ' + exchange);
    } else if (type === 16) {
      const text = randomLabel();
      answers.push([name, 16, 1, ttl, txtBytes([text])]);
      expected.push('answer | ' + name + ' | ' + ttl + ' | IN | TXT | "' + text + '"');
    } else {
      const target = randomLabel() + '.example.';
      answers.push([name, type, 1, ttl, nameBytes(target)]);
      expected.push('answer | ' + name + ' | ' + ttl + ' | IN | ' + (type === 2 ? 'NS' : 'CNAME') + ' | ' + target);
    }
  }
  const id = Math.floor(random() * 65536);
  const built = message(id, random() < 0.5 ? 0x8180 : 0x0100, [[name, 1, 1]], answers);
  const decoded = run(hexstr(built));
  assert.equal(decoded.id, id);
  assert.equal(decoded.questions[0].name, name);
  assert.equal(decoded.questions[0].typeText, 'A');
  assert.deepEqual(decoded.lines, expected, 'sweep ' + iteration);
  sweep += name.length + answers.length;
  sweepCases += 1;
}
assert.equal(sweepCases, 800);

// ---- The object form the catalog harness passes.
assert.equal(C.decode({ hex: CAPTURED.a }).id, 0x2bc2);
assert.equal(C.parseOnly({ hex: CAPTURED.a }).length, 61);

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'DNS Message Decoder');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Packet analysis');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-19T01:45:00Z');
assert.ok(record.method.includes('RFC 1035'), 'method names the layout');
assert.ok(record.method.includes('RFC 6891'), 'method names EDNS0');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.guidance.length > 200, 'guidance covers the limits');
assert.equal(record.sources.length, 4, 'four sources are cited');
assert.equal(record.sources[3].url, 'https://www.iana.org/assignments/dns-parameters/dns-parameters-4.csv');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 33, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 9, 'nine boundary cases');
assert.equal(kinds('validation'), 14, 'fourteen validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const text = testCase.input.hex;
  if (testCase.kind === 'validation') {
    assert.equal(failure(text), testCase.expected.error, testCase.name);
    continue;
  }
  const actual = run(text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ' ' + key);
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
for (const tag of ['networking', 'dns', 'packet-analysis', 'wire-format']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2468, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2207, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 55, 'networking records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 14, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="hex">/.test(html), 'the byte field has a label');
assert.ok(/<textarea id="hex"/.test(html), 'the message is pasted into a textarea');
assert.ok(/rows="5"/.test(html), 'the textarea starts at five rows');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.equal((html.match(/<caption>/g) || []).length, 3, 'each table is captioned');
assert.ok(/<th scope="row">/.test(html) && /<th scope="col">/.test(html), 'the tables carry headers');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/overflow-x:auto/.test(html), 'the record table scrolls instead of clipping');
assert.ok(/pre-wrap/.test(html), 'the pasted bytes wrap instead of clipping');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one textarea');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');
assert.ok(html.includes('IANA'), 'the method names the type registry');

console.log('dns message decoder: RFC 1035 layout, ' + sweepCases + ' sweep messages, '
  + aaaaVectors.length + ' RFC 5952 cases, ' + record.testCases.length + ' catalog cases, '
  + checked + ' replayed values and the page contract pass');
