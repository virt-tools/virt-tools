/* Yarn count converter: independently derived conversion factors, reference
   counts worked from the hank definitions, plied-yarn linearity, range and
   validation behaviour, catalog replay, and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'yarn-count-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* yarn-count-core:start */';
const endMarker = '/* yarn-count-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = YarnCountCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (value, unit, plies) => plain(C.parse(value, unit, plies === undefined ? '1' : plies));
const failure = (value, unit, plies) => {
  try { run(value, unit, plies); } catch (error) { return error.message; }
  return null;
};
const texts = (result) => result.rows.map((row) => row.text);
const ROW_ORDER = ['tex', 'dtex', 'denier', 'nm', 'ne', 'worsted', 'woolen', 'linen'];

// ---- Exported contract.
assert.equal(C.GRAMS_PER_POUND, 453.59237, 'exact grams per pound');
assert.equal(C.METRES_PER_YARD, 0.9144, 'exact metres per yard');
assert.equal(C.MIN_TEX, 0.01);
assert.equal(C.MAX_TEX, 10000);
assert.equal(C.MIN_PLIES, 1);
assert.equal(C.MAX_PLIES, 96);
assert.equal(C.SIGNIFICANT_DIGITS, 3);
assert.equal(C.DEFAULT_VALUE, '30');
assert.equal(C.DEFAULT_UNIT, 'nm');
assert.equal(C.DEFAULT_PLIES, '1');
assert.deepEqual(plain(C.UNITS.map((unit) => unit.id)), ROW_ORDER, 'row order');
assert.deepEqual(plain(C.UNITS.map((unit) => unit.kind)),
  ['direct', 'direct', 'direct', 'indirect', 'indirect', 'indirect', 'indirect', 'indirect']);

// ---- One tex is 1 g/1,000 m, so dtex = 10 tex and denier = 9 tex; the metric
// count is 1,000 m per 1 kg. The imperial counts come from the yard and pound
// definitions and must land on the six-figure ASTM D2260 factors.
assert.equal(C.texPerPly(1, C.unitOf('tex')), 1);
assert.equal(C.texPerPly(1, C.unitOf('dtex')), 0.1);
assert.ok(Math.abs(C.texPerPly(9, C.unitOf('denier')) - 1) < 1e-12, '9 denier is 1 tex');
assert.equal(C.unitOf('nm').factor, 1000);
const ASTM = { ne: 590.541, worsted: 0.885812 * 1000, woolen: 0.310034 * 1000, linen: 1.65352 * 1000 };
for (const [id, expected] of Object.entries(ASTM)) {
  const computed = C.unitOf(id).factor;
  /* ASTM prints these factors to six significant figures, so the exact
     derivation agrees to within one unit in the last printed place. */
  assert.ok(Math.abs(computed - expected) / expected < 1e-5, id + ' factor matches ASTM D2260: ' + computed);
}
// The factor is 1,000 x 453.59237 / (hanks x 0.9144), so one hank of a count-1
// yarn must weigh exactly one pound.
for (const [id, hanks] of Object.entries({ ne: 840, worsted: 560, woolen: 1600, linen: 300 })) {
  const gramsPerHank = C.unitOf(id).factor * hanks * C.METRES_PER_YARD / 1000;
  assert.ok(Math.abs(gramsPerHank - C.GRAMS_PER_POUND) < 1e-9, id + ' count 1 is one pound per hank');
}
assert.equal(C.unitOf('nonsense'), null);
assert.equal(C.unitOf('DENIER').id, 'denier');

// ---- Three significant figures, half up, thousands separated.
assert.equal(C.format(33.333333), '33.3');
assert.equal(C.format(300), '300');
assert.equal(C.format(0.0999999), '0.1');
assert.equal(C.format(265.5), '266', 'an exact half rounds up');
assert.equal(C.format(0.09), '0.09');
assert.equal(C.format(59054.1247), '59,054');
assert.equal(C.format(100000), '100,000');
assert.equal(C.format(1), '1');
assert.equal(C.format(9.995), '10', 'rounding can reach the next magnitude');
assert.equal(C.format(0), '0');

