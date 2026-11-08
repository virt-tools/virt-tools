/* Regression checks for the embroidery stitch and thread estimator: the
   catalogue cases, an independent recomputation over a grid, the invariants
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'embroidery-stitch-thread-estimator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* embroidery-core:start */');
const end = html.indexOf('/* embroidery-core:end */');
assert.ok(start > -1 && end > start, 'embroidery core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmbroideryCore;', sandbox);
const C = sandbox.module.exports;

const calculate = (input) => C.calculate(input);
const failure = (input) => {
  try {
    calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent transcription: defaults merged by hand, the area walked from
// the two sides, and every derived figure rebuilt from the rounded stitch
// count rather than from the core's intermediate values.
const DEFAULT_INPUT = { width: 4, height: 4, density: 5000, coverage: 100, threadPer1000: 1, speed: 700, margin: 1 };

function recompute(input) {
  const merged = { ...DEFAULT_INPUT, ...(input || {}) };
  const width = Number(merged.width);
  const height = Number(merged.height);
  const density = Number(merged.density);
  const coverage = Number(merged.coverage);
  const perThousand = Number(merged.threadPer1000);
  const speed = Number(merged.speed);
  const margin = Number(merged.margin);
  const area = width * height;
  const stitched = area * (coverage / 100);
  // The documented rule is nearest stitch with an exact half up; the epsilon
  // absorbs binary representation error, exactly as the core does.
  const stitches = Math.floor(stitched * density + 0.5 + 1e-6);
  const yards = (stitches / 1000) * perThousand;
  return {
    area, stitched, stitches,
    yards, metres: yards * 0.9144,
    bobbin: yards / 3, bobbinMetres: (yards / 3) * 0.9144,
    hoopWidth: width + margin + margin,
    hoopHeight: height + margin + margin,
    seconds: (stitches / speed) * 60
  };
}

const close = (actual, expected, label, tolerance = 5.1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' != ' + expected);

// Defaults describe a four inch square block at a medium fill.
const base = calculate({});
assert.equal(base.stitches, 80000);
assert.equal(base.threadYd, 80);
assert.equal(base.threadM, 73.152);
assert.equal(base.bobbinYd, 26.6667);
close(base.seconds, 6857.14, 'default seconds');
close(base.minutes, 114.286, 'default minutes');
assert.equal(base.hoopWidth, 6);
assert.equal(base.hoopHeightMm, 152.4);

// Two stitches times a two yard allowance is the whole thread relation.
const threadCheck = calculate({ width: 0.1, height: 0.1, density: 200, coverage: 100, threadPer1000: 2 });
assert.equal(threadCheck.stitches, 2);
assert.equal(threadCheck.threadYd, 0.004);
assert.equal(threadCheck.bobbinYd, 0.0013);

// The catalog records the same numbers the page computes.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
  }
}

// A deterministic grid exercises every combination shape without randomness.
const widths = [0.1, 0.25, 1, 2.5, 3.3, 3.75, 4, 7.5, 12, 24];
const heights = [0.1, 0.5, 1.5, 2.25, 3.3, 4, 6, 10, 24];
const densities = [200, 1200, 3000, 5000, 8000, 20000];
const coverages = [1, 25, 33, 40, 75, 100];
const threads = [0.1, 1, 1.2, 10];
const margins = [0, 1, 2, 6];
const speeds = [100, 400, 700, 2000];

