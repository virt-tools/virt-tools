/* Regression checks for the Linux capability decoder core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/linux-capability-decoder/index.html'), 'utf8');
const start = html.indexOf('/* linux-capability-core:start */');
const end = html.indexOf('/* linux-capability-core:end */');
assert.ok(start > -1 && end > start, 'linux capability core markers missing');
const core = html.slice(start, end + '/* linux-capability-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LinuxCapabilityCore;', sandbox);
const L = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'linux-capability-decoder');
assert.ok(record, 'catalog record is missing');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6);
assert.ok(record.testCases.length >= 14, 'catalog keeps the full case set');
assert.ok(/BigInt/.test(record.method), 'method documents exact integer decoding');
assert.equal(record.sources.length, 2);

// The capability table is an independent artefact: compare it with the name list
// capsh printed on this host for the full 41-bit bounding set (0x000001ffffffffff).
const capshList = ('cap_chown,cap_dac_override,cap_dac_read_search,cap_fowner,cap_fsetid,cap_kill,cap_setgid,' +
  'cap_setuid,cap_setpcap,cap_linux_immutable,cap_net_bind_service,cap_net_broadcast,cap_net_admin,cap_net_raw,' +
  'cap_ipc_lock,cap_ipc_owner,cap_sys_module,cap_sys_rawio,cap_sys_chroot,cap_sys_ptrace,cap_sys_pacct,' +
  'cap_sys_admin,cap_sys_boot,cap_sys_nice,cap_sys_resource,cap_sys_time,cap_sys_tty_config,cap_mknod,cap_lease,' +
  'cap_audit_write,cap_audit_control,cap_setfcap,cap_mac_override,cap_mac_admin,cap_syslog,cap_wake_alarm,' +
  'cap_block_suspend,cap_audit_read,cap_perfmon,cap_bpf,cap_checkpoint_restore').split(',');
assert.equal(L.CAPABILITIES.length, 41);
assert.equal(L.LAST, 40);
assert.equal(L.CAPABILITIES.map((cap) => cap.name).join(','), capshList.join(','));
assert.equal(L.CAPABILITIES.map((cap) => cap.number).join(','), capshList.map((_, index) => index).join(','));
for (const cap of L.CAPABILITIES) {
  assert.equal(cap.constant, cap.name.toUpperCase(), 'constant spelling for ' + cap.name);
  assert.equal(cap.label, cap.name.slice(4), 'short label for ' + cap.name);
  assert.ok(cap.summary.length > 15 && /[.!]$/.test(cap.summary), 'summary for ' + cap.name);
}

// Bit n must decode to exactly capability n, for every defined number.
const bits = L.CAPABILITIES.map((cap) => cap.number);
for (const number of bits) {
  const result = L.decode({ value: (1n << BigInt(number)).toString(16), base: 'hex' });
  assert.equal(result.count, 1);
  assert.equal(result.symbolic, L.CAPABILITIES[number].name);
  assert.equal(result.highest, number);
  assert.equal(result.unknownBits.join(','), '');
}

// Mask arithmetic must be exact at 64 bits: the full set is 2^41-1, and the value
// survives the decimal, hexadecimal and binary renderings unchanged.
const full = L.decode({ value: '0x1ffffffffff', base: 'hex' });
assert.equal(full.count, 41);
assert.equal(full.decimal, '2199023255551');
assert.equal(full.hex, '0x000001ffffffffff');
assert.equal(full.procHex, '000001ffffffffff');
assert.equal(BigInt('0x' + full.procHex), (1n << 41n) - 1n);
assert.equal(BigInt(full.decimal), (1n << 41n) - 1n);
const binaryGroups = full.binary.split(' ');
assert.equal(binaryGroups.length, 8);
assert.ok(binaryGroups.every((group) => /^[01]{8}$/.test(group)), 'binary is eight-bit groups');
assert.equal(full.binary.replace(/ /g, '').replace(/0/g, '').length, 41);

// Round trip through numbers: the mask rebuilt from the set bits is the same value.
let seed = 20261108;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
for (let round = 0; round < 500; round += 1) {
  const chosen = bits.filter(() => rand() % 3 === 0);
  const result = L.decodeNumbers(chosen);
  assert.equal(result.count, chosen.length, 'count matches the selection');
  assert.equal(result.symbolic, chosen.map((number) => L.CAPABILITIES[number].name).join(','));
  const numbers = L.numbersFromMask(L.maskFromNumbers(chosen));
  assert.equal(numbers.join(','), chosen.join(','));
  assert.equal(BigInt('0x' + result.procHex), L.maskFromNumbers(chosen));
  assert.equal(BigInt(result.decimal), L.maskFromNumbers(chosen));
  assert.equal(result.highest, chosen.length ? chosen[chosen.length - 1] : null);
}