// ---- Reference counts, each figure worked from the hank definitions.
const REFERENCE = [
  ['30', 'nm', '1', '33.3 tex',
    ['33.3 tex', '333 dtex', '300 den', '30 Nm', '17.7 Ne', '26.6 NeK', '9.3 NeS', '49.6 NeL']],
  ['28', 'nm', '2', '71.4 tex',
    ['71.4 tex', '714 dtex', '643 den', '14 Nm', '8.27 Ne', '12.4 NeK', '4.34 NeS', '23.1 NeL']],
  ['20', 'ne', '1', '29.5 tex',
    ['29.5 tex', '295 dtex', '266 den', '33.9 Nm', '20 Ne', '30 NeK', '10.5 NeS', '56 NeL']],
  ['30', 'tex', '1', '30 tex',
    ['30 tex', '300 dtex', '270 den', '33.3 Nm', '19.7 Ne', '29.5 NeK', '10.3 NeS', '55.1 NeL']],
  ['150', 'denier', '1', '16.7 tex',
    ['16.7 tex', '167 dtex', '150 den', '60 Nm', '35.4 Ne', '53.1 NeK', '18.6 NeS', '99.2 NeL']],
  ['30', 'worsted', '2', '59.1 tex',
    ['59.1 tex', '591 dtex', '531 den', '16.9 Nm', '10 Ne', '15 NeK', '5.25 NeS', '28 NeL']],
  ['40', 'linen', '2', '82.7 tex',
    ['82.7 tex', '827 dtex', '744 den', '12.1 Nm', '7.14 Ne', '10.7 NeK', '3.75 NeS', '20 NeL']],
  ['8', 'woolen', '1', '38.8 tex',
    ['38.8 tex', '388 dtex', '349 den', '25.8 Nm', '15.2 Ne', '22.9 NeK', '8 NeS', '42.7 NeL']],
  ['100', 'ne', '1', '5.91 tex',
    ['5.91 tex', '59.1 dtex', '53.1 den', '169 Nm', '100 Ne', '150 NeK', '52.5 NeS', '280 NeL']],
  ['20', 'ne', '4', '118 tex',
    ['118 tex', '1,181 dtex', '1,063 den', '8.47 Nm', '5 Ne', '7.5 NeK', '2.63 NeS', '14 NeL']],
];
for (const [value, unit, plies, metric, rows] of REFERENCE) {
  const result = run(value, unit, plies);
  assert.equal(result.metric, metric, value + ' ' + unit + ' x ' + plies);
  assert.deepEqual(texts(result), rows, 'rows for ' + value + ' ' + unit + ' x ' + plies);
}

// The plied sentence must name the resultant count in the entered system.
assert.equal(run('28', 'nm', '2').subText, '2 plies of 28 Nm \u00b7 14 Nm resultant');
assert.equal(run('150', 'denier', '2').subText, '2 plies of 150 den \u00b7 300 den resultant');
assert.equal(run('30', 'nm').subText, 'Entered as 30 Nm (metres per gram)');
assert.equal(run('20', 'ne').fromText, '20 Ne');
assert.equal(run('20', 'ne').unitLabel, 'Ne');

// ---- Plies multiply the mass per length and therefore divide an indirect count.
for (const [value, unit] of [['30', 'nm'], ['20', 'ne'], ['2.5', 'tex'], ['150', 'denier']]) {
  const single = run(value, unit, '1');
  for (const plies of [2, 3, 4, 7]) {
    const folded = run(value, unit, String(plies));
    assert.ok(Math.abs(folded.tex - single.tex * plies) < single.tex * plies * 1e-12, 'plies scale tex');
    assert.equal(folded.texText, folded.metric.replace(' tex', ''), 'headline echoes the tex value');
  }
}
// Four plies of 20 Ne behave as 5 Ne.
assert.equal(run('20', 'ne', '4').rows.find((row) => row.id === 'ne').text, '5 Ne');

