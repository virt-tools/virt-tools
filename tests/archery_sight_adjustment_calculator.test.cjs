/* Archery sight adjustment: replay the catalog fixtures, pin the geometry with
   an independent oracle, and check the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'archery-sight-adjustment-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* archery-sight-core:start */');
const end = html.indexOf('/* archery-sight-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const coreText = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreText + '\nmodule.exports = SightCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
assert.equal(catalog.tools.length, 2253, 'catalog total');
const entry = matches[0];
assert.equal(entry.name, 'Archery Sight Adjustment Calculator');
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1000, 'method must document the geometry and limits');
assert.ok(entry.sources.length >= 3);
assert.equal(entry.testCases.length, 23, 'catalog case count');
assert.equal(entry.testCases.filter((t) => t.kind === 'golden').length, 8);
assert.equal(entry.testCases.filter((t) => t.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((t) => t.kind === 'validation').length, 9);

function attempt(run) {
  try { return run(); } catch (error) { return error.message; }
}

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.ok(testCase.expectedError, testCase.name + ' needs an expectedError');
    assert.equal(attempt(() => C.analyse(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[field], expected, testCase.name + ' ' + field);
  }
}

// Literal anchors, computed by hand from d = radius x error / distance.
const anchors = [
  [{ sightRadius: '700', distance: '25', vertical: '3.5', horizontal: '0' }, 0.98, 0.98],
  [{ sightRadius: '600', distance: '18', vertical: '1', horizontal: '0' }, 0.3333, '0.33 mm'],
  [{ sightRadius: '900', distance: '70', vertical: '25', horizontal: '0' }, 3.2143, '3.21 mm'],
  [{ sightRadius: '1200', distance: '90', vertical: '40', horizontal: '0' }, 5.3333, '5.33 mm'],
  [{ sightRadius: '500', distance: '40', vertical: '12', horizontal: '0' }, 1.5, '1.50 mm'],
  [{ sightRadius: '1000', distance: '50', vertical: '5', horizontal: '0' }, 1, '1.00 mm'],
  [{ sightRadius: '762', distance: '18', vertical: '9', horizontal: '0' }, 3.81, '3.81 mm'],
  [{ sightRadius: '650', distance: '100', vertical: '8', horizontal: '0' }, 0.52, '0.52 mm'],
];
for (const [input, expected, text] of anchors) {
  const result = C.analyse(Object.assign({ units: 'metric' }, input));
  assert.equal(result.verticalShift, expected, JSON.stringify(input) + ' value');
  if (typeof text === 'string') assert.equal(result.verticalText, text, JSON.stringify(input) + ' text');
  assert.equal(result.verticalDirection, 'up');
}

// Independently recompute a grid of corrections in millimetres and inches.
let checked = 0;
const METRIC_RADII = ['50', '300', '500', '650', '762', '900', '1000', '1500'];
const METRIC_DISTANCES = ['3', '10', '18', '25', '30', '50', '70', '100'];
const METRIC_ERRORS = ['-200', '-50', '-7.5', '-1', '0', '1', '7.5', '50', '200'];
const round4 = (value) => Math.round(value * 10000) / 10000;
for (const radius of METRIC_RADII) {
  for (const distance of METRIC_DISTANCES) {
    for (const error of METRIC_ERRORS) {
      const result = C.analyse({
        units: 'metric', sightRadius: radius, distance, vertical: error, horizontal: error,
      });
      const expected = round4((Number(radius) * Number(error) * 10) / (Number(distance) * 1000));
      assert.equal(result.verticalShift, expected, `metric ${radius}/${distance}/${error} vertical`);
      assert.equal(result.horizontalShift, expected, `metric ${radius}/${distance}/${error} horizontal`);
      assert.equal(result.verticalDirection, expected === 0 ? 'none' : expected > 0 ? 'up' : 'down');
      assert.equal(result.horizontalDirection, expected === 0 ? 'none' : expected > 0 ? 'right' : 'left');
      checked += 1;
    }
  }
}
const IMPERIAL_RADII = ['2', '12', '25', '30', '45', '60'];
const IMPERIAL_DISTANCES = ['3', '10', '20', '30', '50', '110'];
const IMPERIAL_ERRORS = ['-80', '-40', '-1.5', '0', '1.5', '40', '80'];
for (const radius of IMPERIAL_RADII) {
  for (const distance of IMPERIAL_DISTANCES) {
    for (const error of IMPERIAL_ERRORS) {
      const result = C.analyse({
        units: 'imperial', sightRadius: radius, distance, vertical: error, horizontal: '0',
      });
      const expected = round4((Number(radius) * Number(error)) / (Number(distance) * 36));
      assert.equal(result.verticalShift, expected, `imperial ${radius}/${distance}/${error} vertical`);
      assert.equal(result.horizontalText, '0.000 in');
      checked += 1;
    }
  }
}

// The ratio, the click conversion and the 4 mm warning threshold.
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0' }).ratioText, '1 : 39.4');
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0', clickValue: '0.1' }).verticalClicksText, '0.0 clicks');
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '5', clickValue: '0.25' }).verticalClicksText, '5.1 clicks');
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0.001', clickValue: '0.1' }).verticalClicksText, '< 0.1 clicks');
assert.equal(C.analyse({ units: 'imperial', sightRadius: '30', distance: '30', vertical: '2' }).verticalClicksText, null);
assert.equal(C.analyse({ units: 'imperial', sightRadius: '30', distance: '30', vertical: '2', clickValue: '0.05' }).verticalClicksText, '1.1 clicks');
assert.equal(C.analyse({ units: 'imperial', sightRadius: '30', distance: '30', vertical: '2', clickValue: '0.05' }).clickText, '0.050 in per click');

