/* Regression checks for the DHCP classless static route encoder: the catalogued
   cases, an independent byte-level recomputation over seeded route sets, the
   documented layout invariants, the refusals, and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'dhcp-classless-route-encoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* dhcp-routes-core:start */');
const end = html.indexOf('/* dhcp-routes-core:end */');
assert.ok(start > -1 && end > start, 'dhcp routes core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DhcpRoutesCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.listed, true);
assert.equal(record.category, 'IT & Networking');
assert.equal(record.risk, 'low');
assert.equal(record.sources.length, 2, 'RFC 3442 and the IANA option registry are cited');

const failure = (mode, value) => {
  try {
    mode === 'encode' ? C.encode(value) : C.decode(value);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- the catalogued cases, replayed against the page core -------------------
assert.ok(record.testCases.length >= 30, 'the record carries at least thirty cases');
for (const testCase of record.testCases) {
  const { mode, value } = testCase.input;
  const expected = testCase.expected;
  if (expected.error) {
    const message = failure(mode, value);
    assert.ok(message, 'expected a refusal for ' + testCase.name);
    assert.equal(message, expected.error, testCase.name);
    continue;
  }
  const result = mode === 'encode' ? C.encode(value) : C.decode(value);
  assert.equal(result.dataHex, expected.dataHex, testCase.name + ' dataHex');
  assert.equal(result.dataBytes, expected.dataBytes, testCase.name + ' dataBytes');
  assert.equal(result.routeCount, expected.routeCount, testCase.name + ' routeCount');
  if (expected.optionHex) assert.equal(result.optionHex, expected.optionHex, testCase.name + ' optionHex');
  if (expected.routes) {
    assert.deepEqual(Array.from(result.routes, (route) => [route.cidr, route.gateway]), expected.routes.map((row) => [...row]), testCase.name + ' routes');
  }
  if (expected.headerCode !== undefined) assert.equal(result.headerCode, expected.headerCode, testCase.name + ' headerCode');
}

// ---- independent reference, written from the RFC prose ----------------------
function reference(pairs) {
  const bytes = [];
  for (const [base, prefix, router] of pairs) {
    const net = base >>> 0;
    bytes.push(prefix);
    const count = Math.ceil(prefix / 8);
    for (let index = 0; index < count; index += 1) {
      bytes.push((net >>> (24 - 8 * index)) & 0xff);
    }
    for (let index = 0; index < 4; index += 1) {
      bytes.push((router >>> (24 - 8 * index)) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('hex');
}

function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry(3442);
const octet = () => Math.floor(rand() * 256);
const dotted = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');

for (let round = 0; round < 300; round += 1) {
  const count = 1 + Math.floor(rand() * 6);
  const lines = [];
  const pairs = [];
  for (let index = 0; index < count; index += 1) {
    const prefix = Math.floor(rand() * 33);
    const base = ((octet() * 256 + octet()) * 256 + octet()) * 256 + octet();
    const size = 2 ** (32 - prefix);
    const net = base - (base % size);
    const router = ((octet() * 256 + octet()) * 256 + octet()) * 256 + octet();
    lines.push(dotted(net) + '/' + prefix + ' ' + dotted(router));
    pairs.push([net, prefix, router]);
  }
  const result = C.encode(lines.join('\n'));
  assert.equal(result.dataHex, reference(pairs), 'seeded encode round ' + round);
  assert.equal(result.dataBytes, result.dataHex.length / 2);
  assert.equal(result.optionHex, '79' + result.dataBytes.toString(16).padStart(2, '0') + result.dataHex);
  assert.equal(result.msOptionHex, 'f9' + result.dataBytes.toString(16).padStart(2, '0') + result.dataHex);
  const back = C.decode(result.optionHex);
  assert.equal(back.dataHex, result.dataHex);
  assert.equal(back.headerCode, 121);
  assert.equal(back.routeCount, count);
  for (let index = 0; index < count; index += 1) {
    assert.equal(back.routes[index].cidr, result.routes[index].cidr);
    assert.equal(back.routes[index].gateway, result.routes[index].gateway);
  }
  for (const route of result.routes) {
    assert.equal(route.bytes, 1 + Math.ceil(route.prefix / 8) + 4);
    assert.equal(route.descriptorHex.length, route.bytes * 2);
  }
}

// ---- the RFC's own descriptor table ----------------------------------------
const table = [
  ['0.0.0.0/0', '00'],
  ['10.0.0.0/8', '08 0a'],
  ['10.0.0.0/24', '18 0a 00 00'],
  ['10.17.0.0/16', '10 0a 11'],
  ['10.27.129.0/24', '18 0a 1b 81'],
  ['10.229.0.128/25', '19 0a e5 00 80'],
  ['10.198.122.47/32', '20 0a c6 7a 2f'],
];
for (const [cidr, descriptor] of table) {
  const result = C.encode(cidr + ' 0.0.0.0');
  assert.equal(result.routes[0].descriptorHex.slice(0, -8).replace(/(..)/g, '$1 ').trim(), descriptor, cidr);
}

// ---- invariants ------------------------------------------------------------
const single = C.encode('0.0.0.0/0 192.168.1.1');
assert.equal(single.dataBytes, 5, 'a default route is five bytes');
assert.equal(single.routes[0].octets, 0);
const wide = C.encode('10.255.255.255/32 10.0.0.1');
assert.equal(wide.routes[0].octets, 4);
assert.equal(wide.routes[0].cidr, '10.255.255.255/32');
const hostBits = C.encode('10.0.0.17/24 10.0.0.1');
assert.equal(hostBits.routes[0].cidr, '10.0.0.0/24', 'host bits are masked to the network address');
assert.equal(hostBits.routes[0].masked, true);
assert.ok(hostBits.warnings.some((line) => line.includes('host bits')));
const sameLink = C.encode('10.0.0.0/24 0.0.0.0');
assert.equal(sameLink.routes[0].sameLink, true);
assert.ok(sameLink.warnings.some((line) => line.includes('same link')));
const noDefault = C.encode('10.0.0.0/8 10.0.0.1');
assert.ok(noDefault.warnings.some((line) => line.includes('Router option')), 'the Router option note appears without a default route');
const withDefault = C.encode('0.0.0.0/0 192.168.1.1\n10.0.0.0/8 10.0.0.1');
assert.ok(!withDefault.warnings.some((line) => line.includes('Router option')));
const full = C.encode(Array.from({ length: 51 }, (_, index) => '0.0.0.0/0 10.0.0.' + (index + 1)).join('\n'));
assert.equal(full.dataBytes, 255, 'fifty-one default routes fill the option exactly');
assert.equal(full.routes.length, 51);
const lower = C.encode('0.0.0.0/0 192.168.1.1\n10.0.0.0/8 via 10.0.0.1');
assert.equal(lower.routeCount, 2, 'the word via is accepted between destination and router');
assert.equal(C.encode('# a comment\n10.0.0.0/8, 10.0.0.1').routeCount, 1, 'comments and commas are accepted');
const maskedDecode = C.decode('19 81 d4 b1 84 c0 a8 01 01');
assert.equal(maskedDecode.routes[0].destination, '129.212.177.132');
assert.equal(maskedDecode.routes[0].cidr, '129.212.177.128/25');
assert.equal(maskedDecode.routes[0].masked, true);

// ---- refusals --------------------------------------------------------------
const refusals = [
  ['encode', ''],
  ['encode', '   '],
  ['encode', '10.0.0.0/8'],
  ['encode', '10.0.0.0 10.0.0.1'],
  ['encode', '10.0.0.0/33 10.0.0.1'],
  ['encode', '10.0.0.0/-1 10.0.0.1'],
  ['encode', '10.0.0.0/ 10.0.0.1'],
  ['encode', '10.0.0.256/24 10.0.0.1'],
  ['encode', '10.0.0.0/8 010.0.0.1'],
  ['encode', '10.0.0.0/8 10.0.0.0/8'],
  ['encode', '10.0.0.0/8 10.0.0.1 extra'],
  ['encode', Array.from({ length: 52 }, (_, index) => '0.0.0.0/0 10.0.0.' + (index + 1)).join('\n')],
  ['decode', ''],
  ['decode', '080'],
  ['decode', 'zz'],
  ['decode', '18 c0 a8 0a c0 a8 01'],
  ['decode', '21 0a 00 00 00 0a 00 00 01'],
  ['decode', '79 06 00 c0 a8 01 01'],
];
for (const [mode, value] of refusals) {
  assert.ok(failure(mode, value), mode + ' refusal for ' + JSON.stringify(value.slice(0, 40)));
}
assert.ok(failure('decode', '79 06 00 c0 a8 01 01').includes('bytes follow'), 'a mismatched length octet names the mismatch');

// ---- page contract ---------------------------------------------------------
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/(?:src|href)="https?:/.test(html), 'no off-site asset references');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html.slice(html.indexOf('/* dhcp-routes-core:end */'))), 'no network or storage calls in the page script');
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const id of ['mode-encode', 'mode-decode', 'in-routes', 'err', 'out', 'warn', 'copy', 'rows', 'route-form', 'run']) {
  assert.ok(ids.includes(id), 'missing control #' + id);
}
assert.ok(/<label[^>]*\bfor="in-routes"/.test(html), 'the textarea is labelled');
assert.ok(/<textarea[^>]*\bid="in-routes"/.test(html));
assert.ok(html.includes('aria-pressed'), 'the mode buttons expose their state');
assert.ok(html.includes('aria-live'), 'the result region is announced');
assert.ok(html.includes('id="method"'), 'the method note has its own id');

console.log('dhcp-classless-route-encoder: ' + record.testCases.length + ' catalog cases, 300 seeded rounds, 18 refusals, page contract — all green');
