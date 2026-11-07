/* Regression checks for the badminton scoring state machine in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/badminton-scorekeeper/index.html'), 'utf8');
const startMarker = '/* badminton-scorekeeper-core:start */';
const endMarker = '/* badminton-scorekeeper-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'badminton core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = BadmintonScorekeeperCore;', sandbox);
const C = sandbox.module.exports;

function rallySides(specification = '') {
  if (!specification) return [];
  return specification.trim().split(/\s+/).flatMap((token) => {
    const match = /^(\d+)?([AB])$/.exec(token);
    if (!match) throw new Error(`Unknown rally token ${token}.`);
    return Array(Number(match[1] || 1)).fill(match[2] === 'A' ? 0 : 1);
  });
}

function runCase(testCase) {
  const input = testCase.input;
  const state = C.makeState(input.firstServer);
  if (input.start) state.points = input.start.slice();
  let event = null;
  for (const side of rallySides(input.rallies)) event = C.awardPoint(state, side);
  return {
    points: Array.from(state.points),
    games: Array.from(state.games),
    history: Array.from(state.history, (game) => Array.from(game.points)),
    historyWinners: Array.from(state.history, (game) => game.winner),
    server: state.server,
    serviceCourt: C.serviceCourt(state),
    matchWinner: state.matchWinner,
    lastGameWinner: event ? event.gameWinner : null,
    lastMatchWinner: event ? event.matchWinner : null,
    changeEnds: event ? event.changeEnds : null
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'badminton-scorekeeper');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog has the full state-machine cases');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => runCase(testCase), new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), testCase.name);
    continue;
  }
  const actual = runCase(testCase);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, `${testCase.name}: ${key}`);
  }
}

// Exercise every legal winning score for either side, including all deuce finishes.
let finalScores = 0;
const finals = [];
for (let loser = 0; loser <= 19; loser += 1) finals.push([21, loser]);
for (let loser = 20; loser <= 28; loser += 1) finals.push([loser + 2, loser]);
finals.push([30, 29]);
for (const [winnerScore, loserScore] of finals) {
  for (const winner of [0, 1]) {
    const state = C.makeState(1 - winner);
    state.points = winner === 0 ? [winnerScore - 1, loserScore] : [loserScore, winnerScore - 1];
    const event = C.awardPoint(state, winner);
    const expectedPoints = winner === 0 ? [winnerScore, loserScore] : [loserScore, winnerScore];
    assert.equal(event.gameWinner, winner);
    assert.deepEqual(Array.from(state.history[0].points), expectedPoints);
    assert.deepEqual(Array.from(state.points), [0, 0]);
    assert.deepEqual(Array.from(state.games), winner === 0 ? [1, 0] : [0, 1]);
    assert.equal(state.server, winner, 'game winner serves next');
    finalScores += 1;
  }
}

// Boundary and input invariants beyond the catalog vectors.
for (const points of [[20, 20], [21, 20], [20, 21], [28, 29], [29, 28], [29, 29], [0, 0]]) {
  assert.equal(C.gameWinner(points), null, `${points.join('-')} must not end a game`);
}
for (const invalid of [-1, 2, '0', null, undefined]) {
  assert.throws(() => C.makeState(invalid), /Side must be A \(0\) or B \(1\)\./);
  const state = C.makeState(0);
  assert.throws(() => C.awardPoint(state, invalid), /Side must be A \(0\) or B \(1\)\./);
}
{
  const state = C.makeState(0);
  C.awardPoint(state, 0);
  assert.equal(C.serviceCourt(state), 'left');
  C.awardPoint(state, 1);
  assert.equal(C.serviceCourt(state), 'left');
  C.awardPoint(state, 1);
  assert.equal(C.serviceCourt(state), 'right');
}
{
  const state = C.makeState(0);
  for (const side of rallySides('18B 21A 19B 21A')) C.awardPoint(state, side);
  const completed = JSON.stringify(state);
  assert.equal(C.awardPoint(state, 0), null);
  assert.equal(C.awardPoint(state, 1), null);
  assert.equal(JSON.stringify(state), completed, 'completed match is immutable');
}
{
  // Reaching 11 in games one or two must not emit the third-game prompt.
  for (const sequence of ['11A', '18B 21A 11B']) {
    const state = C.makeState(0);
    let event = null;
    for (const side of rallySides(sequence)) event = C.awardPoint(state, side);
    assert.equal(event.changeEnds, false, sequence);
  }
}

console.log(`badminton-scorekeeper: all checks passed (${record.testCases.length} catalog cases, ${finalScores} legal final-score cases)`);
