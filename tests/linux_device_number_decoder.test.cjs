/* Linux device number decoder: the dev_t packing, the node derivations, the
   exact rejection messages, the page contract and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'linux-device-number-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* devnum-core:start */';
const endMarker = '/* devnum-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreText), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, parseInt, module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = LinuxDeviceNumberCore;', sandbox);
const C = sandbox.module.exports;

const failure = (input) => {
  try { C.parse(input); } catch (error) { return error.message; }
  return null;
};
// The core lives in its own VM realm, so compare fields rather than objects.
const pairs = (actual, major, minor, label) => {
  assert.equal(actual.major, major, label + ' major');
  assert.equal(actual.minor, minor, label + ' minor');
};

// ---- Limits: a 12-bit major and a 20-bit minor.
assert.equal(C.MAX_MAJOR, 4095);
assert.equal(C.MAX_MINOR, 1048575);
assert.equal(C.MAX_DEVT, 4294967295);

// ---- The glibc packing, written out literally from the documented layout.
assert.equal(C.makedev(8, 1), 2049);
assert.equal(C.makedev(8, 0), 2048);
assert.equal(C.makedev(259, 0), 66304);
assert.equal(C.makedev(8, 255), 2303);
assert.equal(C.makedev(8, 256), 1050624);
assert.equal(C.makedev(8, 300), 1050668);
assert.equal(C.makedev(4095, 1048575), 4294967295);
assert.equal(C.makedev(0, 0), 0);
pairs(C.split(0x0801), 8, 1, 'split 0x0801');
pairs(C.split(0x10300), 259, 0, 'split 0x10300');
pairs(C.split(0x10082c), 8, 300, 'split 0x10082c');
pairs(C.split(0xfff008ff), 8, 1048575, 'split 0xfff008ff');
pairs(C.split(0xffffffff), 4095, 1048575, 'split 0xffffffff');

// Every major against a spread of minors must survive the round trip.
for (let major = 0; major <= 4095; major += 37) {
  for (const minor of [0, 1, 7, 8, 255, 256, 257, 4095, 65535, 1048575]) {
    const devt = C.makedev(major, minor);
    assert.ok(devt >= 0 && devt <= 4294967295, `dev_t range for ${major}:${minor}`);
    pairs(C.split(devt), major, minor, `round trip ${major}:${minor}`);
  }
}

// ---- The four input forms land on the same pair.
const forms = ['8:1', '8, 1', '2049', '0x801', '0x0801', ' 8 : 1 '];
for (const form of forms) {
  const result = C.parse(form);
  pairs(result, 8, 1, form);
  assert.equal(result.devt, 2049, form + ' dev_t');
  assert.equal(result.devtHex, '0x0801', form + ' hex');
  assert.equal(result.kernel, 8388609, form + ' kernel value');
  assert.equal(result.node, '/dev/sda1', form + ' node');
}
assert.equal(C.parse('8:1').inputKind, 'major:minor');
assert.equal(C.parse('8, 1').inputKind, 'ls -l column');
assert.equal(C.parse('2049').inputKind, 'dev_t (decimal)');
assert.equal(C.parse('0x801').inputKind, 'dev_t (hex)');

// ---- The bit fields of the split packing.
const bits = (input) => {
  const b = C.parse(input).bits;
  return [b.minorLow, b.majorField, b.minorHigh].join(',');
};
assert.equal(bits('8:1'), '1,8,0');
assert.equal(bits('8:300'), '44,8,1');
assert.equal(bits('4095:1048575'), '255,4095,4095');
assert.equal(C.parse('8:1').devtHex, '0x0801');
assert.equal(C.parse('259:0').devtHex, '0x10300', 'wide values are not truncated to four digits');

// ---- Registered major names and types.
assert.equal(C.parse('8:1').type, 'block');
assert.equal(C.parse('8:1').majorName, 'SCSI disk devices');
assert.equal(C.parse('5:1').type, 'char');
assert.equal(C.parse('1:3').type, 'both', 'major 1 is registered for both types');
assert.equal(C.parse('1:3').majorName, 'Memory devices / RAM disk');
assert.equal(C.parse('4095:1048575').type, 'unknown');
assert.equal(C.parse('259:0').majorName, 'Block extended major');
assert.ok(C.parse('259:0').note.length > 0, 'the dynamic major is explained');

// ---- Node derivations documented in devices.txt.
const nodes = [
  ['8:0', '/dev/sda'], ['8:1', '/dev/sda1'], ['8:15', '/dev/sda15'], ['8:16', '/dev/sdb'],
  ['8:17', '/dev/sdb1'], ['8:255', '/dev/sdp15'], ['8:256', null], ['8:4095', null],
  ['7:0', '/dev/loop0'], ['9:0', '/dev/md0'], ['11:0', '/dev/sr0'],
  ['4:0', '/dev/tty0'], ['4:63', '/dev/tty63'], ['4:64', '/dev/ttyS0'], ['4:255', '/dev/ttyS191'],
  ['5:0', '/dev/tty'], ['5:1', '/dev/console'], ['5:2', '/dev/ptmx'],
  ['13:0', '/dev/input/js0'], ['13:32', '/dev/input/mouse0'], ['13:63', '/dev/input/mice'],
  ['13:64', '/dev/input/event0'], ['136:7', '/dev/pts/7'], ['137:7', null],
  ['179:0', '/dev/mmcblk0'], ['179:1', '/dev/mmcblk0p1'], ['179:7', '/dev/mmcblk0p7'],
  ['179:8', '/dev/mmcblk1'], ['188:2', '/dev/ttyUSB2'], ['226:0', '/dev/dri/card0'],
  ['226:64', null], ['180:15', '/dev/usb/lp15'], ['180:16', null], ['10:200', null],
];
for (const [pair, node] of nodes) {
  assert.equal(C.parse(pair).node, node, 'node for ' + pair);
}
// The mknod line carries the derived node and the registered type.
assert.equal(C.parse('8:1').mknod, 'mknod /dev/sda1 b 8 1');
assert.equal(C.parse('5:1').mknod, 'mknod /dev/console c 5 1');
assert.equal(C.parse('1:3').mknod, 'mknod NAME b|c 1 3');
assert.equal(C.parse('8:300').mknod, 'mknod NAME b 8 300');
// Dual and unregistered majors explain themselves instead of guessing a node.
assert.equal(C.parse('1:3').node, null);
assert.ok(C.parse('1:3').note.includes('/dev/null'));
assert.ok(C.parse('1:3').note.includes('/dev/ram3'));
assert.ok(C.parse('77:0').note.includes('/proc/devices'));
assert.ok(C.parse('8:300').note.includes('16 disks'));

