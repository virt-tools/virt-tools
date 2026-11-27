/* Fresh pasta dough calculator: the egg-to-flour scaling, the whole-egg
   rounding, the catalog cases, the invariants over a grid of batches,
   uniqueness and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fresh-pasta-dough-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pasta-core:start */';
const endMarker = '/* pasta-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = PastaDoughCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const plan = (input) => C.plan(input);
const failure = (input) => {
  try {
    C.plan(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const close = (actual, expected, label, slack) => {
  assert.equal(typeof actual, 'number', label + ' is a number');
  const tolerance = slack === undefined ? 1e-9 * Math.max(1, Math.abs(expected)) : slack;
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' != ' + expected);
};

// ---- Defaults and limits are what the page advertises.
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(C.DEFAULTS), { eggWeight: 50, ratio: 50, gramsPerServing: 100 });
assert.deepEqual(plain(C.LIMITS), {
  servingsMin: 0.5, servingsMax: 24,
  servingGramsMin: 60, servingGramsMax: 200,
  eggsMin: 1, eggsMax: 48,
  eggWeightMin: 35, eggWeightMax: 75,
  ratioMin: 30, ratioMax: 80
});

// ---- The scaling itself.
const four = plan({ basis: 'servings', servings: 4, gramsPerServing: 100, eggWeight: 50, ratio: 50 });
close(four.requestedDough, 400, 'requested dough');
close(four.eggs, 3, 'whole eggs');
close(four.flourGrams, 300, 'flour');
close(four.eggGrams, 150, 'egg weight');
close(four.doughGrams, 450, 'dough');
close(four.portions, 4.5, 'portions');
assert.equal(four.roundedUp, true, 'four portions needs a third egg');

const exact = plan({ basis: 'servings', servings: 1.5, gramsPerServing: 100, eggWeight: 50, ratio: 50 });
close(exact.eggs, 1, 'an exact whole egg');
assert.equal(exact.roundedUp, false, 'an exact egg count is not rounded');

const fromEggs = plan({ basis: 'eggs', eggs: 3, eggWeight: 50, ratio: 50, gramsPerServing: 100 });
close(fromEggs.flourGrams, 300, 'three eggs need 300 g flour');
close(fromEggs.doughGrams, 450, 'three eggs make 450 g dough');
assert.equal(fromEggs.requestedDough, null, 'no requested weight when starting from eggs');
assert.equal(fromEggs.roundedUp, false);

close(plan({ basis: 'eggs', eggs: 2, ratio: 60 }).flourGrams, 100 * 100 / 60, 'a 60 % dough');
close(plan({ basis: 'eggs', eggs: 2, ratio: 40 }).flourGrams, 250, 'a 40 % dough needs more flour');

// ---- String values straight from a form control behave like numbers.
const strings = plan({ basis: 'Servings', servings: ' 4 ', gramsPerServing: '100', eggWeight: '50', ratio: '50' });
close(strings.doughGrams, 450, 'form strings parse');
assert.equal(strings.eggs, 3);

// ---- Every catalog case replays.
assert.ok(Array.isArray(record.testCases) && record.testCases.length >= 15, 'the record carries its cases');
for (const testCase of record.testCases) {
  const label = 'case ' + JSON.stringify(testCase.name);
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, label);
    continue;
  }
  const result = plan(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    const actual = result[key];
    if (typeof expected === 'number') close(actual, expected, label + ' ' + key, 1e-3);
    else assert.equal(actual, expected, label + ' ' + key);
  }
}
const kinds = new Set(record.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'case kind ' + kind);

// ---- Invariants over a grid of batches: exact ratio, whole eggs, bounded overshoot.
const ratios = [45, 50, 55, 60];
for (const ratio of ratios) {
  for (const eggWeight of [40, 50, 56, 63]) {
    for (const servings of [0.5, 1, 2.5, 6, 12, 24]) {
      for (const gramsPerServing of [80, 100, 150]) {
        const result = plan({ basis: 'servings', servings, gramsPerServing, eggWeight, ratio });
        const label = [servings, gramsPerServing, eggWeight, ratio].join('/');
        assert.equal(result.eggs, Math.round(result.eggs), label + ' whole eggs');
        assert.ok(result.eggs >= 1, label + ' at least one egg');
        close(result.flourGrams * ratio / 100, result.eggGrams, label + ' ratio holds');
        close(result.doughGrams, result.flourGrams + result.eggGrams, label + ' dough is flour plus egg');
        assert.ok(result.doughGrams >= result.requestedDough - 1e-9, label + ' never short of the requested batch');
        const oneEggDough = eggWeight * (1 + 100 / ratio);
        assert.ok(result.doughGrams - result.requestedDough < oneEggDough + 1e-9,
          label + ' never overshoots by a whole egg');
        assert.equal(result.roundedUp, result.eggs * eggWeight > result.requestedDough * ratio / (100 + ratio) + 1e-6);
      }
    }
  }
}