let rows = 0;
for (let i = 0; i < widths.length; i += 1) {
  for (let j = 0; j < heights.length; j += 1) {
    for (let k = 0; k < densities.length; k += 1) {
      const input = {
        width: String(widths[i]),
        height: String(heights[j]),
        density: String(densities[k]),
        coverage: String(coverages[(i + j + k) % coverages.length]),
        threadPer1000: String(threads[(i * 2 + j + k) % threads.length]),
        margin: String(margins[(i + j * 2 + k) % margins.length]),
        speed: String(speeds[(i + j + k * 3) % speeds.length])
      };
      const expected = recompute(input);
      if (expected.stitches < 1) {
        assert.equal(failure(input),
          'The design works out to fewer than one stitch; increase its size, density or coverage.');
        continue;
      }
      const result = calculate(input);
      assert.equal(result.stitches, expected.stitches, 'stitches ' + JSON.stringify(input));
      close(result.area, expected.area, 'area');
      close(result.stitchedArea, expected.stitched, 'stitched area');
      close(result.threadYd, expected.yards, 'thread yards');
      close(result.threadM, expected.metres, 'thread metres');
      close(result.bobbinYd, expected.bobbin, 'bobbin yards');
      close(result.bobbinM, expected.bobbinMetres, 'bobbin metres');
      close(result.hoopWidth, expected.hoopWidth, 'hoop width');
      close(result.hoopHeight, expected.hoopHeight, 'hoop height');
      close(result.hoopWidthMm, expected.hoopWidth * 25.4, 'hoop width mm', 5.1e-4);
      close(result.hoopHeightMm, expected.hoopHeight * 25.4, 'hoop height mm', 5.1e-4);
      close(result.seconds, expected.seconds, 'seconds', 5.1e-3);
      close(result.minutes, expected.seconds / 60, 'minutes', 5.1e-4);
      // The core must echo the parsed inputs, so the page can label the result.
      assert.equal(result.width, Number(input.width));
      assert.equal(result.height, Number(input.height));
      assert.equal(result.margin, Number(input.margin));
      assert.equal(result.coverage, Number(input.coverage));
      rows += 1;
    }
  }
}

// Scaling laws hold exactly once the stitch count is fixed.
const one = calculate({ width: 4, height: 4, density: 5000, coverage: 50 });
const two = calculate({ width: 4, height: 4, density: 5000, coverage: 100 });
assert.equal(two.stitches, one.stitches * 2);
close(two.threadYd, one.threadYd * 2, 'thread scales with coverage', 1.1e-4);
close(two.bobbinYd, one.bobbinYd * 2, 'bobbin scales with coverage', 1.1e-4);
const faster = calculate({ width: 4, height: 4, speed: 1400 });
assert.equal(faster.stitches, 80000);
assert.equal(faster.seconds, 3428.57);
// Thread, bobbin and both units agree with each other.
for (const margin of [0, 0.5, 1, 2, 6]) {
  const result = calculate({ width: 6, height: 3, margin });
  close(result.hoopWidth, 6 + margin * 2, 'hoop law');
  close(result.threadM, result.threadYd * 0.9144, 'yard conversion');
  close(result.bobbinM, result.bobbinYd * 0.9144, 'bobbin conversion');
  close(result.threadYd, result.bobbinYd * 3, 'bobbin third', 1.1e-4);
  close(result.minutes, result.seconds / 60, 'minute conversion', 5.1e-4);
}
// Densities below 200 and above 20,000 are outside the documented range.
assert.equal(failure({ density: '199' }),
  'Stitch density must be a number from 200 to 20000 stitches per square inch.');
assert.equal(failure({ density: '20000.5' }),
  'Stitch density must be a number from 200 to 20000 stitches per square inch.');
assert.equal(failure({ threadPer1000: '0' }),
  'Thread per 1,000 stitches must be a number from 0.1 to 10 yards.');
assert.equal(failure({ margin: '6.5' }),
  'Hoop margin must be a number from 0 to 6 inches.');
assert.equal(failure({ speed: '2001' }),
  'Machine speed must be a number from 100 to 2000 stitches per minute.');
assert.equal(failure({ width: '  ' }), 'Design width is required.');

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="embroidery-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('aria-describedby'), 'fields must reference their help text');
for (const id of ['width', 'height', 'density', 'coverage', 'thread', 'speed', 'margin']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
  const help = { width: 'width-help', height: 'height-help', density: 'density-help',
    coverage: 'coverage-help', thread: 'thread-help', speed: 'speed-help', margin: 'margin-help' }[id];
  assert.ok(html.includes('aria-describedby="' + help + '"'), 'help reference ' + id + ' missing');
  assert.ok(html.includes('id="' + help + '"'), 'help text ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('type="button"'), 'reset button must not submit the form');

console.log('Embroidery stitch and thread estimator: ' + entry.testCases.length
  + ' catalog cases, ' + rows + ' grid rows and invariants passed');
