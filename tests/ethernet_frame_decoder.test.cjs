/* Ethernet frame decoding: the IEEE 802.3 field layout, the CRC-32 primitive, the tag walk,
   the LLC and SNAP headers, the page parser's refusals, the oracle fixtures, the catalog
   cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ethernet-frame-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ethernet-frame-core:start */';
const endMarker = '/* ethernet-frame-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EthernetFrameCore;', sandbox);
const C = sandbox.module.exports;

const bytesOf = (text) => text.trim().split(/\s+/).map((part) => parseInt(part, 16));
const hexOf = (list) => list.map((value) => (value < 16 ? '0' : '') + value.toString(16)).join(' ');
const decode = (hex) => C.decode({ hex });
const refused = (hex) => {
  try { C.decode({ hex: hex == null ? '' : hex }); } catch (error) { return error.message; }
  return null;
};

// ---- CRC-32: the published check value for "123456789" and the magic residue.
const check = Array.from(Buffer.from('123456789', 'ascii'));
assert.equal(C.crc32(check, 0, check.length), 0xcbf43926, 'the standard CRC-32 check value');
assert.equal(C.crc32([], 0, 0), 0x00000000, 'an empty CRC is the post-complemented initial value');
// Appending the CRC least significant octet first and summing again leaves the magic residue.
const sample = bytesOf(C.defaultHex);
const body = sample.slice(0, sample.length - 4);
const crc = C.crc32(body, 0, body.length);
const framed = body.concat([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff]);
assert.equal(C.crc32(framed, 0, framed.length), 0x2144df1c, 'the Ethernet FCS verify value');
assert.deepEqual(framed, sample, 'the default example ends in its own little-endian CRC');

// ---- Addresses: the group and local bits, and the broadcast form.
const remainder = '00 1a 2b 3c 4d 5f 08 00 45 00 00 14 00 00 00 00 40 11 00 00 c0 00 02 01 c6 33 64 07';
function withDestination(text) {
  return decode(text + ' ' + remainder);
}
const broadcast = withDestination('ff ff ff ff ff ff 00 1a 2b 3c 4d 5f');
assert.equal(broadcast.destinationKind, 'broadcast');
assert.equal(broadcast.destinationOui, 'ff:ff:ff');
const multicast = withDestination('01 80 c2 00 00 00 00 1a 2b 3c 4d 5f');
assert.equal(multicast.destinationKind, 'multicast', 'the low bit of the first octet is the group bit');
assert.equal(multicast.destinationLocal, false);
const local = withDestination('02 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f');
assert.equal(local.destinationKind, 'unicast');
assert.equal(local.destinationLocal, true, 'the next bit is the local bit');
const oddSource = decode('00 1a 2b 3c 4d 5e 03 1a 2b 3c 4d 5f 08 00 45 00 00 14 00 00 00 00 40 11 00 00 c0 00 02 01 c6 33 64 07');
assert.equal(oddSource.sourceGroup, true, 'a source with the group bit is called out');
assert.equal(oddSource.sourceLocal, true);

// ---- The type field is an EtherType at 1536 and above and a length at 1500 and below.
const ethernet = decode(C.defaultHex);
assert.equal(ethernet.frameForm, 'ethernet-ii');
assert.equal(ethernet.typeField, 0x8100, 'the field after the addresses is the tag identifier');
assert.equal(ethernet.etherType, 0x0800, 'the type follows the tag');
assert.equal(ethernet.etherTypeName, 'IPv4');
assert.equal(ethernet.vlanCount, 1);
assert.equal(ethernet.payloadOffset, 18, 'a tag moves the payload four octets further in');
assert.equal(ethernet.paddingLength, null, 'an Ethernet II frame does not carry a length');
assert.equal(ethernet.fcsPresent, true);
assert.equal(ethernet.payloadLength, 42, '20 bytes of IPv4 and 20 of TCP, plus two padding octets');

const undefinedType = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 05 dd 00 00 00 00 00 00 00 00');
assert.equal(undefinedType.frameForm, 'undefined');
assert.equal(undefinedType.typeField, 1501);
assert.equal(undefinedType.etherType, null, '1501 to 1535 is neither a length nor a type');
assert.equal(undefinedType.etherTypeName, null);

// ---- IEEE 802.3: the length field splits payload from padding exactly.
const lengthFrame = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 00 06 42 42 03 00 00 00 00 00 00 00');
assert.equal(lengthFrame.frameForm, '802.3');
assert.equal(lengthFrame.payloadLength, 6);
assert.equal(lengthFrame.paddingLength, 4);
assert.equal(lengthFrame.paddingZero, true);
assert.equal(lengthFrame.llc.dsap, 0x42);
assert.equal(lengthFrame.llc.controlBytes, 1, 'control 0x03 has its low two bits set, the U format');
assert.equal(lengthFrame.llc.snap, false);
assert.equal(lengthFrame.etherType, null, 'a plain LLC frame carries no EtherType');

const dirtyPadding = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 00 03 42 42 03 ff ff ff ff');
assert.equal(dirtyPadding.paddingLength, 4);
assert.equal(dirtyPadding.paddingZero, false, 'padding that is not zero is still reported');

const shortPayload = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 00 02 42 42 00 00 00 00 00 00');
assert.equal(shortPayload.payloadLength, 2);
assert.equal(shortPayload.llc, null, 'fewer than three octets cannot hold an LLC header');

