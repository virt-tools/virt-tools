/* LLDP TLV decoder: the 802.1AB TLV layout, mandatory order, identifier
   subtypes, capability bitmaps, management addresses, organizationally
   specific TLVs, the Ethernet wrapper, a builder sweep, the catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lldp-tlv-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* lldp-core:start */';
const endMarker = '/* lldp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LLDPCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (text, format) => plain(C.decode(format ? { hex: text, format } : text));
const failure = (text, format) => {
  try { run(text, format); } catch (error) { return error.message; }
  return null;
};
const hexstr = (bytes) => bytes.map((b) => (b < 16 ? '0' : '') + b.toString(16)).join(' ');
const ascii = (text) => Array.from(Buffer.from(text, 'ascii'));
const mac = (text) => text.split(/[-:]/).map((part) => parseInt(part, 16));
const word = (value) => [(value >> 8) & 0xFF, value & 0xFF];
const tlv = (type, value) => {
  const header = (type << 9) | value.length;
  return [(header >> 8) & 0xFF, header & 0xFF, ...value];
};
const frame = (dst, src, tags, payload) => [...mac(dst), ...mac(src), ...tags, 0x88, 0xCC, ...payload];
const macChassis = (text) => tlv(1, [4, ...mac(text)]);
const namedPort = (text) => tlv(2, [5, ...ascii(text)]);
const ttl = (value) => tlv(3, word(value));
const END = tlv(0, []);
const minimalDu = [...macChassis('02-00-00-00-00-01'), ...namedPort('Gi0/1'), ...ttl(120), ...END];

// ---- Exported constants and tables.
assert.equal(C.MAX_BYTES, 9216);
assert.match(C.DEFAULT_HEX, /^[0-9a-f ]+$/);
assert.equal(Object.keys(C.TLV_TYPES).length, 10, 'ten named TLV types from 0 to 8 and 127');
assert.equal(C.TLV_TYPES[0], 'End Of LLDPDU');
assert.equal(C.TLV_TYPES[8], 'Management Address');
assert.equal(C.TLV_TYPES[127], 'Organizationally Specific');
assert.equal(C.CHASSIS_SUBTYPES[4], 'MAC address');
assert.equal(C.CHASSIS_SUBTYPES[5], 'network address');
assert.equal(C.PORT_SUBTYPES[4], 'network address');
assert.equal(C.PORT_SUBTYPES[6], 'agent circuit ID');
assert.equal(C.OUIS['00120f'], 'IEEE 802.3');
assert.equal(C.OUIS['0080c2'], 'IEEE 802.1');
assert.equal(C.OUIS['0012bb'], 'TIA TR-41 (LLDP-MED)');
assert.deepEqual(plain(C.capabilityNames(0x0014)), ['bridge', 'router']);
assert.deepEqual(plain(C.capabilityNames(0x0400)), ['two-port MAC relay']);
assert.deepEqual(plain(C.capabilityNames(0)), []);
assert.equal(C.typeName(9), 'Reserved (type 9)');
assert.equal(C.typeName(8), 'Management Address');

