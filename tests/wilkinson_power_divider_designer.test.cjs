/* Wilkinson power divider: catalog fixtures, arm/resistor geometry, length model and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'wilkinson-power-divider-designer';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* wilkinson-divider-core:start */';
const endMarker = '/* wilkinson-divider-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = WilkinsonDividerCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one Wilkinson divider designer');
const record = records[0];
assert.equal(record.name, 'Wilkinson Power Divider Designer');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the equations and their scope');
assert.match(record.method, /K squared/);
assert.match(record.method, /1\.414/);
assert.match(record.method, /90 degrees/);
assert.equal(record.sources.length, 2, 'two fetched references');
assert.match(record.sources[0].url, /^https:\/\/www\.microwaves101\.com\//, 'Microwaves101 source');
assert.match(record.sources[1].url, /^https:\/\/en\.wikipedia\.org\/wiki\/Wilkinson_power_divider$/, 'Pozar equations source');
assert.equal(record.testCases.length, 19);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 5);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 8);
assert.equal(catalog.tools.length, 2416, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2156, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Communications Engineering').length, 52,
  'Communications Engineering count');
// No other record claims this slug, name, alias or distinctive tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  for (const tag of ['wilkinson', 'power-divider', 'splitter', 'combiner', 'quarter-wave']) {
    assert.ok(!other.tags.includes(tag), tag + ' tag is unique: ' + other.slug);
  }
}

