/* Draft beer line length: the published table 4.1 resistances, the balance
   arithmetic, input parsing, refusals, catalog replay, uniqueness and the page
   contract. The resistance column is transcribed from the Brewers Association
   Draught Beer Quality Manual, fourth edition, table 4.1 and cross-checked
   against Micro Matic's published tubing restrictions, so a typo in the page
   data or a changed static-resistance constant fails here. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'draft-beer-line-length-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* draft-beer-line-core:start */';
const endMarker = '/* draft-beer-line-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = DraftBeerLineCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (pressure, rise, other, line) => plain(C.balance(pressure, rise, other, line));
const failure = (pressure, rise, other, line) => {
  try { run(pressure, rise, other, line); } catch (error) { return error.message; }
  return null;
};
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);

// ---- Table 4.1, Brewers Association Draught Beer Quality Manual, 4th ed.
// Material, bore, lb per foot, then the same restriction in kPa per metre.
const PUBLISHED = [
  ['Vinyl', '3/16 in ID', 3.00],
  ['Vinyl', '1/4 in ID', 0.85],
  ['Vinyl', '5/16 in ID', 0.40],
  ['Vinyl', '3/8 in ID', 0.20],
  ['Vinyl', '1/2 in ID', 0.025],
  ['Barrier', '1/4 in ID', 0.30],
  ['Barrier', '5/16 in ID', 0.10],
  ['Barrier', '3/8 in ID', 0.06],
  ['Stainless', '1/4 in OD', 1.20],
  ['Stainless', '5/16 in OD', 0.30],
  ['Stainless', '3/8 in OD', 0.12]
];

assert.equal(C.TUBING.length, 11, 'eleven published lines');
for (let index = 0; index < PUBLISHED.length; index += 1) {
  assert.equal(C.TUBING[index].material, PUBLISHED[index][0], 'material row ' + index);
  assert.equal(C.TUBING[index].bore, PUBLISHED[index][1], 'bore row ' + index);
  assert.equal(C.TUBING[index].resistance, PUBLISHED[index][2], 'resistance row ' + index);
}
assert.equal(C.STATIC_LB_PER_FT, 0.5, 'half a pound per foot of lift');
assert.equal(C.POUR_RATE_OZ_PER_S, 2, 'two fluid ounces per second');
assert.equal(C.MAX_LENGTH_FT, 300, 'long-draw runs are refused');

// ---- Independent arithmetic: length = (pressure - 0.5 * rise - other) / r.
for (const row of C.TUBING) {
  const rise = 3.5;
  const pressure = 18;
  const other = 2;
  const expected = (pressure - 0.5 * rise - other) / row.resistance;
  if (expected > 300) {
    assert.match(failure(String(pressure), String(rise), String(other), row.id), /^That pressure and tubing call for more than 300 ft/);
    continue;
  }
  const result = run(String(pressure), String(rise), String(other), row.id);
  assert.ok(Math.abs(result.lengthFt - expected) < 1e-9, 'arithmetic for ' + row.id);
  assert.equal(result.staticLb, 1.75);
  assert.equal(result.dynamicLb, 14.25);
}

// ---- Feet and inches, including the carry at twelve inches.
assert.equal(C.feetInches(3.6666666666666665), '3 ft 8 in');
assert.equal(C.feetInches(3.7666666666666666), '3 ft 9 in');
assert.equal(C.feetInches(4.5), '4 ft 6 in');
assert.equal(C.feetInches(160), '160 ft');
assert.equal(C.feetInches(0.3333333333333333), '4 in');
assert.equal(C.feetInches(3.999), '4 ft');
assert.equal(C.formatFeet(3.6666666666666665), '3.67');
assert.equal(C.formatLb(-1.5), '\u22121.5');
assert.equal(C.resistanceText(0.025), '0.025');
assert.equal(C.resistanceText(0.06), '0.060');
assert.equal(C.resistanceText(3), '3.00');

