/* Water hardness converter: independent unit factors, band edges, formatting,
   catalog replay and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'water-hardness-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* water-hardness-core:start */';
const endMarker = '/* water-hardness-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WaterHardnessCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, unit) => plain(C.parse(value, unit));
const failure = (value, unit) => {
  try { run(value, unit); } catch (error) { return error.message; }
  return null;
};

// ---- Independent factors, rebuilt from the physical definitions.
const MOLAR_CACO3 = 100.0869;
const MOLAR_CAO = 56.0774;
const GRAIN_MG = 64.79891;
const US_GALLON_L = 3.785411784;
const IMPERIAL_GALLON_L = 4.54609;
const FACTOR = {
  ppm: 1,
  mmol: MOLAR_CACO3,
  dgh: (10 / MOLAR_CAO) * MOLAR_CACO3,
  clark: GRAIN_MG / IMPERIAL_GALLON_L,
  fh: 10,
  gpg: GRAIN_MG / US_GALLON_L,
};

assert.equal(C.MG_PER_MMOL, MOLAR_CACO3);
assert.equal(C.MG_PER_DGH, 17.8479922);
assert.equal(C.MG_PER_CLARK, 14.2537675);
assert.equal(C.MG_PER_FH, 10);
assert.equal(C.MG_PER_GPG, 17.1180610);
assert.equal(C.MIN_MG, 0);
assert.equal(C.MAX_MG, 100000);
assert.equal(C.SIGNIFICANT_DIGITS, 6);
assert.equal(C.DEFAULT_VALUE, '180');
assert.equal(C.DEFAULT_UNIT, 'ppm');
for (const [id, factor] of Object.entries(FACTOR)) {
  assert.ok(Math.abs(C.unitOf(id).perLitre - factor) < 1e-7 * factor, 'factor for ' + id);
}
assert.equal(C.unitOf('grains'), null);
assert.deepEqual(plain(C.UNITS.map((unit) => unit.id)), ['ppm', 'mmol', 'dgh', 'clark', 'fh', 'gpg']);
assert.deepEqual(plain(C.ROW_ORDER), ['dgh', 'clark', 'fh', 'gpg', 'mmol']);
assert.deepEqual(plain(C.BANDS.map((band) => band.limit)), [60, 120, 180, null]);
assert.deepEqual(plain(C.BANDS.map((band) => band.label)), ['Soft', 'Moderately hard', 'Hard', 'Very hard']);

// ---- The factors agree with the published conversion table.
assert.ok(Math.abs(C.MG_PER_DGH - 17.85) < 0.01, 'one German degree is 17.85 mg/L');
assert.ok(Math.abs(C.MG_PER_GPG - 17.12) < 0.01, 'one grain per US gallon is 17.12 mg/L');
assert.ok(Math.abs(C.MG_PER_CLARK - 14.25) < 0.01, 'one Clark degree is 14.25 mg/L');
assert.ok(Math.abs(C.MG_PER_DGH / C.MG_PER_GPG - 1.043) < 0.001, 'one German degree is 1.043 gpg');
assert.ok(Math.abs(C.MG_PER_DGH / C.MG_PER_CLARK - 1.252) < 0.001, 'one German degree is 1.252 Clark degrees');
assert.ok(Math.abs(C.MG_PER_DGH / C.MG_PER_FH - 1.785) < 0.001, 'one German degree is 1.785 French degrees');
assert.ok(Math.abs(C.MG_PER_GPG / C.MG_PER_FH - 1.712) < 0.001, 'one grain per US gallon is 1.712 French degrees');
assert.ok(C.MG_PER_GPG > C.MG_PER_CLARK, 'a US grain is heavier than an imperial grain in the same volume');

// ---- Conversion agrees with the independent factors over a sweep.
const samples = [0, 0.25, 1, 2.5, 7.5, 15, 61, 120, 180, 300, 640, 2500, 99999];
let comparisons = 0;
for (const unit of Object.keys(FACTOR)) {
  for (const value of samples) {
    if (value * FACTOR[unit] > C.MAX_MG) continue;
    const result = run(String(value), unit);
    const mg = value * FACTOR[unit];
    // The page reports six significant figures, so allow half an ulp of that.
    assert.ok(Math.abs(result.mg - mg) <= 2e-5 * Math.max(1, mg), 'mg for ' + value + ' ' + unit);
    for (const row of result.rows) {
      const expected = mg / FACTOR[row.id];
      assert.ok(Math.abs(row.value - expected) <= 2e-5 * Math.max(1, expected),
        row.id + ' for ' + value + ' ' + unit + ': ' + row.value + ' vs ' + expected);
      comparisons += 1;
    }
  }
}

// ---- Round trips: any unit converts into any other and back.
for (const unit of Object.keys(FACTOR)) {
  for (const value of [0.5, 3.2, 27.5, 210, 1400]) {
    if (value * FACTOR[unit] > C.MAX_MG) continue;
    const first = run(String(value), unit);
    for (const row of first.rows) {
      const back = run(String(row.value), row.id);
      assert.ok(Math.abs(back.mg - first.mg) <= 1e-4 * Math.max(1, first.mg),
        'round trip through ' + row.id + ' at ' + value + ' ' + unit);
    }
  }
}

