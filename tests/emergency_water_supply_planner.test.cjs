/* Emergency water supply planner: the quantity contract, the page markup and
   the catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'emergency-water-supply-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* emergency-water-core:start */';
const endMarker = '/* emergency-water-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Date, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmergencyWaterCore;', sandbox);
const C = sandbox.module.exports;

const now = '2026-11-15T03:40:00Z';
const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(payload, now); } catch (error) { return error.message; }
  return null;
};

// ---- Documented constants.
assert.equal(C.GAL_TO_L, 3.785411784);
assert.equal(C.GAL_PER_PERSON_DAY, 1);
assert.equal(C.DRINKING_GAL_PER_PERSON_DAY, 0.75);
assert.equal(C.MAX_PEOPLE, 12);
assert.equal(C.MAX_DAYS, 30);
assert.equal(C.MAX_STORED, 2000);
assert.deepEqual(Array.from(C.CONTAINERS).map((item) => item.id), ['jug5', 'bottle1', 'bottle500', 'case24']);
assert.deepEqual(Array.from(C.CONTAINERS).map((item) => item.label),
  ['5-gallon jug', '1-gallon bottle', '500 mL bottle', 'Case of 24 x 500 mL bottles']);
assert.equal(C.REPLACE_MONTHS, 6);
assert.deepEqual(Object.keys(C.DEFAULTS).sort(), ['days', 'people', 'stored']);
assert.equal(C.DEFAULTS.people, '4');
assert.equal(C.DEFAULTS.days, '3');
assert.equal(C.DEFAULTS.stored, '0');

// ---- Headcount and day parsing.
assert.equal(C.parseCount('4', 'number of people', 12), 4);
assert.equal(C.parseCount('  12  ', 'number of people', 12), 12);
assert.equal(C.parseCount('01', 'number of people', 12), 1);
assert.equal(C.parseCount(7, 'number of people', 12), 7);
assert.equal(failure({ people: '' }), 'Enter the number of people as a whole number from 1 to 12.');
assert.equal(failure({ people: '0' }), 'The number of people must be from 1 to 12; 0 is outside that range.');
assert.equal(failure({ people: '13' }), 'The number of people must be from 1 to 12; 13 is outside that range.');
assert.equal(failure({ people: '2.5' }),
  'Enter the number of people as a whole number from 1 to 12; "2.5" is not a whole number.');
assert.equal(failure({ people: '-3' }),
  'Enter the number of people as a whole number from 1 to 12; "-3" is not a whole number.');

// ---- Stored volume parsing.
assert.equal(C.parseStored('0'), 0);
assert.equal(C.parseStored('12.5'), 12.5);
assert.equal(C.parseStored(' 2 '), 2);
assert.equal(C.parseStored('2000'), 2000);
assert.equal(failure({ stored: '' }),
  'Enter how much water you already store in gallons, or 0 if you store none yet.');
assert.equal(failure({ stored: '-1' }),
  'Enter the stored water as a number of gallons such as 0 or 12.5; "-1" is not a volume.');
assert.equal(failure({ stored: '1e3' }),
  'Enter the stored water as a number of gallons such as 0 or 12.5; "1e3" is not a volume.');
assert.equal(failure({ stored: '12.345' }),
  'Enter the stored water as a number of gallons such as 0 or 12.5; "12.345" is not a volume.');
assert.equal(failure({ stored: '2001' }),
  'Stored water must be at most 2000 gallons; 2001.00 is above that.');

// ---- The default plan.
const base = C.build({}, now);
assert.equal(base.people, 4);
assert.equal(base.days, 3);
assert.equal(base.storedGal, 0);
assert.equal(base.requiredGal, 12);
near(base.requiredL, 45.42, 0.005, 'litres');
assert.equal(base.drinkingGal, 9);
assert.equal(base.otherGal, 3);
assert.equal(base.drinkingGal + base.otherGal, base.requiredGal, 'the split adds up');
assert.equal(base.storedDays, 0);
assert.equal(base.storedDaysText, '0 days', 'zero reads as zero days');
assert.equal(C.build({ people: '4', days: '3', stored: '4' }, now).storedDaysText, '1 day', 'one day is singular');
assert.equal(base.shortfall, 12);
assert.equal(base.surplus, 0);
assert.equal(base.gapText, '12.0 gal');
assert.equal(base.gapKind, 'short');
assert.equal(base.statusKind, 'warning');
assert.equal(base.warnings.length, 1);
assert.ok(base.summary.startsWith('4 people for 3 days need 12.0 gal (45.4 L)'), 'summary states the plan');
assert.ok(base.summary.includes('9.0 gal is drinking water'), 'summary states the drinking share');
assert.ok(base.summary.includes('3.0 gal covers sanitation'), 'summary states the other share');
assert.ok(base.explanation.length >= 5, 'the method is explained');
assert.ok(base.explanation[0].includes('people x days x one gallon'), 'the formula is shown');
assert.ok(base.explanation[0].includes('3.785411784'), 'the liter conversion is shown');

