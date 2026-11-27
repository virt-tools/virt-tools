/* Worm gear calculator: the published geometry and efficiency formulas, the
   self-locking rule, a deterministic sweep of invariants, the refusals, the
   catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'worm-gear-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* worm-gear-core:start */';
const endMarker = '/* worm-gear-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = WormGearCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { module: 2, starts: 2, teeth: 30, wormDiameter: 20, speed: 1450, friction: 0.05, pressureAngle: 20 };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

// ---- The worked example from the published formulas, step by step.
const reducer = run();
assert.equal(reducer.ratio, 15);
assert.equal(reducer.q, 10);
assert.equal(reducer.wheelPitchDiameter, 60);
assert.equal(reducer.centreDistance, 40);
assert.equal(reducer.lead, 12.566);
assert.equal(reducer.leadAngle, 11.31);
assert.equal(reducer.wheelSpeed, 96.667);
assert.equal(reducer.slidingVelocity, 1.549);
assert.equal(reducer.efficiency, 78.15);
assert.equal(reducer.frictionAngle, 2.862);
assert.equal(reducer.selfLocking, false);
assert.equal(reducer.wormTipDiameter, 24);
assert.equal(reducer.wheelTipDiameter, 64);
assert.equal(reducer.headline, '15 : 1');
assert.equal(reducer.warnings.length, 0);

// ---- The efficiency estimate agrees with the equivalent common form
//      tan(gamma)(1 - mu tan(gamma)) / (mu + tan(gamma)) to within 2.5 points.
for (const friction of [0.02, 0.03, 0.05, 0.08, 0.10, 0.15]) {
  for (const starts of [1, 2, 3, 4]) {
    for (const diameter of [12, 20, 35, 60]) {
      const result = run({ friction, starts, wormDiameter: diameter });
      const g = Math.atan(starts * 2 / diameter);
      const alternative = Math.tan(g) * (1 - friction * Math.tan(g)) / (friction + Math.tan(g)) * 100;
      assert.ok(Math.abs(result.efficiency - alternative) < 2.5,
        'efficiency ' + result.efficiency + ' vs ' + alternative.toFixed(2));
    }
  }
}

// ---- Geometry identities and bounds over a deterministic sweep.
let checked = 0;
for (const module of [0.5, 1, 1.5, 2, 3, 5, 8, 12]) {
  for (const starts of [1, 2, 3, 4]) {
    for (const teeth of [8, 20, 30, 45, 60, 100, 200, 400]) {
      for (const friction of [0.02, 0.05, 0.1]) {
        const wormDiameter = module * (5 + (starts * 3));
        const result = run({ module, starts, teeth, wormDiameter, friction, speed: 1200 });
        const gamma = Math.atan(starts * module / wormDiameter) * 180 / Math.PI;
        assert.equal(result.ratio, Math.round((teeth / starts) * 1000) / 1000);
        assert.equal(result.leadAngle, Math.round(gamma * 1000) / 1000);
        assert.equal(result.centreDistance, Math.round(((wormDiameter + module * teeth) / 2) * 1000) / 1000);
        assert.ok(result.efficiency >= 0 && result.efficiency <= 100, 'efficiency is a percentage');
        assert.ok(result.slidingVelocity > 0, 'sliding velocity is positive while the worm turns');
        assert.equal(result.selfLocking, gamma <= Math.atan(friction) * 180 / Math.PI);
        assert.ok(Number.isFinite(result.wheelSpeed) && result.wheelSpeed > 0);
        checked += 1;
      }
    }
  }
}

// ---- More starts raise the lead angle and the efficiency at a fixed diameter.
for (const diameter of [15, 25, 40]) {
  const angles = [1, 2, 3, 4].map((starts) => run({ starts, wormDiameter: diameter }).leadAngle);
  const efficiencies = [1, 2, 3, 4].map((starts) => run({ starts, wormDiameter: diameter }).efficiency);
  for (let i = 1; i < 4; i += 1) {
    assert.ok(angles[i] > angles[i - 1], 'lead angle rises with starts');
    assert.ok(efficiencies[i] > efficiencies[i - 1], 'efficiency rises with the lead angle');
  }
}

// ---- Sliding velocity is zero at rest, and higher friction lowers efficiency.
assert.equal(run({ speed: 0 }).slidingVelocity, 0);
assert.equal(run({ speed: 0 }).wheelSpeed, 0);
assert.ok(run({ friction: 0.02 }).efficiency > run({ friction: 0.15 }).efficiency);

// ---- Numeric strings behave like numbers.
const strings = C.calculate({ module: '2', starts: '2', teeth: '30', wormDiameter: '20', speed: '1450', friction: '0.05', pressureAngle: '20' });
assert.deepEqual(strings, reducer);

// ---- Refusals.
assert.equal(failure({ module: '' }), 'The module must be a number in millimetres.');
assert.equal(failure({ module: '2mm' }), 'The module must be a number in millimetres.');
assert.equal(failure({ starts: 2.5 }), 'The worm must have a whole number of starts.');
assert.equal(failure({ teeth: 401 }), 'The wheel needs between 8 and 400 teeth.');
assert.equal(failure({ wormDiameter: 2001 }), 'The worm pitch diameter must be between 1 and 2000 mm.');
assert.equal(failure({ speed: 60001 }), 'The worm speed must be between 0 and 60000 rpm.');
assert.equal(failure({ friction: 0.6 }), 'The friction coefficient must be between 0.01 and 0.5.');
assert.equal(failure({ pressureAngle: 17.5 }), 'Choose a normal pressure angle of 14.5, 20 or 25 degrees.');
assert.equal(C.PRESSURE_ANGLES.join(','), '14.5,20,25');

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2505, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2244, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 57,
  'Mechanical & Structural Engineering count');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 1);
assert.match(record.sources[0].url, /^https:\/\/roymech\.org\//);
assert.ok(record.tags.length === new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 10 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], expected, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Worm Gear Calculator<\/h1>/);
assert.match(html, /<form id="worm-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 7, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 4);
assert.equal((html.match(/<select/g) || []).length, 3);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* worm-gear-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* worm-gear-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['worm-form', 'module', 'starts', 'teeth', 'wormDiameter', 'speed', 'friction', 'pressureAngle', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('worm gear calculator OK: ' + checked + ' sweep cases, ' + record.testCases.length +
  ' catalog cases, invariants, refusals, uniqueness and page contract OK');
