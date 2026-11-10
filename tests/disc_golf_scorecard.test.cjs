/* Regression checks for the disc golf scorecard core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/disc-golf-scorecard/index.html'), 'utf8');
const startMarker = '/* disc-golf-scorecard-core:start */';
const endMarker = '/* disc-golf-scorecard-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'disc golf core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = DiscGolfScorecardCore;', sandbox);
const C = sandbox.module.exports;

function completeInput(input = {}) {
  return {
    holeCount: input.holeCount === undefined ? 9 : input.holeCount,
    pars: input.pars || Array(9).fill(3),
    players: input.players || [{ name: 'Player 1', scores: Array(9).fill(null) }]
  };
}
function runCase(testCase) {
  const got = C.calculate(completeInput(testCase.input));
  return {
    holeCount: got.holeCount,
    totalPar: got.totalPar,
    totalScoresEntered: got.totalScoresEntered,
    names: Array.from(got.players, (player) => player.name),
    totals: Array.from(got.players, (player) => player.total),
    relatives: Array.from(got.players, (player) => player.relative),
    enteredCounts: Array.from(got.players, (player) => player.enteredCount),
    enteredPars: Array.from(got.players, (player) => player.enteredPar),
    scores: Array.from(got.players, (player) => Array.from(player.scores))
  };
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === 'disc-golf-scorecard');
assert.equal(records.length, 1, 'catalog entry exists exactly once');
const record = records[0];
assert.equal(record.name, 'Disc Golf Scorecard');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.testCases.length, 18, 'catalog has scoring, boundary and validation vectors');

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    let thrown = null;
    try { runCase(testCase); } catch (error) { thrown = error; }
    assert.ok(thrown, `${testCase.name}: expected an error`);
    assert.equal(thrown.message, testCase.expected.error, testCase.name);
    continue;
  }
  const actual = runCase(testCase);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.ok(key in actual, `${testCase.name}: unknown expected key ${key}`);
    assert.deepEqual(actual[key], expected, `${testCase.name}: ${key}`);
  }
}

assert.equal(C.formatRelative(null), '—');
assert.equal(C.formatRelative(0), 'E');
assert.equal(C.formatRelative(4), '+4');
assert.equal(C.formatRelative(-3), '−3');

// Independent whole-integer oracle over partial and complete randomized rounds.
let seed = 0xd15c601f;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
for (let iteration = 0; iteration < 250; iteration += 1) {
  const holeCount = iteration % 2 ? 18 : 9;
  const pars = Array.from({ length: holeCount }, () => 2 + Math.floor(random() * 5));
  const players = Array.from({ length: 1 + (iteration % 4) }, (_, playerIndex) => ({
    name: `P${playerIndex + 1}`,
    scores: pars.map(() => random() < 0.3 ? null : 1 + Math.floor(random() * 30))
  }));
  const got = C.calculate({ holeCount, pars, players });
  assert.equal(got.totalPar, pars.reduce((sum, par) => sum + par, 0));
  assert.equal(got.totalScoresEntered, players.flatMap((player) => player.scores).filter((score) => score !== null).length);
  got.players.forEach((player, playerIndex) => {
    const entered = players[playerIndex].scores.map((score, hole) => ({ score, par: pars[hole] })).filter((hole) => hole.score !== null);
    const expectedTotal = entered.reduce((sum, hole) => sum + hole.score, 0);
    const expectedPar = entered.reduce((sum, hole) => sum + hole.par, 0);
    assert.equal(player.total, expectedTotal);
    assert.equal(player.enteredPar, expectedPar);
    assert.equal(player.enteredCount, entered.length);
    assert.equal(player.relative, entered.length ? expectedTotal - expectedPar : null);
    assert.equal(player.total - player.enteredPar, player.relative === null ? 0 : player.relative);
  });
}

// CSV is derived from the calculated round, escapes spreadsheet cells and preserves blanks.
{
  const got = C.calculate({
    holeCount: 9,
    pars: [3, 4, 3, 3, 3, 3, 3, 3, 3],
    players: [
      { name: '=2+2', scores: [3, null, 2, null, null, null, null, null, null] },
      { name: 'Doe, "Jane"', scores: Array(9).fill(null) }
    ]
  });
  const csv = C.toCSV(got);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'Hole,Par,\'=2+2,"Doe, ""Jane"""');
  assert.equal(lines[1], '1,3,3,');
  assert.equal(lines[2], '2,4,,');
  assert.equal(lines[3], '3,3,2,');
  assert.equal(lines[10], 'Total (entered holes),,5,0');
  assert.equal(lines[11], 'Par (entered holes),,6,0');
  assert.equal(lines[12], 'To par,,−1,—');
  assert.equal(lines.length, 13);
  for (const name of ['+2', '-2', '@player']) {
    assert.ok(C.toCSV(C.calculate({ holeCount: 9, pars: Array(9).fill(3), players: [{ name, scores: Array(9).fill(null) }] })).split('\n')[0].includes(`'${name}`));
  }
  assert.throws(() => C.calculate({ holeCount: 9, pars: Array(9).fill(3), players: [{ name: '\tplayer', scores: Array(9).fill(null) }] }));
  assert.equal(C.summaryText(C.calculate({
    holeCount: 9,
    pars: Array(9).fill(3),
    players: [{ name: 'Alice', scores: [3, null, 2, null, null, null, null, null, null] }]
  })), 'Disc golf · 9 holes · par 27\nAlice: 5 throws · −1 to par · 2 of 9 holes');
}

// Strict parsing rejects non-integers and non-finite values, while blank scores stay blank.
for (const invalid of [0, 31, 1.5, '1e1', NaN, Infinity, {}, []]) {
  assert.throws(() => C.calculate({ holeCount: 9, pars: Array(9).fill(3), players: [{ name: 'A', scores: [invalid, ...Array(8).fill(null)] }] }));
}
for (const invalid of [8, 10, 0, '18.0', null]) {
  assert.throws(() => C.calculate(completeInput({ holeCount: invalid })));
}
assert.throws(() => C.calculate({ holeCount: undefined, pars: Array(9).fill(3), players: [{ name: 'A', scores: Array(9).fill(null) }] }));

// The shipped page remains local, uses unique static IDs and resolves literal lookups.
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

console.log(`disc-golf-scorecard: ${record.testCases.length} catalog cases, 250 independent rounds, CSV and page contracts passed`);
