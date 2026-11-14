/* Altitude oxygen calculator: the elevation-to-oxygen contract, the page
   markup and the catalog record's twenty-two cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'altitude-oxygen-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* altitude-oxygen-core:start */';
const endMarker = '/* altitude-oxygen-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, isFinite, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AltitudeOxygenCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(Object.assign({}, C.DEFAULTS, payload)); } catch (error) { return error.message; }
  return null;
};

// ---- Units, elevation parsing and its bounds.
assert.equal(C.parseUnit('m').metres, 1);
assert.equal(C.parseUnit('ft').metres, 0.3048);
assert.equal(failure({ unit: 'km' }), 'Choose metres or feet.');
assert.equal(failure({ unit: '' }), 'Choose metres or feet.');
assert.equal(C.parseElevation('2000', C.parseUnit('m')).metres, 2000);
assert.equal(C.parseElevation(' 2,000 ', C.parseUnit('m')).metres, 2000);
assert.equal(C.parseElevation('-430', C.parseUnit('m')).metres, -430);
assert.equal(C.parseElevation('2500.5', C.parseUnit('m')).metres, 2500.5);
near(C.parseElevation('1000', C.parseUnit('ft')).metres, 304.8, 1e-12, 'feet conversion');
near(C.parseElevation('-1640', C.parseUnit('ft')).metres, -499.872, 1e-9, 'negative feet');
near(C.parseElevation('29527', C.parseUnit('ft')).metres, 8999.83, 0.01, 'top of the feet range');
assert.equal(failure({ elevation: '' }), 'Enter the elevation, for example 2000.');
assert.equal(failure({ elevation: 'abc' }),
  'Enter the elevation as a number such as 2000 or 2500.5; "abc" is not.');
assert.equal(failure({ elevation: '1e3' }),
  'Enter the elevation as a number such as 2000 or 2500.5; "1e3" is not.');
assert.equal(failure({ elevation: '12 m' }),
  'Enter the elevation as a number such as 2000 or 2500.5; "12 m" is not.');
assert.equal(failure({ elevation: '-600' }),
  'Elevation must be from -500 to 9,000 m (-1,640 to 29,527 ft); "-600" is outside that range.');
assert.equal(failure({ elevation: '9001' }),
  'Elevation must be from -500 to 9,000 m (-1,640 to 29,527 ft); "9001" is outside that range.');
assert.equal(failure({ elevation: '29528', unit: 'ft' }),
  'Elevation must be from -500 to 9,000 m (-1,640 to 29,527 ft); "29528" is outside that range.');

// ---- Optional pressure override.
assert.equal(C.parsePressure(''), null);
assert.equal(C.parsePressure('   '), null);
assert.equal(C.parsePressure('760'), 760);
assert.equal(C.parsePressure(' 1,013.25 '), 1013.25);
assert.equal(C.parsePressure('300'), C.MIN_PRESSURE);
assert.equal(C.parsePressure('1100'), C.MAX_PRESSURE);
assert.equal(failure({ pressure: 'abc' }),
  'Enter the measured pressure in hPa, or leave it blank for the standard atmosphere; "abc" is not a number.');
assert.equal(failure({ pressure: '250' }),
  'Measured pressure must be from 300 to 1100 hPa; "250" is outside that range.');
assert.equal(failure({ pressure: '1150' }),
  'Measured pressure must be from 300 to 1100 hPa; "1150" is outside that range.');

// ---- The standard atmosphere at its fixed points.
near(C.standardPressure(0), 1013.25, 1e-9, 'sea-level pressure');
near(C.standardPressure(1000), 898.746, 0.001, '1 km');
near(C.standardPressure(5000), 540.1988, 0.0005, '5 km');
near(C.inspiredOxygen(1013.25), 19.9111, 0.0001, 'sea-level oxygen');
near(C.inspiredOxygen(540.1988), 10.0025, 0.0005, '5 km oxygen');
near(C.pressureAltitudeHpa(540.1988), 5000, 0.01, 'pressure altitude inverts');
near(C.pressureAltitudeHpa(1013.25), 0, 1e-9, 'zero altitude');
for (const metres of [-500, 0, 1200, 2500, 5000, 9000]) {
  near(C.standardPressure(C.pressureAltitudeHpa(C.standardPressure(metres))), C.standardPressure(metres),
    1e-9, 'round trip at ' + metres);
}

