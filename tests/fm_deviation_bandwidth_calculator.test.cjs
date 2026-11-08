/* Regression checks for the FM deviation and bandwidth core, its catalog cases
   and the arithmetic the index, bandwidth, sideband and channel figures use. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/fm-deviation-bandwidth-calculator/index.html'), 'utf8');
const start = html.indexOf('/* fm-dev-core:start */');
const end = html.indexOf('/* fm-dev-core:end */');
assert.ok(start > -1 && end > start, 'fm deviation core markers missing');
const core = html.slice(start, end + '/* fm-dev-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FmDeviationCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`);
};

// The textbook wideband case: 75 kHz deviation against 15 kHz audio.
const base = run({});
assert.equal(base.deviation, 75);
assert.equal(base.audio, 15);
assert.equal(base.spacing, 200);
close(base.index, 5, 'default index');
close(base.bandwidth, 180, 'default bandwidth');
assert.equal(base.sidebandPairs, 6);
close(base.sidebandSpan, 180, 'default sideband span');
assert.equal(base.narrowband, false);
close(base.margin, 20, 'default margin');
assert.equal(base.fits, true);
close(base.maxDeviation, 85, 'default largest deviation');
close(base.share, 90, 'default channel share');

// A typical 12.5 kHz two-way channel holds 2.5 kHz of deviation over 3 kHz audio.
const land = run({ deviation: 2.5, audio: 3, spacing: 12.5 });
close(land.bandwidth, 11, 'land mobile bandwidth');
assert.equal(land.fits, true);
close(land.margin, 1.5, 'land mobile margin');
assert.equal(run({ deviation: 5, audio: 3, spacing: 12.5 }).fits, false, 'over-deviated signal is flagged');

// Every reported figure must follow from the two inputs alone: bandwidth is
// twice the sum, the index is the ratio, and the sideband estimate is floor
// plus one pair spanning two top frequencies each.
let referenceCases = 0;
for (const deviation of [0.1, 0.15, 1, 2.5, 5, 25, 50, 75, 100, 500]) {
  for (const audio of [0.05, 0.3, 1, 3, 15, 20, 100]) {
    for (const spacing of [1, 6.25, 12.5, 25, 180, 200, 2000]) {
      const result = run({ deviation, audio, spacing });
      const index = deviation / audio;
      close(result.index, index, `${deviation}/${audio} index`);
      close(result.bandwidth, 2 * (deviation + audio), `${deviation}/${audio} bandwidth`);
      assert.equal(result.sidebandPairs, Math.floor(index) + 1, `${deviation}/${audio} pairs`);
      close(result.sidebandSpan, 2 * (Math.floor(index) + 1) * audio, `${deviation}/${audio} span`);
      assert.equal(result.narrowband, index <= 0.3, `${deviation}/${audio} narrowband flag`);
      close(result.margin, spacing - result.bandwidth, `${deviation}/${audio} margin`);
      assert.equal(result.fits, result.bandwidth <= spacing + 1e-9, `${deviation}/${audio} fit flag`);
      close(result.share, (result.bandwidth / spacing) * 100, `${deviation}/${audio} share`);
      const max = spacing / 2 - audio;
      if (max <= 0) {
        assert.equal(result.maxDeviation, null, `${deviation}/${audio} no deviation fits`);
      } else {
        close(result.maxDeviation, max, `${deviation}/${audio} largest deviation`);
        // The inverse must be exact: at the reported limit the signal exactly
        // fills the channel, and one step further it no longer fits.
        const atLimit = run({ deviation: max, audio, spacing });
        assert.equal(atLimit.fits, true, `${deviation}/${audio} limit fits`);
        close(atLimit.bandwidth, spacing, `${deviation}/${audio} limit fills the channel`);
        const past = run({ deviation: max + Math.max(0.01, max * 1e-6), audio, spacing });
        assert.equal(past.fits, false, `${deviation}/${audio} past the limit does not fit`);
      }
      referenceCases += 1;
    }
  }
}

// Narrowband FM sits below or at an index of 0.3; wideband above it.
assert.equal(run({ deviation: 0.3, audio: 1, spacing: 6.25 }).narrowband, true, '0.3 is narrowband');
assert.equal(run({ deviation: 0.31, audio: 1, spacing: 6.25 }).narrowband, false, '0.31 is wideband');

// Inclusive bounds at both ends of each accepted range.
close(run({ deviation: 0.1, audio: 0.05, spacing: 1 }).bandwidth, 0.3, 'smallest accepted values');
close(run({ deviation: 500, audio: 100, spacing: 2000 }).bandwidth, 1200, 'high accepted values');
close(run({ deviation: 1000, audio: 0.05, spacing: 2000 }).bandwidth, 2000.1, 'largest accepted values');
assert.equal(run({ deviation: 1, audio: 0.6, spacing: 5 }).sidebandPairs, 2, 'rounding down the index');

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ deviation: '' }), /Peak deviation is required\./);
assert.throws(() => run({ deviation: '   ' }), /Peak deviation is required\./);
assert.throws(() => run({ deviation: 'wide' }), /Peak deviation must be a number from 0\.1 to 1000 kHz\./);
assert.throws(() => run({ deviation: '0' }), /Peak deviation must be a number from 0\.1 to 1000 kHz\./);
assert.throws(() => run({ deviation: '-5' }), /Peak deviation must be a number from 0\.1 to 1000 kHz\./);
assert.throws(() => run({ deviation: '1000.1' }), /Peak deviation must be a number from 0\.1 to 1000 kHz\./);
assert.throws(() => run({ deviation: '1e2' }), /Peak deviation must be a number from 0\.1 to 1000 kHz\./);
assert.throws(() => run({ audio: '' }), /Highest modulating frequency is required\./);
assert.throws(() => run({ audio: '0.04' }), /Highest modulating frequency must be a number from 0\.05 to 100 kHz\./);
assert.throws(() => run({ audio: '15 kHz' }), /Highest modulating frequency must be a number from 0\.05 to 100 kHz\./);
assert.throws(() => run({ spacing: '' }), /Channel spacing is required\./);
assert.throws(() => run({ spacing: '0' }), /Channel spacing must be a number from 1 to 2000 kHz\./);
assert.throws(() => run({ spacing: '2500' }), /Channel spacing must be a number from 1 to 2000 kHz\./);
// Missing options fall back to the documented defaults.
const fallback = run({ deviation: null, audio: null, spacing: null });
close(fallback.bandwidth, 180, 'null values fall back to defaults');
close(run().index, 5, 'omitted options fall back to defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="fm-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'fm-deviation-bandwidth-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'FM Deviation & Bandwidth Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.testCases.length >= 18, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 8, 'eight validation cases');
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
      close(result[key], value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('fm-deviation-bandwidth-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
