/* Fabric pre-wash shrinkage: the allowance arithmetic checked against the
   percentage definition, the wash-test inversion, the refusals, the page markup
   and every catalog case. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fabric-prewash-shrinkage-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* fabric-shrink-core:start */';
const endMarker = '/* fabric-shrink-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FabricShrinkCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.calculate(payload); } catch (error) { return error.message; }
  return null;
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
const DEFAULTS = C.DEFAULTS;
assert.equal(DEFAULTS.mode, 'percent');
assert.equal(DEFAULTS.unit, 'cm');
assert.equal(DEFAULTS.finishedLength, 100);
assert.equal(DEFAULTS.finishedWidth, 50);

// ---- The cut size is the smallest piece that finishes at the target.
for (const finished of [1, 12.5, 36, 100, 914.4, 10000]) {
  let previous = 0;
  for (const shrink of [0, 2.5, 5, 7.5, 10, 15, 20, 25]) {
    const row = C.calculate({ finishedLength: finished, finishedWidth: finished, shrinkLength: shrink, shrinkWidth: shrink });
    const want = finished / (1 - shrink / 100);
    assert.ok(near(row.cutLength, want, 1e-6), 'cut length at ' + shrink + '% of ' + finished);
    assert.ok(near(row.cutWidth, want, 1e-6), 'cut width at ' + shrink + '% of ' + finished);
    assert.ok(near(row.cutLength * (1 - shrink / 100), finished, 1e-6), 'the cut washes back to the target');
    assert.ok(near(row.extraLength, row.cutLength - finished, 1e-6), 'extra is the difference');
    assert.ok(row.cutLength >= finished - 1e-9, 'a cut is never smaller than the finished size');
    assert.ok(row.cutLength >= previous - 1e-9, 'more shrinkage never asks for less fabric');
    previous = row.cutLength;
  }
}

// ---- Zero shrinkage is the identity, and the two directions are independent.
const none = C.calculate({ shrinkLength: 0, shrinkWidth: 0 });
assert.equal(none.cutLength, 100);
assert.equal(none.cutWidth, 50);
assert.equal(none.extraLength, 0);
assert.equal(none.heavy, false);
const lopsided = C.calculate({ finishedLength: 100, finishedWidth: 100, shrinkLength: 10, shrinkWidth: 0 });
assert.equal(lopsided.cutLength, 111.111111);
assert.equal(lopsided.cutWidth, 100);

// ---- Wash-test mode inverts the measured shrink.
for (const [before, after] of [[20, 19.2], [10, 9.5], [50, 40], [3, 2.25], [1000, 999]]) {
  const want = (before - after) / before * 100;
  const row = C.calculate({ mode: 'test', sampleLengthBefore: before, sampleLengthAfter: after,
    sampleWidthBefore: before, sampleWidthAfter: after });
  assert.ok(near(row.shrinkLength, want, 1e-9), 'derived length shrink from ' + before + ' to ' + after);
  assert.ok(near(row.shrinkWidth, want, 1e-9), 'derived width shrink');
  assert.ok(near(row.cutLength * (1 - row.shrinkLength / 100), row.finishedLength, 1e-6), 'derived shrink washes back');
}
const measured = C.calculate({ mode: 'test' });
assert.equal(measured.shrinkLength, 4);
assert.equal(measured.shrinkWidth, 3);
assert.equal(JSON.stringify(measured.sample), JSON.stringify({ lengthBefore: 20, lengthAfter: 19.2, widthBefore: 20, widthAfter: 19.4 }));

// ---- Mode isolation: each mode reads only its own fields.
const percentIgnoresSample = C.calculate({ sampleLengthBefore: 10, sampleLengthAfter: 9, shrinkLength: 6, shrinkWidth: 6 });
assert.equal(percentIgnoresSample.shrinkLength, 6);
const testIgnoresPercent = C.calculate({ mode: 'test', shrinkLength: 24, shrinkWidth: 24 });
assert.equal(testIgnoresPercent.shrinkLength, 4);

// ---- Length on hand is run forward through the same shrink.
const enough = C.calculate({ onHand: 150 });
assert.equal(enough.onHand, 150);
assert.equal(enough.yieldLength, 142.5);
assert.equal(enough.shortfall, 0);
assert.equal(enough.enough, true);
const short = C.calculate({ onHand: 90 });
assert.equal(short.yieldLength, 85.5);
assert.ok(near(short.shortfall, 14.5, 1e-9));
assert.equal(short.enough, false);
const noneOnHand = C.calculate({});
assert.equal(noneOnHand.onHand, null);
assert.equal(noneOnHand.yieldLength, null);
assert.equal(noneOnHand.shortfall, null);
assert.equal(noneOnHand.enough, null);
assert.equal(C.calculate({ onHand: '   ' }).onHand, null, 'whitespace means no piece');
const tolerance = C.calculate({ onHand: 100 / 0.95 });
assert.equal(tolerance.yieldLength, 100, 'a piece cut to the cut length is not reported short');
assert.equal(tolerance.enough, true);

