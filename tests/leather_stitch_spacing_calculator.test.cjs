/* Regression checks for the leather stitch spacing core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/leather-stitch-spacing-calculator/index.html'), 'utf8');
const start = html.indexOf('/* leather-stitch-core:start */');
const end = html.indexOf('/* leather-stitch-core:end */');
assert.ok(start > -1 && end > start, 'leather-stitch core markers missing');
const core = html.slice(start, end + '/* leather-stitch-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LeatherStitchCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.calculate(input);

// A 300 mm strap on a 4 mm iron is a whole number of stitches with flush ends.
const base = run({});
assert.deepEqual(JSON.parse(JSON.stringify(base)), {
  mode: 'balanced', length: 300, pitch: 4,
  intervals: 75, holes: 76, usedPitch: 4, endBorder: 0, stitched: 300,
  pitchChangePercent: 0, threadFactor: 3.5, threadMm: 1050, threadM: 1.05
});

// Balanced layout keeps the iron's pitch and splits the leftover length in two.
const split = run({ length: 300, pitch: 4.5 });
assert.equal(split.intervals, 66);
assert.equal(split.holes, 67);
assert.equal(split.usedPitch, 4.5);
assert.equal(split.endBorder, 1.5);
assert.equal(split.stitched, 297);
assert.equal(split.threadMm, 1039.5);

// Rounding is downward, never inventing a stitch that does not fit.
const short = run({ length: 300, pitch: 7 });
assert.equal(short.intervals, 42);
assert.equal(short.holes, 43);
assert.ok(Math.abs(short.endBorder - 3) < 1e-9);
assert.equal(short.stitched, 294);

// Exact even layout stretches the pitch to land both end holes on the marks.
const stretched = run({ length: 300, pitch: 4.2, mode: 'even' });
assert.equal(stretched.intervals, 71);
assert.equal(stretched.holes, 72);
assert.equal(stretched.endBorder, 0);
assert.equal(stretched.stitched, 300);
assert.ok(Math.abs(stretched.usedPitch - 300 / 71) < 1e-12);
assert.ok(Math.abs(stretched.pitchChangePercent - 0.604) < 1e-9);
assert.equal(stretched.threadMm, 1050);

// Exact even layout also compresses when the nearest count is higher.
const compressed = run({ length: 100, pitch: 6, mode: 'even' });
assert.equal(compressed.intervals, 17);
assert.equal(compressed.usedPitch, 100 / 17);
assert.ok(compressed.pitchChangePercent < 0);

// One and a half pitches rounds to two intervals, halving the pitch.
const halved = run({ length: 6, pitch: 4, mode: 'even' });
assert.equal(halved.intervals, 2);
assert.equal(halved.usedPitch, 3);
assert.equal(halved.pitchChangePercent, -25);
assert.equal(halved.threadMm, 21);

// A line exactly one pitch long gives two holes and no border.
const onePitch = run({ length: 5, pitch: 5 });
assert.equal(onePitch.intervals, 1);
assert.equal(onePitch.holes, 2);
assert.equal(onePitch.endBorder, 0);
assert.equal(onePitch.threadMm, 17.5);

// Thread allowance is a straight multiplier of the stitched span.
for (const factor of [2, 3.5, 6]) {
  const result = run({ threadFactor: factor });
  assert.equal(result.threadMm, 300 * factor);
  assert.equal(result.threadM, (300 * factor) / 1000);
}

// Inclusive bounds at both ends of every range.
const top = run({ length: 3000, pitch: 15, threadFactor: 6 });
assert.equal(top.intervals, 200);
assert.equal(top.holes, 201);
assert.equal(top.threadMm, 18000);
const bottom = run({ length: 5, pitch: 1.5, threadFactor: 2 });
assert.equal(bottom.intervals, 3);
assert.equal(bottom.holes, 4);
assert.equal(bottom.endBorder, 0.25);
assert.equal(bottom.threadMm, 9);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ length: '' }), /Stitch line length is required\./);
assert.throws(() => run({ length: 'four hundred' }), /Stitch line length must be a number from 5 to 3000 mm\./);
assert.throws(() => run({ length: 4.99 }), /Stitch line length must be a number from 5 to 3000 mm\./);
assert.throws(() => run({ length: 3001 }), /Stitch line length must be a number from 5 to 3000 mm\./);
assert.throws(() => run({ length: -300 }), /Stitch line length must be a number from 5 to 3000 mm\./);
assert.throws(() => run({ pitch: '' }), /Pricking iron pitch is required\./);
assert.throws(() => run({ pitch: 1.49 }), /Pricking iron pitch must be a number from 1.5 to 15 mm\./);
assert.throws(() => run({ pitch: 15.01 }), /Pricking iron pitch must be a number from 1.5 to 15 mm\./);
assert.throws(() => run({ length: 5, pitch: 15 }), /The stitch line must be at least one pitch long\./);
assert.throws(() => run({ threadFactor: 1.99 }), /Thread allowance must be a number from 2 to 6 per stitch\./);
assert.throws(() => run({ threadFactor: 6.01 }), /Thread allowance must be a number from 2 to 6 per stitch\./);
assert.throws(() => run({ mode: 'staggered' }), /Choose balanced end borders or exact even spacing\./);
assert.throws(() => run({ length: '.5' }), /Stitch line length must be a number from 5 to 3000 mm\./);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'leather-stitch-spacing-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
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
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('leather-stitch-spacing-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
