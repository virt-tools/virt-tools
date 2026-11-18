/* Regression checks for the jump ring coil core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/jump-ring-coil-calculator/index.html'), 'utf8');
const start = html.indexOf('/* jump-ring-core:start */');
const end = html.indexOf('/* jump-ring-core:end */');
assert.ok(start > -1 && end > start, 'jump-ring core markers missing');
const core = html.slice(start, end + '/* jump-ring-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = JumpRingCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.calculate(input);
const close = (got, want, label, tolerance = 1e-9) => {
  assert.ok(Math.abs(got - want) < tolerance, label + ': ' + got + ' != ' + want);
};

// Defaults: 8 mm mandrel, 1.2 mm wire, 0.25 mm kerf, 5 m of wire.
// Expectations come from an independent Decimal model with a 60-digit pi, not from the page.
const base = run({});
assert.equal(base.rings, 171);
assert.equal(base.innerDiameter, 8);
assert.equal(base.outerDiameter, 10.4);
assert.equal(base.meanDiameter, 9.2);
close(base.circumference, 28.902652413026, 'centreline circumference');
close(base.perRing, 29.152652413026097, 'wire per ring');
close(base.leftoversMm, 14.896437372537, 'leftover wire');
close(base.ringsPerMetre, 34.302196103198, 'rings per metre');
close(base.coilMm, 205.2, 'coil length');
close(base.wirePer100, 2.915265241303, 'wire for 100 rings');
close(base.aspectRatio, 6.666666666666667, 'aspect ratio');

// A bigger mandrel and thicker wire on two metres of wire.
const big = run({ mandrel: '18', wire: '1.6', kerf: '0.3', length: '2' });
assert.equal(big.rings, 32);
close(big.circumference, 61.57521601036, 'big circumference');
close(big.perRing, 61.87521601035995, 'big wire per ring');
close(big.aspectRatio, 11.25, 'big aspect ratio');

// A flush cut loses no material, so the wire per ring is the bare circumference.
const flush = run({ mandrel: '4.5', wire: '0.8', kerf: '0', length: '1' });
assert.equal(flush.rings, 60);
close(flush.perRing, 16.650441064025905, 'flush wire per ring');
assert.equal(flush.perRing, flush.circumference);

// Ten metres on a 12 mm mandrel.
const long = run({ mandrel: '12', wire: '2', kerf: '0.5', length: '10' });
assert.equal(long.rings, 224);
assert.equal(long.coilMm, 448);

// A wide kerf is charged to every ring.
const kerf = run({ mandrel: '9', wire: '1.4', kerf: '1.5', length: '4' });
assert.equal(kerf.rings, 117);
close(kerf.perRing - kerf.circumference, 1.5, 'kerf added once per ring');

// The smallest and largest accepted values.
const tiny = run({ mandrel: '1', wire: '0.2', kerf: '0', length: '0.1' });
assert.equal(tiny.rings, 26);
close(tiny.perRing, 3.7699111843077517, 'tiny wire per ring');
const huge = run({ mandrel: '50', wire: '6', kerf: '5', length: '1000' });
assert.equal(huge.rings, 5527);
close(huge.perRing, 180.92918860102841, 'huge wire per ring');
close(huge.ringsPerMetre, 5.527024178532, 'huge rings per metre');

// A square-section ring has an aspect ratio of one.
const square = run({ mandrel: '2', wire: '2', kerf: '0.2', length: '1' });
assert.equal(square.rings, 78);
assert.equal(square.aspectRatio, 1);

// Short wire still counts whole rings only.
const short = run({ mandrel: '50', wire: '6', kerf: '5', length: '0.4' });
assert.equal(short.rings, 2);
close(short.leftoversMm, 38.14162279794318, 'short leftover');

// Two hundred random coils: the reported count fits the wire and the next ring does not.
let seed = 20261118;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let i = 0; i < 200; i += 1) {
  const mandrel = (1 + rand() * 49).toFixed(3);
  const wire = (0.2 + rand() * 5.8).toFixed(3);
  const kerf = (rand() * Math.min(4, Number(mandrel) * 0.8)).toFixed(3);
  const length = (0.1 + rand() * 999).toFixed(3);
  const got = run({ mandrel, wire, kerf, length });
  assert.ok(got.rings * got.perRing <= got.wireMm + 1e-9, 'rings overshoot the wire');
  assert.ok((got.rings + 1) * got.perRing > got.wireMm - 1e-9, 'a whole ring was left uncounted');
  assert.ok(got.leftoversMm >= -1e-9 && got.leftoversMm < got.perRing, 'leftover outside one ring');
  close(got.circumference, Math.PI * (got.mandrel + got.wire), 'circumference identity', 1e-12);
  close(got.outerDiameter, got.mandrel + 2 * got.wire, 'outer diameter identity', 1e-12);
  close(got.coilMm, got.rings * got.wire, 'coil identity', 1e-12);
  close(got.aspectRatio, got.mandrel / got.wire, 'aspect ratio identity', 1e-12);
  close(got.wirePer100, 100 * got.perRing / 1000, 'hundred-ring identity', 1e-12);
}

