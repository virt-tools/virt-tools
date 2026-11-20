/* Tennis court marking: the line arithmetic, the paint and footprint figures,
   the formatter, the parser's refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tennis-court-marking-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* tennis-court-core:start */';
const endMarker = '/* tennis-court-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = TennisCourtCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const close = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 5e-3, label + ': ' + actual + ' vs ' + expected);
};

const base = () => ({ court: 'doubles', level: 'club', lineWidth: '5', coverage: '10' });

// ---- The arithmetic, restated as an independent model from the ITF constants.
const LENGTH = 23.77;
const WIDTH_DOUBLES = 10.97;
const WIDTH_SINGLES = 8.23;
const SERVICE = 6.40;
const MARK = 0.10;
const CLEARANCE = { club: [5.48, 3.05], international: [6.40, 3.66] };
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const model = (court, level, widthCm, coverage) => {
  const width = court === 'doubles' ? WIDTH_DOUBLES : WIDTH_SINGLES;
  const lines = court === 'doubles'
    ? 2 * width + 4 * LENGTH + 2 * WIDTH_SINGLES + 2 * SERVICE + 2 * MARK
    : 2 * width + 2 * LENGTH + 2 * WIDTH_SINGLES + 2 * SERVICE + 2 * MARK;
  const [back, side] = CLEARANCE[level];
  const area = lines * widthCm / 100;
  return {
    lineTotal: lines,
    paintArea: area,
    paintLitres: area / coverage,
    footprintLength: LENGTH + 2 * back,
    footprintWidth: width + 2 * side,
    footprintArea: (LENGTH + 2 * back) * (width + 2 * side),
    diagonal: Math.sqrt(LENGTH * LENGTH + width * width)
  };
};

let seed = 20261120;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let step = 0; step < 300; step += 1) {
  const court = next() < 0.5 ? 'doubles' : 'singles';
  const level = next() < 0.5 ? 'club' : 'international';
  const widthCm = Math.round((2.5 + next() * 2.5) * 10) / 10;
  const coverage = Math.round((1 + next() * 49) * 10) / 10;
  const result = C.calculate({ court, level, lineWidth: String(widthCm), coverage: String(coverage) });
  const want = model(court, level, widthCm, coverage);
  for (const key of ['lineTotal', 'paintArea', 'paintLitres', 'footprintLength', 'footprintWidth', 'footprintArea', 'diagonal']) {
    close(result[key], round2(want[key]), 'model ' + key + ' at case ' + step);
  }
  assert.equal(result.lineGroups, court === 'doubles' ? 6 : 5, 'line groups at case ' + step);
  assert.equal(result.netLength, court === 'doubles' ? 12.8 : 10, 'net length at case ' + step);
}

// ---- The defaults on the page.
const defaults = C.calculate(base());
assert.equal(defaults.lineTotal, 146.48);
assert.equal(defaults.paintArea, 7.32);
assert.equal(defaults.paintLitres, 0.73);
assert.equal(defaults.footprintLength, 34.73);
assert.equal(defaults.footprintWidth, 17.07);
assert.equal(defaults.footprintArea, 592.84);
assert.equal(defaults.diagonal, 26.18);
assert.equal(defaults.headline, '146.48 m of painted line');
assert.equal(defaults.summary,
  'Combined doubles and singles court: 23.77 m by 10.97 m, with the service lines 6.40 m from the net and each service box 6.40 m by 4.11 m.');
assert.equal(defaults.paintSummary, '5 cm lines cover 7.32 m\u00b2; about 0.73 L per coat at 10 m\u00b2 per litre.');
assert.equal(defaults.footprintSummary,
  'Club and recreational run-back of 5.48 m behind the baselines and 3.05 m beside the sidelines needs 34.73 m by 17.07 m, 592.84 m\u00b2.');
assert.deepEqual(plain(defaults.rows.map((row) => row.label)),
  ['Baselines', 'Doubles sidelines', 'Singles sidelines', 'Service lines', 'Centre service line', 'Centre marks']);
assert.deepEqual(plain(defaults.rows.map((row) => row.subtotal)),
  ['21.94 m', '47.54 m', '47.54 m', '16.46 m', '12.80 m', '0.20 m']);
assert.equal(defaults.rows[3].each, '8.23 m', 'service lines stop at the singles sidelines');
assert.deepEqual(plain(defaults.marking.map((row) => row.value)),
  ['12.80 m', '4.11 m', '5.03 m', '5.48 m', '16.18 m', '11.89 m', '10.97 m', '26.18 m']);

