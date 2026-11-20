/* TCP header decoding: the RFC 9293 field layout, the RFC 1071 checksum primitive, the
   option walk, the pseudo-header families, the page parser's refusals, the oracle
   fixtures, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tcp-header-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* tcp-header-core:start */';
const endMarker = '/* tcp-header-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TcpHeaderCore;', sandbox);
const C = sandbox.module.exports;

const bytesOf = (hex) => hex.trim().split(/\s+/).map((part) => parseInt(part, 16));
const hexOf = (list) => list.map((value) => (value < 16 ? '0' : '') + value.toString(16)).join(' ');
const decode = (hex, extra) => C.decode(Object.assign({ hex }, extra || {}));

// ---- RFC 1071 section 3: the same eight bytes, summed as 16-bit words.
const probe = [0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7];
assert.equal(C.sum16(probe), 0xddf2, 'RFC 1071 sum of 0001 f203 f4f5 f6f7');
assert.equal(C.checksum(probe), 0x220d, 'RFC 1071 complement');
assert.equal(C.sum16([0xff, 0xff, 0x00, 0x01]), 0x0001, 'a carry out of the top folds back in');
assert.equal(C.sum16([0xab]), 0xab00, 'an odd octet is padded on the right for the sum');

// ---- Control flags: one bit each, in the order the figure prints them.
const FLAG_CASES = [
  [0x80, 'CWR'], [0x40, 'ECE'], [0x20, 'URG'], [0x10, 'ACK'],
  [0x08, 'PSH'], [0x04, 'RST'], [0x02, 'SYN'], [0x01, 'FIN']
];
const plain = 'c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 00 00 00 00 00 00';
function patched(index, value) {
  const list = bytesOf(plain);
  list[index] = value;
  return hexOf(list);
}
for (const [bit, name] of FLAG_CASES) {
  const result = decode(patched(13, bit));
  assert.equal(result.flagsText, name, 'flag 0x' + bit.toString(16));
  assert.equal(result.flagCount, 1);
  assert.equal(result.flagByte, bit);
}
const allFlags = decode(patched(13, 0xff));
assert.equal(allFlags.flagsText, 'CWR ECE URG ACK PSH RST SYN FIN');
assert.equal(allFlags.flagCount, 8);
assert.equal(allFlags.flags.syn, true);
assert.equal(decode(patched(13, 0x00)).flagsText, 'none set');
assert.equal(decode(patched(13, 0x00)).flagCount, 0);
assert.equal(decode(patched(13, 0x12)).flagsText, 'ACK SYN');

// ---- The data offset nibble is the header length in 32-bit words, four at the least.
for (let words = 5; words <= 15; words += 1) {
  const list = bytesOf(plain).concat(new Array(words * 4 - 20).fill(1));
  list[12] = (words << 4) | (list[12] & 0x0f);
  const result = decode(hexOf(list));
  assert.equal(result.dataOffset, words);
  assert.equal(result.headerLength, words * 4);
  assert.equal(result.optionsLength, words * 4 - 20);
  assert.equal(result.payloadLength, 0, 'a header pasted alone has no data');
}
const reserved = decode(patched(12, 0x53));
assert.equal(reserved.reserved, 3, 'the low nibble of byte 12 is reserved');
assert.equal(reserved.headerLength, 20, 'and the high nibble is still the data offset');

// ---- Ports, sequence numbers and the window are unsigned 16- and 32-bit fields.
const big = decode('ff ff ff ff ff ff ff ff ff ff ff ff 50 10 ff ff 00 00 ff ff');
assert.equal(big.sourcePort, 65535);
assert.equal(big.destinationPort, 65535);
assert.equal(big.sequence, 0xffffffff);
assert.equal(big.acknowledgment, 0xffffffff);
assert.equal(big.window, 0xffff);
assert.equal(big.urgentPointer, 0xffff);
assert.equal(big.payloadLength, 0);

// ---- Options: hand-written expectations for the kinds the RFCs define.
function withOpts(flagByte, options, reserved) {
  const words = 5 + Math.ceil(options.length / 4);
  const list = [0xc0, 0x00, 0x01, 0xbb, 0x00, 0x00, 0x03, 0xe8, 0x00, 0x00, 0x00, 0x00,
    ((words << 4) | ((reserved || 0) & 0x0f)), flagByte, 0xfa, 0xf0, 0x00, 0x00, 0x00, 0x00];
  const padded = options.concat(new Array(words * 4 - 20 - options.length).fill(0));
  return hexOf(list.concat(padded));
}
const withOptions = C.defaultHex;
const optionTexts = JSON.parse(JSON.stringify(decode(withOptions).options.map((option) => option.text)));
assert.deepEqual(optionTexts, [
  'maximum segment size 1460 bytes (0x05b4)',
  'selective acknowledgment permitted',
  'TSval 305419896, TSecr 0',
  'a single alignment byte',
  'shift count 7, so later windows are multiplied by 128'
]);
assert.deepEqual(JSON.parse(JSON.stringify(decode(withOptions).options.map((option) => option.name))), [
  'Maximum Segment Size', 'SACK Permitted', 'Timestamps', 'No-Operation', 'Window Scale'
]);
assert.equal(decode(withOptions).optionCount, 5);
assert.equal(decode(withOptions).optionsLength, 20);
assert.equal(decode(withOptions).checksumValid, true, 'the page default verifies');