// ---- Rejections, with their exact messages.
assert.equal(failure(''), 'Enter a device number such as 8:1, a dev_t such as 2049 or 0x0801, or an ls -l column such as 8, 1.');
assert.equal(failure('   '), 'Enter a device number such as 8:1, a dev_t such as 2049 or 0x0801, or an ls -l column such as 8, 1.');
assert.equal(failure('-1'), 'Device numbers are not negative.');
assert.equal(failure('8:'), 'Enter the minor number after the colon, such as 8:1.');
assert.equal(failure(':1'), 'Enter the major number before the colon, such as 8:1.');
assert.equal(failure('8:1:2'), 'A device number has one colon: major:minor, such as 8:1.');
assert.equal(failure('4096:0'), 'Linux allows major numbers 0 to 4095; 4096 is outside that range.');
assert.equal(failure('9999:0'), 'Linux allows major numbers 0 to 4095; 9999 is outside that range.');
assert.equal(failure('8:1048576'), 'Linux allows minor numbers 0 to 1048575; 1048576 is outside that range.');
assert.equal(failure('4294967296'), 'A 32-bit device number is at most 0xffffffff; 4294967296 is larger.');
assert.equal(failure('0x100000000'), 'A 32-bit device number is at most 0xffffffff; 0x100000000 is larger.');
assert.equal(failure('abc'), '"abc" is not a device number. Use major:minor such as 8:1, an ls -l column such as 8, 1, or a dev_t such as 2049.');
assert.equal(failure('8.1'), '"8.1" is not a device number. Use major:minor such as 8:1, an ls -l column such as 8, 1, or a dev_t such as 2049.');
assert.equal(failure('brw-rw---- 8, 1'), '"brw-rw---- 8, 1" is not a device number. Use major:minor such as 8:1, an ls -l column such as 8, 1, or a dev_t such as 2049.');
// The largest legal values are accepted, not clamped.
assert.equal(C.parse('4095:1048575').devt, 4294967295);
assert.equal(C.parse('0:0').devt, 0);

// ---- Page markup: the documented contract.
for (const id of ['dev-form', 'dev', 'err', 'out', 'status', 'reset', 'bits', 'formula', 'maj-body']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
assert.ok(/<label class="f" for="dev">/.test(html), 'the input has a label');
assert.ok(/id="out"[^>]*aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status line is announced');
assert.ok(/<button type="submit" class="primary">/.test(html), 'the decode button submits');
assert.ok(/<button type="button" id="reset"/.test(html), 'reset is a plain button');
assert.equal((html.match(/class="chip"/g) || []).length, 11, 'chip count');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('/assets/theme-init.js'), 'the theme is applied before paint');
assert.ok(html.includes('/assets/style.css'), 'the shared stylesheet is used');
assert.ok(html.includes('/assets/app.js'), 'the shared header is loaded');
assert.ok(html.includes('value="8:1"'), 'the example is filled in');
assert.ok(html.includes('@media (max-width:560px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(html.includes('overflow-x:auto'), 'the major table scrolls on narrow screens');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2262, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Linux Device Number Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.equal(record.icon, '🔢');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('device-number'));
assert.ok(record.tags.includes('makedev'));
assert.ok(record.aliases.includes('Major Minor Decoder'));
assert.ok(record.method.length > 1000, 'the method documents the packing and its limits');
for (const phrase of ['makedev', 'bits 8 to 19', '4095', '1048575', 'devices.txt', 'no network']) {
  assert.ok(record.method.includes(phrase), 'method states ' + phrase);
}
assert.equal(record.sources.length, 4, 'sources are cited');
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
assert.ok(record.sources.some((source) => source.title.includes('devices.txt')));
assert.ok(record.sources.some((source) => source.title.includes('makedev')));
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 43, 'System count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'one name');
assert.equal(catalog.tools.filter((tool) => (tool.tags || []).includes('makedev')).length, 1, 'one makedev tag');

assert.equal(record.testCases.length, 35, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 14);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 9);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 12);
for (const testCase of record.testCases) {
  const input = testCase.input.dev;
  if (testCase.kind === 'validation') {
    assert.equal(failure(input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.parse(input);
  const expected = testCase.expected;
  assert.equal(result.major, expected.major, testCase.name + ' major');
  assert.equal(result.minor, expected.minor, testCase.name + ' minor');
  assert.equal(result.devt, expected.devt, testCase.name + ' dev_t');
  assert.equal(result.devtHex, expected.devtHex, testCase.name + ' hex');
  assert.equal(result.kernel, expected.kernel, testCase.name + ' kernel value');
  assert.equal(result.type, expected.type, testCase.name + ' type');
  assert.equal(result.node, expected.node, testCase.name + ' node');
  assert.equal(result.inputKind, expected.inputKind, testCase.name + ' input kind');
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases, the packing and the page contract pass');
