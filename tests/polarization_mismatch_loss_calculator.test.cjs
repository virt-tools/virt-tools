/* Regression checks for the polarization mismatch core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'polarization-mismatch-loss-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* polarization-core:start */');
const end = html.indexOf('/* polarization-core:end */');
assert.ok(start > -1 && end > start, 'polarization core markers missing');
const core = html.slice(start, end + '/* polarization-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PolarizationCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (options) => plain(C.calculate(options));
const failure = (options) => {
  try {
    run(options);
  } catch (error) {
    return error.message;
  }
  return null;
};
const dB = (powerRatio) => -10 * Math.log10(powerRatio);

// ---- Field contract.
assert.deepEqual(plain(C.MODES), { LL: 'll', LC: 'lc' });
assert.deepEqual(plain(C.DEFAULTS), { mode: 'll', angle: 30, axialRatio: 1 });
assert.equal(C.MIN_ANGLE, 0);
assert.equal(C.MAX_ANGLE, 90);
assert.equal(C.MIN_AR, 0);
assert.equal(C.MAX_AR, 40);

// ---- The default: 30 degrees of tilt keeps three quarters of the power.
const d = run({});
assert.equal(d.mode, 'll');
assert.equal(d.angleDeg, 30);
assert.equal(d.voltageCoupling, 0.866);   // cos 30
assert.equal(d.plf, 0.75);                // cos^2 30
assert.equal(d.lossDb, 1.25);             // -10 log10 0.75
assert.equal(d.crossPolRejectionDb, 6.02); // -10 log10 0.25
assert.deepEqual(run(), d);
assert.deepEqual(run({ mode: 'll' }), d);

// ---- Linear identities across a sweep.
for (const angle of [0, 1, 5, 12.5, 30, 42, 45, 60, 75, 89, 90]) {
  const r = run({ mode: 'll', angle });
  const radians = angle * Math.PI / 180;
  const plf = Math.cos(radians) ** 2;
  const cross = Math.sin(radians) ** 2;
  assert.ok(Math.abs(r.plf - (plf < 1e-10 ? 0 : plf)) < 0.0001, 'PLF is cos^2 for ' + angle);
  if (r.lossDb !== null) {
    assert.ok(Math.abs(r.lossDb - dB(plf)) < 0.01, 'mismatch loss is -10 log10 PLF for ' + angle);
    assert.ok(Math.abs(r.voltageCoupling - Math.sqrt(plf)) < 0.0001, 'voltage coupling is cos for ' + angle);
  }
  if (r.crossPolRejectionDb !== null) {
    assert.ok(Math.abs(r.crossPolRejectionDb - dB(cross)) < 0.01, 'orthogonal rejection for ' + angle);
  }
  // At every interior angle the two decibel figures belong to complementary powers.
  if (r.lossDb !== null && r.crossPolRejectionDb !== null) {
    assert.ok(Math.abs(10 ** (-r.lossDb / 10) + 10 ** (-r.crossPolRejectionDb / 10) - 1) < 0.002,
      'loss and rejection powers sum to one at ' + angle);
  }
}
assert.equal(run({ mode: 'll', angle: 45 }).lossDb, 3.01);
assert.equal(run({ mode: 'll', angle: 45 }).crossPolRejectionDb, 3.01);
assert.equal(run({ mode: 'll', angle: 0 }).lossDb, 0);
assert.equal(run({ mode: 'll', angle: 0 }).crossPolRejectionDb, null);
assert.equal(run({ mode: 'll', angle: 90 }).lossDb, null);
assert.equal(run({ mode: 'll', angle: 90 }).crossPolRejectionDb, 0);

// ---- Circular identities: XPD from axial ratio, and the loss range.
for (const ar of [0.1, 0.5, 1, 2, 3, 6, 10, 20, 40, 0]) {
  const r = run({ mode: 'lc', axialRatio: ar });
  const ratio = 10 ** (ar / 20);
  assert.equal(r.mode, 'lc');
  assert.ok(Math.abs(r.axialRatioLinear - ratio) < 0.0001, 'voltage ratio r = 10^(AR/20)');
  assert.ok(r.bestCaseLossDb <= 3.02, 'best-case linear loss never exceeds 3.01 dB');
  assert.ok(r.worstCaseLossDb >= 3.01, 'worst-case linear loss is at least 3.01 dB');
  assert.ok(Math.abs(r.bestCaseLossDb - 10 * Math.log10(1 + 1 / (ratio * ratio))) < 0.01, 'best case');
  assert.ok(Math.abs(r.worstCaseLossDb - 10 * Math.log10(1 + ratio * ratio)) < 0.01, 'worst case');
  // The spread between worst and best case is exactly the axial ratio in dB.
  assert.ok(Math.abs((r.worstCaseLossDb - r.bestCaseLossDb) - ar) < 0.02, 'loss spread equals the axial ratio');
  if (ar === 0) {
    assert.equal(r.xpdDb, null);
    assert.equal(r.bestCaseLossDb, 3.01);
    assert.equal(r.worstCaseLossDb, 3.01);
  } else {
    assert.ok(Math.abs(r.xpdDb - 20 * Math.log10((ratio + 1) / (ratio - 1))) < 0.01, 'XPD formula');
  }
}
assert.equal(run({ mode: 'lc', axialRatio: 1 }).xpdDb, 24.81);
assert.equal(run({ mode: 'lc', axialRatio: 3 }).xpdDb, 15.34);
assert.equal(run({ mode: 'lc', axialRatio: 40 }).worstCaseLossDb, 40);

// ---- Numeric strings are accepted, and mode names are case-insensitive.
assert.equal(run({ mode: 'LL', angle: '12.5' }).lossDb, 0.21);
assert.equal(run({ mode: 'lc', axialRatio: '0.5' }).xpdDb, 30.82);
assert.equal(run({ angle: '.5' }).plf > 0.999, true);
assert.equal(run({ mode: 'll', angle: 30 }).axialRatioLinear, null);

// ---- Refusals name the failing field.
assert.equal(failure({ mode: 'll', angle: '' }), 'Tilt angle is required.');
assert.equal(failure({ mode: 'll', angle: '  ' }), 'Tilt angle is required.');
assert.equal(failure({ mode: 'll', angle: 91 }), 'Tilt angle must be a number from 0 to 90.');
assert.equal(failure({ mode: 'll', angle: -1 }), 'Tilt angle must be a number from 0 to 90.');
assert.equal(failure({ mode: 'll', angle: 'thirty' }), 'Tilt angle must be a number from 0 to 90.');
assert.equal(failure({ mode: 'lc', axialRatio: '' }), 'Axial ratio is required.');
assert.equal(failure({ mode: 'lc', axialRatio: 41 }), 'Axial ratio must be a number from 0 to 40.');
assert.equal(failure({ mode: 'lc', axialRatio: -0.5 }), 'Axial ratio must be a number from 0 to 40.');
assert.equal(failure({ mode: 'lc', axialRatio: '1,5' }), 'Axial ratio must be a number from 0 to 40.');
assert.equal(failure({ mode: 'xy', angle: 30 }),
  'Antenna pair must be linear / linear or linear / circular.');
assert.equal(failure({ mode: '', angle: 30 }),
  'Antenna pair must be linear / linear or linear / circular.');
assert.equal(failure({ mode: 'll', angle: 'Infinity' }), 'Tilt angle must be a number from 0 to 90.');
for (const bad of ['1e2', '0x10', '45 6', '+45', 'NaN', '4.5.6', '--2']) {
  assert.ok(failure({ mode: 'll', angle: bad }), 'tilt refuses ' + JSON.stringify(bad));
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="polarization-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Polarization Mismatch Loss Calculator<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
for (const id of ['mode', 'angle', 'ar']) {
  assert.ok(new RegExp('for="in-' + id + '"').test(html), 'label for in-' + id);
  assert.ok(new RegExp('id="in-' + id + '"').test(html), 'control in-' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 7, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Polarization Mismatch Loss Calculator');
assert.equal(record.category, 'Communications Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are recorded');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 16, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 6, 'six validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.calculate(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result[key], value, testCase.name + ' ' + key);
  }
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('polarization-mismatch-loss-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, 2 modes, 11 identities)');
