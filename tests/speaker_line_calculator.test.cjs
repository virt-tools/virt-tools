/* 70V speaker line calculator: the tap sum, impedance, current and headroom
   budget against independent formulas, the verdict boundaries, refusals, the
   catalog replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = '70v-speaker-line-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* speaker-line-core:start */';
const endMarker = '/* speaker-line-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SpeakerLineCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (counts, voltage, amp, headroom) => plain(C.calculate(counts, voltage, amp, headroom));
const failure = (counts, voltage, amp, headroom) => {
  try { run(counts, voltage, amp, headroom); } catch (error) { return error.message; }
  return null;
};
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const VOLTS = { '25': 25, '70.7': 70.7, '100': 100 };

// ---- Published constants and defaults.
assert.deepEqual(plain(C.TAPS), [0.5, 1, 2, 4, 8, 16, 32]);
assert.deepEqual(plain(C.LINES.map((line) => [line.key, line.volts])), [['70.7', 70.7], ['100', 100], ['25', 25]]);
assert.equal(C.MIN_AMP, 1);
assert.equal(C.MAX_AMP, 10000);
assert.equal(C.MIN_HEADROOM, 0);
assert.equal(C.MAX_HEADROOM, 50);
assert.equal(C.MAX_PER_TAP, 999);
assert.equal(C.DEFAULT_VOLTAGE, '70.7');
assert.equal(C.DEFAULT_AMP, '120');
assert.equal(C.DEFAULT_HEADROOM, '20');
assert.deepEqual(plain(C.DEFAULT_COUNTS), ['0', '0', '0', '8', '0', '0', '0']);
close(C.levelDb(2) - C.levelDb(1), 3.010299956639812, 1e-12, 'doubling a tap adds 3.01 dB');
close(C.levelDb(32) - C.levelDb(1), 15.05149978319906, 1e-9, '32 W is 15.05 dB above 1 W');
close(C.levelDb(0.5), -3.010299956639812, 1e-12, 'half a watt is 3.01 dB down');

// ---- Independent arithmetic over a deterministic sweep of tap sheets.
let sweep = 0;
for (let index = 0; index < 300; index += 1) {
  const keys = ['70.7', '100', '25'];
  const voltageKey = keys[index % keys.length];
  const amps = [10, 25, 60, 120, 240, 480];
  const heads = [0, 10, 20, 25, 33, 50];
  const ampWatts = amps[(index * 5 + 1) % amps.length];
  const headroom = heads[(index * 7 + 2) % heads.length];
  const counts = C.TAPS.map((tap, tapIndex) => String((index * (tapIndex + 3) + tapIndex * index) % 7));
  if (counts.every((count) => count === '0')) counts[3] = '1';
  const result = run(counts, voltageKey, ampWatts, headroom);
  const numbers = counts.map(Number);
  const total = numbers.reduce((sum, count, tapIndex) => sum + count * C.TAPS[tapIndex], 0);
  const speakers = numbers.reduce((sum, count) => sum + count, 0);
  const volts = VOLTS[voltageKey];
  const budget = ampWatts * (1 - headroom / 100);
  const impedance = (volts * volts) / total;
  const current = total / volts;
  close(result.totalWatts, total, 0, 'total tap load at ' + index);
  assert.equal(result.speakerCount, speakers, 'speaker count at ' + index);
  close(result.budgetWatts, budget, 1e-12 * Math.max(1, budget), 'budget at ' + index);
  close(result.impedance, impedance, 1e-9 * impedance, 'impedance at ' + index);
  close(result.current, current, 1e-12 * current, 'current at ' + index);
  close(result.utilisationPercent, (total / ampWatts) * 100, 1e-9, 'utilisation at ' + index);
  close(result.smallestAmpWatts, total / (1 - headroom / 100), 1e-9 * total, 'smallest amplifier at ' + index);
  close(result.spareWatts, budget - total, 1e-9, 'spare capacity at ' + index);
  const expectedVerdict = total > ampWatts ? 'over-rating'
    : (total > budget ? 'over-budget' : 'within');
  assert.equal(result.verdict, expectedVerdict, 'verdict at ' + index);
  // The tap rows carry the same distribution, in ascending tap order.
  assert.equal(result.taps.length, numbers.filter((count) => count > 0).length, 'active tap rows at ' + index);
  result.taps.forEach((row, rowIndex) => {
    const tapIndex = C.TAPS.indexOf(row.tapWatts);
    assert.ok(tapIndex >= 0, 'a known tap at ' + index);
    assert.equal(row.count, numbers[tapIndex], 'row count at ' + index);
    close(row.subtotalWatts, numbers[tapIndex] * row.tapWatts, 0, 'row subtotal at ' + index);
    close(row.levelDb, 10 * Math.log10(row.tapWatts), 1e-12, 'row level at ' + index);
    if (rowIndex > 0) assert.ok(row.tapWatts > result.taps[rowIndex - 1].tapWatts, 'rows ascend');
  });
  assert.equal(result.headline, 'Line load ' + result.totalText, 'headline at ' + index);
  assert.ok(result.summary.startsWith(speakers + (speakers === 1 ? ' speaker ' : ' speakers ')), 'summary names the speakers');
  sweep += 1;
}