// ---- The manual's own two published examples.
// Table 3.3: 11.3 psi at 2.5 volumes and 38 F gives 3 ft 9 in of 3/16 in line.
const directDraw = run('11.3', '0', '0', 'vinyl-3-16');
assert.equal(directDraw.bigText, '3 ft 9 in');
assert.equal(directDraw.subText, '3.77 ft of Vinyl 3/16 in ID at 3.00 lb/ft');
// The AHA example: 12.4 psi less 1 psi of gravity over 2 ft, divided by 0.85.
const aha = run('12.4', '2', '0', 'vinyl-1-4');
assert.equal(aha.bigText, '13 ft 5 in');
assert.equal(aha.subText, '13.41 ft of Vinyl 1/4 in ID at 0.85 lb/ft');
assert.equal(aha.dynamicLb, 11.4);

// ---- A drop gives pressure back; the line has to absorb it.
const drop = run('12', '-3', '0', 'vinyl-3-16');
assert.equal(drop.staticLb, -1.5);
assert.equal(drop.dynamicLb, 13.5);
assert.equal(drop.bigText, '4 ft 6 in');
assert.equal(drop.rows[1].v, '\u22123.0 ft, \u22121.5 psi static');

// ---- Parsing: units, decimal comma, inches of height.
assert.equal(C.parsePressure('12 psi'), 12);
assert.equal(C.parsePressure(' 12,5 PSI '), 12.5);
assert.equal(C.parsePressure('12.5'), 12.5);
assert.equal(C.parseRise('2 ft'), 2);
assert.equal(C.parseRise('-1.5 feet'), -1.5);
assert.equal(C.parseRise('30 in'), 2.5);
assert.equal(C.parseRise('30 inches'), 2.5);
assert.equal(C.parseRise("6'"), 6);
assert.equal(C.parseOther('0'), 0);
assert.equal(C.parseOther('5 psi'), 5);

// ---- Short lines pour fast and say so.
const shortLine = run('1', '0', '0', 'vinyl-3-16');
assert.equal(shortLine.bigText, '4 in');
assert.match(shortLine.notice, /pours faster than 2 fl oz\/s/);
assert.equal(run('12', '2', '0', 'vinyl-3-16').notice, '');

// ---- Refusals and their exact wording.
assert.equal(failure('', '2', '0', 'vinyl-3-16'), 'Enter a serving pressure in psi.');
assert.equal(failure('twelve', '2', '0', 'vinyl-3-16'),
  'Enter the serving pressure as a number in psi, such as 12 or 12.5 psi.');
assert.equal(failure('0', '2', '0', 'vinyl-3-16'), 'Enter a serving pressure between 1 and 60 psi.');
assert.equal(failure('61', '2', '0', 'vinyl-3-16'), 'Enter a serving pressure between 1 and 60 psi.');
assert.equal(failure('12', '', '0', 'vinyl-3-16'),
  'Enter the faucet height in feet; use 0 when the tap is level with the keg.');
assert.equal(failure('12', 'sideways', '0', 'vinyl-3-16'),
  'Enter the faucet height as a number in feet, such as 2, -1.5 ft or 30 in.');
assert.equal(failure('12', '41', '0', 'vinyl-3-16'),
  'Enter a faucet height between \u221210 and 40 ft above the keg centre.');
assert.equal(failure('12', '2', '', 'vinyl-3-16'),
  'Enter other resistance in psi, or 0 if the tower and fittings add none.');
assert.equal(failure('12', '2', '21', 'vinyl-3-16'), 'Enter other resistance between 0 and 20 psi.');
assert.equal(failure('12', '2', '15', 'vinyl-3-16'),
  'The lift and other resistance already use up the serving pressure, leaving nothing for the line. Lower the faucet, raise the pressure, or fit a flow-control faucet.');
assert.equal(failure('12', '2', '0', 'rubber'), 'Choose a line from the resistance table.');
assert.equal(failure('60', '0', '0', 'vinyl-1-2'),
  'That pressure and tubing call for more than 300 ft of line. A run that long is a long-draw trunk with a choker and blended gas, which this direct-draw balance does not size.');

