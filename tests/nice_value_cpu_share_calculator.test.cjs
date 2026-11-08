/* Regression checks for the nice-value CPU share core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'nice-value-cpu-share-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* nice-share-core:start */');
const end = html.indexOf('/* nice-share-core:end */');
assert.ok(start > -1 && end > start, 'nice-share core markers missing');
const core = html.slice(start, end + '/* nice-share-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = NiceShareCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.analyze(input));
const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

// Documented constants: the kernel's prio_to_weight table in full.
assert.equal(C.NICE_MIN, -20);
assert.equal(C.NICE_MAX, 19);
assert.equal(C.BASE_WEIGHT, 1024);
assert.equal(C.MAX_COMPETITORS, 10000);
assert.equal(C.WEIGHTS.length, 40, 'forty weights');
assert.deepEqual(plain(C.WEIGHTS), [
  88761, 71755, 56483, 46273, 36291,
  29154, 23254, 18705, 14949, 11916,
  9548, 7620, 6100, 4904, 3906,
  3121, 2501, 1991, 1586, 1277,
  1024, 820, 655, 526, 423,
  335, 272, 215, 172, 137,
  110, 87, 70, 56, 45,
  36, 29, 23, 18, 15
]);
assert.equal(C.MESSAGES.nice, 'Nice must be a whole number from -20 to 19.');
assert.equal(C.MESSAGES.competitors, 'Competing processes must be a whole number from 0 to 10000.');
assert.equal(C.MESSAGES.peerNice, 'Their nice value must be a whole number from -20 to 19.');

// Every nice value maps to its kernel weight.
assert.equal(C.weight('0'), 1024);
assert.equal(C.weight('-20'), 88761);
assert.equal(C.weight('19'), 15);
assert.equal(C.weight('10'), 110);
assert.equal(C.weight('+5'), 335);
assert.equal(C.weight('-1'), 1277);

// Textbook cases.
const even = run({ nice: '0', competitors: '1', peerNice: '0' });
assert.equal(even.sharePercent, 50);
assert.equal(even.peerSharePercent, 50);
assert.equal(even.totalWeight, 2048);
assert.equal(even.relativeWeight, 1);
assert.equal(even.equalSharePercent, 50);

const ten = run({ nice: '10', competitors: '1', peerNice: '0' });
closeTo(ten.sharePercent, 110 / 1134 * 100, 'nice 10 share');
closeTo(ten.peerSharePercent, 1024 / 1134 * 100, 'nice 0 peer share');
assert.equal(ten.weight, 110);
assert.equal(ten.peerWeight, 1024);
assert.equal(ten.competitorWeight, 1024);
assert.equal(ten.totalWeight, 1134);

const dominant = run({ nice: '-20', competitors: '4', peerNice: '0' });
closeTo(dominant.sharePercent, 88761 / (88761 + 4096) * 100, 'nice -20 share');
closeTo(dominant.peerSharePercent, 4096 / 92857 * 100, 'four nice 0 tasks');
assert.equal(dominant.equalSharePercent, 20);

const squeezed = run({ nice: '19', competitors: '3', peerNice: '-20' });
closeTo(squeezed.sharePercent, 15 / (15 + 3 * 88761) * 100, 'nice 19 share');
assert.ok(squeezed.sharePercent > 0 && squeezed.sharePercent < 0.01, 'tiny share keeps its value');

const top = run({ nice: '-20', competitors: '1', peerNice: '19' });
closeTo(top.sharePercent, 88761 / 88776 * 100, 'nice -20 against nice 19');
assert.ok(top.sharePercent > 99.9 && top.sharePercent < 100, 'almost the whole CPU');

// Alone on the CPU there is nobody to share with.
const alone = run({ nice: '-20', competitors: '0', peerNice: '19' });
assert.equal(alone.sharePercent, 100);
assert.equal(alone.peerSharePercent, 0);
assert.equal(alone.competitorWeight, 0);
assert.equal(alone.equalSharePercent, 100);

// The largest competing count stays exact and finite.
const crowded = run({ nice: '19', competitors: '10000', peerNice: '-20' });
closeTo(crowded.sharePercent, 15 / (15 + 10000 * 88761) * 100, 'crowded share');
assert.equal(crowded.totalWeight, 887610015);

// Relative weight and percentage formatting.
assert.equal(C.formatRelative(1), '1.00\u00d7');
assert.equal(C.formatRelative(88761 / 1024), '86.68\u00d7');
assert.equal(C.formatRelative(15 / 1024), '0.0146\u00d7');
assert.equal(C.formatPercent(50), '50.0%');
assert.equal(C.formatPercent(9.700176366843033), '9.70%');
assert.equal(C.formatPercent(0), '0%');
assert.equal(C.formatPercent(100), '100.0%');
assert.equal(C.formatPercent(0.5), '0.500%');

// The reference table covers all 40 values, decreasing throughout.
const table = plain(C.table());
assert.equal(table.length, 40);
assert.equal(table[0].nice, -20);
assert.equal(table[39].nice, 19);
assert.equal(table[20].nice, 0);
assert.equal(table[20].weight, 1024);
assert.equal(table[20].sharePercent, 50);
let previousWeight = Infinity;
let previousShare = Infinity;
for (const row of table){
  assert.ok(row.weight < previousWeight, 'weights fall as nice rises at ' + row.nice);
  assert.ok(row.sharePercent < previousShare, 'shares fall as nice rises at ' + row.nice);
  previousWeight = row.weight;
  previousShare = row.sharePercent;
}

// Validation: each refusal names the field and its range.
const bad = (input, pattern) => assert.throws(() => C.analyze(input), pattern);
bad({ nice: '', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: '   ', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: 'high', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: '5.5', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: '20', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: '-21', competitors: '1', peerNice: '0' }, /Nice must be a whole number from -20 to 19\./);
bad({ nice: '0', competitors: '', peerNice: '0' }, /Competing processes must be a whole number from 0 to 10000\./);
bad({ nice: '0', competitors: '-1', peerNice: '0' }, /Competing processes must be a whole number from 0 to 10000\./);
bad({ nice: '0', competitors: '10001', peerNice: '0' }, /Competing processes must be a whole number from 0 to 10000\./);
bad({ nice: '0', competitors: '1.5', peerNice: '0' }, /Competing processes must be a whole number from 0 to 10000\./);
bad({ nice: '0', competitors: '1', peerNice: '' }, /Their nice value must be a whole number from -20 to 19\./);
bad({ nice: '0', competitors: '1', peerNice: '20' }, /Their nice value must be a whole number from -20 to 19\./);

// The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="nice-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/type="text" id="nice"/.test(html), 'nice value is a text field');
assert.ok(/type="text" id="competitors"/.test(html), 'competitor count is a text field');
assert.ok(/type="text" id="peer-nice"/.test(html), 'competing nice value is a text field');
for (const control of ['nice', 'competitors', 'peer-nice']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<table id="weights">/.test(html), 'page shows the weight table');
assert.ok(/<tbody id="weights-body">/.test(html), 'table body is addressable');
assert.ok(/<caption>/.test(html), 'table has a caption');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>CPU Nice Value &amp; Share Calculator<\/h1>/.test(html), 'page has its heading');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'CPU Nice Value & Share Calculator');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('prio_to_weight'), 'method names the kernel table');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

let checked = 0;
for (const testCase of record.testCases){
  const { expected } = testCase;
  if (expected.error){
    let message = null;
    try {
      C.analyze(testCase.input);
    } catch (error){
      message = error.message;
    }
    assert.equal(message, expected.error, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, value] of Object.entries(expected)){
    assert.equal(typeof actual[key], 'number', `${testCase.name}.${key} is numeric`);
    const tolerance = Math.max(Math.abs(value) * 1e-9, 1e-9);
    assert.ok(Math.abs(actual[key] - value) <= tolerance,
      `${testCase.name}.${key}: ${actual[key]} vs ${value}`);
    checked += 1;
  }
}

console.log('nice-value-cpu-share-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' numeric fields)');
