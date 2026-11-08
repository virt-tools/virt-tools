/* Regression checks for the BPM pitch fader core, its catalog cases and the
   arithmetic the pitch, travel and drift figures are derived from. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bpm-pitch-fader-calculator/index.html'), 'utf8');
const start = html.indexOf('/* bpm-fader-core:start */');
const end = html.indexOf('/* bpm-fader-core:end */');
assert.ok(start > -1 && end > start, 'bpm fader core markers missing');
const core = html.slice(start, end + '/* bpm-fader-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BpmFaderCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`);
};

// The default match: 128 to 132 on a ±8% fader.
const base = run({});
assert.equal(base.source, 128);
assert.equal(base.target, 132);
assert.equal(base.range, 8);
close(base.ratio, 132 / 128, 'ratio');
close(base.percent, 3.125, 'percent');
close(base.semitones, 12 * Math.log2(132 / 128), 'semitones');
close(base.cents, 1200 * Math.log2(132 / 128), 'cents');
close(base.semitones, base.cents / 100, 'semitones from cents');
close(base.travel, 69.53125, 'travel');
assert.equal(base.withinRange, true);
assert.equal(base.direction, 'faster');
close(base.sourceBeat, 468.75, 'source beat');
close(base.targetBeat, 60000 / 132, 'target beat');
close(base.drift, 15, 'drift');

// Independent reference for the key change: equal temperament gives each
// semitone a frequency ratio of 2^(1/12), so the semitone count must satisfy
// source * 2^(semitones/12) == target, and cents must be exactly 100 per
// semitone under the 1200-cents-per-octave definition.
let pitchCases = 0;
for (const range of C.RANGES) {
  for (const source of [20, 55, 87.5, 100, 120, 128, 140, 174, 200, 300]) {
    for (const target of [20, 55, 87.5, 100, 120, 128, 140, 174, 200, 300]) {
      const result = run({ source, target, range });
      close(source * Math.pow(2, result.semitones / 12), target, `${source}->${target} pitch ratio`, 1e-9);
      close(source * (1 + result.percent / 100), target, `${source}->${target} playback rate`, 1e-9);
      close(result.cents, 1200 * Math.log(target / source) / Math.LN2, `${source}->${target} cents by natural log`, 1e-9);
      close(result.travelExact, 50 + 50 * result.percent / range, `${source}->${target} travel`);
      assert.ok(result.travel >= 0 && result.travel <= 100, 'travel is clamped for display');
      assert.equal(result.withinRange, Math.abs(result.percent) <= range + 1e-9, `${source}->${target} range test`);
      close(result.sourceBeat, 60000 / source, 'source beat interval');
      close(result.targetBeat, 60000 / target, 'target beat interval');
      if (source === target) {
        assert.equal(result.drift, null, 'equal tempos never drift');
        assert.equal(result.direction, 'unchanged');
        close(result.percent, 0, 'equal tempo percent', 1e-12);
      } else {
        // One beat of drift: over the reported time each track's beat count
        // differs by exactly one.
        const beats = result.drift * (Math.abs(target - source) / 60);
        close(beats, 1, `${source}->${target} drift`, 1e-9);
        assert.equal(result.direction, target > source ? 'faster' : 'slower');
      }
      pitchCases += 1;
    }
  }
}

// Halving the tempo drops the pitch an octave; doubling raises it an octave.
close(run({ source: 100, target: 50, range: 16 }).cents, -1200, 'octave down');
close(run({ source: 100, target: 200, range: 16 }).cents, 1200, 'octave up');

// Pushing the fader further always raises the tempo, and the sign of the
// setting follows the direction of the match.
let previous = -Infinity;
for (let target = 20; target <= 300; target += 0.5) {
  const result = run({ source: 120, target, range: 8 });
  assert.ok(result.percent > previous, 'percent rises with target tempo');
  assert.equal(Math.sign(result.percent), Math.sign(target - 120), 'sign follows direction');
  previous = result.percent;
}

// Fader travel is linear on its scale: the stops sit at 0 and 100, the
// centre detent at 50.
close(run({ source: 100, target: 94, range: 6 }).travel, 0, 'minus stop');
close(run({ source: 100, target: 100, range: 6 }).travel, 50, 'centre detent');
close(run({ source: 100, target: 116, range: 16 }).travel, 100, 'plus stop');
assert.equal(run({ source: 100, target: 106.1, range: 6 }).withinRange, false, 'just past the stop');
assert.equal(run({ source: 100, target: 106, range: 6 }).withinRange, true, 'exactly at the stop');

// Inclusive bounds and the smallest accepted values.
const low = run({ source: 20, target: 20.01, range: 16 });
assert.ok(low.percent > 0 && low.percent < 0.1, 'tiny but non-zero change');
const high = run({ source: 300, target: 300, range: 6 });
assert.equal(high.percent, 0);
assert.equal(high.withinRange, true);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ source: '' }), /Source tempo is required\./);
assert.throws(() => run({ target: '' }), /Target tempo is required\./);
assert.throws(() => run({ source: 'fast' }), /Source tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ source: '19.9' }), /Source tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ target: '300.1' }), /Target tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ source: '0' }), /Source tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ target: '-128' }), /Target tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ source: '1e2' }), /Source tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ source: '128 BPM' }), /Source tempo must be a number from 20 to 300 BPM\./);
assert.throws(() => run({ range: 5 }), /Choose a pitch range of ±6, ±8, ±10 or ±16 percent\./);
assert.throws(() => run({ range: 'wide' }), /Choose a pitch range of ±6, ±8, ±10 or ±16 percent\./);
assert.throws(() => run({ range: '' }), /Choose a pitch range of ±6, ±8, ±10 or ±16 percent\./);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'bpm-pitch-fader-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 8, 'eight validation cases');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      // Computed figures are floats: compare with a tolerance even when the
      // catalog value happens to be a whole number such as -10 percent.
      close(result[key], value, testCase.name + ' ' + key, 1e-9);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('bpm-pitch-fader-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + pitchCases + ' pitch and drift reference cases)');
