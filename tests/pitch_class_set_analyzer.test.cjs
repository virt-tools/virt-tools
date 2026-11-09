/* Regression checks for the pitch-class set analyzer: the page core against the
   published table of set classes, the catalog cases, and the page's offline,
   no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'pitch-class-set-analyzer';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* pitch-class-set-core:start */');
const end = html.indexOf('/* pitch-class-set-core:end */');
assert.ok(start > -1 && end > start, 'pitch-class set core markers missing');
const core = html.slice(start, end + '/* pitch-class-set-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PitchClassSetCore;', sandbox);
const C = sandbox.module.exports;

const analyze = (text) => C.analyze(text);
const failure = (text) => {
  try {
    analyze(text);
  } catch (error) {
    return error.message;
  }
  return null;
};
const list = (values) => Array.from(values);

// ---- Published table of all 223 set classes (Wikipedia, list of set classes).
// Prime forms are the Rahn spelling, the convention the page uses.
const classes = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/pitch_class_set_classes.json'), 'utf8'));
assert.equal(classes.length, 223, 'fixture should hold every set class');
const byKey = new Map(classes.map((entry) => [entry.primeForm.join(','), entry]));

for (const entry of classes) {
  const prime = entry.primeForm;
  assert.deepEqual(list(C.primeForm(prime)), prime, entry.forte + ' prime form');
  if (entry.intervalVector) {
    assert.deepEqual(list(C.intervalVector(prime)), entry.intervalVector, entry.forte + ' interval vector');
  }
  assert.equal(C.FORTE[prime.join(',')], entry.forte, entry.forte + ' label');
}

// The label table holds the empty set plus every class, and nothing else.
assert.equal(Object.keys(C.FORTE).length, 224, 'Forte table size');
assert.equal(C.FORTE[''], '0-1', 'empty set label');
for (const [key, label] of Object.entries(C.FORTE)) {
  if (key === '') continue;
  assert.ok(byKey.has(key), 'unknown prime form in the label table: ' + key);
  assert.equal(byKey.get(key).forte, label, 'label mismatch for ' + key);
  assert.equal(Number(label.split('-')[0]), key.split(',').length, 'cardinality of ' + label);
}

// Spelled-out anchors that are easy to check by hand.
assert.equal(analyze('C E G').forte, '3-11');
assert.equal(analyze('C E\u266d G').forte, '3-11');
assert.equal(analyze('C E G B\u266d').forte, '4-27');
assert.equal(analyze('C D\u266d E\u266d G').forte, '4-Z29');
assert.equal(analyze('C D\u266d E F\u266f').forte, '4-Z15');
assert.equal(analyze('C D E F G A B').forte, '7-35');

// ---- Definitions, checked directly rather than through the page's own helpers.
const span = (set) => Math.max(...set) - Math.min(...set);
const sorted = (values) => values.slice().sort((a, b) => a - b);

function images(set) {
  const out = [];
  for (let n = 0; n < 12; n += 1) {
    const t = sorted(set.map((p) => (p + n) % 12));
    const i = sorted(set.map((p) => (n - p + 12) % 12));
    out.push(t, i);
  }
  return out;
}

function equivalent(set, prime) {
  return images(set).some((image) => image.join(',') === prime.join(','));
}

function minimumSpan(set) {
  return Math.min(...images(set).map(span));
}

let subsets = 0;
for (let mask = 1; mask < 4096; mask += 1) {
  const pcs = [];
  for (let pc = 0; pc < 12; pc += 1) if (mask & (1 << pc)) pcs.push(pc);
  const text = pcs.join(' ');
  const result = analyze(text);
  const prime = list(result.primeForm);

  assert.ok(equivalent(pcs, prime), 'prime form is a transposition or inversion of ' + text);
  assert.equal(span(prime), minimumSpan(pcs), 'prime form has the smallest span for ' + text);
  assert.deepEqual(list(C.primeForm(prime)), prime, 'prime form is idempotent for ' + text);
  assert.deepEqual(list(result.intervalVector), list(C.intervalVector(prime)),
    'interval vector survives transposition for ' + text);
  assert.equal(span(list(result.normalOrder)), minimumSpan(pcs), 'normal order is the smallest span for ' + text);
  assert.deepEqual(sorted(list(result.normalOrder).map((value) => value % 12)), pcs,
    'normal order is a rotation for ' + text);

  const entry = byKey.get(prime.join(','));
  assert.ok(entry, 'prime form missing from the published table for ' + text);
  assert.equal(result.forte, entry.forte, 'Forte number for ' + text);

  // The complement and the set partition the twelve pitch classes.
  const complement = list(result.complement);
  assert.equal(complement.length, 12 - pcs.length, 'complement size for ' + text);
  assert.equal(new Set([...pcs, ...complement]).size, 12, 'complement is disjoint for ' + text);
  if (complement.length) {
    assert.deepEqual(list(result.complementPrimeForm), list(C.primeForm(complement)),
      'complement prime form for ' + text);
  } else {
    assert.equal(result.complementPrimeForm, null, 'a full aggregate has no complement class for ' + text);
  }

  // Symmetry lists are complete and each listed operation really maps the set onto itself.
  for (let n = 0; n < 12; n += 1) {
    const transposed = sorted(pcs.map((p) => (p + n) % 12)).join(',');
    const inverted = sorted(pcs.map((p) => (n - p + 12) % 12)).join(',');
    assert.equal(list(result.transpositions).includes(n), transposed === pcs.join(','),
      'transposition T' + n + ' for ' + text);
    assert.equal(list(result.inversions).includes(n), inverted === pcs.join(','),
      'inversion T' + n + 'I for ' + text);
  }
  subsets += 1;
}
assert.equal(subsets, 4095, 'every non-empty subset of the twelve pitch classes');

