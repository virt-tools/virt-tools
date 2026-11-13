/* open(2) flags decoder: replay the catalog fixtures, pin the Linux flag table,
   and check that composing and decoding are inverses on every flag subset. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'file-open-flags-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* open-flags-core:start */');
const end = html.indexOf('/* open-flags-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = OpenFlagsCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2256, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'File Open Flags Decoder');
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the table and limits');
assert.ok(entry.sources.length >= 3);
for (const source of entry.sources) assert.match(source.url, /^https:\/\//);
assert.equal(entry.testCases.length, 26, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 9);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 11);

/* The Linux x86-64 constants from asm-generic/fcntl.h, written out literally so
   a drift in the page table cannot pass unnoticed. */
const LINUX = {
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_NONBLOCK: 2048,
  O_DSYNC: 4096,
  O_ASYNC: 8192,
  O_DIRECT: 16384,
  O_DIRECTORY: 65536,
  O_NOFOLLOW: 131072,
  O_NOATIME: 262144,
  O_CLOEXEC: 524288,
  O_SYNC: 1052672,
  O_TMPFILE: 4259840,
  O_PATH: 2097152,
};
const FLAG_NAMES = Object.keys(LINUX).filter((n) => !['O_RDONLY', 'O_WRONLY', 'O_RDWR', 'O_PATH'].includes(n));
assert.equal(FLAG_NAMES.length, 15);
for (const flag of C.FLAGS) {
  assert.equal(flag.value, LINUX[flag.name], flag.name + ' value');
  assert.equal(flag.octal, flag.value === 0 ? '0' : '0o' + flag.value.toString(8), flag.name + ' octal label');
  assert.ok(flag.note.length > 10, flag.name + ' note');
}
for (const access of C.ACCESS) assert.equal(access.value, LINUX[access.name], access.name + ' value');
assert.equal(C.FLAGS.length, 15);
assert.equal(C.ACCESS.length, 4);

// Composites are the documented supersets of their parts.
const byName = Object.fromEntries(C.FLAGS.map((f) => [f.name, f.value]));
assert.equal(byName.O_SYNC, byName.O_DSYNC | 1048576);
assert.equal(byName.O_TMPFILE, byName.O_DIRECTORY | 4194304);

function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}

for (const testCase of entry.testCases) {
  const { input } = testCase;
  const isDecode = typeof input.value === 'string';
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    const message = attempt(() => (isDecode ? C.decode(input.value) : C.encode(input)));
    assert.equal(message, testCase.expectedError, testCase.name);
    continue;
  }
  const result = isDecode ? C.decode(input.value) : C.encode(input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
  assert.equal(result.octal, result.value === 0 ? '0' : '0' + result.value.toString(8), testCase.name + ' octal');
  assert.equal(result.hex, '0x' + result.value.toString(16).toUpperCase(), testCase.name + ' hex');
  assert.equal(result.modeRequired, result.symbolic.includes('O_CREAT') || result.symbolic.includes('O_TMPFILE'),
    testCase.name + ' mode argument');
  // The printed symbolic list must OR back to the printed value, unless the
  // value also carries bits that no flag defines.
  if (!result.unknown) {
    let rebuilt = result.access === 'O_PATH' ? LINUX.O_PATH : LINUX[result.symbolic.split('|')[0]];
    for (const flagName of result.symbolic.split('|').slice(1)) rebuilt |= LINUX[flagName];
    assert.equal(rebuilt, result.value, testCase.name + ' symbolic bits');
  }
}

// Every subset of the 15 flags, for each access mode: the value is the OR of
// the named bits, and decoding that value returns the same access and flags.
let checked = 0;
for (const access of ['O_RDONLY', 'O_WRONLY', 'O_RDWR', 'O_PATH']) {
  for (let mask = 0; mask < (1 << FLAG_NAMES.length); mask += 1) {
    const flags = FLAG_NAMES.filter((_, index) => mask & (1 << index));
    const result = C.encode({ access, flags });
    const honoured = access === 'O_PATH'
      ? flags.filter((name) => ['O_CLOEXEC', 'O_DIRECTORY', 'O_NOFOLLOW'].includes(name))
      : flags;
    let expected = LINUX[access];
    for (const name of honoured) expected |= LINUX[name];
    assert.equal(result.value, expected, access + ' ' + honoured.join('|'));
    assert.equal(result.octal, expected === 0 ? '0' : '0' + expected.toString(8));
    // O_PATH cannot carry anything it does not honour, and never loses a bit silently.
    if (access === 'O_PATH') assert.equal(result.value & ~(LINUX.O_PATH | 524288 | 65536 | 131072), 0);
    const decoded = C.decode(result.octal);
    assert.equal(decoded.value, result.value, access + ' decode value');
    assert.equal(decoded.access, access, access + ' decode access');
    assert.equal(decoded.flags.join('|'), result.flags.join('|'), access + ' decode flags');
    assert.equal(decoded.symbolic, result.symbolic, access + ' decode symbolic');
    checked += 1;
  }
}

