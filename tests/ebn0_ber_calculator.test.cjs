/* Eb/N0-to-BER checks: the page core against a math.erfc reference table,
   monotonicity and bisection contracts, catalog replay, validation messages,
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ebn0-ber-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* ebn0-ber-core:start */';
const endMarker = '/* ebn0-ber-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'ber core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Ebn0BerCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.plan({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(C.FIELDS), ['ebn0', 'scheme', 'target']);
assert.deepEqual(plain(C.DEFAULTS), { ebn0: '10', scheme: 'qpsk', target: '1e-6' });
assert.deepEqual(plain(C.SCHEMES).map((item) => item.id), ['bpsk', 'qpsk', '8psk', '16qam', '64qam']);
assert.deepEqual(plain(C.SCHEMES).map((item) => item.bits), [1, 2, 3, 4, 6]);
assert.deepEqual(plain(C.SCHEMES).map((item) => item.label), ['BPSK', 'QPSK', '8-PSK', '16-QAM', '64-QAM']);
assert.deepEqual(plain(C.TARGETS), ['1e-2', '1e-3', '1e-4', '1e-5', '1e-6', '1e-8']);
assert.equal(C.MIN_DB, -10);
assert.equal(C.MAX_DB, 60);

// ---- Published default: QPSK at 10 dB Eb/N0 is 3.87e-6, 0.53 dB short of 1e-6.
const published = run({});
assert.equal(published.scheme, 'qpsk');
assert.equal(published.schemeLabel, 'QPSK');
assert.equal(published.bits, 2);
assert.equal(published.ebn0, 10);
assert.equal(published.ebn0Text, '10.0 dB');
assert.equal(published.berText, '3.87e-6');
assert.equal(published.requiredText, '10.53 dB');
assert.equal(published.marginText, '-0.53 dB');
assert.equal(published.targetText, '1e-6');
assert.ok(Math.abs(published.esn0 - 13.0102999566) < 1e-9, 'Es/N0 is Eb/N0 + 10log10(2)');
assert.equal(published.rows.length, 5);
assert.equal(published.rows.filter((row) => row.selected).length, 1);
assert.equal(published.rows.find((row) => row.selected).id, 'qpsk');
assert.deepEqual(published.rows.map((row) => row.berText), ['3.87e-6', '3.87e-6', '1.01e-3', '1.75e-3', '2.65e-2']);

// ---- Reference table: bit error rates computed with Python's math.erfc.
const POINTS = [
  ['bpsk', -10, 0.3273604230092885],
  ['bpsk', -4, 0.186113817483389],
  ['bpsk', 0, 0.07864960352514257],
  ['bpsk', 3.5, 0.017172541679245992],
  ['bpsk', 6.8, 0.0009875133751551387],
  ['bpsk', 10, 3.872108215522037e-06],
  ['bpsk', 12.5, 1.2330284466108096e-09],
  ['bpsk', 16, 2.267395844454413e-19],
  ['bpsk', 20, 1.0442437918812724e-45],
  ['bpsk', 24.5, 6.665189389406891e-125],
  ['bpsk', 30, 0],
  ['qpsk', 0, 0.07864960352514257],
  ['qpsk', 10, 3.872108215522037e-06],
  ['qpsk', 20, 1.0442437918812724e-45],
  ['8psk', -10, 0.2556350990735843],
  ['8psk', 0, 0.11618785533262038],
  ['8psk', 6.8, 0.013430039553552412],
  ['8psk', 10, 0.0010113953207128907],
  ['8psk', 12.5, 2.5737100780282192e-05],
  ['8psk', 16, 1.1098699782315093e-09],
  ['8psk', 24.5, 2.8223699209594907e-56],
  ['8psk', 30, 1.411066836571673e-193],
  ['16qam', -10, 0.2914865290460706],
  ['16qam', 0, 0.1391600135710116],
  ['16qam', 10, 0.0017541506178927245],
  ['16qam', 12.5, 6.078555406620818e-05],
  ['16qam', 16, 6.250200827741961e-09],
  ['16qam', 20, 1.4040365190760803e-19],
  ['16qam', 30, 2.0234496043529625e-176],
  ['64qam', -10, 0.25251694270618125],
  ['64qam', 0, 0.17295252858841612],
  ['64qam', 6.8, 0.07065315188475951],
  ['64qam', 10, 0.02653260982614602],
  ['64qam', 16, 0.00021717395915942027],
  ['64qam', 20, 2.6338925317730424e-08],
  ['64qam', 24.5, 8.371337020851721e-20],
  ['64qam', 30, 1.2453318173098853e-64],
];
for (const [scheme, db, expected] of POINTS) {
  const got = C.ber(scheme, C.linear(db));
  if (expected === 0) {
    assert.equal(got, 0, `${scheme} ${db} dB underflows`);
    continue;
  }
  const relative = Math.abs(got - expected) / expected;
  assert.ok(relative < 1e-9, `${scheme} ${db} dB: got ${got}, expected ${expected}`);
}

// ---- Required Eb/N0 for each target, from the same math.erfc bisection.
const REQUIRED = [
  ['bpsk', 1e-2, 4.323193], ['bpsk', 1e-3, 6.789523], ['bpsk', 1e-5, 9.587858],
  ['bpsk', 1e-6, 10.529832], ['bpsk', 1e-8, 11.972055],
  ['qpsk', 1e-2, 4.323193], ['qpsk', 1e-3, 6.789523], ['qpsk', 1e-5, 9.587858],
  ['qpsk', 1e-6, 10.529832], ['qpsk', 1e-8, 11.972055],
  ['8psk', 1e-2, 7.291251], ['8psk', 1e-3, 10.010205], ['8psk', 1e-5, 12.971633],
  ['8psk', 1e-6, 13.949557], ['8psk', 1e-8, 15.434142],
  ['16qam', 1e-2, 7.881917], ['16qam', 1e-3, 10.522401], ['16qam', 1e-5, 13.434522],
  ['16qam', 1e-6, 14.401727], ['16qam', 1e-8, 15.873754],
  ['64qam', 1e-2, 11.953847], ['64qam', 1e-3, 14.767496], ['64qam', 1e-5, 17.786888],
  ['64qam', 1e-6, 18.77725], ['64qam', 1e-8, 20.276332],
];
for (const [scheme, target, expected] of REQUIRED) {
  const got = C.requiredDb(scheme, target);
  assert.ok(Math.abs(got - expected) < 1e-6, `${scheme} target ${target}: got ${got}, expected ${expected}`);
  // The value must actually land on the target.
  const landed = C.ber(scheme, C.linear(got));
  assert.ok(Math.abs(landed - target) / target < 1e-6, `${scheme} ${target} round-trip is off`);
}

// ---- Shape of the curves: decreasing in Eb/N0, tighter targets need more power.
for (const scheme of ['bpsk', 'qpsk', '8psk', '16qam', '64qam']) {
  let previous = Infinity;
  for (let db = -10; db <= 30; db += 0.5) {
    const value = C.ber(scheme, C.linear(db));
    assert.ok(value <= previous, `${scheme} BER must fall as Eb/N0 rises (${db} dB)`);
    previous = value;
  }
  let lastRequired = -Infinity;
  for (const target of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-8]) {
    const need = C.requiredDb(scheme, target);
    assert.ok(need > lastRequired, `${scheme} needs more power for ${target}`);
    lastRequired = need;
  }
}