// ---- A larger indirect count is a finer yarn; a larger direct count is thicker.
let previousTex = Infinity;
for (const count of [1, 2, 5, 10, 20, 30, 60, 120, 300, 600]) {
  const tex = run(String(count), 'ne').tex;
  assert.ok(tex < previousTex, 'cotton counts fall in tex as the count rises');
  previousTex = tex;
}
let previousDirect = 0;
for (const count of [1, 2, 5, 10, 20, 50]) {
  const tex = run(String(count), 'tex').tex;
  assert.ok(tex > previousDirect, 'tex rises with the count');
  previousDirect = tex;
}

// ---- Range edges, including a boundary written in another unit.
assert.equal(run('0.01', 'tex').metric, '0.01 tex');
assert.equal(run('10000', 'tex').metric, '10,000 tex');
assert.equal(run('0.09', 'denier').metric, '0.01 tex', 'the denier floor is not refused by binary error');
assert.equal(run('100000', 'nm').metric, '0.01 tex');
assert.equal(run('0.1', 'nm').metric, '10,000 tex');
assert.equal(failure('0.04', 'denier'),
  'That is finer than 0.01 tex (0.09 denier), the finest yarn this converter covers.');
assert.equal(failure('0.05', 'nm'),
  'That is coarser than 10,000 tex (90,000 denier), the coarsest yarn this converter covers.');
assert.equal(failure('2', 'nm', '96'),
  'That is coarser than 10,000 tex (90,000 denier), the coarsest yarn this converter covers.');

// ---- Validation messages.
assert.equal(failure('', 'nm'), 'Enter a yarn count to convert.');
assert.equal(failure('   ', 'nm'), 'Enter a yarn count to convert.');
assert.equal(failure(null, 'nm'), 'Enter a yarn count to convert.');
assert.equal(failure('thirty', 'nm'), 'Enter the count as a number, such as 30 or 29.5.');
assert.equal(failure('30 Nm', 'nm'), 'Enter the count as a number, such as 30 or 29.5.');
assert.equal(failure('1,20', 'nm'), 'Enter the count as a number, such as 30 or 29.5.');
assert.equal(failure('1e3', 'nm'), 'Enter the count as a number, such as 30 or 29.5.');
assert.equal(failure('30.', 'nm'), 'Enter the count as a number, such as 30 or 29.5.');
assert.equal(failure('0', 'nm'), 'Enter a count greater than zero.');
assert.equal(failure('-5', 'nm'), 'Enter a count greater than zero.');
assert.equal(run('1,200', 'ne').metric, run('1200', 'ne').metric, 'grouped thousands are accepted');
assert.ok(/Choose the system/.test(failure('30', 'furlongs')), 'unknown systems are named');
assert.equal(failure('30', 'nm', '2.5'), 'Enter the number of plies as a whole number from 1 to 96.');
assert.equal(failure('30', 'nm', '0'), 'Enter the number of plies as a whole number from 1 to 96.');
assert.equal(failure('30', 'nm', '97'), 'Enter the number of plies as a whole number from 1 to 96.');
assert.equal(failure('30', 'nm', 'two'), 'Enter the number of plies as a whole number from 1 to 96.');
assert.equal(failure('30', 'nm', '-1'), 'Enter the number of plies as a whole number from 1 to 96.');
assert.equal(run('30', 'nm', '').plies, 1, 'a blank ply field means a single ply');

