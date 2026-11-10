/* Regression checks for Euclidean rhythm generation, published examples and rotation. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'euclidean-rhythm-generator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* euclidean-rhythm-core:start */';
const endMarker = '/* euclidean-rhythm-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'Euclidean rhythm core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = EuclideanRhythmCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.generate(input));
const base = {steps: '8', pulses: '3', rotation: '0'};
const withInput = (overrides) => Object.assign({}, base, overrides);

// Literal anchors from Toussaint's published table, not calculated by this core.
const published = [
  [3, 5, 'x.x.x'],
  [3, 7, 'x.x.x..'],
  [3, 8, 'x..x..x.'],
  [5, 6, 'xxxxx.'],
  [5, 7, 'x.xx.xx'],
  [5, 8, 'x.xx.xx.'],
  [5, 9, 'x.x.x.x.x'],
  [5, 11, 'x.x.x.x.x..'],
  [5, 12, 'x..x.x..x.x.'],
  [5, 13, 'x..x.x..x.x..'],
  [4, 15, 'x...x...x...x..']
];
for (const [pulses, steps, iconic] of published) {
  const result = run({steps: String(steps), pulses: String(pulses), rotation: '0'});
  assert.equal(result.iconic, iconic, `published E(${pulses},${steps})`);
  assert.equal(result.onsets.length, pulses);
  assert.equal(result.steps, steps);
}

// Independent modular construction of an evenly distributed rhythm necklace.
function modularRhythm(steps, pulses) {
  return Array.from({length: steps}, (unused, index) => (index * pulses) % steps < pulses ? 1 : 0);
}
function sameNecklace(actual, reference) {
  if (actual.length !== reference.length) return false;
  const doubled = reference.concat(reference);
  return doubled.some((unused, offset) => actual.every((value, index) => value === doubled[offset + index]));
}

// Exhaust every supported n/k/rotation combination. The exact starting point is
// pinned by published examples above; every other base must be the same necklace
// as the independent modular construction, with exact user-controlled rotation.
let gridChecks = 0;
for (let steps = 1; steps <= 32; steps += 1) {
  for (let pulses = 0; pulses <= steps; pulses += 1) {
    const modular = modularRhythm(steps, pulses);
    const canonical = run({steps: String(steps), pulses: String(pulses), rotation: '0'}).pattern;
    assert.ok(sameNecklace(canonical, modular), `E(${pulses},${steps}) independent necklace`);
    for (let rotation = 0; rotation < steps; rotation += 1) {
      const expected = canonical.map((unused, index) => canonical[(index - rotation + steps) % steps]);
      const result = run({steps: String(steps), pulses: String(pulses), rotation: String(rotation)});
      assert.deepEqual(result.pattern, expected, `E(${pulses},${steps}) rotation ${rotation}`);
      assert.equal(result.binary, expected.join(''));
      assert.equal(result.iconic, expected.map((value) => value ? 'x' : '.').join(''));
      assert.equal(result.pattern.length, steps);
      assert.equal(result.pattern.reduce((sum, value) => sum + value, 0), pulses);
      assert.deepEqual(result.onsets, expected.flatMap((value, index) => value ? [index + 1] : []));
      assert.equal(result.rests, steps - pulses);
      assert.equal(result.density, pulses / steps * 100);
      if (pulses === 0) {
        assert.deepEqual(result.intervals, []);
        assert.equal(result.intervalPattern, '—');
      } else {
        const gaps = result.onsets.map((position, index) => {
          const next = index + 1 < result.onsets.length ? result.onsets[index + 1] : result.onsets[0] + steps;
          return next - position;
        });
        assert.deepEqual(result.intervals, gaps);
        assert.equal(gaps.reduce((sum, value) => sum + value, 0), steps);
        assert.equal(new Set(gaps).size <= 2, true, 'cyclic gaps use at most two sizes');
        assert.ok(gaps.every((gap) => gap === Math.floor(steps / pulses) || gap === Math.ceil(steps / pulses)));
        assert.equal(result.intervalPattern, gaps.join('–'));
      }
      gridChecks += 1;
    }
  }
}
assert.equal(gridChecks, 11968);

const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
assert.equal(failure(withInput({steps: '', pulses: ''})), 'Steps is required.');
assert.equal(failure(withInput({pulses: '9', rotation: '8'})), 'Onsets cannot exceed the number of steps.');
for (const value of ['+1', '01.0', '1e1', 'NaN', 'Infinity', '33', '-1', '1.2']) {
  assert.equal(failure(withInput({steps: value})), 'Steps must be a whole number from 1 to 32.');
}
assert.equal(run(withInput({steps: ' 08 ', pulses: '03', rotation: '00'})).iconic, 'x..x..x.');

// The page is local, accessible and does not inject markup strings.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="rhythm-form"/.test(html) && /type="submit"/.test(html), 'form and submit control');
assert.ok(/type="button" id="reset"/.test(html), 'explicit reset control');
assert.ok(/role="alert"/.test(html) && /aria-live="polite"/.test(html), 'announced errors and results');
assert.ok(/min-height:44px/.test(html), '44 px controls');
for (const control of ['steps', 'pulses', 'rotation']) {
  assert.ok(new RegExp(`<label for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has help text`);
}
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(new RegExp(`id="${match[1]}"`).test(html), `missing element #${match[1]}`);
}

// Replay the canonical catalog cases through the shipped core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one Euclidean rhythm generator');
const record = records[0];
assert.equal(record.name, 'Euclidean Rhythm Generator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('euclidean') && record.tags.includes('bjorklund'));
assert.ok(record.aliases.includes('Euclidean Sequencer'));
assert.ok(/Bjorklund's repeated-subtraction construction/.test(record.method));
assert.ok(/No storage, uploads or network access/.test(record.method));
assert.equal(record.sources.length, 2);
const kindCount = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(kindCount('golden'), 8);
assert.equal(kindCount('boundary'), 4);
assert.equal(kindCount('validation'), 9);
assert.equal(record.testCases.length, 21);
let checkedFields = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      const tolerance = Math.max(Math.abs(expected) * 1e-12, 1e-12);
      assert.ok(Math.abs(actual[key] - expected) <= tolerance, `${testCase.name}.${key}: ${actual[key]} vs ${expected}`);
    } else {
      assert.deepEqual(actual[key], expected, `${testCase.name}.${key}`);
    }
    checkedFields += 1;
  }
}

console.log(`euclidean-rhythm-generator: all checks passed (${published.length} published patterns, ${gridChecks} grid/rotation cases, ${record.testCases.length} catalog cases and ${checkedFields} catalog fields)`);
