/* Regression checks for the string harmonic node core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/string-harmonic-node-calculator/index.html'), 'utf8');
const start = html.indexOf('/* harmonic-core:start */');
const end = html.indexOf('/* harmonic-core:end */');
assert.ok(start > -1 && end > start, 'harmonic core markers missing');
const core = html.slice(start, end + '/* harmonic-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HarmonicCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.analyse(input);

// The default is the second harmonic of E4 over a 25.5 in scale: the octave, touched at the midpoint.
const base = run({});
assert.equal(base.midi, 64);
assert.equal(base.fundamental, 329.6275569128699);
assert.equal(base.harmonic, 2);
assert.equal(base.sounding, 659.2551138257398);
assert.equal(base.soundedNote + base.soundedOctave, 'E5');
assert.equal(base.cents, 0);
assert.equal(base.firstNode, 12.75);
assert.deepEqual(JSON.parse(JSON.stringify(base.nodes)), [
  { index: 1, fraction: '1/2', fromNut: 12.75, fromBridge: 12.75 }
]);

// Harmonic 4 has three nodes, evenly spaced and mirrored across the midpoint.
const fourth = run({ harmonic: 4 });
assert.equal(fourth.nodes.length, 3);
assert.deepEqual(JSON.parse(JSON.stringify(fourth.nodes.map((n) => n.fraction))), ['1/4', '2/4', '3/4']);
assert.deepEqual(JSON.parse(JSON.stringify(fourth.nodes.map((n) => n.fromNut))), [6.375, 12.75, 19.125]);
for (const node of fourth.nodes) {
  assert.ok(Math.abs(node.fromNut + node.fromBridge - fourth.scaleLength) < 1e-12, 'node distances must sum to the scale');
}

// Every node count is one less than the harmonic, and the first node sits at 1/n of the scale.
for (const harmonic of [2, 3, 5, 7, 9, 11, 13, 16]) {
  const result = run({ harmonic: harmonic });
  assert.equal(result.nodes.length, harmonic - 1);
  assert.equal(result.nodes[0].fraction, '1/' + harmonic);
  assert.ok(Math.abs(result.nodes[0].fromNut - result.scaleLength / harmonic) < 1e-12);
}

// Octave harmonics are exact and the non-octave ones are audibly off equal temperament.
assert.equal(run({ harmonic: 2 }).cents, 0);
assert.equal(run({ harmonic: 4 }).cents, 0);
assert.equal(run({ harmonic: 8 }).cents, 0);
assert.equal(run({ harmonic: 16 }).cents, 0);
assert.ok(run({ harmonic: 3 }).cents > 0 && run({ harmonic: 3 }).cents < 2.5);
assert.ok(run({ harmonic: 5 }).cents < -13 && run({ harmonic: 5 }).cents > -14);
assert.ok(run({ harmonic: 7 }).cents < -31 && run({ harmonic: 7 }).cents > -32);

// Pitch spelling follows the nearest equal-tempered note, not the harmonic's ratio.
const fifth = run({ harmonic: 5 });
assert.equal(fifth.soundedNote, 'G#');
assert.equal(fifth.soundedOctave, 6);
assert.equal(run({ harmonic: 7 }).soundedNote, 'D');

// Interval decomposition matches the raw semitone count.
for (const harmonic of [6, 9, 10, 12, 13, 14, 15]) {
  const result = run({ harmonic: harmonic });
  assert.ok(Math.abs(result.octaves * 12 + result.remainder - result.semitones) < 1e-12);
  assert.ok(result.remainder >= 0 && result.remainder < 12);
}

// Inclusive bounds at both ends of every range.
const top = run({ scaleLength: 40, note: 'B', octave: 8, harmonic: 16 });
assert.equal(top.scaleLength, 40);
assert.equal(top.harmonic, 16);
assert.equal(top.nodes.length, 15);
assert.equal(top.firstNode, 2.5);
const bottom = run({ scaleLength: 8, note: 'C', octave: 0, harmonic: 2 });
assert.equal(bottom.scaleLength, 8);
assert.equal(bottom.fundamental, 16.351597831287414);
assert.equal(bottom.firstNode, 4);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ scaleLength: '' }), /Scale length is required\./);
assert.throws(() => run({ scaleLength: 'wide' }), /Scale length must be a number between 8 and 40 inches\./);
assert.throws(() => run({ scaleLength: 7.99 }), /Scale length must be between 8 and 40 inches\./);
assert.throws(() => run({ scaleLength: 40.01 }), /Scale length must be between 8 and 40 inches\./);
assert.throws(() => run({ scaleLength: -25.5 }), /Scale length must be a number between 8 and 40 inches\./);
assert.throws(() => run({ note: 'H' }), /Pitch must be a note name such as C, F# or B\./);
assert.throws(() => run({ octave: '9' }), /Octave must be a whole number from 0 to 8\./);
assert.throws(() => run({ octave: '4.5' }), /Octave must be a whole number from 0 to 8\./);
assert.throws(() => run({ harmonic: '1' }), /Harmonic must be a whole number from 2 to 16\./);
assert.throws(() => run({ harmonic: '17' }), /Harmonic must be a whole number from 2 to 16\./);
assert.throws(() => run({ harmonic: '2.5' }), /Harmonic must be a whole number from 2 to 16\./);
assert.throws(() => run({ harmonic: 'two' }), /Harmonic must be a whole number from 2 to 16\./);

// The page must not reach the network, store data or use inline handlers. The W3C SVG
// namespace string is an identifier, not a fetch, so it is ignored here.
const withoutSvgNs = html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
assert.ok(!/https?:\/\//.test(withoutSvgNs.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'string-harmonic-node-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 16, 'catalog has the full test case set');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.analyse(testCase.input),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('string-harmonic-node-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