// ---- Container plans round up and never fall short.
assert.deepEqual(Array.from(base.containers).map((row) => row.id), ['jug5', 'bottle1', 'bottle500', 'case24']);
assert.deepEqual(Array.from(base.containers).map((row) => row.label),
  ['5-gallon jug', '1-gallon bottle', '500 mL bottle', 'Case of 24 x 500 mL bottles']);
assert.deepEqual(Array.from(base.containers).map((row) => row.count), [3, 12, 91, 4]);
assert.deepEqual(Array.from(base.containers).map((row) => row.capacityText),
  ['15.0 gal', '12.0 gal', '12.0 gal', '12.7 gal']);
near(base.containers[2].capacity, 12.02, 0.005, '500 mL capacity');
near(base.containers[3].capacity, 12.68, 0.005, 'case capacity');
for (const row of base.containers) {
  assert.ok(row.capacity >= base.requiredGal - 1e-9, `${row.id} covers the requirement`);
  near(row.over, row.capacity - base.requiredGal, 0.005, `${row.id} overage`);
}
assert.equal(C.containerPlan(1)[0].count, 1, 'one day of one gallon still needs one jug');
assert.equal(C.containerPlan(1)[2].count, 8, 'one gallon is eight 500 mL bottles');
assert.equal(C.containerPlan(5)[0].over, 0, 'five gallons divides exactly by a five-gallon jug');

// ---- Stored water, shortfalls and surpluses.
const partial = C.build({ people: '2', days: '14', stored: '7' }, now);
assert.equal(partial.requiredGal, 28);
assert.equal(partial.storedDays, 3.5);
assert.equal(partial.shortfall, 21);
assert.equal(partial.gapKind, 'short');
assert.ok(partial.warnings[0].includes('covers 3.5 of the 14 days'), 'the warning explains the coverage');
assert.ok(partial.warnings[0].includes('Store 21.0 gal more'), 'the warning states the shortfall');

const surplus = C.build({ people: '6', days: '3', stored: '50' }, now);
assert.equal(surplus.storedDays, 8.33);
assert.equal(surplus.surplus, 32);
assert.equal(surplus.shortfall, 0);
assert.equal(surplus.gapKind, 'surplus');
assert.equal(surplus.statusKind, 'ok');
assert.ok(surplus.warnings[0].includes('32.0 gal more than this plan needs'), 'the surplus is named');
assert.ok(surplus.warnings[0].includes('5.3 extra days'), 'the extra coverage is named');

const exact = C.build({ people: '4', days: '3', stored: '12' }, now);
assert.equal(exact.shortfall, 0);
assert.equal(exact.surplus, 0);
assert.equal(exact.gapKind, 'exact');
assert.equal(exact.gapNote, 'exactly matches the requirement');
assert.equal(exact.warnings.length, 0, 'an exact match raises no warning');
assert.equal(exact.statusKind, 'ok');

// ---- Replacement date is six calendar months out, clamped to month end.
assert.equal(base.replaceText, '15 May 2027');
assert.equal(C.fmtDate(C.addMonthsUtc(new Date('2026-08-31T12:00:00Z'), 6)), '28 Feb 2027');
assert.equal(C.fmtDate(C.addMonthsUtc(new Date('2026-12-31T23:59:59Z'), 6)), '30 Jun 2027');
assert.equal(C.fmtDate(C.addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 6)), '31 Jul 2028');
assert.equal(C.fmtDate(C.addMonthsUtc(new Date('2027-01-31T00:00:00Z'), 6)), '31 Jul 2027');
assert.equal(C.fmtDate(new Date('2027-02-01T00:00:00Z')), '1 Feb 2027');
assert.equal(failure({ now: 'not a date' }), null, 'a bad clock is only reachable through build');

// ---- An unusable clock is refused rather than shown as a wrong date.
let clockMessage = null;
try {
  C.build({}, 'not a date');
} catch (error) {
  clockMessage = error.message;
}
assert.equal(clockMessage, 'The replacement date could not be worked out from the current date.');

