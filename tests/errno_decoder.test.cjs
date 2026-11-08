/* Regression checks for the Linux errno decoder core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'linux-errno-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* linux-errno-core:start */');
const end = html.indexOf('/* linux-errno-core:end */');
assert.ok(start > -1 && end > start, 'errno core markers missing');
const core = html.slice(start, end + '/* linux-errno-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ErrnoCore;', sandbox);
const C = sandbox.module.exports;

// Values cross the vm realm, so copy them into plain host objects first.
const plain = (value) => JSON.parse(JSON.stringify(value));
const lookup = (code) => plain(C.lookup(code));
const entries = plain(C.list());

// Independent reference: kernel asm-generic numbers, glibc message text.
const reference = {
  1: ['EPERM', 'Operation not permitted'],
  2: ['ENOENT', 'No such file or directory'],
  5: ['EIO', 'Input/output error'],
  9: ['EBADF', 'Bad file descriptor'],
  11: ['EAGAIN', 'Resource temporarily unavailable'],
  13: ['EACCES', 'Permission denied'],
  22: ['EINVAL', 'Invalid argument'],
  24: ['EMFILE', 'Too many open files'],
  28: ['ENOSPC', 'No space left on device'],
  32: ['EPIPE', 'Broken pipe'],
  35: ['EDEADLK', 'Resource deadlock avoided'],
  95: ['EOPNOTSUPP', 'Operation not supported'],
  110: ['ETIMEDOUT', 'Connection timed out'],
  111: ['ECONNREFUSED', 'Connection refused'],
  122: ['EDQUOT', 'Disk quota exceeded'],
  133: ['EHWPOISON', 'Memory page has hardware error']
};
for (const [number, [name, message]] of Object.entries(reference)) {
  const entry = entries.find((item) => item.number === Number(number));
  assert.ok(entry, `errno ${number} is missing`);
  assert.equal(entry.name, name, `errno ${number} symbol`);
  assert.equal(entry.message, message, `errno ${number} message`);
}

// The table is the full assigned range with the two documented gaps.
assert.equal(entries.length, 131, 'assigned value count');
assert.deepEqual(plain(C.UNUSED), [41, 58], 'unassigned numbers');
assert.equal(C.MIN, 1);
assert.equal(C.MAX, 133);
assert.deepEqual(
  entries.map((entry) => entry.number),
  Array.from({ length: 133 }, (_, index) => index + 1).filter((number) => number !== 41 && number !== 58),
  'numbers are 1 to 133 without 41 and 58, in order'
);
assert.equal(new Set(entries.map((entry) => entry.name)).size, 131, 'symbols are unique');
for (const entry of entries) {
  assert.ok(entry.message.length > 2, `${entry.name} has a message`);
  assert.ok(!/^Unknown error/.test(entry.message), `${entry.name} has a real message`);
  assert.ok(entry.group.length > 2, `${entry.name} has a category`);
  assert.equal(typeof entry.hint, 'string', `${entry.name} hint type`);
}
const groups = new Set(entries.map((entry) => entry.group));
assert.equal(groups.size, 11, 'eleven categories');
assert.equal(entries.filter((entry) => entry.hint).length, 24, '24 documented causes');

// Aliases resolve to their canonical entry and are named back.
assert.deepEqual(Object.keys(plain(C.ALIASES)).sort(), ['EDEADLOCK', 'ENOTSUP', 'EWOULDBLOCK']);
assert.equal(lookup('EWOULDBLOCK').number, 11);
assert.equal(lookup('EWOULDBLOCK').name, 'EAGAIN');
assert.equal(lookup('EWOULDBLOCK').viaAlias, 'EWOULDBLOCK');
assert.equal(lookup('EDEADLOCK').number, 35);
assert.equal(lookup('EDEADLOCK').name, 'EDEADLK');
assert.equal(lookup('ENOTSUP').number, 95);
assert.equal(lookup('ENOTSUP').name, 'EOPNOTSUPP');
assert.deepEqual(lookup('EAGAIN').aliases, ['EWOULDBLOCK']);

// Input forms.
assert.equal(lookup('13').name, 'EACCES');
assert.equal(lookup(' -13 ').number, 13, 'a negated syscall return is accepted');
assert.equal(lookup('013').number, 13, 'leading zeros are ignored');
assert.equal(lookup('errno 13').number, 13);
assert.equal(lookup('errno: 13').number, 13);
assert.equal(lookup('errno#13').number, 13);
assert.equal(lookup('eacces').number, 13, 'symbols are case insensitive');
assert.equal(lookup('EACCES').viaAlias, '', 'a canonical symbol is not reported as an alias');
assert.equal(lookup('ACCES').number, 13, 'an omitted E prefix is accepted');
assert.equal(lookup('0').success, true, 'zero is success');
assert.equal(lookup('0').number, 0);
assert.equal(lookup('-0').success, true, 'a negated zero is still success');

// Errors name the problem.
for (const code of ['41', '58']) {
  assert.throws(() => C.lookup(code), /is unassigned on Linux/);
}
for (const code of ['134', '-134', '999999999999999999999']) {
  assert.throws(() => C.lookup(code), /Linux errno values run from 1 to 133/);
}
for (const code of ['', '   ']) {
  assert.throws(() => C.lookup(code), /Enter an errno number such as 13/);
}
assert.throws(() => C.lookup('errno'), /Enter an errno number after the word errno/);
for (const code of ['EFOO', '0x0d', '13 EACCES', 'permission', 'acc\u00e9s']) {
  assert.throws(() => C.lookup(code), /is not a Linux errno number or symbol/);
}

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="errno-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<label class="f" for="code">/.test(html), 'the input is labelled');
assert.ok(/<label class="f" for="filter">/.test(html), 'the filter is labelled');
assert.equal((html.match(/class="chip"/g) || []).length, 8, 'eight common-value shortcuts');
assert.ok(html.includes('[133, "EHWPOISON"'), 'the table ends with EHWPOISON');
assert.ok(/\.ref\[hidden\]\{display:none\}/.test(html), 'the filter can hide reference rows');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Linux Errno Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 11, 'eleven validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.lookup(input.code),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = lookup(input.code);
  for (const [key, value] of Object.entries(expected)) {
    if (Array.isArray(value)) {
      assert.deepEqual(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('linux-errno-decoder: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + entries.length + ' table entries)');
