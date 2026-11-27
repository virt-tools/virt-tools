/* Cutting board glue-up planner: the strip and slice arithmetic for both
   builds, the kerf accounting, the unit toggle, refusals, warnings, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cutting-board-glue-up-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cutting-board-core:start */';
const endMarker = '/* cutting-board-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = CuttingBoardCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { mode: 'edge', unit: 'mm', length: 450, width: 300, thickness: 38, strip: 30, kerf: 3.2, stock: 45, trim: 5 };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const near = (actual, expected, tolerance) => Math.abs(actual - expected) <= (tolerance === undefined ? 1e-9 : tolerance);

// ---- The default edge-grain board: 10 strips of 30 mm, 328.8 mm of lumber.
const defaults = run();
assert.equal(defaults.strips, 10);
assert.equal(defaults.slices, 1);
assert.equal(defaults.boardLength, 450);
assert.equal(defaults.boardWidth, 300);
assert.ok(near(defaults.stockWidth, 328.8));
assert.equal(defaults.stockLength, 460);
assert.ok(near(defaults.boardFeet, 328.8 * 460 * 45 / 2359737.216));
assert.ok(near(defaults.planingAllowance, 7));
assert.equal(defaults.overWidth, 0);
assert.equal(defaults.warnings.length, 0);

// ---- The end-grain build turns the panel on edge: 15 strips become the
//      length, 8 slices of 38 mm become the 304 mm width.
const endGrain = run({ mode: 'end' });
assert.equal(endGrain.strips, 15);
assert.equal(endGrain.slices, 8);
assert.equal(endGrain.boardLength, 450);
assert.equal(endGrain.boardWidth, 304);
assert.ok(near(endGrain.stockWidth, 450 + 14 * 3.2));
assert.ok(near(endGrain.stockLength, 304 + 7 * 3.2 + 2 * 5));
assert.ok(near(endGrain.panelLength, 326.4));
assert.equal(endGrain.glueUps, 2);
assert.equal(endGrain.overWidth, 4);

// ---- The strip count is the ceiling of the width over the strip width, for
//      every width and strip in range; the board never comes out narrower
//      than asked, and never a whole strip wider.
let checked = 0;
for (const width of [100, 187, 240, 300, 333.3, 512, 900]) {
  for (const strip of [10, 12.5, 19, 25, 30, 44.5, 60, 97, 150]) {
    if (width / strip > C.MAX_STRIPS) continue;
    const result = run({ width, strip });
    assert.equal(result.strips, Math.ceil(width / strip - 1e-9), 'strips for ' + width + '/' + strip);
    assert.ok(result.boardWidth >= width, 'board is not narrower than asked');
    assert.ok(result.boardWidth - width < strip, 'board is under one strip wider');
    assert.ok(near(result.stockWidth, result.strips * strip + (result.strips - 1) * 3.2), 'kerf is counted between strips');
    assert.ok(near(result.boardFeet, result.stockWidth * result.stockLength * 45 / 2359737.216), 'board feet follow the lumber volume');
    checked += 1;
  }
}

// ---- The end-grain slice count is the ceiling of the width over the
//      finished thickness, and the length comes from the strips.
for (const length of [150, 450, 611]) {
  for (const width of [120, 300, 400.5]) {
    for (const thickness of [15, 30, 38, 50]) {
      const result = run({ mode: 'end', length, width, thickness, strip: 25, kerf: 3.2, stock: thickness + 8 });
      assert.equal(result.strips, Math.ceil(length / 25 - 1e-9));
      assert.equal(result.slices, Math.ceil(width / thickness - 1e-9));
      assert.ok(result.boardLength >= length && result.boardLength - length < 25, 'length within a strip');
      assert.ok(result.boardWidth >= width && result.boardWidth - width < thickness, 'width within a slice');
      assert.equal(result.boardThickness, thickness);
      assert.ok(near(result.stockWidth, result.boardLength + (result.strips - 1) * 3.2));
      assert.ok(near(result.stockLength, result.boardWidth + (result.slices - 1) * 3.2 + 2 * 5));
      assert.ok(result.warnings.length <= 3, 'no contradictory warning storm');
    }
  }
}

