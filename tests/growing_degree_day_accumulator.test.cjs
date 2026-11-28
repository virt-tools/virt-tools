/* Regression checks for the growing degree day accumulator core, its catalog cases,
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'growing-degree-day-accumulator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* gdd-core:start */');
const end = html.indexOf('/* gdd-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* gdd-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GrowingDegreeCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (got, want, tolerance, label) => {
  assert.ok(Math.abs(got - want) <= tolerance, `${label}: ${got} != ${want}`);
};

const input = (days, base, cutoff, target, unit) => ({
  days,
  unit: unit === undefined ? 'c' : unit,
  base: base === undefined ? '10' : String(base),
  cutoff: cutoff === undefined ? '' : String(cutoff),
  target: target === undefined ? '' : String(target),
});
const run = (options) => plain(C.analyze(options));
const failure = (options) => {
  try {
    C.analyze(options);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent oracle: clamp first, then halve the doubled difference rather than the mean.
function oracle(rows, base, cutoff, target) {
  const daily = rows.map(([high, low]) => {
    const capped = cutoff === null ? high : Math.min(high, cutoff);
    const raised = Math.max(low, base);
    return Math.max(0, (capped + raised - 2 * base) / 2);
  });
  const total = daily.reduce((sum, value) => sum + value, 0);
  const mean = total / daily.length;
  let running = 0;
  let reachedDay = null;
  for (let index = 0; index < daily.length; index += 1) {
    running += daily[index];
    if (target !== null && reachedDay === null && running >= target) reachedDay = index + 1;
  }
  return {
    total,
    mean,
    growingDays: daily.filter((value) => value > 0).length,
    zeroDays: daily.filter((value) => value === 0).length,
    bestDay: Math.max(...daily),
    worstDay: Math.min(...daily),
    bestDayNumber: daily.indexOf(Math.max(...daily)) + 1,
    worstDayNumber: daily.indexOf(Math.min(...daily)) + 1,
    cappedDays: rows.filter(([high]) => cutoff !== null && high > cutoff).length,
    flooredLows: rows.filter(([, low]) => low < base).length,
    daysNeeded: target === null || total >= target ? (total >= target ? 0 : null) : (mean > 0 ? Math.ceil((target - total) / mean) : null),
    reachedDay,
  };
}

const rowsOf = (days, unit) => C.parseSeries(days, unit || 'c').map((row) => [row.high, row.low]);

// Documented surface.
assert.equal(C.MAX_CHARS, 20000);
assert.equal(C.MAX_DAYS, 400);
assert.deepEqual(Object.keys(C.UNITS), ['c', 'f']);
assert.deepEqual([C.UNITS.c.tempMin, C.UNITS.c.tempMax, C.UNITS.c.baseMin, C.UNITS.c.baseMax], [-80, 60, -20, 40]);
assert.deepEqual([C.UNITS.f.tempMin, C.UNITS.f.tempMax, C.UNITS.f.baseMin, C.UNITS.f.baseMax], [-112, 140, -4, 104]);

// Parsing: commas or whitespace, blank lines ignored, values kept in order.
assert.deepEqual(plain(C.parseSeries('22,9\n\n 24   11 \n19, ,6,\n', 'c')),
  [{ high: 22, low: 9 }, { high: 24, low: 11 }, { high: 19, low: 6 }]);
assert.deepEqual(plain(C.parseSeries('3.25 -5.5', 'c')), [{ high: 3.25, low: -5.5 }]);
assert.equal(failure(input('22\n')), 'Row 1: enter a high and a low temperature, for example 21, 7.');
assert.equal(failure(input('\n\n22 9 4\n')), 'Row 3: enter a high and a low temperature, for example 21, 7.');

// Unit conversion helpers used by the selector.
near(C.convertValue(10, 'c', 'f'), 50, 1e-9, 'celsius to fahrenheit');
near(C.convertValue(50, 'f', 'c'), 10, 1e-9, 'fahrenheit to celsius');
near(C.convertValue(-40, 'c', 'f'), -40, 1e-9, 'the scales cross at minus forty');
assert.equal(C.convertSeriesText('10, 0\n20, 5', 'c', 'f'), '50, 32\n68, 41');
assert.equal(C.convertSeriesText('50, 32\n\n68, 41', 'f', 'c'), '10, 0\n\n20, 5');
assert.equal(C.convertSeriesText('10, 0\nwarm, 5', 'c', 'f'), null, 'an unreadable row blocks conversion');
assert.equal(C.convertNumberText('10', 'c', 'f'), '50');
assert.equal(C.convertNumberText('', 'c', 'f'), '');
assert.equal(C.convertNumberText('abc', 'c', 'f'), 'abc');

// Plain arithmetic.
const three = run(input('22, 9\n24, 11\n19, 6'));
assert.equal(three.days, 3);
assert.equal(three.totalGdd, 18);
assert.equal(three.growingDays, 3);
assert.equal(three.zeroDays, 0);
assert.equal(three.meanPerDay, 6);
assert.equal(three.bestDay, 7.5);
assert.equal(three.bestDayNumber, 2);
assert.equal(three.worstDay, 4.5);
assert.equal(three.worstDayNumber, 3);
assert.equal(three.flooredLows, 2);
assert.equal(three.cappedDays, 0);
assert.equal(three.cutoff, null);
assert.equal(three.target, null);
assert.equal(three.unitLabel, '°C');
assert.equal(three.degreeLabel, '°C·d');

const capped = run(input('34, 20', 10, 30));
assert.equal(capped.totalGdd, 15, 'the high is lowered to the cutoff before averaging');
assert.equal(capped.cappedDays, 1);
assert.equal(capped.flooredLows, 0);

const floored = run(input('18, 4', 10));
assert.equal(floored.totalGdd, 4, 'the low is raised to the base');
assert.equal(floored.flooredLows, 1);
assert.equal(floored.totalGdd, floored.daily[0].gdd);

const cold = run(input('8, 2', 10));
assert.equal(cold.totalGdd, 0);
assert.equal(cold.zeroDays, 1);
assert.equal(cold.meanPerDay, 0);
assert.equal(cold.bestDayNumber, 1);

const fahrenheit = run(input('93, 74', 50, 86, '', 'f'));
assert.equal(fahrenheit.totalGdd, 30);
assert.equal(fahrenheit.unitLabel, '°F');
assert.equal(fahrenheit.degreeLabel, '°F·d');
assert.equal(fahrenheit.cappedDays, 1);

// Target handling: projected days, a target passed mid-series and an unreachable one.
const six = '20, 8\n25, 12\n18, 5\n30, 16\n15, 2\n22, 10';
const projected = run(input(six, 10, '', 60));
assert.equal(projected.totalGdd, 39);
assert.equal(projected.meanPerDay, 6.5);
assert.equal(projected.target.value, 60);
assert.equal(projected.target.remaining, 21);
assert.equal(projected.target.reached, false);
assert.equal(projected.target.reachedDay, null);
assert.equal(projected.target.daysNeeded, 4);
const passed = run(input(six, 10, '', 20));
assert.equal(passed.target.reached, true);
assert.equal(passed.target.reachedDay, 4);
assert.equal(passed.target.remaining, 0);
assert.equal(passed.target.daysNeeded, 0);
const unreachable = run(input('5, 1', 10, '', 40));
assert.equal(unreachable.target.reached, false);
assert.equal(unreachable.target.daysNeeded, null, 'a zero mean cannot reach a target');
assert.equal(failure(input(six, 10, '', 0)), 'The target must be greater than zero.');

// Validation names the row, the field and the range.
assert.equal(failure(input('')), 'Enter at least one day of high and low temperatures.');
assert.equal(failure(input(' \n\t\n')), 'Enter at least one day of high and low temperatures.');
assert.equal(failure({ ...input(six), days: 'x'.repeat(20001) }), 'Enter no more than 20,000 characters of temperatures.');
assert.equal(failure(input('22, 9\nwarm, 4')), 'Row 2: temperatures must be numbers.');
assert.equal(failure(input('12, 15')), 'Row 1: the high (12) is below the low (15).');
assert.equal(failure(input('61, 10')), 'Row 1: temperatures must be from -80 to 60 °C.');
assert.equal(failure(input('22, 9\n22, -81')), 'Row 2: temperatures must be from -80 to 60 °C.');
assert.equal(failure(input('22, 9', '')), 'Base temperature is required.');
assert.equal(failure(input('22, 9', 'hot')), 'Base temperature must be a number.');
assert.equal(failure(input('22, 9', 45)), 'Base temperature must be from -20 to 40 °C.');
assert.equal(failure(input('22, 9', 10, 10)), 'The upper cutoff must be above the base temperature.');
assert.equal(failure(input('22, 9', 10, 5)), 'The upper cutoff must be above the base temperature.');
assert.equal(failure(input('22, 9', 10, 91)), 'Upper cutoff must be from -20 to 60 °C.');
assert.equal(failure({ ...input(six), unit: 'k' }), 'Choose a temperature unit.');
assert.equal(failure(input(Array.from({ length: 401 }, () => '20, 5').join('\n'))), 'Enter no more than 400 days.');
assert.equal(run(input(Array.from({ length: 400 }, () => '20, 5').join('\n'))).days, 400, 'the maximum series is accepted');

// Differential check against the independent oracle over generated series.
let state = 20261122;
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
for (let trial = 0; trial < 200; trial += 1) {
  const count = 1 + Math.floor(random() * 40);
  const unit = random() < 0.3 ? 'f' : 'c';
  const spec = C.UNITS[unit];
  const base = Math.round((spec.baseMin + random() * (spec.baseMax - spec.baseMin)) * 10) / 10;
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    const low = Math.round((spec.tempMin + random() * (spec.tempMax - spec.tempMin)) * 10) / 10;
    const high = Math.round((low + random() * (spec.tempMax - low)) * 10) / 10;
    lines.push(`${high}, ${low}`);
  }
  const days = lines.join('\n');
  const cutoff = random() < 0.5 ? null : Math.round((base + 1 + random() * (spec.tempMax - base - 1)) * 10) / 10;
  const target = random() < 0.5 ? null : Math.round(random() * 4000) / 2 + 1;
  const result = run({
    days,
    unit,
    base: String(base),
    cutoff: cutoff === null ? '' : String(cutoff),
    target: target === null ? '' : String(target),
  });
  const expected = oracle(rowsOf(days, unit), base, cutoff, target);
  assert.equal(result.days, count, 'day count trial ' + trial);
  near(result.totalGdd, expected.total, 1e-9, 'total trial ' + trial);
  near(result.meanPerDay, expected.mean, 1e-9, 'mean trial ' + trial);
  assert.equal(result.growingDays, expected.growingDays, 'growing days trial ' + trial);
  assert.equal(result.zeroDays, expected.zeroDays, 'zero days trial ' + trial);
  near(result.bestDay, expected.bestDay, 1e-9, 'best trial ' + trial);
  near(result.worstDay, expected.worstDay, 1e-9, 'worst trial ' + trial);
  assert.equal(result.bestDayNumber, expected.bestDayNumber, 'best day number trial ' + trial);
  assert.equal(result.worstDayNumber, expected.worstDayNumber, 'worst day number trial ' + trial);
  assert.equal(result.cappedDays, expected.cappedDays, 'capped trial ' + trial);
  assert.equal(result.flooredLows, expected.flooredLows, 'floored trial ' + trial);
  if (target === null) {
    assert.equal(result.target, null, 'no target trial ' + trial);
  } else {
    assert.equal(result.target.daysNeeded, expected.daysNeeded, 'days needed trial ' + trial);
    assert.equal(result.target.reachedDay, expected.reachedDay, 'reached day trial ' + trial);
    near(result.target.remaining, Math.max(0, target - expected.total), 1e-9, 'remaining trial ' + trial);
  }
}

// The catalog record and every published case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Growing Degree Day Accumulator');
assert.equal(record.category, 'Environment');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f331}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.length > 900, 'method documents the arithmetic');
assert.ok(record.method.includes('mean = (high + low) / 2'), 'the method states the mean');
assert.ok(record.method.includes('min(high, cutoff)'), 'the method states the cutoff');
assert.ok(record.method.includes('max(low, base)'), 'the method states the base floor');
assert.ok(record.method.includes('rounded up'), 'the method states the projection');
assert.ok(record.method.includes('400 days'), 'the method states the series bound');
assert.ok(record.method.includes('no storage, uploads'), 'the method states the privacy position');
assert.equal(record.sources.length, 1, 'one published source');
assert.equal(record.sources[0].title, 'Understanding Growing Degree Days — Penn State Extension');
assert.equal(record.sources[0].url, 'https://extension.psu.edu/understanding-growing-degree-days');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('degree-days'));
assert.ok(record.aliases.includes('GDD Calculator'));
assert.equal(catalog.tools.length, 2517, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2256, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Environment').length, 58, 'Environment count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'no rival record');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'duplicate name: ' + tool.slug);
  const aliases = new Set((tool.aliases || []).map((alias) => alias.trim().toLowerCase()));
  for (const alias of record.aliases) {
    assert.ok(!aliases.has(alias.trim().toLowerCase()), `alias ${alias} clashes with ${tool.slug}`);
  }
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /degree.day|gdd|heat unit/.test(
  tool.slug + ' ' + tool.name + ' ' + tool.aliases.join(' ') + ' ' + tool.tags.join(' '))),
  'no other degree-day tool');

assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11);
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.kind && testCase.input, 'catalog case shape');
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = plain(C.analyze(testCase.input));
  const expected = testCase.expected;
  assert.equal(result.days, expected.days, testCase.name + ' days');
  assert.equal(result.growingDays, expected.growingDays, testCase.name + ' growing days');
  assert.equal(result.zeroDays, expected.zeroDays, testCase.name + ' zero days');
  assert.equal(result.cappedDays, expected.cappedDays, testCase.name + ' capped days');
  assert.equal(result.flooredLows, expected.flooredLows, testCase.name + ' floored lows');
  near(result.totalGdd, expected.totalGdd, 0.002, testCase.name + ' total');
  near(result.meanPerDay, expected.meanPerDay, 0.002, testCase.name + ' mean');
  near(result.bestDay, expected.bestDay, 0.002, testCase.name + ' best day');
  near(result.worstDay, expected.worstDay, 0.002, testCase.name + ' worst day');
  assert.equal(result.bestDayNumber, expected.bestDayNumber, testCase.name + ' best day number');
  assert.equal(result.worstDayNumber, expected.worstDayNumber, testCase.name + ' worst day number');
  if (expected.target) {
    assert.ok(result.target, testCase.name + ' target present');
    assert.equal(result.target.value, expected.target.value, testCase.name + ' target value');
    assert.equal(result.target.reached, expected.target.reached, testCase.name + ' reached');
    assert.equal(result.target.reachedDay, expected.target.reachedDay, testCase.name + ' reached day');
    assert.equal(result.target.daysNeeded, expected.target.daysNeeded, testCase.name + ' days needed');
    near(result.target.remaining, expected.target.remaining, 0.002, testCase.name + ' remaining');
  } else {
    assert.equal(result.target, null, testCase.name + ' no target');
  }
}

// Page contract: no network, storage or external assets; labelled, typed controls.
assert.match(html, /<h1>Growing Degree Day Accumulator<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]{80,}"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(html),
  'no network or storage');
assert.ok(!/<(?:img|iframe|link[^>]+href="https?:)/.test(html), 'no remote media');
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.equal((html.match(/<label\b/g) || []).length, 5, 'every control is labelled');
assert.ok(html.includes('<textarea id="days"'), 'the temperatures are a textarea');
assert.ok(html.includes('<select id="unit"'), 'the unit is a select');
assert.equal((html.match(/<button\b/g) || []).length, 2);
assert.equal((html.match(/type="(?:(?:button)|(?:submit))"/g) || []).length, 2, 'buttons declare a type');
assert.ok(html.includes('overflow-x:auto'), 'the day table scrolls inside its own box');
assert.ok(html.includes('<th scope="col">GDD</th>'), 'the table labels its columns');
console.log('growing degree day accumulator: all checks passed');
