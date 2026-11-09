/* Regression checks for the volleyball rally-scoring and rotation state machine. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/volleyball-rotation-scorekeeper/index.html'), 'utf8');
const startMarker = '/* volleyball-rotation-scorekeeper-core:start */';
const endMarker = '/* volleyball-rotation-scorekeeper-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'volleyball core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = VolleyballRotationScorekeeperCore;', sandbox);
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
  const state = C.makeState(input.firstServer ?? 0, input.target ?? 25);
  if (input.start) state.points = input.start.slice();
  if (input.server !== undefined) state.server = input.server;
  let event = null;
  if (input.side !== undefined) event = C.awardRally(state, input.side);
  for (const side of rallySides(input.rallies)) event = C.awardRally(state, side);
  return {
    points: Array.from(state.points),
    server: state.server,
    rotations: Array.from(state.rotations),
    positionsA: Array.from(state.positions[0]),
    positionsB: Array.from(state.positions[1]),
    servingPlayers: [C.servingPlayer(state, 0), C.servingPlayer(state, 1)],
    winner: state.winner,
    rallies: state.rallies,
    lastSideOut: event ? event.sideOut : null,
    lastRotated: event ? event.rotated : null,
    lastSetWinner: event ? event.setWinner : null,
    changeEnds: event ? event.changeEnds : null
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'volleyball-rotation-scorekeeper');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 23, 'catalog has the complete state-machine vectors');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    let thrown = null;
    try {
      runCase(testCase);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, `${testCase.name}: expected an error`);
    assert.equal(thrown.message, testCase.expected.error, testCase.name);
    continue;
  }
  const actual = runCase(testCase);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, `${testCase.name}: ${key}`);
  }
}

// FIVB 6.2/6.3.2: enumerate ordinary and extended legal finishes for both teams.
let finalScores = 0;
for (const target of [25, 15]) {
  const finals = [];
  for (let loser = 0; loser <= target - 2; loser += 1) finals.push([target, loser]);
  for (let loser = target - 1; loser <= target + 15; loser += 1) finals.push([loser + 2, loser]);
  for (const [winnerScore, loserScore] of finals) {
    for (const winner of [0, 1]) {
      const state = C.makeState(winner, target);
      state.points = winner === 0 ? [winnerScore - 1, loserScore] : [loserScore, winnerScore - 1];
      const event = C.awardRally(state, winner);
      const expectedPoints = winner === 0 ? [winnerScore, loserScore] : [loserScore, winnerScore];
      assert.equal(event.setWinner, winner);
      assert.equal(event.sideOut, false);
      assert.deepEqual(Array.from(state.points), expectedPoints);
      assert.equal(state.winner, winner);
      const completed = JSON.stringify(state);
      assert.equal(C.awardRally(state, 1 - winner), null);
      assert.equal(JSON.stringify(state), completed, 'completed set is immutable');
      finalScores += 1;
    }
  }
}

// One-point leads and ties never finish a set, including well beyond the target.
for (const target of [25, 15]) {
  for (const score of [0, target - 1, target, target + 8, 80]) {
    assert.equal(C.setWinner([score, score], target), null);
    if (score > 0) {
      assert.equal(C.setWinner([score, score - 1], target), null);
      assert.equal(C.setWinner([score - 1, score], target), null);
    }
  }
}

// FIVB 7.6.2: independently derive every player slot from the number of side-outs.
// Starting player p occupies position p. Each clockwise rotation decrements its
// position, wrapping 1 to 6; equivalently, position q holds ((q-1+r) mod 6)+1.
for (let rotations = 0; rotations < 24; rotations += 1) {
  const state = C.makeState(0, 25);
  for (let index = 0; index < rotations; index += 1) C.rotate(state, 1);
  for (let position = 1; position <= 6; position += 1) {
    const expectedPlayer = ((position - 1 + rotations) % 6) + 1;
    assert.equal(state.positions[1][position - 1], expectedPlayer, `rotation ${rotations}, position ${position}`);
  }
  assert.equal(C.servingPlayer(state, 1), (rotations % 6) + 1);
  assert.deepEqual(Array.from(state.positions[0]), [1, 2, 3, 4, 5, 6], 'other team stays still');
}

