/* Circle skirt regression checks: independent geometry grid, catalog replay,
   validation messages, and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'circle-skirt-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* circle-skirt-core:start */';
const endMarker = '/* circle-skirt-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'circle-skirt core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CircleSkirtCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.calculate({ ...C.DEFAULTS, ...(input || {}) }));
const failure = (input) => {
  try { run(input); } catch (error) { return error.message; }
  return null;
};
const closeTo = (actual, expected, label, epsilon = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= epsilon,
  `${label}: ${actual} vs ${expected}`);

// ---- Exported contract.
assert.deepEqual(plain(C.UNITS).in, { name: 'inches', short: 'in' });
assert.deepEqual(plain(C.UNITS).cm, { name: 'centimetres', short: 'cm' });
assert.deepEqual(plain(C.FIELDS), ['waist', 'length', 'seam', 'hem', 'width']);
assert.deepEqual(plain(C.DEFAULTS), { unit: 'in', fullness: 'full', waist: '28', length: '20', seam: '0.5', hem: '1', width: '60' });
assert.equal(C.FULLNESS.full.fraction, 1);
assert.equal(C.FULLNESS['three-quarter'].fraction, 0.75);
assert.equal(C.FULLNESS.half.fraction, 0.5);
assert.equal(C.FULLNESS.quarter.fraction, 0.25);
assert.equal(C.FULLNESS.half.degrees, 180);
assert.equal(C.LIMITS.in.waistMax, 80);
assert.equal(C.LIMITS.cm.waistMax, 203);
assert.equal(C.round2(2.675), 2.68);
assert.equal(C.round2(0.5915), 0.59);

// ---- Published defaults: 28 in waist, 20 in length, full circle.
const published = run({});
assert.equal(published.unit, 'in');
assert.equal(published.fullnessLabel, 'Full circle');
assert.equal(published.degrees, 360);
closeTo(published.waistRadius, 4.46, 'default waist radius');
closeTo(published.innerRadius, 3.96, 'default inner radius');
closeTo(published.outerRadius, 25.46, 'default outer radius');
closeTo(published.patternWidth, 50.91, 'default pattern width');
closeTo(published.patternHeight, 50.91, 'default pattern height');
closeTo(published.hemLength, 153.66, 'default hem length');
assert.equal(published.fitsFabric, true);

// Independent oracle: the documented angular identities, written out with
// Math.PI and rounded only at the end.
const FRACTIONS = { full: 1, 'three-quarter': 0.75, half: 0.5, quarter: 0.25 };
function r2(value) { return Math.round(value * 100) / 100; }
function oracle(input) {
  const value = { ...C.DEFAULTS, ...(input || {}) };
  const number = (raw) => Number(String(raw).trim().replace(',', '.'));
  const fraction = FRACTIONS[value.fullness];
  const waist = number(value.waist);
  const length = number(value.length);
  const seam = number(value.seam);
  const hem = number(value.hem);
  const width = number(value.width);
  const angle = 2 * Math.PI * fraction;
  const waistRadius = waist / angle;
  const outer = waistRadius + length + hem;
  return {
    waistRadius: r2(waistRadius),
    innerRadius: r2(waistRadius - seam),
    outerRadius: r2(outer),
    patternWidth: r2(fraction === 0.25 ? outer : 2 * outer),
    patternHeight: r2(fraction === 0.5 || fraction === 0.25 ? outer : 2 * outer),
    hemLength: r2(angle * (waistRadius + length)),
    fitsFabric: width >= (fraction === 0.25 ? outer : 2 * outer),
  };
}

// ---- Full grid across fullness, both units, and every input dimension.
let rows = 0;
const waists = ['10', '24.5', '28', '36', '80'];
const lengths = ['2', '18', '20.5', '60'];
const seams = ['0', '0.375', '0.5', '1'];
const hems = ['0', '1', '4'];
const widths = ['20', '44', '60', '120'];
for (const fullness of Object.keys(FRACTIONS)) {
  for (const waist of waists) {
    for (const length of lengths) {
      for (const seam of seams) {
        for (const hem of hems) {
          for (const width of widths) {
            const input = { unit: 'in', fullness, waist, length, seam, hem, width };
            const result = run(input);
            const expected = oracle(input);
            for (const [key, value] of Object.entries(expected)) {
              if (typeof value === 'number') closeTo(result[key], value, JSON.stringify(input) + ' ' + key);
              else assert.equal(result[key], value, JSON.stringify(input) + ' ' + key);
            }
            // Rounded identities may drift by at most a hundredth each side.
            assert.ok(Math.abs(result.patternWidth - 2 * result.outerRadius) < 0.03
              || fullness === 'quarter', 'pattern width follows the outer radius');
            assert.ok(Math.abs(result.outerRadius - (result.waistRadius + Number(length) + Number(hem))) < 0.03, 'outer radius identity');
            assert.ok(result.innerRadius <= result.waistRadius, 'inner cut sits inside the waist line');
            rows += 1;
          }
        }
      }
    }
  }
}
for (const fullness of Object.keys(FRACTIONS)) {
  for (const waist of ['25', '50', '70', '203']) {
    for (const length of ['5', '30', '152']) {
      for (const seam of ['0', '1', '2.5']) {
        for (const width of ['50', '140', '305']) {
          const input = { unit: 'cm', fullness, waist, length, seam, hem: '2', width };
          const result = run(input);
          const expected = oracle(input);
          for (const [key, value] of Object.entries(expected)) {
            if (typeof value === 'number') closeTo(result[key], value, JSON.stringify(input) + ' ' + key);
            else assert.equal(result[key], value, JSON.stringify(input) + ' ' + key);
          }
          rows += 1;
        }
      }
    }
  }
}
assert.ok(rows > 500, 'grid covers both unit systems: ' + rows);

