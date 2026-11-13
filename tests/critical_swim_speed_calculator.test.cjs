/* Critical swim speed calculator: the pacing contract, the page markup and the
   catalog record's nineteen cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'critical-swim-speed-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* critical-swim-core:start */';
const endMarker = '/* critical-swim-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = CriticalSwimCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

// ---- Time parsing: m:ss, h:mm:ss and plain seconds.
assert.equal(C.parseTime('7:20', '400 m'), 440);
assert.equal(C.parseTime('7:2', '400 m'), 422);
assert.equal(C.parseTime('07:20', '400 m'), 440);
assert.equal(C.parseTime('7:20.5', '400 m'), 440.5);
assert.equal(C.parseTime('  7:20  ', '400 m'), 440);
assert.equal(C.parseTime('440', '400 m'), 440);
assert.equal(C.parseTime(440, '400 m'), 440);
assert.equal(C.parseTime('200.25', '200 m'), 200.25);
assert.equal(C.parseTime('0:58:20', '400 m'), 3500);
assert.equal(C.parseTime('1:00:00', '400 m'), 3600);
assert.equal(failure({ long: '1:02:03', short: '3:20' }),
  'The 400 m time must be between 1:00 and 1:00:00; "1:02:03" is outside that range.');
assert.equal(failure({ long: '7:60', short: '3:20' }),
  'The seconds in the 400 m time must be below 60; "7:60" is not a valid time.');
assert.equal(failure({ long: '1:60:00', short: '3:20' }),
  'The minutes and seconds in the 400 m time must be below 60; "1:60:00" is not a valid time.');
assert.equal(failure({ long: '0:45', short: '2:00' }),
  'The 400 m time must be between 1:00 and 1:00:00; "0:45" is outside that range.');
assert.equal(failure({ long: '2:00:00', short: '3:20' }),
  'The 400 m time must be between 1:00 and 1:00:00; "2:00:00" is outside that range.');
assert.equal(failure({ long: 'abc', short: '3:20' }),
  'Enter the 400 m time as minutes:seconds (for example 7:20) or as whole seconds; "abc" is not a time.');
assert.equal(failure({ long: '7:20:', short: '3:20' }),
  'Enter the 400 m time as minutes:seconds (for example 7:20) or as whole seconds; "7:20:" is not a time.');
assert.equal(failure({ long: '-5', short: '3:20' }),
  'Enter the 400 m time as minutes:seconds (for example 7:20) or as whole seconds; "-5" is not a time.');
assert.equal(failure({ long: '  ', short: '3:20' }),
  'Enter the 400 m time as minutes:seconds, for example 7:20.');

// ---- Unit and repetition parsing.
assert.equal(C.parseUnit('m'), 'm');
assert.equal(C.parseUnit('YD'), 'yd');
assert.deepEqual(Array.from(C.REPS), [50, 100, 200, 400]);
assert.deepEqual(Array.from(C.PERCENTAGES), [70, 75, 80, 85, 90, 95, 100, 105, 110]);
assert.equal(C.parseRep('100'), 100);
assert.equal(C.parseRep(400), 400);
assert.equal(failure({ unit: 'km' }), 'Choose metres or yards; both trials must use the same unit.');
assert.equal(failure({ rep: '75' }), 'Choose a repetition distance of 50, 100, 200 or 400.');
assert.equal(failure({ rep: '' }), 'Choose a repetition distance of 50, 100, 200 or 400.');

// ---- The build contract on the default example.
const base = C.build({});
assert.equal(base.unit, 'm');
assert.equal(base.rep, 100);
assert.equal(base.longSeconds, 440);
assert.equal(base.shortSeconds, 200);
assert.equal(base.diff, 240);
near(base.cssSpeed, 0.8333, 0.00005, 'published CSS');
near(base.cssPace, 120, 0.005, 'published pace');
near(base.pace400, 110, 0.005, 'published 400 pace');
near(base.pace200, 100, 0.005, 'published 200 pace');
near(base.reserve, 33.33, 0.005, 'published reserve');
near(base.ratio, 2.2, 0.0005, 'published ratio');
assert.equal(base.cssSpeedText, '0.83 m/s');
assert.equal(base.cssPaceText, '2:00.0');
assert.equal(base.pace400Text, '1:50.0');
assert.equal(base.pace200Text, '1:40.0');
assert.equal(base.reserveText, '33.3 m');
assert.equal(base.statusKind, 'ok');
assert.equal(base.statusText, 'Critical speed computed');
assert.equal(base.warnings.length, 0);
assert.equal(base.rows.length, 9);
assert.equal(base.rows.filter((row) => row.threshold).length, 1);
assert.equal(base.rows[6].percent, 100);
assert.equal(base.rows[6].paceText, '2:00.0');
assert.equal(base.rows[4].paceText, '2:13.3');
assert.equal(base.rows[8].paceText, '1:49.1');
assert.equal(base.rows[0].speedText, '0.58 m/s');
assert.equal(base.repHead, 'Time for 100 m');
assert.equal(base.paceHead, 'Pace per 100 m');
assert.ok(base.summary.includes('0.83 m/s'));
assert.ok(base.summary.includes('2:00.0'));
assert.ok(base.summary.includes('10.0 s slower'));
assert.ok(base.explanation.length >= 6, 'the method is explained');
assert.ok(base.explanation[0].includes('CSS = (400 \u2212 200) / (T400 \u2212 T200)'));
assert.ok(base.explanation[1].includes('120.00 s'), 'the pace identity is stated');
assert.ok(base.explanation[3].includes('33.3 m'), 'the reserve is stated');

