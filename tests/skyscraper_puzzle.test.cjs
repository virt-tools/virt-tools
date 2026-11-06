/* Regression checks for the skyscraper puzzle core and its built puzzles. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/skyscraper-puzzle/index.html'), 'utf8');
const start = html.indexOf('/* towers:start */');
const end = html.indexOf('/* towers:end */');
assert.ok(start > -1 && end > start, 'towers core markers missing');
const core = html.slice(start, end + '/* towers:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TOWERS;', sandbox);
const T = sandbox.module.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runCase(tc) {
  const inp = tc.input;
  if (inp.op === 'visible') return { counts: inp.lines.map((line) => T.visible(line)) };
  if (inp.op === 'clues') {
    const clues = T.cluesFor(inp.solution);
    return {
      top: clues.top,
      bottom: clues.bottom,
      left: clues.left,
      right: clues.right,
      clueCount: T.clueCount(clues)
    };
  }
  if (inp.op === 'solve') {
    const result = T.countSolutions(inp.clues, inp.size, inp.limit);
    return { count: result.count, first: result.first, aborted: result.aborted };
  }
  if (inp.op === 'validate') return T.validate(inp.grid, inp.clues, inp.size);
  if (inp.op === 'line') return { ok: T.lineFeasible(inp.values, inp.clue, inp.size) };
  if (inp.op === 'targets') {
    const out = {};
    for (const level of Object.keys(T.LEVELS)) out[level] = T.targetClues(inp.size, level);
    return out;
  }
  throw new Error('unknown op ' + inp.op);
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = doc.tools.find((tool) => tool.slug === 'skyscraper-puzzle');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 10, 'catalog needs at least ten vectors');

let checked = 0;
for (const tc of entry.testCases) {
  const got = runCase(tc);
  for (const [key, want] of Object.entries(tc.expected)) {
    assert.ok(key in got, `${tc.name}: unknown expected key ${key}`);
    assert.deepEqual(plain(got[key]), plain(want), `${tc.name}: ${key}`);
  }
  checked += 1;
}

function latinCheck(solution, label) {
  const n = solution.length;
  const full = new Set();
  for (let i = 0; i < n; i += 1) {
    const row = new Set(solution[i]);
    const col = new Set(solution.map((r) => r[i]));
    assert.equal(row.size, n, `${label}: row ${i + 1} repeats a height`);
    assert.equal(col.size, n, `${label}: column ${i + 1} repeats a height`);
    for (const v of row) {
      assert.ok(v >= 1 && v <= n, `${label}: height ${v} outside 1..${n}`);
      full.add(v);
    }
  }
  assert.equal(full.size, n, `${label}: missing a height`);
}

function checkClues(clues, solution, label) {
  const n = solution.length;
  const full = T.cluesFor(solution);
  for (const side of ['top', 'bottom', 'left', 'right']) {
    assert.equal(clues[side].length, n, `${label}: ${side} clue count`);
    for (let i = 0; i < n; i += 1) {
      const value = clues[side][i];
      assert.ok(
        value === 0 || value === full[side][i],
        `${label}: ${side} clue ${i + 1} is ${value}, expected ${full[side][i]} or 0`
      );
    }
  }
}

/* Every generated puzzle must be solvable, unique, and match its own clues. */
for (const size of [4, 5]) {
  for (const level of ['easy', 'medium', 'hard']) {
    const puzzle = T.generate(size, level, mulberry32(size * 977 + level.length * 31 + 5));
    assert.ok(puzzle, `${size}x${size} ${level}: generation failed`);
    assert.equal(puzzle.size, size);
    assert.equal(puzzle.level, level);
    latinCheck(puzzle.solution, `${size}x${size} ${level} solution`);
    checkClues(puzzle.clues, puzzle.solution, `${size}x${size} ${level}`);
    assert.equal(puzzle.clueCount, T.clueCount(puzzle.clues), `${size}x${size} ${level}: clue count mismatch`);
    assert.equal(puzzle.clueCount, T.targetClues(size, level), `${size}x${size} ${level}: clue target not met`);
    assert.ok(puzzle.clueCount < 4 * size, `${size}x${size} ${level}: no clues were removed`);
    assert.ok(T.validate(puzzle.solution.flat(), puzzle.clues, size).ok, `${size}x${size} ${level}: solution fails validation`);
    const solved = T.countSolutions(puzzle.clues, size, 2);
    assert.equal(solved.aborted, false, `${size}x${size} ${level}: solver gave up`);
    assert.equal(solved.count, 1, `${size}x${size} ${level}: puzzle is not unique`);
    assert.deepEqual(plain(solved.first), plain(puzzle.solution), `${size}x${size} ${level}: solver found a different grid`);
  }
}