// ---- Parsing.
const defaultSet = analyze('C E G B\u266d');
assert.deepEqual(list(defaultSet.pitchClasses), [0, 4, 7, 10]);
assert.deepEqual(list(defaultSet.notes), ['C', 'E', 'G', 'B\u266d']);
assert.deepEqual(list(defaultSet.normalOrderClasses), [4, 7, 10, 0]);
assert.deepEqual(list(defaultSet.primeForm), [0, 2, 5, 8]);
assert.deepEqual(list(defaultSet.intervalVector), [0, 1, 2, 1, 1, 1]);
assert.deepEqual(list(defaultSet.transpositions), [0]);
assert.deepEqual(list(defaultSet.inversions), []);
assert.equal(defaultSet.cardinalityWord, 'four');

const dim = analyze('C E\u266d G\u266d A');
assert.deepEqual(list(dim.transpositions), [0, 3, 6, 9]);
assert.deepEqual(list(dim.inversions), [0, 3, 6, 9]);
assert.deepEqual(list(dim.complement), [1, 2, 4, 5, 7, 8, 10, 11]);

// Enharmonic spellings, numeric input, separators and duplicates.
assert.deepEqual(list(analyze('E\u266d D\u266f D\u266f').pitchClasses), [3]);
assert.deepEqual(list(analyze('C, 4; G/ B\u266d').pitchClasses), [0, 4, 7, 10]);
assert.deepEqual(list(analyze('C###').pitchClasses), [3]);
assert.deepEqual(list(analyze('B\u266d\u266d').pitchClasses), [9]);
assert.deepEqual(list(analyze('10').pitchClasses), [10]);
assert.equal(analyze('10').notes[0], 'A\u266f');
assert.deepEqual(list(analyze('F\u266f').pitchClasses), [6]);
assert.deepEqual(list(analyze('C C\u266f D D\u266f E F F\u266f G G\u266f A A\u266f B').pitchClasses),
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
assert.equal(analyze('C C\u266f D D\u266f E F F\u266f G G\u266f A A\u266f B').complement.length, 0);
assert.equal(analyze('C C\u266f D D\u266f E F F\u266f G G\u266f A A\u266f B').complementForte, '0-1');

// Refusals name the offending token and stay stable.
assert.equal(failure(''), 'Enter at least one note or pitch class.');
assert.equal(failure('   '), 'Enter at least one note or pitch class.');
assert.equal(failure(' , ; '), 'Enter at least one note or pitch class.');
assert.equal(failure('H'), 'Could not read "H". Use note names like C, F\u266f or E\u266d, or numbers from 0 to 11.');
assert.equal(failure('C E G X'), 'Could not read "X". Use note names like C, F\u266f or E\u266d, or numbers from 0 to 11.');
assert.equal(failure('1e3'), 'Could not read "1e3". Use note names like C, F\u266f or E\u266d, or numbers from 0 to 11.');
assert.equal(failure('12'), 'Pitch-class numbers run from 0 to 11; "12" is out of range.');
assert.equal(failure('123'), 'Pitch-class numbers run from 0 to 11; "123" is out of range.');
assert.equal(failure('\u266f'), 'Could not read "\u266f". Use note names like C, F\u266f or E\u266d, or numbers from 0 to 11.');

// ---- Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'Pitch-Class Set Analyzer');
assert.equal(entry.category, 'Music');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input.notes), testCase.expectedError, testCase.name);
    continue;
  }
  const result = analyze(testCase.input.notes);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (Array.isArray(value)) {
      assert.deepEqual(list(result[key]), value, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

// Every catalog golden and boundary case must belong to the published table too.
for (const testCase of entry.testCases) {
  if (testCase.expected) {
    assert.ok(byKey.has(testCase.expected.primeForm.join(',')), testCase.name + ' prime form is unpublished');
    assert.equal(byKey.get(testCase.expected.primeForm.join(',')).forte, testCase.expected.forte,
      testCase.name + ' Forte number disagrees with the table');
  }
}

// ---- The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(html.includes('<form id="pc-set-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('id="notes"'), 'notes control missing');
assert.ok(html.includes('value="C E G B\u266d"'), 'default notes missing from the markup');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
assert.ok(html.includes('@media (max-width:420px)'), 'result rows must stack on small screens');

console.log('pitch-class set analyzer: 223 published set classes, ' + subsets + ' subsets, '
  + entry.testCases.length + ' catalog cases and invariants passed');
