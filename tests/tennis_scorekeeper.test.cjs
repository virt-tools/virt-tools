/* Regression checks for the tennis scoring state machine in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/tennis-scorekeeper/index.html'), 'utf8');
const startMarker = '/* tennis-scorekeeper-core:start */';
const endMarker = '/* tennis-scorekeeper-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'tennis core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = TennisScorekeeperCore;', sandbox);
const C = sandbox.module.exports;

function pointSides(specification = '') {
  if (!specification) return [];
  return specification.trim().split(/\s+/).flatMap((token) => {
    const match = /^(\d+)?([AB])$/.exec(token);
    if (!match) throw new Error(`Unknown point token ${token}.`);
    return Array(Number(match[1] || 1)).fill(match[2] === 'A' ? 0 : 1);
  });
}

function runCase(testCase) {
  const input = testCase.input;
  const state = C.makeState();
  if (input.points) state.points = input.points.slice();
  if (input.games) state.games = input.games.slice();
  if (input.sets) state.sets = input.sets.slice();
  if (input.matchWinner !== undefined) state.matchWinner = input.matchWinner;
  let event = null;
  if (input.side !== undefined) {
    event = C.awardPoint(state, input.side);
  } else {
    for (const side of pointSides(input.pointsWon)) event = C.awardPoint(state, side);
  }
  return {
    points: Array.from(state.points),
    games: Array.from(state.games),
    sets: Array.from(state.sets),
    historyGames: Array.from(state.history, (set) => Array.from(set.games)),
    historyTiebreaks: Array.from(state.history, (set) => set.tiebreak ? Array.from(set.tiebreak) : null),
    historyWinners: Array.from(state.history, (set) => set.winner),
    labels: Array.from(C.pointLabels(state)),
    tiebreak: C.isTiebreak(state),
    matchWinner: state.matchWinner,
    lastGameWinner: event ? event.gameWinner : null,
    lastSetWinner: event ? event.setWinner : null,
    lastMatchWinner: event ? event.matchWinner : null
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'tennis-scorekeeper');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full state-machine cases');

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

// Exercise every legal regular-game and tiebreak final score for either player.
let finalScores = 0;
const regularFinals = [[4, 0], [4, 1], [4, 2]];
for (let loser = 3; loser <= 20; loser += 1) regularFinals.push([loser + 2, loser]);
for (const [winnerScore, loserScore] of regularFinals) {
  for (const winner of [0, 1]) {
    const state = C.makeState();
    state.points = winner === 0 ? [winnerScore - 1, loserScore] : [loserScore, winnerScore - 1];
    const event = C.awardPoint(state, winner);
    const expectedPoints = winner === 0 ? [winnerScore, loserScore] : [loserScore, winnerScore];
    assert.equal(event.gameWinner, winner);
    assert.equal(event.setWinner, null);
    assert.deepEqual(Array.from(state.points), [0, 0]);
    assert.deepEqual(Array.from(state.games), winner === 0 ? [1, 0] : [0, 1]);
    assert.equal(C.gameWinner(expectedPoints, false), winner);
    finalScores += 1;
  }
}
const tiebreakFinals = [];
for (let loser = 0; loser <= 5; loser += 1) tiebreakFinals.push([7, loser]);
for (let loser = 6; loser <= 20; loser += 1) tiebreakFinals.push([loser + 2, loser]);
for (const [winnerScore, loserScore] of tiebreakFinals) {
  for (const winner of [0, 1]) {
    const state = C.makeState();
    state.games = [6, 6];
    state.points = winner === 0 ? [winnerScore - 1, loserScore] : [loserScore, winnerScore - 1];
    const event = C.awardPoint(state, winner);
    const expectedPoints = winner === 0 ? [winnerScore, loserScore] : [loserScore, winnerScore];
    const expectedGames = winner === 0 ? [7, 6] : [6, 7];
    assert.equal(event.gameWinner, winner);
    assert.equal(event.setWinner, winner);
    assert.deepEqual(Array.from(state.history[0].games), expectedGames);
    assert.deepEqual(Array.from(state.history[0].tiebreak), expectedPoints);
    assert.deepEqual(Array.from(state.sets), winner === 0 ? [1, 0] : [0, 1]);
    assert.deepEqual(Array.from(state.points), [0, 0]);
    assert.deepEqual(Array.from(state.games), [0, 0]);
    assert.equal(C.gameWinner(expectedPoints, true), winner);
    finalScores += 1;
  }
}

// Boundary, input and full-match invariants beyond the catalog vectors.
for (const points of [[3, 3], [4, 3], [3, 4], [20, 20], [21, 20]]) {
  assert.equal(C.gameWinner(points, false), null, `regular game ${points.join('-')} must continue`);
}
for (const points of [[6, 6], [7, 6], [6, 7], [20, 20], [21, 20]]) {
  assert.equal(C.gameWinner(points, true), null, `tiebreak ${points.join('-')} must continue`);
}
for (const invalid of [-1, 2, '0', null, undefined]) {
  const state = C.makeState();
  assert.throws(() => C.awardPoint(state, invalid), /Player must be A \(0\) or B \(1\)\./);
}
{
  const state = C.makeState();
  for (const side of pointSides('48A')) C.awardPoint(state, side);
  assert.equal(state.matchWinner, 0);
  assert.deepEqual(Array.from(state.sets), [2, 0]);
  assert.deepEqual(Array.from(state.history, (set) => Array.from(set.games)), [[6, 0], [6, 0]]);
  const completed = JSON.stringify(state);
  assert.equal(C.awardPoint(state, 0), null);
  assert.equal(C.awardPoint(state, 1), null);
  assert.equal(JSON.stringify(state), completed, 'completed match is immutable');
}
{
  // Play two full sets, reach a third-set tiebreak entirely through legal games, then win it.
  const state = C.makeState();
  for (const side of pointSides('24A 24B 4A 4B 4A 4B 4A 4B 4A 4B 4A 4B 4A 4B 7A')) C.awardPoint(state, side);
  assert.equal(state.matchWinner, 0);
  assert.deepEqual(Array.from(state.sets), [2, 1]);
  assert.deepEqual(Array.from(state.history, (set) => Array.from(set.games)), [[6, 0], [0, 6], [7, 6]]);
  assert.deepEqual(Array.from(state.history[2].tiebreak), [7, 0]);
}

console.log(`tennis-scorekeeper: all checks passed (${record.testCases.length} catalog cases, ${finalScores} legal final-score cases)`);