const truncatedLength = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 00 64 42 42 03 00 00 00 00 00');
assert.equal(truncatedLength.truncated, true);
assert.equal(truncatedLength.payloadLength, 8, 'the payload stops at the end of the paste');
assert.equal(truncatedLength.paddingLength, 0);

// ---- SNAP: both service access points 0xaa and control 0x03 add the five-octet header.
const snapFrame = decode('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 00 0c aa aa 03 00 00 00 08 00 45 00 00 04');
assert.equal(snapFrame.llc.snap, true);
assert.equal(snapFrame.llc.oui, '00:00:00');
assert.equal(snapFrame.llc.pid, 0x0800);
assert.equal(snapFrame.etherType, 0x0800, 'a SNAP protocol identifier is an EtherType');
assert.equal(snapFrame.etherTypeName, 'IPv4');
assert.equal(snapFrame.inner, null, 'four octets are too short for an IPv4 header');

// ---- The FCS is reported only when the last four octets reproduce the CRC.
const stripped = decode(C.defaultHex.split(' ').slice(0, -4).join(' '));
assert.equal(stripped.fcsPresent, false);
assert.equal(stripped.payloadLength, 42, 'without an FCS the trailing octets stay in the payload count');

const damaged = decode(C.defaultHex.split(' ').slice(0, -1).join(' ') + ' 00');
assert.equal(damaged.fcsPresent, false, 'a changed trailing octet is not a valid FCS');
assert.equal(damaged.frameLength, 64);

// ---- The parser refuses rather than guesses.
assert.equal(refused('   '), 'Paste the hex bytes of an Ethernet frame, such as 00 1a 2b 3c 4d 5e.');
assert.equal(refused('00 1a zz'), '"zz" is not a hex byte.');
assert.equal(refused('00 1a 2b 3c 4d 5e 0'), '"0" has an odd number of hex digits.');
assert.equal(refused('00:1a:2b:3c:4d:5e:0'), '"0" has an odd number of hex digits.');
assert.equal(refused('0000:  00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 08 00'), null,
  'a dump offset label is ignored');
assert.equal(refused('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 08'),
  'An Ethernet header is 14 bytes; 13 were pasted.');
assert.equal(refused('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 81 00 a0'),
  'The 802.1Q C-TAG tag at byte 14 is truncated: four octets are needed and only 1 remains in the frame.');
assert.equal(refused('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f 88 a8 00 64 81 00'),
  'The 802.1Q C-TAG tag at byte 18 is truncated: four octets are needed and no octets remain in the frame.');
assert.equal(refused('00 1a 2b 3c 4d 5e 00 1a 2b 3c 4d 5f '
  + Array(9).fill('81 00 00 64').join(' ') + ' 08 00 45 00'),
  'The header carries more than eight stacked VLAN tags, which this page does not model.');

// ---- The independent oracle fixtures: frames built from the field widths, decoded twice.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ethernet_frames.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 12, 'the fixture set covers tags, lengths, LLC, SNAP and the FCS');
for (const item of fixtures.cases) {
  const actual = JSON.parse(JSON.stringify(decode(item.hex)));
  for (const [key, value] of Object.entries(item.expected)) {
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
  const raw = bytesOf(item.hex);
  if (actual.fcsPresent) {
    assert.equal(C.crc32(raw, 0, raw.length), 0x2144df1c, item.name + ': the FCS residue');
    assert.equal(actual.fcsStored, C.crc32(raw, 0, raw.length - 4), item.name + ': the stored FCS');
  } else {
    assert.notEqual(C.crc32(raw, 0, raw.length), 0x2144df1c, item.name + ': no FCS in the paste');
  }
  assert.equal(actual.frameLength, raw.length);
}
const tagged = fixtures.cases.find((item) => item.name === 'tagged IPv4 SYN');
assert.deepEqual(tagged.expected.vlanIds, [100]);
assert.equal(tagged.expected.vlanTags[0].pcp, 5);
const qinq = fixtures.cases.find((item) => item.name === 'QinQ double tag');
assert.deepEqual(qinq.expected.vlanIds, [200, 300], 'both tags are walked, in frame order');
assert.equal(qinq.expected.vlanTags[1].tpid, 0x8100);
const snapCase = fixtures.cases.find((item) => item.name === '802.3 LLC/SNAP IPv4');
assert.equal(snapCase.expected.llc.snap, true);
assert.equal(snapCase.expected.inner.text, 'IPv4, UDP, 192.0.2.1 to 198.51.100.7',
  'the inner summary starts after the eight SNAP octets');

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
assert.ok(record.sources.length >= 3);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 7, boundary: 5, validation: 6 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input.hex), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = JSON.parse(JSON.stringify(decode(testCase.input.hex)));
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
assert.match(html, /<h1>Ethernet Frame Decoder<\/h1>/);
assert.match(html, /<form id="frame-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.match(html, /<label for="hex">/);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.match(html, /nothing is pasted anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* ethernet-frame-core:start \*\//g) || []).length, 1);
assert.equal(C.defaultHex, fixtures.cases.find((item) => item.name === 'tagged IPv4 SYN').hex,
  'the default example is the tagged fixture');

console.log('ethernet-frame-decoder: field layout, CRC-32, tag walk, LLC/SNAP, ' +
  fixtures.cases.length + ' fixtures, ' + record.testCases.length + ' catalog cases, ' +
  'uniqueness and page contract OK');
