/* lead screw: catalog fixtures, thread-incline identities and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'leadscrew-torque-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* leadscrew-torque-core:start */';
const endMarker = '/* leadscrew-torque-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = LeadscrewTorqueCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one lead screw calculator');
const record = records[0];
assert.equal(record.name, 'Lead Screw Torque Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1500, 'method documents the thread incline, the ranges and the scope');
assert.match(record.method, /49\.79 N m/, 'method carries the worked default');
assert.match(record.method, /mu sec\(alpha\) >= tan\(lambda\)/, 'method states the self-locking test');
assert.equal(record.sources.length, 3);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\/en\.wikipedia\.org\/wiki\//, 'fetched source');
  assert.ok(source.title.length > 90, 'source titles say what the page supplies');
}
assert.ok(catalog.tools.filter((tool) => tool.listed).length >= 2112, 'public tools');
assert.ok(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length >= 50,
  'Mechanical & Structural Engineering count');
// No other record claims this slug, name or alias.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
}

function failure(input) {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
}
function near(actual, expected, label) {
  const tol = Math.max(1e-9, Math.abs(expected) * 1e-9);
  assert.ok(Math.abs(actual - expected) <= tol,
    label + ': expected ' + expected + ', got ' + actual);
}

// Every catalog case replays against the page core.
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const key of Object.keys(testCase.expected)) {
    const expected = testCase.expected[key];
    if (typeof expected === 'boolean') {
      assert.equal(result[key], expected, testCase.name + ': ' + key);
    } else {
      const tol = Math.max(1e-6, Math.abs(expected) * 1e-8);
      assert.ok(Math.abs(result[key] - expected) <= tol,
        testCase.name + ': ' + key + ' expected ' + expected + ', got ' + result[key]);
    }
  }
}

const base = C.analyse({});
// The lead, the mean diameter and the lead angle follow the thread geometry alone.
near(base.leadMm, base.starts * base.pitchMm, 'lead is starts times pitch');
near(base.meanDiameterMm, 30 - 0.649519 * 3.5, 'metric pitch diameter');
near(base.leadAngleDeg, Math.atan(base.leadMm / (Math.PI * base.meanDiameterMm)) * 180 / Math.PI, 'lead angle');
near(C.analyse({form: 'acme', pitchMm: 5, diameterMm: 25}).meanDiameterMm, 22.5, 'Acme mean diameter');
near(C.analyse({form: 'square', pitchMm: 6, diameterMm: 40}).meanDiameterMm, 37, 'square mean diameter');
// The raising torque is the thread term plus the collar term, and the collar is linear in its diameter and friction.
near(base.raiseTorqueNm, base.threadTorqueNm + base.collarTorqueNm, 'raising torque split');
near(base.collarTorqueNm, base.loadKn * 1000 * base.collarFriction * base.collarDiameterMm / 2 / 1000, 'collar torque');
near(C.analyse({collarDiameterMm: 80}).collarTorqueNm, base.collarTorqueNm * 2, 'collar diameter doubles its loss');
near(C.analyse({collarDiameterMm: 0}).raiseTorqueNm, base.threadTorqueNm, 'no collar leaves the thread alone');
// Independent form: the thread torque is the force triangle F dm/2 tan(lambda + phi'), with tan(phi') = mu sec(alpha).
const lam = base.leadAngleDeg * Math.PI / 180;
const phi = Math.atan(base.friction * (1 / Math.cos(30 * Math.PI / 180)));
near(base.threadTorqueNm, base.loadKn * 1000 * base.meanDiameterMm / 2 * Math.tan(lam + phi) / 1000,
  'thread raising torque from the friction angle');
near(base.threadEfficiencyPct, 100 * Math.tan(lam) / Math.tan(lam + phi), 'thread efficiency');
near(base.efficiencyPct, 100 * base.loadKn * 1000 * base.leadMm / (2 * Math.PI * base.raiseTorqueNm * 1000),
  'overall efficiency from work in and out');
near(base.turnsPerMm, 1 / base.leadMm, 'turns per millimetre');
near(base.forcePerTorqueNPerNm, base.loadKn * 1000 / base.raiseTorqueNm, 'load per newton-metre');
// Frictionless square thread, no collar: nothing is lost.
const ideal = C.analyse({form: 'square', friction: 0, collarFriction: 0, collarDiameterMm: 0});
near(ideal.efficiencyPct, 100, 'frictionless efficiency');
near(ideal.raiseTorqueNm, ideal.loadKn * 1000 * ideal.meanDiameterMm / 2 * Math.tan(ideal.leadAngleDeg * Math.PI / 180) / 1000,
  'frictionless torque is F dm/2 tan(lambda)');
// The self-locking flag follows the sign of the thread's lowering torque, and the collar can mask an overhauling thread.
assert.equal(base.selfLocking, true);
assert.ok(base.threadLowerNm > 0, 'self-locking thread needs torque to go down');
const steep = C.analyse({diameterMm: 36, pitchMm: 6, starts: 2, form: 'square', friction: 0,
  collarFriction: 0.1, collarDiameterMm: 60});
assert.equal(steep.selfLocking, false, 'a steep frictionless thread is not self-locking');
assert.ok(steep.threadLowerNm < 0, 'an overhauling thread lowers by itself');
assert.equal(steep.overhaulsAgainstCollar, false, 'the collar can still hold it');
const free = C.analyse({diameterMm: 36, pitchMm: 6, starts: 2, form: 'square', friction: 0,
  collarFriction: 0, collarDiameterMm: 0});
assert.equal(free.overhaulsAgainstCollar, true, 'without a collar the load runs away');
// Scaling: torque is linear in the load, and the collar share falls as the thread gets more efficient.
near(C.analyse({loadKn: 20}).raiseTorqueNm, base.raiseTorqueNm * 2, 'torque is linear in the load');
assert.ok(C.analyse({form: 'square', collarDiameterMm: 0}).collarSharePct === 0, 'no collar means no collar share');
// Numeric input is accepted beside text, as a Node sweep passes numbers.
near(C.analyse({loadKn: 10, diameterMm: 30, pitchMm: 3.5}).raiseTorqueNm, base.raiseTorqueNm, 'numeric input');
assert.throws(() => C.analyse({starts: 'two'}), /whole number/, 'text starts are refused');
assert.throws(() => C.analyse({pitchMm: 15}), /half the nominal diameter/, 'a pitch at half the diameter is refused');

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="screw-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('type="button" class="ghost" id="reset"'), 'the reset control is not a submit button');
assert.ok(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.equal((html.match(/<h1>/g) || []).length, 1, 'one h1');
const inputs = {
  'in-load': '10', 'in-d': '30', 'in-pitch': '3.5', 'in-mu': '0.15', 'in-collar-mu': '0.10', 'in-collar-d': '40'
};
for (const id of Object.keys(inputs)) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
  assert.ok(html.includes('id="' + id + '" inputmode="decimal" autocomplete="off" value="' + inputs[id] + '"'),
    'default value for ' + id);
}
assert.ok(html.includes('id="in-starts" inputmode="numeric" autocomplete="off" value="1"'), 'default starts value');
assert.ok(html.includes('<select id="in-form">'), 'thread form select');
for (const value of ['metric', 'acme', 'square']) {
  assert.ok(html.includes('<option value="' + value + '">'), 'thread form option ' + value);
}
for (const id of ['err', 'out', 'reset', 'screw-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
console.log('leadscrew-torque-calculator: ' + record.testCases.length +
  ' catalog cases, thread-incline identities, self-locking signs and page contract passed');
