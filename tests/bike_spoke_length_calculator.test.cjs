/* Regression checks for the bike spoke length core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bike-spoke-length-calculator/index.html'), 'utf8');
const start = html.indexOf('/* spokecore:start */');
const end = html.indexOf('/* spokecore:end */');
assert.ok(start > -1 && end > start, 'spoke core markers missing');
const core = html.slice(start, end + '/* spokecore:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SpokeCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.analyse(input);

// The default is a 32-hole, 3-cross disc wheel on a 592 mm ERD rim.
const base = run({});
assert.equal(base.erd, 592);
assert.equal(base.spokes, 32);
assert.equal(base.crosses, 3);
assert.ok(Math.abs(base.theta - 67.5) < 1e-12);
assert.ok(Math.abs(base.left.exact - 286.755708) < 1e-6);
assert.ok(Math.abs(base.right.exact - 287.241316) < 1e-6);
assert.equal(base.left.rounded, 287);
assert.equal(base.right.rounded, 287);
assert.equal(base.recommendation.mode, 'same');

// Radial lacing has no tangential offset, so the spoke is the plain hypotenuse
// of the flange offset and the difference between the two radii.
const radial = run({ crosses: 0, leftCenter: 40, rightCenter: 40 });
const rimRadius = 592 / 2, flangeRadius = 58 / 2, lateral = 40, hole = 2.6;
assert.ok(Math.abs(radial.theta) < 1e-12);
assert.ok(Math.abs((radial.left.exact + hole / 2) - Math.sqrt(lateral * lateral + (rimRadius - flangeRadius) ** 2)) < 1e-9);
assert.ok(Math.abs(radial.left.chord - (rimRadius - flangeRadius)) < 1e-12);

// The lacing angle is 720 degrees divided by the holes per flange, times the crosses.
assert.ok(Math.abs(run({ spokes: 36, crosses: 3 }).theta - 60) < 1e-12);
assert.ok(Math.abs(run({ spokes: 32, crosses: 2 }).theta - 45) < 1e-12);
assert.ok(Math.abs(run({ spokes: 28, crosses: 3 }).theta - 720 * 3 / 28) < 1e-12);
assert.ok(Math.abs(run({ spokes: 36, crosses: 6 }).theta - 120) < 1e-12);

// Mirroring the flange offsets swaps which side is longer, and equal flanges are equal.
const mirroredA = run({ leftCenter: 40, rightCenter: 20 });
const mirroredB = run({ leftCenter: 20, rightCenter: 40 });
assert.ok(Math.abs(mirroredA.left.exact - mirroredB.right.exact) < 1e-12);
assert.ok(Math.abs(mirroredA.right.exact - mirroredB.left.exact) < 1e-12);
const equal = run({ leftCenter: 31.5, rightCenter: 31.5 });
assert.ok(Math.abs(equal.left.exact - equal.right.exact) < 1e-12);

// A bigger rim needs a longer spoke, and a more tangential lacing pattern needs a longer spoke.
let previous = 0;
for (const erd of [480, 520, 560, 600, 640]) {
  const length = run({ erd }).left.exact;
  assert.ok(length > previous, 'spoke length grows with ERD');
  previous = length;
}
let previousCross = 0;
for (const crosses of [0, 1, 2, 3, 4]) {
  const length = run({ crosses }).left.exact;
  assert.ok(length > previousCross, 'spoke length grows with the cross count');
  previousCross = length;
}

// A larger spoke hole removes exactly half its diameter from each length.
assert.ok(Math.abs((run({ hole: 2.6 }).left.exact - run({ hole: 3.6 }).left.exact) - 0.5) < 1e-12);
assert.ok(Math.abs((run({ hole: 0 }).left.exact - run({ hole: 4 }).left.exact) - 2) < 1e-12);

// Rim offset shifts the spoke bed towards the right flange, so one side gains and the other loses.
const centred = run({ rimOffset: 0 });
const offset = run({ rimOffset: 5 });
assert.ok(offset.left.exact > centred.left.exact);
assert.ok(offset.right.exact < centred.right.exact);
assert.equal(offset.left.lateral, 33 + 5);
assert.equal(offset.right.lateral, 37 - 5);
const extreme = run({ rimOffset: 30, rightCenter: 20 });
assert.equal(extreme.right.lateral, -10);
assert.equal(extreme.recommendation.mode, 'two-sizes');

// Whole-millimetre advice follows the documented one, two and three-plus millimetre rules.
const twoSizes = run({ erd: 600, spokes: 36, leftCenter: 45, rightCenter: 15, leftFlange: 45, rightFlange: 45 });
assert.equal(twoSizes.recommendation.mode, 'two-sizes');
assert.equal(twoSizes.recommendation.left, 292);
assert.equal(twoSizes.recommendation.right, 288);
assert.match(twoSizes.recommendation.text, /292 mm for the left side and 288 mm for the right side/);
const average = run({ erd: 600, spokes: 36, leftCenter: 40, rightCenter: 20, leftFlange: 45, rightFlange: 45 });
assert.equal(average.recommendation.mode, 'average');
assert.equal(average.recommendation.left, 290);
const longer = run({ erd: 600, spokes: 36, leftCenter: 36, rightCenter: 20, leftFlange: 45, rightFlange: 45 });
assert.equal(longer.recommendation.mode, 'longer');
assert.equal(longer.recommendation.left, 290);
assert.equal(longer.recommendation.right, 290);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ erd: '' }), /Effective rim diameter is required\./);
assert.throws(() => run({ erd: 'wide' }), /Effective rim diameter must be a number between 200 and 800 mm\./);
assert.throws(() => run({ erd: 150 }), /Effective rim diameter must be between 200 and 800 mm\./);
assert.throws(() => run({ erd: 900 }), /Effective rim diameter must be between 200 and 800 mm\./);
assert.throws(() => run({ spokes: 33 }), /Spoke count must be an even number, such as 32 or 36\./);
assert.throws(() => run({ spokes: 7 }), /Spoke count must be between 8 and 48\./);
assert.throws(() => run({ spokes: '32.5' }), /Spoke count must be a whole number between 8 and 48\./);
assert.throws(() => run({ crosses: 9 }), /Crosses must be between 0 and 8\./);
assert.throws(() => run({ crosses: 2.5 }), /Crosses must be a whole number between 0 and 8\./);
assert.throws(() => run({ leftFlange: 'all' }), /Left flange diameter must be a number between 20 and 120 mm\./);
assert.throws(() => run({ rightFlange: '' }), /Right flange diameter is required\./);
assert.throws(() => run({ leftCenter: -1 }), /Left flange to centre must be between 0 and 80 mm\./);
assert.throws(() => run({ hole: 7 }), /Spoke hole diameter must be between 0 and 6 mm\./);
assert.throws(() => run({ rimOffset: -1 }), /Rim offset must be between 0 and 30 mm\./);
assert.throws(() => run({ rimOffset: 40 }), /Rim offset must be between 0 and 30 mm\./);

// The page must not reach the network, store data or use inline handlers. The W3C SVG
// namespace string is an identifier, not a fetch, so it is ignored here.
const withoutSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutSvgNs.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/<textarea/i.test(html), 'page keeps the input surface to simple fields');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'bike-spoke-length-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 19, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');

const fields = {
  leftExact: (result) => result.left.exact,
  rightExact: (result) => result.right.exact,
  leftRounded: (result) => result.left.rounded,
  rightRounded: (result) => result.right.rounded,
  difference: (result) => result.difference,
  theta: (result) => result.theta,
  recommendationMode: (result) => result.recommendation.mode,
  purchaseLeft: (result) => result.recommendation.left,
  purchaseRight: (result) => result.recommendation.right
};
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 8);

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.analyse(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    const pick = fields[key];
    assert.ok(pick, 'unknown expected field ' + key);
    const actual = pick(result);
    if (typeof value === 'number' && (key === 'theta' || !Number.isInteger(value))) {
      assert.ok(Math.abs(actual - value) < 1e-6, testCase.name + ' ' + key);
    } else {
      assert.equal(actual, value, testCase.name + ' ' + key);
    }
  }
}

console.log('bike-spoke-length-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
