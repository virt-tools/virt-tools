/* Regression checks for the /proc/net socket table decoder core.
 *
 * The field reading is checked against the kernel rather than against the page's
 * own arithmetic: the row the kernel documentation annotates is pinned verbatim,
 * the state numbers are pinned against include/net/tcp_states.h, and a seeded
 * sweep rebuilds each address from a byte array this file already knows, so a
 * decoder that disagrees with the kernel cannot pass by agreeing with itself.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'proc-net-socket-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* procnet-core:start */');
const end = html.indexOf('/* procnet-core:end */');
assert.ok(start > -1 && end > start, 'socket core markers missing');
const core = html.slice(start, end + '/* procnet-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ProcNetCore;', sandbox);
const C = sandbox.module.exports;

const one = (rows, table) => C.parseOne(rows, table || 'tcp');

// ---- Builders written here, from the kernel's format string.
// %08X of a stored __be32: on the host that printed it the bytes are reversed.
const hexWord = (bytes) => bytes.slice().reverse().map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
const token4 = (octets, port) => `${hexWord(octets)}:${port.toString(16).padStart(4, '0').toUpperCase()}`;
const token6 = (bytes, port) => {
  const words = [];
  for (let index = 0; index < 16; index += 4) words.push(hexWord(bytes.slice(index, index + 4)));
  return `${words.join('')}:${port.toString(16).padStart(4, '0').toUpperCase()}`;
};
const octetsOf = (text) => text.split('.').map(Number);

// RFC 5952 text, written here so the page's formatter is not grading itself.
const canonical6 = (bytes) => {
  const mapped = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) return `::ffff:${bytes.slice(12).join('.')}`;
  const groups = [];
  for (let index = 0; index < 16; index += 2) groups.push(bytes[index] * 256 + bytes[index + 1]);
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

// ---- 1. The row the kernel documentation annotates, field for field.
// 46: 010310AC:9C4C 030310AC:1770 01 ... is 172.16.3.1:40012 -> 172.16.3.3:6000.
const documented = one('46: 010310AC:9C4C 030310AC:1770 01 00000150:00000000 01:00000019 00000000 1000 0 54165785 4 0 25 4 27 3 -1');
assert.equal(documented.local, '172.16.3.1:40012', 'documented local endpoint');
assert.equal(documented.address, '172.16.3.1', 'documented local address');
assert.equal(documented.port, 40012, 'documented local port');
assert.equal(documented.remote, '172.16.3.3:6000', 'documented remote endpoint');
assert.equal(documented.stateCode, '01', 'documented state code');
assert.equal(documented.stateName, 'ESTABLISHED', 'documented state name');
assert.equal(documented.tx, 0x150, 'transmit queue in bytes');
assert.equal(documented.rx, 0, 'receive queue in bytes');
assert.equal(documented.jiffies, 0x19, 'jiffies until the timer fires');
assert.equal(documented.timer, 'retransmit timer pending', 'timer state 1 is the retransmit timer');
assert.equal(documented.retransmits, 0, 'retransmit count');
assert.equal(documented.uid, 1000, 'uid');
assert.equal(documented.inode, 54165785, 'inode');
assert.equal(documented.extra, 7, 'the seven debug fields after the inode are counted');
// The same octets written the other way round would read 1.3.16.172, so the
// reversal is what makes the documented row land on a 172.16/12 address.
assert.equal(octetsOf(documented.address).join('.'), '172.16.3.1');
assert.equal(hexWord(octetsOf('172.16.3.1')), '010310AC', 'the builder agrees with the kernel example');

// ---- 2. State numbers pinned against include/net/tcp_states.h.
const STATES = {
  '01': 'ESTABLISHED', '02': 'SYN_SENT', '03': 'SYN_RECV', '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2', '06': 'TIME_WAIT', '07': 'CLOSE', '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK', '0A': 'LISTEN', '0B': 'CLOSING', '0C': 'NEW_SYN_RECV',
  '0D': 'BOUND_INACTIVE',
};
assert.equal(C.TCP_STATES.length, 13, 'thirteen enum values');
for (const [code, name] of Object.entries(STATES)) {
  const row = one(`00000000:0016 00000000:0000 ${code}`);
  assert.equal(row.stateCode, code, `state ${code} code`);
  assert.equal(row.stateName, name, `state ${code} name`);
}
// TCP_BOUND_INACTIVE is an inet_diag pseudo-state, and TCP_LISTEN is 10.
assert.ok(one('00000000:0016 00000000:0000 0D').stateMeaning.includes('inet_diag'), 'bound-inactive is called a pseudo-state');
assert.equal(Object.keys(STATES).indexOf('0A') + 1, 10, 'LISTEN is 10');
// UDP keeps the same enum but only two values occur.
assert.equal(C.stateRows('udp').length, 2, 'udp table lists two codes');
assert.deepEqual(Array.from(C.stateRows('udp'), (entry) => entry.code), ['01', '07'], 'udp codes');
assert.equal(C.stateFor('07', 'udp').name, 'CLOSE', 'udp 07 is CLOSE');
assert.ok(C.stateFor('07', 'udp').meaning.includes('unconnected'), 'udp 07 is unconnected');
assert.equal(C.stateFor('01', 'udp').name, 'ESTABLISHED', 'udp 01 is ESTABLISHED');
assert.ok(C.stateFor('01', 'udp').meaning.includes('connected'), 'udp 01 is connected');
assert.ok(C.stateFor('0A', 'udp').meaning.includes('not expected'), 'a listener code is flagged in a udp table');
assert.equal(C.stateFor('7F', 'tcp').name, 'UNKNOWN', 'an out-of-enum code is reported as unknown');

