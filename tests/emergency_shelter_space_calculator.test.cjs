/* Emergency shelter space calculator: the space contract, the page markup and
   the catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'emergency-shelter-space-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* emergency-shelter-core:start */';
const endMarker = '/* emergency-shelter-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Date, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmergencyShelterCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

// ---- Documented constants.
assert.equal(C.MAX_PEOPLE, 10000);
assert.equal(C.MAX_AREA, 1000000);
assert.equal(C.MIN_TARGET, 1);
assert.equal(C.MAX_TARGET, 20);
assert.equal(C.MAX_SHARE, 80);
assert.deepEqual(Array.from(C.TARGETS), [2, 3, 3.5, 4.5, 5.5]);
near(C.FT2_PER_M2, 10.763910416709722, 1e-12, 'square feet per square metre');
assert.deepEqual(Object.keys(C.DEFAULTS).sort(), ['area', 'people', 'share', 'target']);
assert.equal(C.DEFAULTS.people, '12');
assert.equal(C.DEFAULTS.area, '120');
assert.equal(C.DEFAULTS.target, '3.5');
assert.equal(C.DEFAULTS.share, '30');

// ---- Headcount parsing.
assert.equal(C.parsePeople('12'), 12);
assert.equal(C.parsePeople(' 1 '), 1);
assert.equal(C.parsePeople('0012'), 12);
assert.equal(C.parsePeople(7), 7);
assert.equal(failure({ people: '' }), 'Enter the number of people as a whole number from 1 to 10000.');
assert.equal(failure({ people: '0' }), 'The number of people must be from 1 to 10000; 0 is outside that range.');
assert.equal(failure({ people: '10001' }), 'The number of people must be from 1 to 10000; 10001 is outside that range.');
assert.equal(failure({ people: '2.5' }),
  'Enter the number of people as a whole number from 1 to 10000; "2.5" is not a whole number.');
assert.equal(failure({ people: '-3' }),
  'Enter the number of people as a whole number from 1 to 10000; "-3" is not a whole number.');

// ---- Floor area and target parsing.
assert.equal(C.parseArea('120'), 120);
assert.equal(C.parseArea('84.5'), 84.5);
assert.equal(C.parseTarget('3.5'), 3.5);
assert.equal(C.parseTarget('20'), 20);
assert.equal(failure({ area: '' }), 'Enter the covered floor area in square metres, such as 120 or 84.5.');
assert.equal(failure({ area: '1e3' }),
  'Enter the covered floor area in square metres as a number such as 120 or 84.5; "1e3" is not an area.');
assert.equal(failure({ area: '1.234' }),
  'Enter the covered floor area in square metres as a number such as 120 or 84.5; "1.234" is not an area.');
assert.equal(failure({ area: '0' }),
  'The covered floor area must be from 1 to 1000000 square metres; 0.00 is outside that range.');
assert.equal(failure({ area: '1000001' }),
  'The covered floor area must be from 1 to 1000000 square metres; 1000001.00 is outside that range.');
assert.equal(failure({ target: '' }), 'Enter the covered living space per person in square metres, such as 3.5.');
assert.equal(failure({ target: '0.5' }),
  'The space per person must be from 1 to 20 square metres; 0.50 is outside that range.');

// ---- Non-living share parsing.
assert.equal(C.parseShare('30'), 30);
assert.equal(C.parseShare('0'), 0);
assert.equal(C.parseShare('12.5'), 12.5);
assert.equal(failure({ share: '' }), 'Enter the non-living share of the floor as a percentage, such as 30.');
assert.equal(failure({ share: '3.55' }),
  'Enter the non-living share as a percentage such as 30; "3.55" is not a percentage.');
assert.equal(failure({ share: '81' }),
  'The non-living share must be from 0 to 80 percent; 81.0 is outside that range.');

// ---- The default plan.
const base = C.build({});
assert.equal(base.people, 12);
assert.equal(base.floorArea, 120);
assert.equal(base.target, 3.5);
assert.equal(base.sharePct, 30);
assert.equal(base.livingAvailable, 84);
assert.equal(base.livingNeeded, 42);
assert.equal(base.perPerson, 7);
assert.equal(base.coverage, 200);
assert.equal(base.capacity, 24);
assert.equal(base.shortfall, 0);
assert.equal(base.surplus, 42);
assert.equal(base.grossNeeded, 60);
assert.equal(base.sideNeeded, 7.75);
assert.equal(base.sideAvailable, 10.95);
assert.equal(base.livingText, '84.0 m\u00B2');
assert.equal(base.neededText, '42.0 m\u00B2');
assert.equal(base.perPersonText, '7.00 m\u00B2');
assert.equal(base.coverageText, '200%');
assert.equal(base.capacityText, '24');
assert.equal(base.gapText, '42.0 m\u00B2');
assert.equal(base.gapKind, 'surplus');
assert.equal(base.gapNote, 'of living space spare');
assert.equal(base.grossText, '60.0 m\u00B2');
assert.equal(base.sideNeededText, '7.75 m\u00B2');
assert.equal(base.sideAvailableText, '10.95 m\u00B2');
assert.equal(base.livingFt2Text, '904 ft\u00B2');
assert.equal(base.perPersonFt2Text, '75 ft\u00B2');
assert.equal(base.statusKind, 'ok');
assert.equal(base.statusText, 'Space computed; the floor shelters the planned headcount');
assert.ok(base.summary.startsWith('12 people need 42.0 m\u00B2 of covered living space at 3.5 m\u00B2 each.'),
  'summary states the need');