const eol = decode(withOpts(0x02, [2, 4, 0x05, 0xb4, 0]));
assert.equal(eol.options.length, 3);
assert.equal(eol.options[1].text, 'ends the option list');
assert.equal(eol.options[2].name, 'Padding');
assert.equal(eol.options[2].length, 3);
assert.equal(eol.options[2].text, '3 zero bytes');

const dirtyPadding = decode(withOpts(0x02, [2, 4, 0x05, 0xb4, 0, 7, 8, 9]));
assert.match(dirtyPadding.options[2].text, /not all zero/);

const scaleCap = decode(withOpts(0x02, [3, 3, 20]));
assert.equal(scaleCap.optionScale, 20);
assert.equal(scaleCap.options[0].text, 'shift count 20, treated as 14 (RFC 7323 caps it at 14)');

const wrongMss = decode(withOpts(0x02, [2, 6, 0x05, 0xb4, 0, 0]));
assert.equal(wrongMss.options[0].text, 'malformed: an MSS option is 4 bytes, this one is 6');

const unknownKind = decode(withOpts(0x02, [0xfd, 3, 0xaa]));
assert.equal(unknownKind.options[0].name, 'RFC3692-style Experiment 1');
assert.equal(unknownKind.options[0].data, 'aa');

// ---- Window scale: a SYN window is never scaled, other segments use the supplied shift.
const synWithScale = decode(withOptions, { windowScale: '7' });
assert.equal(synWithScale.windowScale, 7);
assert.equal(synWithScale.scaledWindow, null);
assert.match(synWithScale.windowText, /a SYN window is never scaled/);
const dataSegment = decode('c0 00 01 bb 00 00 13 88 00 00 17 70 50 18 04 00 00 00 00 00 68 65 6c 6c 6f', { windowScale: '7' });
assert.equal(dataSegment.scaledWindow, 1024 * 128);
assert.equal(dataSegment.window, 1024);
assert.match(dataSegment.windowText, /x128 = 131072/);
assert.equal(decode(withOptions).scaledWindow, null, 'without a shift the window stays unscaled');

// ---- Sequence length: data plus one for SYN and one for FIN.
assert.equal(decode(withOptions).sequenceLength, 1);
assert.equal(dataSegment.sequenceLength, 5);
const finData = decode('c0 00 01 bb 00 00 27 10 00 00 30 00 50 19 04 00 00 00 00 00 62 79 65');
assert.equal(finData.sequenceLength, 4);
assert.equal(finData.flagsText, 'ACK PSH FIN');

// ---- Addresses: both families, and the IPv6 pseudo-header is forty bytes.
assert.equal(C.parseAddress('192.0.2.1', 'Source address').family, 'ipv4');
assert.equal(C.parseAddress('2001:0db8:0000:0000:0000:0000:0000:0001', 'Source address').text,
  '2001:db8::1', 'IPv6 is printed in the RFC 5952 compressed form');
assert.equal(C.parseAddress('::ffff:192.0.2.1', 'Source address').text, '::ffff:c000:201');
assert.equal(C.parseAddress('::1', 'Source address').text, '::1');
assert.equal(C.parseAddress('::', 'Source address').text, '::');
const four = decode(withOptions);
assert.equal(four.addressFamily, 'ipv4');
assert.equal(four.pseudoHeaderLength, 12, 'the IPv4 pseudo-header is twelve bytes');
assert.equal(four.checksumValid, true);
const sixBoth = decode(withOptions, { source: '2001:db8::1', destination: '2001:db8::2' });
assert.equal(sixBoth.addressFamily, 'ipv6');
assert.equal(sixBoth.pseudoHeaderLength, 40, 'the IPv6 pseudo-header is forty bytes');
assert.equal(sixBoth.checksumValid, false, 'the same bytes need a different sum over IPv6');

// ---- The parser refuses rather than guesses.
const refused = (input) => {
  try { decode(input.hex == null ? '' : input.hex, { source: input.source, destination: input.destination, windowScale: input.windowScale }); } catch (error) { return error.message; }
  return null;
};
const base = { hex: plain };
assert.equal(refused({ hex: '   ' }), 'Paste the hex bytes of a TCP segment, such as 30 39 01 bb.');
assert.equal(refused({ hex: 'c0 00 zz' }), '"zz" is not a hex byte.');
assert.equal(refused({ hex: 'c0 00 :' }), 'The offset label ":" is not hex.');
assert.equal(refused({ hex: 'c0:00:g1' }), '"g1" is not a hex byte.');
assert.equal(refused({ hex: 'c0 00 0x1' }), '"0x1" has an odd number of hex digits.');
assert.equal(refused({ hex: 'c0 00 1' }), '"1" has an odd number of hex digits.');
assert.equal(refused({ hex: 'c0 00 01 bb 00 00 03 e8 00 00 00' }), 'A TCP header is at least 20 bytes; 11 were pasted.');
assert.equal(refused({ hex: patched(12, 0x40) }),
  'The data offset field reads 4 words (16 bytes), below the 20-byte minimum.');
