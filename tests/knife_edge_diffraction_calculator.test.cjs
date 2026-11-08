/* Regression checks for the knife-edge diffraction core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'knife-edge-diffraction-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* knife-edge-core:start */');
const end = html.indexOf('/* knife-edge-core:end */');
assert.ok(start > -1 && end > start, 'knife-edge core markers missing');
const core = html.slice(start, end + '/* knife-edge-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = KnifeEdgeCore;', sandbox);
const K = sandbox.module.exports;

const closeTo = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9,
  label + ': ' + actual + ' vs ' + expected);

function run(input) {
  return K.analyze(input);
}

function failure(input) {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
}

const base = { frequency: '2400', d1: '10', d2: '10', obstruction: '20' };

// Documented surface.
assert.equal(K.C, 299792458);
// Arrays come from another vm realm, so compare their members.
assert.equal(K.LIMITS.frequency.length, 2);
assert.equal(K.LIMITS.frequency[0], 1);
assert.equal(K.LIMITS.frequency[1], 100000);
assert.equal(K.LIMITS.distance[0], 0.01);
assert.equal(K.LIMITS.distance[1], 500);
assert.equal(K.LIMITS.obstruction[0], -1000);
assert.equal(K.LIMITS.obstruction[1], 1000);
assert.match(K.MESSAGES.clear, /clears the path/);
assert.match(K.MESSAGES.blocked, /crosses the path/);

// Golden: 2.4 GHz over two 10 km legs with the edge 20 m above the line.
const blocked = run(base);
assert.equal(blocked.distance, 20);
closeTo(blocked.wavelength, 0.12491352416666666, 'wavelength');
closeTo(blocked.v, 1.1317623980151064, 'v');
closeTo(blocked.fresnelRadius, 24.991350920535155, 'fresnel radius');
closeTo(blocked.clearance, -0.8002768663284301, 'clearance');
closeTo(blocked.loss, 14.74905287987054, 'diffraction loss');
closeTo(blocked.freeSpace, 126.07260796939512, 'free space loss');
closeTo(blocked.totalLoss, 140.82166084926567, 'total loss');
assert.equal(blocked.blocked, true);

// Golden: grazing incidence is close to the classic 6 dB.
const grazing = run(Object.assign({}, base, { frequency: '900', d1: '5', d2: '15', obstruction: '0' }));
assert.equal(grazing.v, 0);
closeTo(grazing.loss, 6.032852208563606, 'grazing loss');
assert.ok(grazing.loss > 6 && grazing.loss < 6.1, 'grazing loss near 6 dB');

// Golden: an edge well below the line adds nothing at all.
const clear = run(Object.assign({}, base, { frequency: '5800', d1: '2', d2: '8', obstruction: '-50' }));
closeTo(clear.loss, 0, 'clear loss');
closeTo(clear.clearance, 5.4981129605831605, 'clear clearance');
closeTo(clear.totalLoss, clear.freeSpace, 'total equals free space when clear');
assert.equal(clear.blocked, false);

// The clearance is the parameter normalised by root two, in both directions.
for (const h of [-800, -75.5, -3, 0, 0.25, 11, 240, 1000]) {
  const result = run(Object.assign({}, base, { obstruction: String(h) }));
  closeTo(result.clearance, -result.v / Math.SQRT2, 'clearance from v at ' + h + ' m');
  closeTo(result.clearance * result.fresnelRadius, -h, 'clearance times radius at ' + h + ' m');
}

// The zero-loss clamp starts at v = -0.78 and never yields a negative loss.
assert.equal(run(Object.assign({}, base, { obstruction: '-14' })).loss, 0);
assert.ok(run(Object.assign({}, base, { obstruction: '-13' })).loss > 0);
assert.ok(run(Object.assign({}, base, { obstruction: '-13' })).loss < 0.3);
for (let h = -1000; h <= 1000; h += 0.5) {
  assert.ok(run(Object.assign({}, base, { obstruction: String(h) })).loss >= 0, 'loss must not go negative at ' + h);
}

