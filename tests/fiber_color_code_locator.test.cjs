/* Regression checks for the fiber color code locator core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/fiber-color-code-locator/index.html'), 'utf8');
const start = html.indexOf('/* fiber-core:start */');
const end = html.indexOf('/* fiber-core:end */');
assert.ok(start > -1 && end > start, 'fiber core markers missing');
const core = html.slice(start, end + '/* fiber-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FiberCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'fiber-color-code-locator');
assert.ok(entry, 'catalog entry missing');
assert.ok(entry.testCases.length >= 30, `expected at least 30 cases, found ${entry.testCases.length}`);

// The twelve-color sequence is the documented TIA-598 order, with a swatch colour for every entry.
assert.equal(C.COLORS.map((color) => color.name).join(','),
  'Blue,Orange,Green,Brown,Slate,White,Red,Black,Yellow,Violet,Rose,Aqua');
assert.equal(C.COLORS.map((color) => color.number).join(','), '1,2,3,4,5,6,7,8,9,10,11,12');
for (const color of C.COLORS) assert.match(color.hex, /^#[0-9a-f]{6}$/, `${color.name}: swatch colour`);
assert.equal(C.PER_TUBE.join(','), '6,12,24');
assert.equal(C.MAX_FIBER, 288);

const keys = ['fiber', 'perTube', 'tube', 'tubeCount', 'tubeColor', 'tubeGroup', 'position', 'fiberColor', 'fiberPass'];
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.locate(Object.assign({}, testCase.input)),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const result = C.locate(Object.assign({}, testCase.input));
  for (const key of keys) assert.equal(result[key], testCase.expected[key], `${label}: ${key}`);
  assert.match(result.tubeColorHex, /^#[0-9a-f]{6}$/, `${label}: tube swatch`);
  assert.match(result.fiberColorHex, /^#[0-9a-f]{6}$/, `${label}: fiber swatch`);
}

// Defaults and numeric inputs behave like the documented 1-of-12 example.
const fallback = C.locate({});
assert.equal(fallback.fiber, 1);
assert.equal(fallback.perTube, 12);
assert.equal(fallback.tube, 1);
assert.deepEqual(fallback, C.locate({ fiber: '1', perTube: '12' }));
assert.deepEqual(C.locate({ perTube: '' }), C.locate({ fiber: 1, perTube: '12' }));

// Every supported fiber maps to exactly one tube and one position, and the colours follow the sequence.
for (const perTube of C.PER_TUBE) {
  const tubes = Math.ceil(C.MAX_FIBER / perTube);
  for (let fiber = 1; fiber <= C.MAX_FIBER; fiber++) {
    const result = C.locate({ fiber, perTube });
    assert.equal(result.tube, Math.ceil(fiber / perTube), `fiber ${fiber}/${perTube}: tube`);
    assert.equal(result.tubeCount, tubes, `fiber ${fiber}/${perTube}: tube count`);
    assert.ok(result.tube >= 1 && result.tube <= tubes, `fiber ${fiber}/${perTube}: tube range`);
    assert.ok(result.position >= 1 && result.position <= perTube, `fiber ${fiber}/${perTube}: position range`);
    assert.equal((result.tube - 1) * perTube + result.position, fiber, `fiber ${fiber}/${perTube}: round trip`);
    assert.equal(result.tubeColor, C.COLORS[(result.tube - 1) % 12].name, `fiber ${fiber}/${perTube}: tube colour`);
    assert.equal(result.fiberColor, C.COLORS[(result.position - 1) % 12].name, `fiber ${fiber}/${perTube}: fiber colour`);
    assert.equal(result.tubeColorNumber, ((result.tube - 1) % 12) + 1, `fiber ${fiber}/${perTube}: tube colour number`);
    assert.equal(result.fiberColorNumber, ((result.position - 1) % 12) + 1, `fiber ${fiber}/${perTube}: fiber colour number`);
    assert.equal(result.tubeGroup, Math.floor((result.tube - 1) / 12) + 1, `fiber ${fiber}/${perTube}: tube group`);
    assert.equal(result.fiberPass, Math.floor((result.position - 1) / 12) + 1, `fiber ${fiber}/${perTube}: fiber pass`);
    if (perTube === 12) assert.equal(result.fiberPass, 1, `fiber ${fiber}/${perTube}: single pass`);
  }
}

// A 24-fiber tube repeats the sequence exactly once, and only positions 13-24 are a second pass.
assert.equal(C.locate({ fiber: 13, perTube: 24 }).fiberPass, 2);
assert.equal(C.locate({ fiber: 13, perTube: 24 }).fiberColor, 'Blue');
assert.equal(C.locate({ fiber: 25, perTube: 24 }).fiberPass, 1);
assert.equal(C.locate({ fiber: 145, perTube: 12 }).tubeGroup, 2);
assert.equal(C.locate({ fiber: 145, perTube: 12 }).tubeColor, 'Blue');
assert.equal(C.locate({ fiber: 288, perTube: 6 }).tubeGroup, 4);
assert.equal(C.locate({ fiber: 288, perTube: 6 }).position, 6);

// The copyable location names the tube, position and both colours, and flags every repeat.
const plain = C.copyText(C.locate({ fiber: 37, perTube: 12 }));
assert.equal(plain, 'Fiber 37 of 288: tube 4 (Brown), position 1 of 12 (Blue).');
assert.match(C.copyText(C.locate({ fiber: 37, perTube: 24 })), /Second 12-fiber pass in the tube/);
assert.match(C.copyText(C.locate({ fiber: 145, perTube: 12 })), /Tube colors repeat after 12; this is tube group 2\./);
assert.ok(!plain.includes('undefined') && !plain.includes('NaN'));

// Refusals name the offending field and never fall back silently.
const bad = (input, message) => assert.throws(() => C.locate(input), (error) => {
  assert.equal(error.message, message);
  return true;
});
bad({ fiber: '0' }, 'Fiber number must be a whole number from 1 to 288.');
bad({ fiber: '289' }, 'Fiber number must be a whole number from 1 to 288.');
bad({ fiber: '3.0' }, 'Fiber number must be a whole number from 1 to 288.');
bad({ fiber: '' }, 'Enter the fiber number.');
bad({ perTube: '8' }, 'Choose 6, 12 or 24 fibers per tube.');
bad({ perTube: 'abc' }, 'Choose 6, 12 or 24 fibers per tube.');
