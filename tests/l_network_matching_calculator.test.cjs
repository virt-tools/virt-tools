/* Regression checks for the L-network matching core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'l-network-matching-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* l-network-core:start */');
const end = html.indexOf('/* l-network-core:end */');
assert.ok(start > -1 && end > start, 'match core markers missing');
const core = html.slice(start, end + '/* l-network-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = LNetworkCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const analyze = (input) => plain(C.analyze(input));

// Ranges and the quick-pick table.
assert.equal(C.MIN_RESISTANCE, 0.5);
assert.equal(C.MAX_RESISTANCE, 10000);
assert.equal(C.MAX_RATIO, 1000);
assert.equal(C.MIN_FREQUENCY, 0.01);
assert.equal(C.MAX_FREQUENCY, 40000);
assert.deepEqual(plain(C.QUICK_RATIOS), [2, 4, 9, 16]);

// Oracle: written out independently. For a 50 ohm source and a 200 ohm load the
// resistance ratio is 4, so Q = sqrt(3); the series arm sits with the smaller
// resistance and the shunt arm across the larger one.
const base = analyze({ source: '50', load: '200', frequency: '14' });
const q = Math.sqrt(4 - 1);
const xs = q * 50;
const xp = 200 / q;
const w = 2 * Math.PI * 14e6;
assert.equal(base.matched, false);
assert.equal(base.highSide, 'load');
assert.equal(base.lowSide, 'source');
assert.equal(base.ratio, 4);
assert.ok(Math.abs(base.q - q) < 1e-5, 'Q is sqrt(ratio - 1)');
assert.ok(Math.abs(base.seriesReactanceOhms - xs) < 1e-4, 'series reactance is Q x R_low');
assert.ok(Math.abs(base.shuntReactanceOhms - xp) < 1e-4, 'shunt reactance is R_high / Q');
assert.ok(Math.abs(base.lowPassSeriesHenries - xs / w) < 1e-11, 'series L is X / omega');
assert.ok(Math.abs(base.lowPassShuntFarads - 1 / (w * xp)) < 1e-14, 'shunt C is 1 / (omega X)');
assert.ok(Math.abs(base.highPassSeriesFarads - 1 / (w * xs)) < 1e-14, 'high-pass series C swaps the arms');
assert.ok(Math.abs(base.highPassShuntHenries - xp / w) < 1e-11, 'high-pass shunt L swaps the arms');
assert.ok(Math.abs(base.bandwidthMHz - 14 / q) < 1e-4, 'bandwidth is f / Q');

// Step-down: the series arm follows the smaller resistance, which is now the load.
const step = analyze({ source: '50', load: '12.5', frequency: '7' });
assert.equal(step.highSide, 'source');
assert.equal(step.lowSide, 'load');
assert.ok(Math.abs(step.q - q) < 1e-5);
assert.ok(Math.abs(step.seriesReactanceOhms - q * 12.5) < 1e-4);
assert.ok(Math.abs(step.shuntReactanceOhms - 50 / q) < 1e-4);

// Equal resistances need no network at all.
const same = analyze({ source: '50', load: '50', frequency: '14' });
assert.equal(same.matched, true);
assert.equal(same.q, 0);
assert.equal(same.ratio, 1);
assert.equal(same.lowPassSeriesHenries, null);
assert.equal(same.highPassShuntHenries, null);

// Low-frequency matches need big parts; high-frequency ones need small parts.
const lowBand = analyze({ source: '50', load: '200', frequency: '0.5' });
const highBand = analyze({ source: '50', load: '200', frequency: '2400' });
assert.ok(lowBand.lowPassSeriesHenries > highBand.lowPassSeriesHenries * 1000, 'L scales down with frequency');
assert.equal(lowBand.q, highBand.q, 'Q depends only on the resistance ratio');

// The quick-pick rows keep the same arithmetic.
const rows = plain(C.ratioRows('50', '14'));
assert.equal(rows.length, 4);
assert.deepEqual(rows.map((row) => row.ratio), [2, 4, 9, 16]);
assert.equal(rows[0].loadResistance, 100);
assert.ok(Math.abs(rows[1].q - q) < 1e-5);
assert.ok(Math.abs(rows[1].lowPassSeriesHenries - base.lowPassSeriesHenries) < 1e-12);
assert.ok(Math.abs(rows[1].lowPassShuntFarads - base.lowPassShuntFarads) < 1e-15);

// Validation: each refusal names the field and the limit.
assert.throws(() => C.analyze({ source: '', load: '200', frequency: '14' }), /Enter the source resistance in ohms, for example 50\./);
for (const bad of ['abc', '50,5', '5e1']) {
  assert.throws(() => C.analyze({ source: bad, load: '200', frequency: '14' }), /source resistance must be a number of ohms such as 50 or 75/, bad);
}
for (const bad of ['0.4', '0', '12000']) {
  assert.throws(() => C.analyze({ source: bad, load: '200', frequency: '14' }), /source resistance must be between 0.5 and 10,000/, bad);
}
assert.throws(() => C.analyze({ source: '50', load: '', frequency: '14' }), /Enter the load resistance in ohms, for example 200\./);
assert.throws(() => C.analyze({ source: '50', load: '0.49', frequency: '14' }), /load resistance must be between 0.5 and 10,000/);
assert.throws(() => C.analyze({ source: '50', load: '200', frequency: '' }), /Enter the frequency in MHz, for example 14\./);
assert.throws(() => C.analyze({ source: '50', load: '200', frequency: '50000' }), /frequency must be between 0.01 and 40,000 MHz/);
assert.throws(() => C.analyze({ source: '0.5', load: '1000', frequency: '10' }), /A 2000 : 1 resistance ratio is too extreme for one L-section/);
assert.throws(() => C.ratioRows('', '14'), /Enter the source resistance/);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="match-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['source', 'load', 'frequency']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'L-Network Matching Calculator');
assert.equal(record.category, 'Communications Engineering');
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

const close = (actual, expected, label) => {
  const tolerance = Math.max(Math.abs(expected) * 1e-4, 1e-14);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
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
    if (typeof value === 'number') {
      close(result[key], value, `${testCase.name} ${key}`);
    } else {
      assert.deepEqual(result[key], value, `${testCase.name} ${key}`);
    }
  }
}

console.log('l-network-matching-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + rows.length + ' quick ratios)');