// ---- The default plan: 2000 m, standard atmosphere.
const base = C.build({});
assert.equal(base.unit, 'm');
assert.equal(base.elevationM, 2000);
near(base.elevationFt, 6561.68, 0.01, 'default feet');
near(base.pressureHpa, 794.952, 0.001, 'default pressure');
near(base.pressureMmHg, 596.26, 0.01, 'default mmHg');
near(base.oxygenKpa, 15.3386, 0.0001, 'default oxygen');
near(base.oxygenMmHg, 115.05, 0.01, 'default oxygen mmHg');
near(base.availabilityPct, 77.0355, 0.0001, 'default availability');
near(base.seaLevelOxygenKpa, 19.9111, 0.0001, 'sea-level oxygen');
near(base.pressureRatioPct, 78.456, 0.001, 'pressure ratio');
assert.equal(base.headline, '77.0%');
assert.equal(base.subText, '15.34 kPa inspired O\u2082 at 2,000 m (6,562 ft)');
assert.equal(base.summary,
  'At 2,000 m (6,562 ft) the standard station pressure is 795.0 hPa, inspired oxygen is 15.34 kPa (115.0 mmHg), 77.0% of the sea-level value.');
assert.equal(base.statusKind, 'ok');
assert.equal(base.statusText, 'Oxygen availability computed');
assert.equal(base.warnings.length, 0);
assert.equal(base.rows.length, 5);
assert.equal(base.rows[0].k, 'Station pressure');
assert.equal(base.rows[0].v, '795.0 hPa (596.3 mmHg)');
assert.equal(base.rows[1].k, 'Inspired oxygen pressure');
assert.equal(base.rows[1].v, '15.34 kPa (115.0 mmHg)');
assert.equal(base.rows[2].v, '77.0%');
assert.equal(base.rows[3].k, 'Pressure altitude');
assert.equal(base.rows[3].v, '2,000 m (6,562 ft)');
assert.equal(base.rows[4].k, 'Pressure vs sea level');
assert.equal(base.rows[4].v, '78.5%');
assert.ok(base.explanation.length >= 5, 'the method is explained');
assert.ok(base.explanation[0].includes('1013.25'), 'the barometric formula is named');
assert.ok(base.explanation[0].includes('5.25588'), 'the exponent is named');
assert.ok(base.explanation[1].includes('6.266'), 'the water-vapour term is named');

// ---- Sea level is exactly 100%, and the table spans 0 to 5000 m.
const sea = C.build({ elevation: '0' });
assert.equal(sea.availabilityPct, 100);
assert.equal(sea.headline, '100.0%');
assert.equal(sea.pressureHpa, 1013.25);
near(sea.oxygenKpa, 19.9111, 0.0001, 'sea-level oxygen');
assert.equal(sea.rows[3].v, '0 m (0 ft)');
assert.equal(base.table.length, 11);
assert.equal(base.table[0].elevationM, 0);
assert.equal(base.table[0].availabilityPct, 100);
assert.equal(base.table[10].elevationM, 5000);
near(base.table[10].availabilityPct, 50.236, 0.001, 'table ends near half');
for (let index = 1; index < base.table.length; index += 1) {
  assert.ok(base.table[index].pressureHpa < base.table[index - 1].pressureHpa, 'table pressure falls');
  assert.ok(base.table[index].availabilityPct < base.table[index - 1].availabilityPct, 'table oxygen falls');
  assert.equal(base.table[index].elevationM - base.table[index - 1].elevationM, 500);
}

// ---- Feet are converted before the model runs.
const feet = C.build({ elevation: '1000', unit: 'ft' });
const metres = C.build({ elevation: '304.8', unit: 'm' });
near(feet.elevationM, 304.8, 1e-12, 'feet elevation');
near(feet.pressureHpa, metres.pressureHpa, 1e-9, 'feet and metres agree');
near(feet.oxygenKpa, metres.oxygenKpa, 1e-9, 'feet and metres oxygen agree');
assert.equal(feet.rows[1].v, metres.rows[1].v);
assert.equal(feet.headline, '96.2%');

// ---- Above 2500 m the page raises its altitude caution, in order.
const high = C.build({ elevation: '2500' });
assert.equal(high.warnings.length, 1);
assert.ok(high.warnings[0].startsWith('At 2,500 m, inspired oxygen is 72.0% of the sea-level value.'));
assert.ok(high.warnings[0].includes('does not predict altitude illness'));
assert.equal(high.statusKind, 'warning');
assert.equal(high.statusText, 'Oxygen availability computed with cautions');
assert.equal(C.build({ elevation: '2500', unit: 'ft' }).warnings.length, 0);
assert.equal(C.build({ elevation: '10000', unit: 'ft' }).warnings.length, 1);

// ---- A measured pressure replaces the standard atmosphere; big gaps warn.
const measured = C.build({ elevation: '2000', pressure: '760' });
assert.equal(measured.pressureSource, 'measured');
assert.equal(measured.pressureHpa, 760);
near(measured.standardHpa, 794.952, 0.001, 'standard is still reported');
near(measured.pressureDifferencePct, -4.397, 0.001, 'divergence');
near(measured.pressureAltitudeM, 2360.59, 0.01, 'pressure altitude from the measurement');
near(measured.oxygenKpa, 14.6065, 0.0001, 'measured oxygen');
near(measured.availabilityPct, 73.3587, 0.0001, 'measured availability');
assert.equal(measured.warnings.length, 1);
assert.equal(measured.warnings[0],
  'The measured pressure is 4.4% below the standard atmosphere for 2,000 m, so the results follow the measured value.');
