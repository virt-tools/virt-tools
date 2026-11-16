/* Regression checks for the sandbag barrier core and every case in its catalog record.
 *
 * The count is rebuilt here from the description rather than read off the page:
 * bags along a course are counted by stepping a filled bag length along the run,
 * courses by stepping a filled bag thickness up the wall, and the sand volume is
 * derived through cubic inches instead of the page's lb -> ft3 -> yd3 chain. Unit
 * equivalence is then checked across two independent conversions, so a wrong
 * constant cannot agree with itself.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'sandbag-barrier-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* sandbag-core:start */');
const end = html.indexOf('/* sandbag-core:end */');
assert.ok(start > -1 && end > start, 'sandbag core markers missing');
const core = html.slice(start, end + '/* sandbag-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SandbagCore;', sandbox);
const C = sandbox.module.exports;

const run = (overrides) => C.build(Object.assign({}, C.DEFAULTS, overrides));
// Objects created inside the vm belong to another realm, so their prototypes are
// not this realm's: copy through JSON before a structural comparison.
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (got, want, tolerance, label) =>
  assert.ok(Math.abs(got - want) <= tolerance, `${label}: ${got} vs ${want}`);

// ---- The count rebuilt by stepping, with the filled sizes taken from the page's
// own bag table so the model is about the arithmetic, not the trade figures.
const BAG_SIZES = {
  standard: { long: 20, thick: 6, lb: 35 },
  small: { long: 16, thick: 5, lb: 25 },
  heavy: { long: 24, thick: 8, lb: 50 },
};
const stepCount = (span, unit) => {
  let count = 0;
  let covered = 0;
  while (covered < span - 1e-9) {
    covered += unit;
    count += 1;
  }
  return Math.max(count, 1);
};
const model = (lengthIn, heightIn, bagId, sparePct) => {
  const bag = BAG_SIZES[bagId];
  const perCourse = stepCount(lengthIn, bag.long);
  const courses = stepCount(heightIn, bag.thick);
  const wall = perCourse * courses;
  const spare = Math.max(0, Math.ceil((wall * sparePct) / 100 - 1e-9));
  const total = wall + spare;
  const sandLb = total * bag.lb;
  return {
    perCourse, courses, wall, spare, total, sandLb,
    sandCuYd: sandLb / 100 / 27,
    sandKg: sandLb * 0.45359237,
  };
};

// ---- Linear behaviour, checked with no spare allowance so the spare rounding
// cannot mask a counting error.
for (const bagId of ['standard', 'small', 'heavy']) {
  for (const sparePct of ['0', '10', '50']) {
    const r = run({ length: '24', height: '24', bag: bagId, spare: sparePct });
    const want = model(24 * 12, 24, bagId, Number(sparePct));
    assert.equal(r.perCourse, want.perCourse, `${bagId}/${sparePct}%: bags per course`);
    assert.equal(r.courses, want.courses, `${bagId}/${sparePct}%: courses`);
    assert.equal(r.wallBags, want.wall, `${bagId}/${sparePct}%: wall bags`);
    assert.equal(r.spareBags, want.spare, `${bagId}/${sparePct}%: spare bags`);
    assert.equal(r.totalBags, want.total, `${bagId}/${sparePct}%: total bags`);
    near(r.sandCuYd, want.sandCuYd, 0.005, `${bagId}/${sparePct}%: sand volume`);
  }
}
{
  const zero = run({ spare: '0' });
  assert.equal(zero.totalBags, zero.wallBags, 'no spare leaves the wall total alone');
  const doubled = run({ height: '48', spare: '0' });
  assert.equal(doubled.wallBags, 2 * zero.wallBags, 'twice the height doubles a stack of even courses');
  assert.equal(doubled.perCourse, zero.perCourse, 'height does not change the bags along a course');
  const longer = run({ length: '40', spare: '0' });
  assert.equal(longer.perCourse, 2 * zero.perCourse, 'twice the run doubles the bags along a course');
  assert.equal(longer.courses, zero.courses, 'length does not change the courses');
  assert.equal(longer.wallBags, 2 * zero.wallBags, 'twice the run doubles the wall total');
}

// ---- Unit equivalence: the same wall described two ways must count the same.
{
  const feet = run({ length: '25', lengthUnit: 'ft', height: '24', heightUnit: 'in' });
  const metres = run({ length: '7.62', lengthUnit: 'm', height: '24', heightUnit: 'in' });
  assert.equal(metres.perCourse, feet.perCourse, '25 ft and 7.62 m cover the same run');
  assert.equal(metres.wallBags, feet.wallBags, 'the same wall in metres has the same bag count');
  const inches = run({ length: '20', lengthUnit: 'ft', height: '12', heightUnit: 'in' });
  const centimetres = run({ length: '20', lengthUnit: 'ft', height: '30.48', heightUnit: 'cm' });
  assert.equal(centimetres.courses, inches.courses, '12 in and 30.48 cm are the same height');
  assert.equal(centimetres.totalBags, inches.totalBags, 'the same height in cm has the same count');
}