// ---- The comparison table repeats the eleven lines at the current settings.
const table = plain(C.table('12', '2', '0', 'vinyl-3-16'));
assert.equal(table.length, 11);
assert.deepEqual(table[0], {
  id: 'vinyl-3-16', label: 'Vinyl 3/16 in ID', resistance: 3,
  resistanceText: '3.00', lengthText: '3.67 ft', selected: true
});
assert.deepEqual(table[4], {
  id: 'vinyl-1-2', label: 'Vinyl 1/2 in ID', resistance: 0.025,
  resistanceText: '0.025', lengthText: 'over 300 ft', selected: false
});
assert.deepEqual(table[7], {
  id: 'barrier-3-8', label: 'Barrier 3/8 in ID', resistance: 0.06,
  resistanceText: '0.060', lengthText: '183.33 ft', selected: false
});
assert.equal(table.filter((row) => row.selected).length, 1);
assert.equal(plain(C.table('12', '2', '0', 'barrier-5-16')).filter((row) => row.selected)[0].id, 'barrier-5-16');

// ---- Catalog record.
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Draft Beer Line Length Calculator');
assert.equal(record.category, 'Food');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.length > 800, 'method explains the arithmetic');
assert.ok(record.tags.includes('beer-line') && record.tags.includes('keg'));
assert.ok(record.sources.length >= 3, 'sources are cited');
const urls = record.sources.filter((source) => source.url);
assert.ok(urls.length >= 3, 'three sources carry a URL');
for (const source of urls) assert.ok(/^https:\/\//.test(source.url), 'source URL is https');
assert.equal(record.sources.filter((source) => /brewersassociation\.org\/wp-content\/.*Draught-Beer-Quality-Manual/.test(source.url || '')).length, 1);
assert.equal(record.sources.filter((source) => /homebrewersassociation\.org\//.test(source.url || '')).length, 1);
assert.equal(record.sources.filter((source) => /micromatic\.com\//.test(source.url || '')).length, 1);

// ---- Replay every catalog case against the core.
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 9, 'nine validation cases');
for (const testCase of record.testCases) {
  const { pressure, rise, other, line } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(pressure, rise, other, line), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(pressure, rise, other, line);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ': ' + key);
  }
}

// ---- No duplicate: slug, name and aliases are unique across the catalog.
const slugHits = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(slugHits.length, 1);
const nameHits = catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase());
assert.equal(nameHits.length, 1, 'name is unique');
const aliasOwners = new Map();
for (const tool of catalog.tools) {
  for (const alias of tool.aliases || []) {
    const key = alias.toLowerCase();
    if (!aliasOwners.has(key)) aliasOwners.set(key, []);
    aliasOwners.get(key).push(tool.slug);
  }
}
for (const alias of record.aliases) {
  assert.deepEqual([...new Set(aliasOwners.get(alias.toLowerCase()))], [slug], 'alias is unique: ' + alias);
}
assert.equal(catalog.tools.filter((tool) => /beer line (length|balancing)|draft line|draught line|keg line/i.test(tool.name)).length, 1,
  'no other draft line tool');
assert.equal(catalog.tools.filter((tool) => /^(beer|draft|draught|keg)-line/.test(tool.slug)).length, 0);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Food' && /line length/i.test(tool.name)).length, 1);

// ---- Page contract.
assert.ok(html.includes('<html lang="en">'));
assert.ok(/<title>Draft Beer Line Length Calculator &mdash; Virtual Tools<\/title>/.test(html));
assert.ok(/<meta name="description" content="[^"]{80,}">/.test(html));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.ok(html.includes('<link rel="stylesheet" href="/assets/style.css">'));
assert.ok(html.includes('<script src="/assets/app.js"></script>'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(/<h1>Draft Beer Line Length Calculator<\/h1>/.test(html));
assert.ok(/<label for="pressure">Serving pressure \(psi\)<\/label>/.test(html));
assert.ok(/<label for="rise">Faucet height above keg centre \(ft\)<\/label>/.test(html));
assert.ok(/<label for="other">Tower and fitting resistance \(psi\)<\/label>/.test(html));
assert.ok(/<label for="line">Beer line<\/label>/.test(html));
assert.ok(/<button type="submit">Calculate line length<\/button>/.test(html));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('@media (max-width:560px)'));
assert.ok(html.includes('autocomplete="off"'));
assert.ok(!/https?:\/\//.test(html), 'the page fetches nothing from the network');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no fetch or storage');
assert.ok(/Everything runs in your browser/.test(html));