// ---- The pace identity: pace per 100 is (T400 - T200) / 2, and 100 / CSS.
for (const [long, short] of [['7:20', '3:20'], ['6:00', '2:50'], ['12:00', '5:30'], ['4:40', '2:12']]) {
  const result = C.build({ long, short });
  near(result.cssPace, (C.parseTime(long, '400') - C.parseTime(short, '200')) / 2, 0.005, 'pace identity');
  near(result.cssSpeed, 100 / result.cssPace, 0.0005, 'speed is 100 / pace');
  near(result.pace400, (result.longSeconds / 400) * 100, 0.005, '400 pace');
  near(result.pace200, (result.shortSeconds / 200) * 100, 0.005, '200 pace');
  near(result.reserve, 400 - result.cssSpeed * result.longSeconds, 0.02, 'reserve identity');
}

// ---- Every row follows the percentage rule, and only 100% is marked.
for (const row of base.rows) {
  near(row.pace, base.cssPace / (row.percent / 100), 0.02, 'row pace at ' + row.percent);
  near(row.repTime, base.rep / (base.cssSpeed * (row.percent / 100)), 0.02, 'row time at ' + row.percent);
  near(row.speed, base.cssSpeed * (row.percent / 100), 0.002, 'row speed at ' + row.percent);
}
assert.equal(base.rows[0].threshold, false);
assert.equal(base.rows[8].threshold, false);
assert.equal(base.rows[6].threshold, true);

// ---- Repetition distance changes the rep column, not the paces.
const reps50 = C.build({ rep: '50' });
assert.equal(reps50.repHead, 'Time for 50 m');
near(reps50.rows[6].repTime, 60, 0.01, 'a 50 at CSS takes 60 s');
assert.equal(reps50.rows[6].repTimeText, '1:00.0');
assert.equal(reps50.rows[0].repTimeText, '1:25.7');
near(reps50.cssPace, base.cssPace, 1e-9, 'paces ignore the repetition distance');

// ---- Yards keep their own unit throughout.
const yards = C.build({ long: '6:30', short: '3:00', unit: 'yd' });
assert.equal(yards.unit, 'yd');
assert.equal(yards.cssSpeedText, '0.95 yd/s');
assert.equal(yards.cssPaceText, '1:45.0');
assert.equal(yards.paceHead, 'Pace per 100 yd');
assert.equal(yards.repHead, 'Time for 100 yd');
assert.equal(yards.reserveText, '28.6 yd');
assert.ok(yards.summary.includes('per 100 yd'));

// ---- Bounds: 0.3 to 2.5 units per second, inclusive.
const floorOk = C.build({ long: '18:36', short: '7:30' });
near(floorOk.cssSpeed, 0.3003, 0.0001, 'just inside the slow bound');
assert.equal(floorOk.warnings.length, 0);
const ceilingOk = C.build({ long: '3:20', short: '2:00' });
near(ceilingOk.cssSpeed, 2.5, 1e-9, 'exactly the fast bound');
assert.equal(ceilingOk.warnings.length, 1, 'a 2:30 spread leaves a negative reserve');
assert.equal(failure({ long: '3:19', short: '2:00' }),
  'Those trials give a critical speed of 2.53 m/s, faster than the 2.5 m/s this page accepts. The two times are only 79.0 s apart, so the result would be dominated by timing error; swim both trials all out and time them separately.');
assert.equal(failure({ long: '20:00', short: '2:00' }),
  'Those trials give a critical speed of 0.19 m/s, slower than the 0.3 m/s this page accepts. The two times are far apart, so one trial is probably too slow or not maximal.');

// ---- Order, caution bands and the negative reserve warning.
assert.equal(failure({ long: '3:20', short: '7:20' }),
  'The 400 time must be longer than the 200 time; 3:20.0 is not longer than 7:20.0.');
assert.equal(failure({ long: '7:20', short: '7:20' }),
  'The 400 time must be longer than the 200 time; 7:20.0 is not longer than 7:20.0.');
