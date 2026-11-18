/* Regression checks for the phon/sone core and every case in its catalog record.
 *
 * The loudness law is anchored two ways: the page stores sone = 2^((phon-40)/10),
 * and the helpers below rebuild the same curve in base ten from the definition
 * that ten phon is a doubling, 10^((phon-40) * log10(2) / 10), then invert it
 * with 40 + 10*log2(sone). The published ladder (1, 2, 4, 8, 16, 32, 64 sone at
 * 40..100 phon) and the source's example sounds are re-derived before anything
 * is compared, so a wrong constant cannot agree with itself.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'phon-sone-loudness-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* phon-sone-core:start */');
const end = html.indexOf('/* phon-sone-core:end */');
assert.ok(start > -1 && end > start, 'phon sone core markers missing');
const core = html.slice(start, end + '/* phon-sone-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PhonSoneCore;', sandbox);
const C = sandbox.module.exports;

const run = (value, unit, reference) => C.analyse({ value, unit, reference });
const near = (got, want, tolerance, label) =>
  assert.ok(Math.abs(got - want) <= tolerance, `${label}: ${got} vs ${want}`);

// ---- The law, rebuilt in base ten: one decade of phon is a factor of ten in
// intensity, and loudness follows intensity to the power log10(2) per 3 dB, so
// ten phon doubles it.
const LOG10_2 = Math.log10(2);
const law = (phon) => Math.pow(10, ((phon - 40) * LOG10_2) / 10);
const inverse = (sone) => 40 + (10 * Math.log(sone)) / Math.LN2;

for (let phon = 0; phon <= 140; phon += 1) {
  near(C.phonToSone(phon), law(phon), 1e-12 * Math.max(1, law(phon)), `${phon} phon: sone from the law`);
  near(C.soneToPhon(law(phon)), phon, 1e-9, `${phon} phon: phon back from the sone`);
}
for (let phon = 0; phon <= 130; phon += 1) {
  near(C.phonToSone(phon + 10), 2 * C.phonToSone(phon), 1e-12 * C.phonToSone(phon + 10),
    `${phon} phon: ten phon doubles loudness`);
}

// ---- Published anchors from the source: the sone/phon table and the example
// sounds around it.
{
  const table = [[40, 1], [50, 2], [60, 4], [70, 8], [80, 16], [90, 32], [100, 64]];
  for (const [phon, sone] of table) {
    near(C.phonToSone(phon), sone, 1e-9, `published table: ${phon} phon is ${sone} sone`);
    near(C.soneToPhon(sone), phon, 1e-9, `published table inverted: ${sone} sone is ${phon} phon`);
  }
  near(C.phonToSone(100), 64, 0.5, 'a nightclub at about 100 dB SPL is about 64 sone');
  near(C.phonToSone(120), 256, 2, 'short-term damage level at about 120 dB is about 256 sone');
  near(C.phonToSone(134), 676, 4, 'the threshold of pain at about 134 dB is about 676 sone');
  assert.equal(C.phonToSone(0), C.MIN_SONE, 'silence is the smallest loudness the scale covers');
  assert.equal(C.phonToSone(140), C.MAX_SONE, '140 phon is the top of the scale');
}

// ---- Formatting.
assert.equal(C.trimZeros('8.00'), '8');
assert.equal(C.trimZeros('0.500'), '0.5');
assert.equal(C.trimZeros('0.063'), '0.063');
assert.equal(C.trimZeros('1024'), '1024');
assert.equal(C.oneDecimal(70), '70');
assert.equal(C.oneDecimal(70.04), '70');
assert.equal(C.oneDecimal(70.05), '70.1');
assert.equal(C.oneDecimal(69.96), '70');
assert.equal(C.soneText(8), '8');
assert.equal(C.soneText(1), '1');
assert.equal(C.soneText(0.5), '0.5');
assert.equal(C.soneText(0.0625), '0.063');
assert.equal(C.soneText(64), '64');
assert.equal(C.soneText(128), '128');
assert.equal(C.soneText(1024), '1024');
assert.equal(C.soneShort(2), '2');
assert.equal(C.soneShort(0.25), '0.25');
assert.equal(C.ratioText(8), '8');
assert.equal(C.ratioText(0.25), '0.25');
assert.equal(C.ratioText(0.0625), '0.063');
assert.equal(C.signed(30, 1), '+30');
assert.equal(C.signed(-10, 1), '\u221210');
assert.equal(C.signed(0, 1), '0');
assert.equal(C.signed(-0.04, 1), '0');

// ---- Number parsing.
assert.equal(C.parsePhon('70', 'Loudness level'), 70);
assert.equal(C.parsePhon(' 73.2 ', 'Loudness level'), 73.2);
assert.equal(C.parsePhon('1,00', 'Loudness level'), 100);
assert.equal(C.parsePhon('0', 'Reference loudness level'), 0);
assert.equal(C.parseSone('0.0625'), 0.0625);
assert.equal(C.parseSone('1,024'), 1024);
assert.equal(C.unitById('phon'), 'phon');
assert.equal(C.unitById('sone'), 'sone');

