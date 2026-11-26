/* Regression checks for the Rugby Conversion Angle Calculator: catalog cases, the
   shipped Python oracle fixture, an independent vector model with a brute-force peak
   search, notation, the page contract and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'rugby-conversion-angle-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* rca-core:start */';
const endMarker = '/* rca-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = RugbyConversionCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Rugby Conversion Angle Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('rugby') && record.tags.includes('goal-posts'));
assert.ok(record.method.length > 900, 'method records the arithmetic');
assert.ok(record.guidance.length < 500, 'guidance stays a banner');
assert.ok(Array.isArray(record.sources) && record.sources.length === 2, 'two sources are recorded');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 60, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url.includes('Rugby_union_playing_field')), 'pitch source');
assert.ok(record.sources.some((source) => source.url.includes('Try_(rugby)')), 'conversion law source');

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
    assert.ok(message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.ok(result.angle > 0 && result.angle <= 180, `${testCase.name}: an angle between the posts`);
  assert.ok(result.rows.length >= 10 && result.rows.length <= 11, `${testCase.name}: ten or eleven table rows`);
  const best = result.rows.filter((row) => row.best);
  assert.equal(best.length, result.bestDistance == null ? 0 : 1, `${testCase.name}: one marked peak row`);
  if (best.length) assert.equal(best[0].angle, result.bestAngle, `${testCase.name}: the marked row holds the peak angle`);
}
assert.equal(kinds.golden, 7, 'seven golden cases');
assert.equal(kinds.boundary, 6, 'six boundary cases');
assert.equal(kinds.validation, 7, 'seven validation cases');
assert.equal(record.testCases.length, 20, 'twenty catalog cases');

// ---- Independently written oracle fixture: vector components, exact half-up rounding. ----
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/rugby_conversion_cases.json'), 'utf8'));
assert.equal(fixture.cases.length, 13, 'thirteen oracle fixtures');
for (const testCase of fixture.cases) {
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(result[key]), JSON.stringify(expected),
      `fixture ${testCase.name}: ${key}`);
  }
}

// ---- Second model in this file: real vectors and a brute-force peak search. ----
const refAngle = (x, y) => {
  const ux = 2.8 - x;
  const uy = y;
  const vx = -2.8 - x;
  const vy = y;
  return Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180 / Math.PI;
};
const round1 = (value) => Math.round(value * 10 + 1e-9) / 10;

let seed = 20261126;
const random = () => {
  seed = (seed * 48271) % 2147483647;
  return seed / 2147483647;
};
let randomCases = 0;
for (let round = 0; round < 160; round++) {
  const offset = Math.round(random() * 7000) / 100;
  const distance = Math.round(random() * 6000) / 100;
  if (distance === 0 && offset <= 2.8) continue;
  const actual = run({ offset, distance });
  assert.equal(actual.angle, round1(refAngle(offset, distance)), `angle ${offset},${distance}`);
  assert.equal(actual.nearPost, round1(Math.hypot(offset - 2.8, distance)), `near post ${offset},${distance}`);
  assert.equal(actual.distanceToPosts, round1(Math.hypot(offset, distance)), `to the centre ${offset},${distance}`);
  if (offset > 2.8) {
    let peakY = 0;
    let peakA = -1;
    for (let step = 0; step <= 6000; step++) {
      const back = step / 100;
      const angle = refAngle(offset, back);
      if (angle > peakA) {
        peakA = angle;
        peakY = back;
      }
    }
    assert.ok(Math.abs(peakY - actual.bestDistance) <= 0.06, `peak at ${offset}: ${peakY} vs ${actual.bestDistance}`);
    assert.ok(Math.abs(peakA - actual.bestAngle) <= 0.06, `peak angle at ${offset}: ${peakA} vs ${actual.bestAngle}`);
  } else {
    assert.equal(actual.bestDistance, null, `no interior peak at ${offset}`);
    assert.equal(actual.gain, null, `no gain at ${offset}`);
  }
  randomCases++;
}
assert.ok(randomCases > 140, 'enough random cases survived the refusal');

// ---- Notation, defaults and refusals. ----
const base = { offset: 20, distance: 10 };
assert.equal(JSON.stringify(run({})), JSON.stringify(run(base)), 'empty input takes the documented defaults');
assert.equal(run({ offset: 20, distance: 10 }).angle, 6.5, 'default angle');
assert.equal(run({ offset: 20, distance: 10 }).bestDistance, 19.8, 'default peak distance');
assert.equal(run({ offset: 20, distance: 10 }).bestAngle, 8, 'default peak angle');
assert.equal(run({ offset: 20, distance: 10 }).gain, 1.5, 'default gain');
assert.equal(run({ offset: '20,5', distance: '10' }).angle, run({ offset: 20.5, distance: 10 }).angle, 'decimal comma');
assert.equal(run({ offset: ' 20 ', distance: '1e1' }).angle, 6.5, 'spaces and exponent notation');
assert.ok(failure({ offset: '\u22121', distance: 10 }).includes('between 0 and 70 m'), 'unicode minus is a sign');
assert.ok(failure({ offset: 1, distance: 0 }).includes('right beside the ball'), 'goal-line kick is refused');
assert.ok(failure({ offset: 2.8, distance: 0 }).includes('right beside the ball'), 'in line with a post is refused');
assert.equal(run({ offset: 2.8, distance: 0.01 }).angle, 89.9, 'just behind the line the angle nears 90 degrees');
assert.equal(run({ offset: 70, distance: 60 }).warnings.length, 1, 'a clamped peak warns');
assert.ok(run({ offset: 70, distance: 60 }).warnings[0].includes('60 m'), 'the warning names the limit');
assert.equal(run(base).warnings.length, 0, 'an inside peak carries no warning');

// ---- Page contract. ----
assert.ok(html.includes('<html lang="en">'));
assert.equal((html.match(/<script/g) || []).length, 3, 'one inline script plus theme-init and app.js');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'exactly one inline script');
assert.ok(!/(?:src|href)="https?:\/\//.test(html), 'no external assets');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'WebSocket', 'indexedDB', 'navigator.sendBeacon']) {
  assert.ok(!html.includes(forbidden), `offline page does not use ${forbidden}`);
}
assert.equal((html.match(/<input\b/g) || []).length, 2, 'two number fields');
for (const id of ['offset', 'distance']) {
  assert.ok(html.includes(`<label for="${id}">`), `label for ${id}`);
  assert.ok(html.includes(`id="${id}"`), `control ${id}`);
}
assert.ok(/id="rca-out" aria-live="polite"/.test(html), 'live result region');
assert.ok(/id="rca-warn" role="status"/.test(html), 'live warning region');
assert.ok(/<button type="submit">Work out the angle<\/button>/.test(html), 'submit button');
assert.ok(html.includes('5.6 m') && html.includes('2.8') && html.includes('19.8'), 'notes carry the geometry');
assert.ok(html.includes('3 m up'), 'notes carry the crossbar height');
assert.ok(!/←\s*(?:All tools|Back to all tools)/.test(html), 'no page-level back link');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

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

console.log(`${slug}: ${record.testCases.length} catalog cases, ${fixture.cases.length} oracle fixtures, ` +
  `${randomCases} random stances match the brute-force vector model, notation and page contract green`);
