/* Regression checks for the rolling shutter skew core, its catalog cases and
   the arithmetic behind skew, edge lean, per-row readout and pan limits. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/rolling-shutter-skew-calculator/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* rolling-shutter-core:start */');
const end = html.indexOf('/* rolling-shutter-core:end */');
assert.ok(start > -1 && end > start, 'rolling shutter core markers missing');
const core = html.slice(start, end + '/* rolling-shutter-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RollingShutterCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const close = (actual, expected, label, eps = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= eps,
    `${label}: expected ${expected}, got ${actual}`);
};
const err = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  throw new Error('expected an error for ' + JSON.stringify(input));
};

// The textbook case: one full readout of 12.5 ms while panning half a frame
// width per second slides the frame by 0.625% of its width.
const base = run({});
assert.equal(base.mode, 'skew');
assert.equal(base.readoutMs, 12.5);
assert.equal(base.width, 3840);
assert.equal(base.height, 2160);
close(base.rowTimeUs, 12.5 * 1000 / 2160, 'default row time');
close(base.skewPercent, 0.625, 'default skew percent');
close(base.skewPx, 24, 'default skew px');
close(base.skewAngleDeg, Math.atan(24 / 2160) * 180 / Math.PI, 'default lean');
close(base.panTimeSeconds, 2, 'default crossing time');
assert.equal(base.verticalSpeed, null);
assert.equal(base.wobblePercent, null);
assert.equal(base.tolerancePercent, null);
assert.equal(base.maxPanSpeed, null);

// Vertical motion is stretched by the same readout.
const wobble = run({ verticalSpeed: '0.25' });
close(wobble.wobblePercent, 0.3125, 'vertical wobble');
close(wobble.skewPx, 24, 'wobble leaves skew unchanged');

// The tolerance mode is the exact inverse of the skew relation.
const limit = run({ mode: 'limit', tolerancePercent: '1' });
close(limit.maxPanSpeed, 0.8, 'limit pan speed');
close(limit.maxPanTimeSeconds, 1.25, 'limit crossing time');
close(limit.skewPercent, 1, 'limit skew percent');
close(limit.skewPx, 38.4, 'limit skew px');
close(limit.skewAngleDeg, Math.atan(38.4 / 2160) * 180 / Math.PI, 'limit lean');
close(run({ mode: 'limit', tolerancePercent: '0.25', readoutMs: '20' }).maxPanSpeed,
  0.125, 'quarter percent at 20 ms');
// The limit fed back as a pan reproduces the tolerance exactly.
for (const tolerance of [0.05, 0.5, 1, 2.5, 10]) {
  const capped = run({ mode: 'limit', tolerancePercent: String(tolerance), readoutMs: '16.6' });
  const replayed = run({ panSpeed: String(capped.maxPanSpeed), readoutMs: '16.6' });
  close(replayed.skewPercent, tolerance, `${tolerance}% round trip`);
}