// Randomized rallies checked against a separate score/server/rotation oracle.
let seed = 0x70b411;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
let simulatedRallies = 0;
for (let set = 0; set < 200; set += 1) {
  const target = set % 2 === 0 ? 25 : 15;
  const state = C.makeState(set % 2, target);
  const expectedPoints = [0, 0];
  const expectedRotations = [0, 0];
  let expectedServer = set % 2;
  let expectedRallies = 0;
  let courtChanges = 0;
  while (state.winner === null) {
    const beforeHigh = Math.max(expectedPoints[0], expectedPoints[1]);
    const side = random() < 0.5 ? 0 : 1;
    const expectedSideOut = side !== expectedServer;
    expectedPoints[side] += 1;
    expectedRallies += 1;
    if (expectedSideOut) {
      expectedServer = side;
      expectedRotations[side] += 1;
    }
    const event = C.awardRally(state, side);
    simulatedRallies += 1;
    assert.deepEqual(Array.from(state.points), expectedPoints);
    assert.equal(state.server, expectedServer);
    assert.deepEqual(Array.from(state.rotations), expectedRotations);
    assert.equal(state.rallies, expectedRallies);
    assert.equal(event.sideOut, expectedSideOut);
    assert.equal(event.rotated, expectedSideOut ? side : null);
    const expectedChange = target === 15 && beforeHigh < 8 && Math.max(...expectedPoints) === 8;
    assert.equal(event.changeEnds, expectedChange);
    if (expectedChange) courtChanges += 1;
    const expectedWinner = expectedPoints[0] >= target && expectedPoints[0] - expectedPoints[1] >= 2 ? 0 :
      (expectedPoints[1] >= target && expectedPoints[1] - expectedPoints[0] >= 2 ? 1 : null);
    assert.equal(state.winner, expectedWinner);
    assert.equal(event.setWinner, expectedWinner);
    for (let team = 0; team < 2; team += 1) {
      const players = Array.from(state.positions[team]);
      assert.deepEqual(players.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
      for (let position = 1; position <= 6; position += 1) {
        assert.equal(players[position - 1], ((position - 1 + expectedRotations[team]) % 6) + 1);
      }
    }
  }
  assert.ok(courtChanges <= 1, 'court change can only be emitted once');
}

for (const invalid of [-1, 2, '0', null, undefined]) {
  assert.throws(() => C.makeState(invalid, 25), /Team must be A \(0\) or B \(1\)\./);
  const state = C.makeState(0, 25);
  assert.throws(() => C.awardRally(state, invalid), /Team must be A \(0\) or B \(1\)\./);
  assert.throws(() => C.rotate(state, invalid), /Team must be A \(0\) or B \(1\)\./);
  assert.throws(() => C.servingPlayer(state, invalid), /Team must be A \(0\) or B \(1\)\./);
}
for (const invalid of [0, 14, 16, 21, 24, 26, '25', null, undefined]) {
  assert.throws(() => C.makeState(0, invalid), /Choose 25 or 15 points\./);
  assert.throws(() => C.setWinner([0, 0], invalid), /Choose 25 or 15 points\./);
}

// The shipped page remains local, uses unique IDs and resolves every literal lookup.
assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML)\b/);
assert.doesNotMatch(html, /\beval\s*\(/);
const ids = new Set();
for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
  assert.ok(!ids.has(match[1]), `duplicate id ${match[1]}`);
  ids.add(match[1]);
}
for (const match of html.matchAll(/document\.getElementById\("([^"]+)"\)/g)) {
  assert.ok(ids.has(match[1]), `missing literal id ${match[1]}`);
}
for (const prefix of ['a', 'b']) {
  for (let position = 1; position <= 6; position += 1) assert.ok(ids.has(`${prefix}-pos-${position}`));
}

console.log(`volleyball-rotation-scorekeeper: all checks passed (${record.testCases.length} catalog cases, ${finalScores} legal final-score cases, ${simulatedRallies} simulated rallies)`);