// ---- Ceilings happen where they should: a run just over a bag length needs two.
{
  const just = run({ length: '1.7', lengthUnit: 'ft', height: '6', spare: '0' });
  assert.equal(just.perCourse, 2, 'a 20.4 in run needs two 20 in bags');
  const under = run({ length: '1.65', lengthUnit: 'ft', height: '6', spare: '0' });
  assert.equal(under.perCourse, 1, 'a 19.8 in run still fits one 20 in bag');
  const tiny = run({ length: '1', lengthUnit: 'ft', height: '6', spare: '0' });
  assert.equal(tiny.perCourse, 1, 'a 12 in run fits one 20 in bag');
  assert.equal(tiny.courses, 1, '6 in is one course');
}

// ---- Documented default and example.
{
  const r = C.build(C.DEFAULTS);
  assert.deepEqual(plain(C.DEFAULTS), { length: '20', lengthUnit: 'ft', height: '24', heightUnit: 'in', bag: 'standard', spare: '10' }, 'documented defaults');
  assert.equal(r.perCourse, 12, 'default: 20 ft is twelve 20 in bags');
  assert.equal(r.courses, 4, 'default: 24 in is four 6 in courses');
  assert.equal(r.wallBags, 48, 'default: 48 bags one bag thick');
  assert.equal(r.spareBags, 5, 'default: 10% of 48 rounds up to 5');
  assert.equal(r.totalBags, 53, 'default: 53 bags to have on hand');
  assert.equal(r.sandText, '0.69 cu yd', 'default: sand volume');
  assert.equal(r.weightText, '1855 lb / 841 kg', 'default: filled weight');
  assert.equal(r.areaText, '40.00 ft\u00b2 (3.72 m\u00b2)', 'default: wall face');
  assert.equal(r.bagsPerSqFt, 1.2, 'default: bags per square foot');
  assert.equal(r.statusKind, 'warning', 'four courses carries the tall-wall caveat');
  assert.equal(r.warnings.length, 1, 'default: one caveat');
  assert.match(r.summary, /A 20\.00 feet wall 24\.00 inches high/, 'summary states the barrier');
  assert.match(r.summary, /53 bags/, 'summary states the total');
  const example = run({ length: '12', height: '18', spare: '15' });
  assert.equal(example.perCourse, 8, 'example: 144 in needs eight bags');
  assert.equal(example.courses, 3, 'example: 18 in is three courses');
  assert.equal(example.spareBags, 4, 'example: 15% of 24 rounds up to 4');
  assert.equal(example.totalBags, 28, 'example: 28 bags');
  assert.equal(example.statusKind, 'ok', 'three courses is not the tall-wall case');
}

// ---- The other bag sizes are the same wall, counted per size.
{
  const r = C.build(C.DEFAULTS);
  assert.equal(r.comparisons.length, 3, 'three bag sizes are compared');
  assert.deepEqual(plain(r.comparisons.map((row) => row.id)), ['standard', 'small', 'heavy'], 'comparison order');
  assert.deepEqual(plain(r.comparisons.map((row) => row.totalBags)), [53, 83, 33], 'comparison counts');
  assert.deepEqual(plain(r.comparisons.map((row) => row.selected)), [true, false, false], 'the chosen size is marked');
  for (const row of r.comparisons) {
    const want = model(20 * 12, 24, row.id, 10);
    assert.equal(row.totalBags, want.total, `${row.id}: comparison total`);
    assert.equal(row.perCourse, want.perCourse, `${row.id}: comparison bags per course`);
  }
}

// ---- Range edges and the tall-wall caveat.
{
  const top = run({ length: '500', height: '120', spare: '0' });
  assert.equal(top.perCourse, 300, '500 ft is 300 bags along a course');
  assert.equal(top.courses, 20, '120 in is twenty courses');
  assert.equal(top.wallBags, 6000, 'the largest wall is 6000 bags');
  assert.match(top.warnings[0], /wider base/, 'a tall wall carries the base caveat');
  const bottom = run({ length: '0.5', lengthUnit: 'm', height: '15', heightUnit: 'cm', bag: 'small', spare: '10' });
  assert.equal(bottom.perCourse, 2, '0.5 m needs two small bags');
  assert.equal(bottom.courses, 2, '15 cm is two small courses');
  assert.equal(bottom.spareBags, 1, '10% of four bags rounds up to one');
  assert.equal(bottom.totalBags, 5, 'the smallest wall is five bags with a spare');
  assert.equal(bottom.warnings.length, 0, 'a small wall with a spare has no caveat');
  const noSpare = run({ spare: '0' });
  assert.equal(noSpare.statusKind, 'warning', 'a zero spare carries its own caveat');
  assert.equal(noSpare.warnings.length, 2, 'the default height and the zero spare each add a caveat');
  assert.ok(noSpare.warnings.some((line) => /No spare/.test(line)), 'the zero-spare caveat is present');
}

