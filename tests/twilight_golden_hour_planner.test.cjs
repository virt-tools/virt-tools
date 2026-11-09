/* Regression checks for the twilight and golden hour planner core, its catalog
   cases, published reference times and the page's offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'twilight-golden-hour-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* twilight-core:start */');
const end = html.indexOf('/* twilight-core:end */');
assert.ok(start > -1 && end > start, 'twilight core markers missing');
const core = html.slice(start, end + '/* twilight-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TwilightCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (options) => plain(C.calculate(options));
const failure = (options) => {
  try {
    run(options);
  } catch (error) {
    return error.message;
  }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
};
const clock = (minutes) => {
  let total = Math.round(minutes);
  total = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
};
const clockDelta = (a, b) => {
  const toMinutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5));
  const diff = Math.abs(toMinutes(a) - toMinutes(b));
  return Math.min(diff, 1440 - diff);
};

// ---- Field contract.
assert.deepEqual(plain(C.DEFAULTS), { date: '2026-06-21', lat: 51.5074, lon: -0.1278, tz: 1 });
assert.deepEqual(plain(C.LIMITS), {
  lat: { min: -89.9, max: 89.9 },
  lon: { min: -180, max: 180 },
  tz: { min: -12, max: 14 },
});
assert.deepEqual(plain(C.ALTITUDES), {
  astronomical: -18, nautical: -12, civil: -6, blue: -4, golden: 6, horizon: -0.833,
});

// ---- The default is London at the June solstice, and omitting fields gives it.
const d = run({});
assert.equal(d.date, '2026-06-21');
assert.equal(d.latitude, 51.5074);
assert.equal(d.longitude, -0.1278);
assert.equal(d.tzOffsetHours, 1);
assert.equal(d.solarNoon, 781.8);
assert.equal(d.sunrise, 282.7);
assert.equal(d.sunset, 1281);
assert.equal(d.dayLengthMinutes, 998.3);
assert.equal(d.civilDawn, 234.9);
assert.equal(d.civilDusk, 1328.8);
assert.equal(d.nauticalDawn, 160.2);
assert.equal(d.nauticalDusk, 1403.4);
assert.equal(d.astronomicalDawn, null);
assert.equal(d.astronomicalDusk, null);
assert.equal(d.statuses.astronomical, 'above');
assert.equal(d.statuses.civil, 'ok');
assert.equal(d.blueMorningStart, d.civilDawn);
assert.equal(d.blueMorningEnd, d.goldenMorningStart);
assert.equal(d.goldenEveningEnd, d.blueEveningStart);
assert.equal(d.blueEveningEnd, d.civilDusk);
assert.deepEqual(run(), d);
assert.deepEqual(run({ date: undefined, lat: null }), d);

// ---- Published times for three sites agree within two minutes.
const published = [
  ['London solstice', { date: '2026-06-21', lat: 51.5074, lon: -0.1278, tz: 1 },
    { sunrise: '04:43', sunset: '21:21', civilDawn: '03:55', civilDusk: '22:09',
      nauticalDawn: '02:40', nauticalDusk: '23:23', solarNoon: '13:02' }],
  ['Sydney winter', { date: '2026-06-01', lat: -33.8688, lon: 151.2093, tz: 10 },
    { sunrise: '06:51', sunset: '16:54', civilDawn: '06:24', civilDusk: '17:21',
      nauticalDawn: '05:53', nauticalDusk: '17:52', solarNoon: '11:52' }],
  ['Tromso polar night', { date: '2026-12-01', lat: 69.6492, lon: 18.9553, tz: 1 },
    { civilDawn: '08:49', civilDusk: '14:16', astronomicalDawn: '06:00',
      astronomicalDusk: '17:04', nauticalDawn: '07:16', solarNoon: '11:33' }],
];
for (const [label, input, expected] of published) {
  const result = run(input);
  for (const [field, value] of Object.entries(expected)) {
    assert.ok(clockDelta(clock(result[field]), value) <= 2,
      label + ' ' + field + ': ' + clock(result[field]) + ' vs published ' + value);
  }
}

