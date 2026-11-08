/* Regression checks for the tuning beat rate calculator core, its catalog
   cases and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tuning-beat-rate-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* tuning-beat-core:start */');
const end = html.indexOf('/* tuning-beat-core:end */');
assert.ok(start > -1 && end > start, 'beat core markers missing');
const core = html.slice(start, end + '/* tuning-beat-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TuningBeatCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const analyze = (interval, lower, upper) => plain(C.analyze({ interval, lower: String(lower), upper: String(upper) }));

// The interval table: nine just ratios with their coinciding partial numbers.
const expectedIntervals = [
  ['unison', 'Unison', 1, 1],
  ['octave', 'Octave', 2, 1],
  ['fifth', 'Perfect fifth', 3, 2],
  ['fourth', 'Perfect fourth', 4, 3],
  ['major-third', 'Major third', 5, 4],
  ['minor-third', 'Minor third', 6, 5],
  ['major-sixth', 'Major sixth', 5, 3],
  ['minor-sixth', 'Minor sixth', 8, 5],
  ['harmonic-seventh', 'Harmonic seventh', 7, 4],
];
const intervals = plain(C.INTERVALS);
assert.equal(intervals.length, expectedIntervals.length, 'interval count');
expectedIntervals.forEach(([id, name, p, q], index) => {
  assert.equal(intervals[index].id, id, `${name} id`);
  assert.equal(intervals[index].name, name, `${name} name`);
  assert.equal(intervals[index].p, p, `${name} lower partial`);
  assert.equal(intervals[index].q, q, `${name} upper partial`);
});
assert.deepEqual(plain(C.OFFSETS), [-20, -10, -5, -2, 0, 2, 5, 10, 20], 'offset table');
assert.equal(C.MIN_HZ, 1);
assert.equal(C.MAX_HZ, 20000);
assert.equal(C.MAX_CENTS, 600);

// The physics, written out independently: the colliding partials are partial p
// of the lower pitch and partial q of the upper pitch, and they beat at their
// difference. A just fifth from 220 Hz is 330 Hz, so 330.5 Hz gives one beat.
const fifth = analyze('fifth', 220, 330.5);
assert.equal(Math.abs(3 * 220 - 2 * 330.5), 1, 'oracle: fifth beats once');
assert.equal(fifth.beatRate, 1);
assert.equal(fifth.beatsPerMinute, 60);
assert.equal(fifth.secondsPerBeat, 1);
assert.equal(fifth.partialLower, 3);
assert.equal(fifth.partialUpper, 2);
assert.equal(fifth.partialLowerHz, 660);
assert.equal(fifth.partialUpperHz, 661);
assert.equal(fifth.target, 330);
assert.equal(fifth.cents, 2.62);
assert.equal(fifth.sharp, true);
assert.equal(fifth.inTune, false);
assert.equal(fifth.fast, false);
assert.equal(fifth.ratio, '3:2');
assert.equal(fifth.name, 'Perfect fifth');

// Cents are a pure log ratio against the just target, re-derived here.
const rederived = 1200 * Math.log2(330.5 / (220 * 3 / 2));
assert.ok(Math.abs(fifth.cents - rederived) < 0.006, 'cents match the log ratio');
const octave = analyze('octave', 220, 441);
assert.equal(octave.beatRate, Math.abs(2 * 220 - 441), 'octave beats at the partial difference');
assert.equal(octave.beatRate, 1);
assert.equal(octave.cents, 3.93);

// Exact ratios do not beat, and seconds per beat is absent rather than infinite.
for (const [interval, lower, upper] of [['unison', 440, 440], ['octave', 220, 440], ['major-third', 264, 330], ['minor-third', 300, 360], ['harmonic-seventh', 200, 350], ['fourth', 264, 352]]) {
  const result = analyze(interval, lower, upper);
  assert.equal(result.beatRate, 0, `${interval} exact ${lower}/${upper}`);
  assert.equal(result.secondsPerBeat, null, `${interval} seconds per beat`);
  assert.equal(result.inTune, true, `${interval} in tune`);
  assert.equal(result.cents, 0, `${interval} cents`);
  assert.equal(result.fast, false, `${interval} not fast`);
}

// A flat equal-tempered fifth sounds a slow beat in the expected direction.
const tempered = analyze('fifth', 220, 329.63);
assert.equal(tempered.sharp, false);
assert.ok(tempered.cents < 0, 'flat fifth has negative cents');
assert.equal(tempered.beatRate, 0.74);
assert.equal(tempered.secondsPerBeat, 1.351);

// Beat rate scales with the cents gap and is symmetric around the pure ratio.
const rows = plain(C.offsetRows('fifth', 220));
assert.equal(rows.length, 9);
assert.equal(rows[4].cents, 0);
assert.equal(rows[4].beatRate, 0);
assert.equal(rows[4].upper, 330);
assert.equal(rows[6].upper, 330.954);
assert.ok(rows[2].upper < 330 && rows[2].upper > 329, 'a five cent flat fifth sits below the target');
assert.ok(Math.abs(rows[5].beatRate - rows[3].beatRate) <= 0.002, 'plus and minus two cents beat alike');
assert.ok(Math.abs(rows[6].beatRate - rows[2].beatRate) <= 0.01, 'plus and minus five cents beat nearly alike');
assert.ok(rows[0].beatRate > rows[1].beatRate && rows[1].beatRate > rows[2].beatRate, 'widening gap beats faster');

// Reference table at 220 Hz: nine intervals, zero beats at the pure ratio.
const reference = plain(C.reference(220));
assert.equal(reference.length, 9);
assert.equal(reference[2].name, 'Perfect fifth');
assert.equal(reference[2].target, 330);
assert.equal(reference[2].partialLower, 3);
assert.equal(reference[2].partialUpper, 2);
assert.equal(reference[2].beatsAtFiveCents, 1.909);
assert.equal(reference[0].target, 220);
assert.equal(reference[8].target, 385);

// Validation: each refusal names the problem.
assert.throws(() => C.analyze({ interval: 'fifth', lower: '', upper: '330.5' }), /Enter the lower frequency in hertz, for example 220\./);
assert.throws(() => C.analyze({ interval: 'fifth', lower: '220', upper: ' ' }), /Enter the upper frequency in hertz, for example 330\.5\./);
for (const bad of ['abc', '-220', '3.3e2', '220,5', '.5', '220.']) {
  assert.throws(() => C.analyze({ interval: 'fifth', lower: '220', upper: bad }), /must be a number of hertz such as 220 or 330\.5\./, bad);
}
for (const bad of ['0', '0.5', '25000', '99999']) {
  assert.throws(() => C.analyze({ interval: 'fifth', lower: '220', upper: bad }), /Frequencies must be between 1 and 20,000 Hz\./, bad);
}
assert.throws(() => C.analyze({ interval: 'seventh', lower: '220', upper: '330.5' }), /Choose one of the listed intervals\./);
assert.throws(() => C.analyze({ interval: 'unison', lower: '440', upper: '640' }), /more than half an octave from a unison/);
assert.throws(() => C.analyze({ interval: 'fifth', lower: '220', upper: '120' }), /more than half an octave from a perfect fifth/);
assert.ok(C.analyze({ interval: 'unison', lower: '440', upper: '620' }).fast, 'a half-octave unison is still accepted');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="beat-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<label class="f" for="interval">/.test(html), 'the interval is labelled');
assert.ok(/<label class="f" for="lower">/.test(html), 'the lower frequency is labelled');
assert.ok(/<label class="f" for="upper">/.test(html), 'the upper frequency is labelled');
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<th scope="col">/.test(html), 'reference table has column headers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Tuning Beat Rate Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');

const tolerance = { cents: 0.02, beatRate: 0.002, beatsPerMinute: 0.2, secondsPerBeat: 0.002, partialLowerHz: 0.002, partialUpperHz: 0.002, target: 0.002, lower: 0.002, upper: 0.002 };
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.analyze(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = plain(C.analyze(input));
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number' && key in tolerance) {
      assert.ok(Math.abs(result[key] - value) <= tolerance[key], `${testCase.name} ${key}: ${result[key]} vs ${value}`);
    } else {
      assert.deepEqual(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('tuning-beat-rate-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + intervals.length + ' intervals)');