// Decoding accepts hex and the optional prefixes, and every composed value
// survives a round trip text -> flags -> text.
const anchors = {
  0: 'O_RDONLY',
  0o1: 'O_WRONLY',
  0o2: 'O_RDWR',
  0o1101: 'O_WRONLY|O_CREAT|O_TRUNC',
  0o2001101: 'O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC',
  0o20200000: 'O_RDONLY|O_TMPFILE',
  0o4010000: 'O_RDONLY|O_SYNC',
  0o10000000: 'O_PATH',
};
for (const [value, symbolic] of Object.entries(anchors)) {
  assert.equal(C.decode('0x' + Number(value).toString(16)).symbolic, symbolic, value + ' hex');
  assert.equal(C.decode('0o' + Number(value).toString(8)).symbolic, symbolic, value + ' 0o');
  assert.equal(C.decode(String(Number(value).toString(8))).symbolic, symbolic, value + ' bare octal');
}
assert.equal(C.decode('0x241').value, 577);
assert.equal(C.decode('01101').value, 577);
assert.equal(C.decode(' 0x 241 ').value, 577);
assert.equal(C.octalOf(577), '01101');
assert.equal(C.hexOf(577), '0x241');
assert.equal(C.octalOf(0), '0');
assert.equal(C.parseValue('0X10'), 16);
assert.equal(C.parseValue('0o777'), 511);
assert.equal(C.parseValue('777'), 511);
assert.equal(C.parseValue('1'), 1);

// Decoding edge behaviour: both access bits, unknown bits, 32-bit ceiling.
assert.equal(attempt(() => C.decode('0x3')),
  'The two low bits are both set (0o3), which is not a valid access mode; use O_RDONLY, O_WRONLY or O_RDWR.');
assert.equal(attempt(() => C.decode('0o777')),
  'The two low bits are both set (0o3), which is not a valid access mode; use O_RDONLY, O_WRONLY or O_RDWR.');
const max = C.decode('0xFFFFFFFF');
assert.equal(max.value, 4294967295);
assert.equal(max.access, 'O_PATH');
assert.ok(max.unknown > 0, 'unknown bits must be reported');
assert.ok(max.warnings.some((w) => w.includes('match no open(2) flag')), 'unknown-bit warning');
assert.equal(attempt(() => C.decode('0x100000000')), 'A flag value must fit in 32 bits: at most 0xFFFFFFFF.');
assert.equal(C.decode('0x10').unknown, 16);
const privateSync = C.decode('0o4000000');
assert.ok(privateSync.warnings.some((w) => w.includes('__O_SYNC')), 'private O_SYNC bit');
const privateTmp = C.decode('0o20000000');
assert.ok(privateTmp.warnings.some((w) => w.includes('__O_TMPFILE')), 'private O_TMPFILE bit');

// Combination warnings.
const warned = (input) => C.encode(input).warnings.join(' ');
assert.match(warned({ access: 'O_RDONLY', flags: ['O_EXCL'] }), /O_EXCL only takes effect together with O_CREAT/);
assert.match(warned({ access: 'O_RDONLY', flags: ['O_TRUNC'] }), /O_TRUNC with O_RDONLY is undefined/);
assert.match(warned({ access: 'O_RDONLY', flags: ['O_TMPFILE'] }), /O_TMPFILE needs O_WRONLY or O_RDWR/);
assert.match(warned({ access: 'O_RDONLY', flags: ['O_DIRECT'] }), /aligned to the filesystem block size/);
assert.match(warned({ access: 'O_RDONLY', flags: ['O_NOATIME'] }), /CAP_FOWNER/);
assert.match(warned({ access: 'O_RDONLY', flags: ['O_ASYNC'] }), /regular files the kernel ignores it/);
assert.match(warned({ access: 'O_PATH', flags: ['O_CLOEXEC', 'O_TRUNC'] }), /O_PATH ignores O_TRUNC/);
assert.equal(C.encode({ access: 'O_RDONLY', flags: ['O_CREAT'] }).warnings.length, 0);
assert.equal(C.encode({ access: 'O_RDWR', flags: ['O_TMPFILE'] }).warnings.length, 0);
assert.equal(C.encode({ access: 'O_RDWR', flags: 'O_CREAT, O_APPEND' }).value, 1090);

// Defaults shown by the page.
const defaults = C.encode({ access: 'O_WRONLY', flags: ['O_CREAT', 'O_TRUNC'] });
assert.equal(defaults.octal, '01101');
assert.equal(defaults.hex, '0x241');
assert.equal(defaults.example, 'open("file", O_WRONLY|O_CREAT|O_TRUNC, 0644)');
assert.equal(C.encode({ access: 'O_RDONLY', flags: [] }).example, 'open("file", O_RDONLY)');

// Page contract: shared shell, accessible controls, no foreign or unsafe APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|navigator\.sendBeacon/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('for="access"') && html.includes('for="value"'), 'input labels missing');
assert.ok(html.includes('aria-describedby="access-help"') && html.includes('aria-describedby="value-help"'), 'help references missing');
assert.ok(html.includes('<form id="flags-form" novalidate>') && html.includes('<form id="decode-form" novalidate>'), 'forms missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('role="group" aria-label="open flags"'), 'checkbox group label missing');
assert.ok(html.includes('min-height:44px'), 'tap targets');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
assert.ok(html.includes('<option value="O_WRONLY" selected>'), 'default access mode');
const ids = new Set([...html.matchAll(/id="([a-z0-9-]+)"/g)].map((match) => match[1]));
for (const match of html.matchAll(/getElementById\("([a-z0-9-]+)"\)/g)) assert.ok(ids.has(match[1]), 'script references missing id ' + match[1]);

console.log(`file-open-flags-decoder: 26 catalog cases, ${checked} composed subsets, flag table and page contract passed`);
