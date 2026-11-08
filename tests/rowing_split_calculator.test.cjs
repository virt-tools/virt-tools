/* Regression checks for the rowing split core, its catalog cases and the
   arithmetic behind the split, total time, speed and stroke figures. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/rowing-split-calculator/index.html'), 'utf8');
const start = html.indexOf('/* rowing-split-core:start */');
const end = html.indexOf('/* rowing-split-core:end */');
assert.ok(start > -1 && end > start, 'rowing split core markers missing');
const core = html.slice(start, end + '/* rowing-split-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RowingSplitCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};

// The textbook 2,000 m test: 7:00 is 1:45.0 per 500 m.
const base = run({});
assert.equal(base.mode, 'time');
assert.equal(base.distance, 2000);
close(base.totalSeconds, 420, 'default total');
close(base.splitSeconds, 105, 'default split');
close(base.per1000Seconds, 210, 'default per 1000');
close(base.speedMps, 4.761904761904762, 'default speed');
close(base.speedKph, 17.142857142857142, 'default speed kph');
assert.equal(base.splitText, '1:45.0');
assert.equal(base.totalText, '7:00.0');
assert.equal(base.strokes, null);
assert.equal(base.metresPerStroke, null);

// The inverse: a 2:00 split over 2,000 m is 8:00.
const inverse = run({ mode: 'split', distance: 2000, value: '2:00' });
close(inverse.totalSeconds, 480, 'inverse total');
close(inverse.splitSeconds, 120, 'inverse split');
assert.equal(inverse.totalText, '8:00.0');

// Stroke figures come from the rate, the elapsed minutes and the distance.
const stroked = run({ mode: 'time', distance: 2000, value: '7:00', strokeRate: '32' });
assert.equal(stroked.strokes, 224);
close(stroked.metresPerStroke, 2000 / 224, 'metres per stroke');
const strokedSplit = run({ mode: 'split', distance: 6000, value: '1:40', strokeRate: '24' });
close(strokedSplit.totalSeconds, 1200, 'stroke total');
assert.equal(strokedSplit.strokes, 480);
close(strokedSplit.metresPerStroke, 12.5, 'stroke split metres per stroke');

// Every reported figure must follow from the inputs alone, in both directions.
let referenceCases = 0;
for (const distance of [100, 250, 500, 1000, 2000, 5000, 6000, 10000, 21097]) {
  for (const value of ['0:10', '1:30', '7:00', '20:00', '59:59.9', '1:02:03.4']) {
    for (const mode of ['time', 'split']) {
      const result = run({ mode, distance, value });
      const seconds = C.parseTime(value, 'Value');
      const total = mode === 'time' ? seconds : seconds * distance / 500;
      const split = mode === 'time' ? seconds * 500 / distance : seconds;
      close(result.totalSeconds, total, `${mode} ${distance} ${value} total`);
      close(result.splitSeconds, split, `${mode} ${distance} ${value} split`);
      close(result.per1000Seconds, split * 2, `${mode} ${distance} ${value} per 1000`);
      close(result.speedMps, distance / total, `${mode} ${distance} ${value} speed`);
      close(result.speedKph, (distance / total) * 3.6, `${mode} ${distance} ${value} kph`);
      assert.equal(result.splitText, C.formatTime(split), `${mode} ${distance} ${value} split text`);
      assert.equal(result.totalText, C.formatTime(total), `${mode} ${distance} ${value} total text`);
      // Feeding the displayed split back must land within half a tenth of a
      // second per 500 m of the original total time, wherever that split is
      // itself an accepted input (10 s or more).
      if (split >= 10) {
        const back = run({ mode: 'split', distance, value: result.splitText });
        assert.ok(Math.abs(back.totalSeconds - total) <= 0.0500001 * distance / 500,
          `${mode} ${distance} ${value} displayed split round trip`);
      }
      referenceCases += 1;
    }
  }
}

// Stroke count is the rate times the elapsed minutes, rounded, and the
// per-stroke distance uses the unrounded count.
for (const rate of [5, 18, 24, 32, 40.5, 80]) {
  for (const distance of [500, 2000, 21097]) {
    const result = run({ mode: 'time', distance, value: '30:00', strokeRate: String(rate) });
    const exact = rate * result.totalSeconds / 60;
    assert.equal(result.strokes, Math.round(exact), `${rate} spm strokes`);
    close(result.metresPerStroke, distance / exact, `${rate} spm metres per stroke`);
    referenceCases += 1;
  }
}

// Clock formatting pads seconds and only shows hours when there are any.
assert.equal(C.formatTime(105), '1:45.0');
assert.equal(C.formatTime(9.96), '0:10.0');
assert.equal(C.formatTime(59.94), '0:59.9');
assert.equal(C.formatTime(3599.94), '59:59.9');
assert.equal(C.formatTime(3599.96), '1:00:00.0');
assert.equal(C.formatTime(3600), '1:00:00.0');
assert.equal(C.formatTime(3723.4), '1:02:03.4');

// Inclusive bounds at both ends of each accepted range.
close(run({ distance: '100', value: '0:10' }).splitSeconds, 50, 'smallest accepted values');
close(run({ distance: '100000', value: '24:00:00' }).splitSeconds, 432, 'largest accepted values');
assert.equal(run({ strokeRate: '5' }).strokeRate, 5, 'minimum stroke rate');
assert.equal(run({ strokeRate: '80' }).strokeRate, 80, 'maximum stroke rate');
assert.equal(run({ strokeRate: '' }).strokeRate, null, 'blank stroke rate is optional');
assert.equal(run({ value: '420' }).splitSeconds, 105, 'plain seconds are accepted');
assert.equal(run({ value: '1:02:03.4' }).totalSeconds, 3723.4, 'hours are accepted');

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ distance: '' }), /Distance is required\./);
assert.throws(() => run({ distance: '  ' }), /Distance is required\./);
assert.throws(() => run({ distance: '99' }), /Distance must be a number from 100 to 100000 m\./);
assert.throws(() => run({ distance: '100001' }), /Distance must be a number from 100 to 100000 m\./);
assert.throws(() => run({ distance: '2e3' }), /Distance must be a number from 100 to 100000 m\./);
assert.throws(() => run({ value: '' }), /Total time is required\./);
assert.throws(() => run({ value: '7:60' }), /Total time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ value: '1:60:00' }), /Total time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ value: '7:00.55' }), /Total time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ value: '00:00:05' }), /Total time must be between 0:10 and 24:00:00\./);
assert.throws(() => run({ mode: 'split', value: '' }), /Average split is required\./);
assert.throws(() => run({ mode: 'pace' }), /Choose whether you know the total time or the average split\./);
assert.throws(() => run({ strokeRate: '4' }), /Stroke rate must be a number from 5 to 80 strokes per minute\./);
assert.throws(() => run({ strokeRate: '81' }), /Stroke rate must be a number from 5 to 80 strokes per minute\./);
assert.throws(() => run({ strokeRate: 'thirty' }), /Stroke rate must be a number from 5 to 80 strokes per minute\./);
// Missing options fall back to the documented defaults.
close(run({ distance: null, value: null, strokeRate: null }).splitSeconds, 105, 'null falls back to defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="row-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<select id="in-mode"/.test(html), 'page lets you choose which value you know');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'rowing-split-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Rowing Split Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 9, 'nine validation cases');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
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
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('rowing-split-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