// ---- Identities across a latitude, longitude and season sweep.
for (const date of ['2026-01-15', '2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
  for (const lat of [-66, -45, -23.4, 0, 23.4, 45, 66]) {
    for (const tz of [-12, 0, 5.5, 14]) {
      const r = run({ date, lat, lon: 0, tz });
      const label = date + ' ' + lat + ' ' + tz;
      // Every event is symmetric about solar noon because the hour angle is.
      for (const [dawn, dusk] of [
        [r.astronomicalDawn, r.astronomicalDusk],
        [r.nauticalDawn, r.nauticalDusk],
        [r.civilDawn, r.civilDusk],
        [r.sunrise, r.sunset],
        [r.blueMorningStart, r.blueEveningEnd],
        [r.goldenMorningStart, r.goldenEveningEnd],
      ]) {
        if (dawn === null || dusk === null) continue;
        near((dawn - r.solarNoon) + (dusk - r.solarNoon), 0, 0.2, 'symmetry ' + label);
      }
      if (r.statuses.sunrise === 'ok') {
        near(r.dayLengthMinutes, r.sunset - r.sunrise, 0.2, 'day length ' + label);
        assert.ok(r.dayLengthMinutes > 0, 'a sunrise and sunset give daylight ' + label);
        assert.ok(r.dayLengthMinutes < 1440, 'a sunrise and sunset give less than 24 h ' + label);
      } else if (r.statuses.sunrise === 'above') {
        assert.equal(r.dayLengthMinutes, 1440, 'midnight sun is 24 h ' + label);
        assert.equal(r.sunrise, null, 'no sunrise in midnight sun ' + label);
      } else {
        assert.equal(r.dayLengthMinutes, 0, 'polar night is 0 h ' + label);
        assert.equal(r.sunrise, null, 'no sunrise in polar night ' + label);
      }
      if (r.statuses.astronomical === 'ok' && r.statuses.nautical === 'ok' && r.statuses.civil === 'ok'
        && r.statuses.blue === 'ok' && r.statuses.golden === 'ok' && r.statuses.sunrise === 'ok'
        && r.solarNoon > 300 && r.solarNoon < 1140) {
        const order = [r.astronomicalDawn, r.nauticalDawn, r.civilDawn, r.blueMorningEnd,
          r.sunrise, r.goldenMorningEnd, r.solarNoon, r.goldenEveningStart, r.sunset,
          r.blueEveningStart, r.civilDusk, r.nauticalDusk, r.astronomicalDusk];
        for (let index = 1; index < order.length; index += 1) {
          assert.ok(order[index] >= order[index - 1], 'event order ' + label + ' at ' + index);
        }
      }
      // The blue hour and golden hour share their -4 degree edges exactly.
      assert.equal(r.blueMorningStart, r.civilDawn, 'blue hour starts at civil dawn ' + label);
      assert.equal(r.blueEveningEnd, r.civilDusk, 'blue hour ends at civil dusk ' + label);
      assert.equal(r.goldenMorningStart, r.blueMorningEnd, 'golden and blue edges meet ' + label);
      assert.equal(r.goldenEveningEnd, r.blueEveningStart, 'golden and blue edges meet ' + label);
      // The golden hour always ends above the horizon and starts below it.
      if (r.statuses.blue === 'ok' && r.statuses.golden === 'ok' && r.solarNoon > 300 && r.solarNoon < 1140) {
        assert.ok(r.goldenMorningEnd > r.goldenMorningStart, 'golden morning window ' + label);
        assert.ok(r.goldenEveningStart < r.goldenEveningEnd, 'golden evening window ' + label);
      }
    }
  }
}

// Northern summer days are longer than northern winter days at the same place.
assert.ok(run({ date: '2026-06-21', lat: 45 }).dayLengthMinutes >
  run({ date: '2026-12-21', lat: 45 }).dayLengthMinutes, 'summer beats winter at 45 N');
assert.ok(run({ date: '2026-06-21', lat: -45 }).dayLengthMinutes <
  run({ date: '2026-12-21', lat: -45 }).dayLengthMinutes, 'winter beats summer at 45 S');
// The equator is close to twelve hours all year.
for (const date of ['2026-03-20', '2026-06-21', '2026-09-23', '2026-12-21']) {
  near(run({ date, lat: 0 }).dayLengthMinutes, 720, 10, 'equator day length ' + date);
}

// ---- Polar and boundary behaviour.
const midnightSun = run({ date: '2026-06-21', lat: 69.6492, lon: 18.9553, tz: 2 });
assert.equal(midnightSun.statuses.sunrise, 'above');
assert.equal(midnightSun.statuses.civil, 'above');
assert.equal(midnightSun.statuses.astronomical, 'above');
assert.equal(midnightSun.dayLengthMinutes, 1440);
assert.equal(midnightSun.sunrise, null);
const polarNight = run({ date: '2026-12-21', lat: 69.6492, lon: 18.9553, tz: 1 });
assert.equal(polarNight.statuses.sunrise, 'below');
assert.equal(polarNight.statuses.golden, 'below');
assert.equal(polarNight.dayLengthMinutes, 0);
assert.equal(polarNight.sunset, null);
assert.ok(polarNight.civilDawn !== null, 'civil twilight still exists in Tromso polar night');
const southPole = run({ date: '2026-06-21', lat: -89.9, lon: 0, tz: 0 });
assert.equal(southPole.statuses.astronomical, 'below');
assert.equal(southPole.statuses.civil, 'below');
assert.equal(southPole.dayLengthMinutes, 0);
const northPole = run({ date: '2026-06-21', lat: 89.9, lon: 0, tz: 0 });
assert.equal(northPole.statuses.golden, 'above');
assert.equal(northPole.dayLengthMinutes, 1440);

// ---- Numeric strings are accepted and the time zone shifts everything by the offset.
assert.equal(run({ date: ' 2026-06-21 ', lat: '51.5074', lon: '-0.1278', tz: '1' }).sunrise, 282.7);
const shifted = run({ date: '2026-06-21', lat: 51.5074, lon: -0.1278, tz: 2 });
near(shifted.sunrise - d.sunrise, 60, 0.05, 'a one hour offset shifts sunrise');
near(shifted.solarNoon - d.solarNoon, 60, 0.05, 'a one hour offset shifts solar noon');

// ---- Refusals name the failing field.
assert.equal(failure({ date: '' }), 'Date is required.');
assert.equal(failure({ date: '  ' }), 'Date is required.');
assert.equal(failure({ date: '21-06-2026' }), 'Date must be written as YYYY-MM-DD.');
assert.equal(failure({ date: '2026-02-30' }), 'Date must be a real calendar day.');
assert.equal(failure({ date: '2026-13-01' }), 'Date must be a real calendar day.');
assert.equal(failure({ date: '1899-12-31' }), 'Date must be between 1900 and 2100.');
assert.equal(failure({ date: '2101-01-01' }), 'Date must be between 1900 and 2100.');
assert.equal(failure({ lat: '' }), 'Latitude is required.');
assert.equal(failure({ lat: 90 }), 'Latitude must be a number from -89.9 to 89.9.');
assert.equal(failure({ lat: -90 }), 'Latitude must be a number from -89.9 to 89.9.');
assert.equal(failure({ lat: 'north' }), 'Latitude must be a number from -89.9 to 89.9.');
assert.equal(failure({ lon: '' }), 'Longitude is required.');
assert.equal(failure({ lon: -180.5 }), 'Longitude must be a number from -180 to 180.');
assert.equal(failure({ lon: 181 }), 'Longitude must be a number from -180 to 180.');
assert.equal(failure({ tz: '' }), 'UTC offset is required.');
assert.equal(failure({ tz: -13 }), 'UTC offset must be a number from -12 to 14.');
assert.equal(failure({ tz: 14.5 }), 'UTC offset must be a number from -12 to 14.');
for (const bad of ['1e2', '0x10', '45 6', '+45', 'NaN', '4.5.6', '--2']) {
  assert.ok(failure({ lat: bad }), 'latitude refuses ' + JSON.stringify(bad));
}

// ---- The page must not reach the network, store data or inject markup.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="twilight-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Twilight &amp; Golden Hour Planner<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/type="date"/.test(html), 'date control');
for (const id of ['lat', 'lon', 'date', 'tz']) {
  assert.ok(new RegExp('for="in-' + id + '"').test(html), 'label for in-' + id);
  assert.ok(new RegExp('id="in-' + id + '"').test(html), 'control in-' + id);
}
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 6, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Twilight & Golden Hour Planner');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(record.method.includes('full ephemeris'), 'method states the model limits');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.sources.length >= 3, 'sources are recorded');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 19, 'catalog case count');
assert.equal(kinds('golden'), 7, 'seven golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.calculate(input),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = run(input);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
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
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  const owners = keyOwners.get(String(key).toLowerCase());
  assert.deepEqual(Array.from(owners), [slug], 'catalog key is unique to this tool: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()), 'lowercase search aliases are present');

console.log('twilight-golden-hour-planner: all checks passed ('
  + record.testCases.length + ' catalog cases, 700 identity runs, 3 published references)');
