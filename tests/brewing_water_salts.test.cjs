/* Brewing water salt additions: the published per-gallon contributions, the
   stoichiometry and hydrate assumptions, scaling and unit invariants, refused
   inputs, randomised identities, catalogue replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'brewing-water-salts';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* brewing-water-core:start */';
const endMarker = '/* brewing-water-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BrewingWaterCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const compute = (settings) => plain(C.compute(settings));
const failure = (settings) => {
  try { compute(settings); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} is not within ${tolerance} of ${expected}`);
};

// ---- Published figures per gram per US gallon. Brew Your Own prints ranges for
// gypsum, calcium chloride and Epsom salt; the baking soda and table salt values
// are the standard brewing-table entries and follow the same stoichiometry. The
// article states its ranges to the whole ppm, so allow half a ppm of rounding.
const PUBLISHED_SLACK = 0.5;
const published = {
  gypsum: { calcium: [60, 62], sulfate: [145, 147] },
  calciumChloride: { calcium: [70, 72], chloride: [125, 127] },
  epsom: { magnesium: [24, 26], sulfate: [101, 103] }
};
for (const [salt, ions] of Object.entries(published)) {
  for (const [ion, [low, high]] of Object.entries(ions)) {
    const value = C.perGallon(salt, ion);
    assert.ok(value >= low - PUBLISHED_SLACK && value <= high + PUBLISHED_SLACK,
      `${salt} ${ion} = ${value} outside ${low}-${high}`);
  }
}
close(C.perGallon('tableSalt', 'sodium'), 103.9, 0.2, 'table salt sodium');
close(C.perGallon('tableSalt', 'chloride'), 160.3, 0.2, 'table salt chloride');
close(C.perGallon('bakingSoda', 'sodium'), 72.3, 0.2, 'baking soda sodium');
close(C.perGallon('bakingSoda', 'bicarbonate'), 191.9, 0.2, 'baking soda bicarbonate');
assert.equal(C.perGallon('gypsum', 'magnesium'), 0, 'gypsum carries no magnesium');
assert.equal(C.perGallon('epsom', 'calcium'), 0, 'Epsom salt carries no calcium');
assert.equal(C.perGallon('tableSalt', 'sulfate'), 0, 'table salt carries no sulfate');

// ---- The salts are the hydrates brewing suppliers sell, not the anhydrous forms.
const molar = (key) => C.SALTS.find((salt) => salt.key === key).molar;
close(molar('gypsum'), 172.164, 0.001, 'gypsum molar mass');
close(molar('calciumChloride'), 147.008, 0.001, 'calcium chloride dihydrate molar mass');
close(molar('epsom'), 246.466, 0.001, 'Epsom salt heptahydrate molar mass');
close(molar('tableSalt'), 58.44, 0.001, 'table salt molar mass');
close(molar('bakingSoda'), 84.006, 0.001, 'baking soda molar mass');
// Anhydrous calcium chloride (110.98 g/mol) would report 95 ppm calcium from one
// gram in a gallon; the page must report the dihydrate's 72.
assert.ok(Math.abs(C.perGallon('calciumChloride', 'calcium') - 95.4) > 20, 'anhydrous form is not assumed');

// ---- The page example, every field of it.
const example = compute({ volume: '20', unit: 'l', gypsum: '5', calciumChloride: '2' });
assert.deepEqual(example, {
  volumeLitres: 20, unit: 'l',
  start: { calcium: 0, magnesium: 0, sodium: 0, chloride: 0, sulfate: 0, bicarbonate: 0 },
  added: { calcium: 85.5, magnesium: 0, sodium: 0, chloride: 48.2, sulfate: 139.5, bicarbonate: 0 },
  calcium: 85.5, magnesium: 0, sodium: 0, chloride: 48.2, sulfate: 139.5, bicarbonate: 0,
  hardness: 213.4, alkalinity: 0, ratio: 2.89, saltsGrams: 7,
  contributions: [
    { key: 'gypsum', name: 'Gypsum', formula: 'CaSO4.2H2O', grams: 5, ions: { calcium: 58.2, sulfate: 139.5 } },
    { key: 'calciumChloride', name: 'Calcium chloride', formula: 'CaCl2.2H2O', grams: 2,
      ions: { calcium: 27.3, chloride: 48.2 } }
  ]
});

// ---- One gram per gallon is one gram per gallon whether the batch is one gallon
// or fifty: the same dose rate must give the same concentrations.
for (const gallons of [1, 5, 15, 50]) {
  const result = compute({ volume: String(gallons), unit: 'gal', gypsum: String(gallons) });
  close(result.calcium, 61.5, 0.05, `${gallons} gal gypsum calcium`);
  close(result.sulfate, 147.4, 0.05, `${gallons} gal gypsum sulfate`);
}
// The same dose in litres scales inversely with the volume. The rows are rounded to
// one decimal, so the comparison allows the rounding to be amplified by the factor.
const oneLitre = compute({ volume: '1', gypsum: '1' });
const tenLitres = compute({ volume: '10', gypsum: '1' });
close(oneLitre.calcium, tenLitres.calcium * 10, 2, 'ppm scales with 1/volume');
close(oneLitre.sulfate, tenLitres.sulfate * 10, 2, 'sulfate scales with 1/volume');
close(oneLitre.hardness, tenLitres.hardness * 10, 5, 'hardness scales with 1/volume');

// ---- A starting profile is added to the contributions, not replaced by them.
const profile = compute({ volume: '20', calcium: '40', magnesium: '8', chloride: '20', bicarbonate: '90' });
assert.deepEqual(profile.start, { calcium: 40, magnesium: 8, sodium: 0, chloride: 20, sulfate: 0, bicarbonate: 90 });
assert.deepEqual(profile.added, { calcium: 0, magnesium: 0, sodium: 0, chloride: 0, sulfate: 0, bicarbonate: 0 });
assert.equal(profile.calcium, 40);
assert.equal(profile.bicarbonate, 90);
const withSalt = compute({ volume: '20', calcium: '40', gypsum: '5' });
close(withSalt.calcium, 40 + 58.2, 0.05, 'starting calcium plus the gypsum contribution');

// ---- Hardness and alkalinity as calcium carbonate equivalents: 100 ppm calcium is
// 249.7, 10 ppm magnesium is 41.2 and 100 ppm bicarbonate is 82.0 as CaCO3.
close(compute({ volume: '20', calcium: '100' }).hardness, 249.7, 0.2, 'calcium hardness');
close(compute({ volume: '20', magnesium: '10' }).hardness, 41.2, 0.2, 'magnesium hardness');
close(compute({ volume: '20', bicarbonate: '100' }).alkalinity, 82.0, 0.2, 'bicarbonate alkalinity');
assert.equal(compute({ volume: '20', sulfate: '100' }).hardness, 0, 'sulfate adds no hardness');
assert.equal(compute({ volume: '20', sodium: '100' }).hardness, 0, 'sodium adds no hardness');

// ---- The sulfate to chloride ratio needs chloride, and comes from the exact
// concentrations rather than the one-decimal display.
assert.equal(compute({ volume: '20', sulfate: '150' }).ratio, null, 'no chloride means no ratio');
assert.equal(compute({ volume: '20' }).ratio, null, 'an empty water has no ratio');
const balanced = compute({ volume: '20', sulfate: '100', chloride: '100' });
assert.equal(balanced.ratio, 1);
assert.equal(compute({ volume: '20', sulfate: '300', chloride: '100' }).ratio, 3);
const uneven = compute({ volume: '20', chloride: '3.3', sulfate: '100' });
close(uneven.ratio, 100 / 3.3, 0.01, 'the ratio uses exact ppm, not the rounded row');

// ---- Nothing entered is a legitimate starting profile, not an error.
const empty = compute({ volume: '20' });
assert.equal(empty.saltsGrams, 0);
assert.equal(empty.ratio, null);
assert.deepEqual(empty.contributions, []);
assert.equal(empty.calcium, 0);

// ---- Boundaries the page accepts.
assert.equal(compute({ volume: '0.1', gypsum: '0.001' }).volumeLitres, 0.1);
assert.equal(compute({ volume: '10000' }).volumeLitres, 10000);
assert.equal(compute({ volume: '2600', unit: 'gal' }).saltsGrams, 0);
assert.equal(compute({ volume: '20', gypsum: '1000' }).saltsGrams, 1000);
assert.equal(compute({ volume: '20', calcium: '2000' }).calcium, 2000);
assert.equal(compute({ volume: '20', gypsum: '0' }).saltsGrams, 0, 'zero grams is an empty dose');

// ---- Refusals, message by message.
const refusals = [
  [{ volume: '' }, 'Enter the water volume.'],
  [{ volume: '   ' }, 'Enter the water volume.'],
  [{ volume: '0' }, 'Enter a water volume from 0.1 to 10,000 litres.'],
  [{ volume: '10001' }, 'Enter a water volume from 0.1 to 10,000 litres.'],
  [{ volume: '2700', unit: 'gal' }, 'Enter a water volume from 0.1 to 2,600 US gallons.'],
  [{ volume: 'twenty' }, 'Enter the water volume as a number with up to three decimals.'],
  [{ volume: '-5' }, 'Enter the water volume as a number with up to three decimals.'],
  [{ volume: '2e1' }, 'Enter the water volume as a number with up to three decimals.'],
  [{ volume: '20', unit: 'pints' }, 'Choose litres or US gallons for the water volume.'],
  [{ volume: '20', gypsum: '1001' }, 'Enter 0 to 1,000 grams of gypsum.'],
  [{ volume: '20', gypsum: '-1' }, 'Enter gypsum as a number with up to three decimals.'],
  [{ volume: '20', calciumChloride: '1.2345' }, 'Enter calcium chloride as a number with up to three decimals.'],
  [{ volume: '20', epsom: 'heavy' }, 'Enter epsom salt as a number with up to three decimals.'],
  [{ volume: '20', tableSalt: '2000' }, 'Enter 0 to 1,000 grams of table salt.'],
  [{ volume: '20', bakingSoda: '2001' }, 'Enter 0 to 1,000 grams of baking soda.'],
  [{ volume: '20', calcium: '2001' }, 'Enter 0 to 2,000 ppm for calcium.'],
  [{ volume: '20', magnesium: '-5' }, 'Enter magnesium as a number with up to three decimals.'],
  [{ volume: '20', sodium: '2,5' }, 'Enter sodium as a number with up to three decimals.'],
  [{ volume: '20', chloride: '1.2345' }, 'Enter chloride as a number with up to three decimals.'],
  [{ volume: '20', sulfate: '' , bicarbonate: '2001' }, 'Enter 0 to 2,000 ppm for bicarbonate.']
];
for (const [settings, message] of refusals) {
  assert.equal(failure(settings), message, 'message: ' + message);
}
// Numbers are accepted directly, so a sweep that passes 21 for 21 does not trip
// the string pattern.
assert.equal(compute({ volume: 20, gypsum: 5 }).calcium, 58.2, 'numeric volume accepted');
assert.equal(compute({ volume: '20', gypsum: 5 }).saltsGrams, 5, 'numeric dose accepted');

// ---- Randomised invariants: the final water is the starting profile plus the
// contributions, the contributions add up to the added column, and the ratio
// agrees with the exact sulfate to chloride quotient.
let seed = 20261116;
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
  return seed / 0x80000000;
};
const roundTo = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.round(value * factor + (value < 0 ? -1e-9 : 1e-9)) / factor;
};
assert.equal(roundTo(82.85, 1), 82.9, 'the rounding helper is half away from zero');
assert.equal(roundTo(238.95, 1), 239);
let checked = 0;
for (let trial = 0; trial < 300; trial += 1) {
  const unit = random() < 0.3 ? 'gal' : 'l';
  const volume = roundTo(1 + random() * 300, 3);
  const settings = { volume: String(volume), unit };
  const start = {};
  for (const ion of C.IONS) {
    const value = random() < 0.6 ? roundTo(random() * 250, 2) : 0;
    start[ion] = value;
    settings[ion] = value ? String(value) : '';
  }
  let salts = 0;
  for (const salt of C.SALTS) {
    const grams = random() < 0.7 ? roundTo(random() * 60, 3) : 0;
    settings[salt.key] = grams ? String(grams) : '';
    salts += grams;
  }
  const result = compute(settings);
  close(result.saltsGrams, salts, 0.0005, `total salts trial ${trial}`);
  const summed = { calcium: 0, magnesium: 0, sodium: 0, chloride: 0, sulfate: 0, bicarbonate: 0 };
  for (const entry of result.contributions) {
    for (const [ion, ppm] of Object.entries(entry.ions)) summed[ion] += ppm;
  }
  for (const ion of C.IONS) {
    close(summed[ion], result.added[ion], 0.11, `${ion} contributions add up, trial ${trial}`);
    close(result[ion], start[ion] + result.added[ion], 0.11, `${ion} final = start + added, trial ${trial}`);
    assert.ok(Number.isFinite(result[ion]) && result[ion] >= 0, `${ion} is a finite concentration, trial ${trial}`);
    checked += 1;
  }
  close(result.hardness, result.calcium * 2.497 + result.magnesium * 4.118,
    Math.max(0.6, (result.calcium + result.magnesium) * 0.002), `hardness identity, trial ${trial}`);
  close(result.alkalinity, result.bicarbonate * 0.8200,
    Math.max(0.3, result.bicarbonate * 0.002), `alkalinity identity, trial ${trial}`);
  if (result.chloride === 0) {
    assert.equal(result.ratio, null, `no ratio without chloride, trial ${trial}`);
  } else {
    assert.ok(Number.isFinite(result.ratio), `ratio is finite, trial ${trial}`);
  }
  // Doubling every dose at the same volume doubles the contributions.
  if (salts > 0) {
    const doubled = { ...settings };
    for (const salt of C.SALTS) {
      if (settings[salt.key] === '') continue;
      doubled[salt.key] = String(roundTo(Number(settings[salt.key]) * 2, 3));
    }
    const twice = compute(doubled);
    for (const ion of C.IONS) {
      if (start[ion] > 0) continue;
      close(twice[ion], result[ion] * 2, 0.2, `${ion} doubles with the dose, trial ${trial}`);
    }
  }
}

// ---- Catalogue record: 19 cases, replayed against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2172, 'public tools');
assert.ok(catalog.tools.some((tool) => tool.slug === slug), 'the new record is present');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.equal(entry.name, 'Brewing Water Salt Additions');
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.includes('browser'), 'method documents local execution');
assert.ok(entry.method.includes('stoichiometric'), 'method states the arithmetic');
assert.ok(entry.method.includes('dihydrate'), 'method names the hydrate form');
assert.ok(entry.method.includes('CaCO3'), 'method states the hardness convention');
assert.ok(entry.description.length > 120, 'description is descriptive');
assert.ok(entry.sources.length >= 2, 'sources are cited');
for (const source of entry.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(entry.sources.some((source) => source.url.includes('byo.com')), 'the published salt table is cited');
assert.ok(entry.sources.some((source) => source.url.includes('ciaaw.org')), 'the atomic weights are cited');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(entry.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
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
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['food', 'brewing', 'water']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: labelled controls, no storage or network, ASCII source.
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
const controlIds = [...markup.matchAll(/<(?:input|select)\b[^>]*\sid="([^"]+)"/g)].map((match) => match[1]);
assert.ok(controlIds.length >= 12, 'every control is in the markup');
for (const id of controlIds) {
  assert.ok(new RegExp(`<label for="${id}">`).test(markup), 'control has a visible label: ' + id);
}
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'refusals are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/<form id="salt-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/<button type="submit">Calculate<\/button>/.test(html), 'the action button submits');
assert.ok(/<button type="button" class="ghost" id="example">/.test(html), 'the example button is typed');
assert.ok(/<button type="button" class="ghost" id="clear">/.test(html), 'the clear button is typed');
assert.ok(/role="alert" aria-live="polite"/.test(html), 'the error line is announced');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(html), 'the page source stays ASCII');
assert.ok(/@media \(max-width:560px\)/.test(html), 'a phone layout is defined');

console.log('brewing water salts: published per-gallon contributions, hydrate and stoichiometry ' +
  'checks, 300 randomised waters with ' + checked + ' concentration identities, 19 catalogue cases ' +
  'and the page contract pass');
