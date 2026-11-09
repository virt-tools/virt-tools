/* Regression checks for the fly leader core, its catalog cases, randomised
   section splits and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fly-fishing-leader-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* fly-leader-core:start */');
const end = html.indexOf('/* fly-leader-core:end */');
assert.ok(start > -1 && end > start, 'leader core markers missing');
const core = html.slice(start, end + '/* fly-leader-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FlyLeaderCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.calculate(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Library surface.
assert.equal(C.TIPPET_MIN_X, 0);
assert.equal(C.TIPPET_MAX_X, 8);
assert.equal(C.STEP_INCHES, 0.001);
assert.deepEqual(plain(C.PRESETS.map((preset) => preset.id)), ['60-20-20', '50-30-20', '40-40-20']);
const table = plain(C.tippetTable());
assert.equal(table.length, 9);
assert.deepEqual(table[0], { x: 0, label: '0X', thousandths: 11, inches: 0.011, millimeters: 0.279 });
assert.deepEqual(table[8], { x: 8, label: '8X', thousandths: 3, inches: 0.003, millimeters: 0.076 });
table.forEach((row) => {
  assert.equal(row.thousandths, 11 - row.x);
  assert.equal(row.inches, row.thousandths / 1000);
  assert.equal(row.millimeters, Math.round(row.thousandths * 254 / 10) / 1000);
});

// ---- Golden plans.
const nine = run({ mode: 'build', unit: 'ft', length: '9', preset: '60-20-20', butt: '0.022', tippet: '4' });
assert.equal(nine.totalInches, 108);
assert.equal(nine.totalDisplay, '9 ft');
assert.deepEqual(nine.sections.map((section) => section.inches), [64.8, 21.6, 21.6]);
assert.deepEqual(nine.sections.map((section) => section.centimeters), [164.6, 54.9, 54.9]);
assert.deepEqual(nine.sections.map((section) => section.display),
  ['5 ft 4.8 in', '1 ft 9.6 in', '1 ft 9.6 in']);
assert.equal(nine.taperSteps, 15);
assert.equal(nine.tippet.millimeters, 0.178);
assert.equal(nine.butt.millimeters, 0.559);
assert.match(nine.summary, /^9 ft leader — 60 \/ 20 \/ 20/);
assert.match(nine.summary, /15 steps of 0\.001 in/);

const twelve = run({ mode: 'build', unit: 'ft', length: '12', preset: '40-40-20', butt: '0.025', tippet: '0' });
assert.deepEqual(twelve.sections.map((section) => section.inches), [57.6, 57.6, 28.8]);
assert.equal(twelve.taperSteps, 14);

const metres = run({ mode: 'build', unit: 'm', length: '2.7', preset: '50-30-20', butt: '0.020', tippet: '6' });
assert.equal(metres.totalInches, 106.3);
assert.equal(metres.totalDisplay, '2.7 m');
assert.deepEqual(metres.sections.map((section) => section.inches), [53.1, 31.9, 21.3]);

// ---- Extension mode.
const extended = run({ mode: 'extend', unit: 'ft', existing: '9', target: '12', tippet: '5' });
assert.equal(extended.tippetInches, 36);
assert.equal(extended.tippetCentimeters, 91.4);
assert.equal(extended.tippetPercent, 25);
assert.equal(extended.ratio, 3);
assert.match(extended.summary, /Tippet to add: 3 ft \(91\.4 cm\) — 25%/);

const extendedMetres = run({ mode: 'extend', unit: 'm', existing: '2.5', target: '2.65', tippet: '6' });
assert.equal(extendedMetres.tippetInches, 5.9);
assert.equal(extendedMetres.tippetPercent, 5.7);
assert.ok(!/\(2\.65 m\)/.test(extendedMetres.summary), 'metre summary repeats its own unit');

// ---- Refusals name the problem and never guess.
assert.equal(failure({}), 'Leader length must be a number from 3 to 30 feet.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '2.9', butt: '0.022', tippet: '4' }),
  'Leader length must be a number from 3 to 30 feet.');
assert.equal(failure({ mode: 'build', unit: 'm', length: '9.1', butt: '0.022', tippet: '4' }),
  'Leader length must be a number from 1 to 9 metres.');
assert.equal(failure({ mode: 'build', unit: 'yd', length: '9', butt: '0.022', tippet: '4' }),
  'Choose feet or metres.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '9', preset: '70-20-10', butt: '0.022', tippet: '4' }),
  'Choose a leader formula from the list.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '9', preset: 'custom', customButt: '60', customTaper: '20', customTippet: '19', butt: '0.022', tippet: '4' }),
  'Custom percentages must add up to 100.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '9', preset: 'custom', customButt: '1', customTaper: '1', customTippet: '0', butt: '0.022', tippet: '4' }),
  'Tippet share must be a whole number from 1 to 98.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '9', preset: '60-20-20', butt: '0.031', tippet: '4' }),
  'Butt diameter must be a number from 0.015 to 0.030 in.');
assert.equal(failure({ mode: 'build', unit: 'ft', length: '9', preset: '60-20-20', butt: '0.022', tippet: '9' }),
  'Tippet size must be a whole number from 0 to 8 (0X to 8X).');
assert.equal(failure({ mode: 'extend', unit: 'ft', existing: '9', target: '9.4', tippet: '4' }),
  'Target length must be more than half a foot (15 cm) longer than the existing leader.');
assert.equal(failure({ mode: 'extend', unit: 'ft', existing: '9', target: '31', tippet: '4' }),
  'Target length must be a number from 3 to 30 feet.');
assert.equal(failure({ mode: 'copy', unit: 'ft' }), 'Choose new leader or extend leader.');

// ---- Independent oracle: floor each share, then hand out the leftover tenths.
const presets = {
  '60-20-20': [60, 20, 20],
  '50-30-20': [50, 30, 20],
  '40-40-20': [40, 40, 20]
};
const oracleSplit = (totalInches, weights) => {
  const tenths = Math.round(totalInches * 10);
  const shares = weights.map((weight) => tenths * weight / 100);
  const counts = shares.map((share) => Math.floor(share));
  const spare = tenths - counts.reduce((sum, value) => sum + value, 0);
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; index < spare; index += 1) counts[order[index].index] += 1;
  return counts;
};
const roundHalfUp = (value) => Math.round(value);