// ---- The USGS band edges sit where the citation puts them.
assert.equal(C.bandOf(0).id, 'soft');
assert.equal(C.bandOf(59.999).id, 'soft');
assert.equal(C.bandOf(60).id, 'soft');
assert.equal(C.bandOf(60.001).id, 'moderately-hard');
assert.equal(C.bandOf(120).id, 'moderately-hard');
assert.equal(C.bandOf(120.001).id, 'hard');
assert.equal(C.bandOf(180).id, 'hard');
assert.equal(C.bandOf(180.001).id, 'very-hard');
assert.equal(C.bandOf(100000).id, 'very-hard');

// ---- Displayed texts.
const hardness = run('180', 'ppm');
assert.equal(hardness.headline, '180 mg/L');
assert.equal(hardness.fromText, '180 mg/L');
assert.equal(hardness.band, 'hard');
assert.equal(hardness.bandLabel, 'Hard');
assert.deepEqual(hardness.rows.map((row) => row.text),
  ['10.09 \u00b0dH', '12.63 \u00b0e', '18 \u00b0fH', '10.52 gpg', '1.798 mmol/L']);

const softener = run('15', 'gpg');
assert.equal(softener.headline, '256.8 mg/L');
assert.equal(softener.subText, 'Entered as 15 grains per US gallon \u00b7 very hard water on the USGS scale');
assert.deepEqual(softener.rows.map((row) => row.text),
  ['14.39 \u00b0dH', '18.01 \u00b0e', '25.68 \u00b0fH', '15 gpg', '2.565 mmol/L']);

const german = run('10', 'dgh');
assert.equal(german.headline, '178.5 mg/L');
assert.equal(german.bandLabel, 'Hard');
assert.equal(german.rows[2].text, '17.85 \u00b0fH');

const zero = run('0', 'ppm');
assert.equal(zero.headline, '0 mg/L');
assert.equal(zero.band, 'soft');
assert.deepEqual(zero.rows.map((row) => row.text), ['0 \u00b0dH', '0 \u00b0e', '0 \u00b0fH', '0 gpg', '0 mmol/L']);

const ceiling = run('100000', 'ppm');
assert.equal(ceiling.headline, '100,000 mg/L');
assert.deepEqual(ceiling.rows.map((row) => row.text),
  ['5,603 \u00b0dH', '7,016 \u00b0e', '10,000 \u00b0fH', '5,842 gpg', '999.1 mmol/L']);

assert.equal(C.format(0), '0');
assert.equal(C.format(180), '180');
assert.equal(C.format(1000), '1,000');
assert.equal(C.format(100000), '100,000');
assert.equal(C.format(10.0852), '10.09');
assert.equal(C.format(0.0891556), '0.08916');
assert.equal(C.format(1234.5), '1,235');

// ---- Inputs that are not a hardness figure.
assert.equal(failure('', 'ppm'), 'Enter a water hardness value to convert.');
assert.equal(failure('   ', 'ppm'), 'Enter a water hardness value to convert.');
assert.equal(failure('hard', 'ppm'), 'Enter the hardness as a number, such as 12.5 or 180.');
assert.equal(failure('180 mg/L', 'ppm'), 'Enter the hardness as a number, such as 12.5 or 180.');
assert.equal(failure('1,80', 'ppm'), 'Enter the hardness as a number, such as 12.5 or 180.');
assert.equal(failure('-5', 'ppm'), 'Hardness cannot be negative.');
assert.equal(failure('100001', 'ppm'),
  'That is above 100,000 mg/L as calcium carbonate, the range this converter covers.');
assert.equal(failure('1000', 'mmol'),
  'That is above 100,000 mg/L as calcium carbonate, the range this converter covers.');
assert.equal(failure('180', 'grains'), 'Choose one of the listed hardness units.');
assert.equal(failure('100000', 'ppm'), null, 'the ceiling itself is accepted');
assert.equal(failure('1,234.5', 'ppm'), null, 'a grouped number is accepted');

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((item) => item.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs, 'every listed record has a page');
assert.equal(entry.category, 'Converters');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.testCases.length, 22, 'catalog case count');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6);
assert.equal(kinds('boundary'), 7);
assert.equal(kinds('validation'), 9);
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.value, testCase.input.unit), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input.value, testCase.input.unit);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// The two cited sources stay reachable and address the classification and factors.
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources missing');
for (const source of entry.sources) {
  assert.ok(/^https?:\/\//.test(source.url), 'source needs an absolute URL');
  assert.ok(source.title.length > 40, 'source needs a specific title');
}
assert.ok(entry.sources.some((source) => source.url.includes('usgs.gov')), 'USGS classification source');
assert.ok(entry.sources.some((source) => source.url.includes('wikipedia.org')), 'unit table source');

// ---- Uniqueness: no other record claims this slug, name or alias.
const others = catalog.tools
  .filter((tool) => tool.slug !== slug)
  .flatMap((tool) => [tool.slug, tool.name, ...(tool.aliases || [])].map((value) => value.toLowerCase()));
for (const value of [entry.name, ...entry.aliases]) {
  assert.ok(!others.includes(value.toLowerCase()), 'duplicate name or alias: ' + value);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="hardness-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
for (const id of ['hardness', 'unit']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<option value="/g) || []).length === 6, 'six unit options');

console.log('water hardness converter: ' + entry.testCases.length + ' catalog cases, ' + comparisons
  + ' swept conversions and the page contract pass');