// ---- A ten-TLV advertisement: chassis MAC, interface name, TTL, strings,
// capability bitmaps, an IPv4 management address and the 802.3 frame size.
const SAMPLE = '02 07 04 00 11 22 33 44 55 04 06 05 47 69 30 2f 31 06 02 00 78 08 0e 55 70 6c 69 6e 6b 20 74 6f 20 63 6f 72 65 0a 09 63 6f 72 65 2d 73 77 2d 31 0c 12 41 63 6d 65 20 53 77 69 74 63 68 20 4f 53 20 31 2e 32 0e 04 00 14 00 14 10 0c 04 01 c0 00 02 0a 02 00 00 17 80 00 fe 06 00 12 0f 04 05 ee 00 00';
const sample = run(SAMPLE);
assert.equal(sample.byteLength, 98);
assert.equal(sample.tlvCount, 10);
assert.equal(sample.ended, true);
assert.equal(sample.headline, 'core-sw-1');
assert.equal(sample.chassis.subtype, 4);
assert.equal(sample.chassis.display, 'MAC 00-11-22-33-44-55');
assert.equal(sample.port.subtype, 5);
assert.equal(sample.port.display, 'interface name "Gi0/1"');
assert.equal(sample.ttl, 120);
assert.equal(sample.ttlText, '120 s');
assert.equal(sample.transmitInterval, 30, 'the default hold multiplier is 4');
assert.equal(sample.systemName, 'core-sw-1');
assert.equal(sample.systemDescription, 'Acme Switch OS 1.2');
assert.equal(sample.portDescription, 'Uplink to core');
assert.equal(sample.capabilities.supported, 20);
assert.deepEqual(sample.capabilities.supportedText, ['bridge', 'router']);
assert.deepEqual(sample.capabilities.enabledText, ['bridge', 'router']);
assert.equal(sample.management.length, 1);
assert.equal(sample.management[0].address, 'IPv4 192.0.2.10');
assert.equal(sample.management[0].interfaceText, 'ifIndex');
assert.equal(sample.management[0].interfaceNumber, 6016);
assert.equal(sample.management[0].oidLength, 0);
assert.equal(sample.organ.length, 1);
assert.equal(sample.organ[0].ouiName, 'IEEE 802.3');
assert.equal(sample.organ[0].name, 'Maximum frame size');
assert.equal(sample.organ[0].text, 'maximum frame size 1518 bytes');
assert.deepEqual(sample.notes, []);
assert.deepEqual(sample.lines, [
  '1 | 0 | 1 Chassis ID | 7 | MAC 00-11-22-33-44-55',
  '2 | 9 | 2 Port ID | 6 | interface name "Gi0/1"',
  '3 | 17 | 3 Time To Live | 2 | 120 s',
  '4 | 21 | 4 Port Description | 14 | "Uplink to core"',
  '5 | 37 | 5 System Name | 9 | "core-sw-1"',
  '6 | 48 | 6 System Description | 18 | "Acme Switch OS 1.2"',
  '7 | 68 | 7 System Capabilities | 4 | supported bridge, router; enabled bridge, router',
  '8 | 74 | 8 Management Address | 12 | IPv4 192.0.2.10, ifIndex 6016, OID absent',
  '9 | 88 | 127 Organizationally Specific | 6 | IEEE 802.3 maximum frame size 1518 bytes',
  '10 | 96 | 0 End Of LLDPDU | 0 | no value'
]);
assert.equal(C.DEFAULT_HEX, SAMPLE, 'the page starts from the sample advertisement');

// ---- Shutdown advertisement: TTL zero and no optional TLVs.
const shutdown = run(hexstr([...macChassis('02-00-00-00-00-01'), ...tlv(2, [7, ...ascii('eth0')]), ...ttl(0), ...END]));
assert.equal(shutdown.ttl, 0);
assert.equal(shutdown.ttlText, '0 s (shutdown)');
assert.equal(shutdown.transmitInterval, null);
assert.equal(shutdown.tlvCount, 4);
assert.equal(shutdown.headline, 'MAC 02-00-00-00-00-01');
assert.equal(shutdown.systemName, null);
assert.equal(shutdown.notes.length, 1);
assert.match(shutdown.notes[0], /shutdown advertisement/);

// ---- LLDP-MED endpoint: chassis component, port MAC, IPv6 management,
// MED capability and inventory TLVs and an 802.1 port VLAN ID.
const MED = '02 0a 03 43 68 61 73 73 69 73 20 31 04 07 03 00 1a 2b 3c 4d 5e 06 02 ff ff 0a 0b 6c 6f 62 62 79 2d 70 68 6f 6e 65 0e 04 00 84 00 84 10 18 10 02 20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 11 03 00 00 00 09 00 fe 06 00 12 bb 01 00 21 fe 0b 00 12 bb 0a 56 56 58 2d 34 35 30 fe 06 00 80 c2 01 00 64 00 00';
const med = run(MED);
assert.equal(med.headline, 'lobby-phone');
assert.equal(med.chassis.subtype, 3);
assert.equal(med.chassis.display, 'port component "Chassis 1"');
assert.equal(med.port.subtype, 3);
assert.equal(med.port.display, 'MAC 00-1a-2b-3c-4d-5e');
assert.equal(med.ttl, 65535);
assert.equal(med.transmitInterval, 16383.75);
assert.deepEqual(med.capabilities.supportedText, ['bridge', 'station only']);
assert.equal(med.management[0].address, 'IPv6 2001:db8::11');
assert.equal(med.management[0].interfaceText, 'system port number');
assert.equal(med.management[0].interfaceNumber, 9);
assert.deepEqual(med.organ.map((entry) => entry.name),
  ['LLDP-MED capabilities', 'Inventory - model name', 'Port VLAN ID']);