// Loss grows with obstruction height and with frequency for a fixed geometry.
let previous = -1;
for (const h of [-5, 0, 5, 10, 20, 40, 80, 160]) {
  const loss = run(Object.assign({}, base, { obstruction: String(h) })).loss;
  assert.ok(loss >= previous, 'loss must not fall as the edge rises');
  previous = loss;
}
const lowBand = run(Object.assign({}, base, { frequency: '900' })).loss;
const highBand = run(Object.assign({}, base, { frequency: '2400' })).loss;
assert.ok(highBand > lowBand, 'the same edge blocks more at a higher frequency');
const shortLeg = run(Object.assign({}, base, { d1: '1', d2: '1' })).loss;
assert.ok(shortLeg > blocked.loss, 'the same edge blocks more on a shorter path');

// Boundaries: both ends of every accepted range compute.
assert.equal(run(Object.assign({}, base, { obstruction: '-1000' })).loss, 0);
const longest = run({ frequency: '1', d1: '500', d2: '500', obstruction: '-1000' });
closeTo(longest.v, -0.1633558312881795, 'long path v');
closeTo(longest.loss, 4.638169446538274, 'long path loss');
closeTo(longest.freeSpace, 92.44778322188337, 'long path free space');
assert.equal(run(Object.assign({}, base, { frequency: '100000', d1: '0.01', d2: '500', obstruction: '1' })).distance, 500.01);
closeTo(run(Object.assign({}, base, { d1: '0.01', d2: '0.01' })).fresnelRadius, 0.7902959071343678, 'shortest legs radius');

// Validation refusals, in the order the page reports them.
assert.equal(failure(Object.assign({}, base, { frequency: '' })), 'Enter the frequency in MHz.');
assert.equal(failure(Object.assign({}, base, { d1: '   ' })), 'Enter the distance to the edge in km.');
assert.equal(failure(Object.assign({}, base, { d1: 'far' })), 'Distance to the edge must be a number in km.');
assert.equal(failure(Object.assign({}, base, { d2: '1e3' })), 'Distance past the edge must be a number in km.');
assert.equal(failure(Object.assign({}, base, { obstruction: '' })), 'Enter the edge height above the line in m.');
assert.equal(failure(Object.assign({}, base, { frequency: '0' })), 'Frequency must be between 1 and 100000 MHz.');
assert.equal(failure(Object.assign({}, base, { frequency: '200000' })), 'Frequency must be between 1 and 100000 MHz.');
assert.equal(failure(Object.assign({}, base, { d1: '0' })), 'Distance to the edge must be between 0.01 and 500 km.');
assert.equal(failure(Object.assign({}, base, { d2: '501' })), 'Distance past the edge must be between 0.01 and 500 km.');
assert.equal(failure(Object.assign({}, base, { obstruction: '1200' })), 'Edge height above the line must be between -1000 and 1000 m.');
assert.equal(failure(Object.assign({}, base, { obstruction: '-1500' })), 'Edge height above the line must be between -1000 and 1000 m.');

// Decimal commas are accepted like the rest of the catalog.
closeTo(run(Object.assign({}, base, { frequency: '2400,5' })).frequency, 2400.5, 'decimal comma frequency');
closeTo(run(Object.assign({}, base, { obstruction: '-12,5' })).obstruction, -12.5, 'decimal comma height');

// Round trip: the reported clearance recovers the entered height.
for (let h = -60; h <= 60; h += 3) {
  const result = run(Object.assign({}, base, { obstruction: String(h) }));
  closeTo(result.clearance, -h / result.fresnelRadius, 'clearance round trip at ' + h);
}

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Communications Engineering');
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
assert.ok(html.includes('<form id="edge-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('aria-describedby="edge-help"'), 'edge field must reference its help text');

console.log('knife-edge diffraction calculator: ' + entry.testCases.length + ' catalog cases and invariants passed');
