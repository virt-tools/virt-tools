/* ICMP message decoding: the RFC 792 field layout, the RFC 1071 checksum primitive,
   the rest-of-header fields of RFC 1191, RFC 1256, RFC 8335 and the deprecated
   types, the original datagram quoted inside an error, the outer IPv4 unwrap,
   the page's refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'icmp-message-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* icmp-message-core:start */';
const endMarker = '/* icmp-message-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
assert.ok(!/\beval\(|new Function/.test(core), 'the core does not evaluate strings');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ICMPMessageCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');

const bytesOf = (hex) => hex.trim() ? hex.trim().split(/\s+/).map((part) => parseInt(part, 16)) : [];
const hexOf = (list) => list.map((value) => (value < 16 ? '0' : '') + value.toString(16)).join(' ');
const decode = (hex) => C.decode({ hex });
// Objects built inside the vm sandbox carry that realm's prototypes, so compare them by value.
const same = (actual, expected, label) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), label);

// ---- RFC 1071 section 3: the same eight bytes, summed as 16-bit words.
const probe = [0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7];
assert.equal(C.sum16(probe), 0xddf2, 'RFC 1071 sum of 0001 f203 f4f5 f6f7');
assert.equal(C.checksum(probe), 0x220d, 'RFC 1071 complement');
assert.equal(C.sum16([0xff, 0xff, 0x00, 0x01]), 0x0001, 'a carry out of the top folds back in');
assert.equal(C.sum16([0xab]), 0xab00, 'an odd octet is padded on the right');
assert.equal(C.sum16([0xff, 0xff, 0xff, 0xff]), 0xffff, 'a carry folds back in and all-ones stays all-ones');

// ---- The type registry covers every octet, with the IANA names and deprecations.
const NAMES = [];
for (let type = 0; type < 256; type += 1) {
  const info = C.typeInfo(type);
  assert.equal(typeof info.name, 'string');
  assert.ok(info.name.length > 0, 'type ' + type + ' has a name');
  NAMES.push(info.name);
}
assert.equal(C.typeInfo(0).name, 'Echo Reply');
assert.equal(C.typeInfo(3).name, 'Destination Unreachable');
assert.equal(C.typeInfo(8).name, 'Echo');
assert.equal(C.typeInfo(9).name, 'Router Advertisement');
assert.equal(C.typeInfo(11).name, 'Time Exceeded');
assert.equal(C.typeInfo(13).name, 'Timestamp');
assert.equal(C.typeInfo(40).name, 'Photuris');
assert.equal(C.typeInfo(42).name, 'Extended Echo Request');
assert.equal(C.typeInfo(43).name, 'Extended Echo Reply');
assert.equal(C.typeInfo(20).name, 'Reserved (for Robustness Experiment)');
assert.equal(C.typeInfo(29).name, 'Reserved (for Robustness Experiment)');
assert.equal(C.typeInfo(30).name, 'Traceroute (Deprecated)');
assert.equal(C.typeInfo(44).name, 'Unassigned');
assert.equal(C.typeInfo(252).name, 'Unassigned');
assert.equal(C.typeInfo(253).name, 'RFC3692-style Experiment 1');
assert.equal(C.typeInfo(255).name, 'Reserved');
assert.equal(C.typeInfo(4).name, 'Source Quench (Deprecated)');
assert.equal(C.typeInfo(17).reference, 'RFC 950; RFC 6918');
assert.equal(NAMES.filter((name) => name.indexOf('(Deprecated)') > -1).length, 16, 'sixteen deprecated types');

// ---- Code names come from the per-type registries; a type without one has no codes.
assert.equal(C.codeInfo(0, 0), 'No Code');
assert.equal(C.codeInfo(3, 0), 'Net Unreachable');
assert.equal(C.codeInfo(3, 3), 'Port Unreachable');
assert.equal(C.codeInfo(3, 4), "Fragmentation Needed and Don't Fragment was Set");
assert.equal(C.codeInfo(3, 15), 'Precedence cutoff in effect');
assert.equal(C.codeInfo(5, 3), 'Redirect Datagram for the Type of Service and Host');
assert.equal(C.codeInfo(9, 16), 'Does not route common traffic');
assert.equal(C.codeInfo(11, 1), 'Fragment Reassembly Time Exceeded');
assert.equal(C.codeInfo(12, 2), 'Bad Length');
assert.equal(C.codeInfo(40, 5), 'Need Authorization');
assert.equal(C.codeInfo(43, 4), 'Multiple Interfaces Satisfy Query');
assert.equal(C.codeInfo(3, 16), 'Unassigned');
assert.equal(C.codeInfo(43, 9), 'Unassigned');
assert.equal(C.codeInfo(7, 0), 'Not specified');
assert.equal(C.codeInfo(255, 0), 'Not specified');