assert.equal(med.organ[1].text, 'Inventory - model name "VVX-450"');
assert.equal(med.organ[2].text, 'port VLAN ID 100');
assert.equal(med.lines.length, 10);

// ---- 802.3 MAC/PHY status and a jumbo frame size.
const PHYS = '02 07 04 02 00 00 00 00 01 04 08 05 54 65 31 2f 30 2f 31 06 02 00 1e fe 09 00 12 0f 01 03 6c 03 00 1e fe 06 00 12 0f 04 24 00 00 00';
const phys = run(PHYS);
assert.equal(phys.transmitInterval, 7.5);
assert.equal(phys.organ[0].text, 'MAC/PHY status: autonegotiation supported and enabled, advertised capability 0x6c03, MAU type 30');
assert.equal(phys.organ[1].text, 'maximum frame size 9216 bytes');
assert.equal(phys.lines[3], '4 | 23 | 127 Organizationally Specific | 9 | IEEE 802.3 MAC/PHY status: autonegotiation supported and enabled, advertised capability 0x6c03, MAU type 30');

// ---- Network-address identifiers on both mandatory TLVs.
const NETADDR = '02 06 05 01 cb 00 71 09 04 06 04 01 c0 00 02 4d 06 02 00 5a 00 00';
const netaddr = run(NETADDR);
assert.equal(netaddr.chassis.display, 'network address IPv4 203.0.113.9');
assert.equal(netaddr.chassis.family, 1);
assert.equal(netaddr.port.display, 'network address IPv4 192.0.2.77');
assert.equal(netaddr.transmitInterval, 22.5);

// ---- Two management addresses; the second is noted, both decode.
const TWOMGMT = '02 07 04 00 aa bb cc dd ee 04 06 01 6d 67 6d 74 30 06 02 00 78 10 0c 04 01 c0 00 02 01 01 00 00 00 01 00 10 18 10 02 20 01 0d b8 00 00 00 00 00 00 00 00 00 00 00 01 02 00 00 00 07 00 00 00';
const twoMgmt = run(TWOMGMT);
assert.equal(twoMgmt.management.length, 2);
assert.equal(twoMgmt.management[0].address, 'IPv4 192.0.2.1');
assert.equal(twoMgmt.management[0].interfaceText, 'unknown');
assert.equal(twoMgmt.management[1].address, 'IPv6 2001:db8::1');
assert.equal(twoMgmt.management[1].interfaceNumber, 7);
assert.equal(twoMgmt.notes.length, 1);
assert.match(twoMgmt.notes[0], /second Management Address TLV appears at byte 35/);

// ---- A 255-byte string TLV is the limit; 256 is refused.
const long = 'x'.repeat(255);
const longName = run(hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(6, ascii(long)), ...END]));
assert.equal(longName.systemDescription.length, 255);
assert.equal(failure(hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(6, ascii(long + 'y')), ...END])),
  'The System Description TLV carries 256 bytes; IEEE 802.1AB limits it to 255.');

// ---- Missing End Of LLDPDU TLV and a reserved TLV type are reported.
const noEnd = run('02 07 04 00 01 02 03 04 05 04 03 07 70 31 06 02 00 78 0a 06 65 64 67 65 2d 31');
assert.equal(noEnd.ended, false);
assert.match(noEnd.notes[0], /without an End Of LLDPDU TLV/);
const reserved = run('02 07 04 00 01 02 03 04 05 04 03 07 70 31 06 02 00 78 12 02 de ad 00 00');
assert.equal(reserved.tlvs[3].typeName, 'Reserved (type 9)');
assert.equal(reserved.tlvs[3].valueText, 'not decoded: de ad');
assert.match(reserved.notes[0], /type 9 is reserved/);