// ---- The unit toggle is a presentation change only: the same physical board
//      entered in inches gives the same millimetres and the same counts.
const inches = run({ unit: 'in', length: 18, width: 12, thickness: 1.5, strip: 1.25, kerf: 0.125, stock: 1.75, trim: 0.25 });
assert.ok(near(inches.length, 457.2));
assert.ok(near(inches.width, 304.8));
assert.ok(near(inches.boardWidth, 317.5));
assert.equal(inches.strips, 10);
assert.ok(near(inches.stockWidth, 317.5 + 9 * 3.175, 1e-9));
assert.ok(near(inches.boardFeet, inches.stockWidth * inches.stockLength * 44.45 / 2359737.216));
assert.equal(inches.warnings.length, 0);

// ---- Warnings fire on the documented conditions, not at random.
assert.match(run({ strip: 19, width: 300 }).warnings[0], /under 20 mm/);
assert.match(run({ strip: 20, kerf: 9 }).warnings.join(' '), /more than 40%/);
assert.match(run({ stock: 39, thickness: 38 }).warnings.join(' '), /left for flattening/);
assert.match(run({ width: 290, strip: 40 }).warnings.join(' '), /wider than asked/);
assert.match(run({ mode: 'end', width: 310, thickness: 30 }).warnings.join(' '), /wider than asked/);
assert.match(run({ mode: 'end', length: 450, strip: 40 }).warnings.join(' '), /longer than asked/);
assert.equal(run({ mode: 'end', length: 500, width: 400, thickness: 40, strip: 25, stock: 50 }).warnings.length, 0);

// ---- Refusals.
assert.equal(failure({ strip: 10, kerf: 10 }), 'The blade kerf must be narrower than the rip strip, or no strip survives the cut.');
assert.equal(failure({ kerf: 12 }), 'Enter the blade kerf from 0 to 10 mm.');
assert.equal(failure({ stock: 30 }), 'The stock thickness must be at least the finished thickness; there would be nothing left to flatten.');
assert.equal(failure({ length: 'eight' }), 'Enter the finished length as a number, such as 300.');
assert.equal(failure({ width: '' }), 'Enter the finished width.');
assert.equal(failure({ mode: 'diagonal' }), 'Choose the edge-grain or end-grain build.');
assert.equal(failure({ thickness: 5 }), 'Enter the finished thickness from 10 to 100 mm.');
assert.equal(failure({ width: 1500, strip: 10 }), 'That strip width needs 150 strips; use a wider strip or a smaller board.');
assert.equal(failure({ mode: 'end', length: 3000, strip: 10 }), 'That strip width needs 300 strips; use a wider strip or a smaller board.');
assert.equal(failure({ mode: 'end', width: 1500, thickness: 10 }), 'That slice count needs 150 slices; use a thicker finished board or a narrower one.');
assert.equal(failure({ unit: 'cm' }), 'Choose millimetres or inches.');
assert.equal(failure({ length: '4.5.0' }), 'Enter the finished length as a number, such as 300.');

// ---- A decimal comma is accepted as a decimal point.
const comma = run({ length: '455,5' });
assert.ok(near(comma.length, 455.5));

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2509, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2248, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length, 57,
  'Crafts & Hobbies count');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.match(record.method, /board foot/);
assert.equal(record.sources.length, 0, 'bespoke geometry carries no citation');
assert.ok(record.tags.length === new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 4, validation: 6 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number' && !Number.isInteger(expected)) {
      assert.equal(Math.round(actual[key] * 1e4) / 1e4, expected, testCase.name + ': ' + key);
    } else {
      assert.equal(actual[key], expected, testCase.name + ': ' + key);
    }
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Cutting Board Glue-Up Planner<\/h1>/);
assert.match(html, /<form id="board-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<input/g) || []).length, 7);
assert.equal((html.match(/<select/g) || []).length, 2);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* cutting-board-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* cutting-board-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup, and no id repeats.
const ids = ['board-form', 'mode', 'unit', 'length', 'width', 'thickness', 'strip', 'kerf',
  'stock', 'trim', 'build-note', 'board-err', 'board-out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
const allIds = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(allIds).size, allIds.length, 'ids are unique');

// Every label points at a real control.
const labelIds = Array.from(html.matchAll(/<label[^>]*\bfor="([^"]+)"/g), (match) => match[1]);
assert.equal(labelIds.length, 9, 'every control is labelled');
for (const id of labelIds) {
  const control = new RegExp('<input[^>]*\\bid="' + id + '"|<select[^>]*\\bid="' + id + '"');
  assert.match(html, control, 'label target exists: ' + id);
}

console.log('cutting board glue-up planner OK: ' + checked + ' strip cases, 36 slice cases, unit toggle, ' +
  record.testCases.length + ' catalog cases, refusals, warnings, uniqueness and page contract OK');
