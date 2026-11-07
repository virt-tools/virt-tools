/* Regression checks for the eye diagram explorer core in its shipped page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/eye-diagram-explorer/index.html'), 'utf8');
const start = html.indexOf('/* eye-diagram:start */');
const end = html.indexOf('/* eye-diagram:end */');
assert.ok(start > -1 && end > start, 'eye diagram core markers missing');
const core = html.slice(start, end + '/* eye-diagram:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EYE_DIAGRAM;', sandbox);
const EYE = sandbox.module.exports;

function close(actual, expected, label, tolerance = 1e-9) {
  assert.ok(Number.isFinite(actual), `${label}: non-finite result ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected}`);
}

function closeArray(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label}: length`);
  for (let i = 0; i < expected.length; i += 1) close(actual[i], expected[i], `${label}[${i}]`);
}

function runCase(tc) {
  const inp = tc.input;
  if (inp.op === 'parse') {
    const bits = EYE.parseBits(inp.raw);
    return { bits, symbols: EYE.symbols(bits), transitions: EYE.transitionCount(bits) };
  }
  if (inp.op === 'sinc') return { values: inp.points.map((t) => EYE.sinc(t)) };
  if (inp.op === 'pulse') return { values: inp.points.map((t) => EYE.pulse(t, inp.shape, inp.beta)) };
  if (inp.op === 'sample') return { values: inp.points.map((t) => EYE.sample(inp.bits, t, inp.shape, inp.beta)) };
  if (inp.op === 'analyze') {
    const got = EYE.analyze(inp);
    return {
      bits: got.bits,
      symbols: got.symbols,
      transitions: got.transitions,
      waveformPoints: got.waveform.length,
      traceCount: got.traces.length,
      pointsPerTrace: got.traces.length ? got.traces[0].points.length : 0,
      centers: got.traces.map((trace) => trace.center),
      opening: got.opening
    };
  }
  throw new Error('unknown op ' + inp.op);
}

const doc = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = doc.tools.find((tool) => tool.slug === 'eye-diagram-explorer');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 12, 'catalog needs at least twelve vectors');
let checked = 0;
for (const tc of entry.testCases) {
  const got = runCase(tc);
  for (const [key, want] of Object.entries(tc.expected)) {
    assert.ok(key in got, `${tc.name}: unknown expected key ${key}`);
    if (Array.isArray(want)) {
      if (key === 'values') closeArray(got[key], want, tc.name);
      else assert.deepEqual(Array.from(got[key]), want, `${tc.name}: ${key}`);
    } else if (typeof want === 'number') {
      close(got[key], want, `${tc.name}: ${key}`);
    } else {
      assert.equal(got[key], want, `${tc.name}: ${key} -> ${got[key]}`);
    }
  }
  checked += 1;
}

/* Formula, sampling and validation invariants beyond the catalog vectors. */
{
  close(EYE.sinc(0), 1, 'sinc origin');
  close(EYE.sinc(-0.5), EYE.sinc(0.5), 'sinc symmetry');
  for (const beta of [0, 0.2, 0.35, 0.5, 1]) {
    close(EYE.pulse(0, 'raised-cosine', beta), 1, `RC origin ${beta}`);
    for (const t of [-5, -2, -1, 1, 2, 5]) close(EYE.pulse(t, 'raised-cosine', beta), 0, `RC zero ${beta}/${t}`);
    for (const t of [-3.7, -0.75, -0.25, 0.25, 0.75, 3.7]) {
      close(EYE.pulse(t, 'raised-cosine', beta), EYE.pulse(-t, 'raised-cosine', beta), `RC symmetry ${beta}/${t}`);
      close(EYE.pulse(t, 'raised-cosine', beta), EYE.pulse(t, 'raised-cosine', beta), `RC deterministic ${beta}/${t}`);
    }
    assert.equal(EYE.pulse(6.0001, 'raised-cosine', beta), 0, 'truncation beyond six symbols');
  }
  close(EYE.pulse(0.5, 'raised-cosine', 1), 0.5, 'removable singularity');
  close(EYE.pulse(-0.5, 'raised-cosine', 1), 0.5, 'negative removable singularity');
  close(EYE.pulse(0.5, 'raised-cosine', 0.35), 0.6185841451197258, 'general RC value');
}
{
  close(EYE.pulse(-0.49, 'rectangular', 0), 1, 'rectangle interior');
  close(EYE.pulse(-0.5, 'rectangular', 0), 0.5, 'rectangle edge');
  close(EYE.pulse(-0.51, 'rectangular', 0), 0, 'rectangle exterior');
  close(EYE.sample('11', 0.5, 'rectangular', 0), 1, 'rectangle partition of unity');
  close(EYE.sample('10', 0.5, 'rectangular', 0), 0, 'rectangle transition midpoint');
}
{
  const sequences = ['0101', '101100101101', '0000111100001111', '1'.repeat(64)];
  for (const bits of sequences) {
    for (const beta of [0, 0.35, 1]) {
      const got = EYE.analyze({ bits, shape: 'raised-cosine', beta, sps: 16 });
      for (let k = 0; k < bits.length; k += 1) {
        close(EYE.sample(bits, k, 'raised-cosine', beta), bits[k] === '1' ? 1 : -1, `${bits}/${beta}: ideal sample ${k}`);
      }
      assert.equal(got.traces.length, bits.length - 2);
      assert.equal(got.waveform.length, bits.length * 16 + 1);
      for (const trace of got.traces) {
        assert.equal(trace.points.length, 33);
        close(trace.points[0][0], -1, 'trace starts one symbol early');
        close(trace.points[16][0], 0, 'trace centers on sample instant');
        close(trace.points[32][0], 1, 'trace ends one symbol late');
        close(trace.points[16][1], trace.bit === '1' ? 1 : -1, 'trace center matches its bit');
      }
    }
  }
}
{
  assert.equal(EYE.eyeOpening('0101', 'raised-cosine', 0.35), 2);
  assert.equal(EYE.eyeOpening('0000', 'raised-cosine', 0.35), null);
  assert.equal(EYE.eyeOpening('1111', 'rectangular', 0.35), null);
  assert.equal(EYE.transitionCount('0000'), 0);
  assert.equal(EYE.transitionCount('0101'), 3);
  const a = EYE.analyze({ bits: '101100101101', shape: 'raised-cosine', beta: 0.35, sps: 64 });
  const b = EYE.analyze({ bits: '101100101101', shape: 'raised-cosine', beta: 0.35, sps: 64 });
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'same input produces identical points');
}
{
  const invalid = [
    () => EYE.parseBits(''),
    () => EYE.parseBits('101'),
    () => EYE.parseBits('10a1'),
    () => EYE.parseBits('1'.repeat(65)),
    () => EYE.analyze({ bits: '1010', shape: 'triangle', beta: 0.35, sps: 32 }),
    () => EYE.analyze({ bits: '1010', shape: 'raised-cosine', beta: -0.1, sps: 32 }),
    () => EYE.analyze({ bits: '1010', shape: 'raised-cosine', beta: 1.1, sps: 32 }),
    () => EYE.analyze({ bits: '1010', shape: 'raised-cosine', beta: NaN, sps: 32 }),
    () => EYE.analyze({ bits: '1010', shape: 'raised-cosine', beta: 0.35, sps: 20 })
  ];
  for (const fn of invalid) assert.throws(fn);
  assert.ok(Number.isNaN(EYE.pulse(Infinity, 'raised-cosine', 0.35)));
}

console.log(`eye diagram explorer: ${checked} catalog vectors plus invariants passed`);
