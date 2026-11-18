/* Regression checks for the stabilization crop core, its catalog cases and the
   geometry behind the required margin, the uniform zoom and the budget table. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/stabilization-crop-planner/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* stabilization-crop-core:start */');
const end = html.indexOf('/* stabilization-crop-core:end */');
assert.ok(start > -1 && end > start, 'stabilization crop core markers missing');
const core = html.slice(start, end + '/* stabilization-crop-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StabilizationCropCore;', sandbox);
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
const rad = (degrees) => degrees * Math.PI / 180;

// The worked default: a 36 px margin on a 16:9 UHD frame is a 3.45 percent zoom.
const base = run({});
assert.equal(base.width, 3840);
assert.equal(base.height, 2160);
assert.equal(base.shortSide, 2160);
assert.equal(base.longSide, 3840);
close(base.diagonalPx, Math.sqrt(3840 * 3840 + 2160 * 2160), 'default diagonal');
close(base.rollMarginPx, rad(0.3) * Math.sqrt(3840 * 3840 + 2160 * 2160) / 2, 'default roll margin');
assert.equal(base.marginPx, 36, 'default margin rounds 24 + 11.53 up to 36');
close(base.rollDeg, 0.3, 'default roll');
close(base.shakePx, 24, 'default shake');
close(base.scale, 2160 / 2088, 'default scale');
assert.equal(base.cropWidth, 3712, 'default kept width');
assert.equal(base.cropHeight, 2088, 'default kept height');
close(base.marginShortPx, 36, 'default short-side margin');
close(base.marginLongPx, 64, 'default long-side margin');
close(base.zoomPercent, (2160 / 2088 - 1) * 100, 'default zoom');
close(base.fovPercent, 3712 / 3840 * 100, 'default field of view');
close(base.resolutionPercent, 3712 * 2088 / (3840 * 2160) * 100, 'default pixels kept');
close(base.shakePercent, 24 / 3840 * 100, 'default shake as width');
// The kept window keeps the frame's shape, which is the whole point of the zoom.
close(base.cropWidth / base.cropHeight, 3840 / 2160, 'default aspect kept', 1e-12);

// Roll alone crops without any shake, and a still frame needs nothing.
const rollOnly = run({ shakePx: '0', rollDeg: '1' });
assert.ok(rollOnly.marginPx > 0, 'roll alone still needs a margin');
close(rollOnly.marginPx, Math.ceil(rad(1) * rollOnly.diagonalPx / 2 - 1e-9), 'roll-only margin');
const still = run({ shakePx: '0', rollDeg: '0' });
assert.equal(still.marginPx, 0, 'no residual motion needs no margin');
assert.equal(still.cropWidth, 3840, 'no crop keeps the width');
assert.equal(still.cropHeight, 2160, 'no crop keeps the height');
assert.equal(still.zoomPercent, 0, 'no crop means no zoom');
close(still.flMultiplier, 1, 'no crop means no focal change');

// The budget table inverts the zoom: the shake it absorbs is the margin left
// after the roll has taken its share.
const budget = JSON.parse(JSON.stringify(base.budget));
assert.equal(budget.length, 4, 'four budget rows');
for (const row of budget) {
  const margin = 2160 * (1 - 1 / (1 + row.zoomPercent / 100)) / 2;
  close(row.marginPx, margin, `${row.zoomPercent}% budget margin`);
  close(row.maxShakePx, Math.max(0, margin - base.rollMarginPx),
    `${row.zoomPercent}% budget shake`);
}

// Every reported figure follows from the inputs alone.
let referenceCases = 0;
for (const width of ['64', '640', '1280', '1920', '3840', '8192', '16384']) {
  for (const height of ['64', '480', '720', '1080', '2160', '4320', '16384']) {
    for (const shake of ['0', '0.4', '12.5', '60', '999']) {
      for (const roll of ['0', '0.05', '0.3', '1', '5', '20']) {
        let result;
        try {
          result = run({ width, height, shakePx: shake, rollDeg: roll });
        } catch (error) {
          assert.equal(error.message,
            'The shake and roll need more margin than this frame can give up.');
          continue;
        }
        const w = Number(width), h = Number(height), t = Number(shake), r = Number(roll);
        const shortSide = Math.min(w, h), longSide = Math.max(w, h);
        const required = t + rad(r) * Math.sqrt(w * w + h * h) / 2;
        const label = `${width}x${height} ${shake}px ${roll}deg`;
        assert.ok(result.marginPx >= required - 1e-9, label + ' margin covers the motion');
        assert.equal(result.cropWidth % 2, 0, label + ' even width');
        assert.equal(result.cropHeight % 2, 0, label + ' even height');
        assert.ok(result.marginShortPx >= result.marginPx - 1e-9, label + ' short margin kept');
        assert.ok(result.marginLongPx >= result.marginShortPx - 1e-9, label + ' long margin at least short');
        close(result.scale, shortSide / (shortSide - 2 * result.marginPx), label + ' scale');
        close(result.zoomPercent, (result.scale - 1) * 100, label + ' zoom');
        close(result.fovPercent, result.cropWidth / w * 100, label + ' field of view');
        close(result.resolutionPercent, result.cropWidth * result.cropHeight / (w * h) * 100,
          label + ' pixels kept');
        close(result.flMultiplier, result.scale, label + ' focal multiplier');
        close(result.shakePercent, t / w * 100, label + ' shake share');
        assert.equal(result.shortSide, shortSide, label + ' short side');
        assert.equal(result.longSide, longSide, label + ' long side');
        referenceCases += 1;
      }
    }
  }
}
assert.ok(referenceCases > 700, 'the sweep exercised ' + referenceCases + ' frames');