// ---- RFC 792: echo reply, 40 bytes over 32 bytes of data.
const echoHex = '00 00 39 15 1c 46 00 01 61 62 63 64 65 66 67 68 69 6a 6b 6c 6d 6e 6f 70 71 72 73 74 75 76 77 61 62 63 64 65 66 67 68 69';
const echo = decode(echoHex);
assert.equal(echo.type, 0);
assert.equal(echo.typeName, 'Echo Reply');
assert.equal(echo.codeName, 'No Code');
assert.equal(echo.checksum, 0x3915);
assert.equal(echo.checksumExpected, 0x3915);
assert.equal(echo.checksumValid, true);
assert.equal(echo.identifier, 0x1c46);
assert.equal(echo.sequence, 1);
assert.equal(echo.payloadLength, 32);
assert.equal(echo.messageLength, 40);
assert.equal(echo.headline, 'Echo Reply (type 0, code 0)');
assert.equal(echo.subline, '40 bytes of ICMP, checksum verified, 32 data bytes');
assert.equal(echo.rows[0][1], 'Echo Reply (0)');
assert.equal(C.parseBytes({ hex: echoHex }).length, 40, 'the object input form is accepted');
assert.equal(C.parseBytes(echoHex).length, 40, 'the string input form is accepted');

// A stored checksum of zero is legal when the complement of the sum is zero.
const zeroSum = decode('00 00 00 00 ff ff ff ff');
assert.equal(zeroSum.checksum, 0);
assert.equal(zeroSum.checksumExpected, 0);
assert.equal(zeroSum.checksumValid, true);

// An odd octet is padded for the sum, so a nine-byte message still verifies when built that way.
const oddBody = bytesOf('08 00 00 00 00 01 00 01 aa');
const oddSum = C.checksum(oddBody);
oddBody[2] = oddSum >> 8;
oddBody[3] = oddSum & 0xff;
const odd = decode(hexOf(oddBody));
assert.equal(odd.messageLength, 9);
assert.equal(odd.payloadLength, 1);
assert.equal(odd.checksumValid, true, 'a valid odd-length checksum verifies');

// ---- RFC 1191: the fragmentation-needed message carries the next-hop MTU.
const frag = decode('03 04 e6 ec 00 00 05 78 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 fa f0 00 00 00 00');
assert.equal(frag.kind, 'mtu');
assert.equal(frag.mtu, 1400);
assert.equal(frag.codeName, "Fragmentation Needed and Don't Fragment was Set");
assert.equal(frag.embedded.protocol, 6);
assert.equal(frag.embedded.source, '192.0.2.1');
assert.equal(frag.embedded.destination, '198.51.100.2');
assert.equal(frag.embedded.sourcePort, 49152);
assert.equal(frag.embedded.destinationPort, 443);
assert.equal(frag.embedded.dataBytes, 20);
assert.equal(frag.embedded.complete, true);
assert.ok(frag.noteText.indexOf('The checksum verifies') === 0);
const zeroMtu = decode('03 04 ec 64 00 00 00 00 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 fa f0 00 00 00 00');
assert.equal(zeroMtu.mtu, 0);
assert.match(zeroMtu.noteText, /did not report one/);

// ---- RFC 792 redirect: the gateway sits where the rest-of-header field is.
const redirect = decode('05 01 ae 65 cb 00 71 01 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 fa f0 00 00 00 00');
assert.equal(redirect.gateway, '203.0.113.1');
assert.equal(redirect.embedded.sourcePort, 49152);

// ---- Parameter problem: a pointer octet, and a zero unused tail.
const pointer = decode('0c 00 d7 68 0c 00 00 00 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 fa f0 00 00 00 00');
assert.equal(pointer.pointer, 12);
assert.equal(pointer.kind, 'pointer');
assert.equal(pointer.rows[3][1], '12 octets into the original datagram');

// ---- RFC 792 timestamps: milliseconds since midnight UTC when the clock has that base.
assert.equal(C.msText(0), '0 ms (00:00:00.000 from midnight UTC)');
assert.equal(C.msText(3723004), '3723004 ms (01:02:03.004 from midnight UTC)');
assert.equal(C.msText(86399999), '86399999 ms (23:59:59.999 from midnight UTC)');
const stamp = decode('0e 00 71 55 12 34 00 09 00 38 ce fc 00 38 cf 61 00 38 cf 66');
assert.equal(stamp.originate, 3723004);
assert.equal(stamp.receive, 3723105);
assert.equal(stamp.transmit, 3723110);
assert.equal(stamp.rows[4][1], '3723004 ms (01:02:03.004 from midnight UTC)');
assert.equal(stamp.kind, 'timestamp');

