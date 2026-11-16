/* systemd socket unit builder: catalog fixtures, unit structure, address grammar and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'systemd-socket-unit-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* systemd-socket-core:start */';
const endMarker = '/* systemd-socket-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SystemdSocketCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one socket unit builder');
const record = records[0];
assert.equal(record.name, 'systemd Socket Unit Builder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents syntax, semantics and the excluded address forms');
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//);
  assert.ok(source.title.length > 30, 'source titles name the document and the part used');
}
assert.match(record.sources[0].url, /systemd\.socket\.html$/);
assert.match(record.sources[1].url, /sd_listen_fds\.html$/);
assert.equal(record.testCases.length, 27);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 6);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 4);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 17);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug appears exactly once');

function failure(input) {
  try { C.build(input); } catch (error) { return error.message; }
  return null;
}
function checkContains(text, values, label, unexpected = false) {
  for (const value of values || []) assert.equal(text.includes(value), !unexpected, `${label}: ${unexpected ? 'unexpected' : 'missing'} ${JSON.stringify(value)}`);
}
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  for (const key of ['socketFilename', 'serviceFilename', 'socketUnit', 'listenCount', 'unixCount', 'tcpCount']) {
    if (testCase.expected[key] !== undefined) assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  checkContains(result.socketUnit, testCase.expected.contains, testCase.name + ' unit');
  checkContains(result.socketUnit, testCase.expected.excludes, testCase.name + ' unit', true);
  assert.equal(Array.from(result.addresses).length, result.listenCount, testCase.name + ' address count');
  assert.ok(result.unixCount + result.tcpCount <= result.listenCount, testCase.name + ' listen mix');
  assert.ok(result.contract.length >= 2, testCase.name + ' activation contract');
  assert.ok(result.serviceFilename === result.base + (result.accept ? '@.service' : '.service'), testCase.name + ' service name follows Accept=');
}

// Independent unit-file parser: section placement and cardinality, not a string echo of the formatter.
function parseUnit(text) {
  const sections = [];
  const directives = [];
  let section = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const header = line.match(/^\[([A-Za-z]+)\]$/);
    if (header) { section = header[1]; sections.push(section); continue; }
    assert.ok(section, 'directive outside a section: ' + line);
    const equals = line.indexOf('=');
    assert.ok(equals > 0, 'malformed directive ' + line);
    directives.push({section, key: line.slice(0, equals), value: line.slice(equals + 1)});
  }
  return {sections, directives};
}
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') continue;
  const parsed = parseUnit(C.build(testCase.input).socketUnit);
  for (const section of parsed.sections) assert.ok(['Unit', 'Socket', 'Install'].includes(section), 'unknown section ' + section);
  assert.equal(parsed.sections[0], 'Unit');
  assert.equal(new Set(parsed.sections).size, parsed.sections.length, 'a section is emitted at most once');
  for (const entry of parsed.directives) {
    if (entry.key === 'Description') assert.equal(entry.section, 'Unit');
    else if (entry.key === 'ListenStream' || entry.key === 'Accept' || entry.key === 'MaxConnections' || entry.key === 'SocketMode' || entry.key === 'SocketUser' || entry.key === 'SocketGroup') assert.equal(entry.section, 'Socket', entry.key + ' outside [Socket]');
    else if (entry.key === 'WantedBy') assert.equal(entry.section, 'Install');
    else assert.fail('unexpected directive ' + entry.key);
  }
  const listeners = parsed.directives.filter((entry) => entry.key === 'ListenStream');
  assert.equal(listeners.length, C.build(testCase.input).listenCount);
  const limit = parsed.directives.filter((entry) => entry.key === 'MaxConnections');
  assert.equal(limit.length, C.build(testCase.input).accept && limit.length ? 1 : limit.length, 'MaxConnections only with Accept=yes');
  if (limit.length) assert.ok(parsed.directives.some((entry) => entry.key === 'Accept' && entry.value === 'yes'));
}