assert.equal(measured.statusKind, 'warning');
assert.ok(measured.summary.includes('measured station pressure'));
const smallGap = C.build({ elevation: '2000', pressure: '790' });
assert.equal(smallGap.warnings.length, 0);
assert.equal(smallGap.pressureSource, 'measured');
near(smallGap.pressureAltitudeM, 2050.30, 0.01, 'small gap altitude');

// ---- Below sea level the air is denser, so availability is over 100%.
const deadSea = C.build({ elevation: '-430' });
near(deadSea.pressureHpa, 1065.9841, 0.001, 'below-sea-level pressure');
near(deadSea.availabilityPct, 105.5475, 0.0001, 'below-sea-level availability');
assert.equal(deadSea.headline, '105.5%');
assert.equal(deadSea.warnings.length, 1);
assert.equal(deadSea.warnings[0],
  'Below sea level the air is denser than at sea level, so oxygen availability is above 100%.');
assert.equal(deadSea.rows[3].v, '-430 m (-1,411 ft)');

// ---- Two cautions can apply at once, highest altitude first.
const both = C.build({ elevation: '3000', pressure: '650' });
assert.equal(both.warnings.length, 2);
assert.ok(both.warnings[0].startsWith('At 3,000 m'));
assert.ok(both.warnings[1].startsWith('The measured pressure is'));

// ---- Page markup: the documented contract.
for (const id of ['ao-form', 'in-elevation', 'in-unit', 'in-pressure', 'calculate', 'reset',
  'status', 'error', 'summary', 'warnings', 'explanation', 'ref-body', 'table-caption', 'limits']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
for (const field of ['in-elevation', 'in-unit', 'in-pressure']) {
  assert.ok(new RegExp(`<label for="${field}">`).test(html), 'missing label for ' + field);
}
assert.ok(/id="summary"[^>]*aria-live="polite"/.test(html), 'the result is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/role="status" aria-live="polite"/.test(html), 'copy feedback is announced');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(/<button id="reset" class="ghost" type="button">/.test(html));
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('<option value="m" selected>'), 'metres are the default unit');
assert.ok(html.includes('<option value="ft">'), 'feet are offered');
assert.ok(html.includes('id="in-elevation" name="elevation"'), 'the elevation field is named');
assert.ok(html.includes('value="2000"'), 'the elevation box starts with the documented example');
assert.ok(html.includes('@media (max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(html.includes('overflow-x:auto'), 'the table scrolls on narrow screens');
assert.ok(html.includes('not medical advice'), 'the limits reject clinical use');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2266, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Altitude Oxygen Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f3d4}\ufe0f');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('1013.25 hPa'), 'method states the standard pressure');
assert.ok(record.method.includes('5.25588'), 'method states the exponent');
assert.ok(record.method.includes('2.25577e-5'), 'method states the lapse term');
assert.ok(record.method.includes('0.20946'), 'method states the oxygen fraction');
assert.ok(record.method.includes('6.266 kPa'), 'method states the water-vapour term');
assert.ok(record.method.includes('-500 to 9,000 m'), 'method states the bounds');
assert.ok(record.method.includes('does not predict altitude illness'), 'method states the limits');
assert.ok(record.method.includes('no network'), 'method states the privacy position');
assert.equal(record.sources.length, 3, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 40), 'sources are described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('altitude'));
assert.ok(record.aliases.includes('Oxygen Availability Calculator'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Health').length, 42, 'Health count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'one record');
assert.equal(catalog.tools.filter((tool) => tool.name === record.name).length, 1, 'one name');

assert.equal(record.testCases.length, 22, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 12);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 10);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(Object.assign({}, C.DEFAULTS, testCase.input));
  const expected = testCase.expected;
  near(result.pressureHpa, expected.pressureHpa, 1e-3, testCase.name + ' pressure');
  near(result.oxygenKpa, expected.oxygenKpa, 1e-3, testCase.name + ' oxygen');
  near(result.availabilityPct, expected.availabilityPct, 1e-3, testCase.name + ' availability');
  near(result.pressureAltitudeM, expected.pressureAltitudeM, 0.01, testCase.name + ' pressure altitude');
  assert.equal(result.warnings.length, expected.warnings, testCase.name + ' warnings');
  assert.equal(result.headline, expected.headline, testCase.name + ' headline');
}

console.log(slug + ': ' + record.testCases.length + ' catalog cases and the page contract pass');
