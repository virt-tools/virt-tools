/* Pan law calculator: the three pan-law tapers, their invariants, the mono
   fold-down and two-speaker figures, formatting, refusals, the law comparison,
   catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pan-law-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pan-law-core:start */';
const endMarker = '/* pan-law-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PanLawCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (pan, law) => plain(C.calculate(pan, law));
const failure = (pan, law) => {
  try { run(pan, law); } catch (error) { return error.message; }
  return null;
};
const db = (ratio) => 20 * Math.log10(ratio);
const powerDb = (power) => 10 * Math.log10(power);
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const round2 = (value) => {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

// ---- Exported constants.
assert.equal(C.MIN_PAN, -100);
assert.equal(C.MAX_PAN, 100);
assert.equal(C.DEFAULT_PAN, '0');
assert.equal(C.DEFAULT_LAW, 'constant-power');
assert.deepEqual(plain(C.LAWS.map((law) => law.key)), ['constant-power', 'compromise', 'linear']);
assert.deepEqual(plain(C.LAWS.map((law) => law.label)),
  ['-3 dB constant power', '-4.5 dB compromise', '-6 dB linear']);
assert.equal(C.resolveLaw('linear').key, 'linear');
assert.equal(C.resolveLaw(' quad '), null, 'unknown keys resolve to null');
assert.equal(C.resolveLaw(''), null);

// ---- Gains at the centre, against the published figures.
close(C.gains('constant-power', 0).left, Math.SQRT1_2, 1e-15, 'constant power left at centre');
close(C.gains('constant-power', 0).right, Math.SQRT1_2, 1e-15, 'constant power right at centre');
close(C.gains('linear', 0).left, 0.5, 1e-15, 'linear left at centre');
close(C.gains('linear', 0).right, 0.5, 1e-15, 'linear right at centre');
const compromiseCentre = Math.sqrt(0.5 * Math.SQRT1_2);
close(C.gains('compromise', 0).left, compromiseCentre, 1e-15, 'compromise left at centre');
close(C.gains('compromise', 0).right, compromiseCentre, 1e-15, 'compromise right at centre');
close(db(compromiseCentre), -4.5155, 5e-4, 'the compromise centre sits about 4.5 dB down');
close(db(0.5), -6.0206, 5e-4, 'the linear centre sits about 6 dB down');
close(db(Math.SQRT1_2), -3.0103, 5e-4, 'the constant power centre sits about 3 dB down');

// The centre results, including the mono and two-speaker figures.
const centreCp = run('0', 'constant-power');
close(centreCp.leftDb, -3.010299956639812, 1e-12, 'centre constant power left dB');
close(centreCp.monoDb, 3.0102999566398115, 1e-12, 'centre constant power folds 3 dB hot');
close(centreCp.stereoDb, 0, 1e-15, 'centre constant power holds the two-speaker level');
const centreLinear = run('0', 'linear');
close(centreLinear.monoDb, 0, 1e-15, 'the linear law holds the mono sum');
close(centreLinear.stereoDb, -3.0102999566398115, 1e-12, 'the linear law loses 3 dB on two speakers');
const centreCompromise = run('0', 'compromise');
close(centreCompromise.monoDb, 1.5051499783199062, 1e-12, 'the compromise folds 1.5 dB hot');
close(centreCompromise.stereoDb, -1.5051499783199062, 1e-12, 'the compromise loses 1.5 dB on two speakers');

// ---- The taper identities hold across the whole travel.
let sweep = 0;
for (let step = 0; step <= 400; step += 1) {
  const pan = -100 + step * 0.5;
  const t = (pan + 100) / 200;
  const angle = t * Math.PI / 2;
  const cp = C.gains('constant-power', pan);
  const linear = C.gains('linear', pan);
  const compromise = C.gains('compromise', pan);
  close(cp.left * cp.left + cp.right * cp.right, 1, 1e-12, 'constant power stays at unit power at ' + pan);
  close(linear.left + linear.right, 1, 1e-12, 'linear stays at unit amplitude at ' + pan);
  close(compromise.left * compromise.left, (1 - t) * Math.cos(angle), 1e-12,
    'the compromise square is the geometric mean on the left at ' + pan);
  close(compromise.right * compromise.right, t * Math.sin(angle), 1e-12,
    'the compromise square is the geometric mean on the right at ' + pan);
  close(cp.left, Math.cos(angle), 1e-15, 'constant power follows the cosine at ' + pan);
  close(cp.right, Math.sin(angle), 1e-15, 'constant power follows the sine at ' + pan);
  for (const law of ['constant-power', 'compromise', 'linear']) {
    const result = C.compute(pan, law);
    assert.ok(result.left >= 0 && result.left <= 1, law + ' left in range at ' + pan);
    assert.ok(result.right >= 0 && result.right <= 1, law + ' right in range at ' + pan);
    close(result.monoDb, db(result.left + result.right), 1e-12, law + ' mono figure at ' + pan);
    close(result.stereoDb, powerDb(result.left * result.left + result.right * result.right), 1e-12,
      law + ' stereo figure at ' + pan);
    assert.ok(result.balanceDb === result.leftDb - result.rightDb
      || Math.abs(result.balanceDb - (result.leftDb - result.rightDb)) < 1e-12,
    law + ' balance at ' + pan);
    close(result.leftPercent, result.left * 100, 1e-12, law + ' left percent at ' + pan);
    assert.match(result.headline, /^(L silent, R -?\d+\.\d\d dB|L -?\d+\.\d\d dB, R silent|L -?\d+\.\d\d dB, R -?\d+\.\d\d dB)$/,
      law + ' headline at ' + pan);
    sweep += 1;
  }
  // Moving right never raises the left gain and never lowers the right gain.
  if (step > 0) {
    const previousPan = pan - 0.5;
    for (const law of ['constant-power', 'compromise', 'linear']) {
      const before = C.gains(law, previousPan);
      const after = C.gains(law, pan);
      assert.ok(after.left <= before.left + 1e-12, law + ' left never rises at ' + pan);
      assert.ok(after.right >= before.right - 1e-12, law + ' right never falls at ' + pan);
    }
  }
}

// ---- Hard panning puts everything on one side under every law.
for (const law of ['constant-power', 'compromise', 'linear']) {
  const left = C.compute(-100, law);
  assert.equal(left.left, 1, law + ' hard left is unity');
  assert.equal(left.right, 0, law + ' hard left silences the right');
  assert.equal(left.leftText, '0.00 dB', law + ' hard left gain text');
  assert.equal(left.rightText, 'silent', law + ' hard left right text');
  assert.equal(left.monoText, '0.00 dB', law + ' hard left mono figure');
  assert.equal(left.stereoText, '0.00 dB', law + ' hard left two-speaker figure');
  assert.equal(left.balanceText, 'infinite', law + ' hard left difference is infinite');
  assert.equal(left.positionText, 'hard left', law + ' hard left label');
  const right = C.compute(100, law);
  assert.equal(right.right, 1, law + ' hard right is unity');
  assert.equal(right.left, 0, law + ' hard right silences the left');
  assert.equal(right.headline, 'L silent, R 0.00 dB', law + ' hard right headline');
  assert.equal(right.positionText, 'hard right', law + ' hard right label');
}

// ---- Formatting and position labels.
assert.equal(C.formatGain(0), '0.00 dB');
assert.equal(C.formatGain(-Infinity), 'silent');
assert.equal(C.formatGain(-3.011), '-3.01 dB');
assert.equal(C.formatDelta(0), '0.00 dB');
assert.equal(C.formatDelta(1.234), '+1.23 dB');
assert.equal(C.formatDelta(-2.5), '-2.50 dB');
assert.equal(C.formatDelta(-0.004), '0.00 dB', 'a negative zero never prints');
assert.equal(C.formatPercent(70.7106), '70.71%');
assert.equal(C.formatPercent(100), '100%');
assert.equal(C.formatPercent(0), '0%');
assert.equal(C.positionLabel(0), 'centre');
assert.equal(C.positionLabel(-100), 'hard left');
assert.equal(C.positionLabel(100), 'hard right');
assert.equal(C.positionLabel(-37.5), '37.50% left');
assert.equal(C.positionLabel(12), '12% right');
assert.equal(C.parsePan('0'), 0);
assert.equal(C.parsePan('-0'), 0, 'a negative zero reads as the centre');
assert.equal(C.parsePan(' 12.5 '), 12.5);
assert.equal(C.parsePan('-100'), -100);
assert.equal(C.parsePan('100'), 100);

// ---- Refusals carry the reason and nothing else.
assert.equal(failure('', 'constant-power'), 'Enter a pan position in percent, such as 0.');
assert.equal(failure('   ', 'linear'), 'Enter a pan position in percent, such as 0.');
assert.equal(failure('abc', 'linear'), 'Enter the pan position as a number in percent, such as 0.');
assert.equal(failure('1e1', 'linear'), 'Enter the pan position as a number in percent, such as 0.');
assert.equal(failure('50%', 'linear'), 'Enter the pan position as a number in percent, such as 0.');
assert.equal(failure('100.5', 'linear'), 'Pan position must be between -100 and 100 percent.');
assert.equal(failure('-100.5', 'linear'), 'Pan position must be between -100 and 100 percent.');
assert.equal(failure('0', 'quadratic'), 'Choose one of the three pan laws.');
assert.equal(failure('0', ''), 'Choose one of the three pan laws.');

// ---- The comparison puts the chosen law first among the three.
const comparison = plain(C.compare(-25, 'compromise'));
assert.equal(comparison.length, 3, 'three laws are compared');
assert.deepEqual(comparison.map((row) => row.lawKey), ['constant-power', 'compromise', 'linear']);
assert.deepEqual(comparison.map((row) => row.selected), [false, true, false]);
for (const row of comparison) {
  assert.ok(!/dB/.test(row.leftText + row.rightText + row.monoText + row.stereoText),
    'table cells drop the unit for the column header');
  const result = C.compute(-25, row.lawKey);
  assert.equal(row.leftText, result.leftText.replace(' dB', ''), row.lawKey + ' left cell');
  assert.equal(row.monoText, result.monoText.replace(' dB', ''), row.lawKey + ' mono cell');
}
const unknownSelection = plain(C.compare(0, 'nope'));
assert.deepEqual(unknownSelection.map((row) => row.selected), [false, false, false]);

// ---- Determinism and the calculate/compute pair.
for (const [pan, law] of [['0', 'constant-power'], ['-37.5', 'compromise'], ['99.9', 'linear']]) {
  const once = run(pan, law);
  const twice = run(pan, law);
  assert.deepEqual(once, twice, pan + ' ' + law + ' is deterministic');
  assert.deepEqual(once, plain(C.compute(Number(pan), law)), pan + ' ' + law + ' matches compute');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Pan Law Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Mixing');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-17T23:30:00Z');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('sqrt'), 'method states the compromise curve');