// ---- The Ethernet wrapper, with one 802.1Q tag.
const VLAN_FRAME = '01 80 c2 00 00 0e 00 1a 2b 3c 4d 5e 81 00 00 64 88 cc ' +
  hexstr([...tlv(1, [7, ...ascii('chassis-9')]), ...tlv(2, [7, ...ascii('eth0')]), ...ttl(0), ...END]);
const tagged = run(VLAN_FRAME, 'frame');
assert.equal(tagged.frame.destination, '01-80-c2-00-00-0e');
assert.equal(tagged.frame.source, '00-1a-2b-3c-4d-5e');
assert.equal(tagged.frame.tags, 1);
assert.equal(tagged.byteLength, 25);
assert.equal(tagged.headline, 'locally assigned "chassis-9"');
assert.match(tagged.subline, /^00-1a-2b-3c-4d-5e to 01-80-c2-00-00-0e; /);
const plainFrame = run(hexstr(frame('01-80-c2-00-00-0e', '00-1a-2b-3c-4d-5e', [], minimalDu)), 'frame');
assert.equal(plainFrame.frame.tags, 0);
assert.equal(plainFrame.byteLength, minimalDu.length);
assert.deepEqual(plainFrame.notes, []);
const unicastFrame = run(hexstr(frame('00-1a-2b-3c-4d-5e', '00-1a-2b-3c-4d-5f', [], minimalDu)), 'frame');
assert.deepEqual(unicastFrame.notes, ['The destination MAC 00-1a-2b-3c-4d-5e is not one of the three LLDP multicast addresses; unicast LLDP is permitted but unusual.']);

