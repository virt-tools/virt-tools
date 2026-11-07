/* Regression checks for the chord quality ear trainer core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/chord-quality-ear-trainer/index.html'), 'utf8');
const start = html.indexOf('/* chord-ear:start */');
const end = html.indexOf('/* chord-ear:end */');
assert.ok(start > -1 && end > start, 'chord ear core markers missing');
const core = html.slice(start, end + '/* chord-ear:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CHORD_EAR;', sandbox);
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

function sequenceRandom(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function runCase(tc) {
  const inp = tc.input;
  if (inp.op === 'label') return { labels: inp.chords.map((id) => EAR.label(id)) };
  if (inp.op === 'frequency') return { hz: inp.midi.map((m) => EAR.frequency(m)) };
  if (inp.op === 'voicing') return { notes: EAR.midiNotes(inp.question) };
  if (inp.op === 'sequence') return { hz: EAR.sequence(inp.question) };
  if (inp.op === 'question') {
    const q = EAR.makeQuestion(inp.pool, inp.direction, sequenceRandom(inp.random), inp.previous || null);
    return { chord: q.chord, root: q.root, direction: q.direction, notes: EAR.midiNotes(q) };
  }
  if (inp.op === 'check') return { results: inp.pairs.map(([q, g]) => EAR.check({ chord: q }, g)) };
  if (inp.op === 'pool') return { chords: EAR.LEVELS[inp.level].slice() };
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
const entry = doc.tools.find((t) => t.slug === 'chord-quality-ear-trainer');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 12, 'catalog needs at least twelve vectors');

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
  assert.equal(EAR.CHORDS.length, 9);
  const seen = new Set();
  for (const item of EAR.CHORDS) {
    assert.ok(item.id && item.name && item.short, 'incomplete chord definition');
    assert.ok(!seen.has(item.id), 'duplicate chord id');
    seen.add(item.id);
    assert.equal(item.intervals[0], 0, 'root-position chord must start at zero');
    assert.ok(item.intervals.length === 3 || item.intervals.length === 4, 'only triads and seventh chords');
    for (let i = 1; i < item.intervals.length; i += 1) {
      assert.ok(item.intervals[i] > item.intervals[i - 1], 'chord intervals must strictly rise');
    }
    assert.ok(item.intervals[item.intervals.length - 1] <= 11, 'chord must stay within an octave');
    assert.ok(EAR.label(item.id).startsWith(item.name + ' ('));
  }
  assert.equal(EAR.label('unknown'), 'Unknown chord');
  assert.equal(EAR.frequency(69), 440);
  assert.ok(Math.abs(EAR.frequency(81) - 880) < 1e-9, 'octave doubles frequency');
  assert.deepEqual(Array.from(EAR.midiNotes(null)), []);
  assert.deepEqual(Array.from(EAR.midiNotes({ chord: 'major', root: 60.5 })), []);
}
{
  assert.deepEqual(Object.keys(EAR.LEVELS).sort(), ['mixed', 'sevenths', 'triads']);
  assert.equal(EAR.LEVELS.triads.length, 4);
  assert.equal(EAR.LEVELS.sevenths.length, 5);
  assert.equal(EAR.LEVELS.mixed.length, 9);
  for (const level of Object.keys(EAR.LEVELS)) {
    const unique = new Set(EAR.LEVELS[level]);
    assert.equal(unique.size, EAR.LEVELS[level].length, `${level} contains a duplicate`);
    for (const id of unique) {
      const chord = EAR.find(id);
      assert.ok(chord, `${level} contains an unknown chord`);
      assert.equal(chord.intervals.length, level === 'triads' ? 3 : level === 'sevenths' ? 4 : chord.intervals.length);
    }
  }
  for (const id of [...EAR.LEVELS.triads, ...EAR.LEVELS.sevenths]) {
    assert.ok(EAR.LEVELS.mixed.includes(id), `mixed set omits ${id}`);
  }
}
{
  for (const level of Object.keys(EAR.LEVELS)) {
    const pool = EAR.LEVELS[level];
    const rand = mulberry32(7);
    let previous = null;
    for (let i = 0; i < 400; i += 1) {
      const q = EAR.makeQuestion(pool, 'up', rand, previous);
      assert.ok(pool.includes(q.chord), `question outside ${level} pool`);
      assert.equal(q.direction, 'up');
      assert.ok(q.root >= 48 && q.root <= 60, `root ${q.root} outside 48-60`);
      assert.notEqual(q.chord, previous, 'must not repeat the previous chord');
      const notes = EAR.midiNotes(q);
      assert.equal(notes[0], q.root);
      assert.ok(notes[notes.length - 1] <= 71, 'top note must stay at or below B4');
      const hz = EAR.sequence(q);
      for (let n = 1; n < hz.length; n += 1) assert.ok(hz[n] > hz[n - 1], 'broken chord must rise');
      previous = q.chord;
    }
  }
  const downRand = mulberry32(11);
  let previous = null;
  for (let i = 0; i < 200; i += 1) {
    const q = EAR.makeQuestion(EAR.LEVELS.mixed, 'down', downRand, previous);
    const hz = EAR.sequence(q);
    for (let n = 1; n < hz.length; n += 1) assert.ok(hz[n] < hz[n - 1], 'descending chord must fall');
    previous = q.chord;
  }
  const harmonic = EAR.makeQuestion(EAR.LEVELS.sevenths, 'together', mulberry32(3), null);
  assert.equal(harmonic.direction, 'together');
  assert.equal(EAR.sequence(harmonic).length, 4);
  assert.equal(EAR.makeQuestion([], 'sideways', mulberry32(1), null).direction, 'together');
  assert.ok(EAR.LEVELS.mixed.includes(EAR.makeQuestion([], 'up', Math.random, null).chord));
  assert.equal(EAR.makeQuestion(['major'], 'up', () => 99, null).root, 60, 'out-of-range random is clamped');
  assert.equal(EAR.makeQuestion(['major'], 'up', () => -1, null).root, 48, 'negative random is clamped');
}
{
  const first = [];
  const second = [];
  const r1 = mulberry32(2026);
  const r2 = mulberry32(2026);
  for (let i = 0; i < 20; i += 1) {
    first.push(EAR.makeQuestion(EAR.LEVELS.mixed, 'up', r1, i === 0 ? null : first[i - 1].chord));
    second.push(EAR.makeQuestion(EAR.LEVELS.mixed, 'up', r2, i === 0 ? null : second[i - 1].chord));
  }
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'same seed must give the same questions');
  for (let i = 1; i < first.length; i += 1) {
    assert.notEqual(first[i].chord, first[i - 1].chord, 'no immediate repeats across a run');
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
}
{
  assert.equal(EAR.check(null, 'major'), false);
  assert.equal(EAR.check({}, 'major'), false);
  assert.equal(EAR.check({ chord: 'major' }, 'major'), true);
  assert.equal(EAR.check({ chord: 'major' }, 'minor'), false);
  assert.equal(EAR.check({ chord: 'major7' }, 'major'), false);
}

console.log(`chord quality ear trainer: ${checked} catalog vectors plus invariants passed`);
