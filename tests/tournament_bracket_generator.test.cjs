/* Regression checks for the tournament bracket core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/tournament-bracket-generator/index.html'), 'utf8');
const start = html.indexOf('/* bracket-core:start */');
const end = html.indexOf('/* bracket-core:end */');
assert.ok(start > -1 && end > start, 'bracket core markers missing');
const core = html.slice(start, end + '/* bracket-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BracketCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'tournament-bracket-generator');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

const pairsOf = (bracket) => Array.from(bracket.rounds[0], (match) => [match.a, match.b]);
const plain = (value) => JSON.parse(JSON.stringify(value));

// The slot order is the standard bracket order and keeps the top two seeds apart.
assert.deepEqual(Array.from(C.standardOrder(2)), [1, 2]);
assert.deepEqual(Array.from(C.standardOrder(4)), [1, 4, 2, 3]);
assert.deepEqual(Array.from(C.standardOrder(8)), [1, 8, 4, 5, 2, 7, 3, 6]);
for (const size of [4, 8, 16, 32]) {
  const order = Array.from(C.standardOrder(size));
  assert.equal(order.length, size);
  assert.equal(new Set(order).size, size, `size ${size}: duplicate slot`);
  assert.equal(order[0], 1);
  assert.equal(order.indexOf(2), size / 2, `size ${size}: seed 2 is not in the second half`);
  for (let i = 0; i < size; i += 2) {
    assert.equal(order[i] + order[i + 1], size + 1, `size ${size}: pair does not sum to size + 1`);
  }
}

// Rounds take their names from the depth, not from a fixed table.
assert.equal(C.roundName(0, 1), 'Final');
assert.equal(C.roundName(0, 2), 'Semi-final');
assert.equal(C.roundName(1, 2), 'Final');
assert.equal(C.roundName(0, 3), 'Quarter-final');
assert.equal(C.roundName(0, 4), 'Round 1');
assert.equal(C.roundName(4, 5), 'Final');
assert.equal(C.roundName(3, 5), 'Semi-final');

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.buildBracket(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }

  const bracket = C.buildBracket(Object.assign({}, testCase.input));
  const expected = testCase.expected;
  for (const key of ['size', 'depth', 'byes', 'matches']) {
    assert.equal(bracket[key], expected[key], `${label}: ${key}`);
  }
  assert.deepEqual(pairsOf(bracket), plain(expected.pairs), `${label}: first-round pairs`);
  assert.deepEqual(
    plain(bracket.rounds.map((round, index) => C.roundName(index, bracket.depth))),
    expected.labels,
    `${label}: round labels`
  );
  assert.equal(bracket.names.length, bracket.teams, `${label}: names`);
  assert.equal(bracket.byes, bracket.size - bracket.teams, `${label}: byes`);
  assert.equal(bracket.matches, bracket.teams - 1, `${label}: matches`);
  assert.equal(bracket.rounds.length, bracket.depth, `${label}: round count`);
  for (let r = 0; r < bracket.rounds.length; r++) {
    assert.equal(bracket.rounds[r].length, bracket.size / Math.pow(2, r + 1), `${label}: round ${r} width`);
  }
  const byes = pairsOf(bracket).filter((pair) => pair[0] === null || pair[1] === null).length;
  assert.equal(byes, bracket.byes, `${label}: bye matches`);
  assert.ok(pairsOf(bracket).every((pair) => pair[0] !== null || pair[1] !== null), `${label}: empty match`);

  const resolved = C.resolve(bracket, {});
  assert.equal(resolved.champion, null, `${label}: champion without picks`);
  assert.ok(
    resolved.rounds[0].every((match) => (match.bye ? match.decided : !match.decided)),
    `${label}: bye handling`
  );

  if (testCase.picks) {
    const played = C.resolve(bracket, Object.assign({}, testCase.picks));
    assert.equal(played.champion, expected.champion, `${label}: champion`);
    assert.deepEqual(
      plain(played.rounds.map((round) => round.map((match) => [match.a, match.b]))),
      expected.rounds,
      `${label}: rounds with picks`
    );
    assert.deepEqual(
      plain(played.rounds.map((round) => round.map((match) => match.winner))),
      expected.winners,
      `${label}: winners`
    );
  }
}

// A pick whose team is not in that match is dropped, not carried into the bracket.
const four = C.buildBracket({ teams: '4', names: '', seeding: 'standard' });
const stale = C.resolve(four, { r0m0: 3, r1m0: 1 });
assert.deepEqual(Array.from(stale.dropped), ['r0m0']);
assert.equal(stale.rounds[0][0].winner, null);
assert.equal(stale.champion, null);
assert.deepEqual(Object.keys(stale.picks), []);

// Clearing a first-round pick removes the downstream pick that depended on it.
const fourPlayed = C.resolve(four, { r0m0: 1, r0m1: 2, r1m0: 2 });
assert.equal(fourPlayed.rounds[1][0].a, 1);
assert.equal(fourPlayed.rounds[1][0].b, 2);
assert.equal(fourPlayed.picks.r1m0, 2);
assert.equal(fourPlayed.champion, 2);
const removed = C.resolve(four, { r0m0: 1 });
assert.equal(removed.rounds[1][0].a, 1);
assert.equal(removed.rounds[1][0].b, null);
assert.equal(removed.picks.r1m0, undefined);
assert.equal(removed.champion, null);

// Entry order never leaves a first-round match empty, however many byes there are.
for (let teams = 2; teams <= 32; teams++) {
  const bracket = C.buildBracket({ teams: String(teams), names: '', seeding: 'entry' });
  const pairs = pairsOf(bracket);
  assert.equal(pairs.length, bracket.size / 2);
  assert.ok(pairs.every((pair) => pair[0] !== null || pair[1] !== null), `entry ${teams}: empty match`);
  assert.equal(pairs.filter((pair) => pair[1] === null).length, bracket.byes, `entry ${teams}: byes`);
  const seeds = pairs.flat().filter((seed) => seed !== null);
  assert.equal(new Set(seeds).size, teams, `entry ${teams}: every team appears once`);
}

// The copied text names every round and the champion.
const two = C.buildBracket({ teams: '2', names: 'Reds, Blues', seeding: 'standard' });
const text = C.bracketText(two, C.resolve(two, { r0m0: 2 }));
assert.match(text, /^Final\n  Reds v Blues\n\nChampion: Blues\n$/);
const eight = C.buildBracket({ teams: '8', names: '', seeding: 'standard' });
assert.match(C.bracketText(eight, C.resolve(eight, {})), /^Quarter-final\n/);

console.log('tournament bracket: ' + entry.testCases.length + ' catalog cases and core invariants passed');
