/* Regression checks for the systemd tmpfiles.d entry builder: every catalog
   case, an independently written directive oracle, hand-checked anchors and
   refusals outside the catalog. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/systemd-tmpfiles-builder/index.html'), 'utf8');
const start = html.indexOf('/* tf-core:start */');
const end = html.indexOf('/* tf-core:end */');
assert.ok(start > -1 && end > start, 'tmpfiles core markers missing');
const core = html.slice(start, end + '/* tf-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TmpfilesCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'systemd-tmpfiles-builder');
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'System', 'catalog category');
assert.equal(entry.subcategory, 'Generation', 'catalog subcategory');
assert.equal(entry.risk, 'low', 'catalog risk');
assert.equal(entry.maturity, 'draft', 'catalog maturity');
assert.ok(entry.testCases.length >= 40, `expected at least 40 cases, found ${entry.testCases.length}`);

// A separate table of what each type creates, cleans and accepts.
const FLAGS = {
  d: { mode: true, owner: true, age: true, argument: false, create: true, clean: true },
  e: { mode: true, owner: true, age: true, argument: false, create: true, clean: true },
  f: { mode: true, owner: true, age: false, argument: false, create: true, clean: false },
  q: { mode: true, owner: true, age: true, argument: false, create: true, clean: true },
  r: { mode: false, owner: false, age: true, argument: false, create: false, clean: true },
  x: { mode: false, owner: false, age: true, argument: false, create: false, clean: true },
  L: { mode: false, owner: true, age: false, argument: true, create: true, clean: false },
};
const SPAN = { us: 1e-6, ms: 1e-3, s: 1, min: 60, m: 60, h: 3600, d: 86400, w: 604800, M: 2629800, y: 31557600 };

function cleanName(raw) {
  // Walk the last path segment character by character, keeping a safe subset.
  const segment = String(raw).split('/').filter((piece) => piece.length > 0).pop() || '';
  let kept = '';
  for (const character of segment) {
    if (/[A-Za-z0-9._-]/.test(character)) {
      kept += character;
    } else if (kept.length && !kept.endsWith('-')) {
      kept += '-';
    }
  }
  kept = kept.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '').slice(0, 40).toLowerCase();
  return (kept || 'tmpfiles') + '.conf';
}

function spanOf(token) {
  if (token === '0') return 0;
  if (/^\d+$/.test(token)) return Number(token);
  let seconds = 0;
  for (const part of token.match(/\d+(us|ms|min|m|s|h|d|w|M|y)/g) || []) {
    const number = Number(part.replace(/[a-zA-Z]+$/, ''));
    const unit = part.slice(String(number).length);
    seconds += number * SPAN[unit];
  }
  return seconds;
}

function oracle(input) {
  const kind = input.type;
  const flags = FLAGS[kind];
  const pathText = String(input.path).trim();
  const rawMode = String(input.mode === undefined ? '' : input.mode).trim();
  const mode = flags.mode && rawMode && rawMode !== '-' ? rawMode.padStart(4, '0') : '-';
  const id = (value) => {
    const raw = String(value === undefined ? '' : value).trim();
    if (!flags.owner || !raw || raw === '-') return '-';
    return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
  };
  const rawAge = String(input.age === undefined ? '' : input.age).trim();
  const age = flags.age && rawAge && rawAge !== '-' ? rawAge : '-';
  const argument = flags.argument ? String(input.argument).trim() : null;
  const fields = [kind, pathText, mode, id(input.user), id(input.group), age];
  if (argument !== null) fields.push(argument);

  const warnings = [];
  if (kind === 'd' && mode === '-') warnings.push('Without MODE a created directory defaults to 0755.');
  if (kind === 'f' && mode === '-') warnings.push('Without MODE a created file defaults to 0644.');
  if (flags.owner && id(input.user) === '-' && id(input.group) === '-') warnings.push('Without USER and GROUP the entry runs as root.');
  if ((kind === 'r' || kind === 'x') && age === '-') warnings.push('Without AGE this applies at every --clean pass, not only to files older than a span.');
  const volatile = ['/tmp', '/var/tmp', '/run'].some((base) => pathText === base || pathText.startsWith(base + '/'));
  if ((kind === 'd' || kind === 'e' || kind === 'q') && age !== '-' && !volatile) warnings.push('AGE only deletes files older than the span; this path is outside /tmp, /var/tmp and /run.');
  if (kind === 'L' && argument.charAt(0) !== '/') warnings.push('A relative link target is resolved from the directory that holds the link.');

  const filename = cleanName(pathText);
  const commands = [];
  if (flags.create) commands.push('sudo systemd-tmpfiles --create /etc/tmpfiles.d/' + filename);
  if (flags.clean) commands.push('sudo systemd-tmpfiles --clean /etc/tmpfiles.d/' + filename);
  return {
    directive: fields.join(' '),
    filename,
    fieldCount: fields.length,
    ageSeconds: age === '-' ? null : spanOf(age),
    warnings,
    commands,
  };
}

