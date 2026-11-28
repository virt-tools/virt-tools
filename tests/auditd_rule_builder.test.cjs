/* auditd rule builder: replays every catalog case, checks the composed lines against the
   auditctl(8)/audit.rules(7) grammar independently, and pins the refusals, determinism and
   the offline page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'auditd-rule-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* auditd-core:start */';
const endMarker = '/* auditd-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|navigator\.|fetch\(|localStorage|XMLHttpRequest/.test(core),
  'the core stays free of DOM, storage and network access');

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AuditRuleCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(catalog.tools.length, 2519, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2258, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 58, 'System count');
assert.equal(entry.category, 'System', 'category');
assert.equal(entry.risk, 'moderate', 'risk');
assert.equal(entry.maturity, 'draft', 'maturity');
assert.equal(entry.listed, true, 'listed');
assert.equal(entry.testCases.length, 42, `expected 42 cases, found ${entry.testCases.length}`);
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'validation'), 'refusals are pinned');
assert.ok(entry.testCases.some((testCase) => testCase.kind === 'golden'), 'goldens are pinned');
assert.ok(entry.sources.some((source) => /auditctl\.8\.html$/.test(source.url || '')), 'auditctl(8) cited');
assert.ok(entry.sources.some((source) => /audit\.rules\.7\.html$/.test(source.url || '')), 'audit.rules(7) cited');

// ---- Catalog cases: every golden and every refusal, replayed through the page core.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.run(testCase.input), (error) => error.message === testCase.expected.error, label);
    continue;
  }
  const result = C.run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'lines') {
      assert.equal(JSON.stringify(result.lines), JSON.stringify(value), `${label}: lines`);
    } else if (typeof value === 'number') {
      assert.equal(result[key], value, `${label}: ${key}`);
    } else {
      assert.equal(result[key], value, `${label}: ${key}`);
    }
  }
  assert.equal(result.warnings.length, testCase.expected.warningCount, `${label}: warnings`);
}

// ---- Grammar of the produced lines, from auditctl(8) and audit.rules(7).
const watch = (over) => C.run(Object.assign({
  mode: 'watch', target: 'file', path: '/etc/passwd', perms: ['w', 'a'], arch: 'b64', key: 'identity'
}, over));
const sysc = (over) => C.run(Object.assign({
  mode: 'syscall', arch: 'b64', syscalls: 'openat,open', field: 'auid', op: '>=', value: '1000',
  excludeUnset: true, key: 'files'
}, over));

const samples = [watch({}), watch({ target: 'dir', arch: 'both', perms: ['a'] }), sysc({}), sysc({ arch: 'none', syscalls: 'all' })];
for (const result of samples) {
  for (const line of result.lines) {
    assert.match(line, /^-a always,exit /, 'every rule is appended to the exit list with the always action');
    assert.ok(!/ {2,}/.test(line), `single spaces only: ${line}`);
    assert.equal(line, line.trim(), 'no surrounding space');
    assert.ok(line.split(' ').length >= 4, 'a rule carries at least action, list, syscall or path, and key');
    if (line.includes(' -S ')) {
      const archAt = line.indexOf(' -F arch=');
      assert.ok(archAt === -1 || archAt < line.indexOf(' -S '), 'arch must precede -S');
    }
    const keyMatch = line.match(/-k ([^ ]+)$/);
    if (keyMatch) {
      assert.ok(keyMatch[1].length <= 31, 'keys are at most 31 bytes');
      assert.ok(!/\s/.test(keyMatch[1]), 'keys never contain whitespace');
    }
  }
}

// ---- Published example forms from audit.rules(7).
assert.equal(watch({ path: '/etc/shadow', key: '' }).rule,
  '-a always,exit -F arch=b64 -F path=/etc/shadow -F perm=wa', 'file watch form from the manual');
assert.equal(watch({ target: 'dir', path: '/etc/', perms: ['w', 'a'], key: '' }).rule,
  '-a always,exit -F arch=b64 -F dir=/etc/ -F perm=wa', 'directory watch form from the manual');
