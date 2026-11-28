/* Regression checks for the Core Dump Pattern Builder core and every case in its catalog record.
 *
 * The expected expansion is rebuilt here by a second, differently shaped expander: it finds
 * each % sequence with a regular expression and maps it through a switch, counts bytes with
 * Buffer.byteLength, and decides the legacy .PID suffix from the raw pattern text rather than
 * from a flag carried through the walk. Every recorded catalog case is replayed, so a drift
 * between the record, the page and core(5) fails the suite.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'core-dump-pattern-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* core-pattern-core:start */');
const end = html.indexOf('/* core-pattern-core:end */');
assert.ok(start > -1 && end > start, 'core-pattern core markers missing');
const core = html.slice(start, end + '/* core-pattern-core:end */'.length);

const sandbox = { module: {}, Buffer };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CorePatternCore;', sandbox);
const C = sandbox.module.exports;

const run = (overrides) => C.build(Object.assign({}, C.DEFAULTS, overrides));
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- Independent model ---------------------------------------------------
const byteLen = (text) => Buffer.byteLength(String(text), 'utf8');

const cut = (text, limit) => {
  let out = '';
  for (const ch of String(text)) {
    if (byteLen(out + ch) > limit) break;
    out += ch;
  }
  return out;
};

const lastSegment = (path) => {
  const parts = String(path).split('/').filter((part) => part !== '');
  return parts.length ? parts[parts.length - 1] : '';
};

const expand = (state) => {
  const s = Object.assign({
    pidInit: '', tid: '', tidInit: '', usesPid: false, host: '',
  }, state);
  if (!s.pidInit) s.pidInit = s.pid;
  if (!s.tid) s.tid = s.pid;
  if (!s.tidInit) s.tidInit = s.pidInit;
  const pipe = s.pattern.startsWith('|');
  const body = pipe ? s.pattern.slice(1) : s.pattern;
  const values = {
    '%': () => '%',
    c: () => String(BigInt(s.coreLimit)),
    C: () => s.cpu,
    d: () => s.mode,
    e: () => cut(s.comm, 15),
    E: () => s.exe.split('/').join('!'),
    f: () => lastSegment(s.exe),
    F: () => s.pidfd,
    g: () => s.gid,
    h: () => s.host,
    i: () => s.tid,
    I: () => s.tidInit,
    p: () => s.pid,
    P: () => s.pidInit,
    s: () => s.signal,
    t: () => s.epoch,
    u: () => s.uid,
  };
  let out = '';
  let sawPid = false;
  const known = Object.keys(values).filter((key) => key !== '%');
  const token = /%([\s\S]?)|\/+/g;
  let index = 0;
  while (index < body.length) {
    const at = body.indexOf('%', index);
    if (at < 0) {
      out += body.slice(index);
      break;
    }
    out += body.slice(index, at);
    const next = body.charAt(at + 1);
    if (next === '') {
      index = at + 1;
      continue;
    }
    if (next === '%') {
      out += '%';
    } else if (known.includes(next)) {
      if (next === 'p') sawPid = true;
      out += values[next]();
    }
    index = at + 2;
  }
  if (!token) throw new Error('unreachable');
  let legacy = null;
  if (!pipe && s.usesPid && !sawPid) {
    legacy = '.' + s.pid;
    out += legacy;
  }
  return { value: out, bytes: byteLen(out), pipe, legacy, kind: out === '' ? 'none' : (pipe ? 'pipe' : 'file') };
};