// ---- Address mask and Photuris SPI.
assert.equal(decode('12 00 ee fe ff ff ff 00').mask, '255.255.255.0');
assert.equal(decode('28 00 6f 53 12 34 56 78').spi, 305419896);
assert.equal(decode('28 00 6f 53 12 34 56 78').kind, 'spi');

// ---- RFC 1256: count, entry size in words, lifetime and signed preferences.
const advert = decode('09 00 69 8d 02 02 07 08 c0 00 02 01 00 00 00 64 c0 00 02 02 ff ff ff ff');
assert.equal(advert.numAddrs, 2);
assert.equal(advert.entrySize, 2);
assert.equal(advert.lifetime, 1800);
same(advert.routers, [
  { address: '192.0.2.1', preference: 100 },
  { address: '192.0.2.2', preference: -1 }
], 'routers with a signed preference');
assert.equal(advert.rows[5][1], '1800 s');
const advert3 = decode('09 00 9c 45 02 03 03 84 c6 33 64 01 00 00 00 00 00 00 00 00 c6 33 64 02 00 00 00 c8 00 00 00 00');
assert.equal(advert3.entrySize, 3);
same(advert3.routers, [
  { address: '198.51.100.1', preference: 0 },
  { address: '198.51.100.2', preference: 200 }
], 'routers in 12-byte entries');
// The advertised count can promise more routers than the bytes carry.
const shortAdvert = decode('09 00 00 00 03 02 07 08 c0 00 02 01 00 00 00 64');
assert.equal(shortAdvert.routers.length, 1);
assert.match(shortAdvert.noteText, /advertises 3 routers but only 1 fit/);

// ---- Error messages quote the original datagram: ports, the 8-byte minimum and the quote length.
const unreachable = decode('03 03 e7 d1 00 00 00 00 45 00 00 20 12 34 40 00 40 11 3c 47 c0 00 02 0a c6 33 64 14 14 e9 00 35 00 0c 00 00 00 01 00 00');
assert.equal(unreachable.embedded.protocol, 17);
assert.equal(unreachable.embedded.protocolName, 'UDP');
assert.equal(unreachable.embedded.sourcePort, 5353);
assert.equal(unreachable.embedded.destinationPort, 53);
assert.equal(unreachable.embedded.quotedBytes, 32);
assert.equal(unreachable.embedded.dataBytes, 12);
assert.equal(unreachable.embedded.complete, true);
assert.equal(unreachable.rows.length, 5);
const innerEcho = decode('0b 00 f4 ff 00 00 00 00 45 00 00 24 22 22 40 00 40 01 2c 75 c0 00 02 05 c6 33 64 09 08 00 f6 fa 01 02 00 03 00 00 00 00 00 00 00 00');
assert.equal(innerEcho.embedded.protocol, 1);
assert.equal(innerEcho.embedded.sourcePort, null, 'an inner ICMP message has no ports');
assert.equal(innerEcho.embedded.dataBytes, 16);
// A quote shorter than the original datagram is by design, not a defect.
const longQuote = decode('0b 00 2f 5c 00 00 00 00 45 00 05 dc 12 34 40 00 40 06 36 b1 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8');
assert.equal(longQuote.embedded.totalLength, 1500);
assert.equal(longQuote.embedded.quotedBytes, 28);
assert.match(longQuote.noteText, /shorter by design/);
// Four data bytes cannot carry a full port pair and are reported as incomplete.
const shortQuote = decode('0c 00 0a 44 28 00 00 00 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb');
assert.equal(shortQuote.embedded.dataBytes, 4);
assert.equal(shortQuote.embedded.complete, false);
assert.match(shortQuote.noteText, /past the 20-byte header of the quoted datagram/);
// An error without a quote and one with a truncated header both explain themselves.
const bare = decode('03 01 fc fe 00 00 00 00');
same(bare.embedded, { truncated: true, quotedBytes: 0 }, 'no quote');
assert.match(bare.noteText, /No original datagram follows/);
const cut = decode('03 00 e9 37 00 00 00 00 45 00 00 28 77 77 40 00 40 06 d7 21');
same(cut.embedded, { truncated: true, quotedBytes: 12 }, 'truncated quote');
assert.match(cut.noteText, /IPv4 header is incomplete/);

