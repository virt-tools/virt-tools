/* systemd mount unit builder: catalog fixtures, unit structure and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'systemd-mount-unit-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* systemd-mount-core:start */';
const endMarker = '/* systemd-mount-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}, TextEncoder};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SystemdMountCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one mount unit builder');
const record = records[0];
assert.equal(record.name, 'systemd Mount Unit Builder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 700, 'method documents syntax, semantics and limitations');
assert.equal(record.sources.length, 3);
for (const source of record.sources) assert.match(source.url, /^https:\/\/www\.freedesktop\.org\/software\/systemd\/man\/latest\/systemd\.(mount|automount|unit)\.html$/);
assert.equal(record.testCases.length, 25);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 7);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 15);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2106, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 50, 'System count');

function failure(input) {
  try { C.build(input); } catch (error) { return error.message; }
  return null;
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  for (const key of ['mountFilename', 'automountFilename', 'where', 'unitBase', 'installTarget', 'network', 'mountUnit', 'automountUnit', 'installCommand']) {
    if (expected[key] !== undefined) assert.deepEqual(result[key], expected[key], `${testCase.name}: ${key}`);
  }
  if (expected.nameLength !== undefined) assert.equal(result.mountFilename.length, expected.nameLength, testCase.name + ' name length');
  for (const fragment of expected.warningsContain || []) {
    assert.ok(result.warnings.join(' ').includes(fragment), testCase.name + ' warning: ' + fragment);
  }
  for (const fragment of expected.automountUnitContains || []) {
    assert.ok(result.automountUnit.includes(fragment), testCase.name + ' automount: ' + fragment);
  }
}