const KEYS = ['type', 'path', 'mode', 'user', 'group', 'age', 'argument', 'directive', 'filename', 'filePath', 'fieldCount', 'charCount', 'ageSeconds', 'ageText', 'warnings', 'commands'];
let goldenCount = 0;
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.build(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`,
    );
    continue;
  }
  goldenCount += 1;
  const result = plain(C.build(Object.assign({}, testCase.input)));
  for (const key of KEYS) {
    assert.deepEqual(result[key], testCase.expected[key], `${label}: ${key}`);
  }
  const independent = oracle(testCase.input);
  assert.equal(result.directive, independent.directive, `${label}: oracle directive`);
  assert.equal(result.filename, independent.filename, `${label}: oracle filename`);
  assert.equal(result.fieldCount, independent.fieldCount, `${label}: oracle field count`);
  assert.equal(result.ageSeconds, independent.ageSeconds, `${label}: oracle age seconds`);
  assert.deepEqual(result.warnings, independent.warnings, `${label}: oracle warnings`);
  assert.deepEqual(result.commands, independent.commands, `${label}: oracle commands`);
}
assert.ok(goldenCount >= 20, `expected at least 20 golden cases, found ${goldenCount}`);

// Hand-checked anchors.
const base = C.build({ type: 'd', path: '/var/tmp/myapp', mode: '0700', user: 'myapp', group: 'myapp', age: '30d', argument: '' });
assert.equal(base.directive, 'd /var/tmp/myapp 0700 myapp myapp 30d');
assert.equal(base.filePath, '/etc/tmpfiles.d/myapp.conf');
assert.equal(base.charCount, base.directive.length);
assert.equal(base.ageSeconds, 2592000);
assert.equal(base.ageText, '30 days');
assert.deepEqual(plain(base.commands), [
  'sudo systemd-tmpfiles --create /etc/tmpfiles.d/myapp.conf',
  'sudo systemd-tmpfiles --clean /etc/tmpfiles.d/myapp.conf',
]);

const link = C.build({ type: 'L', path: '/run/current', user: 'app', group: 'app', argument: '/opt/app/42' });
assert.equal(link.directive, 'L /run/current - app app - /opt/app/42');
assert.equal(link.fieldCount, 7);
assert.equal(link.mode, null);
assert.deepEqual(plain(link.commands), ['sudo systemd-tmpfiles --create /etc/tmpfiles.d/current.conf']);

const removal = C.build({ type: 'r', path: '/var/tmp/myapp/*.tmp', age: '7d' });
assert.equal(removal.filename, 'tmp.conf');
assert.equal(removal.fieldCount, 6);
assert.equal(removal.user, null);
assert.deepEqual(plain(removal.commands), ['sudo systemd-tmpfiles --clean /etc/tmpfiles.d/tmp.conf']);

const file = C.build({ type: 'f', path: '/etc/issue' });
assert.deepEqual(plain(file.warnings), [
  'Without MODE a created file defaults to 0644.',
  'Without USER and GROUP the entry runs as root.',
]);
assert.deepEqual(plain(file.commands), ['sudo systemd-tmpfiles --create /etc/tmpfiles.d/issue.conf']);

const sticky = C.build({ type: 'd', path: '/tmp/.X11-unix', mode: '1777', user: '0', group: '0', age: '10d' });
assert.equal(sticky.mode, '1777');
assert.equal(sticky.user, '0');
assert.equal(sticky.ageText, '10 days');
assert.deepEqual(plain(sticky.warnings), []);

const ids = C.build({ type: 'd', path: '/srv/app', mode: '0750', user: '01000', group: '00020' });
assert.equal(ids.user, '1000');
assert.equal(ids.group, '20');
assert.equal(ids.directive, 'd /srv/app 0750 1000 20 -');

const trimmed = C.build({ type: 'd', path: '/var/tmp/_cache.v2', mode: '0750', user: 'app', group: 'app' });
assert.equal(trimmed.filename, 'cache.v2.conf');

const month = C.build({ type: 'e', path: '/var/log/journal', mode: '0755', user: 'root', group: 'systemd-journal', age: '1M' });
assert.equal(month.ageSeconds, 2629800);
assert.equal(month.ageText, '30.44 days');
assert.equal(month.warnings.length, 1);

const year = C.build({ type: 'r', path: '/var/tmp/old', age: '1y' });
assert.equal(year.ageSeconds, 31557600);
assert.equal(year.ageText, '365.25 days');

const milliseconds = C.build({ type: 'r', path: '/var/tmp/old', age: '500ms' });
assert.equal(milliseconds.ageSeconds, 0.5);
assert.equal(milliseconds.ageText, '500 milliseconds');

const microseconds = C.build({ type: 'r', path: '/var/tmp/old', age: '2us' });
assert.equal(microseconds.ageSeconds, 0.000002);
assert.equal(microseconds.ageText, '2 microseconds');

const zero = C.build({ type: 'r', path: '/tmp/stale', age: '0' });
assert.equal(zero.ageText, 'at every run');
assert.deepEqual(plain(zero.warnings), []);

// Refusals outside the catalog keep the same wording.
const refusals = [
  [{ type: 'd', path: '/var/tmp/app', mode: '1778' }, 'MODE is three or four octal digits from 0000 to 1777; only the sticky bit (1000) may be set.'],
  [{ type: 'x', path: '/var/tmp/*.iso', age: '30 days' }, 'AGE is a systemd time span such as 30d, 12h or 1h30min.'],
  [{ type: 'L', path: '/run/current', argument: '/opt/app dir' }, 'A link target cannot contain spaces, quotes or backslashes.'],
  [{ type: 'x', path: '/var/tmp/*.iso', group: 'users', age: '' }, 'A x entry does not take GROUP.'],
];
for (const [input, message] of refusals) {
  assert.throws(() => C.build(input), (error) => {
    assert.equal(error.message, message, `refusal for ${input.type}`);
    return true;
  });
}

console.log(`systemd tmpfiles.d builder: ${entry.testCases.length} catalog cases (${goldenCount} golden), oracle, anchors and extra refusals pass`);
