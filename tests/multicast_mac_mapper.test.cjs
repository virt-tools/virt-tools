/* Multicast MAC mapper: the address-to-MAC contract, the reverse lookup,
   the page markup and the catalog record's twenty-nine cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'multicast-mac-mapper';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* multicast-mac-core:start */';
const endMarker = '/* multicast-mac-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, isFinite, parseInt, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MulticastMacCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.build(Object.assign({}, C.DEFAULTS, payload)); } catch (error) { return error.message; }
  return null;
};

// ---- IPv4 parsing and its exact messages.
assert.equal(C.parseIPv4('224.0.0.251'), 0xe00000fb);
assert.equal(C.parseIPv4(' 224.0.0.1 '), 0xe0000001);
assert.equal(C.parseIPv4('239.255.255.255'), 0xefffffff);
assert.equal(failure({ address: '224.0.0' }), 'An IPv4 address has four octets; "224.0.0" has 3.');
assert.equal(failure({ address: '1.2.3.4.5' }), 'An IPv4 address has four octets; "1.2.3.4.5" has 5.');
assert.equal(failure({ address: '224.0.0.x' }), 'An IPv4 address is four decimal octets; "x" is not one.');
assert.equal(failure({ address: '300.1.1.1' }), 'Each IPv4 octet must be 0 to 255; "300" is not.');
assert.equal(failure({ address: '010.0.0.1' }), 'Write IPv4 octets without leading zeros; "010" could be read as octal.');
assert.equal(C.ipv4ToString(0xe00000fb), '224.0.0.251');
assert.equal(C.ipv4ToString(0xefffffff), '239.255.255.255');

// ---- IPv6 parsing, compression and its messages.
const v6 = C.parseIPv6('ff02::1');
assert.equal(v6.bytes.length, 16);
assert.equal(v6.bytes[0], 0xff);
assert.equal(v6.bytes[1], 0x02);
assert.equal(v6.bytes[15], 1);
assert.equal(v6.zone, null);
assert.deepEqual(C.parseIPv6('FF02:0:0:0:0:0:0:1').groups, v6.groups);
assert.equal(C.parseIPv6('ff02::1%eth0').zone, 'eth0');
assert.equal(C.parseIPv6('ff02::1%eth0').bytes[15], 1);
assert.equal(C.ipv6ToString(C.parseIPv6('::').bytes), '::');
assert.equal(C.ipv6ToString(C.parseIPv6('::1').bytes), '::1');
assert.equal(C.ipv6ToString(C.parseIPv6('1::').bytes), '1::');
assert.equal(C.ipv6ToString(C.parseIPv6('2001:db8:0:1:1:1:1:1').bytes), '2001:db8:0:1:1:1:1:1');
assert.equal(C.ipv6ToString(C.parseIPv6('1:0:0:1:0:0:0:1').bytes), '1:0:0:1::1');
assert.equal(C.ipv6ToString(C.parseIPv6('::ffff:192.0.2.1').bytes), '::ffff:c000:201');
assert.equal(C.ipv6ToString(C.parseIPv6('ff02::1').bytes), 'ff02::1');
assert.equal(failure({ address: 'ff02::1::2' }), 'Use at most one "::" in an IPv6 address.');
assert.equal(failure({ address: '1:2:3:4:5:6:7' }),
  'An IPv6 address without "::" needs eight groups; "1:2:3:4:5:6:7" has 7.');
assert.equal(failure({ address: '1:2:3:4:5:6:7:8:9' }),
  'An IPv6 address without "::" needs eight groups; "1:2:3:4:5:6:7:8:9" has 9.');
assert.equal(failure({ address: 'ff02::12345' }), 'Each IPv6 group is one to four hex digits; "12345" is not.');
assert.equal(failure({ address: 'ff02::1%' }), 'A zone id after "%" needs an interface name such as eth0.');
assert.equal(failure({ address: 'ff02::1%eth 0' }), 'A zone id may contain letters, digits, dots, dashes and underscores.');

