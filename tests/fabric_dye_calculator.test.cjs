/* Regression checks for the fabric dye calculator core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'fabric-dye-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* fabric-dye-core:start */');
const end = html.indexOf('/* fabric-dye-core:end */');
assert.ok(start > -1 && end > start, 'dye core markers missing');
const core = html.slice(start, end + '/* fabric-dye-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FabricDyeCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const analyze = (input) => plain(C.analyze(input));

// Ranges and quick-pick tables.
assert.equal(C.MIN_WEIGHT, 1);
assert.equal(C.MAX_WEIGHT, 20000);
assert.equal(C.MAX_SIDE, 2000);
assert.equal(C.MAX_GSM, 2000);
assert.equal(C.MIN_DEPTH, 0.01);
assert.equal(C.MAX_DEPTH, 20);
assert.equal(C.MIN_RATIO, 1);
assert.equal(C.MAX_RATIO, 50);
assert.deepEqual(plain(C.DEPTHS), [0.25, 0.5, 1, 2, 3, 4, 6, 8, 10]);
assert.deepEqual(plain(C.RATIOS), [5, 10, 15, 20]);

// The arithmetic, written out independently: dye is a percentage of the dry
// fabric mass, water is the bath ratio in litres per kilogram.
const base = analyze({ mode: 'weight', weight: '200', depth: '2', ratio: '10' });
assert.equal(200 * 2 / 100, 4, 'oracle: 200 g at 2 % is 4 g of dye');
assert.equal(200 * 10 / 1000, 2, 'oracle: a 10:1 bath on 200 g is 2 L');
assert.equal(base.mode, 'weight');
assert.equal(base.fabricWeight, 200);
assert.equal(base.depth, 2);
assert.equal(base.bathRatio, 10);
assert.equal(base.dyeGrams, 4);
assert.equal(base.waterLitres, 2);
assert.equal(base.waterMillilitres, 2000);
assert.equal(base.gramsPerLitre, 2);

// Size mode: length x width becomes square metres, then gsm gives grams.
const sized = analyze({ mode: 'size', length: '150', width: '100', gsm: '150', depth: '2', ratio: '10' });
assert.equal(150 * 100 / 10000 * 150, 225, 'oracle: 150 x 100 cm at 150 gsm is 225 g');
assert.equal(sized.mode, 'size');
assert.equal(sized.fabricWeight, 225);
assert.equal(sized.dyeGrams, 4.5);
assert.equal(sized.waterLitres, 2.25);
assert.equal(sized.gramsPerLitre, 2);

// Dye per litre depends only on depth and ratio, not on the batch size.
for (const grams of ['100', '500', '2000']) {
  const row = analyze({ mode: 'weight', weight: grams, depth: '2', ratio: '10' });
  assert.equal(row.gramsPerLitre, 2, `two percent in a 10:1 bath at ${grams} g`);
  assert.equal(row.dyeGrams, Number(grams) * 0.02, `dye scales with ${grams} g`);
}

// The quick-pick tables keep their arithmetic.
const depths = plain(C.depthRows('200', '10'));
assert.equal(depths.length, 9);
assert.deepEqual(depths[3], { depth: 2, grams: 4, perLitre: 2 });
assert.deepEqual(depths[8], { depth: 10, grams: 20, perLitre: 10 });
assert.equal(depths[0].grams, 0.5);
const ratios = plain(C.ratioRows('200', '2'));
assert.equal(ratios.length, 4);
assert.deepEqual(ratios[0], { ratio: 5, litres: 1, perLitre: 4 });
assert.deepEqual(ratios[2], { ratio: 15, litres: 3, perLitre: 1.333 });
assert.deepEqual(ratios[3], { ratio: 20, litres: 4, perLitre: 1 });

// Validation: each refusal names the problem.
assert.throws(() => C.analyze({ mode: 'weight', weight: '', depth: '2', ratio: '10' }), /Enter the dry fabric weight in grams, for example 200\./);
assert.throws(() => C.analyze({ mode: 'weight', weight: ' ', depth: '2', ratio: '10' }), /Enter the dry fabric weight in grams, for example 200\./);
for (const bad of ['abc', '150,5', '-200', '2e3', '.5', '200.']) {
  assert.throws(() => C.analyze({ mode: 'weight', weight: bad, depth: '2', ratio: '10' }), /must be a number of grams such as 200 or 157\.5/, bad);
}
for (const bad of ['0', '0.5', '25000', '999999']) {
  assert.throws(() => C.analyze({ mode: 'weight', weight: bad, depth: '2', ratio: '10' }), /must be between 1 and 20,000 g/, bad);
}
assert.throws(() => C.analyze({ mode: 'volume', depth: '2', ratio: '10' }), /Choose whether you are entering the fabric weight or the fabric size\./);
assert.throws(() => C.analyze({ mode: 'size', length: '', width: '100', gsm: '150', depth: '2', ratio: '10' }), /Enter the fabric length in centimetres, for example 150\./);
assert.throws(() => C.analyze({ mode: 'size', length: '150', width: '3000', gsm: '150', depth: '2', ratio: '10' }), /fabric width must be between 1 and 2,000 cm/);
assert.throws(() => C.analyze({ mode: 'size', length: '150', width: '100', gsm: '5', depth: '2', ratio: '10' }), /must be between 10 and 2,000 g\/m/);
assert.throws(() => C.analyze({ mode: 'size', length: '2000', width: '2000', gsm: '2000', depth: '2', ratio: '10' }), /more than 20,000 g; split it into smaller batches\./);
assert.throws(() => C.analyze({ mode: 'size', length: '1', width: '1', gsm: '10', depth: '2', ratio: '10' }), /less than 1 g; enter the weight directly instead\./);
assert.throws(() => C.analyze({ mode: 'weight', weight: '200', depth: '', ratio: '10' }), /Enter the shade depth as a percentage, for example 2\./);
assert.throws(() => C.analyze({ mode: 'weight', weight: '200', depth: '25', ratio: '10' }), /must be between 0.01 and 20 %/);
assert.throws(() => C.analyze({ mode: 'weight', weight: '200', depth: '2', ratio: '0' }), /must be between 1 and 50 litres per kilogram/);
assert.throws(() => C.analyze({ mode: 'weight', weight: '200', depth: '2', ratio: '60' }), /must be between 1 and 50 litres per kilogram/);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="dye-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['mode', 'weight', 'length', 'width', 'gsm', 'depth', 'ratio']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<option value="weight">/.test(html) && /<option value="size">/.test(html), 'both fabric amount modes are offered');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Fabric Dye Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 24, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');

const tolerance = {
  fabricWeight: 0.002,
  dyeGrams: 0.002,
  waterLitres: 0.0002,
  waterMillilitres: 0.02,
  gramsPerLitre: 0.002,
  depth: 0.0001,
  bathRatio: 0.0001,
};
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.analyze(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = analyze(input);
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number' && key in tolerance) {
      assert.ok(Math.abs(result[key] - value) <= tolerance[key], `${testCase.name} ${key}: ${result[key]} vs ${value}`);
    } else {
      assert.deepEqual(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('fabric-dye-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + depths.length + ' depth rows, ' + ratios.length + ' bath ratios)');