// Every reported figure must follow from the inputs alone.
let referenceCases = 0;
for (const readout of ['0.5', '6.9', '12.5', '16.6', '33', '200']) {
  for (const width of [64, 1920, 3840, 8192, 16384]) {
    for (const height of [64, 1080, 2160, 4320]) {
      for (const pan of ['0', '0.1', '0.5', '2', '20']) {
        const result = run({ readoutMs: readout, width: String(width), height: String(height), panSpeed: pan });
        const seconds = Number(readout) / 1000;
        const value = Number(pan);
        close(result.rowTimeUs, Number(readout) * 1000 / height, `${readout}ms ${height}px row`);
        close(result.skewPercent, value * seconds * 100, `${readout}ms ${pan}fw skew percent`);
        close(result.skewPx, width * value * seconds, `${readout}ms ${pan}fw skew px`);
        close(result.skewAngleDeg, Math.atan(width * value * seconds / height) * 180 / Math.PI,
          `${readout}ms ${pan}fw lean`);
        if (value === 0) {
          assert.equal(result.panTimeSeconds, null, 'no crossing time without motion');
        } else {
          close(result.panTimeSeconds, 1 / value, `${readout}ms ${pan}fw crossing`);
        }
        referenceCases += 1;
      }
      for (const tolerance of ['0.01', '1', '50']) {
        const result = run({ mode: 'limit', readoutMs: readout, width: String(width),
          height: String(height), tolerancePercent: tolerance });
        const seconds = Number(readout) / 1000;
        const maxPan = (Number(tolerance) / 100) / seconds;
        close(result.maxPanSpeed, maxPan, `${readout}ms ${tolerance}% max pan`);
        close(result.maxPanTimeSeconds, 1 / maxPan, `${readout}ms ${tolerance}% max crossing`);
        close(result.skewPx, width * Number(tolerance) / 100, `${readout}ms ${tolerance}% pixels`);
        close(result.panSpeed, maxPan, `${readout}ms ${tolerance}% reported pan`);
        referenceCases += 1;
      }
    }
  }
}

// Inclusive bounds at both ends of each accepted range.
close(run({ readoutMs: '0.5', width: '64', height: '64', panSpeed: '0' }).skewPx, 0, 'smallest accepted');
close(run({ readoutMs: '200', width: '16384', height: '16384', panSpeed: '20' }).skewPx,
  16384 * 20 * 0.2, 'largest accepted');
assert.equal(run({ verticalSpeed: '' }).verticalSpeed, null, 'blank vertical speed is optional');
assert.equal(run({ mode: 'limit', tolerancePercent: '50' }).tolerancePercent, 50, 'maximum tolerance');

// Bad input fails with an actionable message, never a silent default.
assert.equal(err({ readoutMs: '' }), 'Readout time is required.');
assert.equal(err({ readoutMs: '  ' }), 'Readout time is required.');
assert.equal(err({ readoutMs: '0.4' }), 'Readout time must be a number from 0.5 to 200 ms.');
assert.equal(err({ readoutMs: '201' }), 'Readout time must be a number from 0.5 to 200 ms.');
assert.equal(err({ readoutMs: '1e1' }), 'Readout time must be a number from 0.5 to 200 ms.');
assert.equal(err({ width: '63' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ width: '4096.5' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ width: 'wide' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ height: '' }), 'Frame height is required.');
assert.equal(err({ height: '16385' }), 'Frame height must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ panSpeed: '' }), 'Pan speed is required.');
assert.equal(err({ panSpeed: '-0.5' }), 'Pan speed must be a number from 0 to 20 frame widths per second.');
assert.equal(err({ panSpeed: '20.5' }), 'Pan speed must be a number from 0 to 20 frame widths per second.');
assert.equal(err({ verticalSpeed: '-1' }), 'Vertical speed must be a number from 0 to 20 frame heights per second.');
assert.equal(err({ mode: 'limit', tolerancePercent: '' }), 'Skew tolerance is required.');
assert.equal(err({ mode: 'limit', tolerancePercent: '0' }),
  'Skew tolerance must be a number from 0.01 to 50 percent of the frame width.');
assert.equal(err({ mode: 'limit', tolerancePercent: '51' }),
  'Skew tolerance must be a number from 0.01 to 50 percent of the frame width.');
assert.equal(err({ mode: 'fastest' }), 'Choose whether to calculate skew or a pan-speed limit.');
// Missing options fall back to the documented defaults.
close(run({ readoutMs: null, width: null, height: null, panSpeed: null }).skewPx, 24, 'nulls use defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="rs-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<select id="in-mode"/.test(html), 'page lets you choose the direction');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'rolling-shutter-skew-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Rolling Shutter Skew Calculator');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11, 'eleven validation cases');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.expected && testCase.expected.error) {
    assert.equal(err(options), testCase.expected.error, testCase.name);
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

console.log('rolling-shutter-skew-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