// ---- Refusals, by exact message.
const cases = [
  ['', null, 'Paste the hex bytes of an LLDPDU or an LLDP frame, such as 02 07 04 00 11 22 33 44 55.'],
  ['02 07 zz 00', null, '"zz" is not a hex byte.'],
  ['02 07 0', null, '"0" has an odd number of hex digits.'],
  ['02', null, 'An LLDPDU starts with a 2-byte TLV header; 1 byte was pasted.'],
  [hexstr([...tlv(2, [7, ...ascii('eth0')]), ...ttl(120), ...END]), null,
    'The first TLV is type 2 (Port ID), but an LLDPDU must begin with a Chassis ID TLV (type 1).'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...tlv(4, ascii('desc')), ...ttl(120), ...END]), null,
    'The second TLV is type 4 (Port Description); the mandatory order is Chassis ID, Port ID, then Time To Live.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...tlv(7, [0, 1, 0, 1])]), null,
    'The third TLV is type 7 (System Capabilities); the third mandatory TLV is Time To Live (type 3).'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), 0x0A, 0x09, 0x00]), null,
    'The TLV at byte 18 (type 5) claims 9 value bytes, past the end of the 21 bytes pasted.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(0, [0x00])]), null,
    'The End Of LLDPDU TLV carries 1 value byte; it must carry none.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...END]), null,
    'The End Of LLDPDU TLV arrives after 2 TLVs; the Chassis ID, Port ID and Time To Live TLVs must come first.'],
  [hexstr([...minimalDu, 0x00]), null,
    'The LLDPDU ends at byte 23, but 1 byte follows it; one frame carries one LLDPDU.'],
  [hexstr([...tlv(1, [9, 0x00]), ...namedPort('p1'), ...ttl(120), ...END]), null,
    'The Chassis ID subtype 9 is reserved; LLDP defines chassis ID subtypes 1 to 7.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...tlv(2, [8, 0x00]), ...ttl(120), ...END]), null,
    'The Port ID subtype 8 is reserved; LLDP defines port ID subtypes 1 to 7.'],
  [hexstr([...tlv(1, [4, 0x00, 0x11, 0x22, 0x33, 0x44]), ...namedPort('p1'), ...ttl(120), ...END]), null,
    'The Chassis ID MAC address is 5 bytes; a MAC address is exactly six.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...tlv(2, [3, 0x00, 0x11]), ...ttl(120), ...END]), null,
    'The Port ID MAC address is 2 bytes; a MAC address is exactly six.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...tlv(3, [0, 0, 0, 120])]), null,
    'The Time To Live TLV carries 4 value bytes; it must carry exactly two.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(7, [0, 1, 0])]), null,
    'The System Capabilities TLV carries 3 value bytes; it must carry four (supported and enabled bitmaps).'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(8, [0, 1, 192, 0, 2, 1, 2, 0, 0, 0, 1, 0])]), null,
    'The Management Address TLV declares a 0-byte address string; LLDP allows 1 to 31.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(8, [4, 1, 192, 0])]), null,
    'The Management Address TLV declares a 4-byte address string but carries 4 value bytes; the layout needs the address, interface subtype, a 4-byte interface number, an OID length and the OID.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(8, [4, 1, 192, 0, 2, 10, 2, 0, 0, 0x17, 0x80, 2, 0x2b])]), null,
    'The Management Address TLV declares a 2-byte OID but carries 1 byte after the OID length.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(127, [0x00, 0x12, 0x0f])]), null,
    'The Organizationally Specific TLV carries 3 value bytes; it needs a 3-byte OUI and a 1-byte subtype.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(127, [0x00, 0x12, 0x0f, 1, 0x03, 0x6c, 0x03, 0x00])]), null,
    'The 802.3 MAC/PHY TLV carries 4 bytes after its subtype; the layout needs a 1-byte autonegotiation status, a 2-byte advertised capability and a 2-byte MAU type.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(127, [0x00, 0x12, 0x0f, 4, 0x05])]), null,
    'The 802.3 maximum frame size TLV carries 1 byte; it must carry two.'],
  [hexstr([...macChassis('00-01-02-03-04-05'), ...namedPort('p1'), ...ttl(120), ...tlv(127, [0x00, 0x80, 0xc2, 1, 0x00])]), null,
    'The 802.1 port VLAN ID TLV carries 1 byte; it must carry two.'],
  ['00 11 22 33 44 55 66 77 88 99', 'frame', 'An Ethernet frame is at least 14 bytes; 10 bytes were pasted.'],
  ['01 80 c2 00 00 0e 00 1a 2b 3c 4d 5e 08 00 ' + hexstr(minimalDu), 'frame',
    'The Ethernet header\'s EtherType is 0x0800, not 0x88CC, so this is not an LLDP frame.'],
  [hexstr(frame('01-80-c2-00-00-0e', '00-1a-2b-3c-4d-5e', [], [])), 'frame',
    'The Ethernet header is valid, but no LLDPDU follows the 0x88CC EtherType.'],
  [hexstr(frame('01-80-c2-00-00-0e', '00-1a-2b-3c-4d-5e', [0x81, 0x00, 0, 1, 0x81, 0x00, 0, 2, 0x81, 0x00, 0, 3], minimalDu)), 'frame',
    'The frame carries more than two stacked 802.1Q tags, which this page does not model.'],
  [SAMPLE, 'hex', 'The input format "hex" is not payload or frame.']
];
for (const [text, format, message] of cases){
  assert.equal(failure(text, format), message, 'refusal for ' + message);
}

// ---- Truncated TLV header, a chassis TLV with only a subtype, and an empty paste after a frame header.
assert.equal(failure(hexstr([...macChassis('00-01-02-03-04-05'), 0x04])),
  'The TLV header at byte 9 is cut off by the end of the data unit.');
assert.equal(failure(hexstr([...tlv(1, [4]), ...namedPort('p1'), ...ttl(120), ...END])),
  'The Chassis ID TLV carries 1 value byte; a subtype and at least one identifier byte are required.');

// ---- The object form the catalog harness passes, and byte parsing tolerance.
assert.equal(C.decode({ hex: SAMPLE }).headline, 'core-sw-1');
assert.equal(C.decode({ hex: SAMPLE, format: 'payload' }).tlvCount, 10);
assert.deepEqual(plain(C.parseBytes('02:07:04:00')).length, 4);
assert.deepEqual(plain(C.parseBytes('0000: 02 07 04 00')), [2, 7, 4, 0]);
assert.equal(C.parseBytes('02 07 04 00').length, 4);