// Doubling the wire adds one ring at most, never halves the count.
for (let i = 0; i < 40; i += 1) {
  const mandrel = (2 + rand() * 20).toFixed(2);
  const wire = (0.5 + rand() * 2).toFixed(2);
  const kerf = (rand() * 0.6).toFixed(2);
  const length = (0.5 + rand() * 20).toFixed(2);
  const one = run({ mandrel, wire, kerf, length });
  const two = run({ mandrel, wire, kerf, length: (Number(length) * 2).toFixed(2) });
  assert.ok(two.rings === 2 * one.rings || two.rings === 2 * one.rings + 1, 'doubling wire');
}

// Bad input fails with an actionable message, never a silent default.
const refuse = (input, message) => {
  let caught = null;
  try { run(input); } catch (error) { caught = error; }
  assert.ok(caught, 'expected a refusal for ' + JSON.stringify(input));
  assert.equal(caught.message, message);
};
refuse({ mandrel: '' }, 'Mandrel diameter is required.');
refuse({ mandrel: '  ' }, 'Mandrel diameter is required.');
refuse({ mandrel: 'eight' }, 'Mandrel diameter must be a number from 1 to 50 mm.');
refuse({ mandrel: '0.9' }, 'Mandrel diameter must be a number from 1 to 50 mm.');
refuse({ mandrel: '50.1' }, 'Mandrel diameter must be a number from 1 to 50 mm.');
refuse({ mandrel: '-8' }, 'Mandrel diameter must be a number from 1 to 50 mm.');
refuse({ wire: '' }, 'Wire diameter is required.');
refuse({ wire: '0.19' }, 'Wire diameter must be a number from 0.2 to 6 mm.');
refuse({ wire: '6.1' }, 'Wire diameter must be a number from 0.2 to 6 mm.');
refuse({ wire: '1e0' }, 'Wire diameter must be a number from 0.2 to 6 mm.');
refuse({ kerf: '' }, 'Saw kerf is required.');
refuse({ kerf: '-0.1' }, 'Saw kerf must be a number from 0 to 5 mm.');
refuse({ kerf: '5.5' }, 'Saw kerf must be a number from 0 to 5 mm.');
refuse({ length: '' }, 'Wire length is required.');
refuse({ length: '0' }, 'Wire length must be a number from 0.1 to 1000 m.');
refuse({ length: '1000.5' }, 'Wire length must be a number from 0.1 to 1000 m.');
refuse({ mandrel: '.5' }, 'Mandrel diameter must be a number from 1 to 50 mm.');
refuse({ mandrel: '4', kerf: '4' }, 'The saw kerf must be smaller than the mandrel diameter.');
refuse({ mandrel: '50', wire: '6', kerf: '5', length: '0.1' }, 'The wire is shorter than one ring.');

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|eval\(|new Function/.test(html), 'page uses storage, network or eval APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/[^\x00-\x7F]/.test(html), 'page source is not ASCII');

// Every id the script looks up exists once in the markup.
const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids in the page');
for (const id of Array.from(html.matchAll(/getElementById\("([^"]+)"\)/g), (match) => match[1])) {
  assert.ok(ids.includes(id), 'script looks up a missing id: ' + id);
}
for (const id of ['in-mandrel', 'in-wire', 'in-kerf', 'in-length']) {
  assert.ok(ids.includes(id), 'missing control id: ' + id);
  assert.ok(new RegExp('<label class="f" for="' + id + '"').test(html), 'unlabelled control: ' + id);
}
assert.ok(ids.includes('err') && ids.includes('out'), 'missing result regions');
assert.ok(/aria-live="polite"/.test(html), 'result is not announced');
assert.ok(/min-height:44px/.test(html), 'tap targets are not sized');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'jump-ring-coil-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
assert.ok(/browser/.test(record.method), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    let caught = null;
    try { C.calculate(options); } catch (error) { caught = error; }
    assert.ok(caught, testCase.name + ' was not refused');
    assert.equal(caught.message, testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('jump-ring-coil-calculator: all checks passed (' + record.testCases.length + ' catalog cases)');
