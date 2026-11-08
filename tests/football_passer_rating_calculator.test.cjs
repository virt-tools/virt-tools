/* Regression checks for the NFL passer rating calculator: the catalogued
   cases, an independent recomputation over a grid of valid stat lines, the
   component caps and monotonicity, plus the page's offline, no-storage
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'football-passer-rating-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* passer-core:start */');
const end = html.indexOf('/* passer-core:end */');
assert.ok(start > -1 && end > start, 'passer core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PasserCore;', sandbox);
const C = sandbox.module.exports;

const CAP = 2.375;
const DEFAULTS = { attempts: 35, completions: 23, yards: 285, touchdowns: 2, interceptions: 1 };

const calculate = (input) => C.calculate(input);
const failure = (input) => {
  try {
    calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function roundHalfUp(value, places) {
  const factor = 10 ** places;
  return Math.floor(value * factor + 0.5) / factor;
}

// Independent transcription of the documented arithmetic: merge defaults,
// evaluate the four components, clamp each to 0..2.375, then scale.
function recompute(input) {
  const m = { ...DEFAULTS, ...(input || {}) };
  const att = Number(m.attempts);
  const comp = Number(m.completions);
  const yds = Number(m.yards);
  const td = Number(m.touchdowns);
  const ints = Number(m.interceptions);
  const clamp = (x) => Math.min(CAP, Math.max(0, x));
  const rawA = (comp / att - 0.3) * 5;
  const rawB = (yds / att - 3) * 0.25;
  const rawC = (td / att) * 20;
  const rawD = CAP - (ints / att) * 25;
  const a = clamp(rawA);
  const b = clamp(rawB);
  const c = clamp(rawC);
  const d = clamp(rawD);
  const clipped = [];
  if (rawA < 0 || rawA > CAP) clipped.push('completion percentage');
  if (rawB < 0 || rawB > CAP) clipped.push('yards per attempt');
  if (rawC > CAP) clipped.push('touchdown percentage');
  if (rawD < 0) clipped.push('interception percentage');
  return {
    attempts: att, completions: comp, yards: yds, touchdowns: td, interceptions: ints,
    completionPct: roundHalfUp(comp / att * 100, 1),
    yardsPerAttempt: roundHalfUp(yds / att, 2),
    touchdownPct: roundHalfUp(td / att * 100, 1),
    interceptionPct: roundHalfUp(ints / att * 100, 1),
    pointsA: roundHalfUp(a, 3), pointsB: roundHalfUp(b, 3),
    pointsC: roundHalfUp(c, 3), pointsD: roundHalfUp(d, 3),
    rating: roundHalfUp((a + b + c + d) / 6 * 100, 1),
    clipped
  };
}

// Defaults: 23 of 35 for 285 yards, two touchdowns and one interception.
const base = calculate({});
assert.equal(base.rating, 97.9);
assert.equal(base.completionPct, 65.7);
assert.equal(base.yardsPerAttempt, 8.14);
assert.equal(base.pointsA, 1.786);
assert.equal(base.pointsD, 1.661);
assert.equal(JSON.stringify(base.clipped), '[]', 'default line must not clip a component');

// A perfect line sits exactly on the 158.3 ceiling, and a hopeless one on zero.
assert.equal(calculate({ attempts: 20, completions: 20, yards: 400, touchdowns: 5, interceptions: 0 }).rating, 158.3);
assert.equal(calculate({ attempts: 1, completions: 0, yards: 0, touchdowns: 0, interceptions: 1 }).rating, 0);

// The catalogue records the same numbers the page computes.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F3C8}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
  }
}

// A deterministic grid walks the whole input space with valid cross-field
// combinations: completions plus interceptions never exceed attempts, and
// touchdown passes never exceed completions.
const attemptsSet = ['1', '2', '3', '10', '35', '100', '455', '1000', '2000'];
const yardSet = ['0', '1', '150', '285', '600', '5000', '100000'];
let rows = 0;
function checkRow(input) {
  const expected = recompute(input);
  const result = calculate(input);
  for (const field of ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions',
    'completionPct', 'yardsPerAttempt', 'touchdownPct', 'interceptionPct',
    'pointsA', 'pointsB', 'pointsC', 'pointsD', 'rating']) {
    assert.equal(result[field], expected[field], field + ' ' + JSON.stringify(input));
  }
  assert.equal(JSON.stringify(result.clipped), JSON.stringify(expected.clipped), 'clipped ' + JSON.stringify(input));
  assert.ok(result.rating >= 0 && result.rating <= 158.3, 'rating out of range');
  assert.ok(result.pointsA <= CAP && result.pointsB <= CAP && result.pointsC <= CAP && result.pointsD <= CAP);
  rows += 1;
}