let seed = 20261109;
const pick = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed;
};

for (let index = 0; index < 300; index += 1) {
  const presetIds = Object.keys(presets);
  const preset = presetIds[pick() % presetIds.length];
  const unit = pick() % 2 ? 'ft' : 'm';
  const lengthValue = unit === 'ft'
    ? (3 + (pick() % 2701) / 100)
    : (1 + (pick() % 801) / 100);
  const buttThousandths = 15 + (pick() % 16);
  const tippetX = pick() % 9;
  const result = run({
    mode: 'build', unit, length: String(lengthValue), preset,
    butt: (buttThousandths / 1000).toFixed(3), tippet: String(tippetX)
  });

  const inches = unit === 'ft' ? lengthValue * 12 : lengthValue * 39.37007874015748;
  const totalTenths = Math.round(inches * 10);
  const counts = oracleSplit(totalTenths / 10, presets[preset]);
  const actual = result.sections.map((section) => section.inches * 10);

  assert.deepEqual(actual, counts, 'section split at ' + index);
  assert.equal(Math.round(result.sections.reduce((sum, section) => sum + section.inches, 0) * 10), totalTenths,
    'sections add up at ' + index);
  assert.deepEqual(result.sections.map((section) => section.centimeters),
    counts.map((tenths) => Math.round(tenths * 254 / 100) / 10), 'centimetres at ' + index);
  assert.equal(result.sections[0].diameterInches, buttThousandths / 1000);
  assert.equal(result.sections[2].diameterInches, (11 - tippetX) / 1000);
  assert.equal(result.taperSteps, buttThousandths - (11 - tippetX));
  assert.equal(result.totalInches, totalTenths / 10);
  assert.match(result.summary, new RegExp(result.totalDisplay.replace('.', '\\.')));
}

// ---- Independent oracle: the added tippet is the difference of the lengths.
for (let index = 0; index < 200; index += 1) {
  const unit = pick() % 2 ? 'ft' : 'm';
  const existing = unit === 'ft' ? 3 + (pick() % 2600) / 100 : 1 + (pick() % 780) / 100;
  const step = unit === 'ft' ? 0.5 + (pick() % 400) / 100 : 0.2 + (pick() % 200) / 100;
  const target = existing + step;
  if (target > (unit === 'ft' ? 30 : 9)) continue;
  const result = run({ mode: 'extend', unit, existing: String(existing), target: String(target), tippet: String(pick() % 9) });
  const existingInches = Math.round((unit === 'ft' ? existing * 12 : existing * 39.37007874015748) * 10) / 10;
  const targetInches = Math.round((unit === 'ft' ? target * 12 : target * 39.37007874015748) * 10) / 10;
  const added = Math.round((targetInches - existingInches) * 10) / 10;
  assert.equal(result.existingInches, existingInches, 'existing at ' + index);
  assert.equal(result.targetInches, targetInches, 'target at ' + index);
  assert.equal(result.tippetInches, added, 'tippet at ' + index);
  assert.equal(result.tippetPercent, roundHalfUp(added * 10 * 1000 / (targetInches * 10)) / 10,
    'percent at ' + index);
  assert.equal(result.ratio, roundHalfUp(existingInches * 10 * 10 / (added * 10)) / 10, 'ratio at ' + index);
  assert.equal(result.tippetCentimeters, Math.round(added * 10 * 254 / 100) / 10, 'centimetres at ' + index);
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="leader-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Fly Fishing Leader Builder<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
for (const id of ['mode', 'unit', 'length', 'existing', 'target', 'preset', 'butt', 'tippet',
  'custom-butt', 'custom-taper', 'custom-tippet', 'status', 'result', 'summary', 'copy', 'tippet-rows']) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'page has #' + id);
}
for (const id of ['mode', 'unit', 'length', 'existing', 'target', 'preset', 'butt', 'tippet',
  'custom-butt', 'custom-taper', 'custom-tippet']) {
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for #' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 16, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media\(max-width:620px\)/.test(html), 'mobile layout');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Fly Fishing Leader Builder');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(/browser/.test(record.method), 'method documents local execution');
assert.ok(/0\.011/.test(record.method), 'method documents the X scale');
assert.equal(record.testCases.length, 22, 'catalog case count');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('edge'), 2, 'two edge cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug is unique');
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

console.log('fly fishing leader builder: all checks passed');