// ---- A singles-only court, which drops the doubles sidelines.
const singles = C.calculate({ court: 'singles', level: 'club', lineWidth: '5', coverage: '10' });
assert.equal(singles.lineGroups, 5);
assert.deepEqual(plain(singles.rows.map((row) => row.label)),
  ['Baselines', 'Singles sidelines', 'Service lines', 'Centre service line', 'Centre marks']);
assert.equal(singles.lineTotal, 93.46);
assert.equal(singles.headline, '93.46 m of painted line');
assert.equal(singles.netLength, 10);
assert.deepEqual(plain(singles.marking.map((row) => row.value)),
  ['10.00 m', '4.11 m', '5.03 m', '14.46 m', '11.89 m', '8.23 m', '25.15 m']);

// ---- International run-back widens the footprint without touching the line.
const world = C.calculate({ court: 'doubles', level: 'international', lineWidth: '5', coverage: '10' });
assert.equal(world.lineTotal, 146.48);
assert.equal(world.footprintLength, 36.57);
assert.equal(world.footprintWidth, 18.29);
assert.equal(world.footprintArea, 668.87);
assert.match(world.footprintSummary, /^International competition run-back of 6\.40 m behind the baselines and 3\.66 m beside the sidelines/);

// ---- Rounding and the two-decimal formatter.
assert.equal(C.round2(7.324000000000001), 7.32);
assert.equal(C.fix(2.3365), '2.34');
assert.equal(C.metres(23.77), '23.77 m');
assert.equal(C.fix(146.48), '146.48');

// ---- Refusals.
assert.equal(failure(Object.assign(base(), { court: '' })),
  'Choose "doubles" for a combined court or "singles" for a singles-only court.');
assert.equal(failure(Object.assign(base(), { court: 'clay' })),
  'Choose "doubles" for a combined court or "singles" for a singles-only court.');
assert.equal(failure(Object.assign(base(), { level: '' })),
  'Choose "club" or "international" for the run-back guidance.');
assert.equal(failure(Object.assign(base(), { level: 'pro' })),
  'Choose "club" or "international" for the run-back guidance.');
assert.equal(failure(Object.assign(base(), { lineWidth: '' })),
  'Enter the line width in centimetres, such as 5.');
assert.equal(failure(Object.assign(base(), { lineWidth: 'five' })),
  'Enter the line width in centimetres as a number, such as 5.');
assert.equal(failure(Object.assign(base(), { lineWidth: '2' })),
  'Line width must be between 2.5 and 5 cm.');
assert.equal(failure(Object.assign(base(), { lineWidth: '5.5' })),
  'Line width must be between 2.5 and 5 cm.');
assert.equal(failure(Object.assign(base(), { coverage: '' })),
  'Enter the paint coverage, such as 10.');
assert.equal(failure(Object.assign(base(), { coverage: 'lots' })),
  'Enter the paint coverage as a number, such as 10.');
assert.equal(failure(Object.assign(base(), { coverage: '0.5' })),
  'Paint coverage must be between 1 and 50 m\u00b2 per litre.');
assert.equal(failure(Object.assign(base(), { coverage: '51' })),
  'Paint coverage must be between 1 and 50 m\u00b2 per litre.');
assert.equal(failure({}), 'Choose "doubles" for a combined court or "singles" for a singles-only court.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 1);
assert.match(record.sources[0].url, /^https:\/\/www\.itftennis\.com\/media\/7221\//);
assert.ok(record.method.length > 500, 'the method explains the arithmetic');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 53, 'Sports & Outdoors count');
assert.equal(catalog.tools.length, 2431, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2170, 'public total');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 10 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.calculate(testCase.input));
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: slug, name and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.slug === 'tennis-court-marking-calculator').length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Tennis Court Marking Calculator<\/h1>/);
assert.match(html, /<form id="tc-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 4, 'every control is labelled');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.match(html, /id="court"/);
assert.match(html, /id="width"[^>]*value="5"/, 'the default line width is in the markup');
assert.match(html, /id="coverage"[^>]*value="10"/, 'the default coverage is in the markup');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is sent or stored/i, 'the privacy note stays on the page');
assert.match(html, /min-height:44px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* tennis-court-core:start \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
for (const id of html.match(/getElementById\("([^"]+)"\)/g) || []) {
  const name = id.slice(16, -2);
  assert.ok(html.includes('id="' + name + '"'), 'the page defines #' + name);
}

console.log('tennis-court-marking-calculator: 300 model cases, formatter, ' +
  record.testCases.length + ' catalog cases, refusals, uniqueness and page contract OK');
