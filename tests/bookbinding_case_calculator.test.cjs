/* Regression checks for the bookbinding case core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bookbinding-case-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* bookbinding-case-core:start */');
const end = html.indexOf('/* bookbinding-case-core:end */');
assert.ok(start > -1 && end > start, 'bookbinding case core markers missing');
const core = html.slice(start, end + '/* bookbinding-case-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BookbindingCaseCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const plan = (options) => plain(C.plan(options));
const failure = (options) => {
  try {
    plan(options);
  } catch (error) {
    return error.message;
  }
  return null;
};

const base = { unit: 'mm', width: 148, height: 210, thickness: 20, square: 3, board: 2, hinge: 6, turnIn: 15 };

// ---- Units and field contract.
assert.deepEqual(Object.keys(plain(C.UNITS)).sort(), ['in', 'mm']);
assert.deepEqual(plain(C.FIELDS), ['width', 'height', 'thickness', 'square', 'board', 'hinge', 'turnIn']);
for (const unit of ['mm', 'in']) {
  const spec = plain(C.UNITS)[unit];
  assert.equal(spec.label, unit);
  for (const key of plain(C.FIELDS)) {
    const range = spec.bounds[key];
    assert.ok(Array.isArray(range) && range.length === 2, unit + ' ' + key + ' bounds');
    assert.ok(range[0] < range[1], unit + ' ' + key + ' bounds ordered');
    assert.ok(range[0] >= 0, unit + ' ' + key + ' lower bound is not negative');
  }
}
assert.equal(plain(C.UNITS).mm.other, 'in');
assert.equal(plain(C.UNITS).in.other, 'mm');
assert.ok(Math.abs(plain(C.UNITS).in.toMillimetres - 25.4) < 1e-12, 'one inch is 25.4 mm');

// ---- The documented construction, checked by hand on the default block.
const a5 = plan(base);
assert.equal(a5.boardCount, 2);
assert.equal(a5.boardWidth, 145);         // 148 + 3 - 6
assert.equal(a5.boardHeight, 216);        // 210 + 2 * 3
assert.equal(a5.spineGap, 32);            // 20 + 2 * 6
assert.equal(a5.spineStrip, 36);          // 32 + 2 * 2
assert.equal(a5.caseWidth, 326);          // 2 * 145 + 36
assert.equal(a5.caseHeight, 216);
assert.equal(a5.coverWidth, 356);         // 326 + 2 * 15
assert.equal(a5.coverHeight, 246);        // 216 + 2 * 15
assert.equal(a5.areaM2, 0.087576);        // 356 * 246 mm = 87576 mm2
assert.equal(a5.areaFt2, 0.9427);
assert.equal(a5.coverWidthOther, 14.02);  // 356 mm in inches
assert.equal(a5.coverHeightOther, 9.69);

// Every result satisfies the identities the method text states.
const cases = [
  base,
  { unit: 'mm', width: 105, height: 148, thickness: 4, square: 2, board: 1.5, hinge: 4, turnIn: 12 },
  { unit: 'mm', width: 210, height: 297, thickness: 60, square: 8, board: 3, hinge: 12, turnIn: 20 },
  { unit: 'in', width: 6, height: 9, thickness: 1, square: 0.125, board: 0.08, hinge: 0.25, turnIn: 0.6 },
  { unit: 'in', width: 8.5, height: 11, thickness: 1.75, square: 0.125, board: 0.12, hinge: 0.3, turnIn: 0.75 }
];
for (const options of cases) {
  const r = plan(options);
  const square = Number(options.square);
  const hinge = Number(options.hinge);
  const board = Number(options.board);
  const turnIn = Number(options.turnIn);
  const width = Number(options.width);
  const height = Number(options.height);
  const thickness = Number(options.thickness);
  const tolerance = 0.011;
  assert.ok(Math.abs(r.boardWidth - (width + square - hinge)) < tolerance, 'board width identity');
  assert.ok(Math.abs(r.boardHeight - (height + 2 * square)) < tolerance, 'board height identity');
  assert.ok(Math.abs(r.spineGap - (thickness + 2 * hinge)) < tolerance, 'spine gap identity');
  assert.ok(Math.abs(r.spineStrip - (r.spineGap + 2 * board)) < tolerance, 'spine strip identity');
  assert.ok(Math.abs(r.caseWidth - (2 * r.boardWidth + r.spineStrip)) < tolerance, 'case width identity');
  assert.ok(Math.abs(r.caseWidth - (2 * width + 2 * square + thickness + 2 * board)) < tolerance, 'case width reduction');
  assert.ok(Math.abs(r.coverWidth - (r.caseWidth + 2 * turnIn)) < tolerance, 'cover width identity');
  assert.ok(Math.abs(r.coverHeight - (r.caseHeight + 2 * turnIn)) < tolerance, 'cover height identity');
  assert.equal(r.caseHeight, r.boardHeight, 'the case is exactly as tall as the boards');
  assert.ok(r.coverWidth > r.caseWidth && r.coverHeight > r.caseHeight, 'the cover is larger than the case');
  assert.ok(r.coverWidth > width && r.coverHeight > height, 'the cover is larger than the text block');
}

// ---- The same book measured both ways lands on the same millimetres.
for (const book of [
  { width: 148, height: 210, thickness: 20, square: 3, board: 2, hinge: 6, turnIn: 15 },
  { width: 105, height: 148, thickness: 12.5, square: 2.5, board: 1.5, hinge: 5, turnIn: 12 }
]) {
  const metric = plan(Object.assign({ unit: 'mm' }, book));
  const imperialInput = { unit: 'in' };
  for (const key of ['width', 'height', 'thickness', 'square', 'board', 'hinge', 'turnIn']) {
    imperialInput[key] = book[key] / 25.4;
  }
  const imperial = plan(imperialInput);
  for (const key of ['boardWidth', 'boardHeight', 'spineStrip', 'caseWidth', 'coverWidth', 'coverHeight']) {
    const converted = imperial[key] * 25.4;
    assert.ok(Math.abs(converted - metric[key]) < 0.2, key + ' agrees across units');
  }
  assert.ok(Math.abs(metric.areaM2 - imperial.areaM2) < 1e-4, 'area agrees across units');
}

// ---- Areas match the rectangle they describe.
for (const options of cases) {
  const r = plan(options);
  const factor = options.unit === 'in' ? 25.4 : 1;
  const squareMillimetres = r.coverWidth * r.coverHeight * factor * factor;
  assert.ok(Math.abs(r.areaM2 - squareMillimetres / 1e6) < 1e-5, 'square metres');
  assert.ok(Math.abs(r.areaFt2 - squareMillimetres / 92903.04) < 5e-4, 'square feet');
}

// ---- Decimal strings are accepted, padded and fractionless forms included.
assert.equal(plan(Object.assign({}, base, { width: '148.5', height: '210.25', thickness: '020' })).boardWidth, 145.5);
assert.equal(plan(Object.assign({}, base, { square: '.5' })).boardHeight, 211);

// ---- Errors name the failing field and its bounds.
assert.equal(failure({ unit: 'mm', width: '', height: 210, thickness: 20, square: 3, board: 2, hinge: 6, turnIn: 15 }),
  'Page width must be a number from 40 to 400 mm.');
assert.equal(failure({ unit: 'mm', width: 148, height: 'tall', thickness: 20, square: 3, board: 2, hinge: 6, turnIn: 15 }),
  'Page height must be a number from 40 to 400 mm.');
assert.equal(failure({ unit: 'mm' }), 'Page width must be a number from 40 to 400 mm.');
assert.equal(failure({ unit: 'cm', width: 148, height: 210, thickness: 20, square: 3, board: 2, hinge: 6, turnIn: 15 }),
  'Choose millimetres or inches.');
assert.equal(failure({}), 'Page width must be a number from 40 to 400 mm.');
for (const bad of ['2e1', 'abc', '1.2.3', '-5', '+5', '  ', 'NaN', 'Infinity', '0x10']) {
  assert.ok(failure(Object.assign({}, base, { width: bad })), 'width refuses ' + JSON.stringify(bad));
}
for (const [key, value, message] of [
  ['width', 39.9, 'Page width must be a number from 40 to 400 mm.'],
  ['height', 401, 'Page height must be a number from 40 to 400 mm.'],
  ['thickness', 0, 'Text block thickness must be a number from 1 to 120 mm.'],
  ['square', -1, 'Square must be a number from 0 to 20 mm.'],
  ['board', 6.1, 'Board thickness must be a number from 0.5 to 6 mm.'],
  ['hinge', 20.5, 'Hinge allowance must be a number from 0 to 20 mm.'],
  ['turnIn', 4.9, 'Turn-in must be a number from 5 to 40 mm.']
]) {
  assert.equal(failure(Object.assign({}, base, { [key]: value })), message, key + ' out of range');
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="case-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Bookbinding Case Calculator<\/h1>/.test(html), 'page heading');
for (const id of ['unit', 'width', 'height', 'thickness', 'square', 'board', 'hinge', 'turnin']) {
  assert.ok(new RegExp('for="' + id + '"').test(html), 'label for ' + id);
  assert.ok(new RegExp('id="' + id + '"').test(html), 'control ' + id);
}
assert.ok(/name="viewport"/.test(html), 'viewport');
// Every element the page script looks up must exist in the markup.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 18, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Bookbinding Case Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 14, 'fourteen validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.plan(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plan(input);
  for (const [key, value] of Object.entries(expected)) {
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
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('bookbinding-case-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, 7 fields, 2 unit systems)');
