/* Regression checks for the Reverse DNS Zone Builder: catalog cases, an independent
   zone-name implementation over random prefixes, and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'reverse-dns-zone-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* rdns-core:start */');
const end = html.indexOf('/* rdns-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* rdns-core:end */'.length);
const sandbox = { module: {}, BigInt };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ReverseDnsCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const build = (prefix, target) => plain(C.build(prefix, target === undefined ? 'host.example.com.' : target));
const failure = (prefix, target) => {
  try {
    C.build(prefix, target === undefined ? 'host.example.com.' : target);
  } catch (error) {
    return error.message;
  }
  return null;
};

const record = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'))
  .tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.listed, true, 'the new tool is listed');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 2, 'standards sources recorded');

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  const input = testCase.input || {};
  if (testCase.kind === 'validation') {
    const message = failure(input.prefix, input.target);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = build(input.prefix, input.target);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    let actual;
    if (key === 'firstRecord') {
      actual = result.lines.find((line) => !line.startsWith(';') && /\b(?:PTR|CNAME)\b/.test(line));
    } else if (key === 'lastRecord') {
      actual = [...result.lines].reverse().find((line) => !line.startsWith(';') && /\b(?:PTR|CNAME)\b/.test(line));
    } else if (key === 'lastLine') {
      actual = result.lines[result.lines.length - 1];
    } else if (key === 'note') {
      actual = result.notes.some((note) => note.includes(expected));
      assert.ok(actual, `${testCase.name}: no note mentions "${expected}"`);
      continue;
    } else {
      actual = result[key];
    }
    assert.deepEqual(actual, expected, `${testCase.name}: ${key}`);
  }
  assert.ok(result.lines.every((line) => typeof line === 'string' && !/undefined|NaN/.test(line)), `${testCase.name}: clean lines`);
}
assert.equal(kinds.golden, 9, 'nine golden cases');
assert.equal(kinds.boundary, 6, 'six boundary cases');
assert.equal(kinds.validation, 20, 'twenty validation cases');
assert.equal(record.testCases.length, 35, 'thirty-five catalog cases');

// ---- Independent implementation: names are built from strings, not from the page. ----
const reverseZone = (a, b, c) => `${c}.${b}.${a}.in-addr.arpa.`;
const reverseName = (a, b, c, d) => `${d}.${c}.${b}.${a}.in-addr.arpa.`;
const octetsOf = (net) => [(net >>> 24) & 255, (net >>> 16) & 255, (net >>> 8) & 255, net & 255];