// Independent unit-file parser: section placement, cardinality and file-name agreement.
function parseUnit(text) {
  const sections = [];
  const directives = {};
  let section = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const sectionMatch = line.match(/^\[([A-Za-z]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      sections.push(section);
      directives[section] ||= [];
      continue;
    }
    assert.ok(section, 'directive outside a section');
    const equals = line.indexOf('=');
    assert.ok(equals > 0, 'malformed directive ' + line);
    directives[section].push([line.slice(0, equals), line.slice(equals + 1)]);
  }
  return {sections, directives};
}

// Escaped names are reversible: '-' is a slash and \xHH is one UTF-8 byte.
function decodeName(base) {
  const bytes = [];
  for (let index = 0; index < base.length; index += 1) {
    const char = base.charAt(index);
    if (char === '-') { bytes.push(0x2f); continue; }
    if (char === '\\') {
      assert.equal(base.charAt(index + 1), 'x', 'escape prefix');
      bytes.push(parseInt(base.slice(index + 2, index + 4), 16));
      index += 3;
      continue;
    }
    bytes.push(...Buffer.from(char, 'utf8'));
  }
  return '/' + new TextDecoder().decode(Uint8Array.from(bytes));
}

const plans = [
  {where: '/mnt/backup'},
  {where: '/srv/files', automount: true, idle: '5min'},
  {where: '/mnt/My Backup', what: '/dev/disk/by-label/work', type: 'exfat'},
  {where: '/mnt/caf\u00e9', type: 'btrfs', what: '/dev/sdc1'},
  {where: '/var/lib/postgresql', what: 'UUID=abc-123', type: 'xfs', options: 'noatime,ro'},
  {where: '/mnt/media/music', what: 'nas.local:/export', type: 'nfs', automount: true, idle: '90s', installTarget: 'local-fs.target'},
  {where: '/run/build', what: 'tmpfs', type: 'tmpfs', options: 'size=2G,mode=1777'},
  {where: '/mnt/a-b/c.d', what: '/dev/sdd1', options: ''},
];
for (const plan of plans) {
  const built = C.build(plan);
  const mount = parseUnit(built.mountUnit);
  assert.equal(mount.sections[0], 'Unit');
  assert.equal(mount.sections[1], 'Mount');
  assert.equal(mount.directives.Mount.filter(([key]) => key === 'What').length, 1, plan.where + ' What once');
  assert.equal(mount.directives.Mount.filter(([key]) => key === 'Where').length, 1, plan.where + ' Where once');
  assert.equal(mount.directives.Unit.filter(([key]) => key === 'Description').length, 1, plan.where + ' Description once');
  assert.equal(decodeName(built.unitBase), built.where, plan.where + ' reversible unit name');
  assert.equal(built.mountFilename, built.unitBase + '.mount');
  assert.ok(!built.mountUnit.includes('After=') && !built.mountUnit.includes('Requires='), plan.where + ' no manual ordering');
  if (!plan.automount) {
    assert.deepEqual(mount.sections, ['Unit', 'Mount', 'Install']);
    assert.deepEqual(mount.directives.Install, [['WantedBy', built.installTarget]]);
  } else {
    assert.deepEqual(mount.sections, ['Unit', 'Mount'], plan.where + ' mounted on demand');
    const automount = parseUnit(built.automountUnit);
    assert.deepEqual(automount.sections, ['Unit', 'Automount', 'Install']);
    assert.deepEqual(automount.directives.Automount.filter(([key]) => key === 'Where'), [['Where', built.where]]);
    assert.equal(built.automountFilename, built.unitBase + '.automount');
    assert.ok(!built.automountUnit.includes('After=') && !built.automountUnit.includes('Requires='), 'automount carries no ordering');
    assert.equal(built.installCommand.endsWith(built.automountFilename), true, 'enables the automount unit');
    const idle = automount.directives.Automount.filter(([key]) => key === 'TimeoutIdleSec');
    assert.equal(idle.length, plan.idle ? 1 : 0, plan.where + ' idle timeout presence');
  }
}

// Directive values carry the normalized path, the source and the option list.
const explicit = C.build({where: '//mnt//data/', what: '/dev/sdc1', type: 'ext4', options: 'rw,nodev', description: 'Data 100%'});
assert.ok(explicit.mountUnit.includes('Where=/mnt/data\n'), 'normalized Where');
assert.ok(explicit.mountUnit.includes('Description=Data 100%%\n'), 'percent doubled in Description');
assert.ok(explicit.mountUnit.includes('Type=ext4\n') && explicit.mountUnit.includes('Options=rw,nodev\n'));
assert.ok(explicit.mountUnit.endsWith('[Install]\nWantedBy=multi-user.target\n'));
const omitted = C.build({type: '', options: ''});
assert.ok(!omitted.mountUnit.includes('Type=') && !omitted.mountUnit.includes('Options='), 'optional directives omitted');

// Boundary walks: the 255-character unit name limit and durations.
const nameOf = (length) => '/' + 'b'.repeat(length - '.mount'.length);
assert.equal(C.build({where: nameOf(255)}).mountFilename.length, 255);
assert.throws(() => C.build({where: nameOf(256)}), /255-character limit/);
for (const value of ['', '0', '30s', '5min', '1h 30min', '1.5 seconds']) assert.equal(C.duration(value), value);
for (const value of ['-1s', '1e3s', 'infinity', '5fortnights', '5', 5, {}]) assert.throws(() => C.duration(value));
assert.equal(C.duration(null), '', 'an unset idle timeout stays empty');
assert.equal(C.build({automount: false, idle: '5min'}).idle, '', 'idle timeout belongs to the automount unit only');
for (const value of ['ro,', ',ro', 'ro,,noatime', 'ro, noatime', 'ro,ro', 'ro%', 'x-systemd.requires=/dev/sdb1']) {
  assert.throws(() => C.optionsValue(value), value + ' must be refused');
}
assert.deepEqual(Array.from(C.optionsValue('ro,nodev,size=2G')), ['ro', 'nodev', 'size=2G']);
for (const value of ['/dev/sdb1', 'UUID=abc', 'LABEL=data', 'PARTUUID=abc-1', 'PARTLABEL=root', 'nas.local:/export', 'tmpfs']) {
  assert.equal(C.whatValue(value), value);
}

// Markup defaults and the replayable core defaults must agree.
function inputValue(id) {
  const at = html.indexOf('<input id="' + id + '"');
  const tag = html.slice(at, html.indexOf('>', at));
  const match = tag.match(/value="([^"]*)"/);
  return match ? match[1] : '';
}
function selectedValue(id) {
  const at = html.indexOf('<select id="' + id + '"');
  const block = html.slice(at, html.indexOf('</select>', at));
  return block.match(/value="([^"]*)" selected/)[1];
}
for (const key of ['where', 'description', 'what']) assert.equal(inputValue('in-' + key), C.DEFAULTS[key], 'default ' + key);
assert.equal(inputValue('in-options'), C.DEFAULTS.options);
assert.equal(selectedValue('in-type'), C.DEFAULTS.type);
assert.equal(selectedValue('in-target'), C.DEFAULTS.installTarget);
assert.equal(C.build({}).mountUnit, C.build({
  where: inputValue('in-where'),
  description: inputValue('in-description'),
  what: inputValue('in-what'),
  type: selectedValue('in-type'),
  options: inputValue('in-options'),
  installTarget: selectedValue('in-target'),
}).mountUnit);

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|change)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html));
assert.ok(html.includes('<form id="mount-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('role="alert"'));
assert.ok(html.includes('role="status" aria-live="polite"'));
assert.ok(html.includes('id="mount-output" readonly'));
assert.ok(html.includes('id="automount-output" readonly'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
for (const match of html.matchAll(/\$\("([a-z0-9-]+)"\)/g)) assert.ok(html.includes('id="' + match[1] + '"'), 'missing id ' + match[1]);
for (const id of ['in-where', 'in-description', 'in-what', 'in-type', 'in-options', 'in-target', 'in-idle']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
}
console.log('systemd-mount-unit-builder: 25 catalog cases, 8 reversible unit layouts, name/duration boundaries and page contract passed');