// ---- The documented default: 70 phon against a 40 phon reference is 8 sone.
{
  const result = run('70', 'phon', '40');
  assert.equal(result.unit, 'phon');
  assert.equal(result.phon, 70);
  assert.equal(result.sone, 8);
  assert.equal(result.phonText, '70');
  assert.equal(result.soneText, '8');
  assert.equal(result.referencePhon, 40);
  assert.equal(result.referenceSone, 1);
  assert.equal(result.referenceSoneText, '1');
  assert.equal(result.ratio, 8);
  assert.equal(result.doublings, 3);
  assert.equal(result.relativeText, '\u00d78 louder (3 doublings)');
  assert.equal(result.deltaText, '+30');
  assert.equal(result.doubleText, '80 phon');
  assert.equal(result.halfText, '60 phon');
  assert.equal(result.lowNote, false);
  assert.equal(result.ladder.length, 11);
  assert.deepEqual(Array.from(result.ladder.filter((row) => row.reference), (row) => row.phonText), ['40 phon']);
  assert.deepEqual(Array.from(result.ladder.filter((row) => row.entered), (row) => row.soneText), ['8 sone']);
  assert.deepEqual(Array.from(result.ladder, (row) => row.phon), [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  assert.deepEqual(Array.from(result.ladder, (row) => row.soneText.split(' ')[0]),
    ['0.25', '0.5', '1', '2', '4', '8', '16', '32', '64', '128', '256']);
}

// ---- The inverse direction lands on the same level.
{
  const result = run('2', 'sone', '40');
  assert.equal(result.unit, 'sone');
  assert.equal(result.phonText, '50');
  assert.equal(result.soneText, '2');
  assert.equal(result.deltaText, '+10');
  assert.equal(result.relativeText, '\u00d72 louder (1 doubling)');
  const top = run('1024', 'sone', '40');
  assert.equal(top.phonText, '140');
  assert.equal(top.soneText, '1024');
  assert.equal(top.doubleText, 'past 140 phon');
  assert.equal(top.halfText, '130 phon');
  const floor = run('0.0625', 'sone', '40');
  assert.equal(floor.phonText, '0');
  assert.equal(floor.soneText, '0.063');
  assert.equal(floor.lowNote, true);
}

// ---- Closed-form sweep: every level, both directions, four references.
{
  let checked = 0;
  for (const reference of [0, 40, 70, 120]) {
    for (let phon = 0; phon <= 140; phon += 2) {
      const result = run(String(phon), 'phon', String(reference));
      const referenceSone = law(reference);
      near(result.sone, law(phon), 1e-12 * Math.max(1, law(phon)), `${phon}/${reference}: sone`);
      near(result.ratio, law(phon) / referenceSone, 1e-12 * Math.max(1, result.ratio), `${phon}/${reference}: ratio`);
      near(result.doublings, (phon - reference) / 10, 1e-9, `${phon}/${reference}: doublings`);
      assert.equal(result.lowNote, phon < 40, `${phon}: low-level flag`);
      assert.equal(result.deltaText.startsWith('\u2212'), phon < reference, `${phon}/${reference}: sign`);
      assert.match(result.relativeText, /^(same loudness \(\u00d71\)|\u00d7[\d.]+ (louder|quieter) \([\d.]+ doubling(s)?\))$/,
        `${phon}/${reference}: wording`);
      assert.equal(result.doubleText, phon + 10 > 140 ? 'past 140 phon' : `${phon + 10} phon`);
      assert.equal(result.halfText, phon - 10 < 0 ? 'none, below 0 phon' : `${phon === 0 ? '0' : phon - 10} phon`);
      const inverseLevel = run(result.soneText === '0.063' ? '0.0625' : String(result.sone), 'sone', String(reference));
      near(inverseLevel.phon, phon, 1e-3, `${phon}: entering the sone figure returns the level`);
      checked += 1;
    }
  }
  assert.ok(checked >= 280, `checked ${checked} sweeps`);
}

// ---- Boundary shapes.
{
  assert.equal(run('0', 'phon', '40').relativeText, '\u00d70.063 quieter (4 doublings)');
  assert.equal(run('140', 'phon', '0').relativeText, '\u00d716384 louder (14 doublings)');
  assert.equal(run('40', 'phon', '40').relativeText, 'same loudness (\u00d71)');
  assert.equal(run('60', 'phon', '80').relativeText, '\u00d70.25 quieter (2 doublings)');
  assert.equal(run('73.2', 'phon', '40').phonText, '73.2');
  assert.equal(run('73.2', 'phon', '40').doubleText, '83.2 phon');
  assert.equal(run('73.2', 'phon', '40').halfText, '63.2 phon');
  near(run('0.1', 'sone', '0').phon, 6.8, 0.05, '0.1 sone is about 7 phon');
}

// ---- Refusals, by exact message.
const refusal = (input, message) => assert.throws(() => C.analyse(input),
  (error) => { assert.equal(error.message, message); return true; }, `expected "${message}"`);
const base = { value: '70', unit: 'phon', reference: '40' };
refusal({ ...base, value: '' }, 'Loudness level is required.');
refusal({ ...base, value: '   ' }, 'Loudness level is required.');
refusal({ ...base, value: 'loud' }, 'Loudness level must be a number.');
refusal({ ...base, value: '70.5.5' }, 'Loudness level must be a number.');
refusal({ ...base, value: '7O' }, 'Loudness level must be a number.');
refusal({ ...base, value: '-5' }, 'Loudness level must be at least 0 phon, the threshold of hearing.');
refusal({ ...base, value: '140.1' }, 'Loudness level must be 140 phon or less.');
refusal({ ...base, value: '500' }, 'Loudness level must be 140 phon or less.');
refusal({ ...base, unit: 'decibel' }, 'Choose whether the value is a loudness level or a loudness.');
refusal({ ...base, unit: '' }, 'Choose whether the value is a loudness level or a loudness.');
refusal({ ...base, unit: 'sone', value: '' }, 'Loudness is required.');
refusal({ ...base, unit: 'sone', value: '0' }, 'Loudness must be more than 0 sone.');
refusal({ ...base, unit: 'sone', value: '0.0' }, 'Loudness must be more than 0 sone.');
refusal({ ...base, unit: 'sone', value: '-0.5' }, 'Loudness must be more than 0 sone.');
refusal({ ...base, unit: 'sone', value: '0.01' }, 'Loudness must be at least 0.0625 sone, which is 0 phon.');
refusal({ ...base, unit: 'sone', value: '1024.5' }, 'Loudness must be 1024 sone or less, which is 140 phon.');
refusal({ ...base, unit: 'sone', value: '2000' }, 'Loudness must be 1024 sone or less, which is 140 phon.');
refusal({ ...base, reference: '' }, 'Reference loudness level is required.');
refusal({ ...base, reference: 'loud' }, 'Reference loudness level must be a number.');
refusal({ ...base, reference: '-1' }, 'Reference loudness level must be at least 0 phon, the threshold of hearing.');
refusal({ ...base, reference: '150' }, 'Reference loudness level must be 140 phon or less.');

// ---- Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2127, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Phon to Sone Loudness Converter');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1F509}');
assert.ok(typeof record.description === 'string' && record.description.length > 80, 'description present');
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.sources) && record.sources.length === 2, 'two cited sources');
for (const source of ['Sone', 'Phon']) {
  assert.ok(record.sources.some((entry) => entry.url === `https://en.wikipedia.org/wiki/${source}`),
    `the ${source} reference is cited with its URL`);
  assert.ok(record.sources.some((entry) => entry.title.length > 80), 'each source is described specifically');
}
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 12, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 8, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.testCases.length >= 20, `expected at least 20 cases, found ${record.testCases.length}`);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 51, 'Audio count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
  for (const alias of other.aliases || []) {
    assert.ok(!record.aliases.map((value) => value.toLowerCase()).includes(alias.toLowerCase()),
      `alias collides with an alias of ${other.slug}`);
  }
}