// ---- MAC parsing accepts all four common forms and nothing else.
const macBytes = [0x01, 0x00, 0x5e, 0x00, 0x00, 0xfb];
assert.deepEqual(Array.from(C.parseMac('01:00:5e:00:00:fb')), macBytes);
assert.deepEqual(Array.from(C.parseMac('01-00-5e-00-00-fb')), macBytes);
assert.deepEqual(Array.from(C.parseMac('0100.5e00.00fb')), macBytes);
assert.deepEqual(Array.from(C.parseMac('01005e0000fb')), macBytes);
assert.deepEqual(Array.from(C.parseMac('01:00:5E:00:00:FB')), macBytes);
assert.equal(C.macToString(macBytes), '01:00:5e:00:00:fb');
assert.equal(failure({ address: '01:00:5e:00:00' }),
  'A MAC address is six hex octets, for example 01:00:5e:00:00:fb; "01:00:5e:00:00" is not one.');
assert.equal(failure({ address: 'zzz' }),
  'Enter an IPv4 address, an IPv6 address, or a MAC address; "zzz" is not one of those.');
assert.equal(failure({ address: '   ' }),
  'Enter an IPv4 multicast group, an IPv6 multicast group, or a MAC address.');

// ---- IPv4 mapping: known groups and the dropped-bit overlap.
const mdns = C.build({});
assert.equal(mdns.kind, 'ipv4');
assert.equal(mdns.group, '224.0.0.251');
assert.equal(mdns.mac, '01:00:5e:00:00:fb');
assert.equal(mdns.label, 'Mapped Ethernet MAC');
assert.equal(mdns.headline, '01:00:5e:00:00:fb');
assert.equal(mdns.subText, 'from IPv4 multicast group 224.0.0.251 \u00b7 link-local (224.0.0.0/24)');
assert.equal(mdns.summary,
  'IPv4 multicast 224.0.0.251 maps to Ethernet MAC 01:00:5e:00:00:fb; 32 IPv4 groups share that MAC.');
assert.equal(mdns.rows.length, 5);
assert.equal(mdns.rows[0].k, 'Input');
assert.equal(mdns.rows[0].v, 'IPv4 multicast group 224.0.0.251');
assert.equal(mdns.rows[1].v, '01:00:5e:00:00:fb');
assert.equal(mdns.rows[2].v, 'low 23 bits of the group address');
assert.equal(mdns.rows[3].v, '32');
assert.equal(mdns.rows[4].v, 'link-local (224.0.0.0/24)');
assert.equal(mdns.statusKind, 'ok');
assert.equal(mdns.statusText, 'Mapped to an Ethernet MAC');
assert.ok(mdns.copyText.startsWith(mdns.summary + '\n'));
assert.ok(mdns.copyText.includes('Mapped MAC: 01:00:5e:00:00:fb'));

assert.equal(C.build({ address: '224.0.0.1' }).mac, '01:00:5e:00:00:01');
assert.equal(C.build({ address: '239.1.2.3' }).mac, '01:00:5e:01:02:03');
assert.equal(C.build({ address: '239.255.255.250' }).mac, '01:00:5e:7f:ff:fa');
assert.equal(C.build({ address: '232.1.2.3' }).mac, C.build({ address: '239.1.2.3' }).mac);
assert.equal(C.build({ address: '233.17.1.1' }).mac, '01:00:5e:11:01:01');
assert.equal(C.build({ address: '238.200.100.50' }).mac, '01:00:5e:48:64:32');
assert.equal(C.build({ address: '239.0.0.1' }).rows[4].v, 'administratively scoped (239.0.0.0/8)');
assert.equal(C.build({ address: '232.0.0.1' }).rows[4].v, 'source-specific multicast (232.0.0.0/8)');
assert.equal(C.build({ address: '233.0.0.1' }).rows[4].v, 'GLOP block (233.0.0.0/8)');
assert.equal(C.build({ address: '224.0.1.2' }).rows[4].v, 'internetwork control (224.0.1.0/24)');
assert.equal(C.build({ address: '224.1.2.3' }).rows[4].v, 'multicast (224.0.0.0/4)');

// ---- The 32 groups with the same low 23 bits.
const groups = mdns.candidates;
assert.equal(groups.length, 32);
assert.equal(new Set(groups).size, 32, 'candidates are distinct');
assert.equal(groups[0], '224.0.0.251');
assert.equal(groups[1], '224.128.0.251');
assert.equal(groups[31], '239.128.0.251');
for (const group of groups) {
  const result = C.build({ address: group });
  assert.equal(result.mac, mdns.mac, group + ' shares the MAC');
  const first = Number(group.split('.')[0]);
  assert.ok(first >= 224 && first <= 239, group + ' stays in 224/4');
}
const ssdp = C.build({ address: '239.255.255.250' });
assert.equal(ssdp.candidates[0], '224.127.255.250');
assert.equal(ssdp.candidates[31], '239.255.255.250');
assert.ok(mdns.candidateNote.includes('32') === false, 'the note names the MAC, not the count');
assert.ok(mdns.candidateNote.includes('01:00:5e:00:00:fb'));