// Inclusive bounds at both ends of every accepted range.
assert.equal(run({ width: '64', height: '64', shakePx: '0', rollDeg: '0' }).cropWidth, 64,
  'smallest accepted frame');
assert.equal(run({ width: '16384', height: '16384', shakePx: '0', rollDeg: '0' }).cropWidth, 16384,
  'largest accepted frame');
assert.equal(run({ shakePx: '1000' }).shakePx, 1000, 'maximum shake');
assert.equal(run({ rollDeg: '20' }).rollDeg, 20, 'maximum roll');
assert.equal(run({ shakePx: '.5' }).shakePx, 0.5, 'leading-dot decimals are accepted');
// A portrait frame reports the short side as the width and keeps its shape to
// within the even-pixel rounding.
const portrait = run({ width: '1080', height: '1920', shakePx: '30', rollDeg: '0.4' });
assert.equal(portrait.shortSide, 1080);
assert.ok(Math.abs(portrait.cropWidth * 1920 - portrait.cropHeight * 1080) / (1080 * 1920) < 0.002,
  'portrait aspect kept within even rounding');

// Bad input fails with an actionable message, never a silent default.
assert.equal(err({ width: '' }), 'Frame width is required.');
assert.equal(err({ width: '  ' }), 'Frame width is required.');
assert.equal(err({ width: '63' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ width: '4096.5' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ width: 'wide' }), 'Frame width must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ height: '' }), 'Frame height is required.');
assert.equal(err({ height: '16385' }), 'Frame height must be a whole number from 64 to 16384 pixels.');
assert.equal(err({ shakePx: '' }), 'Shake is required.');
assert.equal(err({ shakePx: '-1' }), 'Shake must be a number from 0 to 1000 px.');
assert.equal(err({ shakePx: '1500' }), 'Shake must be a number from 0 to 1000 px.');
assert.equal(err({ rollDeg: '' }), 'Roll is required.');
assert.equal(err({ rollDeg: '25' }), 'Roll must be a number from 0 to 20 degrees.');
assert.equal(err({ rollDeg: 'tilt' }), 'Roll must be a number from 0 to 20 degrees.');
assert.equal(err({ width: '1920', height: '1080', shakePx: '600' }),
  'The shake and roll need more margin than this frame can give up.');
assert.equal(err({ width: '64', height: '64', shakePx: '1' }),
  'The shake and roll need more margin than this frame can give up.');
// Missing options fall back to the documented defaults.
assert.equal(run({ width: null, height: null, shakePx: null, rollDeg: null }).marginPx, 36,
  'nulls use defaults');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="st-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
// The markup opens in the same state the core documents as its defaults.
for (const [id, value] of [['in-width', '3840'], ['in-height', '2160'], ['in-shake', '24'], ['in-roll', '0.3']]) {
  assert.ok(new RegExp(`id="${id}"[^>]*value="${value}"`).test(html), `markup default for ${id}`);
}
// Every id the script looks up exists in the markup.
const script = html.slice(html.lastIndexOf('<script>'));
for (const match of script.matchAll(/getElementById\("([^"]+)"\)/g)) {
  if (!/^in-|^err$|^out$|^st-form$/.test(match[1])) continue;
  assert.ok(html.includes(`id="${match[1]}"`), 'missing element #' + match[1]);
}

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'stabilization-crop-planner');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Stabilization Crop Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 0, 'bespoke geometry carries no citation');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 9, 'nine validation cases');
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

console.log('stabilization-crop-planner: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + referenceCases + ' reference cases)');