// Decimal and hexadecimal spellings of the same mask agree.
for (const mask of [0n, 1n, 1024n, 2818844155n, (1n << 41n) - 1n, 0xffffffffffffffffn]) {
  const fromHex = L.decode({ value: '0x' + mask.toString(16), base: 'hex' });
  const fromDecimal = L.decode({ value: mask.toString(10), base: 'decimal' });
  assert.equal(fromHex.hex, fromDecimal.hex);
  assert.equal(fromHex.symbolic, fromDecimal.symbolic);
}

// Undefined bits are reported, not named, and never counted as capabilities.
const stray = L.decode({ value: '0x200000000000', base: 'hex' });
assert.equal(stray.unknownBits.join(','), '45');
assert.equal(stray.count, 0);
assert.equal(stray.symbolic, '');
assert.match(stray.warnings.join(' '), /Bit 45 lies above 40/);

// The root-equivalent warning depends on the five capabilities that bypass control.
assert.equal(L.decode({ value: '0x1ffffffffff', base: 'hex' }).warnings.join(' ').includes('cap_sys_admin'), true);
assert.equal(L.decode({ value: '0x400', base: 'hex' }).warnings.length, 0);
assert.equal(L.decode({ value: '0x0', base: 'hex' }).warnings.join(' '), 'The mask is empty: no capabilities are set.');

// Name input accepts the spellings people paste, deduplicates and rejects the rest.
assert.equal(L.parseList('cap_chown, cap_sys_admin,net_bind_service  CHOWN').join(','), '0,10,21');
assert.equal(L.parseList('').length, 0);
assert.equal(L.parseList('\n , ').length, 0);
assert.equal(L.parseList('CAP_NET_ADMIN CAP_CHECKPOINT_RESTORE').join(','), '12,40');
assert.equal(L.decodeNumbers(L.parseList('cap_setuid')).hex, '0x0000000000000080');
assert.throws(() => L.parseList('cap_nope'), /"cap_nope" is not a Linux capability name/);
assert.throws(() => L.parseList('cap_'), /is not a Linux capability name/);
assert.throws(() => L.parseList('0x1f'), /is not a Linux capability name/);

// Width and format validation stay strict in both bases.
assert.throws(() => L.parseMask('', 'hex'), /Enter a capability mask/);
assert.throws(() => L.parseMask('0x', 'hex'), /only hexadecimal digits/);
assert.throws(() => L.parseMask('0xgg', 'hex'), /only hexadecimal digits/);
assert.throws(() => L.parseMask('-1', 'hex'), /only hexadecimal digits/);
assert.throws(() => L.parseMask('0x1ffffffffffffffff', 'hex'), /wider than 64 bits/);
assert.throws(() => L.parseMask('1e', 'decimal'), /only the digits 0 to 9/);
assert.throws(() => L.parseMask('18446744073709551616', 'decimal'), /wider than 64 bits/);
assert.equal(L.parseMask('0x000000000000000000a80425fb', 'hex'), 0xa80425fbn, 'leading zeros are ignored');
assert.equal(L.parseMask('A8 04_25 FB', 'hex'), 0xa80425fbn, 'spaces and underscores are ignored');
assert.equal(L.parseMask('2818844155', 'decimal'), 0xa80425fbn);

// Replay every catalog case through the same entry point the page uses.
const fields = {
  hex: (result) => result.hex,
  decimal: (result) => result.decimal,
  procHex: (result) => result.procHex,
  symbolic: (result) => result.symbolic,
  count: (result) => result.count,
  highest: (result) => result.highest,
  unknownBits: (result) => result.unknownBits.join(',')
};
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => L.decode(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = L.decode(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    const pick = fields[key];
    assert.ok(pick, 'unknown expected field ' + key);
    assert.equal(pick(result), value, testCase.name + ' ' + key);
  }
}

// Page hygiene: no remote assets, no storage, no network and no raw HTML sinks.
assert.ok(!/<script[^>]+src=["']https?:/i.test(html), 'no remote scripts');
assert.ok(!/https?:\/\//.test(html.slice(html.indexOf('</head>'), html.indexOf('<script src="/assets/app.js">'))), 'no remote assets in the tool body');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'no raw HTML sinks');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/.test(html), 'no network calls');
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'no storage');
assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(html), 'no dynamic code');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('id="site-header"') && html.includes('/assets/style.css'), 'shared header and styles');
assert.ok(/<meta name="viewport"/.test(html), 'viewport meta');

console.log('linux-capability-decoder: all checks passed (' + record.testCases.length + ' catalog cases)');
