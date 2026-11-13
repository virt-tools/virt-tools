/* Regression checks for the radar range equation core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'radar-range-equation-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* radar-range-core:start */');
const end = html.indexOf('/* radar-range-core:end */');
assert.ok(start > -1 && end > start, 'radar range core markers missing');
const core = html.slice(start, end + '/* radar-range-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RadarRangeCore;', sandbox);
const C = sandbox.module.exports;

const DEFAULTS = {
  power: '1000', gain: '30', frequency: '3', rcs: '1',
  loss: '3', sensitivity: '-100', range: '1000'
};
const run = (overrides) => C.plan(Object.assign({}, DEFAULTS, overrides || {}));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' differs from ' + expected + ' by more than ' + tolerance);
};

// Physical constants and the two-way spreading factor.
assert.equal(C.SPEED_OF_LIGHT, 299792458);
close(C.FOUR_PI_CUBED, 1984.4017, 0.001, '(4 pi)^3');

// Independent published anchors, not derived from this core.
// 1 MW S-band radar, 40 dBi, 1 m^2 target, 6 dB loss, -98 dBm: about 168 km.
close(run({ power: '1000000', gain: '40', frequency: '3', rcs: '1', loss: '6', sensitivity: '-98' }).maxRangeM / 1000,
  168, 0.5, 'everythingrf S-band worked example');
// 1 MW at 1 GHz, 40 dBi, 0.5 m^2, no loss, -97.99 dBm (MATLAB radareqrng, 345.16 km).
close(run({ power: '1000000', gain: '40', frequency: '1', rcs: '0.5', loss: '0', sensitivity: '-97.99' }).maxRangeM / 1000,
  345.16, 1.0, 'MATLAB radar equation example');
// 12 kW X-band marine radar, 31 dBi, 10 m^2, 8 dB loss, -92 dBm: about 12.5 km.
close(run({ power: '12000', gain: '31', frequency: '9.41', rcs: '10', loss: '8', sensitivity: '-92' }).maxRangeM / 1000,
  12.5, 0.1, 'waveshed marine X-band example');

// Default state and the headline figures.
const base = run();
close(base.maxRangeM, 12602.083, 0.05, 'default maximum range');
close(base.wavelengthMm, 99.931, 0.002, 'default wavelength');
close(base.receivedDbm, -55.982, 0.002, 'default echo power at 1 km');
close(base.marginDb, 44.018, 0.002, 'default margin');
close(base.roundTripUs, 6.671, 0.002, 'default round-trip time');

// Fourth-power scaling: 16x power doubles range, 1/10 RCS is 10^(1/4) of the range.
const doubledPower = run({ power: '16000' });
close(doubledPower.maxRangeM / base.maxRangeM, 2, 1e-12, '16x power doubles range');
const tenthRcs = run({ rcs: '0.1' });
close(tenthRcs.maxRangeM / base.maxRangeM, Math.pow(0.1, 0.25), 1e-12, 'RCS decade scaling');
// Ten times the range costs 40 dB (the inverse fourth power).
close(run({ range: '10000' }).receivedDbm - base.receivedDbm, -40, 1e-9, 'inverse fourth power');
// At its own maximum range the echo lands on the sensitivity, so the margin is zero.
const atMax = run({ range: String(base.maxRangeM) });
close(atMax.marginDb, 0, 1e-9, 'margin at maximum range');
// Wavelength follows c / f.
close(run({ frequency: '10' }).wavelengthMm, 29.9792458, 1e-6, 'wavelength at 10 GHz');
// Loss is a subtraction in decibels.
close(run({ loss: '13' }).receivedDbm - base.receivedDbm, -10, 1e-9, '10 dB extra loss');
// Gain enters squared.
close(run({ gain: '40' }).receivedDbm - base.receivedDbm, 20, 1e-9, '10 dB extra gain');

// Refusals carry the page's user-facing wording.
const refuse = (overrides, message) => {
  try {
    run(overrides);
    assert.fail('expected a refusal for ' + JSON.stringify(overrides));
  } catch (error) {
    assert.equal(error.message, message);
  }
};
refuse({ power: '' }, 'Peak power is required.');
refuse({ gain: 'abc' }, 'Antenna gain must be a number.');
refuse({ power: '0' }, 'Peak power must be from 0.0001 to 1000000 W.');
refuse({ gain: '81' }, 'Antenna gain must be from 0 to 80 dBi.');
refuse({ frequency: '0' }, 'Frequency must be from 0.001 to 300 GHz.');
refuse({ rcs: '0.00001' }, 'Radar cross section must be from 0.0001 to 1000000 m².');
refuse({ loss: '-1' }, 'System losses must be from 0 to 100 dB.');
refuse({ sensitivity: '1' }, 'Receiver sensitivity must be from -200 to 0 dBm.');
refuse({ range: '0.05' }, 'Evaluation range must be from 0.1 to 10000000 m.');
refuse({ power: '1e3' }, 'Peak power must be a number.');

// The catalog record replays through this core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(catalog.tools.length, 2251, 'catalog total');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
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
      C.plan(testCase.input);
      assert.fail(testCase.name + ': expected a refusal');
    } catch (error) {
      assert.equal(error.message, testCase.expected.error, testCase.name);
    }
    continue;
  }
  golden += 1;
  const result = C.plan(testCase.input);
  for (const key of ['maxRangeM', 'receivedDbm', 'marginDb', 'wavelengthMm', 'roundTripUs']) {
    close(result[key], testCase.expected[key], 0.01, testCase.name + ' ' + key);
  }
}
assert.equal(golden, 24, 'golden case count');

// Page contract: shared chrome, one form, defaults pinned, no storage, no network, no HTML sinks.
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style\.css">/);
assert.equal((html.match(/id="radar-form"/g) || []).length, 1);
assert.ok(html.includes('aria-live="polite"'));
for (const id of ['in-power', 'in-gain', 'in-freq', 'in-rcs', 'in-loss', 'in-sens', 'in-range']) {
  assert.ok(html.includes('id="' + id + '"'), 'input present: ' + id);
}
assert.match(html, /id="in-power"[^>]*value="1000"/);
assert.match(html, /id="in-gain"[^>]*value="30"/);
assert.match(html, /id="in-freq"[^>]*value="3"/);
assert.match(html, /id="in-rcs"[^>]*value="1"/);
assert.match(html, /id="in-loss"[^>]*value="3"/);
assert.match(html, /id="in-sens"[^>]*value="-100"/);
assert.match(html, /id="in-range"[^>]*value="1000"/);
assert.match(html, /\.actions button\{[^}]*min-height:44px/);
assert.match(html, /\.field input\{[^}]*min-height:44px/);
assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html), 'page stores nothing');
assert.ok(!/https?:\/\//.test(html), 'page references no external URL');
assert.ok(!/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(html), 'page makes no requests');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page uses no HTML sinks');

console.log(slug + ' core: all checks passed (' + record.testCases.length + ' catalog cases, '
  + golden + ' golden, 3 published anchors)');
