/* Regression checks for the antenna downtilt coverage core, its catalog cases
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'antenna-downtilt-coverage-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* antenna-downtilt-coverage-core:start */');
const end = html.indexOf('/* antenna-downtilt-coverage-core:end */');
assert.ok(start > -1 && end > start, 'downtilt core markers missing');
const core = html.slice(start, end + '/* antenna-downtilt-coverage-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DowntiltCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEG = Math.PI / 180;
const perMetre = (unit) => (unit === 'ft' ? 3.280839895013123 : 1);
const ground = (h, angle) => h / Math.tan(angle * DEG);

function run(input) {
  return C.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { unit: 'm', height: '20', tilt: '6', vbeam: '10', hbeam: '65' };

// Documented surface.
assert.deepEqual(Object.keys(C.UNITS).sort(), ['ft', 'm']);
assert.equal(C.UNITS.m.name, 'metres');
assert.equal(C.UNITS.ft.short, 'ft');
assert.equal(C.LIMITS.m.heightMin, 1);
assert.equal(C.LIMITS.m.heightMax, 300);
assert.equal(C.LIMITS.ft.heightMax, 984);
assert.equal(C.ANGLES.tiltMin, 1);
assert.equal(C.ANGLES.tiltMax, 45);
assert.equal(C.ANGLES.verticalMin, 2);
assert.equal(C.ANGLES.horizontalMax, 120);
assert.match(C.MESSAGES.upperAboveHorizon, /horizon/);

// Golden: a 20 m site aimed 6 degrees down with a 10 degree beam.
const sized = run(base);
assert.equal(sized.unit, 'm');
assert.equal(sized.upperAngle, 1);
assert.equal(sized.lowerAngle, 11);
closeTo(sized.centreDistance, ground(20, 6), 'centre distance');
closeTo(sized.nearEdge, ground(20, 11), 'near edge');
closeTo(sized.farEdge, ground(20, 1), 'far edge');
closeTo(sized.footprintLength, ground(20, 1) - ground(20, 11), 'footprint');
closeTo(sized.slantRange, 20 / Math.sin(6 * DEG), 'slant range');
closeTo(sized.pathWidth, 2 * ground(20, 6) * Math.tan(32.5 * DEG), 'path width');
closeTo(sized.horizonKm, 4.12 * Math.sqrt(20), 'radio horizon');
assert.equal(sized.upperAboveHorizon, false);
assert.equal(sized.beyondHorizon, false);

// A beam whose upper half-power edge points at the horizon has no far edge.
const horizonEdge = run(Object.assign({}, base, { tilt: '10', vbeam: '20' }));
assert.equal(horizonEdge.upperAngle, 0);
assert.equal(horizonEdge.farEdge, null);
assert.equal(horizonEdge.footprintLength, null);
assert.equal(horizonEdge.upperAboveHorizon, true);

// Feet are the same geometry at the exact 0.3048 conversion.
const feet = run({ unit: 'ft', height: '100', tilt: '5', vbeam: '8', hbeam: '65' });
const hMetres = 100 * 0.3048;
closeTo(feet.centreDistance, ground(hMetres, 5) * perMetre('ft'), 'feet centre');
closeTo(feet.nearEdge, ground(hMetres, 9) * perMetre('ft'), 'feet near edge');
closeTo(feet.farEdge, ground(hMetres, 1) * perMetre('ft'), 'feet far edge');
closeTo(feet.horizonKm, 4.12 * Math.sqrt(hMetres), 'feet horizon');

// Boundaries.
const smallest = run({ unit: 'm', height: '1', tilt: '45', vbeam: '2', hbeam: '10' });
closeTo(smallest.centreDistance, 1, 'smallest centre');
closeTo(smallest.nearEdge, ground(1, 46), 'smallest near');
closeTo(smallest.farEdge, ground(1, 44), 'smallest far');
const largest = run({ unit: 'm', height: '300', tilt: '45', vbeam: '60', hbeam: '120' });
closeTo(largest.centreDistance, 300, 'largest centre');
closeTo(largest.nearEdge, ground(300, 75), 'largest near');
closeTo(largest.farEdge, ground(300, 15), 'largest far');
assert.equal(largest.upperAboveHorizon, false);

// Decimal commas are accepted like the rest of the catalog.
const comma = run({ unit: 'm', height: '18,5', tilt: '4,5', vbeam: '8,5', hbeam: '60,5' });
closeTo(comma.centreDistance, ground(18.5, 4.5), 'comma centre');
closeTo(comma.pathWidth, 2 * ground(18.5, 4.5) * Math.tan(30.25 * DEG), 'comma width');

// Validation refusals.
assert.equal(failure(Object.assign({}, base, { height: '' })), 'Enter the antenna height in metres.');
assert.equal(failure(Object.assign({}, base, { tilt: '   ' })), 'Enter the downtilt.');
assert.equal(failure(Object.assign({}, base, { height: 'high' })), 'Antenna height must be a number in metres.');
assert.equal(failure(Object.assign({}, base, { tilt: '1e1' })), 'Downtilt must be a number.');
assert.equal(failure(Object.assign({}, base, { height: '-5' })), 'Antenna height must be a number in metres.');
assert.equal(failure(Object.assign({}, base, { height: '0.5' })), 'Antenna height must be between 1 and 300 metres.');
assert.equal(failure(Object.assign({}, base, { height: '301' })), 'Antenna height must be between 1 and 300 metres.');
assert.equal(failure({ unit: 'ft', height: '3', tilt: '6', vbeam: '10', hbeam: '65' }),
  'Antenna height must be between 3.3 and 984 feet.');
assert.equal(failure(Object.assign({}, base, { tilt: '0' })), 'Downtilt must be between 1 and 45 degrees.');
assert.equal(failure(Object.assign({}, base, { tilt: '46' })), 'Downtilt must be between 1 and 45 degrees.');
assert.equal(failure(Object.assign({}, base, { vbeam: '1' })), 'Vertical beamwidth must be between 2 and 60 degrees.');
assert.equal(failure(Object.assign({}, base, { vbeam: '61' })), 'Vertical beamwidth must be between 2 and 60 degrees.');
assert.equal(failure(Object.assign({}, base, { hbeam: '9' })), 'Horizontal beamwidth must be between 10 and 120 degrees.');
assert.equal(failure(Object.assign({}, base, { hbeam: '121' })), 'Horizontal beamwidth must be between 10 and 120 degrees.');

// Invariants over a grid of heights and angles, in both unit systems.
const heights = { m: [1, 5, 20, 300], ft: [3.3, 16, 66, 984] };
const tilts = [1, 6, 20, 45];
const vbeams = [2, 10, 60];
const hbeams = [10, 65, 120];
let checked = 0;
for (const unit of ['m', 'ft']) {
  for (const h of heights[unit]) {
    for (const tilt of tilts) {
      for (const vbeam of vbeams) {
        for (const hbeam of hbeams) {
          const result = run({
            unit, height: String(h), tilt: String(tilt), vbeam: String(vbeam), hbeam: String(hbeam)
          });
          const hm = h / perMetre(unit);
          const centre = ground(hm, tilt);
          const near = ground(hm, tilt + vbeam / 2);
          const upper = tilt - vbeam / 2;
          closeTo(result.centreDistance, centre * perMetre(unit), 'grid centre');
          closeTo(result.nearEdge, near * perMetre(unit), 'grid near');
          closeTo(result.slantRange, (hm / Math.sin(tilt * DEG)) * perMetre(unit), 'grid slant');
          closeTo(result.pathWidth,
            2 * centre * Math.tan((hbeam / 2) * DEG) * perMetre(unit), 'grid width');
          closeTo(result.upperAngle, upper, 'grid upper angle');
          closeTo(result.lowerAngle, tilt + vbeam / 2, 'grid lower angle');
          closeTo(result.horizonKm, 4.12 * Math.sqrt(hm), 'grid horizon');
          if (upper <= 0) {
            assert.equal(result.farEdge, null, 'far edge must be absent');
            assert.equal(result.footprintLength, null, 'footprint must be absent');
            assert.equal(result.upperAboveHorizon, true, 'upper edge flag');
          } else {
            const far = ground(hm, upper);
            closeTo(result.farEdge, far * perMetre(unit), 'grid far');
            closeTo(result.footprintLength, (far - near) * perMetre(unit), 'grid footprint');
            assert.ok(result.nearEdge < result.centreDistance && result.centreDistance < result.farEdge,
              'edges must bracket the centre');
            assert.ok(result.footprintLength > 0, 'footprint must be positive');
            assert.equal(result.upperAboveHorizon, false, 'upper edge flag');
            assert.equal(result.beyondHorizon, far > 4.12 * Math.sqrt(hm) * 1000, 'horizon flag');
          }
          assert.equal(result.allBeyondHorizon, near > 4.12 * Math.sqrt(hm) * 1000, 'all-beyond flag');
          checked += 1;
        }
      }
    }
  }
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Communications Engineering');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 8, 'expected at least eight catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      if (value === null) {
        assert.equal(result[key], null, testCase.name + ' ' + key);
      } else if (typeof value === 'boolean') {
        assert.equal(result[key], value, testCase.name + ' ' + key);
      } else {
        closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
      }
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="downtilt-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');

console.log('antenna downtilt coverage calculator: ' + entry.testCases.length
  + ' catalog cases, ' + checked + ' grid rows and invariants passed');