// ---- The two published identities, checked directly.
close(C.compute(100, 70.7, 120, 20).impedance, 4998.49 / 100, 1e-12, '70.7 V line is 4998.49 ohms per 100 W');
close(C.compute(24, 100, 120, 20).impedance, 10000 / 24, 1e-9, '100 V line is 10000 ohms per 100 W');
close(C.compute(18, 25, 40, 20).impedance, 625 / 18, 1e-12, '25 V line is 625 ohms per 100 W');
close(C.compute(48, 70.7, 120, 20).current, 48 / 70.7, 1e-15, 'current is power over voltage');
close(C.compute(100, 70.7, 120, 20).impedance * C.compute(100, 70.7, 120, 20).current, 70.7, 1e-12,
  'impedance times current is the line voltage');
close(C.compute(100, 70.7, 120, 20).current * 70.7, 100, 1e-12, 'V I equals the load');

// ---- Boundaries: the budget and the rating are inclusive, one step past is not.
const atBudget = run(['0', '0', '0', '0', '6', '0', '0'], '70.7', '60', '20');
assert.equal(atBudget.totalWatts, 48);
assert.equal(atBudget.budgetWatts, 48);
assert.equal(atBudget.verdict, 'within', 'a load exactly at the budget fits');
assert.equal(atBudget.spareWatts, 0);
const justOverBudget = run(['1', '0', '0', '2', '0', '0', '0'], '100', '10', '20');
close(justOverBudget.totalWatts, 8.5, 0, 'eight and a half watts');
close(justOverBudget.budgetWatts, 8, 0, 'eight watt budget');
assert.equal(justOverBudget.verdict, 'over-budget', 'half a watt over is over');
const atRating = run(['0', '0', '0', '0', '6', '0', '0'], '70.7', '48', '0');
assert.equal(atRating.verdict, 'within', 'a load exactly at the rating with no headroom fits');
assert.equal(atRating.budgetUsePercent, 100);
const overRating = run(['0', '0', '0', '0', '6', '0', '0'], '70.7', '40', '0');
assert.equal(overRating.verdict, 'over-rating', 'above the rating is over-rating');
close(overRating.totalWatts - overRating.ampWatts, 8, 0, 'eight watts over the rating');
const overBudgetOnly = run(['0', '0', '0', '0', '11', '0', '0'], '70.7', '100', '20');
assert.equal(overBudgetOnly.verdict, 'over-budget', 'inside the rating but past the budget');
assert.ok(overBudgetOnly.verdictText.includes('Inside the 100.00 W rating'), 'the verdict says it is inside the rating');
assert.ok(overBudgetOnly.verdictText.includes('over the 80.00 W budget'), 'the verdict names the budget');
assert.ok(overRating.verdictText.startsWith('Over the 40.00 W amplifier rating by 8.00 W'), 'the rating verdict names the excess');