// ---- BPSK and QPSK share the same bit error rate; QAM is worse at low power.
assert.equal(C.ber('bpsk', C.linear(10)), C.ber('qpsk', C.linear(10)));
assert.ok(C.ber('64qam', C.linear(10)) > C.ber('16qam', C.linear(10)));
assert.ok(C.ber('16qam', C.linear(10)) > C.ber('qpsk', C.linear(10)));

// ---- Formatting and range edges.
assert.equal(C.formatBer(0), '< 1e-300');
assert.equal(C.formatBer(3.872108215522037e-6), '3.87e-6');
assert.equal(C.formatDb(10.529832), '10.53 dB');
assert.equal(C.formatDb(null), 'outside -10 to 60 dB');
assert.equal(run({ ebn0: '60', scheme: 'bpsk' }).ber, 0);
assert.equal(run({ ebn0: '60', scheme: 'bpsk' }).berText, '< 1e-300');
assert.equal(C.schemeById(' QPSK ').id, 'qpsk');
assert.throws(() => C.schemeById('32qam'), /listed modulation schemes/);

// ---- Validation messages.
assert.equal(failure({ ebn0: '' }), 'Eb/N0 is required.');
assert.equal(failure({ ebn0: 'ten' }), 'Eb/N0 must be a number.');
assert.equal(failure({ ebn0: '+10' }), 'Eb/N0 must be a number.');
assert.equal(failure({ ebn0: '1,0' }), 'Eb/N0 must be a number.');
assert.equal(failure({ ebn0: '-11' }), 'Eb/N0 must be from -10 to 60 dB.');
assert.equal(failure({ ebn0: '61' }), 'Eb/N0 must be from -10 to 60 dB.');
assert.equal(failure({ scheme: '' }), 'Choose one of the listed modulation schemes.');
assert.equal(failure({ scheme: '32qam' }), 'Choose one of the listed modulation schemes.');
assert.equal(failure({ target: '' }), 'Choose a target bit error rate from the list.');
assert.equal(failure({ target: '1e-7' }), 'Choose a target bit error rate from the list.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Eb/N0 to BER Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 5, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of C.FIELDS) {
  assert.ok(new RegExp(`<label class="f" for="in-${field}"`).test(html), 'control is labelled: ' + field);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/overflow-x:auto/.test(html), 'the scheme table scrolls instead of overflowing');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[←·—]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('ebn0-ber-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + POINTS.length + ' reference rates, '
  + REQUIRED.length + ' required-power points)');