// ---- 3. Seeded sweep: rebuild each endpoint from a known address and decode it.
let seed = 20261117;
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let index = 0; index < 120; index += 1) {
  const octets = Array.from({ length: 4 }, () => Math.floor(random() * 256));
  const port = Math.floor(random() * 65536);
  const token = token4(octets, port);
  const row = one(`${token} 00000000:0000 0A`, 'tcp');
  assert.equal(row.address, octets.join('.'), `ipv4 ${token}`);
  assert.equal(row.port, port, `ipv4 port ${token}`);
  assert.equal(row.local, `${octets.join('.')}:${port}`, `ipv4 text ${token}`);
  assert.equal(row.hex, token.split(':')[0], `ipv4 hex echo ${token}`);
}
for (let index = 0; index < 120; index += 1) {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  const port = Math.floor(random() * 65536);
  const token = token6(bytes, port);
  const row = one(`${token} ${token6(new Array(16).fill(0), 0)} 01`, 'tcp');
  assert.equal(row.address, canonical6(bytes), `ipv6 ${token}`);
  assert.equal(row.local, `[${canonical6(bytes)}]:${port}`, `ipv6 text ${token}`);
  assert.equal(row.family, 6, `ipv6 family ${token}`);
}

// Known addresses, including the ones a dual-stack host prints.
const known = [
  ['0100007F:1F90', '127.0.0.1:8080'],
  ['3500007F:0035', '127.0.0.53:53'],
  ['00000000:0016', '0.0.0.0:22'],
  ['0100007F:FFFF', '127.0.0.1:65535'],
  ['00000000000000000000000001000000:0050', '[::1]:80'],
  ['00000000000000000000000000000000:1F90', '[::]:8080'],
  ['0000000000000000FFFF00000100007F:01BB', '[::ffff:127.0.0.1]:443'],
  [token6([0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 22), '[fe80::1]:22'],
];
for (const [token, expected] of known) {
  assert.equal(C.decodeEndpoint(token).text, expected, `endpoint ${token}`);
}
assert.equal(C.canonical6([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), '::', 'all zero groups collapse to ::');
assert.equal(C.canonical6([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]), '2001:db8::1', 'one zero run');

// ---- 4. Row shapes: short form, lone endpoint, header skipping, multi-row order.
const short = one('0100007F:1F90 00000000:0000 0A');
assert.equal(short.local, '127.0.0.1:8080');
assert.equal(short.remote, '0.0.0.0:0');
assert.equal(short.uid, null, 'short form has no uid');
assert.equal(short.inode, null, 'short form has no inode');
assert.equal(short.tx, null, 'short form has no queues');
assert.equal(short.extra, 0, 'short form has no tail');

const lone = one('00000000:0016');
assert.equal(lone.local, '0.0.0.0:22');
assert.equal(lone.remote, null, 'a lone endpoint has no peer');
assert.equal(lone.stateName, null, 'a lone endpoint has no state');

const header = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
const table = C.parse(`${header}\n   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 11 1\n\n   1: 3500007F:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000 990 0 3292 1\n`, 'tcp');
assert.equal(table.skipped, 1, 'one header line skipped');
assert.equal(table.rows.length, 2, 'two data rows');
assert.equal(table.rows[0].local.text, '127.0.0.1:8080', 'row order kept');
assert.equal(table.rows[1].local.text, '127.0.0.53:53', 'second row');
assert.equal(C.summary(table.rows), '2 LISTEN', 'summary counts states');
const mixed = C.parse('0100007F:1F90 00000000:0000 0A\n00000000:0016 00000000:0000 0A\n0100007F:1F91 00000000:0000 01', 'tcp');
assert.equal(C.summary(mixed.rows), '2 LISTEN \u00b7 1 ESTABLISHED', 'summary sorts by count');
// A tcp6 row and an IPv4 row cannot share a line.
assert.throws(() => C.parseOne('0100007F:1F90 00000000000000000000000000000000:0000 01', 'tcp'), /different address families/);

// ---- 5. Refusals name the column and the value.
const refuses = (rows, table, message) => {
  assert.throws(() => C.parseOne(rows, table), (error) => {
    assert.equal(error.message, message);
    return true;
  }, `expected the refusal "${message}"`);
};
refuses('', 'tcp', 'Paste a row from /proc/net/tcp, tcp6, udp or udp6, or an address:port pair such as 0100007F:1F90.');
refuses('   ', 'tcp', 'Paste a row from /proc/net/tcp, tcp6, udp or udp6, or an address:port pair such as 0100007F:1F90.');
refuses('nope', 'tcp', 'No address:port pair in "nope". The local address is eight hex digits for IPv4 or thirty-two for IPv6, a colon, then the port in hex.');
refuses('0100007F:1F9', 'tcp', 'The port in "0100007F:1F9" must be four hex digits, as the kernel prints it.');
refuses('0100007F:1F90 00000000:0000 0G', 'tcp', 'The state column of "0100007F:1F90 00000000:0000 0G" should be one or two hex digits, but reads "0G".');
refuses('0100007F:1F90 00000000:0000 0A 0000', 'tcp', 'The tx_queue:rx_queue column of "0100007F:1F90 00000000:0000 0A 0000" should be two 8-digit hex values, but reads "0000".');
refuses('0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 abc 0 1', 'tcp',
  'The uid column of "0100007F:1F90 00000000:0000 0A 00000000:0..." should be a decimal user id, but reads "abc".');
refuses('0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 nope', 'tcp',
  'The inode column of "0100007F:1F90 00000000:0000 0A 00000000:0..." should be a decimal inode number, but reads "nope".');
refuses('0100007F:1F90 00000000:0000 0A 00000000:00000000 zz:00000000', 'tcp',
  'The tr:tm->when column of "0100007F:1F90 00000000:0000 0A 00000000:0..." should be a timer state, a colon, then 8 hex jiffies, but reads "zz:00000000".');
refuses('0100007F:0000\n0100007F:0000', 'tcp', 'Paste one row to decode a single socket; 2 rows were given.');

// ---- 6. Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2381, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2121, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Linux Socket Table Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length === 5, 'five sources');
assert.ok(record.sources.some((entry) => entry.url.includes('proc_net_tcp')), 'kernel proc_net_tcp doc cited');
assert.ok(record.sources.some((entry) => entry.url.includes('proc_pid_net')), 'proc_pid_net(5) cited');
assert.ok(record.sources.some((entry) => entry.url.includes('tcp_states.h')), 'tcp_states.h cited');
assert.ok(record.sources.some((entry) => entry.url.includes('tcp_ipv4.c')), 'the seq_printf source cited');
assert.ok(record.sources.some((entry) => entry.url.includes('rfc9293')), 'RFC 9293 cited');
assert.ok(record.sources.every((entry) => /^https:\/\//.test(entry.url)), 'every source is https');
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
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 50, 'System count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, `name collides with ${other.slug}`);
  assert.ok(!(other.aliases || []).map((alias) => alias.toLowerCase()).includes(record.name.toLowerCase()),
    `the new name collides with an alias on ${other.slug}`);
}
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expectedError) {
    assert.throws(() => C.parseOne(testCase.input.rows, testCase.input.table), (error) => {
      assert.equal(error.message, testCase.expectedError, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.parseOne(testCase.input.rows, testCase.input.table);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.equal(typeof result[field], typeof value, `${label}: ${field} type`);
    assert.equal(result[field], value, `${label}: ${field}`);
  }
}

// ---- 7. Page contract: local-only, keyboard-submittable, one form.
assert.ok(html.includes('id="sock-form"'), 'form present');
assert.ok(html.includes('id="rows"') && html.includes('id="table"'), 'input and table select present');
assert.ok(/<textarea\b[^>]*id="rows"/.test(html), 'rows is a textarea');
assert.ok(html.includes('id="states-body"'), 'state reference table present');
assert.ok(html.includes('aria-labelledby="states-title"'), 'table named by its heading');
assert.ok(!html.includes('fetch(') && !html.includes('XMLHttpRequest'), 'no network calls');
assert.ok(!/\bWebSocket\b/.test(html), 'no sockets');
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')), 'no external URLs in the page');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1, 'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
assert.ok(/<button\b[^>]*type="submit"/.test(html), 'submit button present');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
for (const id of ['rows', 'table']) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(html), `label for ${id}`);
}
assert.ok(html.includes('aria-live="polite"'), 'results are announced');
assert.ok(html.includes('<meta name="description"'), 'meta description present');
assert.ok(html.includes('@media (max-width:560px)'), 'mobile layout present');

console.log('proc net socket decoder: all assertions passed');