let seed = 20261122;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
const randomInt = (max) => Math.floor(random() * max);
const randomOctets = () => [randomInt(256), randomInt(256), randomInt(256), randomInt(256)];
const countText = (bits) => (1n << BigInt(bits)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

let ipv4Cases = 0;
for (let round = 0; round < 140; round++) {
  const octets = randomOctets();
  const length = 8 + randomInt(25);
  const [a, b, c, d] = octets;
  const addr = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  const mask = length === 0 ? 0 : ((0xffffffff << (32 - length)) >>> 0);
  const net = (addr & mask) >>> 0;
  const prefix = `${a}.${b}.${c}.${d}/${length}`;
  const result = build(prefix, 'ptr.example.');
  assert.equal(result.family, 4, prefix);
  assert.equal(result.addressCountText, countText(32 - length), prefix);
  const netOctets = octetsOf(net);
  if (length < 24) {
    const total = 2 ** (24 - length);
    assert.equal(result.mode, 'zones', prefix);
    assert.equal(result.zoneCount, total, prefix);
    assert.equal(result.shownCount, Math.min(total, 64), prefix);
    const base = Math.floor(net / 256);
    for (let i = 0; i < result.shownCount; i++) {
      assert.equal(result.zones[i], reverseZone(...octetsOf(((base + i) * 256) >>> 0).slice(0, 3)), `${prefix} zone ${i}`);
    }
    assert.equal(result.ptrCount, 0, prefix);
  } else if (length === 24) {
    assert.equal(result.mode, 'zone', prefix);
    assert.equal(result.zone, reverseZone(...netOctets), prefix);
    assert.equal(result.ptrCount, 256, prefix);
    assert.equal(result.lines.filter((line) => line.endsWith('IN PTR ptr.example.')).length, 256, prefix);
  } else if (length === 32) {
    assert.equal(result.mode, 'single', prefix);
    assert.equal(result.zone, reverseName(...netOctets), prefix);
    assert.equal(result.ptrCount, 1, prefix);
    assert.equal(result.lines[result.lines.length - 1], '@ IN PTR ptr.example.', prefix);
  } else {
    const count = 2 ** (32 - length);
    const first = net & 255;
    const expectedChild = `${first}-${first + count - 1}.${reverseZone(...netOctets)}`;
    assert.equal(result.mode, 'classless', prefix);
    assert.equal(result.childZone, expectedChild, prefix);
    assert.equal(result.zone, expectedChild, prefix);
    assert.equal(result.parentZone, reverseZone(...netOctets), prefix);
    assert.equal(result.ptrCount, count, prefix);
    assert.equal(result.cnameCount, count, prefix);
    const ptrs = result.lines.filter((line) => line.endsWith('IN PTR ptr.example.'));
    const cnames = result.lines.filter((line) => line.includes(' CNAME '));
    assert.equal(ptrs.length, count, `${prefix} ptr lines`);
    assert.equal(cnames.length, count, `${prefix} cname lines`);
    assert.equal(ptrs[0], `${first} IN PTR ptr.example.`, prefix);
    assert.equal(cnames[0], `${first} CNAME ${first}.${expectedChild}`, prefix);
  }
  ipv4Cases++;
}

const hexOf = (groups) => groups.map((group) => group.toString(16).padStart(4, '0')).join('');
const reverseIp6 = (hex, nibbles) => (nibbles === 0
  ? 'ip6.arpa.'
  : Array.from({ length: nibbles }, (_, i) => hex[nibbles - 1 - i]).join('.') + '.ip6.arpa.');
let ipv6Cases = 0;
for (let round = 0; round < 90; round++) {
  const groups = Array.from({ length: 8 }, () => randomInt(65536));
  const length = 4 * randomInt(33);
  const raw = hexOf(groups);
  const kept = length === 0 ? '0'.repeat(32) : raw.slice(0, length / 4) + '0'.repeat(32 - length / 4);
  const text = groups.map((group) => group.toString(16)).join(':');
  const result = build(`${text}/${length}`, 'ptr.example.');
  assert.equal(result.family, 6, text);
  assert.equal(result.zone, reverseIp6(kept, length / 4), `${text}/${length}`);
  const hostBits = 128 - length;
  assert.equal(result.addressCountText, countText(hostBits), text);
  if (hostBits <= 8) {
    assert.equal(result.ptrCount, 2 ** hostBits, text);
    const base = BigInt('0x' + kept);
    const owners = result.lines.filter((line) => line.endsWith('IN PTR ptr.example.'))
      .map((line) => line.replace(' IN PTR ptr.example.', ''));
    assert.equal(owners.length, 2 ** hostBits, `${text} owners`);
    owners.forEach((owner, index) => {
      const full = (base + BigInt(index)).toString(16).padStart(32, '0');
      const expected = length === 128
        ? '@'
        : full.slice(length / 4).split('').reverse().join('.');
      assert.equal(owner, expected, `${text} owner ${index}`);
    });
  } else {
    assert.equal(result.ptrCount, 0, text);
    assert.equal(result.lines.filter((line) => /ip6\.arpa\./i.test(line)).length, 1, text);
  }
  ipv6Cases++;
}
assert.equal(ipv4Cases, 140);
assert.equal(ipv6Cases, 90);

// ---- Validation and normalisation edges ----
const refusals = [
  ['192.0.2.0', 'Add a prefix length'],
  ['192.0.2.0/33', 'between 0 and 32'],
  ['2001:db8::/129', 'between 0 and 128'],
  ['192.0.2.256/24', 'above 255'],
  ['192.0.2/24', 'four-part'],
  ['abc/24', 'four-part'],
  ['192.0.2.0/abc', 'whole number'],
  ['192.0.2.0/', 'whole number'],
  ['/24', 'no address'],
  ['2001:db8:::/64', 'only once'],
  ['2001:db8::1::/64', 'only once'],
  ['2001:db8:1:2:3:4:5:6:7/64', 'eight groups'],
  ['2001:db8::%eth0/64', 'zone index'],
  ['2001:db8::gggg/64', 'not a hex group']
];
for (const [prefix, needle] of refusals) {
  const message = failure(prefix, 'host.example.com.');
  assert.ok(message && message.includes(needle), `${prefix} -> ${message}`);
}
for (const [target, needle] of [
  ['', 'Enter the hostname'],
  ['   ', 'Enter the hostname'],
  ['bad host', 'spaces'],
  ['foo..example.com', 'empty label'],
  ['-bad.example.com', 'valid DNS label'],
  ['bad-.example.com', 'valid DNS label'],
  ['a'.repeat(64) + '.example.com', '63-character'],
  ['a.'.repeat(127) + 'a', 'longer than a DNS name']
]) {
  const message = failure('192.0.2.0/24', target);
  assert.ok(message && message.includes(needle), `${JSON.stringify(target)} -> ${message}`);
}
const normalized = build('192.0.2.0/24', ' web1.example.net ');
assert.equal(normalized.target, 'web1.example.net.');
assert.ok(normalized.lines.includes('0 IN PTR web1.example.net.'));
const absolute = build('192.0.2.0/24', 'web1.example.net.');
assert.equal(absolute.target, 'web1.example.net.');
const cleared = build('192.0.2.130/24');
assert.ok(cleared.notes.some((note) => note.includes('Host bits were cleared')));
const exact = build('192.0.2.0/24');
assert.equal(exact.notes.length, 0, 'a network address needs no note');
const upper = build('203.0.113.0/24', 'Host.Example.ORG');
assert.equal(upper.target, 'Host.Example.ORG.', 'case is preserved');
const rounded = build('2001:db8::/50');
assert.ok(rounded.notes.some((note) => note.includes('rounded down to /48')));
assert.equal(build('0.0.0.0/0').lines.filter((line) => line.endsWith('in-addr.arpa.')).length, 64);
assert.equal(build('2001:db8::/0').zone, 'ip6.arpa.');
assert.equal(build('2001:db8::/0').ptrCount, 0);

// ---- Page contract ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 4, 'one inline script plus header, tools.js and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.ok(/<label for="prefix-input">/.test(html));
assert.ok(/<label for="target-input">/.test(html));
assert.equal((html.match(/<input\b/g) || []).length, 2, 'two inputs');
assert.ok(/role="status" aria-live="polite"/.test(html), 'live status region');
assert.ok(/aria-label="Generated reverse DNS records"/.test(html), 'record block is labelled');
assert.ok(/<button id="copy-zone"/.test(html), 'copy control');
assert.ok(html.includes('no SOA or NS records'), 'page states what it does not emit');

console.log(`reverse-dns-zone-builder: ${record.testCases.length} catalog cases, ${ipv4Cases} IPv4 and ${ipv6Cases} IPv6 generated prefixes match the independent builder, refusals and page contract green`);
