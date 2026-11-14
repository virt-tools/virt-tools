/* Mid/side stereo width calculator: mid and side algebra, width identities,
   golden results, formatting, range refusals, the width sweep, catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'stereo-width-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* stereo-width-core:start */';
const endMarker = '/* stereo-width-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = StereoWidthCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (left, right, width) => plain(C.calculate(left, right, width));
const failure = (left, right, width) => {
  try { run(left, right, width); } catch (error) { return error.message; }
  return null;
};
const amp = (db) => Math.pow(10, db / 20);
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};

// ---- Exported constants.
assert.equal(C.MIN_LEVEL_DB, -120);
assert.equal(C.MAX_LEVEL_DB, 0);
assert.equal(C.MIN_WIDTH, 0);
assert.equal(C.MAX_WIDTH, 200);
assert.deepEqual(plain(C.SWEEP_WIDTHS), [0, 50, 100, 150, 200]);
assert.equal(C.DEFAULT_LEFT, '-12');
assert.equal(C.DEFAULT_RIGHT, '-9');
assert.equal(C.DEFAULT_WIDTH, '150');

// ---- Level and formatting helpers.
close(C.amplitude(0), 1, 1e-15, 'zero dBFS is full scale');
close(C.amplitude(-6), 0.5011872336272722, 1e-15, 'minus six dBFS');
close(C.amplitude(-120), 1e-6, 1e-20, 'the floor is one millionth');
close(C.gainDb(2), 6.020599913279624, 1e-12, 'doubling is about six dB');
assert.equal(C.gainDb(0), -Infinity, 'a zero ratio has no finite level');
assert.equal(C.formatLevel(-8.393), '-8.39 dBFS');
assert.equal(C.formatLevel(0), '0.00 dBFS');
assert.equal(C.formatLevel(-Infinity), 'silent');
assert.equal(C.formatDelta(0), '0.00 dB');
assert.equal(C.formatDelta(1.234), '+1.23 dB');
assert.equal(C.formatDelta(-2.5), '-2.50 dB');
assert.equal(C.formatDelta(-0.004), '0.00 dB', 'a negative zero never prints');
assert.equal(C.formatDelta(Infinity), 'silent');
assert.equal(C.formatPercent(0), '0%');
assert.equal(C.formatPercent(50), '50%');
assert.equal(C.formatPercent(12.5), '12.50%');
assert.equal(C.formatPercent(150), '150%');
assert.equal(C.formatPercent(200), '200%');

// ---- Mid and side algebra: the widths that must leave the pair alone.
const untouched = run('-12', '-9', '100');
close(untouched.mid, (amp(-12) + amp(-9)) / 2, 1e-15, 'mid is half the sum');
close(untouched.side, (amp(-12) - amp(-9)) / 2, 1e-15, 'side is half the difference');
close(untouched.outLeft, amp(-12), 1e-15, 'one hundred percent returns the left channel');
close(untouched.outRight, amp(-9), 1e-15, 'one hundred percent returns the right channel');
assert.equal(untouched.deltaLeftText, '0.00 dB');
assert.equal(untouched.deltaRightText, '0.00 dB');

const mono = run('-12', '-9', '0');
close(mono.outLeft, mono.mid, 1e-15, 'zero width is the mid signal');
close(mono.outRight, mono.mid, 1e-15, 'zero width is the mid signal on the right');
assert.equal(mono.outLeftText, mono.outRightText, 'both outputs read the same at zero width');

const doubled = run('-6', '-12', '200');
close(doubled.outLeft, (amp(-6) + amp(-12)) / 2 + 2 * ((amp(-6) - amp(-12)) / 2), 1e-15, 'double side gain');

// Equal channels carry no side signal, so no width can change them.
for (const width of ['0', '50', '100', '150', '200']) {
  const equal = run('-6', '-6', width);
  assert.equal(equal.outLeftText, '-6.00 dBFS', 'equal channels at ' + width + ' percent');
  assert.equal(equal.outRightText, '-6.00 dBFS', 'equal channels at ' + width + ' percent');
  assert.equal(equal.sideText, 'silent');
  assert.equal(equal.sideRatioText, '-inf dB');
}

// The mono fold-down is the mid signal at every width.
const foldLevels = ['0', '25', '50', '100', '150', '200'].map((width) => run('-12', '-9', width).monoDb);
for (const level of foldLevels) close(level, foldLevels[0], 1e-15, 'mono level is width independent');

