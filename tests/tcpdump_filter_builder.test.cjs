/* tcpdump capture filter checks: the page core against hand-written libpcap
   expectations, the catalog replay, validation messages, and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tcpdump-filter-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* bpf-filter-core:start */';
const endMarker = '/* bpf-filter-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'bpf core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BpfFilterCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.build({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(C.FIELDS), ['host', 'net', 'ports', 'proto', 'flags', 'join', 'iface']);
assert.deepEqual(plain(C.DEFAULTS), {
  host: '', hostDir: 'any', net: '', netDir: 'any', ports: '443', portDir: 'any',
  proto: 'tcp', flags: 'none', join: 'all', negate: false, iface: 'any',
});
assert.deepEqual(plain(C.PROTOCOLS), ['any', 'tcp', 'udp', 'icmp', 'icmp6', 'arp', 'ip', 'ip6', 'sctp']);
assert.deepEqual(plain(C.DIRECTIONS), ['any', 'src', 'dst']);
assert.deepEqual(Object.keys(plain(C.FLAG_MODES)), ['none', 'syn', 'rst', 'fin']);
assert.equal(C.MAX_PORTS, 12);

// ---- Published default: TCP on port 443, in either direction.
const published = run({});
assert.equal(published.expr, 'tcp and port 443');
assert.equal(published.command, "tcpdump -nn -i any 'tcp and port 443'");
assert.equal(published.summary, '2 conditions, all must match: tcp; 443 (either)');
assert.equal(published.conditionCount, 2);
assert.equal(published.warningCount, 0);
assert.deepEqual(published.warnings, []);
assert.ok(published.explanation.length >= 3);

// ---- Expressions verified per packet against libpcap in the cycle oracle.
const EXPECTED = {
  'no condition but a protocol': [{ proto: 'tcp', ports: '' }, 'tcp'],
  'dns preset': [{ proto: 'udp', ports: '53' }, 'udp and port 53'],
  'one host': [{ proto: 'any', host: '192.0.2.10', ports: '' }, 'host 192.0.2.10'],
  'source host to destination ports': [
    { proto: 'tcp', host: '10.0.0.5', hostDir: 'src', ports: '80, 443', portDir: 'dst' },
    'tcp and src host 10.0.0.5 and (dst port 80 or dst port 443)',
  ],
  'a port range': [{ proto: 'any', ports: '8000-8100' }, 'portrange 8000-8100'],
  'a source port range': [{ proto: 'any', ports: '1024-2048', portDir: 'src' }, 'src portrange 1024-2048'],
  'a source network': [{ proto: 'any', net: '10.0.0.0/8', netDir: 'src', ports: '' }, 'src net 10.0.0.0/8'],
  'an any-match join': [
    { proto: 'any', host: '198.51.100.7', ports: '8000-8100', join: 'any' },
    'host 198.51.100.7 or portrange 8000-8100',
  ],
  'ipv6 host and port': [
    { proto: 'ip6', host: '2001:db8::1', ports: '443' },
    'ip6 and host 2001:db8::1 and port 443',
  ],
  'an inverted filter': [{ proto: 'any', ports: '22', negate: true }, 'not (port 22)'],
  'a service name': [{ proto: 'tcp', ports: 'https' }, 'tcp and port https'],
  'sctp with a port': [{ proto: 'sctp', ports: '3868' }, 'sctp and port 3868'],
  'a named interface': [{ proto: 'tcp', ports: '443', iface: 'eth0' }, 'tcp and port 443'],
};
for (const [label, [input, expected]] of Object.entries(EXPECTED)) {
  assert.equal(run(input).expr, expected, label);
}

// ---- TCP flag expressions are the documented bit tests.
assert.equal(run({ proto: 'tcp', ports: '', flags: 'syn' }).expr,
  'tcp and tcp[tcpflags] & (tcp-syn|tcp-ack) == tcp-syn');
assert.equal(run({ proto: 'any', ports: '', flags: 'rst' }).expr,
  'tcp[tcpflags] & tcp-rst != 0');
assert.equal(run({ proto: 'tcp', ports: '', flags: 'fin' }).expr,
  'tcp and tcp[tcpflags] & tcp-fin != 0');

// ---- Networks are masked because libpcap rejects host bits in a CIDR block.
const masked = run({ proto: 'any', net: '192.168.1.5/24', ports: '' });
assert.equal(masked.expr, 'net 192.168.1.0/24');
assert.equal(masked.warningCount, 1);
assert.match(masked.warnings[0], /host bits set/);
assert.equal(run({ proto: 'any', net: '0.0.0.0/0', ports: '' }).expr, 'net 0.0.0.0/0');
assert.equal(run({ proto: 'any', net: '255.255.255.255/32', ports: '' }).expr, 'net 255.255.255.255/32');
assert.equal(run({ proto: 'ip6', net: '2001:db8::1/128', ports: '' }).expr, 'ip6 and net 2001:db8::1/128');
assert.equal(run({ proto: 'any', net: '192.168.1.0/24', ports: '' }).warningCount, 0);

// ---- Port parsing.
assert.deepEqual(plain(C.parsePorts('443')), [{ kind: 'port', text: '443' }]);
assert.deepEqual(plain(C.parsePorts('80, 443')), [{ kind: 'port', text: '80' }, { kind: 'port', text: '443' }]);
assert.deepEqual(plain(C.parsePorts(' 53  443 ')), [{ kind: 'port', text: '53' }, { kind: 'port', text: '443' }]);
assert.deepEqual(plain(C.parsePorts('8000-8100')), [{ kind: 'range', text: '8000-8100' }]);
assert.deepEqual(plain(C.parsePorts('00080')), [{ kind: 'port', text: '80' }]);
assert.deepEqual(plain(C.parsePorts('HTTPS')), [{ kind: 'port', text: 'https' }]);
assert.deepEqual(plain(C.parsePorts('')), []);
assert.equal(C.isIpv4('192.0.2.10'), true);
assert.equal(C.isIpv4('192.0.2.256'), false);
assert.equal(C.isIpv6('2001:db8::1'), true);
assert.equal(C.isIpv6('::'), true);
assert.equal(C.isIpv6('2001:db8:::1'), false);
assert.equal(C.isIpv6('12345::1'), false);

// ---- Address families and warnings that prevent silent empty results.
const family = run({ proto: 'ip', host: '2001:db8::1', ports: '' });
assert.match(family.warnings.join(' '), /IPv4 protocol condition cannot match an IPv6 host/);
assert.match(run({ proto: 'icmp', ports: '443' }).warnings.join(' '), /ICMP carries no port numbers/);
assert.match(run({ proto: 'arp', ports: '443' }).warnings.join(' '), /ARP carries no port numbers/);
assert.match(run({ proto: 'tcp', host: 'example.com', ports: '' }).warnings.join(' '), /resolves it once/);
assert.match(run({ proto: 'tcp', ports: '443', iface: 'eth0' }).warnings.join(' '), /limited to interface eth0/);

// ---- Validation messages.
assert.equal(failure({ proto: 'any', ports: '' }),
  'Add at least one condition: a protocol, host, network, port or TCP flag.');
assert.equal(failure({ host: 'bad host' }), 'Host must be an IPv4 address, IPv6 address or host name.');
assert.equal(failure({ host: '192.0.2.256' }), 'Host must be an IPv4 address, IPv6 address or host name.');
assert.equal(failure({ host: '-example.com' }), 'Host must be an IPv4 address, IPv6 address or host name.');
assert.equal(failure({ net: '192.168.0.0' }), 'Network must be a CIDR block such as 192.168.0.0/16.');
assert.equal(failure({ net: '10.0.0.0/33' }), 'An IPv4 network prefix must be from 0 to 32.');
assert.equal(failure({ net: '2001:db8::1/129' }), 'An IPv6 network prefix must be from 0 to 128.');
assert.equal(failure({ ports: '0' }), 'Ports must be between 1 and 65535.');
assert.equal(failure({ ports: '65536' }), 'Ports must be between 1 and 65535.');
assert.equal(failure({ ports: '900-100' }), 'Port ranges must run from low to high, such as 8000-8100.');
assert.equal(failure({ ports: '1,2,3,4,5,6,7,8,9,10,11,12,13' }), 'Use at most 12 ports.');
assert.equal(failure({ ports: 'http:' }), 'Ports must be numbers, ranges such as 8000-8100, or service names.');
assert.equal(failure({ proto: 'foo' }), 'Choose one of the listed protocols.');
assert.equal(failure({ proto: 'udp', flags: 'syn', ports: '' }),
  'TCP flag matching needs the TCP protocol; choose any protocol or TCP.');
assert.equal(failure({ iface: '' }), 'Interface is required; use any for all interfaces.');
assert.equal(failure({ iface: 'abcdefghijklmnop' }),
  'Interface must be 1-15 letters, digits, dots, colons, at signs, underscores or hyphens.');
assert.equal(failure({ join: 'xor' }), 'Choose whether all conditions must match or any may match.');
assert.equal(failure({ hostDir: 'sideways' }), 'Direction must be either, source or destination.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'tcpdump Capture Filter Builder');
assert.equal(record.category, 'IT & Networking');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('libpcap'), 'method documents the libpcap contract');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
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

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 5, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of C.FIELDS) {
  assert.ok(new RegExp(`<label for="${field}"`).test(html), 'control is labelled: ' + field);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<main/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/<form id="filter-form"/.test(html), 'the form submits so Enter builds the filter');
// The markup's initial state must equal the core defaults, otherwise the page
// opens on a validation error before the user touches anything.
assert.ok(/<option value="tcp" selected>/.test(html), 'the protocol select starts on TCP');
assert.ok(/<input id="ports" type="text" value="443"/.test(html), 'the ports field starts at 443');
assert.equal(run({}).expr, 'tcp and port 443');
for (const button of html.match(/<button\b[^>]*>/g)) {
  assert.ok(/type="(?:button|submit)"/.test(button), 'button declares a type: ' + button);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[\u2190\u00b7\u2014]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('tcpdump-filter-builder: all checks passed ('
  + record.testCases.length + ' catalog cases, '
  + Object.keys(EXPECTED).length + ' expression expectations)');
