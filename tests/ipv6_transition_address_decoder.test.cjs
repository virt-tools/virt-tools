/* Regression checks for the IPv6 transition address decoder core.
 *
 * The layouts are checked against the RFCs rather than against the page's own
 * arithmetic: the six rows of RFC 6052 Table 1 are pinned verbatim, the
 * RFC 4380 obfuscation example is rebuilt here, and a seeded sweep rebuilds
 * each address from an IPv4 address the test already knows, so a decode that
 * disagrees with the standard cannot pass by agreeing with itself.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipv6-transition-address-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* ita-core:start */');
const end = html.indexOf('/* ita-core:end */');
assert.ok(start > -1 && end > start, 'transition core markers missing');
const core = html.slice(start, end + '/* ita-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TransitionCore;', sandbox);
const C = sandbox.module.exports;

const run = (address, prefix) => C.decode({ address, prefix: prefix || '' });

// ---- Builders written here, from the RFC prose.
const hex4 = (value) => value.toString(16).padStart(4, '0');
const octets = (v4) => v4.split('.').map(Number);
const word = (high, low) => hex4(high * 256 + low);
const sixToFour = (v4) => {
  const o = octets(v4);
  return `2002:${word(o[0], o[1])}:${word(o[2], o[3])}::1`;
};
const teredo = (server, client, port, cone) => {
  const s = octets(server);
  const c = octets(client);
  return ['2001', '0', word(s[0], s[1]), word(s[2], s[3]),
    hex4(cone ? 0x8000 : 0x0000), hex4(port ^ 0xffff),
    word(c[0] ^ 0xff, c[1] ^ 0xff), word(c[2] ^ 0xff, c[3] ^ 0xff)].join(':');
};
const isatap = (prefix, v4, universal) => {
  const o = octets(v4);
  return `${prefix}${universal ? '200' : '0'}:5efe:${word(o[0], o[1])}:${word(o[2], o[3])}`;
};
const bitsOf = (value) => value.toString(2).padStart(128, '0');
const canonicalValue = (value) => {
  // RFC 5952 form, written here so the page's formatter is not grading itself.
  const groups = [];
  for (let index = 7; index >= 0; index -= 1) groups.push(Number((value >> BigInt(16 * index)) & 0xffffn));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8;) {
    if (groups[index] !== 0) { index += 1; continue; }
    let run = index;
    while (run < 8 && groups[run] === 0) run += 1;
    if (run - index > bestLength && run - index >= 2) { bestStart = index; bestLength = run - index; }
    index = run;
  }
  const parts = groups.map((group) => group.toString(16));
  if (bestStart < 0) return parts.join(':');
  return `${parts.slice(0, bestStart).join(':')}::${parts.slice(bestStart + bestLength).join(':')}`;
};
const valueOf = (v4) => {
  const o = octets(v4);
  return (BigInt(o[0]) << 24n) | (BigInt(o[1]) << 16n) | (BigInt(o[2]) << 8n) | BigInt(o[3]);
};
const textOf = (bits) => {
  const groups = [];
  for (let index = 0; index < 128; index += 16) groups.push(parseInt(bits.slice(index, index + 16), 2));
  return groups.map((group) => group.toString(16).padStart(4, '0')).join(':');
};
const nat64 = (prefix, length, v4) => {
  const o = octets(v4);
  const ipBits = o.map((octet) => octet.toString(2).padStart(8, '0')).join('');
  const prefixBits = [];
  for (const digit of prefix.replace(/[:]/g, '').padEnd(32, '0').slice(0, 32)) {
    prefixBits.push(parseInt(digit, 16).toString(2).padStart(4, '0'));
  }
  const bits = prefixBits.join('').slice(0, 128).split('');
  if (length === 96) {
    bits.splice(96, 32, ...ipBits);
  } else {
    const first = 64 - length;
    bits.splice(length, 64 - length, ...ipBits.slice(0, first));
    bits.splice(64, 8, ...'00000000');
    bits.splice(72, 32 - first, ...ipBits.slice(first));
  }
  return textOf(bits.join(''));
};