function failure(input) {
  try { C.design(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label) {
  const tol = Math.max(1e-6, Math.abs(expected) * 1e-8);
  assert.ok(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ', got ' + actual);
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.design(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    if (typeof expected === 'boolean') {
      assert.equal(result[key], expected, testCase.name + ': ' + key);
    } else {
      near(result[key], expected, testCase.name + ': ' + key);
    }
  }
}

const base = C.design({});
const z0 = 50, f = 2450, vf = 0.66;
near(base.z02, z0 * Math.SQRT2, 'equal-split port 2 arm is 1.414 Z0');
near(base.z03, z0 * Math.SQRT2, 'equal-split port 3 arm is 1.414 Z0');
near(base.isolation, 2 * z0, 'equal-split resistor is 2 Z0');
near(base.lambdaGmm, vf * 299792458 / (f * 1e6) * 1000, 'guided wavelength is vf times c over f');
near(base.armMm * 4, base.lambdaGmm, 'an arm is a quarter of the guided wavelength');
near(base.s21Db, 10 * Math.log10(0.5), 'half the power is -3.01 dB');
near(base.s31Db, 10 * Math.log10(0.5), 'the second output is -3.01 dB as well');
assert.equal(base.equal, true, 'fifty percent is the equal split');
near(base.z02 * base.z03, z0 * base.isolation, 'the arms multiply to Z0 times the resistor');

// The unequal-split pair keeps the same identity and follows the cited equations.
const twoToOne = C.design({port2Pct: '66.666667'});
const k = Math.sqrt(1 / 2);
near(twoToOne.z02, z0 * Math.sqrt(k * (1 + k * k)), 'port 2 arm from K');
near(twoToOne.z03, z0 * Math.sqrt((1 + k * k) / (k * k * k)), 'port 3 arm from K');
near(twoToOne.isolation, z0 * (k + 1 / k), 'resistor from K');
near(twoToOne.z02 * twoToOne.z03, z0 * twoToOne.isolation, 'identity holds for an unequal split');
assert.equal(twoToOne.equal, false, 'two thirds is not the equal split');
assert.ok(twoToOne.s21Db > base.s21Db, 'the larger share is the higher output level');
assert.ok(twoToOne.s31Db < base.s31Db, 'the smaller share is the lower output level');
near(twoToOne.s21Db - twoToOne.s31Db, 10 * Math.log10(2), 'levels differ by the power ratio in dB');

// Moving the share moves the arms in opposite directions and leaves the length alone.
const moreToPort2 = C.design({port2Pct: '60'});
const lessToPort2 = C.design({port2Pct: '40'});
assert.ok(moreToPort2.z02 < base.z02, 'a larger port 2 share lowers the port 2 arm');
assert.ok(moreToPort2.z03 > base.z03, 'and raises the port 3 arm');
assert.ok(lessToPort2.z02 > base.z02, 'a smaller port 2 share raises the port 2 arm');
assert.ok(lessToPort2.z03 < base.z03, 'and lowers the port 3 arm');
near(moreToPort2.armMm, base.armMm, 'the split does not change the arm length');
assert.ok(moreToPort2.isolation > base.isolation, 'an unequal split raises the resistor above 2 Z0');

// Impedance and velocity factor scale the design without touching the split.
const highZ = C.design({z0: '100'});
near(highZ.z02, 2 * base.z02, 'doubling Z0 doubles the arms');
near(highZ.isolation, 2 * base.isolation, 'doubling Z0 doubles the resistor');
near(highZ.s21Db, base.s21Db, 'Z0 leaves the split levels alone');
const slow = C.design({velocityFactor: '0.33'});
near(slow.armMm, base.armMm / 2, 'halving the velocity factor halves the arm');
near(slow.z02, base.z02, 'the velocity factor leaves the impedances alone');
const higher = C.design({frequencyMHz: '4900'});
near(higher.armMm, base.armMm / 2, 'doubling the frequency halves the arm');

// A random sweep against an independent model over the whole input range.
let seed = 20261119;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
for (let i = 0; i < 400; i += 1) {
  const system = 5 + rnd() * 995;
  const freq = 0.1 * Math.pow(400000, rnd());
  const velocity = 0.3 + rnd() * 0.7;
  const share = 5 + rnd() * 90;
  const r = C.design({z0: system, frequencyMHz: freq, velocityFactor: velocity, port2Pct: share});
  const kk = Math.sqrt((100 - share) / share);
  const arm2 = system * Math.sqrt(kk * (1 + kk * kk));
  const arm3 = system * Math.sqrt((1 + kk * kk) / (kk * kk * kk));
  near(r.z02, arm2, 'sweep port 2 arm');
  near(r.z03, arm3, 'sweep port 3 arm');
  near(r.isolation, system * (kk + 1 / kk), 'sweep resistor');
  near(r.armMm, velocity * 299792458 / (freq * 1e6) * 1000 / 4, 'sweep arm length');
  near(r.s21Db, 10 * Math.log10(share / 100), 'sweep port 2 level');
  near(r.s31Db, 10 * Math.log10((100 - share) / 100), 'sweep port 3 level');
  near(r.z02 * r.z03, system * r.isolation, 'sweep identity');
}

// Refusals name the field and the range.
assert.match(failure({z0: '0'}), /System impedance must be between 5 and 1000 ohms/);
assert.match(failure({z0: '1e3'}), /System impedance must be a number/);
assert.match(failure({frequencyMHz: '0'}), /Design frequency must be between 0.1 and 40000 MHz/);
assert.match(failure({velocityFactor: '0'}), /Velocity factor must be between 0.3 and 1/);
assert.match(failure({port2Pct: '3'}), /Port 2 power share must be between 5 and 95 %/);
assert.match(failure({port2Pct: '98'}), /Port 2 power share must be between 5 and 95 %/);
assert.match(failure({z0: '  '}), /System impedance is required/);

// Page contract: the markup starts at the core defaults and wires every field.
for (const pair of [
  ['z0', '50'], ['freq', '2450'], ['vf', '0.66'], ['split', '50']
]) {
  assert.match(html, new RegExp('id="' + pair[0] + '"[^>]*value="' + pair[1].replace('.', '\\.') + '"'),
    'default markup for ' + pair[0]);
}
const ids = new Set(Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), (m) => m[1]));
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'getElementById target exists: ' + id);
}
assert.ok(ids.has('design-rows'), 'result rows are wired');
assert.ok(ids.has('status'), 'status line is wired');
assert.ok(!/<h2[^>]*>Sources<\/h2>/i.test(html), 'sources are rendered by app.js, not the page');
assert.ok(!/https?:\/\/(?!virt\.tools)/.test(html), 'the page references no external URL');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage/.test(html), 'the page makes no network or storage call');
