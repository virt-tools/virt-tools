/* Regression checks for the crochet flat circle planner: published round
   sequences, an independent radial-gauge oracle, exact stitch accounting and
   the page's accessible, offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'crochet-flat-circle-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* crochet-flat-circle-core:start */';
const endMarker = '/* crochet-flat-circle-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'crochet circle core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CrochetFlatCircleCore;', sandbox);
const C = sandbox.module.exports;
const defaults = { start: '6', rounds: '8', unit: 'cm', stitchGauge: '22', roundGauge: '24' };
const closeTo = (actual, expected, label, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon, `${label}: ${actual} vs ${expected}`);
function roundHalfUp(value, places) {
  const scale = 10 ** places;
  return Math.floor(value * scale + 0.5 + 1e-9) / scale;
}
function instruction(round, startCount) {
  if (round === 1) return `Work ${startCount} sts into the starting ring. (${startCount} sts)`;
  if (round === 2) return `2 sts in each st around. (${startCount} increases; ${startCount * 2} sts)`;
  return `(2 sts in next st, 1 st in each of next ${round - 2} sts) repeat ${startCount} times. (${startCount} increases; ${startCount * round} sts)`;
}
// Independently accumulate the radius and stitch total round by round. This
// does not use the page's closed forms, returned rows or intermediate values.
function oracle(input) {
  const value = { ...defaults, ...(input || {}) };
  const first = Number(value.start);
  const roundCount = Number(value.rounds);
  const span = value.unit === 'cm' ? 10 : 4;
  const roundGauge = Number(value.roundGauge);
  const stitchGauge = Number(value.stitchGauge);
  let radius = 0;
  let total = 0;
  let previous = 0;
  for (let round = 1; round <= roundCount; round += 1) {
    const count = round === 1 ? first : previous + first;
    assert.equal(count, first * round, 'published add-start-count sequence');
    radius += span / roundGauge;
    total += count;
    previous = count;
  }
  const diameter = radius * 2;
  const circumference = Math.PI * diameter;
  const finalStitches = first * roundCount;
  const edge = circumference / finalStitches;
  const gaugePitch = span / stitchGauge;
  return {
    finalStitches,
    totalStitches: total,
    diameter: roundHalfUp(diameter, 4),
    circumference: roundHalfUp(circumference, 4),
    edgeStitchPitch: roundHalfUp(edge, 4),
    gaugeStitchPitch: roundHalfUp(gaugePitch, 4),
    pitchDifferencePct: roundHalfUp((edge / gaugePitch - 1) * 100, 2),
    finalInstruction: instruction(roundCount, first),
  };
}
const calculate = (input) => C.plan(input);
const failure = (input) => {
  try { calculate(input); } catch (error) { return error.message; }
  return null;
};
function checkExpected(result, expected, label) {
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') closeTo(result[key], value, `${label} ${key}`, 1e-8);
    else assert.equal(result[key], value, `${label} ${key}`);
  }
}
const base = calculate({});
assert.equal(base.finalStitches, 48);
assert.equal(base.totalStitches, 216);
assert.equal(base.diameter, 6.6667);
assert.equal(base.circumference, 20.944);
assert.equal(base.edgeStitchPitch, 0.4363);
assert.equal(base.gaugeStitchPitch, 0.4545);
assert.equal(base.pitchDifferencePct, -4.01);
assert.equal(base.rows.length, 8);
assert.equal(base.rows[0].instruction, 'Work 6 sts into the starting ring. (6 sts)');
assert.equal(base.rows[1].instruction, '2 sts in each st around. (6 increases; 12 sts)');
assert.equal(base.rows[2].instruction, '(2 sts in next st, 1 st in each of next 1 sts) repeat 6 times. (6 increases; 18 sts)');
assert.equal(base.pattern.split('\n').length, 8);
// Published 6-start sequence: 6, 12, 18, 24, 30. Published 12-start sequence:
// 12, 24, 36, 48, 60, 72. These are external examples, not self-derived goldens.
const six = calculate({ rounds: '5' });
assert.deepEqual(Array.from(six.rows, (row) => row.stitches), [6, 12, 18, 24, 30]);
const twelve = calculate({ start: '12', rounds: '6' });
assert.deepEqual(Array.from(twelve.rows, (row) => row.stitches), [12, 24, 36, 48, 60, 72]);
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Crochet Flat Circle Planner');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '🧶');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1200, 'method must document arithmetic, ranges and limits');
assert.equal(entry.sources.length, 3);
const kinds = Object.fromEntries(['golden', 'boundary', 'validation'].map((kind) =>
  [kind, entry.testCases.filter((testCase) => testCase.kind === kind).length]));