// ---- A complete IPv4 packet is unwrapped; trailing padding is reported.
const packet = decode('45 00 00 54 12 34 40 00 40 01 3c 39 c0 00 02 01 c6 33 64 07 08 00 be a9 42 42 00 01 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 20 21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2e 2f 30 31 32 33 34 35 36 37');
assert.equal(packet.headerOffset, 20);
assert.equal(packet.messageLength, 64);
assert.equal(packet.type, 8);
assert.equal(packet.identifier, 16962);
assert.equal(packet.payloadLength, 56);
assert.equal(packet.checksumValid, true);
assert.equal(packet.subline, '64 bytes of ICMP after a 20-byte IPv4 header, checksum verified, 56 data bytes');
assert.match(packet.noteText, /protocol field is 1, so its 20 bytes were skipped/);
const padded = decode(packet.noteText ? '45 00 00 54 12 34 40 00 40 01 3c 39 c0 00 02 01 c6 33 64 07 08 00 be a9 42 42 00 01 00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f 10 11 12 13 14 15 16 17 18 19 1a 1b 1c 1d 1e 1f 20 21 22 23 24 25 26 27 28 29 2a 2b 2c 2d 2e 2f 30 31 32 33 34 35 36 37 aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa' : '');
assert.equal(padded.headerOffset, 20);
assert.equal(padded.messageLength, 64);
assert.match(padded.noteText, /the last 16 pasted bytes lie outside the packet/);

// ---- Checksum mismatch and the deprecated types are reported, never hidden.
const broken = decode('08 00 08 fd 00 01 00 01 00 00 00 00 00 00 00 00');
assert.equal(broken.checksumValid, false);
assert.equal(broken.checksumExpected, 63485);
assert.match(broken.noteText, /does not verify/);
const deprecated = decode('1e 00 e1 fc 00 01 00 02');
assert.ok(deprecated.typeName.indexOf('(Deprecated)') > -1);
assert.match(deprecated.noteText, /RFC 6918 deprecates/);
const unassignedCode = decode('07 03 f8 fc 00 00 00 00');
assert.equal(unassignedCode.codeName, 'Not specified');
// A non-zero unused field is called out against RFC 792.
const dirtyUnused = decode('0b 00 e4 61 00 00 00 07 45 00 00 28 77 77 40 00 40 06 d7 21 c0 00 02 01 c6 33 64 02 c0 00 01 bb 00 00 03 e8 00 00 00 00 50 02 fa f0 00 00 00 00');
assert.match(dirtyUnused.noteText, /unused field is not zero: 00 00 00 07/);

// ---- Refusals: the page never guesses at bytes it cannot read.
function refuses(hex, message) {
  assert.throws(() => decode(hex), (error) => {
    assert.equal(error.message, message);
    return true;
  });
}
refuses('', 'Paste the hex bytes of an ICMP message, such as 08 00 4d 5a 00 01 00 01.');
refuses('00 00 00 00 00 00 00', 'An ICMP message is at least 8 bytes; 7 were pasted.');
refuses('08 00 4d 5', '"5" has an odd number of hex digits.');
refuses('08 00 zz 00 00 01 00 01', '"zz" is not a hex byte.');
refuses('60 00 00 00 00 08 3a 40 20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 01 20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 02 80 00 00 00 00 01 00 01',
  'These bytes begin with an IPv6 header. ICMPv6 has its own type registry and a pseudo-header checksum, and this page decodes ICMP for IPv4 only.');
refuses('45 00 00 28 12 34 40 00 40 06 3c 61 c0 00 02 01 c6 33 64 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00',
  'These bytes begin with an IPv4 packet whose protocol field is 6, not 1 (ICMP). Paste the ICMP message itself or a packet that carries one.');
refuses('45 00 00 14 12 34 40 00 40 01 3c 79 c0 00 02 01 c6 33 64 02',
  'The IPv4 total-length field leaves fewer than 8 bytes for an ICMP message, so there is nothing to decode.');
assert.throws(() => C.decode(' '.repeat(3) + new Array(65537).fill('00').join(' ')), /at most 65,535 bytes/);
// Offset labels from a dump are skipped, and the message still decodes.
assert.equal(decode('0000: 00 00 39 15 1c 46 00 01').identifier, 0x1c46);