assert.equal(refused({ hex: patched(12, 0xf0) }),
  'The data offset field reads 60 bytes, but only 20 were pasted.');
assert.equal(refused({ hex: 'c0 00 01 bb 00 00 00 01 00 00 00 00 60 02 00 00 00 00 00 00 03 01 00 00' }),
  'The option at byte 20 (kind 3) declares a length of 1; an option length counts the kind and '
  + 'length bytes and is at least 2.');
assert.equal(refused({ hex: 'c0 00 01 bb 00 00 00 01 00 00 00 00 60 02 00 00 00 00 00 00 05 0a 00 00' }),
  'The option at byte 20 (kind 5) declares 10 bytes, past the 24-byte header.');
assert.equal(refused({ hex: 'c0 00 01 bb 00 00 00 01 00 00 00 00 60 02 00 00 00 00 00 00 01 01 01 02' }),
  'The option at byte 23 (kind 2) has no length byte inside the 24-byte header.');
assert.equal(refused({ hex: plain, source: 'example.com' }),
  'Source address is not an IPv4 or IPv6 address.');
assert.equal(refused({ hex: plain, source: '256.1.1.1' }),
  'Source address is not an IPv4 or IPv6 address.');
assert.equal(refused({ hex: plain, source: '192.0.2.1', destination: '2001:db8::1' }),
  'Source and destination addresses must be the same family.');
assert.equal(refused({ hex: plain, windowScale: '15' }),
  'Window scale must be a whole number from 0 to 14, or left unknown.');
assert.equal(refused({ hex: plain, windowScale: '7.5' }),
  'Window scale must be a whole number from 0 to 14, or left unknown.');
for (const address of ['[2001:db8::1]', '2001:db8::1%eth0', '1::2::3', '1:2:3:4:5: seis']) {
  assert.ok(refused({ hex: plain, source: address }), 'refused: ' + address);
}
assert.ok(refused({ hex: plain, source: '192.0.2.01' }), 'a leading zero is not a dotted quad');

// ---- The independent oracle fixtures: 61 segments over both families.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/tcp_header_segments.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 60, 'the fixture set covers the generated sweep');
const sackCase = fixtures.cases.find((item) => item.name === 'ACK with two SACK blocks');
const sack = decode(sackCase.input.hex, sackCase.input);
assert.equal(sack.options.length, 3);
assert.equal(sack.options[2].length, 18);
assert.equal(sack.options[2].text, '2 blocks: 4096-4128, 8192-8256');
assert.equal(sack.checksumValid, true);
for (const item of fixtures.cases) {
  const actual = JSON.parse(JSON.stringify(decode(item.input.hex, item.input)));
  for (const [key, value] of Object.entries(item.expected)) {
    if (key === 'options') {
      const mine = actual.options.map((option) => [option.kind < 0 ? null : option.kind, option.length, option.data]);
      const theirs = value.map((option) => [option.kind, option.length, option.data]);
      assert.deepEqual(mine, theirs, item.name + ': option walk');
      continue;
    }
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
}
// Every fixture either verifies or says why: a stored checksum is reproducible from the
// pseudo-header and the segment, and the sum of the whole thing is 0xffff when it does.
for (const item of fixtures.cases) {
  const result = decode(item.input.hex, item.input);
  if (result.checksumValid) {
    assert.equal(result.checksum, result.computedChecksum);
  } else {
    assert.notEqual(result.checksum, result.computedChecksum);
  }
}

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Packet analysis');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 5);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 8, validation: 7 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = JSON.parse(JSON.stringify(decode(testCase.input.hex, testCase.input)));
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: slug, name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>TCP Header Decoder<\/h1>/);
assert.match(html, /<form id="segment-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="in-/g) || []).length, 3, 'every control is labelled');
assert.match(html, /<label for="hex">/);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.match(html, /nothing is pasted anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* tcp-header-core:start \*\//g) || []).length, 1);
assert.equal(C.defaultHex, fixtures.cases.find((item) => item.name === 'SYN with five options').input.hex,
  'the default example is the verified SYN fixture');

console.log('tcp-header-decoder: field layout, RFC 1071 sum, options, pseudo-headers, ' +
  fixtures.cases.length + ' fixtures, ' + record.testCases.length + ' catalog cases, ' +
  'uniqueness and page contract OK');