// ---- IPv6 mapping.
const nodes = C.build({ address: 'ff02::1' });
assert.equal(nodes.kind, 'ipv6');
assert.equal(nodes.group, 'ff02::1');
assert.equal(nodes.mac, '33:33:00:00:00:01');
assert.equal(nodes.headline, '33:33:00:00:00:01');
assert.equal(nodes.label, 'Mapped Ethernet MAC');
assert.equal(nodes.subText, 'from IPv6 multicast group ff02::1');
assert.equal(nodes.rows[2].v, 'low 32 bits of the group address');
assert.equal(nodes.rows[3].v, 'link-local');
assert.equal(nodes.rows[4].v, 'well-known (permanently assigned)');
assert.equal(nodes.candidates.length, 0);
assert.ok(nodes.candidateNote.includes('2^96'));
assert.equal(C.build({ address: 'ff02::fb' }).mac, '33:33:00:00:00:fb');
assert.equal(C.build({ address: 'ff05::1:3' }).mac, '33:33:00:01:00:03');
assert.equal(C.build({ address: 'ff05::1:3' }).rows[3].v, 'site-local');
assert.equal(C.build({ address: 'ff0e::abcd:ef01' }).mac, '33:33:ab:cd:ef:01');
assert.equal(C.build({ address: 'ff12::1:2' }).rows[4].v, 'transient (not permanently assigned)');
assert.equal(C.build({ address: 'ff02::1%eth0' }).subText, 'from IPv6 multicast group ff02::1 on eth0');
assert.equal(C.build({ address: 'FF02:0:0:0:0:0:0:1' }).group, 'ff02::1');
assert.equal(failure({ address: '2001:db8::1' }),
  'IPv6 multicast groups start with ff00::/8; "2001:db8::1" does not.');

// ---- Reverse lookup from a MAC.
const reverse = C.build({ address: '01:00:5e:00:00:fb' });
assert.equal(reverse.kind, 'mac-v4');
assert.equal(reverse.label, 'Matching IPv4 groups');
assert.equal(reverse.headline, '32');
assert.equal(reverse.group, '224.0.0.251');
assert.equal(reverse.subText, '01:00:5e:00:00:fb is shared by 32 IPv4 multicast groups.');
assert.equal(reverse.candidates.length, 32);
assert.equal(reverse.candidates[0], '224.0.0.251');
assert.equal(reverse.rows[2].v, '00:00:fb');
assert.equal(reverse.rows[4].v, '224.0.0.251');
assert.equal(reverse.summary,
  'Ethernet MAC 01:00:5e:00:00:fb maps back to 32 IPv4 multicast groups, from 224.0.0.251 to 239.128.0.251.');
assert.equal(C.build({ address: '0100.5e00.00fb' }).headline, '32');
assert.equal(C.build({ address: '01-00-5e-00-00-fb' }).mac, '01:00:5e:00:00:fb');
assert.equal(C.build({ address: '01005e0000fb' }).mac, '01:00:5e:00:00:fb');
const v6reverse = C.build({ address: '33:33:00:01:00:03' });
assert.equal(v6reverse.kind, 'mac-v6');
assert.equal(v6reverse.label, 'Example IPv6 group');
assert.equal(v6reverse.headline, 'ff02::1:3');
assert.equal(v6reverse.group, 'ff02::1:3');
assert.equal(v6reverse.rows[2].v, '00:01:00:03');
assert.equal(v6reverse.rows[4].v, '2^96');
assert.equal(v6reverse.candidates.length, 0);
assert.equal(failure({ address: '01:00:5e:80:00:00' }),
  'No IPv4 group maps to 01:00:5e:80:00:00: in the 01:00:5e mapping the fourth octet is always 00 to 7f.');
assert.equal(failure({ address: '00:1a:2b:3c:4d:5e' }),
  'The multicast bit is not set in 00:1a:2b:3c:4d:5e, so it is a unicast address and maps to no multicast group.');
assert.equal(failure({ address: '01:80:c2:00:00:00' }),
  'Ethernet multicast MACs map to IP multicast only through 01:00:5e for IPv4 or 33:33 for IPv6; "01:80:c2:00:00:00" is neither.');

