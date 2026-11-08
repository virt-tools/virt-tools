/* Regression checks for the basketball possessions calculator: every catalog
   case is replayed against the page core, the box-score estimate and the four
   derived metrics are recomputed from the raw counts by a second route, the
   hand-worked examples are pinned, rounding and monotonic behaviour are
   asserted, and the page's offline and accessible contract is checked. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'basketball-possessions-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* basketball-core:start */');
const end = html.indexOf('/* basketball-core:end */');
assert.ok(start > -1 && end > start, 'basketball core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BasketballCore;', sandbox);
const B = sandbox.module.exports;

const design = (input) => B.design(input);
const failure = (input) => {
  try {
    design(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function base(overrides) {
  return Object.assign(
    { pts: '105', fga: '85', fta: '25', oreb: '10', tov: '14', minutes: '48' },
    overrides || {}
  );
}

const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8')
);
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.listed, true);
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.tags.includes('basketball'));

// --- every catalog case, replayed against the page core --------------------
const seen = new Set();
for (const testCase of entry.testCases) {
  assert.ok(!seen.has(testCase.name), 'duplicate case name ' + testCase.name);
  seen.add(testCase.name);
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = design(testCase.input);
    for (const key of Object.keys(testCase.expected)) {
      assert.deepEqual(result[key], testCase.expected[key],
        testCase.name + ': ' + key);
    }
  }
}
assert.ok(entry.testCases.length >= 35, 'catalog case count dropped');

// --- second route: recompute the box-score estimate and the four metrics
// from the raw counts without using any value the page returned. -----------
function strictlyWhole(raw) {
  const text = String(raw).trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  return Number(text);
}

function independent(input) {
  const pts = strictlyWhole(input.pts);
  const fga = strictlyWhole(input.fga);
  const fta = strictlyWhole(input.fta);
  const oreb = strictlyWhole(input.oreb);
  const tov = strictlyWhole(input.tov);
  const minutes = strictlyWhole(input.minutes);
  if ([pts, fga, fta, oreb, tov, minutes].some(function (value) { return value === null; })) {
    return null;
  }
  const freeThrows = 0.44 * fta;
  const possessions = fga + freeThrows - oreb + tov;
  if (possessions <= 0) return null;
  return {
    possessions,
    ppp: pts / possessions,
    ortg: (100 * pts) / possessions,
    pace: (48 * possessions) / minutes,
    turnoverRate: (100 * tov) / (fga + freeThrows + tov),
  };
}

for (const testCase of entry.testCases) {
  if (testCase.expectedError) continue;
  const expected = independent(testCase.input);
  assert.ok(expected, 'independent route rejected ' + testCase.name);
  const result = design(testCase.input);
  // The two routes must agree before either is rounded to display precision.
  assert.ok(Math.abs(expected.possessions - Number(testCase.input.fga)
    - 0.44 * Number(testCase.input.fta) + Number(testCase.input.oreb)
    - Number(testCase.input.tov)) < 1e-9, testCase.name);
  assert.ok(Math.abs(result.ortg - 100 * expected.ppp) <= 0.051, testCase.name);
  assert.ok(Math.abs(expected.ortg - result.ortg) <= 0.051, testCase.name);
  assert.ok(Math.abs(expected.pace - result.pace) <= 0.051, testCase.name);
  assert.ok(Math.abs(expected.turnoverRate - result.turnoverRate) <= 0.051,
    testCase.name + ': turnover rate');
  assert.ok(Math.abs(expected.ppp - result.ppp) <= 0.00051, testCase.name + ': ppp');
}

// --- hand-worked examples, written down before the code was trusted --------
const nba = design(base());
assert.equal(nba.possessions, 100);   // 85 + 11 - 10 + 14
assert.equal(nba.ppp, 1.05);          // 105 / 100
assert.equal(nba.ortg, 105);          // 100 * 1.05
assert.equal(nba.pace, 100);          // 48 * 100 / 48
assert.equal(nba.turnoverRate, 12.7); // 1400 / 110
assert.equal(nba.freeThrowPossessions, 11);

