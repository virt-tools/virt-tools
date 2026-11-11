/* RF skin depth checks: the page core against an independent math reference,
   scaling identities, unit handling, validation messages, catalog replay,
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rf-skin-depth-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* rf-skin-depth-core:start */';
const endMarker = '/* rf-skin-depth-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'skin depth core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RfSkinDepthCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.plan({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};

// ---- Exported contract.
assert.deepEqual(plain(C.FIELDS), ['frequency', 'unit', 'material', 'conductivity', 'mur']);
assert.deepEqual(plain(C.DEFAULTS), { frequency: '100', unit: 'MHz', material: 'copper', conductivity: '58.0', mur: '1' });
assert.deepEqual(plain(C.MATERIALS).map((item) => item.id),
  ['copper', 'silver', 'gold', 'aluminum', 'brass', 'bronze', 'custom']);
assert.deepEqual(plain(C.MATERIALS).map((item) => item.sigma), [58.0, 63.0, 41.0, 35.4, 16.0, 8.7, 58.0]);
assert.deepEqual(plain(C.BAND).map((item) => item.label),
  ['1 kHz', '1 MHz', '10 MHz', '100 MHz', '1 GHz', '10 GHz']);
assert.equal(C.MIN_HZ, 1);
assert.equal(C.MAX_HZ, 3e11);
assert.equal(C.MIN_SIGMA, 0.01);
assert.equal(C.MAX_SIGMA, 100);
assert.equal(C.MIN_MUR, 1);
assert.equal(C.MAX_MUR, 10000);

// ---- Published default: copper (58 MS/m) at 100 MHz.
const published = run({});
assert.equal(published.material, 'copper');
assert.equal(published.materialLabel, 'Copper (annealed)');
assert.equal(published.frequencyHz, 1e8);
assert.equal(published.frequencyText, '100 MHz');
assert.equal(published.conductivityText, '58.0 MS/m');
assert.equal(published.muRText, '1');
assert.equal(published.depthText, '6.61 \u00b5m');
assert.equal(published.resistanceText, '2.61 m\u03a9/sq');
assert.equal(published.fiveDepthText, '33 \u00b5m');
assert.equal(published.depthMilText, '0.26 mil');
assert.ok(Math.abs(published.depth - 6.608549310080563e-6) < 1e-18, 'default depth');
assert.ok(Math.abs(published.resistance - 2.6089506942234865e-3) < 1e-15, 'default surface resistance');
assert.equal(published.rows.length, 6);
assert.equal(published.rows[1].label, '1 MHz');
assert.equal(published.rows[2].depthText, '20.9 \u00b5m');
assert.equal(published.rows[4].resistanceText, '8.25 m\u03a9/sq');

// ---- Reference table computed independently in Python (math.sqrt with
//      mu0 = 4e-7 pi): [hertz, siemens per metre, relative mu, depth, Rs].
const POINTS = [
  [1000000.0, 58000000.0, 1.0, 6.608549310080563e-05, 0.00026089506942234865],
  [100000000.0, 58000000.0, 1.0, 6.608549310080563e-06, 0.0026089506942234865],
  [2400000000.0, 58000000.0, 1.0, 1.3489644791432656e-06, 0.012781195929854964],
  [13560000.0, 63000000.0, 1.0, 1.7219479199623476e-05, 0.0009218058042872142],
  [1000.0, 35400000.0, 1.0, 0.002674967443203561, 1.0560348180085045e-05],
  [10000000000.0, 16000000.0, 1.0, 1.2582303026121758e-06, 0.04967294132898051],
  [1.0, 58000000.0, 1.0, 0.06608549310080564, 2.6089506942234865e-07],
  [300000000000.0, 41000000.0, 1.0, 1.4350517939318523e-07, 0.1699607220141719],
  [100000000.0, 12500000.0, 1.0, 1.4235250868343541e-05, 0.00561985178483258],
  [1000000000.0, 58000000.0, 2.5, 1.3217098620161127e-06, 0.013044753471117432],
  [5000000000.0, 41000000.0, 1.0, 1.1115863397686286e-06, 0.02194183486234253],
  [77500.0, 8700000.0, 1.0, 0.0006129282719266764, 0.00018753014667494824],
  [2450000000.0, 63000000.0, 1.5, 1.045974712636279e-06, 0.0151753342420769],
];
for (const [hz, sigma, mur, expectedDepth, expectedRs] of POINTS) {
  const depth = C.skinDepth(hz, sigma, mur);
  const resistance = C.surfaceResistance(hz, sigma, mur);
  assert.ok(Math.abs(depth - expectedDepth) / expectedDepth < 1e-12,
    `depth at ${hz} Hz: ${depth} vs ${expectedDepth}`);
  assert.ok(Math.abs(resistance - expectedRs) / expectedRs < 1e-12,
    `Rs at ${hz} Hz: ${resistance} vs ${expectedRs}`);
}

// ---- Physics identities: Rs = 1/(sigma delta), and the square-root laws.
for (const [hz, sigma, mur] of POINTS) {
  const depth = C.skinDepth(hz, sigma, mur);
  const resistance = C.surfaceResistance(hz, sigma, mur);
  assert.ok(Math.abs(depth * sigma * resistance - 1) < 1e-12, 'Rs = 1/(sigma delta)');
  assert.ok(Math.abs(C.skinDepth(hz * 4, sigma, mur) - depth / 2) / depth < 1e-12, 'delta halves at 4x frequency');
  assert.ok(Math.abs(C.surfaceResistance(hz * 4, sigma, mur) - resistance * 2) / resistance < 1e-12, 'Rs doubles at 4x frequency');
  assert.ok(Math.abs(C.skinDepth(hz, sigma, mur * 4) - depth / 2) / depth < 1e-12, 'delta halves at 4x mu');
  assert.ok(Math.abs(C.surfaceResistance(hz, sigma, mur * 4) - resistance * 2) / resistance < 1e-12, 'Rs doubles at 4x mu');
}

// ---- Unit handling and presets through the public plan().
const hundredMHz = run({});
const decimalGHz = run({ frequency: '0.1', unit: 'GHz' });
const kilohertz = run({ frequency: '100000', unit: 'kHz' });
assert.ok(Math.abs(hundredMHz.depth - decimalGHz.depth) / hundredMHz.depth < 1e-12, '100 MHz = 0.1 GHz');
assert.ok(Math.abs(hundredMHz.depth - kilohertz.depth) / hundredMHz.depth < 1e-12, '100 MHz = 100000 kHz');
assert.equal(decimalGHz.frequencyText, '0.1 GHz');
assert.equal(kilohertz.frequencyText, '100000 kHz');
assert.equal(run({ material: 'silver', conductivity: '63.0' }).depthText, '6.34 \u00b5m');
assert.equal(run({ material: 'bronze', conductivity: '8.7' }).depthText, '17.1 \u00b5m');
assert.equal(run({ frequency: '1', unit: 'Hz' }).depthText, '66.1 mm');
assert.equal(run({ frequency: '1', unit: 'Hz' }).resistanceText, '0.261 \u00b5\u03a9/sq');
assert.equal(run({ frequency: '300', unit: 'GHz', material: 'gold', conductivity: '41.0' }).depthText, '144 nm');
assert.equal(run({ frequency: '300', unit: 'GHz', material: 'gold', conductivity: '41.0' }).resistanceText, '170 m\u03a9/sq');

// ---- Band table: depth falls and Rs rises with frequency, row by row.
const table = run({}).rows;
for (let i = 1; i < table.length; i += 1) {
  assert.ok(table[i].depth < table[i - 1].depth, 'table depth is decreasing');
  assert.ok(table[i].depth / table[i - 1].depth < 0.4, 'each row is a decade lower');
  assert.ok(table[i].resistanceText !== table[i - 1].resistanceText, 'table resistance rises');
}

// ---- Validation messages.
assert.equal(failure({ frequency: '' }), 'Frequency is required.');
assert.equal(failure({ frequency: 'ten' }), 'Frequency must be a number.');
assert.equal(failure({ frequency: '+100' }), 'Frequency must be a number.');
assert.equal(failure({ frequency: '1,0' }), 'Frequency must be a number.');
assert.equal(failure({ frequency: '0.001', unit: 'Hz' }), 'Frequency must be between 1 Hz and 300 GHz.');
assert.equal(failure({ frequency: '301', unit: 'GHz' }), 'Frequency must be between 1 Hz and 300 GHz.');
assert.equal(failure({ frequency: '100', unit: 'THz' }), 'Choose a frequency unit from the list.');
assert.equal(failure({ material: 'iron' }), 'Choose one of the listed conductor materials.');
assert.equal(failure({ conductivity: '' }), 'Conductivity is required.');
assert.equal(failure({ conductivity: '0' }), 'Conductivity must be from 0.01 to 100 MS/m.');
assert.equal(failure({ conductivity: '101' }), 'Conductivity must be from 0.01 to 100 MS/m.');
assert.equal(failure({ mur: '0.5' }), 'Relative permeability must be from 1 to 10000.');
assert.equal(failure({ mur: '10001' }), 'Relative permeability must be from 1 to 10000.');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'RF Skin Depth Calculator');
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
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
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
assert.ok(/overflow-x:auto/.test(html), 'the band table scrolls instead of overflowing');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html.replace(/[←—·\u00b5\u03a9]/g, '')), 'no unexpected non-ASCII glyphs');

console.log('rf-skin-depth-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + POINTS.length + ' reference points, '
  + 'scaling identities and the offline page contract)');