// ---- Shared reference table and explanation.
assert.equal(mdns.common.length, 5);
assert.equal(mdns.common[0].group, '224.0.0.1');
assert.equal(mdns.common[0].mac, '01:00:5e:00:00:01');
assert.equal(mdns.common[0].use, 'all hosts on the subnet');
assert.equal(mdns.common[1].mac, '01:00:5e:00:00:fb');
assert.equal(mdns.common[2].mac, '01:00:5e:7f:ff:fa');
assert.equal(mdns.common[3].mac, '33:33:00:00:00:01');
assert.equal(mdns.common[4].mac, '33:33:00:00:00:fb');
assert.ok(mdns.explanation.length >= 4, 'the method is explained');
assert.ok(mdns.explanation[0].includes('01:00:5e'), 'the IPv4 prefix is named');
assert.ok(mdns.explanation[1].includes('32'), 'the overlap is named');
assert.ok(mdns.explanation[2].includes('33:33'), 'the IPv6 prefix is named');
assert.ok(mdns.explanation[2].includes('2^96'), 'the IPv6 overlap is named');

// ---- Page markup: the documented contract.
for (const id of ['mm-form', 'in-address', 'map', 'reset', 'status', 'error', 'summary',
  'explanation', 'shared-panel', 'shared-title', 'candidates', 'shared-note', 'common-body', 'limits']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
assert.ok(/<label for="in-address">/.test(html), 'the input has a label');
assert.ok(/id="summary"[^>]*aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status" aria-live="polite"/.test(html), 'copy feedback is announced');
assert.ok(/<button id="map" class="primary" type="submit">/.test(html));
assert.ok(/<button id="reset" class="ghost" type="button">/.test(html));
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('/assets/theme-init.js'), 'the theme is applied before paint');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is used');
assert.ok(html.includes('/assets/app.js'), 'the shared header is loaded');
assert.ok(html.includes('value="224.0.0.251"'), 'the example group is filled in');
assert.ok(html.includes('@media (max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(html.includes('overflow-x:auto'), 'the table scrolls on narrow screens');
assert.ok(html.includes('id="shared-panel" hidden'), 'the shared-group panel starts hidden');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2256, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Multicast MAC Address Mapper');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f4e1}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.description.includes('IPv4'), 'the description names IPv4');
assert.ok(record.description.includes('IPv6'), 'the description names IPv6');
assert.ok(record.method.includes('01:00:5e'), 'method states the IPv4 prefix');
assert.ok(record.method.includes('low 23 bits'), 'method states the preserved IPv4 bits');
assert.ok(record.method.includes('33:33'), 'method states the IPv6 prefix');
assert.ok(record.method.includes('low 32 bits'), 'method states the preserved IPv6 bits');
assert.ok(record.method.includes('2^96'), 'method states the IPv6 overlap');
assert.ok(record.method.includes('I/G'), 'method states the multicast bit');
assert.ok(record.method.includes('no network'), 'method states the privacy position');
assert.equal(record.sources.length, 4, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 60), 'sources are described');
assert.ok(record.sources.some((source) => source.title.includes('RFC 1112')));
assert.ok(record.sources.some((source) => source.title.includes('RFC 2464')));
assert.ok(record.sources.some((source) => source.title.includes('RFC 4291')));
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('multicast'));
assert.ok(record.aliases.includes('MAC to Multicast Group Lookup'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 43, 'Networking count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'one name');
assert.equal(catalog.tools.filter((tool) => (tool.tags || []).includes('multicast')).length, 1, 'one multicast tag');

assert.equal(record.testCases.length, 29, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 17);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 12);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(Object.assign({}, C.DEFAULTS, testCase.input));
  const expected = testCase.expected;
  assert.equal(result.kind, expected.kind, testCase.name + ' kind');
  assert.equal(result.group, expected.group, testCase.name + ' group');
  assert.equal(result.mac, expected.mac, testCase.name + ' mac');
  assert.equal(result.headline, expected.headline, testCase.name + ' headline');
  assert.equal(result.candidates.length, expected.candidates, testCase.name + ' candidates');
  if (expected.first) assert.equal(result.candidates[0], expected.first, testCase.name + ' first');
  if (expected.last) assert.equal(result.candidates[result.candidates.length - 1], expected.last, testCase.name + ' last');
  assert.equal(result.rows.length, 5, testCase.name + ' rows');
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases and the page contract pass');