// ---- The heavy-shrinkage flag sits at eight percent.
assert.equal(C.calculate({ shrinkLength: 7.9, shrinkWidth: 0 }).heavy, false);
assert.equal(C.calculate({ shrinkLength: 8, shrinkWidth: 0 }).heavy, true);
assert.equal(C.calculate({ shrinkLength: 0, shrinkWidth: 8 }).heavy, true);

// ---- Inputs are not mutated.
const frozen = Object.freeze({ finishedLength: 80, finishedWidth: 60, shrinkLength: 5, shrinkWidth: 3 });
const before = JSON.stringify(frozen);
C.calculate(frozen);
assert.equal(JSON.stringify(frozen), before, 'input untouched');

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Fabric Pre-Wash Shrinkage Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 400, 'description length ' + record.description.length);
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(record.sources.length, 0, 'bespoke percentage arithmetic carries no citation');
assert.ok(record.method.length > 400, 'method explains the arithmetic');
assert.ok(record.guidance.length > 40, 'guidance');
assert.ok(record.tags.includes('sewing') && record.tags.includes('shrinkage') && record.tags.includes('pre-wash'), 'tags');

const others = catalog.tools.filter((tool) => tool.slug !== slug);
const takenSlugs = new Set(others.map((tool) => tool.slug));
const takenNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const takenAliases = new Set();
for (const tool of others) for (const alias of tool.aliases || []) takenAliases.add(alias.toLowerCase());
assert.ok(!takenSlugs.has(slug), 'slug collides with another tool');
assert.ok(!takenNames.has(record.name.toLowerCase()), 'name collides with another tool');
for (const alias of record.aliases) {
  const key = alias.toLowerCase();
  assert.ok(!takenAliases.has(key), 'alias collides with another alias: ' + alias);
  assert.ok(!takenNames.has(key), 'alias repeats another tool name: ' + alias);
}
assert.ok(record.aliases.includes(record.name), 'the page title is listed as an alias');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'alias duplicates');

let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.input, 'malformed case');
  if (testCase.kind === 'golden') {
    const result = C.calculate(testCase.input);
    for (const [key, want] of Object.entries(testCase.expected)) {
      if (key === 'sample') {
        assert.equal(JSON.stringify(result.sample), JSON.stringify(want), testCase.name + ': sample');
        continue;
      }
      assert.equal(typeof result[key], typeof want, testCase.name + ': ' + key + ' type');
      assert.ok(near(result[key], want), testCase.name + ': ' + key + ' (' + result[key] + ' vs ' + want + ')');
    }
    goldens += 1;
  } else {
    assert.equal(testCase.kind, 'validation');
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 10, 'golden cases');
assert.equal(refusals, 16, 'refusal cases');

// ---- Catalog totals pinned site-wide.
assert.equal(catalog.tools.length, 2529, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2268, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Crafts & Hobbies').length, 58,
  'Crafts & Hobbies count');

// ---- Page contract.
assert.match(html, /<title>Fabric Pre-Wash Shrinkage Calculator/);
assert.match(html, /<meta name="description" content="Find the cut size/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-mode', 'in-unit', 'in-length', 'in-width', 'in-sl', 'in-sw',
  'in-bl', 'in-al', 'in-bw', 'in-aw', 'in-onhand', 'out', 'err', 'warn', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
}
assert.ok(html.includes('for="in-mode"') && html.includes('for="in-onhand"'), 'labels');
assert.ok(html.includes('id="test-fields" hidden'), 'wash-test fields start hidden');
assert.ok(!/id="percent-fields"[^>]*hidden/.test(html), 'percentage fields start visible');
assert.ok(html.includes('<option value="percent" selected>') && html.includes('<option value="test">'), 'mode options');
assert.ok(html.includes('<option value="cm" selected>') && html.includes('<option value="in">'), 'unit options');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok(html.includes('aria-live="polite"'), 'live region');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>Fabric Pre-Wash Shrinkage Calculator</h1>'));
assert.ok(html.includes('Everything runs in your browser'), 'storage disclosure');

console.log('fabric pre-wash shrinkage: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
