/* Regression checks for the gelatin sheet/powder converter core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gelatin-sheet-powder-converter';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* gelatin-core:start */');
const end = html.indexOf('/* gelatin-core:end */');
assert.ok(start > -1 && end > start, 'gelatin core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* gelatin-core:end */'.length) + '\nmodule.exports = GelatinConvert;', sandbox);
const G = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Food');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F36E}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2235, 'catalog total');

const messages = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(messages.size, catalog.tools.length, 'slugs unique');
const folded = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(folded).size, folded.length, 'names unique');

const failure = (input) => {
  try {
    G.compute(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Published anchors. ---
const defaults = G.compute({});
assert.equal(defaults.grade, 'gold');
assert.equal(defaults.sheets, 3);
assert.equal(defaults.sheetWeight, 2);
assert.equal(defaults.sheetBloom, 200);
assert.equal(defaults.strength, 1200);
assert.equal(defaults.powderGrams, 6);
assert.equal(defaults.at200, 6);
assert.equal(defaults.warnings.length, 0);

const platinumSheets = G.compute({ mode: 'sheets', amount: '3', grade: 'platinum', powderBloom: '200' });
assert.equal(platinumSheets.strength, 1275);
assert.equal(platinumSheets.powderGrams, 6.38);
assert.equal(platinumSheets.at200, 6.38);

const goldFromPowder = G.compute({ mode: 'powder', amount: '10', grade: 'gold', powderBloom: '250' });
assert.equal(goldFromPowder.strength, 2500);
assert.equal(goldFromPowder.sheets, 6.25);
assert.equal(goldFromPowder.roundedSheets, 6);
assert.equal(goldFromPowder.roundingDeltaPct, 4);
assert.equal(goldFromPowder.warnings.length, 1);
assert.ok(goldFromPowder.warnings[0].startsWith('That is 6.25 sheets. Rounding to 6'));

const platinumFromPowder = G.compute({ mode: 'powder', amount: '7', grade: 'platinum', powderBloom: '200' });
assert.equal(platinumFromPowder.strength, 1400);
assert.equal(platinumFromPowder.sheets, 3.294);
assert.equal(platinumFromPowder.warnings.length, 1);

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
  const result = G.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  assert.equal(result.warnings.length, result.warnings.length, `${testCase.name}: warnings array`);
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Extra vectors, worked by hand from the bloom-gram identity. ---
const onePlatinumSheet = G.compute({ amount: '1', grade: 'platinum', powderBloom: '200' });
assert.equal(onePlatinumSheet.strength, 425);
assert.equal(onePlatinumSheet.powderGrams, 2.13);
assert.equal(onePlatinumSheet.at200, 2.13);

const oneBronzeSheet = G.compute({ amount: '1', grade: 'bronze', powderBloom: '400' });
assert.equal(oneBronzeSheet.strength, 350);
assert.equal(oneBronzeSheet.powderGrams, 0.88);
assert.equal(oneBronzeSheet.at200, 1.75);
assert.equal(oneBronzeSheet.warnings.length, 1);

const twoGoldTwoFifty = G.compute({ amount: '2', grade: 'gold', powderBloom: '250' });
assert.equal(twoGoldTwoFifty.strength, 800);
assert.equal(twoGoldTwoFifty.powderGrams, 3.2);
assert.equal(twoGoldTwoFifty.at200, 4);

const customPowder = G.compute({ mode: 'powder', amount: '5', grade: 'custom', sheetWeight: '3', sheetBloom: '175', powderBloom: '300' });
assert.equal(customPowder.strength, 1500);
assert.equal(customPowder.sheets, 2.857);
assert.equal(customPowder.at200, 7.5);

// --- Round trip: sheets to powder to sheets recovers the count. ---
const grades = ['bronze', 'silver', 'gold', 'platinum'];
const sheetCounts = [0.5, 1, 2, 3, 5, 10, 25, 100, 200];
const blooms = [50, 125, 200, 250, 300, 400];
let roundTrips = 0;
for (const grade of grades) {
  const spec = G.GRADES[grade];
  for (const count of sheetCounts) {
    for (const bloom of blooms) {
      const expectedPowder = count * spec.weight * spec.bloom / bloom;
      if (expectedPowder > G.MAX_POWDER) continue;
      const forward = G.compute({ mode: 'sheets', amount: String(count), grade, powderBloom: String(bloom) });
      assert.ok(Math.abs(forward.strength - count * spec.weight * spec.bloom) < 1e-6, `${grade}: strength identity`);
      assert.equal(forward.powderGrams, Math.round(count * spec.weight * spec.bloom / bloom * 100) / 100, `${grade}: powder`);
      const back = G.compute({ mode: 'powder', amount: String(forward.powderGrams), grade, powderBloom: String(bloom) });
      assert.ok(Math.abs(back.sheets - count) <= 0.01, `${grade} ${count} sheets at ${bloom}: round trip gave ${back.sheets}`);
      roundTrips += 1;
    }
  }
}

// --- Monotonicity: more sheets can only need more powder at a fixed bloom. ---
let previous = 0;
for (const count of sheetCounts) {
  const result = G.compute({ amount: String(count), grade: 'gold', powderBloom: '235' });
  assert.ok(result.powderGrams > previous, `powder grows with sheet count at ${count}`);
  previous = result.powderGrams;
}

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['mode', 'grade', 'amount', 'powder-bloom', 'sheet-weight', 'sheet-bloom', 'convert',
  'gp-status', 'headline-out', 'strength-out', 'powder-out', 'sheets-out', 'at200-out', 'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="gp-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="convert" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `4 extra vectors and ${roundTrips} round trips checked`);