const fiba = design(base({ pts: '78', fga: '60', fta: '20', oreb: '8', tov: '12', minutes: '40' }));
assert.equal(fiba.possessions, 72.8);  // 60 + 8.8 - 8 + 12
assert.equal(fiba.ppp, 1.071);
assert.equal(fiba.ortg, 107.1);
assert.equal(fiba.pace, 87.4);         // 48 * 72.8 / 40
assert.equal(fiba.turnoverRate, 14.9); // 1200 / 80.8

// A single possession with no points must stay finite, not divide by zero.
const single = design(base({ pts: '0', fga: '1', fta: '0', oreb: '0', tov: '0' }));
assert.equal(single.possessions, 1);
assert.equal(single.ppp, 0);
assert.equal(single.ortg, 0);
assert.equal(single.pace, 1);
assert.equal(single.turnoverRate, 0);

// Monotonicity: an extra turnover adds a possession and cannot raise points
// per possession; an extra offensive rebound removes a possession and cannot
// lower it.
const anchor = design(base({ pts: '100', fga: '80', fta: '20', oreb: '10', tov: '12' }));
for (const delta of [1, 2, 5]) {
  const moreTurnovers = design(base({ pts: '100', fga: '80', fta: '20', oreb: '10', tov: String(12 + delta) }));
  const moreRebounds = design(base({ pts: '100', fga: '80', fta: '20', oreb: String(10 + delta), tov: '12' }));
  assert.ok(moreTurnovers.possessions > anchor.possessions);
  assert.ok(moreTurnovers.ppp < anchor.ppp);
  assert.ok(moreRebounds.possessions < anchor.possessions);
  assert.ok(moreRebounds.ppp > anchor.ppp);
}

// --- validation and input handling ----------------------------------------
const message = (overrides) => failure(base(overrides));
assert.equal(message({ pts: '' }), 'Points must be a whole number from 0 to 250.');
assert.equal(message({ fga: '0' }), 'Field goal attempts must be a whole number from 1 to 150.');
assert.equal(message({ fta: '-1' }), 'Free throw attempts must be a whole number from 0 to 100.');
assert.equal(message({ oreb: '61' }), 'Offensive rebounds must be a whole number from 0 to 60.');
assert.equal(message({ tov: '61' }), 'Turnovers must be a whole number from 0 to 60.');
assert.equal(message({ minutes: '0' }), 'Game length must be a whole number from 1 to 60 minutes.');
assert.equal(message({ fga: '85.5' }), 'Field goal attempts must be a whole number from 1 to 150.');
assert.equal(message({ pts: '1e2' }), 'Points must be a whole number from 0 to 250.');
assert.equal(message({ pts: null }), 'Points must be a whole number from 0 to 250.');
assert.equal(
  message({ pts: '0', fga: '1', fta: '0', oreb: '60', tov: '0' }),
  'These counts imply zero or negative possessions. Check the attempts, rebounds and turnovers.'
);
// Leading zeros and surrounding whitespace are accepted and normalised.
assert.equal(design(base({ pts: '0105', fga: '085', fta: '025', oreb: '010', tov: '014', minutes: '048' })).possessions, 100);
assert.equal(design(base({ pts: ' 105 ', fga: ' 85 ', fta: ' 25 ', oreb: ' 10 ', tov: ' 14 ', minutes: ' 48 ' })).pace, 100);

// --- page contract --------------------------------------------------------
assert.ok(html.includes('<form id="poss-form"'), 'form missing');
assert.ok(html.includes('novalidate'), 'form should validate in script');
assert.ok(/aria-live="polite"/.test(html), 'results need a live region');
assert.ok(/role="alert"/.test(html), 'error needs an alert role');
assert.ok(/inputmode="numeric"/.test(html), 'numeric inputs need a numeric keyboard');
assert.ok(html.includes('/assets/app.js'), 'shared app script missing');
assert.ok(html.includes('/assets/theme-init.js'), 'theme init missing');
assert.ok(!/https?:\/\//.test(html), 'page must not reference external origins');
assert.ok(!/\son\w+=/i.test(html), 'inline event handlers are blocked by the CSP');
assert.ok(!/\beval\s*\(/.test(html), 'eval is blocked by the CSP');
assert.equal((html.match(/<label for="/g) || []).length, 6, 'every field needs a label');
assert.equal((html.match(/aria-describedby="/g) || []).length, 6, 'every field needs a hint');

console.log('basketball possessions calculator: ' + entry.testCases.length
  + ' catalog cases, second-route recomputation, hand checks and page contract pass');