// ---- Parsing and per-field validation.
assert.equal(C.measure(' 28.00 ', 'Waist', 10, 80, C.UNITS.in), 28);
assert.equal(C.measure('28,5', 'Waist', 10, 80, C.UNITS.in), 28.5);
assert.throws(() => C.measure('1e1', 'Waist', 10, 80, C.UNITS.in), /must be a number/);
assert.throws(() => C.measure('  ', 'Waist', 10, 80, C.UNITS.in), /Enter the waist/);
assert.throws(() => C.measure('-5', 'Waist', 10, 80, C.UNITS.in), /between 10 and 80 in/);
assert.equal(failure({ waist: '' }), 'Enter the waist in inches.');
assert.equal(failure({ waist: 'thirty' }), 'Waist must be a number in inches.');
assert.equal(failure({ waist: '9' }), 'Waist must be between 10 and 80 in.');
assert.equal(failure({ waist: '81' }), 'Waist must be between 10 and 80 in.');
assert.equal(failure({ length: '' }), 'Enter the finished length in inches.');
assert.equal(failure({ length: '0' }), 'Finished length must be between 2 and 60 in.');
assert.equal(failure({ length: '61' }), 'Finished length must be between 2 and 60 in.');
assert.equal(failure({ seam: '-0.5' }), 'Seam allowance must be between 0 and 1 in.');
assert.equal(failure({ seam: '1.5' }), 'Seam allowance must be between 0 and 1 in.');
assert.equal(failure({ hem: '5' }), 'Hem allowance must be between 0 and 4 in.');
assert.equal(failure({ width: '19' }), 'Usable fabric width must be between 20 and 120 in.');
assert.equal(failure({ width: '121' }), 'Usable fabric width must be between 20 and 120 in.');
assert.equal(failure({ fullness: 'accordion' }), 'Choose a full, three-quarter, half or quarter circle.');
assert.equal(failure({ unit: 'yd' }), 'Choose inches or centimetres.');
assert.equal(failure({ unit: 'cm', waist: '24' }), 'Waist must be between 25 and 203 cm.');
assert.equal(failure({ unit: 'cm', length: '153' }), 'Finished length must be between 5 and 152 cm.');
assert.equal(failure({ unit: 'cm', seam: '3' }), 'Seam allowance must be between 0 and 2.5 cm.');
assert.equal(failure({ unit: 'cm', width: '49' }), 'Usable fabric width must be between 50 and 305 cm.');

// ---- Pattern block shapes by fullness.
const block = (fullness) => run({ fullness });
assert.equal(block('full').patternWidth, block('full').patternHeight);
assert.equal(block('three-quarter').patternWidth, block('three-quarter').patternHeight);
closeTo(block('half').patternWidth, block('half').outerRadius * 2, 'half block width', 0.02);
closeTo(block('half').patternHeight, block('half').outerRadius, 'half block height');
closeTo(block('quarter').patternWidth, block('quarter').outerRadius, 'quarter block width');
closeTo(block('quarter').patternHeight, block('quarter').outerRadius, 'quarter block height');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Circle Skirt Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.description.length > 80, 'description is descriptive');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 16, 'sixteen validation cases');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') assert.equal(result[key], value, testCase.name + ' ' + key);
    else assert.equal(result[key], value, testCase.name + ' ' + key);
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
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 12, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
for (const field of C.FIELDS.concat(['unit', 'fullness'])) {
  assert.ok(new RegExp(`<label class="f" for="${field}"`).test(html), 'control is labelled: ' + field);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<\/main>\s*<script src="\/assets\/app\.js">/.test(html), 'header script is shared');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html), 'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');

console.log('circle-skirt-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + rows + ' grid rows, 2 unit systems)');
