/* Regression checks for the interval ear trainer core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/interval-ear-trainer/index.html'), 'utf8');
const start = html.indexOf('/* ear:start */');
const end = html.indexOf('/* ear:end */');
assert.ok(start > -1 && end > start, 'ear core markers missing');
const core = html.slice(start, end + '/* ear:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EAR;', sandbox);
const EAR = sandbox.module.exports;

function close(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) < 0.01, `${label}[${i}] -> ${actual[i]} != ${expected[i]}`);
  }
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
  if (inp.op === 'label') return { labels: inp.semitones.map((s) => EAR.label(s)) };
  if (inp.op === 'frequency') return { hz: inp.midi.map((m) => EAR.frequency(m)) };
  if (inp.op === 'sequence') return { hz: EAR.sequence(inp.question) };
  if (inp.op === 'check') return { results: inp.pairs.map(([q, g]) => EAR.check({ semitones: q }, g)) };
  if (inp.op === 'pool') return { semitones: EAR.LEVELS[inp.level].slice() };
  if (inp.op === 'score') {
    const score = EAR.makeScore();
    for (const ok of inp.answers) EAR.record(score, ok);
    return {
      asked: score.asked,
      correct: score.correct,
      streak: score.streak,
      best: score.best,
      accuracy: EAR.accuracy(score)
    };
  }
  throw new Error('unknown op ' + inp.op);
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = doc.tools.find((t) => t.slug === 'interval-ear-trainer');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 10, 'catalog needs at least ten vectors');

let checked = 0;
for (const tc of entry.testCases) {
  const got = runCase(tc);
  for (const [key, want] of Object.entries(tc.expected)) {
    assert.ok(key in got, `${tc.name}: unknown expected key ${key}`);
    if (Array.isArray(want)) {
      if (key === 'hz') close(got[key], want, tc.name);
      else assert.deepEqual(Array.from(got[key]), want, `${tc.name}: ${key}`);
    } else {
      assert.equal(got[key], want, `${tc.name}: ${key} -> ${got[key]}`);
    }
  }
  checked += 1;
}