// ---- Refusals by exact message, including the unit and bag menus.
{
  const cases = [
    [{ length: '' }, 'Enter the barrier length in feet, from 1 to 500.'],
    [{ length: '0.5' }, 'The barrier length must be from 1 to 500 feet; 0.50 is outside that range.'],
    [{ length: '501' }, 'The barrier length must be from 1 to 500 feet; 501.00 is outside that range.'],
    [{ height: '5' }, 'The barrier height must be from 6 to 120 inches; 5.00 is outside that range.'],
    [{ spare: '' }, 'Enter the spare allowance as a whole percentage from 0 to 50.'],
    [{ spare: '51' }, 'The spare allowance must be at most 50 percent; 51 is above that.'],
    [{ lengthUnit: 'yd' }, 'Choose feet or metres for the barrier length.'],
    [{ bag: 'jumbo' }, 'Choose one of the listed bag sizes.'],
  ];
  for (const [override, message] of cases) {
    assert.throws(() => run(override), (error) => {
      assert.equal(error.message, message, `refusal for ${JSON.stringify(override)}`);
      return true;
    }, `expected a refusal for ${JSON.stringify(override)}`);
  }
}

// ---- Catalog record: every recorded case, plus the house-keeping fields.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Sandbag Flood Barrier Calculator', 'catalog name');
assert.equal(record.category, 'Safety & Emergency', 'catalog category');
assert.equal(record.risk, 'moderate', 'risk classification');
assert.equal(record.maturity, 'draft', 'maturity');
assert.deepEqual(record.sources, [], 'bespoke arithmetic claims no source');
assert.equal(record.listed, true, 'record is public');
assert.equal(record.testCases.length, 29, 'recorded case count');

const numericFields = new Set(['perCourse', 'courses', 'wallBags', 'spareBags', 'totalBags', 'sandCuYd', 'sandKg', 'areaFt2', 'areaM2', 'bagsPerSqFt']);
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.build(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.build(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (numericFields.has(field)) {
      assert.equal(typeof result[field], 'number', `${label}: ${field} is numeric`);
      near(result[field], value, 1e-9 * Math.max(1, Math.abs(value)), `${label}: ${field}`);
    } else {
      assert.equal(result[field], value, `${label}: ${field}`);
    }
  }
}

// ---- Catalog totals and uniqueness against every other record.
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2093, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 48, 'Safety & Emergency count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug is unique');
const names = new Set();
const aliases = new Set();
for (const tool of catalog.tools) {
  names.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) aliases.add(alias.toLowerCase());
}
assert.equal(names.size, catalog.tools.length, 'names are unique');
assert.ok(aliases.size > 0, 'aliases exist');
for (const alias of record.aliases) {
  const elsewhere = catalog.tools.filter((tool) => tool.slug !== slug &&
    (tool.name.toLowerCase() === alias.toLowerCase() || (tool.aliases || []).some((a) => a.toLowerCase() === alias.toLowerCase())));
  assert.equal(elsewhere.length, 0, `alias is not used elsewhere: ${alias}`);
}

// ---- Page contract: one form, one action, a live result, no network or storage.
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /<h1>Sandbag Flood Barrier Calculator<\/h1>/, 'headline matches the catalog name');
assert.match(html, /<label for="in-length">Barrier length<\/label>/, 'length label');
assert.match(html, /<label for="in-length-unit">Length unit<\/label>/, 'length unit label');
assert.match(html, /<label for="in-height">Barrier height<\/label>/, 'height label');
assert.match(html, /<label for="in-bag">Bag size<\/label>/, 'bag label');
assert.match(html, /<label for="in-spare">Spare allowance \(%\)<\/label>/, 'spare label');
assert.match(html, /<button id="calculate" class="primary" type="submit">Count the sandbags<\/button>/, 'submit button');
assert.match(html, /<button id="reset" type="button">Reset<\/button>/, 'reset button');
assert.match(html, /id="status" class="status" role="status" aria-live="polite"/, 'live status region');
assert.match(html, /<th scope="col">Bag size<\/th><th scope="col">Filled size<\/th><th scope="col">Bags to have on hand<\/th>/, 'comparison headings');
assert.match(html, /not a design/, 'the page says it is not a design');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
assert.ok(!/innerHTML/.test(html), 'no markup injection');

console.log('sandbag barrier calculator: all checks passed');
