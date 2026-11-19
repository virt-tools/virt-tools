/* soccer pitch marking: catalog fixtures, Law 1 geometry and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'soccer-pitch-marking-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* soccer-pitch-core:start */';
const endMarker = '/* soccer-pitch-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = SoccerPitchCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one soccer pitch marking calculator');
const record = records[0];
assert.equal(record.name, 'Soccer Pitch Marking Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 700, 'method documents the Law 1 geometry, the arc and the paint arithmetic');
assert.match(record.method, /40\.32/);
assert.match(record.method, /18\.32/);
assert.match(record.method, /16\.9445/);
assert.equal(record.sources.length, 1);
assert.equal(record.sources[0].url, 'https://www.theifab.com/laws/latest/the-field-of-play/');
assert.match(record.sources[0].title, /Law 1/);
assert.equal(record.testCases.length, 25);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 7);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 3);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 15);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2139, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 51, 'Sports & Outdoors count');
// No other record claims this name, slug or any alias.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
}

function failure(input) {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label, tolerance) {
  const tol = tolerance === undefined ? 1e-6 : tolerance;
  assert.ok(Math.abs(actual - expected) <= tol, label + ': expected ' + expected + ', got ' + actual);
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  const expected = testCase.expected;
  for (const key of Object.keys(expected)) {
    if (key === 'parts') {
      for (const part of Object.keys(expected.parts)) {
        near(result.parts[part], expected.parts[part], testCase.name + ': ' + part);
      }
    } else if (typeof expected[key] === 'boolean' || key === 'marks' || key === 'lineWidthCm') {
      assert.equal(result[key], expected[key], testCase.name + ': ' + key);
    } else {
      near(result[key], expected[key], testCase.name + ': ' + key);
    }
  }
}

// Law 1 geometry: the fixed markings derive from the 7.32 m goal.
const base = C.analyse({});
near(base.goalAreaWidth, 18.32, 'goal area width');
near(base.penaltyAreaWidth, 40.32, 'penalty area width');
near(base.penaltyAreaWidth, 7.32 + 2 * 16.5, 'penalty area is 16.5 m from each post');
near(base.goalAreaWidth, 7.32 + 2 * 5.5, 'goal area is 5.5 m from each post');

// The penalty arc is the part of the 9.15 m circle outside the area, derived here from its chord.
const d = 16.5 - 11;
const chordAngle = 2 * Math.asin(Math.sqrt(9.15 * 9.15 - d * d) / 9.15);
near(base.penaltyArc, chordAngle * 9.15, 'penalty arc agrees with the chord derivation');
assert.ok(base.penaltyArc > Math.PI * 9.15 / 2 && base.penaltyArc < Math.PI * 9.15,
  'the arc is more than a quarter circle but less than a semicircle');
near(base.centreCircle, 2 * Math.PI * 9.15, 'centre circle is the full circle');
near(base.cornerArc, Math.PI / 2, 'corner arc is a 1 m quarter circle');

// Totals are internally consistent and scale with the painted line width.
const parts = Object.values(base.parts);
near(base.totalLength, parts.reduce((a, b) => a + b, 0), 'total is the sum of its parts');
near(base.paintArea, base.totalLength * 0.12, 'paint area is length times width');
near(base.paintLitres, base.paintArea / base.coverage, 'litres are area over coverage');
const wide = C.analyse({lineWidthCm: 6});
near(wide.totalLength, base.totalLength, 'line width does not change the length');
near(wide.paintArea, base.paintArea / 2, 'half the line width halves the area');
const longer = C.analyse({length: 106});
near(longer.totalLength - base.totalLength, 2, 'each extra metre of touchline adds two metres of line');

// The international range is reported, not enforced.
assert.equal(C.analyse({length: 100, width: 64}).international, true);
assert.equal(C.analyse({length: 110, width: 75}).international, true);
assert.equal(C.analyse({length: 99, width: 68}).international, false);
assert.equal(C.analyse({length: 105, width: 63}).international, false);

// Numeric input is accepted alongside text, as a Node sweep passes numbers.
near(C.analyse({length: 105, width: 68, lineWidthCm: 12, coverage: 4}).paintArea, base.paintArea, 'numeric input');
assert.equal(failure({lineWidthCm: 12.5}), 'Line width must be above 0 and no more than 12 cm.');
assert.equal(failure({lineWidthCm: 0}), 'Line width must be above 0 and no more than 12 cm.');
near(C.analyse({lineWidthCm: 0.5}).paintArea, base.paintArea * 0.5 / 12, 'a half-centimetre line is accepted');
assert.equal(failure({length: 90, width: 90}), 'The touchline must be longer than the goal line.');
assert.equal(failure({length: 85, width: 68}), 'Touchline length must be between 90 and 120 m.');

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="pitch-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('type="button" class="ghost" id="reset"'), 'the reset control is not a submit button');
assert.ok(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('<div id="site-header"></div>'));
for (const id of ['in-length', 'in-width', 'in-line', 'in-coverage']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
}
for (const id of ['err', 'out', 'marking-rows', 'total-cell']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('id="in-length" inputmode="decimal" autocomplete="off" value="105"'));
assert.ok(html.includes('id="in-width" inputmode="decimal" autocomplete="off" value="68"'));
assert.ok(html.includes('id="in-line" inputmode="decimal" autocomplete="off" value="12"'));
assert.ok(html.includes('id="in-coverage" inputmode="decimal" autocomplete="off" value="4"'));
assert.match(html, /<table aria-label="Soccer pitch markings and line lengths">/);
assert.match(html, /<caption>Every Law 1 marking/);
console.log('soccer-pitch-marking-calculator: 25 catalog cases, Law 1 geometry, totals consistency and page contract passed');
