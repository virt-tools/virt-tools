/* Regression checks for the Badminton Court Marking Calculator: catalog cases,
   an independent millimetre implementation over random inputs, number
   notation, the page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'badminton-court-marking-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* bcm-core:start */';
const endMarker = '/* bcm-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = BadmintonCourtCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Badminton Court Marking Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('badminton') && record.tags.includes('court-marking'));
assert.ok(record.method.length > 900, 'method records the arithmetic');
assert.ok(Array.isArray(record.sources) && record.sources.length >= 1, 'a source is recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 60, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('bwfbadminton.com')), 'BWF source');

const run = (input) => C.calculate(input);
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.ok(result.lineTotal > 0 && result.paintArea > 0 && result.paintLitres > 0, `${testCase.name}: positive output`);
}
assert.equal(kinds.golden, 8, 'eight golden cases');
assert.equal(kinds.boundary, 4, 'four boundary cases');
assert.equal(kinds.validation, 12, 'twelve validation cases');
assert.equal(record.testCases.length, 24, 'twenty-four catalog cases');

// ---- Independent model in whole millimetres and exact rational rounding. ----
const DIM = {
  length: 13400,
  doublesWidth: 6100,
  singlesWidth: 5180,
  shortService: 1980,
  doublesLongInside: 760,
  centreLine: 13400 / 2 - 1980
};

function reference(input) {
  const court = input.court == null ? 'doubles' : input.court;
  const widthHundredths = input.lineWidth == null ? 400 : Math.round(Number(String(input.lineWidth).replace(',', '.')) * 100);
  const coverageHundredths = input.coverage == null ? 1000 : Math.round(Number(String(input.coverage).replace(',', '.')) * 100);
  const courtWidthMm = court === 'doubles' ? DIM.doublesWidth : DIM.singlesWidth;
  let totalMm = 2 * courtWidthMm;
  if (court === 'doubles') totalMm += 2 * DIM.length;
  totalMm += 2 * DIM.length;
  totalMm += 2 * DIM.singlesWidth;
  if (court === 'doubles') totalMm += 2 * DIM.doublesWidth;
  totalMm += 2 * DIM.centreLine;

  const product = BigInt(totalMm) * BigInt(widthHundredths); // millimetres squared times ten
  const roundHalfUp = (numerator, denominator) =>
    Number((2n * numerator + denominator) / (2n * denominator));
  const areaHundredths = roundHalfUp(product, 100000n);
  const litreThousandths = roundHalfUp(product, BigInt(100 * coverageHundredths));
  const widthMm = Math.round(courtWidthMm);
  const diagonalMm = Math.sqrt(DIM.length * DIM.length + widthMm * widthMm);
  const serviceDepthMm = court === 'doubles'
    ? DIM.length / 2 - DIM.shortService - DIM.doublesLongInside
    : DIM.length / 2 - DIM.shortService;
  return {
    court,
    courtWidth: courtWidthMm / 1000,
    lineTotal: totalMm / 1000,
    paintArea: areaHundredths / 100,
    paintLitres: litreThousandths / 1000,
    diagonal: Math.round(diagonalMm / 10) / 100,
    serviceCourtDepth: serviceDepthMm / 1000,
    serviceCourtWidth: (courtWidthMm / 2) / 1000
  };
}

let seed = 20261122;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
const randomInt = (min, max) => min + Math.floor(random() * (max - min + 1));

let randomCases = 0;
for (let round = 0; round < 200; round++) {
  const court = random() < 0.5 ? 'doubles' : 'singles';
  const widthHundredths = randomInt(200, 500);
  const coverageHundredths = randomInt(100, 5000);
  const input = {
    court,
    lineWidth: (widthHundredths / 100).toFixed(2),
    coverage: (coverageHundredths / 100).toFixed(2)
  };
  const actual = run(input);
  const expected = reference(input);
  for (const key of ['court', 'courtWidth', 'lineTotal', 'paintArea', 'paintLitres', 'diagonal',
    'serviceCourtDepth', 'serviceCourtWidth']) {
    assert.equal(actual[key], expected[key], `${JSON.stringify(input)} ${key}`);
  }
  randomCases++;
}
assert.equal(randomCases, 200);

// ---- Notation, defaults and the number branch. ----
const base = { court: 'doubles', lineWidth: '4', coverage: '10' };
assert.deepEqual(run({}), run(base), 'empty input takes the documented defaults');
assert.deepEqual(run({ lineWidth: 4, coverage: 10 }), run(base), 'integer numbers equal their strings');
assert.equal(run({ ...base, lineWidth: '4,5' }).paintArea, run({ ...base, lineWidth: '4.5' }).paintArea, 'decimal comma');
assert.equal(run({ ...base, lineWidth: '4e0' }).lineWidthCm, 4, 'exponent notation');
assert.equal(run({ ...base, coverage: ' 10 ' }).paintLitres, 0.391, 'spaces are trimmed');
assert.ok(failure({ ...base, lineWidth: '\u22124' }).includes('between 2 and 5 cm'), 'unicode minus is read as a sign');
assert.equal(run({ ...base, lineWidth: '2.50' }).paintArea, 2.45, 'trailing zero is accepted');
assert.ok(Array.isArray(run({}).rows) && run({}).rows.length === 6, 'combined court paints six line groups');
assert.ok(Array.isArray(run({ court: 'singles' }).rows) && run({ court: 'singles' }).rows.length === 4,
  'singles court paints four line groups');
assert.ok(run({ ...base, lineWidth: '4.5' }).warnings.length === 1, 'a non-compliant width warns');
assert.ok(run({ ...base, lineWidth: '4.5' }).warnings[0].includes('40 mm'), 'warning quotes Law 1.1');
assert.equal(run(base).warnings.length, 0, 'a 4 cm plan carries no warning');

// ---- Page contract. ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 3, 'one inline script plus theme-init and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 2, 'two text fields');
assert.equal((html.match(/<select\b/g) || []).length, 1, 'one court selector');
assert.equal((html.match(/<option\b/g) || []).length, 2, 'two court options');
for (const id of ['court', 'width', 'coverage']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(/id="bc-out" aria-live="polite"/.test(html), 'live result region');
assert.ok(/id="bc-warn" role="status"/.test(html), 'live warning region');
assert.ok(/<button type="submit">Mark out the court<\/button>/.test(html), 'submit button');
assert.ok(html.includes('40 mm') && html.includes('1.98 m') && html.includes('0.76 m'), 'notes carry the BWF figures');
assert.ok(html.includes('Diagram A') && html.includes('14.72'), 'notes name the diagram and the tape check');
assert.ok(!/←\s*(?:All tools|Back to all tools)/.test(html), 'no page-level back link');

// ---- Catalog integrity and duplicate-name guard. ----
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 56,
  'Sports & Outdoors count');
const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === record.slug) continue;
  for (const value of [tool.slug, tool.name, ...(tool.aliases || [])]) {
    names.set(String(value).toLowerCase(), tool.slug);
  }
}
for (const value of [record.slug, record.name, ...record.aliases]) {
  assert.equal(names.get(String(value).toLowerCase()), undefined, `duplicate name or alias: ${value}`);
}
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')));

console.log(`${slug}: ${record.testCases.length} catalog cases, ${randomCases} random plans match the independent millimetre model, notation and page contract green`);