assert.equal(sysc({ syscalls: 'open,openat,openat2', field: 'exit', op: '=', value: '-EACCES', key: 'access' }).rule,
  '-a always,exit -F arch=b64 -S open,openat,openat2 -F exit=-EACCES -k access', 'failed-access syscall form');
assert.equal(sysc({ field: 'auid', op: '=', value: 'unset', excludeUnset: true }).rule,
  '-a always,exit -F arch=b64 -S openat,open -F auid=unset -k files', 'unset is not excluded from itself');
assert.equal(watch({ arch: 'both', key: '' }).lines.length, 2, 'both writes one rule per ABI');
assert.notEqual(watch({ arch: 'both' }).lines[0], watch({ arch: 'both' }).lines[1], 'the two ABIs differ');
assert.equal(watch({ arch: 'both' }).lines[0].replace('arch=b64', 'arch=NN'),
  watch({ arch: 'both' }).lines[1].replace('arch=b32', 'arch=NN'), 'the two lines differ only in the arch value');

// ---- Field count, access order and key handling.
assert.equal(watch({}).fieldCount, 3, 'arch, path and perm are three -F fields');
assert.equal(sysc({}).fieldCount, 3, 'arch, auid and auid!=unset are three -F fields');
assert.equal(watch({ perms: ['x', 'r', 'w', 'a', 'r'] }).perms, 'rwxa', 'access types are ordered rwxa and deduplicated');
assert.equal(watch({ perms: 'wa' }).perms, 'wa', 'a plain string of access letters is accepted');
assert.equal(sysc({ excludeUnset: false }).lines[0].split('-F auid!=unset').length - 1, 0, 'the unset clause is optional');
assert.equal(sysc({ excludeUnset: true }).lines[0].split('-F auid!=unset').length - 1, 1, 'the unset clause appears once');
assert.equal(sysc({ field: 'uid', op: '=', value: '0', excludeUnset: true }).lines[0].includes('auid!=unset'), false,
  'the unset clause belongs to auid comparisons only');
assert.equal(sysc({ value: '-1', op: '=' }).value, 'unset', '-1 prints as unset');
assert.equal(sysc({ value: '4294967295', op: '=' }).value, '4294967295', 'the unsigned maximum is accepted');

// ---- Determinism: the same input returns the same object, and the input is untouched.
const frozenInput = Object.freeze({ mode: 'syscall', arch: 'b64', syscalls: 'openat', field: 'auid', op: '>=', value: '1000', excludeUnset: true, key: 'files' });
const first = C.run(frozenInput);
const second = C.run(frozenInput);
assert.deepEqual(first, second, 'repeated calls agree');
assert.equal(frozenInput.value, '1000', 'the input object is not modified');

// ---- Page contract: one form, labelled fields, no outbound requests, no inline handlers.
assert.ok(/<form id="auditd-form"/.test(html), 'form present');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
for (const id of ['in-mode', 'in-arch', 'in-target', 'in-path', 'in-syscalls', 'in-field', 'in-op', 'in-value', 'in-key']) {
  assert.ok(new RegExp(`<label class="f" for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
for (const id of ['perm-r', 'perm-w', 'perm-x', 'perm-a', 'in-unset']) {
  assert.ok(new RegExp(`id="${id}"`).test(html), `checkbox ${id}`);
}
assert.ok(html.includes('/assets/theme-init.js') && html.includes('/assets/app.js'), 'shared assets');
assert.ok(!/https?:\/\//.test(html), 'the page itself makes no external reference');
assert.ok(!/\son(click|change|input|submit|load|error|focus|blur|keydown|keyup|mouseover)\s*=/.test(html), 'no inline event handlers');
assert.ok(!/\beval\s*\(|new Function\s*\(/.test(html), 'no dynamic code evaluation');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(/<button class="primary" type="submit">/.test(html), 'a submit button');
assert.ok(/id="reset"/.test(html), 'a reset button');
assert.ok(/id="copy"/.test(html), 'a copy button');

console.log('auditd rule builder suite ok');