for (let i = 0; i < attemptsSet.length; i += 1) {
  const attempts = Number(attemptsSet[i]);
  for (const completionShare of [0, 0.25, 0.5, 0.625, 0.775, 1]) {
    const completions = Math.round(attempts * completionShare);
    for (const touchdowns of [0, Math.floor(completions / 4), completions]) {
      for (const interceptions of [0, Math.floor((attempts - completions) / 2), attempts - completions]) {
        for (const yards of yardSet) {
          checkRow({
            attempts: String(attempts), completions: String(completions),
            yards, touchdowns: String(touchdowns), interceptions: String(interceptions)
          });
        }
      }
    }
  }
}
assert.ok(rows >= 500, 'grid must cover at least five hundred rows, got ' + rows);

// Monotonicity: more yards or another touchdown cannot lower the rating;
// another interception cannot raise it. Zeroing a component means the rating
// cannot drop below the value set by the other three.
const reference = { attempts: 40, completions: 24, yards: 260, touchdowns: 2, interceptions: 1 };
const refRating = calculate(reference).rating;
for (const extra of [1, 40, 400]) {
  assert.ok(calculate({ ...reference, yards: reference.yards + extra }).rating >= refRating,
    'extra yards lowered the rating by ' + extra);
}
assert.ok(calculate({ ...reference, touchdowns: 3 }).rating >= refRating, 'extra touchdown lowered the rating');
assert.ok(calculate({ ...reference, interceptions: 2 }).rating <= refRating, 'extra interception raised the rating');

// The caps are visible in the reported components and warnings feed.
const capped = calculate({ attempts: 10, completions: 7, yards: 500, touchdowns: 1, interceptions: 0 });
assert.equal(JSON.stringify(capped.clipped), '["yards per attempt"]');
assert.equal(capped.pointsB, CAP);
const floored = calculate({ attempts: 10, completions: 0, yards: 0, touchdowns: 0, interceptions: 0 });
assert.equal(JSON.stringify(floored.clipped),
  '["completion percentage","yards per attempt"]');
assert.equal(floored.rating, 39.6);

// Invalid inputs name the field and the permitted range.
assert.equal(failure({ attempts: '0' }), 'Pass attempts must be a whole number from 1 to 2000.');
assert.equal(failure({ attempts: '' }), 'Pass attempts is required.');
assert.equal(failure({ attempts: '35.0' }), 'Pass attempts must be a whole number from 1 to 2000.');
assert.equal(failure({ attempts: '3e1' }), 'Pass attempts must be a whole number from 1 to 2000.');
assert.equal(failure({ attempts: ' 35 ' }), null, 'surrounding whitespace must be accepted');
assert.equal(failure({ attempts: 20, completions: 21 }), 'Completions cannot exceed pass attempts.');
assert.equal(failure({ attempts: 20, completions: 10, touchdowns: 11 }), 'Touchdown passes cannot exceed completions.');
assert.equal(failure({ attempts: 20, completions: 10, interceptions: 11 }),
  'Completions plus interceptions cannot exceed pass attempts.');
assert.equal(failure({ yards: '-1' }), 'Passing yards must be a whole number from 0 to 100000.');
assert.equal(failure({ interceptions: '0.5' }), 'Interceptions must be a whole number from 0 to 2000.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="passer-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['attempts', 'completions', 'yards', 'touchdowns', 'interceptions']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  assert.ok(html.includes('aria-describedby="' + id + '-help"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + id + '-help"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'reset button must not submit the form');

console.log('Football passer rating: ' + entry.testCases.length + ' catalog cases, '
  + rows + ' grid rows and invariants passed');