// ---- A seeded sweep: the decoder is total on well-formed messages and keeps its two identities.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const random = rng(20261122);
const TYPES = [0, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 40, 42, 43, 255];
for (let index = 0; index < 250; index += 1) {
  const type = TYPES[Math.floor(random() * TYPES.length)];
  const code = Math.floor(random() * 16);
  const length = 8 + Math.floor(random() * 48);
  const body = [];
  for (let at = 0; at < length; at += 1) body.push(Math.floor(random() * 256));
  body[0] = type;
  body[1] = code;
  body[2] = 0;
  body[3] = 0;
  const sum = C.checksum(body);
  body[2] = sum >> 8;
  body[3] = sum & 0xff;
  const result = decode(hexOf(body));
  assert.equal(result.type, type);
  assert.equal(result.code, code);
  assert.equal(result.checksumValid, C.sum16(body) === 0xffff, 'the verifier identity at ' + index);
  assert.equal(result.checksumValid, true, 'a built message verifies at ' + index);
  if (type === 0 || type === 8 || type === 15 || type === 16 || type === 42 || type === 43) {
    assert.equal(result.payloadLength, length - 8);
  }
  if (type === 9) {
    assert.ok(result.routers.length <= result.numAddrs);
  }
  if (type === 3 || type === 4 || type === 5 || type === 11 || type === 12) {
    assert.ok(result.embedded, 'an error always carries a quote object');
    assert.equal(result.embedded.quotedBytes, Math.max(0, length - 8));
  }
  assert.ok(result.rows.length >= 5 && result.headline.length > 0);
}

// ---- The catalog cases replay against the page core.
assert.ok(record.testCases.length >= 20, 'the record carries a case set');
const seen = new Set();
for (const testCase of record.testCases) {
  assert.ok(['golden', 'boundary', 'validation'].includes(testCase.kind), testCase.name);
  assert.ok(!seen.has(testCase.name), 'duplicate case name ' + testCase.name);
  seen.add(testCase.name);
  if (testCase.expectedError) {
    assert.throws(() => C.decode(testCase.input), (error) => error.message === testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.decode(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'embedded') {
      for (const [innerKey, innerValue] of Object.entries(value)) {
        assert.equal(JSON.stringify(result.embedded[innerKey]), JSON.stringify(innerValue), testCase.name + ' embedded.' + innerKey);
      }
    } else {
      assert.equal(JSON.stringify(result[key]), JSON.stringify(value), testCase.name + ' ' + key);
    }
  }
}

// ---- Catalog metadata and uniqueness.
assert.equal(record.name, 'ICMP Message Decoder');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Packet analysis');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.sources.length >= 3);
for (const source of record.sources) {
  assert.ok(source.title.length > 10);
  assert.match(source.url, /^https:\/\//);
}
assert.ok(record.sources.some((source) => source.url.indexOf('rfc792') > -1));
assert.ok(record.sources.some((source) => source.url.indexOf('iana.org') > -1));
assert.match(record.method, /RFC 792/);
assert.match(record.method, /0xFFFF/);
assert.match(record.guidance, /ICMPv6 is refused/);
const lower = (text) => text.trim().toLowerCase();
const others = catalog.tools.filter((tool) => tool.slug !== slug);
assert.ok(!others.some((tool) => lower(tool.name) === lower(record.name)), 'name is unique');
for (const alias of record.aliases) {
  for (const other of others) {
    assert.ok(!(other.aliases || []).some((value) => lower(value) === lower(alias)), 'alias ' + alias + ' collides');
    assert.ok(lower(other.name) !== lower(alias), 'alias ' + alias + ' collides with a name');
  }
}

// ---- Counts and the page contract.
assert.equal(catalog.tools.length, 2527, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2266, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 58, 'Networking count');
assert.equal(new Set(catalog.tools.map((tool) => tool.slug)).size, catalog.tools.length, 'slugs are unique');

assert.match(html, /<h1>ICMP Message Decoder<\/h1>/);
assert.match(html, /<label for="hex">Message bytes \(hex\)<\/label>/);
assert.match(html, /<button type="submit">Decode<\/button>/);
assert.match(html, /role="alert" aria-live="polite"/);
assert.match(html, /id="fields-table"/);
assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/.test(html), 'no network or storage access');
assert.ok(!/<a[^>]+href="https?:/.test(html), 'no outbound links in the page');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.equal((html.match(/<script/g) || []).length, 3, 'theme, app and the tool script');
assert.match(html, /Everything runs in your browser; nothing is sent anywhere\./);
assert.ok(C.DEFAULT_HEX.length > 40);
assert.equal(C.decode(C.DEFAULT_HEX).checksumValid, true, 'the default example verifies');
console.log('icmp-message-decoder: all checks passed');
