/* Regression checks for the scale ear trainer core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/scale-ear-trainer/index.html'), 'utf8');
const start = html.indexOf('/* scale-ear:start */');
const end = html.indexOf('/* scale-ear:end */');
assert.ok(start > -1 && end > start, 'scale ear core markers missing');
const core = html.slice(start, end + '/* scale-ear:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SCALE_EAR;', sandbox);
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
  if (inp.op === 'label') return { labels: inp.scales.map((id) => EAR.label(id)) };
  if (inp.op === 'frequency') return { hz: inp.midi.map((m) => EAR.frequency(m)) };
  if (inp.op === 'notes') return { notes: EAR.midiNotes(inp.question) };
  if (inp.op === 'phrase') return { notes: EAR.performanceNotes(inp.question) };
  if (inp.op === 'sequence') return { hz: EAR.sequence(inp.question) };
  if (inp.op === 'question') {
    const q = EAR.makeQuestion(inp.pool, sequenceRandom(inp.random), inp.previous || null);
    return { scale: q.scale, root: q.root, notes: EAR.midiNotes(q) };
  }
  if (inp.op === 'check') return { results: inp.pairs.map(([q, g]) => EAR.check({ scale: q }, g)) };
  if (inp.op === 'pool') return { scales: EAR.LEVELS[inp.level].slice() };
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
const entry = doc.tools.find((t) => t.slug === 'scale-ear-trainer');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 18, 'catalog needs at least eighteen vectors');

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
  assert.equal(EAR.SCALES.length, 15);
  const seen = new Set();
  for (const item of EAR.SCALES) {
    assert.ok(item.id && item.name && item.short, 'incomplete scale definition');
    assert.ok(!seen.has(item.id), 'duplicate scale id');
    seen.add(item.id);
    assert.equal(item.intervals[0], 0, 'scale must start at the tonic');
    assert.equal(item.intervals[item.intervals.length - 1], 12, 'scale must end at the octave');
    assert.ok(item.intervals.length >= 6 && item.intervals.length <= 8, 'five to seven notes plus octave');
    for (let i = 1; i < item.intervals.length; i += 1) {
      assert.ok(item.intervals[i] > item.intervals[i - 1], 'scale intervals must strictly rise');
    }
    assert.ok(EAR.label(item.id).startsWith(item.name + ' ('));
  }
  assert.equal(EAR.label('unknown'), 'Unknown scale');
  assert.equal(EAR.frequency(69), 440);
  assert.ok(Math.abs(EAR.frequency(81) - 880) < 1e-9, 'octave doubles frequency');
  assert.deepEqual(Array.from(EAR.midiNotes(null)), []);
  assert.deepEqual(Array.from(EAR.midiNotes({ scale: 'major', root: 60.5 })), []);
  assert.deepEqual(Array.from(EAR.performanceNotes(null)), []);
  assert.deepEqual(Array.from(EAR.sequence(null)), []);
}
{
  assert.deepEqual(Object.keys(EAR.LEVELS).sort(), ['common', 'modes', 'pentatonic']);
  assert.equal(EAR.LEVELS.common.length, 4);
  assert.equal(EAR.LEVELS.modes.length, 7);
  assert.equal(EAR.LEVELS.pentatonic.length, 4);
  for (const level of Object.keys(EAR.LEVELS)) {
    const unique = new Set(EAR.LEVELS[level]);
    assert.equal(unique.size, EAR.LEVELS[level].length, `${level} contains a duplicate id`);
    const patterns = new Set();
    for (const id of unique) {
      const scale = EAR.find(id);
      assert.ok(scale, `${level} contains an unknown scale`);
      const pattern = scale.intervals.join(',');
      assert.ok(!patterns.has(pattern), `${level} contains indistinguishable scales`);
      patterns.add(pattern);
    }
  }
}
{
  for (const level of Object.keys(EAR.LEVELS)) {
    const pool = EAR.LEVELS[level];
    const rand = mulberry32(7);
    let previous = null;
    for (let i = 0; i < 400; i += 1) {
      const q = EAR.makeQuestion(pool, rand, previous);
      assert.ok(pool.includes(q.scale), `question outside ${level} pool`);
      assert.ok(q.root >= 48 && q.root <= 60, `root ${q.root} outside 48-60`);
      assert.notEqual(q.scale, previous, 'must not repeat the previous scale');
      const notes = EAR.midiNotes(q);
      assert.equal(notes[0], q.root);
      assert.equal(notes[notes.length - 1], q.root + 12);
      const phrase = EAR.performanceNotes(q);
      assert.equal(phrase.length, notes.length * 2);
      assert.equal(phrase[0], q.root, 'reference tonic comes first');
      assert.equal(phrase[1], q.root, 'scale restates the tonic');
      assert.equal(phrase[notes.length], q.root + 12, 'melody peaks at the octave');
      assert.equal(phrase[phrase.length - 1], q.root, 'melody returns to tonic');
      const hz = EAR.sequence(q);
      assert.equal(hz.length, phrase.length);
      for (const value of hz) assert.ok(value > 0 && Number.isFinite(value));
      previous = q.scale;
    }
  }
  assert.ok(EAR.LEVELS.common.includes(EAR.makeQuestion([], Math.random, null).scale));
  assert.equal(EAR.makeQuestion(['major'], () => 99, null).root, 60, 'out-of-range random is clamped');
  assert.equal(EAR.makeQuestion(['major'], () => -1, null).root, 48, 'negative random is clamped');
}
{
  const first = [];
  const second = [];
  const r1 = mulberry32(2026);
  const r2 = mulberry32(2026);
  for (let i = 0; i < 20; i += 1) {
    first.push(EAR.makeQuestion(EAR.LEVELS.modes, r1, i === 0 ? null : first[i - 1].scale));
    second.push(EAR.makeQuestion(EAR.LEVELS.modes, r2, i === 0 ? null : second[i - 1].scale));
  }
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'same seed must give the same questions');
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
}
{
  assert.equal(EAR.check(null, 'major'), false);
  assert.equal(EAR.check({}, 'major'), false);
  assert.equal(EAR.check({ scale: 'major' }, 'major'), true);
  assert.equal(EAR.check({ scale: 'major' }, 'ionian'), false);
}

console.log(`scale ear trainer: ${checked} catalog vectors plus invariants passed`);