// Address grammar corners the catalog cases do not spend a row on.
const unicodeAddress = C.parseAddress('/run/ünïcode.sock');
assert.equal(unicodeAddress.kind, 'unix');
assert.equal(unicodeAddress.raw, '/run/ünïcode.sock');
assert.equal(unicodeAddress.written, '/run/ünïcode.sock');
assert.equal(unicodeAddress.port, null);
assert.equal(C.utf8Length('/run/ünïcode.sock'), 19);
assert.equal(C.utf8Length('/' + 'a'.repeat(106)), 107);
assert.ok(failure({listen: '/' + 'a'.repeat(107)}).includes('at most 107 bytes'));
assert.equal(C.parseAddress('[2001:DB8::1]:443').written, '[2001:db8::1]:443');
assert.equal(C.parseAddress('127.0.0.1:0'.replace(':0', ':65535')).port, 65535);
assert.equal(C.parseAddress('1.2.3.4:80').kind, 'tcp4');
assert.equal(C.parseAddress('80').kind, 'port');
assert.equal(C.parseAddress('@a').kind, 'abstract');
assert.ok(failure({listen: '/run/a.sock\n/run/a.sock\n/run/b.sock'}).includes('unique'));
assert.ok(failure({listen: '/run//a.sock'}).includes('//'));
assert.ok(failure({listen: '/run/a/'}).includes('end with a slash'));
assert.ok(failure({listen: '/run/a\\b.sock'}).includes('backslashes'));
assert.ok(failure({listen: '@'}).includes('at least one character'));
assert.ok(failure({listen: '@a b'}).includes('whitespace'));
assert.ok(failure({listen: '2001:db8::1:443'}).includes('brackets'));
assert.ok(failure({listen: '[::1]:8x'}).includes('between 1 and 65535'));
assert.ok(failure({listen: '[::1:80'}).includes('Bracketed IPv6'));
assert.ok(failure({listen: '1.2.3.4:80:90'}).includes('brackets'));
assert.ok(failure({listen: '[12345::1]:80'}).includes('valid IPv6'));
assert.ok(failure({listen: ':80'}).includes('Use an absolute unix path'));
assert.equal(failure({listen: ' ', name: 'x'}), 'Listen address line 1 is empty.');
assert.ok(failure({socketUser: 'app', listen: '8080', name: 'x'}) === null, 'socket ownership is ignored without a unix socket');
assert.ok(!C.build({socketUser: 'app', listen: '8080'}).socketUnit.includes('SocketUser='));
for (const value of ['0000', '0644', '0777', '0600']) assert.equal(C.mode(value), value);
for (const value of ['', '0', '644', '0999', '7777', '0o644']) assert.throws(() => C.mode(value));
assert.equal(C.portValue('65535'), 65535);
for (const value of ['0', '65536', '-1', '1.5', '01', ' 80']) assert.throws(() => C.portValue(value));
assert.equal(C.socketPathEscapes('/run/a"b 100%'), '/run/a\\x22b\\x20100%%');
assert.ok(C.build({description: '100% ready'}).socketUnit.includes('\nDescription=100%% ready\n'), 'literal percent is doubled in Description');

// Cross-check the address validators against Node's own IP parser (independent implementation).
const ipv6Corpus = ['::1', '::', '2001:db8::1', 'fe80::1', '::ffff:192.168.0.1', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7', '1::2::3', ':::1', '12345::1', 'gggg::1', '1:2:3:4:5:6:1.2.3.4', '1:2:3:4:5:6:7:8:9', '::0.0.0.0', '0:0:0:0:0:0:0:0', '1::2:3:4:5:6:7:8', '::1.2.3.4.5', '1.2.3.4::', '::ffff:1.2.3', ''];
for (const value of ipv6Corpus) assert.equal(C.ipv6(value), net.isIP(value) === 6, 'ipv6 ' + value);
const ipv4Corpus = ['127.0.0.1', '0.0.0.0', '255.255.255.255', '256.0.0.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', '1.2.3.-1', '', 'a.b.c.d'];
for (const value of ipv4Corpus) assert.equal(C.ipv4(value), net.isIP(value) === 4, 'ipv4 ' + value);
// An interface scope is valid for Node but deliberately refused by the page (a literal % needs doubling in unit files).
assert.equal(net.isIP('::1%eth0'), 6);
assert.ok(failure({listen: '[::1%eth0]:80'}).includes('scopes'));

// Markup defaults and the replayable core defaults must agree.
function textareaValue(id) {
  const at = html.indexOf('<textarea id="' + id + '"');
  return html.slice(html.indexOf('>', at) + 1, html.indexOf('</textarea>', at));
}
function inputValue(id) {
  const tag = html.slice(html.indexOf('<input id="' + id + '"'));
  return tag.slice(0, tag.indexOf('>')).match(/value="([^"]*)"/)[1];
}
const defaultResult = C.build({});
assert.equal(defaultResult.socketUnit, C.build({listen: textareaValue('in-listen')}).socketUnit);
assert.equal(defaultResult.base, inputValue('in-name'));
assert.equal(defaultResult.socketUnit.includes('Description=' + inputValue('in-description') + '\n'), true);
assert.equal(C.build({accept: true}).accept, true);
assert.equal(C.build({}).accept, false);

// Page contract: shared shell, keyboard-submittable form, accessible output, no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="socket-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('id="socket-output" readonly'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('id="service-contract"'));
assert.ok(html.includes('id="install-command"'));
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['in-name', 'in-description', 'in-listen', 'in-max-connections', 'in-socket-mode', 'in-socket-user', 'in-socket-group']) assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
assert.equal((html.match(/<h1>/g) || []).length, 1);
console.log('systemd-socket-unit-builder: 27 catalog cases, unit section structure, address grammar against node:net and page contract passed');