// ---- Formatting.
assert.equal(C.formatWatts(0.5), '0.50 W');
assert.equal(C.formatWatts(32), '32.00 W');
assert.equal(C.formatWatts(1250), '1.25 kW');
assert.equal(C.formatOhms(20), '20.00 \u03a9');
assert.equal(C.formatOhms(156.2028125), '156.20 \u03a9');
assert.equal(C.formatOhms(20000), '20.00 k\u03a9');
assert.equal(C.formatOhms(999.994), '999.99 \u03a9');
assert.equal(C.formatOhms(1000), '1.00 k\u03a9');
assert.equal(C.formatCurrent(0.4526166902404526), '453 mA');
assert.equal(C.formatCurrent(0.005), '5 mA');
assert.equal(C.formatCurrent(0.48), '480 mA');
assert.equal(C.formatCurrent(1.2446958981612446), '1.24 A');
assert.equal(C.formatPercent(26.666666666666668), '26.67%');
assert.equal(C.formatPercent(100), '100.00%');
assert.equal(C.formatDb(6.020599913279624), '+6.02 dB');
assert.equal(C.formatDb(0), '0.00 dB');
assert.equal(C.formatDb(-3.010299956639812), '-3.01 dB');

// ---- Refusals, with the exact wording the page shows.
for (const [label, args, message] of [
  ['no speakers', [['0', '0', '0', '0', '0', '0', '0'], '70.7', '120', '20'],
    'Add at least one speaker on a tap, such as eight on the 4 W tap.'],
  ['empty amp', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '', '20'],
    "Enter the amplifier's rated power, such as 120."],
  ['spaced amp', [['0', '0', '0', '8', '0', '0', '0'], '70.7', ' 120 ', '20'], null],
  ['exponent amp', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '1e3', '20'],
    "Enter the amplifier's rated power as a number, such as 120."],
  ['comma amp', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '1,2', '20'],
    "Enter the amplifier's rated power as a number, such as 120."],
  ['zero amp', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '0', '20'],
    'Amplifier power must be between 1 and 10000 watts.'],
  ['amp over the limit', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '10001', '20'],
    'Amplifier power must be between 1 and 10000 watts.'],
  ['empty headroom', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '120', ''],
    'Enter the headroom allowance, such as 20.'],
  ['negative headroom', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '120', '-5'],
    'Enter the headroom allowance as a number, such as 20.'],
  ['headroom over fifty', [['0', '0', '0', '8', '0', '0', '0'], '70.7', '120', '51'],
    'Headroom must be between 0 and 50 percent.'],
  ['fractional count', [['0', '0', '0', '2.5', '0', '0', '0'], '70.7', '120', '20'],
    'Enter the number of speakers on the 4 W tap as a whole number.'],
  ['word count', [['0', '0', '0', 'eight', '0', '0', '0'], '70.7', '120', '20'],
    'Enter the number of speakers on the 4 W tap as a whole number.'],
  ['negative count', [['0', '0', '0', '-1', '0', '0', '0'], '70.7', '120', '20'],
    'Enter the number of speakers on the 4 W tap as a whole number.'],
  ['count over the limit', [['0', '0', '0', '1000', '0', '0', '0'], '70.7', '120', '20'],
    'At most 999 speakers can sit on one tap.'],
  ['unknown voltage', [['0', '0', '0', '8', '0', '0', '0'], '50', '120', '20'],
    'Choose a 25 V, 70.7 V or 100 V line.'],
  ['not an array', ['0', '70.7', '120', '20'], 'Give one speaker count for each of the seven taps.'],
  ['too few counts', [['0', '0', '0', '8', '0', '0'], '70.7', '120', '20'],
    'Give one speaker count for each of the seven taps.'],
]) {
  if (message === null) {
    assert.equal(failure(...args), null, label);
    continue;
  }
  assert.equal(failure(...args), message, label);
}

// ---- compute refuses non-positive values even when called directly.
for (const args of [[0, 70.7, 120, 20], [32, 0, 120, 20], [32, 70.7, 0, 20], [32, 70.7, 120, -1]]) {
  assert.throws(() => C.compute(...args), /must be positive/, 'direct compute refuses ' + args.join(','));
}

