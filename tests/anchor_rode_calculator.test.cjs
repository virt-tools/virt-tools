/* Regression checks for the anchor rode core, its catalog cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'anchor-rode-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* anchor-rode-core:start */');
const end = html.indexOf('/* anchor-rode-core:end */');
assert.ok(start > -1 && end > start, 'anchor rode core markers missing');
const core = html.slice(start, end + '/* anchor-rode-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AnchorRodeCore;', sandbox);
const R = sandbox.module.exports;

const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

function run(input) {
  return R.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { depth: '8', bowHeight: '1.5', scope: '5' };

// Documented surface.
assert.equal(R.LIMITS.depth.length, 2);
assert.equal(R.LIMITS.depth[0], 0.5);
assert.equal(R.LIMITS.depth[1], 100);
assert.equal(R.LIMITS.bowHeight[0], 0);
assert.equal(R.LIMITS.bowHeight[1], 10);
assert.equal(R.LIMITS.scope[0], 1.5);
assert.equal(R.LIMITS.scope[1], 20);
assert.match(R.MESSAGES.plan, /Room the boat/);

// Golden: 8 m of water under a 1.5 m bow roller at 5:1.
const typical = run(base);
assert.equal(typical.vertical, 9.5);
closeTo(typical.rode, 47.5, 'rode');
closeTo(typical.horizontal, 46.54030511288038, 'swing radius');
closeTo(typical.diameter, 93.08061022576076, 'swing diameter');
closeTo(typical.angle, 11.536959032815489, 'angle');
assert.equal(typical.perMetre, 5);

// Golden: deeper water at 7:1.
const deep = run({ depth: '20', bowHeight: '2', scope: '7' });
closeTo(deep.vertical, 22, 'deep vertical');
closeTo(deep.rode, 154, 'deep rode');
closeTo(deep.horizontal, 152.4204710660612, 'deep radius');
closeTo(deep.angle, 8.213210701738188, 'deep angle');

// Golden: shallow water at 10:1.
const shallow = run({ depth: '2', bowHeight: '0.5', scope: '10' });
closeTo(shallow.vertical, 2.5, 'shallow vertical');
closeTo(shallow.rode, 25, 'shallow rode');
closeTo(shallow.horizontal, 24.8746859276655, 'shallow radius');
closeTo(shallow.angle, 5.739170477266787, 'shallow angle');

// The drop is depth plus bow height and the rode is scope times the drop.
for (const [depth, bow] of [[0.5, 0], [3, 0.75], [12, 4], [100, 10]]) {
  for (const scope of [1.5, 3, 5, 7.25, 20]) {
    const result = run({ depth: String(depth), bowHeight: String(bow), scope: String(scope) });
    closeTo(result.vertical, depth + bow, 'vertical at ' + depth + '/' + bow);
    closeTo(result.rode, scope * (depth + bow), 'rode at ' + depth + '/' + bow + '/' + scope);
    closeTo(result.horizontal, result.vertical * Math.sqrt(scope * scope - 1),
      'radius identity at ' + scope);
    closeTo(result.horizontal, Math.sqrt(result.rode * result.rode - result.vertical * result.vertical),
      'radius from the rope triangle at ' + scope);
    closeTo(result.diameter, 2 * result.horizontal, 'diameter at ' + scope);
    closeTo(result.angle, Math.asin(result.vertical / result.rode) * 180 / Math.PI,
      'angle identity at ' + scope);
    closeTo(result.angle, Math.atan2(result.vertical, result.horizontal) * 180 / Math.PI,
      'angle from the horizontal leg at ' + scope);
    closeTo(result.perMetre, scope, 'tidal sensitivity at ' + scope);
    assert.ok(result.rode > result.vertical, 'the rode always exceeds the drop at ' + scope);
    assert.ok(result.angle > 0 && result.angle < 90, 'angle stays acute at ' + scope);
  }
}

// More depth, a higher bow roller or a wider scope all ask for more rode.
let previous = 0;
for (const depth of [1, 2.5, 6, 15, 40, 100]) {
  const rode = run(Object.assign({}, base, { depth: String(depth) })).rode;
  assert.ok(rode > previous, 'rode must grow with depth at ' + depth);
  previous = rode;
}
assert.ok(run(Object.assign({}, base, { bowHeight: '2.5' })).rode > typical.rode, 'rode grows with bow height');
assert.ok(run(Object.assign({}, base, { scope: '8' })).rode > typical.rode, 'rode grows with scope');

// A wider scope flattens the rode and widens the swing circle.
previous = 0;
let lastAngle = 90;
for (const scope of [1.5, 2, 4, 5, 8, 12, 20]) {
  const result = run(Object.assign({}, base, { scope: String(scope) }));
  assert.ok(result.horizontal > previous, 'radius must grow with scope at ' + scope);
  assert.ok(result.angle < lastAngle, 'angle must fall as scope widens at ' + scope);
  previous = result.horizontal;
  lastAngle = result.angle;
}

// Boundaries: both ends of every accepted range compute.
closeTo(run({ depth: '0.5', bowHeight: '0', scope: '20' }).rode, 10, 'minimum rode');
closeTo(run({ depth: '100', bowHeight: '10', scope: '1.5' }).vertical, 110, 'maximum vertical');
closeTo(run({ depth: '100', bowHeight: '10', scope: '1.5' }).horizontal,
  122.98373876248843, 'maximum radius');
assert.equal(run({ depth: '0.5', bowHeight: '0', scope: '1.5' }).bowHeight, 0);

// Validation refusals, in the order the page reports them.
assert.equal(failure(Object.assign({}, base, { depth: '' })), 'Enter the water depth in m.');
assert.equal(failure(Object.assign({}, base, { depth: 'deep' })), 'Water depth must be a number in m.');
assert.equal(failure(Object.assign({}, base, { depth: '1e3' })), 'Water depth must be a number in m.');
assert.equal(failure(Object.assign({}, base, { depth: '0' })), 'Water depth must be between 0.5 and 100 m.');
assert.equal(failure(Object.assign({}, base, { depth: '101' })), 'Water depth must be between 0.5 and 100 m.');
assert.equal(failure(Object.assign({}, base, { bowHeight: '' })), 'Enter the bow roller height in m.');
assert.equal(failure(Object.assign({}, base, { bowHeight: '-1' })), 'Bow roller height must be between 0 and 10 m.');
assert.equal(failure(Object.assign({}, base, { bowHeight: '11' })), 'Bow roller height must be between 0 and 10 m.');
assert.equal(failure(Object.assign({}, base, { scope: '' })), 'Enter the scope.');
assert.equal(failure(Object.assign({}, base, { scope: 'wide' })), 'Scope must be a number.');
assert.equal(failure(Object.assign({}, base, { scope: '1' })), 'Scope must be between 1.5 and 20.');
assert.equal(failure(Object.assign({}, base, { scope: '25' })), 'Scope must be between 1.5 and 20.');
// Depth is checked first, then the bow roller, then the scope.
assert.equal(failure({ depth: '', bowHeight: '', scope: '' }), 'Enter the water depth in m.');

// Decimal commas are accepted like the rest of the catalog.
closeTo(run({ depth: '8,5', bowHeight: '1,5', scope: '5,5' }).vertical, 10, 'decimal comma vertical');
closeTo(run({ depth: '8,5', bowHeight: '1,5', scope: '5,5' }).scope, 5.5, 'decimal comma scope');

// Round trip: the reported radius recovers the scope.
for (const scope of [1.5, 2.5, 4, 6.5, 9, 14, 20]) {
  const result = run(Object.assign({}, base, { scope: String(scope) }));
  closeTo(result.horizontal / result.vertical, Math.sqrt(scope * scope - 1), 'scope round trip at ' + scope);
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Sports & Outdoors');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 10, 'expected at least ten catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = run(testCase.input);
    for (const [key, value] of Object.entries(testCase.expected)) {
      closeTo(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page must not build raw HTML');
assert.ok(html.includes('<form id="rode-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('aria-describedby="scope-help"'), 'scope field must reference its help text');
assert.ok(html.includes('id="reset"'), 'reset control missing');

console.log('anchor rode calculator: ' + entry.testCases.length + ' catalog cases and invariants passed');