// ---- Core matrix --------------------------------------------------------
const base = Object.assign({}, C.DEFAULTS);
const patterns = [
  '/var/crash/core.%e.%p',
  'core',
  'core.%e.%p.%t',
  '/var/crash/%E.%P',
  'core.%f.%s.%C.%F',
  'core.%h-%u-%g-%d-%c',
  'core.%%p',
  'core.%x%p',
  'core.%',
  '',
  '|/usr/lib/systemd/systemd-coredump %P %u %g %s %t %c %h',
  '|/usr/bin/handler %e %p',
  '|handler %p',
  'notes/core.%e',
];
const contexts = [
  {},
  { pid: '1' },
  { pid: '2147483647', pidInit: '7', tid: '9', tidInit: '11' },
  { comm: 'worker-thread-pool-7' },
  { comm: 'sp ace' },
  { comm: 'café-ünïcode' },
  { exe: '/opt/my app/bin/server' },
  { exe: '/usr/local/bin/app/' },
  { exe: '' },
  { usesPid: true },
  { usesPid: true, pid: '9001' },
  { coreLimit: '0' },
  { mode: '2', host: 'db-7' },
  { epoch: '0' },
  { epoch: '253402300799', uid: '0', gid: '0' },
];
let compared = 0;
for (const pattern of patterns) {
  for (const context of contexts) {
    const state = Object.assign({}, base, { pattern }, context);
    const actual = C.build(state);
    const expected = expand(state);
    assert.equal(actual.value, expected.value, `value for ${pattern} ${JSON.stringify(context)}`);
    assert.equal(actual.byteLength, expected.bytes, `bytes for ${pattern}`);
    assert.equal(actual.kind, expected.kind, `kind for ${pattern}`);
    assert.equal(actual.rows.some((row) => row.spec === '.PID'), Boolean(expected.legacy), 'legacy row');
    const specs = actual.rows.map((row) => row.spec).filter((spec) => spec !== '.PID');
    assert.equal(specs.length, (pattern.replace(/^\|/, '').match(/%[\s\S]?/g) || []).length, `spec rows for ${pattern}`);
    compared += 1;
  }
}
assert.ok(compared >= 200, 'matrix covered');

// ---- Exact behaviours ---------------------------------------------------
assert.equal(run({}).value, '/var/crash/core.nginx.4711');
assert.equal(run({}).byteLength, 26);
assert.equal(run({ pattern: 'core.%%p' }).value, 'core.%p');
assert.equal(run({ pattern: 'core.%x%p' }).value, 'core.4711');
assert.equal(run({ pattern: 'core.%' }).value, 'core.');
assert.equal(run({ pattern: 'core' }).value, 'core');
assert.equal(run({ pattern: 'core', usesPid: true }).value, 'core.4711');
assert.equal(run({ pattern: '/crash/core', usesPid: true }).value, '/crash/core.4711');
assert.deepEqual(plain(run({ pattern: '' })), plain(run({ pattern: '' })), 'empty pattern is deterministic');
assert.equal(run({ pattern: '' }).value, '');
assert.equal(run({ pattern: '' }).kind, 'none');
assert.equal(run({ pattern: 'core.%e', comm: 'abcdefghijklmnopqrstuvwxyz' }).value, 'core.abcdefghijklmno');
assert.equal(run({ pattern: 'core.%e', comm: 'café-ünïcode-app' }).value, 'core.café-ünïcode');
assert.equal(C.utf8Bytes('café-ünïcode'), 15);
assert.equal(C.utf8Bytes('café-ünïcode-'), 16);
assert.equal(run({ pattern: 'core.%E', exe: '/a/b/c' }).value, 'core.!a!b!c');
assert.equal(run({ pattern: 'core.%f', exe: '/a/b/c' }).value, 'core.c');
assert.equal(run({ pattern: 'core.%f', exe: '/a/b/' }).value, 'core.b');
assert.equal(run({ pattern: 'core.%P', pidInit: '' }).value, 'core.4711');
assert.equal(run({ pattern: 'core.%P', pidInit: '42' }).value, 'core.42');
assert.equal(run({ pattern: 'core.%I' }).value, 'core.4711');
assert.equal(run({ pattern: 'core.%i', tid: '77' }).value, 'core.77');
assert.equal(run({ pattern: 'core.%c', coreLimit: '18446744073709551615' }).value, 'core.18446744073709551615');
assert.equal(run({ pattern: 'core.%c', coreLimit: '0000' }).value, 'core.0');
assert.equal(run({ pattern: 'core.%t', epoch: '0' }).value, 'core.0');
assert.equal(run({ pattern: '|/h %p', pidInit: '8' }).kind, 'pipe');
assert.deepEqual(plain(run({ pattern: '|/h %p' }).argv), ['/h', '4711']);
assert.deepEqual(plain(run({ pattern: '|/h  %p ' }).argv), ['/h', '4711']);
assert.deepEqual(plain(run({ pattern: '' }).argv), []);
assert.equal(run({ pattern: '/var/crash/' + 'a'.repeat(120) + '.%p' }).overLimit, true);
assert.equal(run({ pattern: '/var/crash/' + 'a'.repeat(120) + '.%p' }).byteLength, 136);
assert.equal(run({ pattern: 'core.%e', comm: 'x'.repeat(40) }).byteLength, 20);
assert.equal(run({ pattern: 'core' }).kind, 'file');
assert.equal(run({ pattern: 'core.%t', epoch: '1794751200' }).timeIso, '2026-11-15T14:00:00.000Z');
assert.equal(run({ pattern: 'core' }).timeIso, '');

