/* Regression checks for the video signal levels core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'video-signal-levels-converter';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* video-levels-core:start */');
const end = html.indexOf('/* video-levels-core:end */');
assert.ok(start > -1 && end > start, 'video levels core markers missing');
const core = html.slice(start, end + '/* video-levels-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = VideoLevelsCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = { range: 'legal', unit: '8', value: '235' };
const run = (overrides) => C.convert(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

// The published coding constants, not derived from this core.
assert.equal(C.BLACK8_LEGAL, 16);
assert.equal(C.WHITE8_LEGAL, 235);
assert.equal(C.SPAN_LEGAL, 219);
assert.equal(C.FULL_MAX, 255);
close(C.SPAN_LEGAL / 100, 2.19, 1e-12, 'one IRE in 8-bit codes');

// Independent anchors: BT.601/BT.709 luma coding, black 16 / white 235 (64 / 940).
const black = run({ value: '16' });
const white = run({ value: '235' });
close(black.ire, 0, 1e-12, 'code 16 is 0 IRE');
close(white.ire, 100, 1e-12, 'code 235 is 100 IRE');
close(white.code10, 940, 1e-9, '10-bit white');
close(white.code12, 3760, 1e-9, '12-bit white');
close(black.code10, 64, 1e-9, '10-bit black');
close(black.code12, 256, 1e-9, '12-bit black');
// Superwhite and footroom figures quoted in QC tables.
close(run({ value: '255' }).ire, 109.132, 0.001, 'code 255 in IRE');
close(run({ value: '0' }).ire, -7.306, 0.001, 'code 0 in IRE');
// Full range puts the whole container on 0-100.
close(run({ range: 'full', value: '0' }).ire, 0, 1e-12, 'full-range black');
close(run({ range: 'full', value: '255' }).ire, 100, 1e-12, 'full-range white');
close(run({ range: 'full', value: '128' }).ire, 50.196, 0.001, 'full-range mid code');

// Default state and the headline figures.
const base = run();
close(base.ire, 100, 1e-12, 'default IRE');
close(base.percentOfFull, 92.157, 0.001, 'default percent of full range');
assert.equal(base.status, 'within');

// Scales are the same signal sampled more finely.
close(run({ unit: '10', value: '940' }).code8, 235, 1e-9, '10-bit to 8-bit');
close(run({ unit: '12', value: '3760' }).code8, 235, 1e-9, '12-bit to 8-bit');
close(run({ unit: '10', value: '940' }).code12, 3760, 1e-9, '10-bit to 12-bit');
// IRE is linear in the code offset.
close(run({ unit: 'ire', value: '50' }).code8, 125.5, 1e-9, '50 IRE in 8-bit codes');
close(run({ unit: 'ire', value: '100' }).code8, 235, 1e-9, '100 IRE is white');
close(run({ unit: 'ire', value: '0' }).code8, 16, 1e-9, '0 IRE is black');
// Legal excursions are reported with their size and a legal target.
const head = run({ value: '255' });
assert.equal(head.status, 'above');
close(head.excursion, 9.132, 0.001, 'headroom excursion');
close(head.legalTarget8, 235, 1e-9, 'headroom legal target');
const foot = run({ value: '0' });
assert.equal(foot.status, 'below');
close(foot.excursion, 7.306, 0.001, 'footroom excursion');
close(foot.legalTarget8, 16, 1e-9, 'footroom legal target');
assert.equal(run({ range: 'full', value: '255' }).status, 'within');
// An unknown range or unit falls back to the documented defaults.
assert.equal(run({ range: 'bogus' }).range, 'legal');
assert.equal(run({ unit: 'bogus' }).unit, '8');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ value: '' }, 'A signal level is required.');
refuse({ value: '   ' }, 'A signal level is required.');
refuse({ value: 'abc' }, 'Signal level must be a number.');
refuse({ value: '1e3' }, 'Signal level must be a number.');
refuse({ value: '256' }, '8-bit code must be from 0 to 255.');
refuse({ value: '-1' }, '8-bit code must be from 0 to 255.');
refuse({ unit: '10', value: '1024' }, '10-bit code must be from 0 to 1023.');
refuse({ unit: '12', value: '4096' }, '12-bit code must be from 0 to 4095.');
refuse({ unit: 'ire', value: '121' }, 'IRE must be from -20 to 120.');
refuse({ unit: 'ire', value: '-21' }, 'IRE must be from -20 to 120.');

// The catalog record replays through this core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2231, 'catalog total');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 30, 'catalog has the full test case set');
assert.ok(record.method.length > 800, 'method documents the model');
assert.ok(record.sources.length >= 3);
for (const name of record.aliases) {
  const clash = catalog.tools.filter((tool) => tool.slug !== slug)
    .some((tool) => tool.name === name || (tool.aliases || []).includes(name));
  assert.equal(clash, false, 'alias is unique: ' + name);
}
let golden = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    try {
      C.convert(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.convert(testCase.input);
  for (const key of ['ire', 'code8', 'code10', 'code12', 'percentOfFull']) {
    close(result[key], testCase.expected[key], 0.01, testCase.name + ' ' + key);
  }
  assert.equal(result.status, testCase.expected.status, testCase.name + ' status');
}
assert.equal(golden, 24, 'golden case count');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="levels-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
for (const id of ['in-range', 'in-unit', 'in-value']) {
  assert.ok(html.includes('id="' + id + '"'), 'control present: ' + id);
}
assert.match(html, /<option value="legal" selected>/);
assert.match(html, /<option value="8" selected>/);
assert.match(html, /id="in-value"[^>]*value="235"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input,\.field select\{[^}]*min-height:44px/);
assert.match(html, /<table class="ref">/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, 5 published anchors)');
