/* Regression checks for the Corsi & Fenwick Calculator: catalog cases, the shipped Python
   oracle fixture, an independently written share model over a generated sweep, notation,
   the page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'corsi-fenwick-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* cfc-core:start */';
const endMarker = '/* cfc-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = CorsiCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Corsi & Fenwick Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('corsi') && record.tags.includes('fenwick') && record.tags.includes('pdo'));
assert.ok(record.method.length > 900, 'method records the arithmetic');
assert.ok(record.guidance.length < 500, 'guidance stays a banner');
assert.ok(Array.isArray(record.sources) && record.sources.length === 3, 'three sources are recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 60, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('Corsi_(statistic)')), 'Corsi source');
assert.ok(record.sources.some((source) => source.url.includes('Fenwick_(statistic)')), 'Fenwick source');
assert.ok(record.sources.some((source) => source.url.includes('Analytics_(ice_hockey)')), 'PDO source');

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
const NUMERIC = ['corsiFor', 'corsiAgainst', 'corsiDiff', 'corsiPct', 'fenwickFor', 'fenwickAgainst',
  'fenwickDiff', 'fenwickPct', 'shootingPct', 'savePct', 'pdo'];
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`);
    continue;
  }
  const result = run(testCase.input);
  for (const key of NUMERIC) {
    assert.ok(key in testCase.expected, `${testCase.name}: ${key} is pinned`);
    assert.equal(result[key], testCase.expected[key], `${testCase.name}: ${key}`);
  }
  assert.equal(result.headline, result.corsiPct.toFixed(1) + '%', `${testCase.name}: headline`);
  assert.ok(result.rows.length === 5, `${testCase.name}: five component rows`);
  assert.equal(result.rows.filter((row) => row.total).length, 2, `${testCase.name}: two totals`);
}
assert.equal(kinds.golden, 7, 'seven golden cases');
assert.equal(kinds.boundary, 5, 'five boundary cases');
assert.equal(kinds.validation, 9, 'nine validation cases');
assert.equal(record.testCases.length, 21, 'twenty-one catalog cases');

// ---- Independently written oracle fixture: exact rational arithmetic, half-up to 0.1. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/corsi_fenwick_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 24, 'twenty-four oracle fixtures');
for (const testCase of fixture.cases) {
  const result = run(testCase.input);
  for (const key of NUMERIC) {
    assert.equal(result[key], testCase.expected[key], `fixture ${testCase.name}: ${key}`);
  }
}

// ---- Second model in this file: shares from ratios rather than the page's 100*for/total. ----
const round1 = (value) => Math.round(value * 10 + 1e-9) / 10;
const model = (c) => {
  const cf = c.shotsFor + c.missedFor + c.blockedFor;
  const ca = c.shotsAgainst + c.missedAgainst + c.blockedAgainst;
  const ff = c.shotsFor + c.missedFor;
  const fa = c.shotsAgainst + c.missedAgainst;
  return {
    corsiPct: round1((cf / (cf + ca)) * 100),
    fenwickPct: round1((ff / (ff + fa)) * 100),
    shootingPct: round1((c.goalsFor / c.shotsFor) * 100),
    savePct: round1(((c.shotsAgainst - c.goalsAgainst) / c.shotsAgainst) * 100),
  };
};
let seed = 20261127;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
let randomCases = 0;
for (let round = 0; round < 220; round++) {
  const shotsFor = 1 + Math.floor(random() * 60);
  const shotsAgainst = 1 + Math.floor(random() * 60);
  const input = {
    shotsFor,
    shotsAgainst,
    missedFor: Math.floor(random() * 25),
    missedAgainst: Math.floor(random() * 25),
    blockedFor: Math.floor(random() * 25),
    blockedAgainst: Math.floor(random() * 25),
    goalsFor: Math.floor(random() * (Math.min(shotsFor, 9) + 1)),
    goalsAgainst: Math.floor(random() * (Math.min(shotsAgainst, 9) + 1)),
  };
  const actual = run(input);
  const want = model(input);
  for (const key of Object.keys(want)) {
    assert.ok(Math.abs(actual[key] - want[key]) <= 0.11,
      `${key} at ${JSON.stringify(input)}: ${actual[key]} vs ${want[key]}`);
  }
  assert.equal(actual.corsiFor, input.shotsFor + input.missedFor + input.blockedFor, 'Corsi For sums the attempts');
  assert.equal(actual.corsiAgainst, input.shotsAgainst + input.missedAgainst + input.blockedAgainst, 'Corsi Against sums the attempts');
  assert.equal(actual.fenwickFor, actual.corsiFor - input.blockedFor, 'Fenwick For drops blocked attempts');
  assert.equal(actual.fenwickAgainst, actual.corsiAgainst - input.blockedAgainst, 'Fenwick Against drops blocked attempts');
  assert.ok(actual.corsiPct >= 0 && actual.corsiPct <= 100, 'a share stays between 0 and 100');
  assert.ok(actual.fenwickPct >= 0 && actual.fenwickPct <= 100, 'a share stays between 0 and 100');
  assert.ok(Math.abs(actual.pdo - (actual.shootingPct + actual.savePct)) <= 0.11, 'PDO is shooting plus save percentage');
  assert.ok(actual.warnings.every((warning) => typeof warning === 'string' && warning.length > 20), 'warnings are sentences');
  randomCases++;
}
assert.ok(randomCases === 220, 'every random case survives the refusals');

// ---- Notation, defaults, warnings and refusals. ----
const base = {
  shotsFor: 24, shotsAgainst: 18, missedFor: 9, missedAgainst: 7,
  blockedFor: 11, blockedAgainst: 8, goalsFor: 2, goalsAgainst: 1,
};
assert.equal(JSON.stringify(run({})), JSON.stringify(run(base)), 'empty input takes the documented defaults');
assert.equal(run({}).corsiPct, 57.1, 'default Corsi share');
assert.equal(run({}).pdo, 102.8, 'default PDO');
assert.equal(run({}).warnings.length, 0, 'the default carries no warning');
assert.equal(run({ shotsFor: ' 0024 ' }).corsiPct, 57.1, 'leading zeros and spaces parse as a count');
assert.equal(run({ shotsFor: '24', shotsAgainst: '18' }).corsiPct, 57.1, 'numeric strings parse');
const pdoNote = run({ goalsAgainst: 0 }).warnings;
assert.equal(pdoNote.length, 1, 'a PDO far from 100 warns');
assert.ok(pdoNote[0].includes('tends back toward 100'), 'the PDO warning names the regression');
const small = run({ shotsFor: 2, shotsAgainst: 1, missedFor: 1, missedAgainst: 0, blockedFor: 0, blockedAgainst: 0, goalsFor: 1, goalsAgainst: 1 });
assert.equal(small.warnings.length, 2, 'four attempts trip both warnings');
assert.ok(small.warnings[0].includes('4 shot attempts'), 'the small-sample warning counts the attempts');
assert.equal(run({ shotsFor: 10, shotsAgainst: 10, missedFor: 0, missedAgainst: 0, blockedFor: 0, blockedAgainst: 0, goalsFor: 0, goalsAgainst: 0 }).warnings.length, 0,
  'exactly twenty attempts is not a small sample');
assert.equal(run({ shotsFor: 9, shotsAgainst: 10, missedFor: 0, missedAgainst: 0, blockedFor: 0, blockedAgainst: 0, goalsFor: 0, goalsAgainst: 0 }).warnings.length, 1,
  'nineteen attempts is a small sample');
assert.ok(failure({ shotsFor: 0, goalsFor: 0 }).includes('at least one shot on goal for'), 'no shots for is refused');
assert.ok(failure({ shotsAgainst: 0, goalsAgainst: 0 }).includes('at least one shot on goal against'), 'no shots against is refused');
assert.ok(failure({ goalsFor: 25 }).includes('cannot exceed the shots on goal for'), 'a goal needs a shot for');
assert.ok(failure({ goalsAgainst: 19 }).includes('cannot exceed the shots on goal against'), 'a goal needs a shot against');
assert.ok(failure({ missedFor: 501 }).includes('between 0 and 500'), 'the cap is enforced');
assert.ok(failure({ missedFor: '1e2' }).includes('as a whole number'), 'exponent notation is not a count');
assert.ok(failure({ missedFor: '١٢' }).includes('as a whole number'), 'non-ASCII digits are refused');

// ---- Page contract. ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 3, 'one inline script plus theme-init and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 8, 'eight count fields');
const counts = ['shotsFor', 'shotsAgainst', 'missedFor', 'missedAgainst', 'blockedFor', 'blockedAgainst', 'goalsFor', 'goalsAgainst'];
for (const id of counts) {
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['shotsFor', 'missedFor', 'blockedFor', 'goalsFor']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
}
assert.equal((html.match(/aria-label="[^"]+ against"/g) || []).length, 4, 'each against input is labelled');
assert.ok(/id="cfc-out" aria-live="polite"/.test(html), 'live result region');
assert.ok(/id="cfc-warn" role="status"/.test(html), 'live warning region');
assert.ok(/<button type="submit">Work out the share<\/button>/.test(html), 'submit button');
assert.ok(html.includes('Corsi For %') && html.includes('Fenwick'), 'notes name the metrics');
assert.ok(html.includes('100&nbsp;%') || html.includes('50&nbsp;%'), 'the note explains the 50 % break-even share');
assert.ok(!/←\s*(?:All tools|Back to all tools)/.test(html), 'no page-level back link');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
for (const row of ['shotsFor', 'shotsAgainst', 'missedFor', 'missedAgainst', 'blockedFor', 'blockedAgainst', 'goalsFor', 'goalsAgainst']) {
  assert.ok(html.includes(`getElementById("${row}")`) || html.includes(`"${row}"`), `the page wires ${row}`);
}

// ---- Catalog integrity and duplicate-name guard. ----
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 58,
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

console.log(`${slug}: ${record.testCases.length} catalog cases, ${fixture.cases.length} oracle fixtures, ` +
  `${randomCases} random box scores match the share model, notation and page contract green`);
