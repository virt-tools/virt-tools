/* Regression checks for the Yagi-Uda element planner core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/yagi-antenna-element-planner/index.html'), 'utf8');
const start = html.indexOf('/* yagi-core:start */');
const end = html.indexOf('/* yagi-core:end */');
assert.ok(start > -1 && end > start, 'yagi core markers missing');
const core = html.slice(start, end + '/* yagi-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = YagiCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'yagi-antenna-element-planner');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

const keys = ['wavelengthM', 'elementCount', 'boomLengthM', 'boomWavelengths', 'longestElementM', 'totalElementLengthM', 'profile'];
const plain = (value) => JSON.parse(JSON.stringify(value));

// The three profiles are the documented starting families and each grows the boom.
assert.deepEqual(Object.keys(C.PROFILES).sort(), ['compact', 'long', 'standard']);
for (const [key, spec] of Object.entries(C.PROFILES)) {
  assert.ok(spec.reflector > spec.driven, `${key}: reflector must be longer than the driven element`);
  assert.ok(spec.driven > spec.firstDirector, `${key}: driven element must be longer than the first director`);
  assert.ok(spec.taper > 0, `${key}: directors must taper`);
  assert.ok(spec.directorSpacing > spec.reflectorSpacing, `${key}: directors should be spaced wider than the reflector`);
}

for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.design(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }

  const plan = C.design(Object.assign({}, testCase.input));
  const expected = testCase.expected;
  for (const key of keys) assert.equal(plan[key], expected[key], `${label}: ${key}`);
  assert.deepEqual(plain(plan.elements), plain(expected.elements), `${label}: element table`);

  const spec = C.PROFILES[plan.profile];
  const directors = plan.elementCount - 2;
  assert.equal(plan.elements.length, plan.elementCount, `${label}: element count`);
  assert.equal(plan.elementCount, directors + 2, `${label}: directors plus pair`);
  assert.equal(plan.boomWavelengths, Math.round((spec.reflectorSpacing + spec.directorSpacing * directors) * 10000) / 10000,
    `${label}: boom in wavelengths`);
  assert.equal(plan.elements[0].role, 'Reflector', `${label}: reflector first`);
  assert.equal(plan.elements[1].role, 'Driven element', `${label}: driven second`);
  assert.equal(plan.elements[0].positionM, 0, `${label}: reflector at the boom origin`);
  assert.equal(plan.elements[0].gapM, null, `${label}: reflector has no gap`);

  // Positions strictly increase, each gap is the spacing between neighbours, and the boom ends at the last element.
  for (let i = 1; i < plan.elements.length; i++) {
    assert.ok(plan.elements[i].positionM > plan.elements[i - 1].positionM, `${label}: position ${i} not increasing`);
    const gap = Math.round((plan.elements[i].positionM - plan.elements[i - 1].positionM) * 10000) / 10000;
    assert.ok(Math.abs(gap - plan.elements[i].gapM) <= 0.0002, `${label}: gap ${i} disagrees with positions`);
  }
  assert.equal(plan.elements[plan.elements.length - 1].positionM, plan.boomLengthM, `${label}: boom length`);
  assert.equal(plan.elements[1].gapM, plan.elements[1].positionM, `${label}: driven gap from the reflector`);

  // Every element is shorter than the one behind it, and each length follows its profile ratio.
  for (let i = 2; i < plan.elements.length; i++) {
    assert.ok(plan.elements[i].lengthM < plan.elements[i - 1].lengthM, `${label}: director ${i} does not taper`);
  }
  const wavelength = 299.792458 / plan.frequency;
  const round4 = (value) => Math.round(value * 10000) / 10000;
  assert.equal(round4(spec.reflector * wavelength), plan.elements[0].lengthM, `${label}: reflector length`);
  assert.equal(plan.longestElementM, plan.elements[0].lengthM, `${label}: longest element`);
  const total = plan.elements.reduce((sum, element) => sum + element.lengthM, 0);
  assert.ok(Math.abs(total - plan.totalElementLengthM) <= 0.0005, `${label}: total element length`);
  for (let i = 1; i <= directors; i++) {
    const factor = spec.firstDirector - spec.taper * (i - 1);
    assert.equal(round4(factor * wavelength), plan.elements[i + 1].lengthM, `${label}: director ${i} length`);
  }
}

// The defaults are the documented 145 MHz, six-director standard design.
const fallback = C.design({});
assert.equal(fallback.frequency, 145);
assert.equal(fallback.elementCount, 8);
assert.equal(fallback.profile, 'standard');
assert.equal(fallback.boomLengthM, C.design({ frequency: '145', directors: '6', profile: 'standard' }).boomLengthM);

// An empty profile value falls back to the standard family, an explicit unknown one does not.
assert.equal(C.design({ profile: '' }).profile, 'standard');
assert.throws(() => C.design({ profile: 'wide' }), /Choose a compact, standard or long boom\./);

// Units convert for display only; the core stays in metres.
assert.equal(C.convert(1, 'm'), 1);
assert.equal(C.convert(1, 'ft'), 3.28084);
assert.ok(Math.abs(C.convert(2.7912, 'ft') - 9.157) < 0.01);

// The cut list carries every element with a three-decimal length in the requested unit.
const plan = C.design({ frequency: '145', directors: '6', profile: 'standard' });
const metres = C.cutList(plan, 'm');
const feet = C.cutList(plan, 'ft');
assert.ok(metres.startsWith('Yagi-Uda, 8 elements at 145 MHz'), 'cut list heading');
assert.equal(metres.trim().split('\n').length, 3 + plan.elementCount, 'cut list width');
assert.ok(metres.includes('Director 1') && metres.includes('Director 6'), 'cut list directors');
assert.ok(metres.includes('1.023') && metres.includes('0.894'), 'cut list lengths');
assert.ok(feet.includes((1.0234 * 3.28084).toFixed(3)), 'cut list feet reflector');
assert.ok(feet.includes((0.8942 * 3.28084).toFixed(3)), 'cut list feet last director');
assert.ok(!metres.includes('NaN') && !feet.includes('NaN'), 'cut list has no missing numbers');
