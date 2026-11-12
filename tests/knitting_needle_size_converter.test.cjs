/* Regression checks for the knitting needle and crochet hook size converter. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'knitting-needle-size-converter';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* needle-core:start */');
const end = html.indexOf('/* needle-core:end */');
assert.ok(start > -1 && end > start, 'needle core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* needle-core:end */'.length) + '\nmodule.exports = NeedleSizes;', sandbox);
const N = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'General');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F9F6}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 400, 'method documented');
assert.equal(catalog.tools.length, 2225, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');

const failure = (input) => {
  try {
    N.convert(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const convert = (input) => N.convert(input);

// --- Published anchors, one per system and per size range. ---
const anchors = [
  [{ system: 'us-knitting', size: '0' }, 2, '0', '14'],
  [{ system: 'us-knitting', size: '1' }, 2.25, '1', '13'],
  [{ system: 'us-knitting', size: '2' }, 2.75, '2', '12'],
  [{ system: 'us-knitting', size: '6' }, 4, '6', '8'],
  [{ system: 'us-knitting', size: '7' }, 4.5, '7', '7'],
  [{ system: 'us-knitting', size: '8' }, 5, '8', '6'],
  [{ system: 'us-knitting', size: '10' }, 6, '10', '4'],
  [{ system: 'us-knitting', size: '10\u00bd' }, 6.5, '10\u00bd', '3'],
  [{ system: 'us-knitting', size: '11' }, 8, '11', '0'],
  [{ system: 'us-knitting', size: '13' }, 9, '13', '00'],
  [{ system: 'us-knitting', size: '15' }, 10, '15', '000'],
  [{ system: 'us-knitting', size: '17' }, 12, '17', null],
  [{ system: 'us-knitting', size: '19' }, 16, '19', null],
  [{ system: 'us-knitting', size: '35' }, 19, '35', null],
  [{ system: 'us-knitting', size: '50' }, 25, '50', null],
  [{ system: 'uk-knitting', size: '14' }, 2, '0', '14'],
  [{ system: 'uk-knitting', size: '00' }, 9, '13', '00'],
  [{ system: 'us-crochet', size: 'H/8' }, 5, '8', '6'],
  [{ system: 'us-crochet', size: '7' }, 4.5, '7', '7'],
  [{ system: 'metric', size: '3' }, 3, null, '11']
];
for (const [input, mm, us, uk] of anchors) {
  const result = convert(input);
  assert.equal(result.mm, mm, `${JSON.stringify(input)}: diameter`);
  assert.equal(result.usKnitting, us, `${JSON.stringify(input)}: US number`);
  assert.equal(result.ukKnitting, uk, `${JSON.stringify(input)}: old UK number`);
  assert.equal(result.exact, true, `${JSON.stringify(input)}: exact`);
}
const hookAnchors = [['B/1', 2.25], ['C/2', 2.75], ['G/6', 4], ['H/8', 5], ['J/10', 6],
  ['K/10\u00bd', 6.5], ['L/11', 8], ['M/13', 9], ['N/15', 10]];
for (const [label, mm] of hookAnchors) {
  const result = convert({ system: 'us-crochet', size: label });
  assert.equal(result.mm, mm, `hook ${label}: diameter`);
  assert.equal(result.usCrochet, label, `hook ${label}: canonical label`);
}

// --- Table invariants: the three systems must move in the right directions. ---
let previousMm = 0;
let previousUs = -1;
let previousUk = Infinity;
for (const row of N.KNITTING) {
  assert.ok(row.mm > previousMm, `diameters ascend at ${row.mm} mm`);
  previousMm = row.mm;
  if (row.us !== null) {
    const value = Number(String(row.us).replace('\u00bd', '.5'));
    assert.ok(value > previousUs, `US numbers ascend at ${row.us}`);
    previousUs = value;
  }
  if (row.uk !== null) {
    const value = /^0+$/.test(row.uk) ? -row.uk.length : Number(row.uk);
    assert.ok(value < previousUk, `old UK numbers descend at ${row.uk}`);
    previousUk = value;
  }
}
assert.equal(N.KNITTING[0].mm, 2, 'table starts at 2 mm');
assert.equal(N.KNITTING[N.KNITTING.length - 1].mm, 25, 'table ends at 25 mm');

let previousHookMm = 0;
for (const hook of N.CROCHET) {
  assert.ok(hook.mm > previousHookMm, `hook diameters ascend at ${hook.label}`);
  previousHookMm = hook.mm;
  assert.ok(N.KNITTING.some((row) => row.mm === hook.mm), `hook ${hook.label} shares a needle diameter`);
}

// --- Round trips: every row resolves back to its own diameter from every system. ---
let roundTrips = 0;
for (const row of N.KNITTING) {
  const metric = convert({ system: 'metric', size: String(row.mm) });
  assert.equal(metric.mm, row.mm, `${row.mm} mm from metric`);
  roundTrips += 1;
  if (row.us !== null) {
    assert.equal(convert({ system: 'us-knitting', size: row.us }).mm, row.mm, `US ${row.us}`);
    roundTrips += 1;
  }
  if (row.uk !== null) {
    assert.equal(convert({ system: 'uk-knitting', size: row.uk }).mm, row.mm, `old UK ${row.uk}`);
    roundTrips += 1;
  }
}
for (const hook of N.CROCHET) {
  const result = convert({ system: 'us-crochet', size: hook.label });
  assert.equal(result.mm, hook.mm, `hook ${hook.label}`);
  assert.equal(result.size, hook.label, `hook ${hook.label} canonical label`);
  roundTrips += 1;
}

// --- Nearest sizes: every diameter between two rows reports both neighbours. ---
let gapsChecked = 0;
for (let index = 1; index < N.KNITTING.length; index += 1) {
  const lower = N.KNITTING[index - 1];
  const upper = N.KNITTING[index];
  const gap = Math.round((upper.mm - lower.mm) * 100) / 100;
  for (const fraction of [0.25, 0.5, 0.75]) {
    const probe = Math.round((lower.mm + gap * fraction) * 100) / 100;
    const result = convert({ system: 'metric', size: String(probe) });
    assert.equal(result.exact, false, `${probe} mm is not a standard size`);
    assert.equal(result.mm, null, `${probe} mm reports no diameter`);
    assert.equal(result.belowMm, lower.mm, `${probe} mm: nearest below`);
    assert.equal(result.aboveMm, upper.mm, `${probe} mm: nearest above`);
    assert.ok(Math.abs(result.belowDelta + result.aboveDelta - gap) < 1e-9, `${probe} mm: gaps sum to the gap`);
    assert.ok(result.belowText.includes(String(lower.mm) + ' mm') &&
      result.aboveText.includes(String(upper.mm) + ' mm'), `${probe} mm: neighbour text`);
    gapsChecked += 1;
  }
}

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = convert(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Extra vectors for the parser, not covered by the catalog cases. ---
assert.equal(convert({ system: 'us-crochet', size: 'k' }).mm, 6.5, 'lowercase hook letter');
assert.equal(convert({ system: 'us-crochet', size: 'h-8' }).mm, 5, 'hyphenated hook label');
assert.equal(convert({ system: 'us-crochet', size: 'M/N/13' }).mm, 9, 'M/N/13 alias');
assert.equal(convert({ system: 'us-crochet', size: '10' }).mm, 6, 'bare hook number');
assert.equal(convert({ system: 'uk-knitting', size: '000' }).mm, 10, 'UK 000');
assert.equal(convert({ system: 'uk-knitting', size: '0' }).mm, 8, 'UK 0');
assert.equal(convert({ system: 'us-knitting', size: ' 8 ' }).mm, 5, 'padded US size');
assert.equal(convert({ system: 'metric', size: '5.0' }).mm, 5, 'trailing zero metric size');
assert.equal(failure({ system: 'metric', size: '2.5mm' }), 'Metric size must be a number from 2 to 25 mm.', 'unit suffix refused');
assert.equal(convert({ system: 'us-knitting', size: '1\u00bd' }).mm, 2.5, 'US 1\u00bd is 2.5 mm');

// --- Page contract. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
assert.ok(html.includes('[hidden]{display:none!important}'), 'hidden panels stay hidden');
assert.ok(/min-height:44px/.test(html), 'tap targets');
for (const id of ['system', 'size', 'convert', 'ns-status', 'headline-out', 'mm-out', 'us-knitting-out',
  'uk-knitting-out', 'us-crochet-out', 'below-row', 'above-row', 'below-out', 'above-out', 'copy', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<form id="ns-form" novalidate>/.test(html), 'form contract');
assert.ok(/<button id="convert" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<option value="us-knitting" selected>/.test(html), 'default system selected in markup');
assert.ok(/id="size"[^>]*value="8"/.test(html), 'default size in markup');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html), 'no external requests in the page');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${anchors.length} published anchors, ${roundTrips} round trips and ${gapsChecked} gap probes checked`);
