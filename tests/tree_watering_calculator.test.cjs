/* Regression checks for the tree watering core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/tree-watering-calculator/index.html'), 'utf8');
const start = html.indexOf('/* tree-watering-core:start */');
const end = html.indexOf('/* tree-watering-core:end */');
assert.ok(start > -1 && end > start, 'tree watering core markers missing');
const core = html.slice(start, end + '/* tree-watering-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TreeWateringCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'tree-watering-calculator');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2508, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2247, 'public tools');
assert.ok(entry.testCases.length >= 24, `expected at least 24 cases, found ${entry.testCases.length}`);

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} vs ${expected}`);
};

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.calculate(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const plan = C.calculate(testCase.input);
  const want = testCase.expected;
  close(plan.diameterIn, want.diameterIn, `${label}: diameter in inches`);
  close(plan.soakGallons, want.soakGallons, `${label}: soak gallons`);
  close(plan.soakLitres, want.soakLitres, `${label}: soak litres`);
  close(plan.weeklyGallons, want.weeklyGallons, `${label}: weekly gallons`);
  close(plan.weeklyLitres, want.weeklyLitres, `${label}: weekly litres`);
  close(plan.hoseMinutes, want.hoseMinutes, `${label}: hose minutes`);
  assert.equal(plan.buckets, want.buckets, `${label}: five gallon buckets`);
  assert.equal(plan.cans, want.cans, `${label}: ten litre cans`);
  assert.equal(plan.buckets, Math.ceil(plan.soakGallons / 5), `${label}: buckets round up`);
  assert.equal(plan.cans, Math.ceil(plan.soakLitres / 10), `${label}: cans round up`);
  close(plan.weeklyLitres, plan.soakLitres * plan.soaks, `${label}: weekly total is the soak times the count`);
  close(plan.weeklyGallons, plan.soakGallons * plan.soaks, `${label}: weekly gallons follow the soak`);
}

// The rule itself: ten US gallons per inch of trunk diameter, applied once.
const rule = C.calculate({ units: 'imperial', diameter: '4', soaks: '1', flow: '4' });
assert.equal(rule.soakGallons, 40, 'four inches take forty gallons');
close(rule.soakLitres, 40 * C.LITRES_PER_GALLON, 'imperial soak converts to litres');
close(rule.diameterCm, 4 * C.CM_PER_INCH, 'four inches is ten point one six centimetres');

// A metric entry and its imperial equivalent describe the same trunk and the same soak.
const metricTree = C.calculate({ units: 'metric', diameter: '10', soaks: '1', flow: '15' });
const imperialTree = C.calculate({ units: 'imperial', diameter: String(10 / C.CM_PER_INCH), soaks: '1', flow: String(15 / C.LITRES_PER_GALLON) });
close(metricTree.soakLitres, imperialTree.soakLitres, 'the two unit systems agree on the volume');
close(metricTree.hoseMinutes, imperialTree.hoseMinutes, 'the two unit systems agree on the hose time');
assert.ok(Math.abs(metricTree.soakLitres / metricTree.diameterCm - 14.903) < 0.001, 'a centimetre of trunk takes about fifteen litres');

// Doubling the trunk doubles the soak; doubling the soaks doubles the week; a faster hose shortens the time.
const single = C.calculate({ units: 'metric', diameter: '10', soaks: '1', flow: '15' });
const doubleTrunk = C.calculate({ units: 'metric', diameter: '20', soaks: '1', flow: '15' });
const doubleSoaks = C.calculate({ units: 'metric', diameter: '10', soaks: '2', flow: '15' });
const fastHose = C.calculate({ units: 'metric', diameter: '10', soaks: '1', flow: '30' });
close(doubleTrunk.soakLitres, single.soakLitres * 2, 'twice the trunk takes twice the water');
close(doubleSoaks.weeklyLitres, single.weeklyLitres * 2, 'two soaks double the week');
close(fastHose.hoseMinutes, single.hoseMinutes / 2, 'twice the flow halves the time');
assert.equal(single.soaks, 1, 'one soak is one soak');
assert.equal(doubleSoaks.weeklyLitres, doubleSoaks.soakLitres * 2, 'the weekly total is per soak');
assert.ok(single.soakLitres > 149 && single.soakLitres < 149.1, 'ten centimetres lands near 149 litres');
assert.equal(single.buckets, 8, 'a 39.4 gallon soak is eight five gallon buckets');
assert.equal(single.cans, 15, '149 litres is fifteen ten litre watering cans');

// Numeric arguments are accepted as well as strings, and the parser does not drift.
const numeric = C.calculate({ units: 'metric', diameter: 10, soaks: 1, flow: 15 });
close(numeric.soakLitres, single.soakLitres, 'numeric inputs match string inputs');

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('tree') && entry.tags.includes('watering'));
assert.equal(entry.category, 'Home & Garden');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Home & Garden').length, 57, 'Home & Garden count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('arborday.org')), 'arbor day rule cited');
assert.ok(entry.sources.some((source) => source.url.includes('denverwater.org')), 'deep watering guidance cited');
assert.ok(!/https?:\/\//.test(entry.description), 'no links in the description');

// Page contract: the shared shell, labelled controls, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((url) => !url.includes('www.w3.org'));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['diameter', 'units', 'soaks', 'flow']) {
  assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['error', 'results', 'out-soak', 'out-gallons', 'out-weekly', 'out-minutes', 'rows', 'method']) {
  assert.ok(html.includes(`id="${id}"`), `container ${id}`);
}
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.ok(!/\bsrc="\/(?!assets\/)/.test(html), 'only shared assets are loaded');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');
assert.ok(html.includes('value="metric"') && html.includes('value="imperial"'), 'both unit systems are offered');

console.log(`tree watering calculator: ${entry.testCases.length} catalog cases replayed`);