assert.ok(base.summary.includes('The 120.0 m\u00B2 floor leaves 84.0 m\u00B2 after 30%'), 'summary states the floor');
assert.ok(base.summary.includes('so it shelters 24 people.'), 'summary states the capacity');
assert.equal(base.warnings.length, 1);
assert.ok(base.warnings[0].includes('42.0 m\u00B2 of living space more'), 'the surplus is named');
assert.ok(base.warnings[0].includes('enough for 12 more people'), 'the spare capacity is named');
assert.equal(base.explanation.length, 6);
assert.ok(base.explanation[0].includes('120.00 x (1 - 0.30) = 84.0 m\u00B2'), 'the share arithmetic is shown');
assert.ok(base.explanation[1].includes('12 x 3.50 = 42.0 m\u00B2'), 'the need arithmetic is shown');
assert.ok(base.explanation[3].includes('floor(84.00 / 3.50) = 24'), 'the capacity arithmetic is shown');

// ---- The target list walks the same available living area.
assert.deepEqual(Array.from(base.targets).map((row) => row.target), [2, 3, 3.5, 4.5, 5.5]);
assert.deepEqual(Array.from(base.targets).map((row) => row.capacity), [42, 28, 24, 18, 15]);
assert.deepEqual(Array.from(base.targets).map((row) => row.capacityText),
  ['42 people', '28 people', '24 people', '18 people', '15 people']);
assert.deepEqual(Array.from(base.targets).map((row) => row.current), [false, false, true, false, false]);
assert.equal(base.targets[2].targetText, '3.5 m\u00B2/person');
assert.equal(base.targets[0].neededText, '24.0 m\u00B2');

// ---- A crowded hall falls short and says by how much.
const crowded = C.build({ people: '40', area: '180' });
assert.equal(crowded.livingAvailable, 126);
assert.equal(crowded.livingNeeded, 140);
assert.equal(crowded.capacity, 36);
assert.equal(crowded.shortfall, 14);
assert.equal(crowded.surplus, 0);
assert.equal(crowded.gapKind, 'short');
assert.equal(crowded.gapText, '14.0 m\u00B2');
assert.equal(crowded.grossNeeded, 200);
assert.equal(crowded.statusKind, 'warning');
assert.equal(crowded.warnings.length, 1);
assert.ok(crowded.warnings[0].includes('holds 36 of the 40 people planned'), 'the shortfall is named');
assert.ok(crowded.warnings[0].includes('which is 20.0 m\u00B2 of gross floor'), 'the gross gap is named');

// ---- An exact match raises no warning.
const exact = C.build({ people: '100', area: '350', share: '0' });
assert.equal(exact.livingAvailable, 350);
assert.equal(exact.livingNeeded, 350);
assert.equal(exact.capacity, 100);
assert.equal(exact.shortfall, 0);
assert.equal(exact.surplus, 0);
assert.equal(exact.gapKind, 'exact');
assert.equal(exact.gapText, '0 m\u00B2');
assert.equal(exact.gapNote, 'exactly the living space needed');
assert.equal(exact.warnings.length, 0);
assert.equal(exact.statusKind, 'ok');

// ---- A floor too small for one person seats nobody and is not rounded up.
const tiny = C.build({ people: '1', area: '2' });
assert.equal(tiny.livingAvailable, 1.4);
assert.equal(tiny.capacity, 0);
assert.equal(tiny.capacityText, '0');
assert.equal(tiny.shortfall, 2.1);
assert.equal(tiny.grossNeeded, 5);
assert.equal(tiny.statusKind, 'warning');

// ---- Capacity never exceeds the living area, and one more person never fits.
for (const area of [1, 45, 84.5, 120, 333.33, 1200]) {
  for (const target of [1, 2, 3.5, 4.5, 5.5, 20]) {
    for (const share of [0, 30, 80]) {
      const row = C.build({ people: '10', area: String(area), target: String(target), share: String(share) });
      const living = area * (1 - share / 100);
      assert.ok(row.capacity * target <= living + 1e-9, `${area}/${target}/${share} capacity fits`);
      assert.ok((row.capacity + 1) * target > living - 1e-9, `${area}/${target}/${share} one more does not fit`);
      near(row.livingAvailable, living, 0.006, `${area}/${target}/${share} living area`);
      near(row.perPerson, living / 10, 0.006, `${area}/${target}/${share} per person`);
      near(row.grossNeeded, (10 * target) / (1 - share / 100), 0.006, `${area}/${target}/${share} gross`);
      near(row.sideNeeded ** 2, row.grossNeeded, 0.01 * row.grossNeeded + 0.02, `${area}/${target}/${share} side needed`);
      near(row.sideAvailable ** 2, area, 0.01 * area + 0.02, `${area}/${target}/${share} side available`);
    }
  }
}