// ---- 1. RFC 6052 section 2.4 Table 1, every row verbatim.
const TABLE_1 = [
  ['2001:db8::/32', '2001:db8:c000:221::'],
  ['2001:db8:100::/40', '2001:db8:1c0:2:21::'],
  ['2001:db8:122::/48', '2001:db8:122:c000:2:2100::'],
  ['2001:db8:122:300::/56', '2001:db8:122:3c0:0:221::'],
  ['2001:db8:122:344::/64', '2001:db8:122:344:c0:2:2100::'],
  ['2001:db8:122:344::/96', '2001:db8:122:344::192.0.2.33'],
];
for (const [prefix, address] of TABLE_1) {
  const result = run(address, prefix);
  assert.equal(result.kind, 'nat64', `${prefix}: mechanism`);
  assert.equal(result.embeddedIPv4, '192.0.2.33', `${prefix}: IPv4`);
  assert.equal(result.nat64PrefixLength, Number(prefix.split('/')[1]), `${prefix}: length`);
  assert.equal(result.nat64Prefix, prefix, `${prefix}: prefix echoed`);
  assert.equal(result.uOctetZero, true, `${prefix}: reserved octet`);
  assert.equal(result.suffixZero, true, `${prefix}: suffix`);
  assert.equal(result.warning, null, `${prefix}: no warning`);
}
// Table 2, the well-known prefix.
const wellKnown = run('64:ff9b::192.0.2.33');
assert.equal(wellKnown.kind, 'nat64');
assert.equal(wellKnown.embeddedIPv4, '192.0.2.33');
assert.equal(wellKnown.nat64Prefix, '64:ff9b::/96');
assert.equal(wellKnown.nat64PrefixLength, 96);

// ---- 2. RFC 4380 section 4: the obfuscation is an exclusive OR with all ones.
assert.equal(0x0151 ^ 0xffff, 0xfeae, 'port obfuscation from the RFC example');
assert.equal((0x01020304 ^ 0xffffffff) >>> 0, 0xfefdfcfb, 'address obfuscation from the RFC example');
const rfcExample = teredo('192.0.2.1', '1.2.3.4', 337, false);
const example = run(rfcExample);
assert.equal(example.kind, 'teredo');
assert.equal(example.teredoServer, '192.0.2.1');
assert.equal(example.teredoClient, '1.2.3.4');
assert.equal(example.embeddedIPv4, '1.2.3.4');
assert.equal(example.teredoPort, 337);
assert.equal(example.coneFlag, false);

// ---- 3. Seeded sweep: rebuild each address from a known IPv4 and decode it.
let seed = 20261117;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const randomOctets = () => Array.from({ length: 4 }, () => Math.floor(random() * 256));
const ipv4Of = (list) => list.join('.');

for (let index = 0; index < 60; index += 1) {
  const v4 = ipv4Of(randomOctets());
  const result = run(sixToFour(v4));
  assert.equal(result.kind, '6to4', `6to4 ${v4}`);
  assert.equal(result.embeddedIPv4, v4, `6to4 ${v4}`);
  assert.equal(result.sitePrefix, canonicalValue((0x2002n << 112n) | (valueOf(v4) << 80n)) + '/48',
    `6to4 ${v4}: site prefix`);
}
for (let index = 0; index < 60; index += 1) {
  const server = ipv4Of(randomOctets().map((octet) => octet || 1));
  const client = ipv4Of(randomOctets());
  const port = 1024 + Math.floor(random() * 64000);
  const cone = random() < 0.5;
  const result = run(teredo(server, client, port, cone));
  assert.equal(result.kind, 'teredo', `teredo ${server} ${client}`);
  assert.equal(result.teredoServer, server, `teredo server`);
  assert.equal(result.teredoClient, client, `teredo client`);
  assert.equal(result.embeddedIPv4, client, `teredo embedded`);
  assert.equal(result.teredoPort, port, `teredo port`);
  assert.equal(result.coneFlag, cone, `teredo cone`);
}
for (const prefix of ['fe80::', '2001:db8::', 'fc00::', '2a02:1f0::']) {
  for (let index = 0; index < 15; index += 1) {
    const v4 = ipv4Of(randomOctets());
    const universal = random() < 0.5;
    const result = run(isatap(prefix, v4, universal));
    assert.equal(result.kind, 'isatap', `isatap ${prefix} ${v4}`);
    assert.equal(result.embeddedIPv4, v4, `isatap ${prefix} ${v4}`);
    assert.equal(result.isatapUniversal, universal, `isatap u bit ${prefix} ${v4}`);
    assert.equal(result.isatapIdentifier, `${universal ? '0200' : '0000'}:5efe:${hex4(octets(v4)[0] * 256 + octets(v4)[1])}:${hex4(octets(v4)[2] * 256 + octets(v4)[3])}`,
      `isatap identifier ${prefix} ${v4}`);
  }
}
const NSP = {
  32: '20010db8', 40: '20010db801', 48: '20010db80122', 56: '20010db8012203',
  64: '20010db801220304', 96: '20010db80122030400000000',
};
for (const [length, prefixHex] of Object.entries(NSP)) {
  const prefixText = canonicalValue(BigInt('0x' + prefixHex.padEnd(32, '0')));
  const prefixWithLength = `${prefixText}/${length}`;
  for (let index = 0; index < 15; index += 1) {
    const v4 = ipv4Of(randomOctets());
    const address = nat64(prefixHex, Number(length), v4);
    const result = run(address, prefixWithLength);
    assert.equal(result.kind, 'nat64', `nat64 /${length} ${v4}`);
    assert.equal(result.embeddedIPv4, v4, `nat64 /${length} ${v4}`);
    assert.equal(result.nat64PrefixLength, Number(length), `nat64 length /${length}`);
    assert.equal(result.uOctetZero, true, `nat64 reserved octet /${length}`);
    assert.equal(result.suffixZero, true, `nat64 suffix /${length}`);
  }
}