// ---- Determinism and the calculate/compute pair.
for (const args of [
  [['0', '0', '0', '8', '0', '0', '0'], '70.7', '120', '20'],
  [['1', '0', '0', '2', '0', '0', '0'], '100', '10', '20'],
  [['999', '0', '0', '0', '0', '0', '0'], '25', '600', '10']
]) {
  const once = run(...args);
  const twice = run(...args);
  assert.deepEqual(once, twice, 'deterministic');
  const direct = plain(C.compute(once.totalWatts, VOLTS[args[1]], Number(args[2]), Number(args[3])));
  for (const key of Object.keys(direct)) assert.deepEqual(once[key], direct[key], 'calculate matches compute: ' + key);
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, '70V Speaker Line Calculator');
assert.equal(record.category, 'Audio');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-22T05:30:00Z');
assert.ok(record.description.length > 100, 'description is descriptive');
assert.ok(record.method.includes('Z = V squared / P'), 'method states the impedance relation');
assert.ok(record.method.includes('I = P / V'), 'method states the current relation');
assert.ok(record.method.includes('5,000 / P'), 'method names the 70.7 V rule of thumb');
assert.ok(record.method.includes('3.01 dB'), 'method states the tap level step');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 2, 'two references are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 10),
  'both references are titled');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'both references carry a fetched URL');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 28, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 13, 'thirteen validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  const input = testCase.input;
  const args = [input.counts, input.voltage, input.amp, input.headroom];
  if (testCase.kind === 'validation') {
    assert.equal(failure(...args), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(...args);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') {
      const tolerance = key === 'impedance' || key === 'current'
        ? 1e-6 * Math.max(1e-9, Math.abs(expected))
        : 1e-6 * Math.max(1, Math.abs(expected));
      close(actual[key], expected, tolerance, testCase.name + ' ' + key);
      checked += 1;
    } else {
      assert.equal(actual[key], expected, testCase.name + ' ' + key);
      checked += 1;
    }
  }
  assert.ok(actual.headline.startsWith('Line load '), testCase.name + ' headline');
  assert.ok(actual.summary.includes(actual.impedanceText), testCase.name + ' summary names the impedance');
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
for (const tag of ['audio', '70v', 'constant-voltage', 'distributed-audio', 'speaker-taps', 'amplifier-loading']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2511, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2250, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Audio').length, 57, 'audio records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 18, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of ['voltage', 'amp', 'headroom', 'tap-05', 'tap-1', 'tap-2', 'tap-4', 'tap-8', 'tap-16', 'tap-32']) {
  assert.ok(new RegExp('<label for="' + field + '">').test(html), 'the ' + field + ' field has a label');
}
assert.ok(/<option value="70\.7" selected>/.test(html), '70.7 V is the default line');
assert.ok(/<option value="100">/.test(html) && /<option value="25">/.test(html), 'the other lines are offered');
assert.ok(/id="amp"[^>]*value="120"/.test(html), 'the amplifier default is in the markup');
assert.ok(/id="headroom"[^>]*value="20"/.test(html), 'the headroom default is in the markup');
assert.ok(/id="tap-4"[^>]*value="8"/.test(html), 'the tap default is in the markup');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<caption>/.test(html) && /<th scope="col">/.test(html), 'the tables are described');
assert.ok(/<th scope="row">/.test(html), 'the detail rows are headed');
assert.equal((html.match(/<th scope="col">/g) || []).length, 6, 'two detail and four tap columns');
assert.equal((html.match(/<select\b/g) || []).length, 1, 'one line selector');
assert.equal((html.match(/type="text"/g) || []).length, 9, 'nine numeric fields');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/min-height:46px/.test(html), 'the inputs keep a comfortable height');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="decimal"/.test(html) && /inputmode="numeric"/.test(html), 'numeric keyboards are offered on touch');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the layout has a narrow breakpoint');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('70v speaker line calculator: ' + sweep + ' independent sweeps, ' + checked
  + ' replayed catalog values, 17 refusals and the page contract pass');
