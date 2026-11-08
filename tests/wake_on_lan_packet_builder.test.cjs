/* Regression checks for the Wake-on-LAN packet builder: the catalogued cases,
   an independent byte-level recomputation over a grid of addresses and
   passwords, the documented layout invariants, and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'wake-on-lan-packet-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* wol-core:start */');
const end = html.indexOf('/* wol-core:end */');
assert.ok(start > -1 && end > start, 'wol core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WolCore;', sandbox);
const C = sandbox.module.exports;

const build = (input) => C.build(input);
const failure = (input) => {
  try {
    build(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent transcription of the documented layout, using raw bytes.
function recompute(macText, passwordText) {
  const clean = (value) => String(value == null ? '' : value).trim().split(/[\s:\-.]/).join('');
  const macHex = clean(macText).toLowerCase();
  const mac = Buffer.from(macHex, 'hex');
  const password = clean(passwordText) ? Buffer.from(clean(passwordText).toLowerCase(), 'hex') : null;
  const packet = Buffer.concat([Buffer.alloc(6, 0xff), Buffer.concat(new Array(16).fill(mac)), password || Buffer.alloc(0)]);
  return {
    mac: Array.from(mac).map((b) => b.toString(16).padStart(2, '0')).join(':'),
    macHex,
    hasPassword: Boolean(password),
    passwordHex: password ? password.toString('hex') : null,
    packetHex: packet.toString('hex'),
    packetBytes: packet.length,
    repeats: 16,
    macBlockBytes: mac.length * 16,
    locallyAdministered: Boolean(mac[0] & 2)
  };
}

// The page's own default: a VirtualBox OUI address and no password.
const base = build({});
assert.equal(base.packetBytes, 102);
assert.equal(base.mac, '08:00:27:1a:2b:3c');
assert.equal(base.hasPassword, false);
assert.equal(base.passwordHex, null);
assert.equal(base.locallyAdministered, false);
assert.equal(base.warnings.length, 0);
assert.equal(base.packetHex.slice(0, 12), 'ffffffffffff');
assert.equal(base.packetHex.slice(12, 24), '0800271a2b3c');
assert.equal(base.packetHex.length, 204);
assert.equal(base.packetHex.slice(-12), '0800271a2b3c');

// With a SecureOn password the packet grows by exactly six bytes.
const secured = build({ mac: '08:00:27:1a:2b:3c', password: '01:02:03:04:05:06' });
assert.equal(secured.packetBytes, 108);
assert.equal(secured.packetHex.length, 216);
assert.equal(secured.packetHex.slice(-12), '010203040506');
assert.equal(secured.passwordHex, '010203040506');
assert.equal(secured.warnings.length, 1);
assert.ok(secured.warnings[0].includes('SecureOn'));

// The catalogued cases are the source of truth for the published numbers.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Generation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '💤');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the packet layout');
assert.ok(entry.testCases.length >= 24, 'expected at least twenty-four catalog cases');
assert.ok(entry.sources.length >= 2, 'expected two sources');
for (const source of entry.sources) assert.ok(/^https:\/\//.test(source.url), 'source URL missing');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = build(testCase.input);
  const independent = recompute(testCase.input.mac || C.DEFAULTS.mac, testCase.input.password || C.DEFAULTS.password);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (field === 'warningCount') {
      assert.equal(result.warnings.length, value, testCase.name + ' warnings');
      continue;
    }
    assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
    assert.equal(JSON.stringify(independent[field]), JSON.stringify(value), testCase.name + ' oracle ' + field);
  }
}

// A deterministic grid over notations, multicast-free addresses and password forms.
let rows = 0;
function checkRow(mac, password) {
  const expected = recompute(mac, password);
  const result = build({ mac, password });
  for (const field of ['mac', 'macHex', 'hasPassword', 'passwordHex', 'packetHex', 'packetBytes',
    'repeats', 'macBlockBytes', 'locallyAdministered']) {
    assert.equal(JSON.stringify(result[field]), JSON.stringify(expected[field]), field + ' ' + mac + '/' + password);
  }
  assert.equal(result.packetBytes, password ? 108 : 102);
  assert.equal(result.packetHex.slice(0, 12), 'ffffffffffff');
  assert.equal(result.packetHex.slice(12, 24), result.macHex);
  assert.equal(result.packetHex.slice(-12), password ? recompute(mac, password).passwordHex : result.macHex);
  assert.ok(/^[0-9a-f]+$/.test(result.packetHex), 'lowercase hex only');
  assert.equal(result.warnings.length, (result.locallyAdministered ? 1 : 0) + (password ? 1 : 0));
  rows += 1;
}

const macAddresses = [
  '52:54:00:12:34:56', '52-54-00-12-34-56', '5254.0012.3456', '525400123456',
  'AA:BB:CC:DD:EE:FF', 'aa-bb-cc-dd-ee-ff', 'aabb.ccdd.eeff', 'AABBCCDDEEFF',
  '00:00:00:00:00:01', '00:11:22:33:44:55', '02:00:00:00:00:01', '0a:1b:2c:3d:4e:5f',
  '7e:ff:ff:ff:ff:ff', 'de:ad:be:ef:00:01', '00:ff:ff:ff:ff:ff', 'fe:ff:ff:ff:ff:fe',
  ' 52:54:00:12:34:56 ', '52 54 00 12 34 56'
];
const passwords = ['', '010203040506', '01:02:03:04:05:06', '0a0b0c0d0e0f', 'ff:ff:ff:ff:ff:ff',
  'de ad be ef 00 01', '00:00:00:00:00:01'];
for (const mac of macAddresses) {
  for (const password of passwords) checkRow(mac, password);
}
assert.ok(rows >= 120, 'grid must cover at least a hundred and twenty rows, got ' + rows);

// Every multicast or reserved address is refused, in every notation.
for (const mac of ['01:00:5e:00:00:01', '33:33:00:00:00:01', 'ff:ff:ff:ff:ff:ff', '00:00:00:00:00:00',
  '01005e000001', '0100.5e00.0001', 'FF-FF-FF-FF-FF-FF']) {
  assert.ok(failure({ mac }), 'must refuse ' + mac);
}
assert.match(failure({ mac: '01:00:5e:00:00:01' }), /multicast/);
assert.match(failure({ mac: '00:00:00:00:00:00' }), /null address/);
assert.match(failure({ mac: 'ff:ff:ff:ff:ff:ff' }), /broadcast address/);

// Refusals name the field and the format.
assert.equal(failure({ mac: '' }), 'Enter the target MAC address.');
assert.equal(failure({ mac: '52:54:00:12:34:5' }),
  'MAC address must contain exactly 12 hex digits; separators such as : - . and spaces are optional.');
assert.equal(failure({ mac: '52:54:00:12:34:5g' }),
  'MAC address must contain exactly 12 hex digits; separators such as : - . and spaces are optional.');
assert.equal(failure({ mac: '0x525400123456' }),
  'MAC address must contain exactly 12 hex digits; separators such as : - . and spaces are optional.');
assert.equal(failure({ mac: '52:54:00:12:34:56', password: '0102030405' }),
  'SecureOn password must contain exactly 12 hex digits (6 bytes).');
assert.equal(failure({ mac: '52:54:00:12:34:56', password: '00:00:00:00:00:00' }),
  'An all-zero SecureOn password means no password; leave the field blank instead.');
assert.equal(failure({ mac: '52:54:00:12:34:56', password: '  ' }), null, 'blank password means none');

// Doubling the password length never changes the 96-byte MAC block, and the
// packet always ends with either the last MAC repeat or the password.
for (const password of ['', '010203040506']) {
  const result = build({ mac: 'aa:bb:cc:dd:ee:ff', password });
  assert.equal(result.packetHex.slice(12, 12 + 192), 'aabbccddeeff'.repeat(16));
  assert.equal(result.macBlockBytes, 96);
  assert.equal(result.packetBytes - result.macBlockBytes, password ? 12 : 6);
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="wol-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['mac', 'password']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + id + '-help"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'secondary buttons must not submit the form');
assert.ok(html.includes('area.readOnly = true'), 'hex output must be read-only');

console.log('Wake-on-LAN packet builder: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows and invariants passed');
