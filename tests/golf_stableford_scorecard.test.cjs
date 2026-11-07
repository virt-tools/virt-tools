/* Regression checks for the Stableford scorecard core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/golf-stableford-scorecard/index.html'), 'utf8');
const startMarker = '/* golf-stableford-core:start */';
const endMarker = '/* golf-stableford-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'Stableford core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = GolfStablefordCore;', sandbox);
const C = sandbox.module.exports;

const PARS = [4,4,3,5,4,4,5,3,4,4,5,4,3,4,5,4,3,4];
const INDEXES = [7,3,15,1,11,5,17,9,13,8,2,16,12,6,18,10,14,4];
function holes(input = {}) {
  if (input.holes) return input.holes;
  return PARS.map((par, i) => ({
    par: input.pars ? input.pars[i] : par,
    strokeIndex: input.strokeIndexes ? input.strokeIndexes[i] : INDEXES[i],
    gross: input.grossScores ? input.grossScores[i] : input.grossRelative === undefined ? par : par + input.grossRelative
  }));
}
function runCase(testCase) {
  const input = testCase.input;
  if (input.op === 'handicap') return { strokes: C.handicapStrokes(input.handicap, input.strokeIndex) };
  if (input.op === 'hole') {
    const got = C.calculateHole(input.handicap, input.hole);
    return { par: got.par, strokeIndex: got.strokeIndex, gross: got.gross, strokes: got.strokes, net: got.net, points: got.points };
  }
  const got = C.calculate({ handicap: input.handicap, holes: holes(input) });
  return {
    handicap: got.handicap,
    par: got.par,
    gross: got.gross,
    net: got.net,
    points: got.points,
    strokes: got.strokes,
    frontPoints: got.frontPoints,
    backPoints: got.backPoints,
    holePoints: Array.from(got.holes, (hole) => hole.points),
    holeStrokes: Array.from(got.holes, (hole) => hole.strokes)
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'golf-stableford-scorecard');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 25, 'catalog has scoring, allocation and validation cases');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => runCase(testCase), new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), testCase.name);
    continue;
  }
  const actual = runCase(testCase);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.ok(key in actual, `${testCase.name}: unknown expected key ${key}`);
    if (Array.isArray(expected)) assert.deepEqual(actual[key], expected, `${testCase.name}: ${key}`);
    else assert.equal(actual[key], expected, `${testCase.name}: ${key}`);
  }
}

// Every playing handicap allocates exactly that many strokes across the card.
for (let handicap = -18; handicap <= 54; handicap += 1) {
  const round = C.calculate({ handicap, holes: holes() });
  assert.equal(round.strokes, handicap, `handicap ${handicap} allocation total`);
  assert.equal(round.net, round.gross - handicap, `handicap ${handicap} net total`);
  for (const hole of round.holes) {
    assert.equal(hole.net, hole.gross - hole.strokes);
    assert.equal(hole.points, Math.max(0, 2 + hole.par - hole.net));
  }
  assert.equal(round.frontPoints + round.backPoints, round.points);
}

// Independent per-hole scoring boundaries, including zero-point truncation.
for (let par = 3; par <= 5; par += 1) {
  for (let gross = 1; gross <= 12; gross += 1) {
    const got = C.calculateHole(0, { par, strokeIndex: 18, gross });
    assert.equal(got.points, Math.max(0, 2 + par - gross), `scratch par ${par}, gross ${gross}`);
  }
}

// Each stroke index occurs once, allocation wraps after eighteen, and plus handicaps use hardest holes.
for (let index = 1; index <= 18; index += 1) {
  assert.equal(C.handicapStrokes(0, index), 0);
  assert.equal(C.handicapStrokes(18, index), 1);
  assert.equal(C.handicapStrokes(36, index), 2);
  assert.equal(C.handicapStrokes(54, index), 3);
  assert.equal(C.handicapStrokes(-18, index), -1);
  assert.equal(C.handicapStrokes(19, index), index === 1 ? 2 : 1);
  assert.equal(C.handicapStrokes(-1, index), index === 1 ? -1 : 0);
}

// Form values are parsed strictly and calculations are deterministic.
{
  const input = { handicap: ' +18 ', holes: holes().map((hole) => ({ par: String(hole.par), strokeIndex: String(hole.strokeIndex), gross: String(hole.gross) })) };
  const a = C.calculate(input);
  const b = C.calculate(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.handicap, 18);
}
for (const invalid of ['', ' ', 'abc', '1e1', '1.5', NaN, Infinity, null, undefined]) {
  assert.throws(() => C.playingHandicap(invalid));
}

console.log(`golf-stableford-scorecard: ${record.testCases.length} catalog cases plus allocation and scoring invariants passed`);