const warningText = (input) => C.analyse(input).warnings.join(' ');
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0', horizontal: '0' }).warnings.length, 1);
assert.match(warningText({ units: 'metric', sightRadius: '762', distance: '30', vertical: '15.8', horizontal: '0' }), /vertical correction above 4 mm/);
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '15.7', horizontal: '0' }).warnings.length, 0);
assert.match(warningText({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0', horizontal: '15.8' }), /horizontal correction above 4 mm/);
assert.match(warningText({ units: 'imperial', sightRadius: '60', distance: '3', vertical: '2', horizontal: '0' }), /vertical correction above 4 mm/);

// Defaults, tolerance of a leading plus sign, and a signed zero.
assert.equal(C.analyse({}).units, 'metric');
assert.equal(C.analyse({}).verticalText, '0.00 mm');
assert.equal(C.analyse({ units: 'metric', sightRadius: '+762', distance: '30', vertical: '+5' }).verticalShift, 1.27);
assert.equal(C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '-0' }).verticalDirection, 'none');
assert.equal(attempt(() => C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '' })), 'Vertical error is required.');
assert.equal(attempt(() => C.analyse({ units: 'imperial', sightRadius: '30', distance: '  ', vertical: '0' })), 'Target distance is required.');
assert.equal(attempt(() => C.analyse({ units: 'metric', sightRadius: '762', distance: '101', vertical: '0' })), 'Target distance must be a number from 3 to 100 m.');
assert.equal(attempt(() => C.analyse({ units: 'metric', sightRadius: '762', distance: '30', vertical: '0', clickValue: '6' })), 'Click value must be a number from 0.01 to 5 mm.');
assert.equal(C.systems.metric.radiusMax, 1500);
assert.equal(C.systems.imperial.distanceMax, 110);
assert.equal(C.mmPerInch, 25.4);

// Page contract: shared shell, accessible controls, no foreign or unsafe APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|navigator\.sendBeacon/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
for (const id of ['units', 'sight-radius', 'distance', 'vertical', 'horizontal', 'click']) {
  assert.ok(html.includes(`for="${id}"`), 'label missing for ' + id);
}
assert.ok(html.includes('<form id="sight-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('id="reset"'), 'reset missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('role="status" aria-live="polite"'), 'result announcement missing');
assert.ok(html.includes('min-height:44px'), 'tap targets');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
assert.ok(html.includes('<option value="metric" selected>'), 'default unit system');
assert.ok(html.includes('id="u-radius"') && html.includes('id="u-click"'), 'unit captions missing');
const ids = new Set([...html.matchAll(/id="([a-z0-9-]+)"/g)].map((match) => match[1]));
for (const match of html.matchAll(/getElementById\("([a-z0-9-]+)"\)/g)) assert.ok(ids.has(match[1]), 'script references missing id ' + match[1]);

console.log(`archery-sight-adjustment-calculator: 23 catalog cases, ${checked} oracle comparisons, geometry and page contract passed`);
