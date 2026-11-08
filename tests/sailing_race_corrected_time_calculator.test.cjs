/* Regression checks for the sailing race corrected time core, its catalog
   cases and the PHRF / Portsmouth arithmetic behind the corrected time. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/sailing-race-corrected-time-calculator/index.html'), 'utf8');
const start = html.indexOf('/* sailing-race-core:start */');
const end = html.indexOf('/* sailing-race-core:end */');
assert.ok(start > -1 && end > start, 'sailing race core markers missing');
const core = html.slice(start, end + '/* sailing-race-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SailingRaceCorrectedTimeCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};

// The worked PHRF example: 120 s/nm over 10 nm credits 20 minutes.
const base = run({});
assert.equal(base.system, 'phrf');
close(base.elapsedSeconds, 4800, 'default elapsed');
close(base.rating, 120, 'default rating');
close(base.distance, 10, 'default distance');
close(base.allowanceSeconds, 1200, 'default allowance');
close(base.correctedSeconds, 3600, 'default corrected');
close(base.correctedPaceSeconds, 360, 'default corrected pace');
close(base.elapsedPaceSeconds, 480, 'default elapsed pace');
close(base.correctedSpeedKnots, 10, 'default corrected speed');
close(base.elapsedSpeedKnots, 7.5, 'default elapsed speed');
close(base.ratioPercent, 75, 'default ratio');
assert.equal(base.factor, null);
assert.equal(base.correctedText, '1:00:00.0');
assert.equal(base.elapsedText, '1:20:00.0');

// Portsmouth is time on time: one hour at 950 corrects to 1:03:09.5.
const port = run({ system: 'portsmouth', elapsed: '1:00:00', rating: '950' });
close(port.factor, 1000 / 950, 'portsmouth factor');
close(port.correctedSeconds, 3600 * 1000 / 950, 'portsmouth corrected');
close(port.allowanceSeconds, 3600 - 3600 * 1000 / 950, 'portsmouth allowance');
assert.equal(port.distance, null);
assert.equal(port.correctedPaceSeconds, null);
assert.equal(port.correctedSpeedKnots, null);
assert.equal(port.correctedText, '1:03:09.5');

// Every reported figure must follow from the inputs alone across the ranges.
let referenceCases = 0;
for (const elapsed of ['0:10', '45:30', '1:00:00', '1:02:03.4', '2:00:00', '23:59:59.9']) {
  const seconds = C.parseTime(elapsed, 'Elapsed');
  for (const rating of ['-300', '-30', '0', '87.5', '120', '350', '600']) {
    for (const distance of ['0.1', '1', '6.5', '10', '12.25', '1000']) {
      const corrected = seconds - Number(rating) * Number(distance);
      if (corrected <= 0) {
        assert.throws(() => run({ elapsed, rating, distance }), /corrected time would be negative/,
          `${elapsed} ${rating} ${distance} must reject a negative corrected time`);
        continue;
      }
      const result = run({ elapsed, rating, distance });
      close(result.correctedSeconds, corrected, `${elapsed} ${rating} ${distance} corrected`);
      close(result.allowanceSeconds, Number(rating) * Number(distance), `${elapsed} ${rating} ${distance} allowance`);
      close(result.correctedPaceSeconds, corrected / Number(distance), `${elapsed} ${rating} ${distance} corrected pace`);
      close(result.elapsedPaceSeconds, seconds / Number(distance), `${elapsed} ${rating} ${distance} elapsed pace`);
      close(result.correctedSpeedKnots, Number(distance) / (corrected / 3600), `${elapsed} ${rating} ${distance} corrected speed`);
      close(result.elapsedSpeedKnots, Number(distance) / (seconds / 3600), `${elapsed} ${rating} ${distance} elapsed speed`);
      close(result.ratioPercent, corrected / seconds * 100, `${elapsed} ${rating} ${distance} ratio`);
      assert.equal(result.correctedText, C.formatTime(corrected), `${elapsed} ${rating} ${distance} corrected text`);
      referenceCases += 1;
    }
  }
}
for (const elapsed of ['0:10', '45:30', '1:00:00', '1:02:03.4', '2:00:00', '24:00:00']) {
  const seconds = C.parseTime(elapsed, 'Elapsed');
  for (const rating of ['500', '950', '1000', '1087.5', '1250', '1600']) {
    const result = run({ system: 'portsmouth', elapsed, rating });
    close(result.factor, 1000 / Number(rating), `${elapsed} ${rating} factor`);
    close(result.correctedSeconds, seconds * 1000 / Number(rating), `${elapsed} ${rating} corrected`);
    close(result.allowanceSeconds, seconds - seconds * 1000 / Number(rating), `${elapsed} ${rating} allowance`);
    close(result.ratioPercent, 1000 / Number(rating) * 100, `${elapsed} ${rating} ratio`);
    assert.equal(result.distance, null, `${elapsed} ${rating} distance`);
    assert.equal(result.correctedText, C.formatTime(result.correctedSeconds), `${elapsed} ${rating} text`);
    referenceCases += 1;
  }
}

// A zero rating and a 1000 number are scratch, so the time is unchanged.
assert.equal(run({ system: 'phrf', elapsed: '1:00:00', rating: '0', distance: '5' }).correctedText, '1:00:00.0');
assert.equal(run({ system: 'portsmouth', elapsed: '1:00:00', rating: '1000' }).correctedText, '1:00:00.0');

// Clock formatting pads seconds and only shows hours when there are any.
assert.equal(C.formatTime(105), '1:45.0');
assert.equal(C.formatTime(9.96), '0:10.0');
assert.equal(C.formatTime(59.94), '0:59.9');
assert.equal(C.formatTime(3599.94), '59:59.9');
assert.equal(C.formatTime(3599.96), '1:00:00.0');
assert.equal(C.formatTime(3600), '1:00:00.0');
assert.equal(C.formatTime(3789.473684), '1:03:09.5');
assert.equal(C.formatTime(3723.4), '1:02:03.4');

// Inclusive bounds at both ends of each accepted range.
close(run({ elapsed: '0:10', rating: '-300', distance: '0.1' }).correctedSeconds, 40, 'smallest accepted values');
close(run({ elapsed: '24:00:00', rating: '-300', distance: '0.1' }).correctedSeconds, 86430, 'largest elapsed');
close(run({ elapsed: '1:00:00', rating: '600', distance: '1' }).correctedSeconds, 3000, 'maximum PHRF rating');
close(run({ system: 'portsmouth', elapsed: '0:10', rating: '1600' }).correctedSeconds, 6.25, 'smallest Portsmouth result');
close(run({ system: 'portsmouth', elapsed: '0:10', rating: '500' }).correctedSeconds, 20, 'minimum Portsmouth number');
close(run({ elapsed: '4800', rating: '120', distance: '10' }).correctedSeconds, 3600, 'plain seconds are accepted');
close(run({ elapsed: '1:02:03.4', rating: '102.5', distance: '8' }).correctedSeconds, 2903.4, 'decimal rating and hours');

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ elapsed: '' }), /Elapsed time is required\./);
assert.throws(() => run({ elapsed: '  ' }), /Elapsed time is required\./);
assert.throws(() => run({ elapsed: '7:60' }), /Elapsed time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ elapsed: '1:60:00' }), /Elapsed time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ elapsed: '7:00.55' }), /Elapsed time must look like m:ss or h:mm:ss/);
assert.throws(() => run({ elapsed: '0:05' }), /Elapsed time must be between 0:10 and 24:00:00\./);
assert.throws(() => run({ elapsed: '24:00:01' }), /Elapsed time must be between 0:10 and 24:00:00\./);
assert.throws(() => run({ rating: '' }), /Handicap rating is required\./);
assert.throws(() => run({ rating: '601' }), /PHRF rating must be a number from -300 to 600 s\/nm\./);
assert.throws(() => run({ rating: '-301' }), /PHRF rating must be a number from -300 to 600 s\/nm\./);
assert.throws(() => run({ rating: 'fast' }), /PHRF rating must be a number from -300 to 600 s\/nm\./);
assert.throws(() => run({ system: 'portsmouth', rating: '499' }), /Portsmouth number must be a number from 500 to 1600\./);
assert.throws(() => run({ system: 'portsmouth', rating: '1601' }), /Portsmouth number must be a number from 500 to 1600\./);
assert.throws(() => run({ system: 'portsmouth', rating: '1,000' }), /Portsmouth number must be a number from 500 to 1600\./);
assert.throws(() => run({ distance: '' }), /Course distance is required\./);
assert.throws(() => run({ distance: '0' }), /Course distance must be a number from 0.1 to 1000 nm\./);
assert.throws(() => run({ distance: '1001' }), /Course distance must be a number from 0.1 to 1000 nm\./);
assert.throws(() => run({ distance: 'ten' }), /Course distance must be a number from 0.1 to 1000 nm\./);
assert.throws(() => run({ distance: '1e1' }), /Course distance must be a number from 0.1 to 1000 nm\./);
assert.throws(() => run({ system: 'irc' }), /Choose a handicap system\./);
assert.throws(() => run({ elapsed: '0:10', rating: '600', distance: '1000' }), /corrected time would be negative/);
// Missing options fall back to the documented defaults.
close(run({ system: null, elapsed: null, rating: null, distance: null }).correctedSeconds, 3600, 'null falls back to defaults');
// A Portsmouth call ignores a distance it is given.
assert.equal(run({ system: 'portsmouth', elapsed: '1:00:00', rating: '950', distance: '25' }).distance, null);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="race-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<select id="in-system"/.test(html), 'page lets you choose the handicap system');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'sailing-race-corrected-time-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Sailing Race Corrected Time Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 9, 'nine golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5, 'five boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 17, 'seventeen validation cases');
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

console.log('sailing-race-corrected-time-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
