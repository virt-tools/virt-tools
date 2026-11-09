/* Regression checks for the systemd-networkd .network builder core: catalog
   cases, independent subnet arithmetic, generated-file structure and the
   page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'systemd-networkd-network-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* systemd-network-core:start */');
const end = html.indexOf('/* systemd-network-core:end */');
assert.ok(start > -1 && end > start, 'network core markers missing');
const core = html.slice(start, end + '/* systemd-network-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SystemdNetworkCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const build = (input) => plain(C.build(input));
const failure = (input) => {
  try {
    build(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const base = (over) => Object.assign({
  interface: 'enp1s0',
  priority: '10',
  mode: 'static',
  addresses: '192.168.1.20/24',
  gateway: '192.168.1.1',
  dns: '192.168.1.1',
  domains: 'lan',
  mtu: '',
  acceptRa: true
}, over);

// ---- Library surface.
assert.equal(C.MAX_ADDRESSES, 16);
assert.equal(C.MAX_DNS, 4);
assert.equal(C.MAX_DOMAINS, 8);
assert.deepEqual(plain(C.parseIPv4('203.0.113.7')), [203, 0, 113, 7]);
assert.equal(C.parseIPv4('203.0.113.256'), null);
assert.equal(C.parseIPv4('203.0.113'), null);
assert.equal(C.toText(3221225985), '192.0.2.1');

// ---- Golden file: static IPv4 with gateway, DNS and a search domain.
const golden = build(base({}));
assert.equal(golden.filename, '10-enp1s0.network');
assert.equal(golden.file, [
  '# /etc/systemd/network/10-enp1s0.network',
  '[Match]',
  'Name=enp1s0',
  '',
  '[Network]',
  'DHCP=no',
  'Address=192.168.1.20/24',
  'Gateway=192.168.1.1',
  'DNS=192.168.1.1',
  'Domains=lan',
  ''
].join('\n'));
assert.equal(golden.warnings.length, 0);
assert.equal(golden.addresses.length, 1);
assert.equal(golden.addresses[0].network, '192.168.1.0');
assert.equal(golden.addresses[0].broadcast, '192.168.1.255');
assert.equal(golden.addresses[0].range, '192.168.1.1 – 192.168.1.254');
assert.equal(golden.addresses[0].usable, 254);
assert.equal(golden.addresses[0].gatewayInSubnet, true);

// ---- Golden file: DHCP for one family.
const dhcp = build({ interface: 'eth0', priority: '20', mode: 'dhcp', dhcpFamily: 'ipv4', useDns: true, useDomains: false, mtu: '' });
assert.equal(dhcp.filename, '20-eth0.network');
assert.equal(dhcp.file, [
  '# /etc/systemd/network/20-eth0.network',
  '[Match]',
  'Name=eth0',
  '',
  '[Network]',
  'DHCP=ipv4',
  '',
  '[DHCPv4]',
  'UseDNS=yes',
  'UseDomains=no',
  ''
].join('\n'));
assert.deepEqual(dhcp.addresses, []);
assert.equal(dhcp.warnings.length, 0);

const both = build({ interface: 'eth0', priority: '5', mode: 'dhcp', dhcpFamily: 'yes', useDns: false, useDomains: true, mtu: '1400' });
assert.match(both.file, /^DHCP=yes$/m);
assert.match(both.file, /^MTU=1400$/m);
assert.equal((both.file.match(/\[DHCPv4\]/g) || []).length, 1);
assert.equal((both.file.match(/\[DHCPv6\]/g) || []).length, 1);
assert.equal((both.file.match(/^UseDNS=no$/gm) || []).length, 2);
assert.equal((both.file.match(/^UseDomains=yes$/gm) || []).length, 2);

const v6 = build({ interface: 'eth0', priority: '30', mode: 'dhcp', dhcpFamily: 'ipv6', useDns: true, useDomains: false });
assert.match(v6.file, /^DHCP=ipv6$/m);
assert.ok(!v6.file.includes('[DHCPv4]'));
assert.equal((v6.file.match(/\[DHCPv6\]/g) || []).length, 1);

// ---- Boundary: priority formatting, MTU presence and IPv6 RA switch.
assert.equal(build(base({ priority: '1' })).filename, '01-enp1s0.network');
assert.equal(build(base({ priority: '99' })).filename, '99-enp1s0.network');
assert.ok(!golden.file.includes('MTU='));
assert.match(build(base({ mtu: '1500' })).file, /^MTU=1500$/m);
assert.match(build(base({ acceptRa: false })).file, /^IPv6AcceptRA=no$/m);
assert.ok(!build(base({ acceptRa: true })).file.includes('IPv6AcceptRA'));

// ---- Boundary: subnet arithmetic, checked against an independent BigInt oracle.
const oracle = (address, prefix) => {
  const octets = address.split('.').map(Number);
  const value = (BigInt(octets[0]) << 24n) | (BigInt(octets[1]) << 16n) | (BigInt(octets[2]) << 8n) | BigInt(octets[3]);
  const all = (1n << 32n) - 1n;
  const mask = prefix === 0 ? 0n : all ^ ((1n << BigInt(32 - prefix)) - 1n);
  const network = value & mask;
  const broadcast = network | (all ^ mask);
  const size = BigInt(2) ** BigInt(32 - prefix);
  const usable = prefix <= 30 ? Number(size - 2n) : (prefix === 31 ? 2 : 1);
  const first = prefix <= 30 ? network + 1n : network;
  const last = prefix <= 30 ? broadcast - 1n : broadcast;
  const text = (number) => [(number >> 24n) & 255n, (number >> 16n) & 255n, (number >> 8n) & 255n, number & 255n].join('.');
  return { network: text(network), broadcast: text(broadcast), first: text(first), last: text(last), usable };
};

const subnetCases = [
  ['10.0.0.5', 8], ['172.16.5.4', 12], ['192.168.255.254', 24], ['203.0.113.9', 30],
  ['198.51.100.1', 31], ['192.0.2.7', 32], ['0.0.0.1', 0], ['255.255.255.254', 23]
];
subnetCases.forEach(([address, prefix]) => {
  const result = build(base({ addresses: `${address}/${prefix}`, gateway: '', dns: '', domains: '' }));
  const expected = oracle(address, prefix);
  const row = result.addresses[0];
  assert.equal(row.cidr, `${address}/${prefix}`);
  assert.equal(row.network, expected.network, `network for ${address}/${prefix}`);
  assert.equal(row.broadcast, expected.broadcast, `broadcast for ${address}/${prefix}`);
  assert.equal(row.usable, expected.usable, `usable for ${address}/${prefix}`);
  assert.equal(row.range, `${expected.first} – ${expected.last}`);
  assert.equal(result.file.includes(`Address=${address}/${prefix}\n`), true);
});

// ---- Boundary: multiple addresses keep their order and the gateway is matched per block.
const multi = build(base({
  addresses: '10.0.0.5/24, 10.0.0.6/24\n172.16.4.1/30',
  gateway: '172.16.4.2',
  dns: '1.1.1.1 8.8.8.8',
  domains: 'example.com corp.example.com',
  mtu: '9000',
  acceptRa: false
}));
assert.equal(multi.addresses.length, 3);
assert.deepEqual(multi.addresses.map((row) => row.cidr), ['10.0.0.5/24', '10.0.0.6/24', '172.16.4.1/30']);
assert.deepEqual(multi.addresses.map((row) => row.gatewayInSubnet), [false, false, true]);
assert.equal((multi.file.match(/^Address=/gm) || []).length, 3);
assert.equal((multi.file.match(/^DNS=/gm) || []).length, 2);
assert.match(multi.file, /^Domains=example\.com corp\.example\.com$/m);
assert.equal(multi.warnings.length, 0);

// ---- Edge: DNS and domain normalisation, sixteen addresses accepted.
const normalised = build(base({ dns: '8.8.8.8, 1.1.1.1', domains: 'LAN,Corp.Example.COM' }));
assert.match(normalised.file, /^DNS=8\.8\.8\.8$/m);
assert.match(normalised.file, /^DNS=1\.1\.1\.1$/m);
assert.match(normalised.file, /^Domains=lan corp\.example\.com$/m);
const sixteen = Array.from({ length: 16 }, (_, index) => `10.0.${index}.1/24`).join('\n');
assert.equal(build(base({ addresses: sixteen, gateway: '', dns: '', domains: '' })).addresses.length, 16);

// ---- Edge: a network address and a broadcast address are reported, not silently used.
const onNetwork = build(base({ addresses: '192.168.5.0/24', gateway: '192.168.5.1' }));
assert.equal(onNetwork.warnings.length, 1);
assert.match(onNetwork.warnings[0], /network address of its subnet/);
const onBroadcast = build(base({ addresses: '192.168.5.255/24', gateway: '192.168.5.1' }));
assert.equal(onBroadcast.warnings.length, 1);
assert.match(onBroadcast.warnings[0], /broadcast address of its subnet/);

// ---- Edge: gateway warnings for off-subnet, network-address and point-to-point cases.
const offSubnet = build(base({ addresses: '192.168.5.10/24', gateway: '10.0.0.1' }));
assert.equal(offSubnet.warnings.length, 1);
assert.match(offSubnet.warnings[0], /not inside 192\.168\.5\.0\/24/);
assert.equal(offSubnet.addresses[0].gatewayInSubnet, false);
const gatewayIsNetwork = build(base({ addresses: '192.168.5.10/24', gateway: '192.168.5.0' }));
assert.equal(gatewayIsNetwork.warnings.length, 1);
assert.match(gatewayIsNetwork.warnings[0], /network or broadcast address/);
const pointToPoint = build(base({ addresses: '10.9.9.1/31', gateway: '10.9.9.0' }));
assert.equal(pointToPoint.warnings.length, 1);
assert.match(pointToPoint.warnings[0], /\/31 range/);
const lowMtu = build(base({ mtu: '1000' }));
assert.equal(lowMtu.warnings.length, 1);
assert.match(lowMtu.warnings[0], /below the IPv6 minimum/);

// ---- Validation.
assert.equal(failure(base({ interface: '' })), 'Enter the network interface name, such as enp1s0.');
assert.equal(failure(base({ interface: 'abcdefghijklmnop' })), 'Linux limits interface names to 15 characters.');
assert.equal(failure(base({ interface: 'eth 0' })), 'An interface name may only contain letters, digits, dot, underscore, colon, at sign or hyphen.');
assert.equal(failure(base({ interface: '..' })), 'An interface name cannot be . or ..');
assert.equal(failure(base({ priority: '0' })), 'File priority must be a whole number from 1 to 99.');
assert.equal(failure(base({ priority: '100' })), 'File priority must be a whole number from 1 to 99.');
assert.equal(failure(base({ priority: 'ten' })), 'File priority must be a whole number from 1 to 99.');
assert.equal(failure(base({ mode: 'auto' })), 'Choose static IPv4 addressing or DHCP.');
assert.equal(failure(base({ addresses: '   ' })), 'Enter at least one IPv4 address with its prefix, such as 192.168.1.20/24.');
assert.equal(failure(base({ addresses: '10.0.0.1' })), 'Address 10.0.0.1 must be written as an IPv4 address with a prefix length, such as 192.168.1.20/24.');
assert.equal(failure(base({ addresses: '10.0.0.1/33' })), 'Address 10.0.0.1/33 prefix must be between 0 and 32, not 33.');
assert.equal(failure(base({ addresses: '10.0.0.1/' })), 'Address 10.0.0.1/ needs a whole-number prefix from 0 to 32 after the slash.');
assert.equal(failure(base({ addresses: '010.0.0.1/24' })), 'Address 010.0.0.1/24 is not a valid IPv4 address: 010.0.0.1.');
assert.equal(failure(base({ addresses: '300.0.0.1/24' })), 'Address 300.0.0.1/24 is not a valid IPv4 address: 300.0.0.1.');
assert.equal(failure(base({ addresses: '10.0.0.1/24, 10.0.0.1/24' })), 'Address 10.0.0.1/24 is listed twice.');
assert.equal(failure(base({ addresses: Array.from({ length: 17 }, (_, index) => `10.0.${index}.1/24`).join(' ') })), 'Enter at most 16 addresses.');
assert.equal(failure(base({ gateway: '10.0.0' })), 'Gateway must be a plain IPv4 address such as 192.168.1.1.');
assert.equal(failure(base({ gateway: '10.0.0.256' })), 'Gateway must be a plain IPv4 address such as 192.168.1.1.');
assert.equal(failure(base({ dns: '1.1.1.256' })), 'DNS server 1.1.1.256 is not a valid IPv4 address.');
assert.equal(failure(base({ dns: '1.1.1.1 1.0.0.1 8.8.8.8 9.9.9.9 8.8.4.4' })), 'List at most 4 DNS servers.');
assert.equal(failure(base({ domains: '~.' })), 'Route-only domains beginning with ~ are not supported by this builder.');
assert.equal(failure(base({ domains: 'bad_domain' })), 'Search domain bad_domain is not a valid DNS name.');
assert.equal(failure(base({ mtu: '100' })), 'MTU must be a whole number from 576 to 9000, or left blank.');
assert.equal(failure(base({ mtu: '10000' })), 'MTU must be a whole number from 576 to 9000, or left blank.');
assert.equal(failure(base({ mtu: '14x0' })), 'MTU must be a whole number from 576 to 9000, or left blank.');
assert.equal(failure({ interface: 'eth0', priority: '10', mode: 'dhcp', dhcpFamily: 'no' }), 'Choose DHCP=ipv4, ipv6 or yes for DHCP addressing.');

// ---- Randomised designs: file shape, independent subnet arithmetic, no stray keys.
let seed = 20261109;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const octet = () => Math.floor(random() * 256);
const knownKeys = new Set([
  'Name', 'DHCP', 'Address', 'Gateway', 'DNS', 'Domains', 'IPv6AcceptRA', 'MTU', 'UseDNS', 'UseDomains'
]);
const knownSections = new Set(['Match', 'Network', 'DHCPv4', 'DHCPv6']);
for (let index = 0; index < 300; index += 1) {
  const address = [octet(), octet(), octet(), octet()];
  const prefix = Math.floor(random() * 33);
  const cidr = `${address.join('.')}/${prefix}`;
  const result = build(base({ addresses: cidr, gateway: '', dns: '', domains: '', mtu: '' }));
  const expected = oracle(address.join('.'), prefix);
  assert.equal(result.addresses[0].network, expected.network, `random network ${cidr}`);
  assert.equal(result.addresses[0].broadcast, expected.broadcast, `random broadcast ${cidr}`);
  assert.equal(result.addresses[0].usable, expected.usable, `random usable ${cidr}`);
  const lines = result.file.split('\n');
  assert.equal(lines[lines.length - 1], '');
  let section = '';
  for (const line of lines.slice(0, -1)) {
    if (line.startsWith('#')) continue;
    if (line === '') continue;
    if (/^\[[A-Za-z]+\]$/.test(line)) {
      section = line.slice(1, -1);
      assert.ok(knownSections.has(section), `unknown section ${section}`);
      continue;
    }
    const eq = line.indexOf('=');
    assert.ok(eq > 0, `line is not a directive: ${line}`);
    assert.ok(knownKeys.has(line.slice(0, eq)), `unknown key ${line}`);
    assert.ok(section !== '', `directive outside a section: ${line}`);
  }
  assert.equal((result.file.match(/^\[Match\]$/gm) || []).length, 1);
  assert.equal((result.file.match(/^\[Network\]$/gm) || []).length, 1);
  assert.equal((result.file.match(/^Name=/gm) || []).length, 1);
  assert.equal((result.file.match(/^Address=/gm) || []).length, 1);
  assert.ok(result.file.includes(`Address=${cidr}\n`));
}

// ---- Page contract: no storage, no network, no innerHTML, single inline script.
assert.ok(!/\bfetch\s*\(/.test(html), 'page must not fetch');
assert.ok(!/XMLHttpRequest/.test(html), 'page must not use XMLHttpRequest');
assert.ok(!/localStorage|sessionStorage/.test(html), 'page must not use storage');
assert.ok(!/\.innerHTML\b/.test(html), 'page must not assign innerHTML');
assert.ok(!/\beval\s*\(/.test(html), 'page must not eval');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'page must not reference remote URLs');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.match(html, /<form id="network-form" novalidate>/);
assert.match(html, /id="status"[^>]*aria-live="polite"/);
assert.match(html, /min-height:44px/);

console.log('systemd-networkd network builder: all checks passed');
