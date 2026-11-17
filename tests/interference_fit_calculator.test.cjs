/* interference fit: catalog fixtures, Lame arithmetic and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'interference-fit-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* interference-fit-core:start */';
const endMarker = '/* interference-fit-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = {module: {}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = InterferenceFitCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one interference fit calculator');
const record = records[0];
assert.equal(record.name, 'Interference Fit Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the Lame arithmetic and the scope');
assert.match(record.method, /58\.07 MPa/);
assert.match(record.method, /p\u221a\(k\u00b2\+k\+1\)/);
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\/(?:amesweb\.info|en\.wikipedia\.org)\//, 'fetched source');
  assert.ok(source.title.length > 80, 'source titles say what the page supplies');
}
assert.equal(record.testCases.length, 30);
assert.equal(record.testCases.filter((t) => t.kind === 'golden').length, 9);
assert.equal(record.testCases.filter((t) => t.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((t) => t.kind === 'validation').length, 16);
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2113, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 50,
  'Mechanical & Structural Engineering count');
// No other record claims this slug, name, alias or tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((a) => a.toLowerCase()).includes(alias.toLowerCase()),
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
// Same-material solid-shaft closed form: p = E delta (D^2 - d^2) / (2 d D^2).
const d = 50, hubD = 90, delta = 0.04, eMod = 210000;
near(base.pressureMpa, eMod * delta * (hubD * hubD - d * d) / (2 * d * hubD * hubD), 'closed form contact pressure');
// The hub bore hoop stress and the outer hoop stress differ by exactly the pressure.
near(base.hubBoreHoopMpa - base.hubOuterHoopMpa, base.pressureMpa, 'hoop difference equals the pressure');
near(base.hubOuterHoopMpa, 2 * base.pressureMpa * d * d / (hubD * hubD - d * d), 'outer hoop stress');
// A solid shaft is in hydrostatic compression, so its von Mises stress is the pressure.
near(base.shaftInterfaceHoopMpa, -base.pressureMpa, 'solid shaft hoop stress');
near(base.shaftBoreVonMisesMpa, base.pressureMpa, 'solid shaft von Mises stress');
// Torque is the friction force times the radius.
near(base.torqueNm, base.axialForceKn * d / 2, 'torque from the axial force');
near(base.axialForceKn, base.friction * base.pressureMpa * Math.PI * d * base.lengthMm / 1000, 'axial force');
// Thermal identity: the slip temperature only adds the clearance term.
near(base.slipTemperatureRiseC - base.temperatureRiseC, 0.02 / (base.hubExpansion * 1e-6 * d), 'clearance heating');
near(base.temperatureRiseC, (base.interferenceUm / 1000) / (base.hubExpansion * 1e-6 * d), 'temperature rise');
near(base.wallRatio, hubD / d, 'wall ratio');
near(base.interferenceRatioPct, 100 * base.interferenceUm / 1000 / d, 'interference share');

// Doubling the interference doubles pressure, torque and the bore stress, and halves the factor.
const doubled = C.analyse({interferenceUm: 80});
near(doubled.pressureMpa, base.pressureMpa * 2, 'pressure is linear in the interference');
near(doubled.torqueNm, base.torqueNm * 2, 'torque is linear in the interference');
near(doubled.hubBoreHoopMpa, base.hubBoreHoopMpa * 2, 'hub stress is linear in the interference');
near(doubled.hubSafetyFactor, base.hubSafetyFactor / 2, 'safety factor halves');
// Length and friction only scale the friction capacity, never the pressure.
const longer = C.analyse({lengthMm: '80'});
near(longer.pressureMpa, base.pressureMpa, 'length leaves the pressure alone');
near(longer.torqueNm, base.torqueNm * 2, 'twice the engagement doubles the torque');
const slippery = C.analyse({friction: '0.24'});
near(slippery.axialForceKn, base.axialForceKn * 2, 'twice the friction doubles the holding force');
near(slippery.pressureMpa, base.pressureMpa, 'friction leaves the pressure alone');
// A hollow shaft is more compliant, so the same interference presses less hard and stresses more at its bore.
const hollow = C.analyse({shaftBoreMm: '20'});
assert.ok(hollow.pressureMpa < base.pressureMpa, 'a hollow shaft lowers the pressure');
assert.ok(hollow.shaftBoreVonMisesMpa > hollow.pressureMpa, 'a hollow shaft is most stressed at its bore');
// A softer hub gives less pressure for the same interference.
const softHub = C.analyse({hubModulusGpa: '70'});
assert.ok(softHub.pressureMpa < base.pressureMpa, 'a softer hub lowers the pressure');
near(softHub.hubSafetyFactor, softHub.hubYieldMpa / softHub.hubBoreVonMisesMpa, 'safety factor definition');
// Numeric input is accepted beside text, as a Node sweep passes numbers.
near(C.analyse({diameterMm: 50, hubDiameterMm: 90, interferenceUm: 40}).pressureMpa, base.pressureMpa, 'numeric input');
// The yielding flag follows the hub bore stress.
assert.equal(C.analyse({hubYieldMpa: '100'}).hubYields, true);
assert.equal(C.analyse({hubYieldMpa: '100'}).lowSafety, true);
assert.equal(C.analyse({hubYieldMpa: '298'}).lowSafety, false);

// Page contract: shared shell, keyboard-submittable form, accessible output and no foreign runtime.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html));
assert.ok(!/<script[^>]+src="https?:/i.test(html));
assert.ok(!/<link[^>]+href="https?:/i.test(html));
assert.ok(!/on(?:click|input|change|submit|keydown)=/i.test(html));
assert.ok(!/\beval\s*\(|new\s+Function\b|innerHTML/.test(html));
assert.ok(html.includes('<form id="fit-form" novalidate>'));
assert.ok(html.includes('type="submit"'));
assert.ok(html.includes('type="button" class="ghost" id="reset"'), 'the reset control is not a submit button');
assert.ok(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.equal((html.match(/<h1>/g) || []).length, 1, 'one h1');
const inputs = {
  'in-d': '50', 'in-hub': '90', 'in-bore': '0', 'in-interference': '40', 'in-length': '40',
  'in-friction': '0.12', 'in-hub-e': '210', 'in-hub-nu': '0.30', 'in-hub-alpha': '12',
  'in-hub-yield': '355', 'in-shaft-e': '210', 'in-shaft-nu': '0.30'
};
for (const id of Object.keys(inputs)) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'missing label ' + id);
  assert.ok(html.includes('id="' + id + '" inputmode="decimal" autocomplete="off" value="' + inputs[id] + '"'),
    'default value for ' + id);
}
for (const id of ['err', 'out', 'reset', 'fit-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
console.log('interference-fit-calculator: 30 catalog cases, Lame identities, scaling laws and page contract passed');