// ---- Exact golden results, each worked out from the mid and side formulas.
const REFERENCE = [
  { left: '-12', right: '-9', width: '150', peakText: '-8.39 dBFS', outLeftText: '-12.95 dBFS',
    outRightText: '-8.39 dBFS', monoText: '-10.37 dBFS', sideText: '-25.71 dBFS',
    sideRatioText: '-15.34 dB', headroomText: '8.39 dB', deltaLeftText: '-0.95 dB',
    deltaRightText: '+0.61 dB', clipping: false, leftInverted: false, rightInverted: false },
  { left: '-12', right: '-9', width: '100', peakText: '-9.00 dBFS', outLeftText: '-12.00 dBFS',
    outRightText: '-9.00 dBFS', monoText: '-10.37 dBFS', headroomText: '9.00 dB' },
  { left: '-12', right: '-9', width: '0', peakText: '-10.37 dBFS', outLeftText: '-10.37 dBFS',
    outRightText: '-10.37 dBFS', deltaLeftText: '+1.63 dB', deltaRightText: '-1.37 dB' },
  { left: '-6', right: '-12', width: '200', peakText: '-4.07 dBFS', outLeftText: '-4.07 dBFS',
    outRightText: '-17.98 dBFS', monoText: '-8.49 dBFS', sideText: '-18.06 dBFS',
    deltaLeftText: '+1.93 dB', deltaRightText: '-5.98 dB', clipping: false },
  { left: '-6', right: '-6', width: '150', peakText: '-6.00 dBFS', outLeftText: '-6.00 dBFS',
    outRightText: '-6.00 dBFS', monoText: '-6.00 dBFS', sideText: 'silent',
    sideRatioText: '-inf dB', headroomText: '6.00 dB' },
  { left: '0', right: '-40', width: '200', peakText: '3.49 dBFS', outLeftText: '3.49 dBFS',
    outRightText: '-6.29 dBFS', monoText: '-5.93 dBFS', sideText: '-6.11 dBFS',
    sideRatioText: '-0.17 dB', headroomText: '-3.49 dB', deltaLeftText: '+3.49 dB',
    deltaRightText: '+33.71 dB', clipping: true, leftInverted: false, rightInverted: true },
  { left: '-120', right: '-120', width: '100', peakText: '-120.00 dBFS', outLeftText: '-120.00 dBFS',
    outRightText: '-120.00 dBFS', monoText: '-120.00 dBFS', headroomText: '120.00 dB' },
  { left: '-120', right: '0', width: '100', peakText: '0.00 dBFS', outLeftText: '-120.00 dBFS',
    outRightText: '0.00 dBFS', monoText: '-6.02 dBFS', sideText: '-6.02 dBFS',
    sideRatioText: '0.00 dB', headroomText: '0.00 dB', clipping: false }
];
for (const reference of REFERENCE) {
  const result = run(reference.left, reference.right, reference.width);
  for (const [key, expected] of Object.entries(reference)) {
    if (key === 'left' || key === 'right' || key === 'width') continue;
    assert.deepEqual(result[key], expected, reference.left + '/' + reference.right + ' at ' + reference.width + ' percent: ' + key);
  }
}

// The trim offered for an over-full-scale peak is the amount above zero.
close(run('0', '-40', '200').trimDb, 20 * Math.log10(1.495), 1e-12, 'trim matches the overshoot');
assert.equal(run('-6', '-12', '200').trimDb, 0, 'no trim is offered without clipping');

// ---- Parsing: plain decimals only, ranges enforced with the exact message.
assert.equal(run(' -12 ', '-9', '150').leftDb, -12, 'surrounding whitespace is trimmed');
assert.equal(run('-12', '-9', '.5').widthPercent, 0.5, 'a leading decimal point is accepted');
assert.equal(run('0', '-9', '12.5').widthPercent, 12.5, 'a fractional width is accepted');
assert.equal(failure('', '-9', '100'), 'Enter the left channel level in dBFS, such as -12.');
assert.equal(failure(null, '-9', '100'), 'Enter the left channel level in dBFS, such as -12.');
assert.equal(failure('-12', '', '100'), 'Enter the right channel level in dBFS, such as -12.');
assert.equal(failure('-12', undefined, '100'), 'Enter the right channel level in dBFS, such as -12.');
assert.equal(failure('-12', '-9', ''), 'Enter a width percentage, such as 100.');
assert.equal(failure('-12', '-9', null), 'Enter a width percentage, such as 100.');
assert.equal(failure('abc', '-9', '100'), 'Enter the left channel level as a number in dBFS, such as -12.');
assert.equal(failure('-12', 'loud', '100'), 'Enter the right channel level as a number in dBFS, such as -12.');
assert.equal(failure('-12', '-9', 'wide'), 'Enter the width as a percentage, such as 100.');
assert.equal(failure('1e3', '-9', '100'), 'Enter the left channel level as a number in dBFS, such as -12.');
assert.equal(failure('12 dB', '-9', '100'), 'Enter the left channel level as a number in dBFS, such as -12.');
assert.equal(failure('-121', '-9', '100'), 'Channel levels must be between -120 and 0 dBFS.');
assert.equal(failure('-12', '0.5', '100'), 'Channel levels must be between -120 and 0 dBFS.');
assert.equal(failure('-12', '-9', '-1'), 'Width must be between 0 and 200 percent.');
assert.equal(failure('-12', '-9', '200.5'), 'Width must be between 0 and 200 percent.');
assert.equal(run('-120', '-9', '0').widthPercent, 0, 'the width floor is allowed');
assert.equal(run('-12', '-9', '200').widthPercent, 200, 'the width ceiling is allowed');