/* Invariants beyond the catalog vectors. */
{
  assert.equal(EAR.INTERVALS.length, 12);
  const seen = new Set();
  for (const item of EAR.INTERVALS) {
    assert.ok(item.semitones >= 1 && item.semitones <= 12, 'bad semitone');
    assert.ok(!seen.has(item.semitones), 'duplicate interval');
    seen.add(item.semitones);
    assert.match(EAR.label(item.semitones), /^[A-Z][a-z]+(?: [a-z]+)? \([A-Za-z0-9]+\)$/);
  }
  assert.equal(EAR.label(99), 'Unknown interval');
  assert.equal(EAR.frequency(69), 440);
  assert.ok(Math.abs(EAR.frequency(81) - 880) < 1e-9, 'octave doubles frequency');
  assert.ok(EAR.frequency(72) > EAR.frequency(60), 'frequency rises with MIDI');
}
{
  const levels = Object.keys(EAR.LEVELS);
  assert.deepEqual(levels.sort(), ['advanced', 'beginner', 'intermediate']);
  const beginner = new Set(EAR.LEVELS.beginner);
  const intermediate = new Set(EAR.LEVELS.intermediate);
  const advanced = new Set(EAR.LEVELS.advanced);
  assert.equal(advanced.size, 12);
  for (const s of beginner) assert.ok(intermediate.has(s), 'beginner must nest inside intermediate');
  for (const s of intermediate) assert.ok(advanced.has(s), 'intermediate must nest inside advanced');
  for (const s of advanced) assert.ok(EAR.INTERVALS.some((i) => i.semitones === s), 'unknown pool semitone');
  for (const level of levels) {
    for (const s of EAR.LEVELS[level]) assert.ok(Number.isInteger(s), 'pool must hold integers');
  }
}
{
  const pools = [
    ['beginner', 55, 71],
    ['intermediate', 55, 71],
    ['advanced', 55, 71]
  ];
  for (const [level, lo, hi] of pools) {
    const pool = EAR.LEVELS[level];
    const rand = mulberry32(7);
    let previous = null;
    for (let i = 0; i < 400; i += 1) {
      const q = EAR.makeQuestion(pool, 'up', rand, previous);
      assert.ok(pool.includes(q.semitones), `question outside ${level} pool`);
      assert.equal(q.direction, 'up');
      assert.ok(q.root >= lo && q.root <= hi, `root ${q.root} outside ${lo}-${hi}`);
      assert.notEqual(q.semitones, previous, 'must not repeat the previous interval');
      const [a, b] = EAR.sequence(q);
      assert.ok(a > 0 && b > 0 && b > a, 'ascending sequence must rise');
      assert.ok(Math.abs(b / a - Math.pow(2, q.semitones / 12)) < 1e-9, 'frequency ratio');
      assert.ok(b < 1000, 'notes must stay in a comfortable range');
      previous = q.semitones;
    }
  }
  const downRand = mulberry32(11);
  let prev = null;
  for (let i = 0; i < 200; i += 1) {
    const q = EAR.makeQuestion(EAR.LEVELS.advanced, 'down', downRand, prev);
    assert.ok(q.root >= 60 && q.root <= 76, `descending root ${q.root} outside 60-76`);
    const [a, b] = EAR.sequence(q);
    assert.ok(a > b, 'descending sequence must fall');
    assert.ok(b >= 48, 'descending notes must stay audible');
    prev = q.semitones;
  }
  const harmonic = EAR.makeQuestion(EAR.LEVELS.advanced, 'together', mulberry32(3), null);
  assert.equal(harmonic.direction, 'together');
  assert.equal(EAR.sequence(harmonic).length, 2);
  assert.equal(EAR.makeQuestion([], 'sideways', mulberry32(1), null).direction, 'up', 'unknown direction falls back');
  assert.ok(EAR.LEVELS.advanced.includes(EAR.makeQuestion([], 'up', Math.random, null).semitones));
}
{
  const first = [];
  const second = [];
  const r1 = mulberry32(2026);
  const r2 = mulberry32(2026);
  for (let i = 0; i < 20; i += 1) {
    first.push(EAR.makeQuestion(EAR.LEVELS.advanced, 'up', r1, i === 0 ? null : first[i - 1].semitones));
    second.push(EAR.makeQuestion(EAR.LEVELS.advanced, 'up', r2, i === 0 ? null : second[i - 1].semitones));
  }
  assert.deepEqual(first, second, 'same seed must give the same questions');
  for (let i = 1; i < first.length; i += 1) {
    assert.notEqual(first[i].semitones, first[i - 1].semitones, 'no immediate repeats across a run');
  }
}
{
  const score = EAR.makeScore();
  assert.deepEqual({ ...score }, { asked: 0, correct: 0, streak: 0, best: 0 });
  assert.equal(EAR.accuracy(score), 0);
  for (let i = 0; i < 5; i += 1) EAR.record(score, true);
  assert.equal(score.best, 5);
  assert.equal(EAR.accuracy(score), 100);
  EAR.record(score, false);
  assert.equal(score.streak, 0);
  assert.equal(score.best, 5);
  assert.equal(EAR.accuracy(score), 83);
  for (let i = 0; i < 3; i += 1) EAR.record(score, true);
  assert.equal(score.best, 5, 'best survives later misses');
  assert.equal(score.streak, 3);
  const snapshot = JSON.parse(JSON.stringify(score));
  EAR.record(score, true);
  assert.deepEqual(snapshot, { asked: 9, correct: 8, streak: 3, best: 5 }, 'record must not mutate history');
}
{
  assert.equal(EAR.check(null, 7), false);
  assert.equal(EAR.check({}, 7), false);
  assert.equal(EAR.check({ semitones: 0 }, 0), true, 'unison is a valid exact match even if unasked');
  assert.equal(EAR.check({ semitones: 7 }, 7), true);
  assert.equal(EAR.check({ semitones: 7 }, '7'), false, 'string guesses do not match');
}

console.log(`interval ear trainer: ${checked} catalog vectors plus invariants passed`);
