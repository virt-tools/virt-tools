/* Regression checks for the bead stringing core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bead-stringing-calculator';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* bead-stringing-core:start */');
const end = html.indexOf('/* bead-stringing-core:end */');
assert.ok(start > -1 && end > start, 'bead stringing core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* bead-stringing-core:end */'.length) + '\nmodule.exports = BeadStringing;', sandbox);
const B = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F4FF}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2273, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');

const failure = (input) => {
  try {
    B.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Defaults and the geometry they produce. ---
assert.equal(B.MM_PER_INCH, 25.4);
const defaults = B.compute({});
assert.equal(defaults.bead, 8);
assert.equal(defaults.gap, 0);
assert.equal(defaults.clasp, 25);
assert.equal(defaults.tail, 150);
assert.equal(defaults.usable, 425);
assert.equal(defaults.count, 53);
assert.equal(defaults.covered, 424);
assert.equal(defaults.leftover, 1);
assert.equal(defaults.finished, 450);
assert.equal(defaults.cord, 750);
assert.equal(defaults.spare, 59);
assert.equal(defaults.warnings.length, 0);

// The last bead needs no spacer after it, so the count rounds up by one gap.
const spaced = B.compute({ finished: '100', bead: '9', gap: '1', clasp: '0', tail: '0' });
assert.equal(spaced.count, 10);
assert.equal(spaced.covered, 99);
assert.equal(spaced.leftover, 1);
const touching = B.compute({ finished: '100', bead: '9', gap: '0', clasp: '0', tail: '0' });
assert.equal(touching.count, 11);
assert.equal(touching.covered, 99);

// Beaded length helper agrees with the compute path.
assert.equal(B.beadedLength(0, 8, 2), 0);
assert.equal(B.beadedLength(1, 8, 2), 8);
assert.equal(B.beadedLength(4, 8, 2), 38);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = B.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.equal(goldenCount, 6, 'expected six golden cases');
assert.equal(boundaryCount, 6, 'expected six boundary cases');
assert.equal(validationCount, 12, 'expected twelve validation cases');

// --- Independent recomputation of the fit, in millimetres from the inch definitions. ---
const MM_PER_INCH = 25.4;
const roundHalfAway = (value, places) => {
  const factor = Math.pow(10, places);
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};
let sweeps = 0;
for (const finished of [50, 120, 450, 900, 1500, 2000]) {
  for (const bead of [2, 3.5, 8, 10, 25, 40]) {
    for (const gap of [0, 0.5, 1, 3, 20]) {
      for (const clasp of [0, 20, 100]) {
        if (finished - clasp < bead) continue;
        const result = B.compute({
          finished: String(finished), bead: String(bead), gap: String(gap),
          clasp: String(clasp), tail: '150'
        });
        const usable = finished - clasp;
        const expectedCount = Math.floor((usable + gap) / (bead + gap) + 1e-9);
        const expectedCovered = expectedCount * bead + (expectedCount - 1) * gap;
        assert.equal(result.count, expectedCount, `${finished}/${bead}/${gap}/${clasp}: count`);
        assert.equal(result.covered, roundHalfAway(expectedCovered, 2), `${finished}/${bead}/${gap}/${clasp}: covered`);
        assert.equal(result.leftover, roundHalfAway(usable - expectedCovered, 2), `${finished}/${bead}/${gap}/${clasp}: leftover`);
        assert.equal(result.cord, roundHalfAway(finished + 300, 2), 'cord = finished plus both tails');
        assert.equal(result.spare, Math.ceil(expectedCount * 1.1 - 1e-9), 'ten per cent spare');
        sweeps += 1;
      }
    }
  }
}
for (const count of [1, 5, 50, 137, 1000]) {
  for (const bead of [2, 8, 12.7, 40]) {
    for (const gap of [0, 2]) {
      const result = B.compute({ mode: 'count', count: String(count), bead: String(bead), gap: String(gap), clasp: '0', tail: '0' });
      const expected = count * bead + (count - 1) * gap;
      assert.equal(result.covered, roundHalfAway(expected, 2), `${count}/${bead}/${gap}: beaded length`);
      assert.equal(result.finished, roundHalfAway(expected, 2), 'no clasp allowance in this sweep');
      sweeps += 1;
    }
  }
}

// --- Inch inputs behave like their millimetre equivalents. ---
const toMm = (value) => String(Math.round(value * MM_PER_INCH * 10000) / 10000);
for (const inches of [0.25, 0.5, 0.375]) {
  const inch = B.compute({ unit: 'in', finished: '18', bead: String(inches), gap: '0', clasp: '1', tail: '6' });
  const mm = B.compute({ unit: 'mm', finished: toMm(18), bead: toMm(inches), gap: '0', clasp: toMm(1), tail: toMm(6) });
  assert.equal(inch.count, mm.count, `inch bead ${inches}: same count`);
  assert.ok(Math.abs(inch.covered * MM_PER_INCH - mm.covered) < 0.02, `inch bead ${inches}: same beaded length`);
  assert.ok(Math.abs(inch.finished * MM_PER_INCH - mm.finished) < 0.02, `inch bead ${inches}: same finished length`);
  assert.ok(Math.abs(inch.cord * MM_PER_INCH - mm.cord) < 0.03, `inch bead ${inches}: same cord`);
}

// --- More beads always mean a longer strand; the fit never overshoots. ---
let previous = 0;
for (const count of ['1', '2', '10', '40', '100', '400']) {
  const single = B.compute({ mode: 'count', count, bead: '6', gap: '1', clasp: '0', tail: '0' });
  assert.ok(single.covered > previous, `beaded length grows with the count (${count})`);
  previous = single.covered;
}
for (const finished of [50, 100, 300, 1000, 1999]) {
  const fit = B.compute({ finished: String(finished), bead: '7', gap: '2', clasp: '0', tail: '0' });
  const used = fit.count * 7 + Math.max(0, fit.count - 1) * 2;
  assert.ok(used <= finished, 'the beads always fit the length');
  assert.ok(used + 9 > finished, 'one more bead would not fit');
}

// --- Refusals and the zero-bead answer. ---
assert.equal(failure({ unit: 'cm' }), 'Choose millimetres or inches for the measurements.');
assert.equal(failure({ mode: 'bracelet' }), 'Choose whether to work out the beads for a length or the length for a bead count.');
assert.equal(failure({ finished: '' }), 'Finished length is required.');
assert.equal(failure({ finished: '-450' }), 'Finished length must be a number from 50 to 2000 millimetres.');
assert.equal(failure({ finished: '49.99' }), 'Finished length must be a number from 50 to 2000 millimetres.');
assert.equal(failure({ bead: '41' }), 'Bead size must be a number from 2 to 40 millimetres.');
assert.equal(failure({ gap: '-1' }), 'Bead spacing must be a number from 0 to 20 millimetres.');
assert.equal(failure({ unit: 'in', finished: '1' }), 'Finished length must be a number from 1.9685 to 78.7402 inches.');
assert.equal(failure({ mode: 'count', count: '' }), 'Bead count is required.');
assert.equal(failure({ mode: 'count', count: '1001' }), 'Bead count must be a whole number from 1 to 1000.');

const noFit = B.compute({ finished: '50', clasp: '50', tail: '0' });
assert.equal(noFit.count, 0);
assert.equal(noFit.spare, 0);
assert.equal(noFit.covered, 0);
assert.ok(noFit.warnings.some((line) => line.includes('less room than one bead')), 'zero-bead warning');

const wideSpacers = B.compute({ finished: '300', bead: '2', gap: '20', clasp: '0', tail: '0' });
assert.ok(wideSpacers.warnings.some((line) => line.includes('wider than the beads')), 'spacer warning');

const overLong = B.compute({ mode: 'count', count: '900', bead: '40', gap: '0', clasp: '0', tail: '0' });
assert.ok(overLong.warnings.some((line) => line.includes('longest finished length')), 'over-length warning');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['mode', 'unit', 'finished', 'count', 'bead', 'gap', 'clasp', 'tail', 'calculate',
  'reset', 'bs-status', 'headline-out', 'count-out', 'covered-out', 'finished-out', 'leftover-out',
  'spare-out', 'cord-out', 'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="bs-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="mm" selected>/.test(html) && /<option value="length" selected>/.test(html), 'default units and direction');
assert.ok(/id="finished" type="text" inputmode="decimal" autocomplete="off" value="450"/.test(html), 'default finished length');
assert.ok(/<div class="field" id="count-field" hidden>/.test(html), 'count field starts hidden');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.ok(!/\bfetch\(|XMLHttpRequest/.test(html), 'no network calls');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${sweeps} independent recomputations, inch equivalence and fit checks agreed`);