assert.ok(record.method.includes('20 log10'), 'method states the mono fold-down');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.equal(record.sources.length, 3, 'three sources are cited');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'sources carry fetched URLs');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 24, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const { pan, law } = testCase.input;
  if (testCase.kind === 'validation') {
    assert.equal(failure(pan, law), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(pan, law);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (key.endsWith('Db')) {
      if (expected === null) {
        assert.ok(!Number.isFinite(actual[key]), testCase.name + ' ' + key + ' is infinite');
      } else {
        assert.equal(round2(actual[key]), expected, testCase.name + ' ' + key);
      }
    } else {
      assert.equal(actual[key], expected, testCase.name + ' ' + key);
    }
    checked += 1;
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
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['audio', 'panning', 'pan-law', 'mixing', 'stereo', 'gain-staging', 'mono-compatibility']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2433, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2172, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 53, 'audio records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 9, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="pan">/.test(html), 'the pan field has a label');
assert.ok(/<label for="law">/.test(html), 'the law selector has a label');
assert.equal((html.match(/<option value=/g) || []).length, 3, 'three laws are offered');
assert.ok(/<option value="constant-power" selected>/.test(html), 'constant power is the default law');
assert.ok(/value="0"/.test(html), 'the default pan is in the markup');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the tables are described');
assert.ok(/<th scope="row">/.test(html), 'the comparison rows are headed');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/type="text"/g) || []).length, 1, 'one text input');
assert.equal((html.match(/<th scope="col">/g) || []).length, 7, 'two detail columns and five comparison columns');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('pan law calculator: three tapers, ' + sweep + ' sweep plans, 24 catalog cases and the page contract pass');