// ---- Formatting helpers never leak negative zero.
assert.equal(C.fmtNum(0.0001, 2), '0.00');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');
assert.equal(C.fmtGal(0), '0.0 gal');
assert.equal(C.fmtL(3.785411784), '3.8 L');

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'the page declares its language');
assert.ok(/<meta name="viewport"/.test(html), 'the page is mobile ready');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is used');
assert.ok(/<div id="site-header"><\/div>/.test(html), 'the shared header mount is present');
assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('<title>Emergency Water Supply Planner &mdash; virt.tools</title>'));
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'a description is supplied');
assert.ok(/<form id="water-form" novalidate>/.test(html), 'the form owns submission');
assert.ok(/<label for="in-people">/.test(html), 'the headcount has a label');
assert.ok(/<label for="in-days">/.test(html), 'the day count has a label');
assert.ok(/<label for="in-stored">/.test(html), 'the stored volume has a label');
assert.ok(/id="in-people"[^>]*type="number"[^>]*min="1"[^>]*max="12"/.test(html), 'the headcount is bounded');
assert.ok(/id="in-days"[^>]*type="number"[^>]*min="1"[^>]*max="30"/.test(html), 'the day count is bounded');
assert.ok(/id="in-stored"[^>]*type="number"[^>]*min="0"[^>]*max="2000"/.test(html), 'the stored volume is bounded');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(/<button id="example" type="button">/.test(html));
assert.ok(/<button id="reset" type="button">/.test(html));
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(/[\u0080-\uFFFF]/.test(html) === false, 'the source stays ASCII');
for (const id of ['out-gallons', 'out-litres', 'out-drinking', 'out-other', 'out-stored', 'out-days', 'out-gap', 'out-replace', 'rows-body', 'warnings', 'explanation', 'summary']) {
  assert.ok(html.includes(`id="${id}"`), 'missing output ' + id);
}
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'the shared scripts load last');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2298, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Emergency Water Supply Planner');
assert.equal(record.category, 'Safety & Emergency');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f4a7}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('one US gallon per person per day'), 'the method states the rate');
assert.ok(record.method.includes('3.785411784'), 'the method states the conversion');
assert.ok(record.method.includes('rounds up to whole containers'), 'the method states the rounding');
assert.ok(record.method.includes('six calendar months'), 'the method states the replacement interval');
assert.ok(record.method.includes('no uploads'), 'the method states the privacy position');
assert.ok(record.guidance.includes('Quantities only'), 'the guidance states the scope');
assert.equal(record.sources.length, 2, 'sources are cited');
assert.equal(record.sources[0].url, 'https://www.ready.gov/water');
assert.equal(record.sources[1].url, 'https://www.ready.gov/kit');
assert.ok(record.sources.every((source) => source.title.length > 20), 'sources are described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('emergency'));
assert.ok(record.aliases.includes('Emergency Water Planner'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 46, 'Safety & Emergency count');

assert.equal(record.testCases.length, 22, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 12);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input, now);
  const expected = testCase.expected;
  near(result.requiredGal, expected.gallons, 0.005, testCase.name + ' gallons');
  near(result.requiredL, expected.litres, 0.005, testCase.name + ' litres');
  near(result.drinkingGal, expected.drinking, 0.005, testCase.name + ' drinking');
  near(result.otherGal, expected.other, 0.005, testCase.name + ' other');
  near(result.drinkingGal + result.otherGal, expected.gallons, 0.005, testCase.name + ' split total');
  near(result.storedDays, expected.storedDays, 0.006, testCase.name + ' stored days');
  near(result.shortfall, expected.shortfall, 0.005, testCase.name + ' shortfall');
  near(result.surplus, expected.surplus, 0.005, testCase.name + ' surplus');
  assert.equal(result.gapKind, expected.gapKind, testCase.name + ' gap kind');
  assert.equal(result.warnings.length, expected.warnings, testCase.name + ' warnings');
  assert.equal(result.replaceText, expected.replace, testCase.name + ' replacement date');
  assert.equal(result.containers.length, expected.containers.length, testCase.name + ' container rows');
  result.containers.forEach((row, index) => {
    const [id, count, capacity, over] = expected.containers[index];
    assert.equal(row.id, id, testCase.name + ' container id');
    assert.equal(row.count, count, testCase.name + ' container count for ' + id);
    near(row.capacity, capacity, 0.005, testCase.name + ' container capacity for ' + id);
    near(row.over, over, 0.005, testCase.name + ' container overage for ' + id);
    assert.ok(row.capacity >= expected.gallons - 1e-9, testCase.name + ' container covers ' + id);
  });
}

// ---- No rival record offers the same plan.
const rivals = catalog.tools.filter((tool) => {
  const blob = (tool.slug + ' ' + tool.name + ' ' + tool.aliases.join(' ') + ' ' + tool.tags.join(' ')).toLowerCase();
  return blob.includes('emergency water') || blob.includes('water storage planner') || blob.includes('emergency supply');
});
assert.deepEqual(rivals.map((tool) => tool.slug), [slug], 'the plan is unique in the catalog');

console.log('emergency water supply planner: ' + record.testCases.length + ' catalog cases and the page contract pass');