// ---- Round trips: the eggs a batch needs rebuild the same batch, and doubling doubles.
for (const ratio of ratios) {
  for (const eggWeight of [40, 50, 63]) {
    const first = plan({ basis: 'servings', servings: 3, gramsPerServing: 110, eggWeight, ratio });
    const again = plan({ basis: 'eggs', eggs: first.eggs, eggWeight, ratio, gramsPerServing: 110 });
    close(again.flourGrams, first.flourGrams, 'flour round trip');
    close(again.doughGrams, first.doughGrams, 'dough round trip');
    const doubled = plan({ basis: 'eggs', eggs: first.eggs * 2, eggWeight, ratio, gramsPerServing: 110 });
    close(doubled.flourGrams, first.flourGrams * 2, 'doubling the eggs doubles the flour');
  }
}
close(plan({ basis: 'eggs', eggs: 1, eggWeight: 50, ratio: 50 }).flourGrams, 100, 'one egg to 100 g flour');

// ---- Refusals.
assert.equal(failure({ basis: 'servings', servings: '', eggWeight: 50, ratio: 50, gramsPerServing: 100 }),
  'Servings must be between 0.5 and 24.');
assert.equal(failure({ basis: 'eggs', eggs: '2.5', eggWeight: 50, ratio: 50, gramsPerServing: 100 }),
  'Eggs must be a whole number between 1 and 48.');
assert.equal(failure({ basis: 'eggs', eggs: 3, eggWeight: 34, ratio: 50, gramsPerServing: 100 }),
  'Egg weight must be between 35 and 75 grams.');
assert.equal(failure({ basis: 'eggs', eggs: 3, eggWeight: 50, ratio: 85, gramsPerServing: 100 }),
  'Egg-to-flour ratio must be between 30 and 80 percent.');
assert.equal(failure({ basis: 'servings', servings: 4, eggWeight: 50, ratio: 50, gramsPerServing: 55 }),
  'Grams per serving must be between 60 and 200.');
assert.equal(failure({ basis: 'plates', servings: 4 }), 'Choose how to plan the batch.');
assert.equal(failure({}), 'Servings must be between 0.5 and 24.', 'no basis and no servings is refused');

// ---- Catalog shape: the tool is new, low risk, Food, and not a duplicate.
assert.equal(record.category, 'Food');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.match(record.added, /^2026-11-2\dT\d\d:\d\d:\d\dZ$/);
assert.equal(record.reviewedAt, null);
assert.ok(record.sources.length >= 2, 'the two references are recorded');
for (const source of record.sources) {
  assert.ok(source.title && source.title.length > 20, 'a described source: ' + source.title);
  assert.match(source.url, /^https:\/\/en\.wikipedia\.org\/wiki\//, 'a fetched reference: ' + source.url);
}
assert.ok(record.method.length > 400, 'the method explains the arithmetic');
assert.ok(record.guidance.length > 80, 'the guidance tells the reader what to do');

const normalise = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
const mine = [record.slug, record.name, ...record.aliases].map(normalise);
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  const theirs = [other.slug, other.name, ...(other.aliases || [])].map(normalise);
  for (const value of mine) {
    assert.ok(!theirs.includes(value), 'duplicate name or alias: ' + value + ' on ' + other.slug);
  }
  assert.ok(!/pasta|noodle|semolina|spaghetti|tagliatelle/.test(JSON.stringify(other)),
    'another pasta tool exists: ' + other.slug);
}

// ---- The catalog keeps growing and stays balanced.
assert.equal(catalog.tools.length, 2505, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2244, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Food').length, 56, 'Food count');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Fresh Pasta Dough Calculator<\/h1>/);
assert.match(html, /<form id="pasta-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label\b/g) || []).length, 7, 'every control is labelled');
assert.equal((html.match(/<input\b/g) || []).length, 7, 'two basis radios and five numbers');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/<button type="button"/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas|<link rel="(?!stylesheet)/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.match(html, /\.field\[hidden\]\{display:none\}/, 'the hidden basis field really hides');
assert.equal((html.match(/\/\* pasta-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* pasta-core:end \*\//g) || []).length, 1);

const ids = ['pasta-form', 'basis-servings', 'basis-eggs', 'servings-field', 'eggs-field',
  'servings', 'eggs', 'serving-grams', 'egg-weight', 'ratio', 'reset', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('fresh pasta dough calculator OK: ' + record.testCases.length +
  ' catalog cases, ' + (ratios.length * 4 * 6 * 3) + ' grid batches, round trips over 4 ratios and 3 egg weights,' +
  ' refusals, uniqueness and page contract OK');