// ---- Warnings -----------------------------------------------------------
const warningText = (state) => run(state).warnings.join(' | ');
assert.match(warningText({ pattern: 'core.%x%p' }), /%x, which core_pattern does not define/);
assert.match(warningText({ pattern: 'core.%z%Q%p' }), /%z, %Q/);
assert.match(warningText({ pattern: 'core.%' }), /ends with a single %/);
assert.match(warningText({ pattern: '', }), /empty core_pattern/);
assert.match(warningText({ pattern: 'core' }), /relative name is resolved/);
assert.match(warningText({ pattern: ' |/h %p' }), /space before \| makes the kernel treat/);
assert.match(warningText({ pattern: '|%p' }), /must be an absolute pathname/);
assert.match(warningText({ pattern: '|' }), /is not followed by a program/);
assert.match(warningText({ pattern: 'core.%e', coreLimit: '0' }), /core size limit is 0/);
assert.match(warningText({ pattern: 'core.%p', usesPid: true }), /core_uses_pid only applies/);
assert.match(warningText({ pattern: '|/h %e', comm: 'a b' }), /comm value contains a space/);
assert.match(warningText({ pattern: '/var/crash/' + 'a'.repeat(120) + '.%p' }), /136 bytes/);
assert.equal(run({ pattern: '/var/crash/core.%e.%p' }).warnings.length, 0);
assert.equal(run({ pattern: '|/h %p', coreLimit: '0' }).warnings.length, 0, 'pipes ignore the limit');

// ---- Refusals -----------------------------------------------------------
const refuses = (overrides, message) => assert.throws(() => C.build(Object.assign({}, base, overrides)), (error) => error.message === message);
refuses({ pid: '0' }, 'The PID must be a whole number from 1 to 2147483647.');
refuses({ pid: 'abc' }, 'The PID must be a whole number from 1 to 2147483647.');
refuses({ pid: '2147483648' }, 'The PID must be a whole number from 1 to 2147483647.');
refuses({ uid: '4294967295' }, 'The UID must be a whole number from 0 to 4294967294.');
refuses({ gid: 'x' }, 'The GID must be a whole number from 0 to 4294967294.');
refuses({ signal: '65' }, 'The signal number must be a whole number from 1 to 64.');
refuses({ signal: '0' }, 'The signal number must be a whole number from 1 to 64.');
refuses({ cpu: '8192' }, 'The CPU number must be a whole number from 0 to 8191.');
refuses({ pidfd: '0' }, 'The pidfd number must be a whole number from 1 to 2147483647.');
refuses({ mode: '3' }, 'The dump mode must be 0, 1 or 2.');
refuses({ epoch: '253402300800' }, 'The dump time must be a whole number from 0 to 253402300799.');
refuses({ coreLimit: '18446744073709551616' }, 'The core size limit must be digits only, up to 18446744073709551615.');
refuses({ coreLimit: '-1' }, 'The core size limit must be digits only, up to 18446744073709551615.');
refuses({ pattern: 'x'.repeat(513) }, 'The pattern is limited to 512 characters on this page.');