// ---- Formatting helpers never leak negative zero.
assert.equal(C.fmtNum(0.0001, 2), '0.00');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');
assert.equal(C.fmtM2(0), '0.0 m\u00B2');
assert.equal(C.fmtM2(7, 2), '7.00 m\u00B2');
assert.equal(C.fmtFt2(75.35), '75 ft\u00B2');

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'the page declares its language');
assert.ok(/<meta name="viewport"/.test(html), 'the page is mobile ready');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is used');
assert.ok(/<div id="site-header"><\/div>/.test(html), 'the shared header mount is present');
assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('<title>Emergency Shelter Space Calculator &mdash; virt.tools</title>'));
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'a description is supplied');
assert.ok(/<form id="shelter-form" novalidate>/.test(html), 'the form owns submission');
assert.ok(/<label for="in-people">/.test(html), 'the headcount has a label');
assert.ok(/<label for="in-area">/.test(html), 'the floor area has a label');
assert.ok(/<label for="in-target">/.test(html), 'the space target has a label');
assert.ok(/<label for="in-share">/.test(html), 'the non-living share has a label');
assert.ok(/id="in-people"[^>]*type="number"[^>]*min="1"[^>]*max="10000"/.test(html), 'the headcount is bounded');
assert.ok(/id="in-area"[^>]*type="number"[^>]*min="1"[^>]*max="1000000"/.test(html), 'the floor area is bounded');
assert.ok(/id="in-target"[^>]*type="number"[^>]*min="1"[^>]*max="20"/.test(html), 'the target is bounded');
assert.ok(/id="in-share"[^>]*type="number"[^>]*min="0"[^>]*max="80"/.test(html), 'the share is bounded');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(/<button id="example" type="button">/.test(html));
assert.ok(/<button id="reset" type="button">/.test(html));
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="list"/.test(html), 'the target list is a list');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(/[\u0080-\uFFFF]/.test(html) === false, 'the source stays ASCII');
for (const id of ['out-living', 'out-needed', 'out-per-person', 'out-share', 'out-gap', 'out-capacity',
  'out-gross', 'out-side-needed', 'out-side-available', 'targets', 'warnings', 'explanation', 'summary']) {
  assert.ok(html.includes(`id="${id}"`), 'missing output ' + id);
}
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'the shared scripts load last');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'Emergency Shelter Space Calculator');
assert.equal(record.category, 'Safety & Emergency');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f6d6}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('3.5 m2'), 'the method states the Sphere minimum');
assert.ok(record.method.includes('4.5 m2'), 'the method states the cold-climate figure');
assert.ok(record.method.includes('whole-number floor'), 'the method states the rounding');
assert.ok(record.method.includes('square root'), 'the method states the footprint');
assert.ok(record.method.includes('no storage, uploads'), 'the method states the privacy position');
assert.ok(record.guidance.includes('Space planning only'), 'the guidance states the scope');
assert.equal(record.sources.length, 1, 'a source is cited');
assert.ok(record.sources[0].url.startsWith('https://emergency.unhcr.org/'), 'the source is the UNHCR overview');
assert.ok(record.sources[0].title.includes('Sphere minimum'), 'the source names the standard');
assert.ok(record.sources[0].title.length > 40, 'the source is described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('shelter'));
assert.ok(record.aliases.includes('Shelter Capacity Calculator'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 51,
  'Safety & Emergency count');

assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 7);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 17);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  near(result.floorArea, expected.floorArea, 0.005, testCase.name + ' floor');
  near(result.target, expected.target, 0.005, testCase.name + ' target');
  near(result.sharePct, expected.sharePct, 0.05, testCase.name + ' share');
  near(result.livingAvailable, expected.livingAvailable, 0.005, testCase.name + ' living');
  near(result.livingNeeded, expected.livingNeeded, 0.005, testCase.name + ' needed');
  near(result.perPerson, expected.perPerson, 0.005, testCase.name + ' per person');
  near(result.coverage, expected.coverage, 0.05, testCase.name + ' coverage');
  assert.equal(result.capacity, expected.capacity, testCase.name + ' capacity');
  near(result.shortfall, expected.shortfall, 0.005, testCase.name + ' shortfall');
  near(result.surplus, expected.surplus, 0.005, testCase.name + ' surplus');
  near(result.grossNeeded, expected.grossNeeded, 0.005, testCase.name + ' gross');
  near(result.sideNeeded, expected.sideNeeded, 0.005, testCase.name + ' side needed');
  near(result.sideAvailable, expected.sideAvailable, 0.005, testCase.name + ' side available');
}

console.log('emergency_shelter_space_calculator: all assertions passed');
