/* Regression checks for the golf course handicap calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/golf-course-handicap-calculator/index.html'), 'utf8');
const start = html.indexOf('/* golf-handicap-core:start */');
const end = html.indexOf('/* golf-handicap-core:end */');
assert.ok(start > -1 && end > start, 'golf handicap core markers missing');
const core = html.slice(start, end + '/* golf-handicap-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GolfHandicapCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = { index: 12.4, slope: 128, rating: 71.4, par: 72, allowance: 95, score: 85 };
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, pattern) => {
  assert.throws(() => C.calculate({ ...base, ...overrides }), pattern);
};

// 12.4 index at slope 128, rating 71.4, par 72: 13.446 -> 13 course, x 95% = 12.35 -> 12 playing.
const a = build();
near(a.courseExact, 13.44601769911505, 'base course exact');
assert.equal(a.courseHandicap, 13);
near(a.playingExact, 12.35, 'base playing exact');
assert.equal(a.playingHandicap, 12);
assert.equal(a.targetScore, 84);
near(a.differential, 12.0, 'base differential');
assert.equal(a.netScore, 73);
assert.equal(a.plus, false);

// The differential is the textbook formula and survives a round trip through the index.
near((113 / 128) * (85 - 71.4), 12.00625, 'differential formula');
near((a.differential - 0) / 1, 12.0, 'differential rounded to one decimal');

// Scratch player at a neutral course: everything is zero.
const scratch = build({ index: 0, slope: 113, rating: 72, par: 72, allowance: 100, score: 72 });
assert.equal(scratch.courseExact, 0);
assert.equal(scratch.courseHandicap, 0);
assert.equal(scratch.playingHandicap, 0);
assert.equal(scratch.targetScore, 72);
near(scratch.differential, 0, 'scratch differential');
assert.equal(scratch.netScore, 72);

// A plus handicap is entered as a negative index and gives a negative course handicap.
const plus = build({ index: -2.4, slope: 130, rating: 74.2, par: 72, allowance: 100, score: '' });
near(plus.courseExact, -0.5610619469026519, 'plus course exact');
assert.equal(plus.courseHandicap, -1);
near(plus.playingExact, -1, 'plus playing exact');
assert.equal(plus.playingHandicap, -1);
assert.equal(plus.targetScore, 71);
assert.equal(plus.differential, null);
assert.equal(plus.netScore, null);
assert.equal(plus.plus, true);

// Halves round away from zero in both directions.
assert.equal(C.roundHalfAway(10.5), 11);
assert.equal(C.roundHalfAway(-10.5), -11);
assert.equal(C.roundHalfAway(10.4999), 10);
assert.equal(build({ index: 10, slope: 113, rating: 72.5, par: 72, allowance: 100 }).courseHandicap, 11);
assert.equal(build({ index: -10, slope: 113, rating: 71.5, par: 72, allowance: 100 }).courseHandicap, -11);
assert.equal(build({ index: 0.4, slope: 113, rating: 72, par: 72, allowance: 100 }).courseHandicap, 0);

// The allowance scales the rounded course handicap, not the raw index.
const allow85 = build({ allowance: 85, score: '' });
assert.equal(allow85.courseHandicap, 13);
near(allow85.playingExact, 11.05, '85% playing exact');
assert.equal(allow85.playingHandicap, 11);
assert.equal(allow85.targetScore, 83);

// A higher index on a hard course: 24.8027 -> 25, x 95% = 23.75 -> 24.
const hard = build({ index: 18.7, slope: 139, rating: 73.8, par: 72, allowance: 95, score: 78 });
near(hard.courseExact, 24.80265486725663, 'hard course exact');
assert.equal(hard.courseHandicap, 25);
assert.equal(hard.playingHandicap, 24);
near(hard.differential, 3.4, 'hard differential');
assert.equal(hard.netScore, 54);

// A blank or missing score leaves both score-derived results empty.
for (const score of ['', '   ', undefined, null]) {
  const r = build({ score });
  assert.equal(r.score, null);
  assert.equal(r.differential, null);
  assert.equal(r.netScore, null);
}

// The boundary scores are accepted and the boundary ratings pass validation.
assert.equal(build({ score: 50 }).score, 50);
assert.equal(build({ score: 120 }).score, 120);
assert.equal(build({ slope: 55, score: '' }).slope, 55);
assert.equal(build({ slope: 155, score: '' }).slope, 155);
assert.equal(build({ index: -10, score: '' }).index, -10);
assert.equal(build({ index: 54, score: '' }).index, 54);
assert.equal(build({ allowance: 10, score: '' }).allowance, 10);
assert.equal(build({ allowance: 100, score: '' }).allowance, 100);

// Form strings normalise to the same numbers, including a leading plus sign.
const fromForm = C.calculate({ index: '12.4', slope: '128', rating: '71.4', par: '72', allowance: '95', score: '85' });
near(fromForm.courseExact, a.courseExact, 'form course exact');
assert.equal(fromForm.playingHandicap, a.playingHandicap);
assert.equal(C.calculate({ ...base, index: ' +2.4 ' }).index, 2.4);
assert.equal(C.calculate({ ...base, index: '.5' }).index, 0.5);

// Rejections: ranges, types, signs, blanks.
rejects({ index: 54.1 }, /Handicap index must be from -10 to 54/);
rejects({ index: -10.1 }, /Handicap index must be from -10 to 54/);
rejects({ index: 'abc' }, /Handicap index must be a number/);
rejects({ index: '--2' }, /Handicap index must be a number/);
rejects({ index: '' }, /Handicap index is required/);
rejects({ index: undefined }, /Handicap index is required/);
rejects({ slope: 54 }, /Slope rating must be from 55 to 155/);
rejects({ slope: 156 }, /Slope rating must be from 55 to 155/);
rejects({ slope: 'wide' }, /Slope rating must be a number/);
rejects({ slope: '-113' }, /Slope rating must be a number/);
rejects({ slope: '' }, /Slope rating is required/);
rejects({ rating: 49 }, /Course rating must be from 50 to 80/);
rejects({ rating: 81 }, /Course rating must be from 50 to 80/);
rejects({ rating: 'mid' }, /Course rating must be a number/);
rejects({ rating: '' }, /Course rating is required/);
rejects({ par: 59 }, /Par must be from 60 to 80/);
rejects({ par: 81 }, /Par must be from 60 to 80/);
rejects({ par: 'par' }, /Par must be a number/);
rejects({ par: '' }, /Par is required/);
rejects({ allowance: 9 }, /Handicap allowance must be from 10 to 100/);
rejects({ allowance: 101 }, /Handicap allowance must be from 10 to 100/);
rejects({ allowance: 'full' }, /Handicap allowance must be a number/);
rejects({ allowance: '' }, /Handicap allowance is required/);
rejects({ score: 49 }, /Gross score must be from 50 to 120/);
rejects({ score: 121 }, /Gross score must be from 50 to 120/);
rejects({ score: 'eighty' }, /Gross score must be a number/);
rejects({ score: '-85' }, /Gross score must be a number/);

// The limits are exposed so the page and the tests agree.
assert.equal(C.LIMITS.index.join(','), '-10,54,Handicap index');
assert.equal(C.LIMITS.slope.join(','), '55,155,Slope rating');
assert.equal(C.LIMITS.allowance.join(','), '10,100,Handicap allowance');

console.log('golf course handicap calculator: all assertions passed');
