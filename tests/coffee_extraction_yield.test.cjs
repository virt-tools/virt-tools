/* Regression checks for the coffee extraction yield core, its catalog cases,
   randomised arithmetic and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'coffee-extraction-yield';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* coffee-extraction-core:start */');
const end = html.indexOf('/* coffee-extraction-core:end */');
assert.ok(start > -1 && end > start, 'coffee extraction core markers missing');
const core = html.slice(start, end + '/* coffee-extraction-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CoffeeExtractionCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.solve(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Field contract.
assert.deepEqual(plain(C.EY_IDEAL), { low: 18, high: 22 });
assert.deepEqual(plain(C.LIMITS), { dose: 1000, beverage: 5000, tds: 30, water: 5000 });
assert.equal(C.extractionBand(17.999), 'under');
assert.equal(C.extractionBand(18), 'ideal');
assert.equal(C.extractionBand(22), 'ideal');
assert.equal(C.extractionBand(22.001), 'over');
assert.equal(C.strengthBand(0.5), 'light');
assert.equal(C.strengthBand(1), 'filter');
assert.equal(C.strengthBand(1.45), 'filter');
assert.equal(C.strengthBand(2), 'strong');
assert.equal(C.strengthBand(6), 'very strong');
assert.equal(C.strengthBand(9), 'espresso');
assert.equal(C.strengthBand(12), 'espresso');
assert.equal(C.strengthBand(12.01), 'concentrate');

// ---- One shot, the basic identity: EY = TDS x beverage / dose.
const espresso = run({ dose: 18, beverage: 36, tds: 9 });
assert.equal(espresso.dissolvedSolids, 3.24);
assert.equal(espresso.extractionYield, 18);
assert.equal(espresso.beverageRatio, 2);
assert.equal(espresso.brewRatio, null, 'no water means no brew ratio');
assert.equal(espresso.waterRetained, null);
assert.equal(espresso.extractionBand, 'ideal');
assert.equal(espresso.strengthBand, 'espresso');

// ---- Optional brew water produces the ratio and the retained water.
const pourover = run({ dose: 15, beverage: 225, tds: 1.35, water: 250 });
assert.equal(pourover.dissolvedSolids, 3.038);
assert.equal(pourover.extractionYield, 20.25);
assert.equal(pourover.beverageRatio, 15);
assert.equal(pourover.brewRatio, 16.667);
assert.equal(pourover.waterRetained, 25);
assert.equal(pourover.strengthBand, 'filter');

// ---- Empty, blank and absent water all mean "not supplied".
for (const water of [undefined, null, '', '   ']) {
  const result = run({ dose: 20, beverage: 40, tds: 10, water });
  assert.equal(result.water, null, 'water ' + JSON.stringify(water));
  assert.equal(result.brewRatio, null);
  assert.equal(result.waterRetained, null);
}

// ---- Numeric strings are accepted, as the form sends them.
const asStrings = run({ dose: '18', beverage: '36', tds: '9', water: '40' });
assert.equal(asStrings.extractionYield, 18);
assert.equal(asStrings.brewRatio, 2.222);
assert.equal(asStrings.waterRetained, 4);

// ---- The 18-22 window includes both edges after rounding.
assert.equal(run({ dose: 20, beverage: 40, tds: 9 }).extractionBand, 'ideal');
assert.equal(run({ dose: 20, beverage: 40, tds: 11 }).extractionBand, 'ideal');
assert.equal(run({ dose: 20, beverage: 40, tds: 8.99 }).extractionBand, 'under');
assert.equal(run({ dose: 20, beverage: 40, tds: 11.01 }).extractionBand, 'over');
assert.equal(run({ dose: 20, beverage: 40, tds: 12.01 }).strengthBand, 'concentrate');

// ---- Refusals name the field and never guess.
assert.equal(failure({ beverage: 36, tds: 9 }), 'Dose is required.');
assert.equal(failure({ dose: 18, tds: 9 }), 'Beverage mass is required.');
assert.equal(failure({ dose: 18, beverage: 36 }), 'TDS is required.');
assert.equal(failure({ dose: 0, beverage: 36, tds: 9 }), 'Dose must be greater than zero.');
assert.equal(failure({ dose: -1, beverage: 36, tds: 9 }), 'Dose must be greater than zero.');
assert.equal(failure({ dose: 18, beverage: 0, tds: 9 }), 'Beverage mass must be greater than zero.');
assert.equal(failure({ dose: 18, beverage: 36, tds: 0 }), 'TDS must be greater than zero.');
assert.equal(failure({ dose: 18, beverage: 36, tds: 30.01 }), 'TDS must be at most 30%.');
assert.equal(failure({ dose: 18, beverage: 36, tds: 9, water: -5 }), 'Water must be greater than zero.');
assert.equal(failure({ dose: 18, beverage: 36, tds: 9, water: 10 }),
  'Beverage mass cannot exceed the water plus the coffee dose.');
assert.equal(failure({ dose: 'abc', beverage: 36, tds: 9 }), 'Dose must be a number.');
assert.equal(failure({ dose: Infinity, beverage: 36, tds: 9 }), 'Dose must be a number.');
assert.equal(failure({ dose: 1500, beverage: 36, tds: 9 }), 'Dose must be at most 1,000 g.');
assert.equal(failure({ dose: 18, beverage: 6000, tds: 9 }), 'Beverage mass must be at most 5,000 g.');
assert.equal(failure({ dose: 18, beverage: 36, tds: 9, water: 6000 }), 'Water must be at most 5,000 g.');
assert.equal(failure(null), 'Dose is required.');

// ---- Randomised arithmetic over 300 brews.
const round3 = (value) => Math.round(value * 1000) / 1000;
const pick = (state) => {
  state.seed = (state.seed * 1103515245 + 12345) % 2147483648;
  return state.seed;
};
const between = (state, low, high) => low + (pick(state) / 2147483648) * (high - low);
const state = { seed: 20261109 };
for (let round = 0; round < 300; round += 1) {
  const dose = Math.round(between(state, 5, 40) * 100) / 100;
  const beverage = Math.round(between(state, 20, 600) * 10) / 10;
  const tds = Math.round(between(state, 0.5, 15) * 100) / 100;
  const suppliesWater = pick(state) % 2 === 0;
  const water = suppliesWater ? Math.round((beverage + between(state, 1, 200)) * 10) / 10 : null;
  const input = { dose, beverage, tds };
  if (water !== null) input.water = water;
  const result = run(input);

  const solids = (tds / 100) * beverage;
  const expectedYield = round3((solids / dose) * 100);
  assert.equal(result.dissolvedSolids, round3(solids), 'solids at round ' + round);
  assert.equal(result.extractionYield, expectedYield, 'yield at round ' + round);
  assert.ok(Math.abs(result.dissolvedSolids - solids) <= 0.0005 + 1e-12, 'solids tolerance at round ' + round);
  assert.ok(Math.abs(result.extractionYield - (solids / dose) * 100) <= 0.0005 + 1e-12,
    'yield tolerance at round ' + round);
  assert.equal(result.extractionBand, expectedYield < 18 ? 'under' : expectedYield > 22 ? 'over' : 'ideal',
    'band at round ' + round);
  assert.equal(result.beverageRatio, round3(beverage / dose), 'beverage ratio at round ' + round);
  if (water === null) {
    assert.equal(result.brewRatio, null);
    assert.equal(result.waterRetained, null);
  } else {
    assert.equal(result.brewRatio, round3(water / dose), 'brew ratio at round ' + round);
    assert.equal(result.waterRetained, round3(water - beverage), 'retained at round ' + round);
    assert.ok(result.waterRetained > 0, 'positive retention at round ' + round);
  }
  // The reported values recombine into the measured TDS within rounding.
  const recombined = result.dissolvedSolids / result.beverage * 100;
  assert.ok(Math.abs(recombined - result.tds) <= 0.002, 'round trip at round ' + round);
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="extraction-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Coffee Extraction Yield Calculator<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
for (const id of ['dose', 'beverage', 'tds', 'water']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'input #' + id);
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for ' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 11, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
for (const id of ['presets', 'err', 'result', 'verdict', 'strength', 'kv', 'example', 'clear']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'page has #' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media \(max-width:620px\)/.test(html), 'mobile layout');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Coffee Extraction Yield Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('rounded'), 'method documents rounding');
assert.equal(record.sources.length, 3, 'sources are recorded');
assert.equal(record.testCases.length, 19, 'catalog case count');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input), expected.error, testCase.name);
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

console.log('coffee extraction yield: all checks passed');