assert.deepEqual(kinds, { golden: 7, boundary: 5, validation: 16 });
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = calculate(testCase.input);
    checkExpected(result, testCase.expected, testCase.name);
    checkExpected(testCase.expected, oracle(testCase.input), `${testCase.name} independent oracle`);
  }
}
let gridRows = 0;
for (const unit of ['cm', 'in']) {
  for (const first of ['3', '6', '12', '24']) {
    for (const rounds of ['1', '2', '5', '8', '40']) {
      for (const [stitchGauge, roundGauge] of [['1', '100'], ['22', '24'], ['100', '1']]) {
        const input = { start: first, rounds, unit, stitchGauge, roundGauge };
        const result = calculate(input);
        checkExpected(result, oracle(input), JSON.stringify(input));
        assert.equal(result.rows.length, Number(rounds));
        let runningTotal = 0;
        result.rows.forEach((row, index) => {
          const number = index + 1;
          assert.equal(row.round, number);
          assert.equal(row.stitches, Number(first) * number);
          assert.equal(row.previousStitches, number === 1 ? 0 : Number(first) * (number - 1));
          assert.equal(row.increases, number === 1 ? 0 : Number(first));
          assert.equal(row.singlesBetween, number < 3 ? 0 : number - 2);
          if (number > 1) assert.equal(row.previousStitches + row.increases, row.stitches);
          assert.equal(row.instruction, instruction(number, Number(first)));
          runningTotal += row.stitches;
        });
        assert.equal(runningTotal, result.totalStitches);
        assert.ok(result.diameter > 0 && result.circumference > result.diameter);
        gridRows += 1;
      }
    }
  }
}
assert.equal(gridRows, 120);
// Exact gauge geometry, conversion preservation, inclusive bounds and parsing.
const matched = calculate({ start: '6', rounds: '6', stitchGauge: String(24 * 6 / (2 * Math.PI)), roundGauge: '24' });
assert.equal(matched.pitchDifferencePct, 0);
assert.equal(failure({ start: ' 003 ', rounds: ' 01 ', stitchGauge: ' 1 ', roundGauge: ' 100 ' }), null);
assert.equal(calculate({ start: '24', rounds: '40', stitchGauge: '100', roundGauge: '100' }).finalStitches, 960);
assert.equal(calculate({ unit: 'in', stitchGauge: '20', roundGauge: '24' }).diameter, 2.6667);
assert.equal(failure({ stitchGauge: 'NaN' }), 'Stitch gauge must be a number from 1 to 100.');
assert.equal(failure({ roundGauge: '-2' }), 'Round gauge must be a number from 1 to 100.');
assert.equal(failure({ start: '0x6' }), 'Starting stitches must be a whole number from 3 to 24.');
assert.equal(failure({ rounds: '08.0' }), 'Total rounds must be a whole number from 1 to 40.');
// The page stays self-contained, labelled, keyboard-operable and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(html.includes('<form id="circle-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('type="button" id="reset"'), 'reset button missing');
for (const id of ['start', 'rounds', 'unit', 'stitchGauge', 'roundGauge']) {
  assert.ok(html.includes(`id="${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="${id}"`), `label ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('min-height:44px'), 'controls need 44 px tap targets');
assert.ok(html.includes('@media(max-width:400px)'), 'mobile result rows must stack');
console.log(`Crochet flat circle: ${entry.testCases.length} catalog cases, ${gridRows} independent grid rows and published round sequences passed`);