// ---- The width sweep uses the same algebra and never moves the mono fold-down.
const sweep = plain(C.sweep(-12, -9));
assert.equal(sweep.length, 5);
assert.deepEqual(sweep.map((row) => row.widthPercent), [0, 50, 100, 150, 200]);
assert.deepEqual(sweep.map((row) => row.widthText), ['0%', '50%', '100%', '150%', '200%']);
for (const row of sweep) {
  const again = run('-12', '-9', String(row.widthPercent));
  assert.equal(row.outLeftText, again.outLeftText, 'sweep left at ' + row.widthText);
  assert.equal(row.outRightText, again.outRightText, 'sweep right at ' + row.widthText);
  assert.equal(row.peakText, again.peakText, 'sweep peak at ' + row.widthText);
  assert.equal(row.monoText, again.monoText, 'sweep mono at ' + row.widthText);
}
assert.deepEqual(sweep.map((row) => row.peakText),
  ['-10.37 dBFS', '-9.66 dBFS', '-9.00 dBFS', '-8.39 dBFS', '-7.82 dBFS']);
assert.equal(new Set(sweep.map((row) => row.monoText)).size, 1, 'mono is flat across the sweep');

// ---- Random cases: the linear identities hold exactly.
let seed = 20261114;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let iteration = 0; iteration < 240; iteration += 1) {
  const leftDb = Number((-1 * random() * 119).toFixed(2));
  const rightDb = Number((-1 * random() * 119).toFixed(2));
  const widthPercent = Number((random() * 200).toFixed(1));
  const label = 'random ' + leftDb + '/' + rightDb + ' at ' + widthPercent + ' percent';
  const result = run(String(leftDb), String(rightDb), String(widthPercent));
  const left = amp(leftDb);
  const right = amp(rightDb);
  const mid = (left + right) / 2;
  const side = (left - right) / 2;

  close(result.mid, mid, 1e-15, label + ' mid');
  close(result.side, side, 1e-15, label + ' side');
  close(result.outLeft, mid + result.width * side, 1e-15, label + ' left output');
  close(result.outRight, mid - result.width * side, 1e-15, label + ' right output');
  close(result.outLeft + result.outRight, 2 * mid, 1e-15, label + ' fold-down identity');
  close(result.peak, Math.max(Math.abs(result.outLeft), Math.abs(result.outRight)), 1e-15, label + ' peak');
  assert.equal(result.clipping, result.peak > 1, label + ' clipping flag');
  assert.equal(result.leftInverted, result.outLeft < 0, label + ' left polarity');
  assert.equal(result.rightInverted, result.outRight < 0, label + ' right polarity');
  close(result.midDb, 20 * Math.log10(mid), 1e-12, label + ' mid level');
  close(result.deltaLeftDb, 20 * Math.log10(Math.abs(result.outLeft) / left), 1e-12, label + ' left delta');
  assert.match(result.peakText, /^-?\d+\.\d\d dBFS$/, label + ' peak text');
  assert.match(result.headroomText, /^-?\d+\.\d\d dB$/, label + ' headroom text');
  assert.deepEqual(run(String(leftDb), String(rightDb), String(widthPercent)), result, label + ' deterministic');

  const untouchedCase = run(String(leftDb), String(rightDb), '100');
  close(untouchedCase.outLeft, left, 1e-15, label + ' unchanged at one hundred percent');
  close(untouchedCase.outRight, right, 1e-15, label + ' unchanged at one hundred percent');
  close(run(String(leftDb), String(rightDb), '0').monoDb, result.monoDb, 1e-12, label + ' mono is width independent');
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2271, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Mid/Side Stereo Width Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Mixing');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f39a}');
assert.equal(record.reviewedAt, null);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('10^(dB/20)'), 'method states the level conversion');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are cited');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 12, 'catalog case count');
assert.equal(kinds('golden'), 6, 'six golden cases');
assert.equal(kinds('boundary'), 2, 'two boundary cases');
assert.equal(kinds('validation'), 4, 'four validation cases');
for (const testCase of record.testCases) {
  const { left, right, width } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(left, right, width), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(left, right, width);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ' ' + key);
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
for (const tag of ['audio', 'stereo', 'mid-side', 'width', 'mixing', 'mastering', 'gain-staging']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 9, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label for="left">/.test(html) && /<label for="right">/.test(html), 'both channel fields have labels');
assert.ok(/<label for="width">/.test(html), 'the width field has a label');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the tables are described');
assert.ok(/<th scope="row">/.test(html), 'detail rows are headed');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html), 'a numeric keyboard is offered on touch');
assert.equal((html.match(/type="text"/g) || []).length, 3, 'three text inputs');
assert.ok(/value="-12"/.test(html) && /value="-9"/.test(html) && /value="150"/.test(html), 'the defaults are in the markup');
assert.equal((html.match(/<th scope="col">/g) || []).length, 6, 'two detail columns and four sweep columns');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('stereo width calculator: mid/side algebra, 8 golden results, 240 random cases, the width sweep, 12 catalog cases and the page contract pass');