// ---- Page contract ------------------------------------------------------
assert.match(html, /<h1>Core Dump Pattern Builder<\/h1>/);
assert.match(html, /id="site-header"/);
assert.match(html, /src="\/assets\/theme-init\.js"/);
for (const id of ['pattern-form', 'in-pattern', 'in-uses-pid', 'in-pid', 'in-comm', 'in-exe', 'in-signal',
  'in-uid', 'in-gid', 'in-host', 'in-epoch', 'in-pid-init', 'in-tid', 'in-tid-init', 'in-cpu', 'in-pidfd',
  'in-mode', 'in-core-limit', 'out-value', 'rows-body', 'all-body', 'warnings', 'explanation', 'argv', 'copy']) {
  assert.ok(html.includes('id="' + id + '"'), `missing #${id}`);
}
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /id="error" class="status error" role="alert"/);
assert.match(html, /<th scope="col">Specifier<\/th><th scope="col">Expands to<\/th><th scope="col">Kernel<\/th>/);
assert.match(html, /className='spec-name'/, 'each row names its specifier');
assert.match(html, /role="region" aria-label="Each specifier in the pattern/);
assert.doesNotMatch(html, /\son(?:click|input|change|submit)="/i, 'no inline handlers');
assert.doesNotMatch(html, /\beval\(|new Function\(/);
assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/);
assert.doesNotMatch(html, /https?:\/\//);
assert.equal((html.match(/<label for="/g) || []).length >= 15, true, 'labels present');
assert.equal(C.SPECS.length, 17, 'specifier reference');
assert.equal(C.MAX_NAME_BYTES, 128);
assert.equal(C.MAX_COMM_BYTES, 15);
for (const spec of ['%', 'c', 'C', 'd', 'e', 'E', 'f', 'F', 'g', 'h', 'i', 'I', 'p', 'P', 's', 't', 'u']) {
  assert.ok(C.SPECS.some((row) => row[0] === spec), `reference lists ${spec}`);
}

// ---- Catalog record -----------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const record = matches[0];
assert.equal(record.name, 'Core Dump Pattern Builder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 10, 'aliases present');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 3, 'sources present');
assert.equal(record.sources[0].url, 'https://man7.org/linux/man-pages/man5/core.5.html');
assert.match(record.sources[0].title, /core\(5\)/);
assert.equal(record.sources[1].url, 'https://docs.kernel.org/admin-guide/sysctl/kernel.html');
assert.equal(record.sources[2].url, 'https://man7.org/linux/man-pages/man1/coredumpctl.1.html');
assert.ok(typeof record.method === 'string' && record.method.length > 800, 'method documented');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2267, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 58, 'System count');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.filter((tool) => tool.slug !== slug)
  .flatMap((tool) => (tool.aliases || []).map((alias) => alias.toLowerCase()));
for (const alias of record.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}

// ---- Recorded cases -----------------------------------------------------
assert.equal(record.testCases.length, 8, 'recorded case count');
for (const testCase of record.testCases) {
  const actual = C.build(Object.assign({}, C.DEFAULTS, testCase.input));
  const expected = testCase.expected;
  assert.equal(actual.value, expected.value, `${testCase.name}: value`);
  assert.equal(actual.kind, expected.kind, `${testCase.name}: kind`);
  assert.equal(actual.byteLength, expected.byteLength, `${testCase.name}: bytes`);
  assert.deepEqual(plain(actual.rows.map((row) => row.spec)), expected.specs, `${testCase.name}: specifiers`);
  assert.equal(actual.target, expected.target, `${testCase.name}: target`);
  assert.deepEqual(plain(actual.warnings), expected.warnings, `${testCase.name}: warnings`);
  const independent = expand(Object.assign({}, C.DEFAULTS, testCase.input));
  assert.equal(independent.value, expected.value, `${testCase.name}: independent value`);
  assert.equal(independent.bytes, expected.byteLength, `${testCase.name}: independent bytes`);
}
console.log('core dump pattern builder: checks passed');