const ratioBoundary = C.build({ long: '6:40', short: '2:40' });
near(ratioBoundary.ratio, 2.5, 1e-9, 'ratio at the boundary');
assert.equal(ratioBoundary.warnings.length, 0, 'exactly 2.5 is not a caution');
const wide = C.build({ long: '6:42', short: '2:40' });
assert.equal(wide.warnings.length, 1);
assert.ok(wide.warnings[0].includes('2.51 times the 200 time'));
const zeroReserve = C.build({ long: '5:00', short: '2:30' });
near(zeroReserve.reserve, 0, 1e-9, 'a zero reserve');
assert.equal(zeroReserve.warnings.length, 1);
assert.ok(zeroReserve.warnings[0].includes('negative'));
assert.equal(zeroReserve.statusKind, 'warning');

// ---- Formatting helpers.
assert.equal(C.fmtClock(120), '2:00.0');
assert.equal(C.fmtClock(59.96), '1:00.0');
assert.equal(C.fmtClock(3723.45), '1:02:03.5');
assert.equal(C.fmtClock(0.04), '0:00.0');
assert.equal(C.fmtDuration(56.25), '56.3 s');
assert.equal(C.fmtDuration(59.99), '1:00.0');
assert.equal(C.fmtDuration(75), '1:15.0');
assert.equal(C.fmtSpeed(0.8333, 'm'), '0.83 m/s');
assert.equal(C.fmtNum(0, 1), '0.0');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');
assert.equal(C.roundTo(67.2857, 2), 67.29);
assert.equal(C.MIN_SPEED, 0.3);
assert.equal(C.MAX_SPEED, 2.5);
assert.equal(C.MIN_TIME, 60);
assert.equal(C.MAX_TIME, 3600);

// ---- Page markup: the documented contract.
for (const id of ['css-form', 'in-long', 'in-short', 'in-unit', 'in-rep', 'calculate', 'example',
  'reset', 'status', 'error', 'summary', 'out-speed', 'out-pace', 'out-pace400', 'out-pace200',
  'out-reserve', 'rows-body', 'table-caption', 'warnings', 'explanation', 'pace-head', 'rep-head']) {
  assert.ok(html.includes(`id="${id}"`), 'missing element #' + id);
}
assert.ok(/<label for="in-long">/.test(html), 'the 400 field has a label');
assert.ok(/<label for="in-short">/.test(html), 'the 200 field has a label');
assert.ok(/<label for="in-unit">/.test(html), 'the unit select has a label');
assert.ok(/<label for="in-rep">/.test(html), 'the repetition select has a label');
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('<option value="m" selected>'));
assert.ok(html.includes('<option value="yd">'));
assert.ok(html.includes('<option value="100" selected>'));
for (const repeat of ['50', '200', '400']) {
  assert.ok(html.includes(`<option value="${repeat}">`), 'repeat option ' + repeat);
}
assert.ok(html.includes('value="7:20"'), 'the box starts with the documented example');
assert.ok(html.includes('value="3:20"'));
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2252, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Critical Swim Speed Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f3ca}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('CSS = (400 - 200) / (T400 - T200)'), 'method states the formula');
assert.ok(record.method.includes('0.3 and 2.5'), 'method states the bounds');
assert.ok(record.method.includes('tens of minutes'), 'method states the limits');
assert.ok(record.method.includes('no uploads'), 'method states the privacy position');
assert.equal(record.sources.length, 2, 'sources are cited');
assert.ok(record.sources.every((source) => source.title.length > 40), 'sources are described');
assert.ok(record.sources.some((source) => source.url === 'https://doi.org/10.1007/BF00717953'),
  'the primary study carries its DOI');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('critical-swim-speed'));

assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 12);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 7);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  near(result.cssSpeed, expected.css, 0.0001, testCase.name + ' css');
  near(result.cssPace, expected.pace, 0.005, testCase.name + ' pace');
  near(result.pace400, expected.pace400, 0.005, testCase.name + ' 400 pace');
  near(result.pace200, expected.pace200, 0.005, testCase.name + ' 200 pace');
  near(result.reserve, expected.reserve, 0.005, testCase.name + ' reserve');
  near(result.ratio, expected.ratio, 0.0001, testCase.name + ' ratio');
  assert.equal(result.warnings.length, expected.warnings, testCase.name + ' warnings');
  assert.equal(result.rows.length, expected.rows.length, testCase.name + ' rows');
  result.rows.forEach((row, index) => {
    const [percent, pace, repTime] = expected.rows[index];
    assert.equal(row.percent, percent, testCase.name + ' row percent');
    near(row.pace, pace, 0.005, testCase.name + ' row pace');
    near(row.repTime, repTime, 0.005, testCase.name + ' row time');
  });
}

console.log('critical swim speed calculator: ' + record.testCases.length + ' catalog cases and the page contract pass');
