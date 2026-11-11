/* Regression checks for the IPv6 EUI-64 generator core, its catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipv6-eui-64-generator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* eui64-core:start */');
const end = html.indexOf('/* eui64-core:end */');
assert.ok(start > -1 && end > start, 'eui64 core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* eui64-core:end */'.length) + '\nmodule.exports = Eui64Core;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Networking');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.equal(entry.maturity, 'draft');

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Hand-checkable anchors from the modified EUI-64 rule. ---
assert.equal(C.generate('00:AA:00:2F:3C:1D', 'fe80::/64').iid, '02aa:00ff:fe2f:3c1d', 'RFC 4291 MAC example');
assert.equal(C.generate('00:AA:00:2F:3C:1D', 'fe80::/64').linkLocal, 'fe80::2aa:ff:fe2f:3c1d');
assert.equal(C.generate('00:AA:00:2F:3C:1D', '2001:db8::/64').address, '2001:db8::2aa:ff:fe2f:3c1d');
assert.equal(C.generate('00:1a:2b:ff:fe:3c:4d:5e', '2001:db8::/64').iid, '021a:2bff:fe3c:4d5e', 'EUI-64 gets no second ff:fe');
assert.equal(C.generate('02:00:00:00:00:01', '2001:db8::/64').iid, '0000:00ff:fe00:0001');
assert.equal(C.formatAddress([0, 0, 0, 0, 0, 0, 0, 1]), '::1');
assert.equal(C.formatAddress([0, 0, 0, 0, 0, 0, 0, 0]), '::');
assert.equal(C.formatAddress([0x2001, 0xdb8, 0, 1, 0, 0, 0, 1]), '2001:db8:0:1::1');
assert.equal(C.formatAddress([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]), '2001:db8::1');
assert.equal(C.formatAddress([1, 0, 2, 0, 3, 0, 4, 0]), '1:0:2:0:3:0:4:0', 'single zero groups stay');
// Ties keep the first run: two runs of two zeros, the first is compressed.
assert.equal(C.formatAddress([1, 0, 0, 2, 3, 0, 0, 4]), '1::2:3:0:0:4');

// --- Independent reference implementation for a seeded sweep. ---
const refIidBytes = (identifier) => {
  const hex = identifier.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const pairs = hex.match(/../g);
  const first = (parseInt(pairs[0], 16) ^ 0x02).toString(16).padStart(2, '0');
  return pairs.length === 6
    ? [first, pairs[1], pairs[2], 'ff', 'fe', pairs[3], pairs[4], pairs[5]]
    : [first, ...pairs.slice(1)];
};
const refGroups = (bytes) => bytes.map((byte) => parseInt(byte, 16)).reduce((groups, value, index) => {
  if (index % 2 === 0) groups.push(value << 8);
  else groups[groups.length - 1] |= value;
  return groups;
}, []);
const refFormat = (groups) => {
  const tokens = groups.map((group) => group.toString(16).padStart(4, '0'));
  let best = -1;
  let length = 1;
  for (let i = 0; i < 8; i += 1) {
    let run = 0;
    while (i + run < 8 && tokens[i + run] === '0000') run += 1;
    if (run > length) {
      length = run;
      best = i;
    }
  }
  const strip = (token) => token.replace(/^0+(?=.)/, '');
  if (length < 2) return groups.map((group) => group.toString(16)).join(':');
  const head = tokens.slice(0, best).map(strip).join(':');
  const tail = tokens.slice(best + length).map(strip).join(':');
  return `${head}::${tail}`;
};
const refPrefix = (prefix) => {
  const text = prefix.replace(/\/64$/, '');
  const [headText, tailText] = text.includes('::') ? text.split('::') : [text, null];
  const parse = (part) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []);
  const head = parse(headText);
  const tail = tailText === null ? [] : parse(tailText);
  const zeros = tailText === null ? [] : new Array(8 - head.length - tail.length).fill(0);
  return head.concat(zeros, tail).slice(0, 4).concat([0, 0, 0, 0]);
};
let state = 0x9e3779b9;
const next = () => {
  state ^= state << 13;
  state >>>= 0;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return state;
};
let sweep = 0;
for (let i = 0; i < 320; i += 1) {
  const length = i % 3 === 0 ? 8 : 6;
  const bytes = [];
  bytes.push((next() % 128) * 2); // even first octet: unicast
  for (let k = 1; k < length; k += 1) bytes.push(next() % 256);
  const identifier = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':');
  const prefixGroups = [next() % 65536, next() % 65536, 0, next() % 65536];
  const prefix = prefixGroups.map((group) => group.toString(16)).join(':') + '::/64';
  const iid = refGroups(refIidBytes(identifier));
  const expected = {
    iid: iid.map((group) => group.toString(16).padStart(4, '0')).join(':'),
    linkLocal: refFormat([0xfe80, 0, 0, 0, ...iid]),
    address: refFormat([...refPrefix(`${prefixGroups.map((group) => group.toString(16)).join(':')}::/64`).slice(0, 4), ...iid]),
  };
  const actual = C.generate(identifier, prefix);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(actual[key], value, `sweep ${i} ${key} (${identifier} ${prefix})`);
  }
  sweep += 1;
}
assert.equal(sweep, 320);

// --- Catalog cases. ---
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    validation += 1;
    assert.equal(failure(() => C.generate(input.mac, input.prefix)), testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const actual = C.generate(input.mac, input.prefix);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, `${testCase.name} ${key}`);
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 7);
assert.equal(validation, 11);
assert.equal(entry.testCases.length, 26);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(html), 'no HTML string sinks');
assert.ok(html.includes('<form id="eui-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:600px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
for (const id of ['eui-form', 'mac-input', 'prefix-input', 'generate', 'eui-status', 'iid-out',
  'iid-sub', 'linklocal-out', 'address-out', 'prefix-label', 'eui-detail', 'copy-linklocal', 'copy-address']) {
  assert.ok(html.includes(`id="${id}"`), `element ${id} missing`);
}
for (const id of ['mac-input', 'prefix-input']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id} missing`);
}
for (const id of ['iid-out', 'linklocal-out', 'address-out']) {
  assert.ok(html.includes(`<output id="${id}"`), `output ${id} missing`);
}
assert.ok(html.includes('<output id="address-out" for="mac-input prefix-input">'), 'prefix output must be linked to both inputs');
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)|\$\('([^']+)'\)/g)) {
  const id = match[1] || match[2];
  assert.ok(ids.includes(id), `script references missing id ${id}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"'), 'tools registry missing');
assert.ok(html.includes('src="/assets/app.js"'), 'app bootstrap missing');
console.log('ipv6-eui-64-generator: 26 catalog cases and 320 reference comparisons passed');
