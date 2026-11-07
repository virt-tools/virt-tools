/* Regression checks for the pickleball doubles scoring state machine in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/pickleball-scorekeeper/index.html'), 'utf8');
const startMarker = '/* pickleball-scorekeeper-core:start */';
const endMarker = '/* pickleball-scorekeeper-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'pickleball core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = PickleballScorekeeperCore;', sandbox);
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
  const state = C.makeState(input.firstServer ?? 0, input.target ?? 11);
  if (input.start) state.points = input.start.slice();
  if (input.server !== undefined) state.server = input.server;
  if (input.serverNumber !== undefined) state.serverNumber = input.serverNumber;
  let event = null;
  for (const side of rallySides(input.rallies)) event = C.awardRally(state, side);
  return {
    points: Array.from(state.points),
    server: state.server,
    serverNumber: state.serverNumber,
    serviceCourt: C.serviceCourt(state),
    scoreCall: C.scoreCall(state),
    winner: state.winner,
    rallies: state.rallies,
    lastPointFor: event ? event.pointFor : null,
    lastSecondServer: event ? event.secondServer : null,
    lastSideOut: event ? event.sideOut : null,
    lastGameWinner: event ? event.gameWinner : null
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'pickleball-scorekeeper');
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

// Every ordinary and deuce finish for either side and all supported targets.
let finalScores = 0;
for (const target of [11, 15, 21]) {
  const finals = [];
  for (let loser = 0; loser <= target - 2; loser += 1) finals.push([target, loser]);
  for (let loser = target - 1; loser <= target + 8; loser += 1) finals.push([loser + 2, loser]);
  for (const [winnerScore, loserScore] of finals) {
    for (const winner of [0, 1]) {
      const state = C.makeState(winner, target);
      state.points = winner === 0 ? [winnerScore - 1, loserScore] : [loserScore, winnerScore - 1];
      state.serverNumber = 1;
      const event = C.awardRally(state, winner);
      const expectedPoints = winner === 0 ? [winnerScore, loserScore] : [loserScore, winnerScore];
      assert.equal(event.gameWinner, winner);
      assert.equal(event.pointFor, winner);
      assert.deepEqual(Array.from(state.points), expectedPoints);
      assert.equal(state.winner, winner);
      const completed = JSON.stringify(state);
      assert.equal(C.awardRally(state, 1 - winner), null);
      assert.equal(JSON.stringify(state), completed, 'completed game is immutable');
      finalScores += 1;
    }
  }
}

// A one-point lead is not already a win; the next serving point makes it a two-point win.
for (const target of [11, 15, 21]) {
  for (const score of [target - 1, target, target + 4]) {
    for (const server of [0, 1]) {
      const state = C.makeState(server, target);
      state.points = server === 0 ? [score, score - 1] : [score - 1, score];
      assert.equal(C.gameWinner(state.points, target), null);
      const event = C.awardRally(state, server);
      assert.equal(event.gameWinner, server);
      assert.equal(state.winner, server);
    }
  }
}

// Receiving-side rally wins cannot change either score, regardless of rotation.
for (const firstServer of [0, 1]) {
  for (const serverNumber of [1, 2]) {
    const state = C.makeState(firstServer, 11);
    state.points = [7, 6];
    state.serverNumber = serverNumber;
    const event = C.awardRally(state, 1 - state.server);
    assert.deepEqual(Array.from(state.points), [7, 6]);
    assert.equal(event.pointFor, null);
    assert.equal(event.gameWinner, null);
    if (serverNumber === 1) {
      assert.equal(state.server, firstServer);
      assert.equal(state.serverNumber, 2);
      assert.equal(event.secondServer, true);
      assert.equal(event.sideOut, false);
    } else {
      assert.equal(state.server, 1 - firstServer);
      assert.equal(state.serverNumber, 1);
      assert.equal(event.secondServer, false);
      assert.equal(event.sideOut, true);
    }
  }
}

// Exercise mixed rally sequences and invariants beyond the catalog vectors.
let seed = 0x51de007;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
let simulatedRallies = 0;
for (let game = 0; game < 100; game += 1) {
  const target = [11, 15, 21][game % 3];
  const state = C.makeState(game % 2, target);
  while (state.winner === null) {
    const before = Array.from(state.points);
    const oldServer = state.server;
    const oldNumber = state.serverNumber;
    const side = random() < 0.5 ? 0 : 1;
    const event = C.awardRally(state, side);
    simulatedRallies += 1;
    assert.ok(state.points.every((value) => Number.isInteger(value) && value >= 0));
    assert.ok(state.server === 0 || state.server === 1);
    assert.ok(state.serverNumber === 1 || state.serverNumber === 2);
    assert.equal(C.serviceCourt(state), state.points[state.server] % 2 === 0 ? 'right' : 'left');
    assert.equal(C.scoreCall(state), `${state.points[state.server]}-${state.points[1 - state.server]}-${state.serverNumber}`);
    if (side === oldServer) {
      assert.equal(state.points[side], before[side] + 1);
      assert.equal(state.points[1 - side], before[1 - side]);
      assert.equal(state.server, oldServer);
      assert.equal(state.serverNumber, oldNumber);
    } else {
      assert.deepEqual(Array.from(state.points), before);
      if (oldNumber === 1) assert.equal(state.serverNumber, 2);
      else {
        assert.equal(state.server, 1 - oldServer);
        assert.equal(state.serverNumber, 1);
      }
    }
    if (state.winner !== null) {
      assert.ok(state.points[state.winner] >= target);
      assert.ok(state.points[state.winner] - state.points[1 - state.winner] >= 2);
      assert.equal(event.gameWinner, state.winner);
    }
  }
}

for (const invalid of [-1, 2, '0', null, undefined]) {
  assert.throws(() => C.makeState(invalid), /Side must be A \(0\) or B \(1\)\./);
  const state = C.makeState(0, 11);
  assert.throws(() => C.awardRally(state, invalid), /Side must be A \(0\) or B \(1\)\./);
}
for (const invalid of [0, 10, 12, 20, 22, '11', null, undefined]) {
  assert.throws(() => C.makeState(0, invalid), /Choose 11, 15 or 21 points\./);
}

console.log(`pickleball-scorekeeper: all checks passed (${record.testCases.length} catalog cases, ${finalScores} legal final-score cases, ${simulatedRallies} simulated rallies)`);