const numeric = (value) => typeof value === 'number';
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.analyse(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (field === 'ratio') {
      assert.ok(numeric(result.ratio) && Math.abs(result.ratio - value) < 1e-6, `${label}: ratio ${result.ratio} vs ${value}`);
    } else {
      assert.equal(result[field], value, `${label}: ${field}`);
    }
  }
}

// ---- Page contract: one input, one action, a live result, no network or storage.
assert.match(html, /<label class="f" for="in-value">Value<\/label>/, 'value label');
assert.match(html, /<label class="f" for="in-unit">Value is a<\/label>/, 'unit label');
assert.match(html, /<label class="f" for="in-reference">Reference loudness level<\/label>/, 'reference label');
assert.match(html, /<button type="submit">Convert the loudness<\/button>/, 'submit button');
assert.match(html, /<button type="button" class="ghost" id="reset">Reset<\/button>/, 'reset button');
assert.match(html, /id="out" aria-live="polite"/, 'live result region');
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /<th scope="col">Loudness level<\/th><th scope="col">Loudness<\/th>/, 'ladder headings');
assert.match(html, /<h1>Phon to Sone Loudness Converter<\/h1>/, 'headline matches the catalog name');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
assert.ok(!/innerHTML/.test(html), 'no markup injection');

console.log('phon sone loudness converter: all checks passed');