// ---- Builder sweep: random identifiers, TTLs and optional TLVs.
let seed = 20261127;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(random() * list.length)];
const randomLabel = () => {
  const length = 1 + Math.floor(random() * 14);
  let text = '';
  for (let index = 0; index < length; index += 1){
    text += pick('abcdefghijklmnopqrstuvwxyz0123456789-_');
  }
  return text;
};
let swept = 0;
for (let iteration = 0; iteration < 400; iteration += 1){
  const chassisMac = Array.from({ length: 6 }, () => Math.floor(random() * 256));
  const portName = randomLabel();
  const systemName = random() < 0.5 ? randomLabel() : null;
  const ttlValue = Math.floor(random() * 65536);
  const built = [
    ...tlv(1, [4, ...chassisMac]),
    ...tlv(2, [5, ...ascii(portName)]),
    ...tlv(3, word(ttlValue))
  ];
  const macText = chassisMac.map((b) => (b < 16 ? '0' : '') + b.toString(16)).join('-');
  const expectedLines = [];
  let offset = 0;
  const push = (type, name, length, valueText) => {
    expectedLines.push((expectedLines.length + 1) + ' | ' + offset + ' | ' + type + ' ' + name + ' | ' + length + ' | ' + valueText);
    offset += 2 + length;
  };
  push(1, 'Chassis ID', 7, 'MAC ' + macText);
  push(2, 'Port ID', portName.length + 1, 'interface name "' + portName + '"');
  push(3, 'Time To Live', 2, ttlValue + ' s');
  if (systemName !== null){
    built.push(...tlv(5, ascii(systemName)));
    push(5, 'System Name', systemName.length, '"' + systemName + '"');
  }
  built.push(...END);
  push(0, 'End Of LLDPDU', 0, 'no value');
  const decoded = run(hexstr(built));
  assert.equal(decoded.tlvCount, expectedLines.length, 'sweep ' + iteration);
  assert.equal(decoded.byteLength, offset, 'sweep length ' + iteration);
  assert.equal(decoded.ttl, ttlValue);
  assert.equal(decoded.transmitInterval, ttlValue > 0 ? ttlValue / 4 : null);
  assert.equal(decoded.ended, true);
  assert.deepEqual(decoded.lines, expectedLines, 'sweep lines ' + iteration);
  assert.equal(decoded.headline, systemName === null ? 'MAC ' + macText : systemName);
  assert.equal(decoded.port.display, 'interface name "' + portName + '"');
  swept += 1;
}
assert.equal(swept, 400);

// ---- The catalog record and its cases agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'LLDP TLV Decoder');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Packet analysis');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-27T12:40:00Z');
assert.ok(record.method.includes('802.1AB'), 'method names the standard');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.guidance.length > 200, 'guidance covers the limits');
assert.equal(record.sources.length, 3, 'three sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');

let checked = 0;
for (const testCase of record.testCases){
  const text = testCase.input.hex;
  const format = testCase.input.format;
  if (testCase.kind === 'validation'){
    assert.equal(failure(text, format), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(text, format);
  for (const [key, expected] of Object.entries(testCase.expected)){
    assert.deepEqual(actual[key], expected, testCase.name + ' ' + key);
    checked += 1;
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools){
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])){
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)){
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['networking', 'lldp', 'packet-analysis', 'wire-format']){
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2512, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2251, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 57, 'Networking count');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(markupIds).size, markupIds.length, 'no duplicate element ids');
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 14, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.includes(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="hex">/.test(html), 'the byte field has a label');
assert.ok(/<label for="format">/.test(html), 'the format select has a label');
assert.ok(/<select id="format">/.test(html) && /value="payload"/.test(html) && /value="frame"/.test(html),
  'the input format offers payload and frame');
assert.ok(/<textarea id="hex"/.test(html), 'the bytes are pasted into a textarea');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.equal((html.match(/<caption>/g) || []).length, 2, 'each table is captioned');
assert.ok(/<th scope="row">/.test(html) && /<th scope="col">/.test(html), 'the tables carry headers');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/overflow-x:auto/.test(html), 'the TLV table scrolls instead of clipping');
assert.ok(/pre-wrap/.test(html), 'the pasted bytes wrap instead of clipping');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one textarea');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');
assert.ok(html.includes('802.1AB'), 'the method names the standard');
assert.equal(checked > 40, true, 'the catalog replays more than forty field expectations');