// ---- 4. Boundaries and the shapes the page reports.
const zeros = run('2002::');
assert.equal(zeros.embeddedIPv4, '0.0.0.0');
assert.equal(zeros.sitePrefix, '2002::/48');
assert.ok(zeros.warning && zeros.warning.includes('not a usable public address'), 'all-zero 6to4 warns');
const broadcast = run('2002:ffff:ffff::');
assert.equal(broadcast.embeddedIPv4, '255.255.255.255');
assert.ok(broadcast.warning, '255.255.255.255 warns');
const nothingToHide = run('2001:0:0:0:0:ffff:0:0');
assert.equal(nothingToHide.teredoPort, 0);
assert.equal(nothingToHide.teredoClient, '255.255.255.255');
assert.equal(nothingToHide.teredoServer, '0.0.0.0');
const reservedFlag = run('2001:0:1:2:0001:0000:0000:0001');
assert.equal(reservedFlag.kind, 'teredo');
assert.ok(reservedFlag.warning && reservedFlag.warning.includes('Reserved Teredo flag bits'), 'reserved flags warn');
const dirtyOctet = run('2001:db8:c000:221:100::', '2001:db8::/32');
assert.equal(dirtyOctet.uOctetZero, false);
assert.ok(dirtyOctet.warning && dirtyOctet.warning.includes('is not zero'), 'reserved octet warns');
const suffixUsed = run('2001:db8:c000:221:0:1::', '2001:db8::/32');
assert.equal(suffixUsed.kind, 'nat64');
assert.equal(suffixUsed.suffixZero, false);
const outside = run('2001:db8:1:2::5', '2001:db8:122::/48');
assert.equal(outside.kind, 'none');
assert.ok(outside.note.includes('not inside the NAT64 prefix 2001:db8:122::/48'), 'outside the prefix is explained');
const plain = run('2001:db8:1:2::5');
assert.equal(plain.kind, 'none');
assert.equal(plain.embeddedIPv4, null);

// Canonical form is RFC 5952: lowercase, longest zero run collapsed, at least two groups.
const canon = [
  ['2002:0DB8:0000:0000:0000:0000:0000:0001', '2002:db8::1'],
  ['2001:0:0:1:0:0:0:1', '2001:0:0:1::1'],
  ['2001:0:0:1:0:0:0:0', '2001:0:0:1::'],
  ['fe80:0:0:0:0:5efe:a00:7', 'fe80::5efe:a00:7'],
  ['0:0:0:0:0:0:0:0', '::'],
  ['2002:c000:221:0:0:0:0:1', '2002:c000:221::1'],
];
for (const [input, expected] of canon) {
  assert.equal(run(input).canonical, expected, `canonical ${input}`);
}
// A tie between two zero runs keeps the first.
assert.equal(run('2001:0:0:1:0:0:2:1').canonical, '2001::1:0:0:2:1');

// An embedded dotted tail is accepted in the input, and a zone ID is not.
assert.equal(run('64:ff9b::192.0.2.33').embeddedIPv4, '192.0.2.33');
assert.equal(run('64:ff9b::c000:221').embeddedIPv4, '192.0.2.33');
assert.equal(run('2001:db8::192.0.2.33').kind, 'none');