/* The 6x6 bank is used instead of a slow runtime search. */
for (const level of ['easy', 'medium', 'hard']) {
  const list = T.BANK['6'][level];
  assert.ok(Array.isArray(list) && list.length >= 6, `6x6 ${level}: bank too small`);
  for (const item of list) {
    const solution = [];
    for (let r = 0; r < 6; r += 1) {
      solution.push(item.s.slice(r * 6, r * 6 + 6).split('').map(Number));
    }
    latinCheck(solution, `6x6 ${level} bank`);
    const clues = {
      top: item.t.split('').map(Number),
      bottom: item.b.split('').map(Number),
      left: item.l.split('').map(Number),
      right: item.r.split('').map(Number)
    };
    checkClues(clues, solution, `6x6 ${level} bank`);
    assert.equal(item.c, T.clueCount(clues), `6x6 ${level} bank: stored clue count mismatch`);
    assert.ok(item.c < 24, `6x6 ${level} bank: no clues removed`);
    const result = T.validate(solution.flat(), clues, 6);
    assert.ok(result.ok && result.full, `6x6 ${level} bank: solution fails validation`);
  }
}

{
  const bankLevels = Object.keys(T.BANK['6']);
  assert.deepEqual(bankLevels.sort(), ['easy', 'hard', 'medium']);
  const averages = {};
  for (const level of bankLevels) {
    const counts = T.BANK['6'][level].map((item) => item.c);
    averages[level] = counts.reduce((a, b) => a + b, 0) / counts.length;
  }
  assert.ok(averages.easy > averages.medium, 'easy must carry more clues than medium');
  assert.ok(averages.medium > averages.hard, 'medium must carry more clues than hard');
}

/* A sample of the bank is re-solved from scratch to confirm uniqueness. */
for (const level of ['easy', 'medium', 'hard']) {
  const puzzle = T.generate(6, level, mulberry32(1));
  assert.ok(puzzle, `6x6 ${level}: bank lookup failed`);
  assert.equal(puzzle.size, 6);
  checkClues(puzzle.clues, puzzle.solution, `6x6 ${level} bank sample`);
  const solved = T.countSolutions(puzzle.clues, 6, 2);
  assert.equal(solved.aborted, false, `6x6 ${level}: solver gave up on a bank puzzle`);
  assert.equal(solved.count, 1, `6x6 ${level}: bank puzzle is not unique`);
  assert.deepEqual(plain(solved.first), plain(puzzle.solution), `6x6 ${level}: bank solution does not match the solver`);
}

{
  const first = T.generate(5, 'medium', mulberry32(4242));
  const second = T.generate(5, 'medium', mulberry32(4242));
  assert.deepEqual(plain(first), plain(second), 'same seed must rebuild the same puzzle');
  const fallback = T.generate(9, 'sideways', mulberry32(1));
  assert.equal(fallback.size, 5, 'unknown size falls back to 5x5');
  assert.equal(fallback.level, 'medium', 'unknown level falls back to medium');
  assert.equal(T.visible([]), 0);
  assert.equal(T.visible([0, 0]), 0);
  assert.equal(T.visible([2, 1]), 1);
  assert.equal(T.visible([1, 2]), 2);
  assert.equal(T.lineFeasible([0, 0, 0, 0], 1, 4), true, 'an empty line can still show one tower');
  assert.equal(T.lineFeasible([4, 3, 2, 1], 2, 4), false, 'a full line of one tower fails a two-tower clue');
  assert.equal(T.lineFeasible([4, 3, 0, 0], 0, 4), true, 'absent clues impose nothing');
}

{
  const grid = [1, 2, 3, 4, 2, 3, 4, 1, 3, 4, 1, 2, 4, 1, 2, 3];
  const clues = T.cluesFor([grid.slice(0, 4), grid.slice(4, 8), grid.slice(8, 12), grid.slice(12, 16)]);
  const wrong = grid.slice();
  wrong[0] = 2;
  const result = T.validate(wrong, clues, 4);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0, 'wrong grid must report at least one error');
  assert.equal(T.validate(grid, clues, 4).full, true);
  assert.equal(T.validate(new Array(16).fill(0), clues, 4).full, false);
  assert.equal(T.validate(new Array(16).fill(0), clues, 4).ok, false);
}

console.log(`skyscraper puzzle: ${checked} catalog vectors plus generated and bank invariants passed`);