// ---- Random counts: the printed rows must agree with the exact relationships.
let seed = 20261113;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const unformat = (text) => Number(text.replace(/[^\d.]/g, ''));
const SYSTEMS = ROW_ORDER;
for (let iteration = 0; iteration < 300; iteration += 1) {
  const unit = SYSTEMS[iteration % SYSTEMS.length];
  const direct = ['tex', 'dtex', 'denier'].includes(unit);
  const places = iteration % 4;
  const raw = direct ? (0.5 + random() * 300).toFixed(places) : (0.5 + random() * 400).toFixed(places);
  const plies = 1 + (iteration % 4);
  const label = raw + ' ' + unit + ' x ' + plies;
  const result = run(raw, unit, String(plies));
  assert.equal(result.rows.length, 8, label + ' eight systems');
  assert.deepEqual(result.rows.map((row) => row.id), ROW_ORDER, label + ' row order');
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const tex = result.tex;
  /* Printed rows carry three significant figures, so a printed count can sit
     up to half a unit of its last printed digit away from the exact value:
     under 0.5 percent at three digits, up to about 1.7 percent when a value
     such as 0.031 prints with only two. Two percent covers both. */
  const near = (actual, expected, name) => {
    assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * 0.02, label + ' ' + name + ' ' + actual + ' vs ' + expected);
  };
  near(unformat(byId.get('dtex').text), tex * 10, 'dtex');
  near(unformat(byId.get('denier').text), tex * 9, 'denier');
  near(unformat(byId.get('nm').text) * tex, 1000, 'Nm');
  near(unformat(byId.get('ne').text) * tex, 590.541, 'cotton factor');
  near(unformat(byId.get('worsted').text) * tex, 885.812, 'worsted factor');
  near(unformat(byId.get('linen').text) * tex, 1653.52, 'linen factor');
  near(unformat(byId.get('woolen').text) * tex, 310.034, 'woolen factor');
  assert.equal(result.texText, byId.get('tex').text.replace(' tex', ''), label + ' headline');
  // Converting the resultant tex back into the entry system returns the
  // resultant count in that system, which is the entry scaled by the plies.
  const back = run(result.texText, 'tex', '1').rows.find((row) => row.id === unit);
  const resultant = direct ? Number(raw) * plies : Number(raw) / plies;
  near(unformat(back.text), resultant, 'round trip through tex');
  assert.deepEqual(run(raw, unit, String(plies)), result, label + ' deterministic');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2266, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Yarn Count Converter');
assert.equal(record.category, 'Converters');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f9f6}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('453.59237'), 'method states the exact pound');
assert.ok(record.method.includes('0.9144'), 'method states the exact yard');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 4, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 29, 'catalog case count');
assert.equal(kinds('golden'), 15, 'fifteen golden cases');
assert.equal(kinds('validation'), 14, 'fourteen validation cases');
for (const testCase of record.testCases) {
  const { value, unit, plies } = testCase.input;
  if (testCase.expected.error) {
    assert.equal(failure(value, unit, plies), testCase.expected.error, testCase.name);
    continue;
  }
  const result = run(value, unit, plies);
  assert.equal(result.metric, testCase.expected.metric, testCase.name + ' metric');
  assert.equal(result.subText, testCase.expected.subText, testCase.name + ' subText');
  assert.equal(result.texText, testCase.expected.texText, testCase.name + ' texText');
  const published = result.rows.map((row) => ({ id: row.id, label: row.label, note: row.note, text: row.text }));
  assert.deepEqual(published, testCase.expected.rows, testCase.name + ' rows');
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
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['yarn', 'yarn-count', 'denier', 'linear-density', 'textile']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const id of ['count', 'unit', 'plies']) {
  assert.ok(html.includes('<label for="' + id + '">'), 'control has a visible label: ' + id);
}
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status"/.test(html), 'copy feedback is announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html) && /inputmode="numeric"/.test(html), 'numeric keyboards on touch');
assert.equal((html.match(/<option value="/g) || []).length, 8, 'eight systems in the picker');
for (const id of ROW_ORDER) {
  assert.ok(html.includes('<option value="' + id + '"'), 'system option present: ' + id);
}
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('yarn count converter: 10 reference counts, 300 random conversions, 29 catalog cases and the page contract pass');