// ---- 5. Refusals name the field.
const refuses = (address, prefix, message) => {
  assert.throws(() => C.decode({ address, prefix }), (error) => {
    assert.equal(error.message, message);
    return true;
  }, `expected the refusal "${message}"`);
};
refuses('', '', 'Enter an IPv6 address.');
refuses('   ', '', 'Enter an IPv6 address.');
refuses('2001:db8:: 1', '', 'Enter one IPv6 address without spaces or control characters.');
refuses('[2002:c000:221::1]', '', 'Bracketed host syntax is not accepted; enter the address itself.');
refuses('2002:c000:221::1/48', '', 'Enter the address without a prefix length; a NAT64 prefix goes in its own field.');
refuses('2002:c000:221::1%eth0', '', 'Enter the address without a zone ID; a zone ID is a local interface name, not part of the address.');
refuses('2002::c000::1', '', 'An address can contain at most one :: compression marker.');
refuses('2002:c000:221:1', '', 'An uncompressed address needs exactly eight groups.');
refuses('2002:c000:221::1::', '', 'An address can contain at most one :: compression marker.');
refuses('2002:c0000:221:0:0:0:0:1', '', 'Each group must be one to four hexadecimal digits.');
refuses('2002:zzzz::1', '', 'Each group must be one to four hexadecimal digits.');
refuses('2002:1:2:3:4:5:6:7:8', '', 'An uncompressed address needs exactly eight groups.');
refuses('2002::1.2.3', '', 'The embedded IPv4 part must be four decimal octets from 0 to 255.');
refuses('2002::1.2.3.256', '', 'The embedded IPv4 part must be four decimal octets from 0 to 255.');
refuses('2002::1.2.3.04', '', 'The embedded IPv4 part must be four decimal octets from 0 to 255.');
refuses('2001:db8::1', '2001:db8::', 'Give the NAT64 prefix with its length, such as 2001:db8:122::/48.');
refuses('2001:db8::1', '2001:db8::/95', 'A NAT64 prefix can only be 32, 40, 48, 56, 64 or 96 bits long.');
refuses('2001:db8::1', '2001:db8::/64/64', 'Give the NAT64 prefix with its length, such as 2001:db8:122::/48.');
refuses('2001:db8::1', '2001:db8:122:1::/48', 'The NAT64 prefix has bits set after the first 48; clear them and try again.');

// ---- 6. Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2372, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2112, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'IPv6 Transition Address Decoder');
assert.equal(record.category, 'Networking');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length === 5, 'five sources');
for (const rfc of ['rfc3056', 'rfc4380', 'rfc5214', 'rfc6052', 'rfc7526']) {
  assert.ok(record.sources.some((entry) => (entry.url || '').includes(rfc)), `${rfc} cited`);
}
assert.ok(record.sources.every((entry) => (entry.url || '').startsWith('https://www.rfc-editor.org/rfc/')),
  'every source is an RFC');
assert.ok(typeof record.method === 'string' && record.method.length > 900, 'method documented');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 200, 'guidance present');
assert.ok(record.aliases.length >= 6 && new Set(record.aliases).size === record.aliases.length, 'aliases unique');
assert.ok(record.tags.length >= 6 && new Set(record.tags).size === record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 18, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 6, 'golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6, 'boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6, 'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 50, 'Networking count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, `name collides with ${other.slug}`);
  assert.ok(!(other.aliases || []).map((alias) => alias.toLowerCase()).includes(record.name.toLowerCase()),
    `the new name collides with an alias on ${other.slug}`);
}
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expectedError) {
    assert.throws(() => C.decode(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.decode(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.equal(typeof result[field], typeof value, `${label}: ${field} type`);
    assert.equal(result[field], value, `${label}: ${field}`);
  }
}

// ---- 7. Page contract: local-only, keyboard-submittable, one form.
assert.ok(html.includes('id="ita-form"'), 'form present');
assert.ok(html.includes('id="address"') && html.includes('id="nat64-prefix"'), 'inputs present');
assert.ok(html.includes('id="ref-body"'), 'reference table present');
assert.ok(html.includes('aria-labelledby="ref-title"'), 'table named by its heading');
assert.ok(!html.includes('fetch(') && !html.includes('XMLHttpRequest'), 'no network calls');
assert.ok(!/\bWebSocket\b/.test(html), 'no sockets');
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')), 'no external URLs in the page');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1, 'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
assert.ok(/<button\b[^>]*type="submit"/.test(html), 'submit button present');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const id of ['address', 'nat64-prefix']) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(html), `label for ${id}`);
}
assert.ok(html.includes('aria-live="polite"'), 'results are announced');
assert.ok(html.includes('<meta name="description"'), 'meta description present');

console.log('ipv6 transition address decoder: all assertions passed');
