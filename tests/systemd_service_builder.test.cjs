/* Regression checks for the systemd service unit builder core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/systemd-service-builder/index.html'), 'utf8');
const startMarker = '/* systemd-service-core:start */';
const endMarker = '/* systemd-service-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'systemd service core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SystemdServiceCore;', sandbox);
const C = sandbox.module.exports;

const baseInput = {
  name: 'example-worker',
  description: 'Example background worker',
  type: 'simple',
  restart: 'on-failure',
  arguments: '/usr/bin/node\n/srv/example/worker.js\n--quiet',
  workingDirectory: '/srv/example',
  user: 'www-data',
  after: 'network-online.target',
  wants: 'network-online.target',
  restartSec: '5s',
  wantedBy: 'multi-user.target'
};
const input = (overrides = {}) => ({...baseInput, ...overrides});
const defaultUnit = `[Unit]
Description=Example background worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart="/usr/bin/node" "/srv/example/worker.js" "--quiet"
WorkingDirectory=/srv/example
User=www-data
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
`;

const standard = C.build(input());
assert.equal(standard.filename, 'example-worker.service');
assert.equal(standard.unit, defaultUnit);
assert.equal(standard.execStart, 'ExecStart="/usr/bin/node" "/srv/example/worker.js" "--quiet"');
assert.equal(C.quoteExec('/bin/echo'), '"/bin/echo"');
assert.equal(C.quoteExec('a b'), '"a b"');
assert.equal(C.quoteExec('a"b\\c'), '"a\\"b\\\\c"');
assert.equal(C.quoteExec('$HOME 100%'), '"$$HOME 100%%"');

for (const type of ['simple', 'exec', 'forking', 'notify', 'oneshot']) {
  const result = C.build(input({type, restart: type === 'oneshot' ? 'no' : 'on-failure'}));
  assert.ok(result.unit.includes(`Type=${type}\n`), type);
  if (type === 'oneshot') {
    assert.ok(!result.unit.includes('Restart='));
    assert.ok(!result.unit.includes('RestartSec='));
  }
}
for (const restart of ['no', 'on-failure', 'on-success', 'on-abnormal', 'always']) {
  const result = C.build(input({restart}));
  if (restart === 'no') assert.ok(!result.unit.includes('Restart='));
  else assert.ok(result.unit.includes(`Restart=${restart}\nRestartSec=5s\n`));
}
for (const value of ['0', '500ms', '5s', '2min', '1h 30min', '1.5 seconds']) assert.equal(C.duration(value), value);
for (const value of ['', ' ', '-1s', '1e3s', 'infinity', '5fortnights', '5', null, {}]) assert.throws(() => C.duration(value));

const optional = C.build(input({workingDirectory: '', user: '', after: '', wants: '', restart: 'no', wantedBy: ''}));
assert.ok(!optional.unit.includes('WorkingDirectory='));
assert.ok(!optional.unit.includes('User='));
assert.ok(!optional.unit.includes('After='));
assert.ok(!optional.unit.includes('Wants='));
assert.ok(!optional.unit.includes('[Install]'));

// Replay every canonical catalog case against independently recorded output.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'systemd-service-builder');
assert.equal(records.length, 1, 'catalog must contain exactly one systemd service builder');
const record = records[0];
assert.equal(record.name, 'systemd Service Builder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('systemd Service Unit Generator'));
assert.ok(record.testCases.length >= 16, 'catalog carries golden, escaping and validation checks');
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => C.build(input(testCase.input)), new RegExp(escape(testCase.expected.error)), testCase.name);
    continue;
  }
  assert.equal(testCase.kind, 'golden', testCase.name);
  const result = C.build(input(testCase.input));
  if (testCase.expected.unit !== undefined) assert.equal(result.unit, testCase.expected.unit, testCase.name);
  for (const text of testCase.expected.contains || []) assert.ok(result.unit.includes(text), `${testCase.name}: missing ${JSON.stringify(text)}`);
  for (const text of testCase.expected.excludes || []) assert.ok(!result.unit.includes(text), `${testCase.name}: unexpected ${JSON.stringify(text)}`);
  for (const key of ['filename', 'type', 'restart', 'execStart', 'wantedBy']) {
    if (testCase.expected[key] !== undefined) assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
}
assert.equal(C.build(input()).unit, defaultUnit, 'default fixture remains stable after catalog replay');

console.log(`systemd-service-builder: all checks passed (${record.testCases.length} catalog cases, 5 service types, 5 restart policies and 6 valid durations)`);
