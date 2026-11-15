/* Regression checks for the film footage core and every case in its catalog record.
 *
 * The frames-per-foot constants are anchored two ways: the page stores the
 * nominal table, and the checks below rebuild each one from the gauge geometry
 * (64 perforations per foot on 35 mm, 7.62 mm and 0.1500 in frame pitches,
 * 72 frames per foot on the Super 8 cartridge) before comparing. The clock and
 * reel arithmetic are then re-derived from the same numbers rather than copied
 * out of the page.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'film-footage-running-time-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* film-footage-core:start */';
const endMarker = '/* film-footage-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'film footage core markers missing');
const core = html.slice(start, end + endMarker.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = FilmFootageCore;', sandbox);
const C = sandbox.module.exports;

const run = (format, fps, feet, reel) => C.analyse({ format, fps, feet, reel });

// ---- Gauge constants, rebuilt from geometry: 35 mm advances 4 perforations of
// 3/16 in (64 per foot); 16 mm and standard 8 mm advance one frame per pitch;
// the Super 8 cartridge is documented at 72 frames per foot.
const DERIVED = [
  ['35-4', 64 / 4, '16'],
  ['35-3', 64 / 3, '21\u2153'],
  ['35-2', 64 / 2, '32'],
  ['16', 12 / 0.3, '40'],
  ['super8', 72, '72'],
  ['reg8', 12 / 0.15, '80'],
];
assert.equal(C.FORMATS.length, DERIVED.length, 'six gauges offered');
for (const [id, perFoot, text] of DERIVED) {
  const format = C.formatById(id);
  assert.ok(Math.abs(format.num / format.den - perFoot) < 1e-12, `${id}: frames per foot follows the geometry`);
  assert.equal(C.perFootText(format.num, format.den), text, `${id}: frames per foot printed`);
}
assert.deepEqual(Array.from(C.FORMATS, (format) => format.id), DERIVED.map((row) => row[0]), 'gauge order');
assert.equal(C.perFootText(64, 3), '21\u2153', 'mixed fraction glyph');
assert.equal(C.perFootText(12, 4), '3', 'whole ratio prints as an integer');
assert.equal(C.perFootText(1, 2), '\u00bd', 'bare proper fraction');

// ---- Number parsing and grouping.
assert.equal(C.parseFeet('1000', 'Footage', 10000), 1000);
assert.equal(C.parseFeet(' 1,234.5 ', 'Footage', 10000), 1234.5);
assert.equal(C.group(16000), '16,000');
assert.equal(C.group(999), '999');
assert.equal(C.group(1000000), '1,000,000');
assert.equal(C.group(34.5), '34.5', 'fractional footage keeps its decimal');
assert.equal(C.group(1234.5), '1,234.5');
assert.equal(C.group(1200.05), '1,200.05');
assert.equal(C.group(2.5), '2.5');
assert.equal(C.oneDecimal(90), '90');
assert.equal(C.oneDecimal(112.3875), '112.4');
assert.equal(C.oneDecimal(67.5), '67.5');

// ---- Clock formatting: tenths, with hours shown only when needed.
assert.equal(C.clock(0), '0:00.0');
assert.equal(C.clock(0.04), '0:00.0');
assert.equal(C.clock(0.05), '0:00.1');
assert.equal(C.clock(59.96), '1:00.0');
assert.equal(C.clock(666.6666666666666), '11:06.7');
assert.equal(C.clock(3600), '1:00:00.0');
assert.equal(C.clock(22222.222222222223), '6:10:22.2');

// ---- The documented default: 1,000 ft of 4-perf at 24 fps on 1,000 ft reels.
{
  const result = run('35-4', '24', '1000', '1000');
  assert.equal(result.formatLabel, '35 mm, 4-perf');
  assert.equal(result.perfs, 4);
  assert.equal(result.framesPerFoot, 16);
  assert.equal(result.frames, 16000);
  assert.equal(result.clock, '11:06.7');
  assert.ok(Math.abs(result.seconds - 666.6666666666666) < 1e-9);
  assert.equal(result.feetPerMinute, 90);
  assert.equal(result.feetPerMinuteText, '90');
  assert.equal(result.reels, 1);
  assert.equal(result.lastReelFeet, 1000);
  assert.deepEqual(Array.from(result.loads, (load) => load.feet), [50, 100, 200, 400, 1000]);
  assert.deepEqual(Array.from(result.loads, (load) => load.frames), [800, 1600, 3200, 6400, 16000]);
  assert.deepEqual(Array.from(result.loads, (load) => C.clock(load.seconds)),
    ['0:33.3', '1:06.7', '2:13.3', '4:26.7', '11:06.7']);
}

// ---- The published gauge figures: 1,000 ft of 4-perf is about 11 minutes at
// 24 fps, 400 ft of 16 mm is about 11 minutes, and a 50 ft Super 8 cartridge is
// 2.5 minutes at 24 fps and 3.33 minutes at 18 fps.
{
  const perFoot35 = run('35-4', '24', '1000', '1000');
  assert.ok(Math.abs(perFoot35.seconds - 660) < 7, '1,000 ft of 4-perf is about 11 minutes');
  const perFoot16 = run('16', '24', '400', '400');
  assert.ok(Math.abs(perFoot16.seconds - 660) < 7, '400 ft of 16 mm is about 11 minutes');
  assert.equal(perFoot16.clock, '11:06.7');
  const cartridge24 = run('super8', '24', '50', '50');
  assert.equal(cartridge24.clock, '2:30.0');
  assert.ok(Math.abs(cartridge24.seconds - 150) < 0.05, '2.5 minutes at 24 fps');
  const cartridge18 = run('super8', '18', '50', '50');
  assert.equal(cartridge18.clock, '3:20.0');
  assert.ok(Math.abs(cartridge18.seconds - 200) < 0.05, '3.33 minutes at 18 fps');
  assert.equal(cartridge18.frames, 3600, '3,600 frames per cartridge');
}

// ---- Closed-form sweep: frames, seconds, film speed and clock shape all follow
// from frames per foot and the frame rate.
{
  let checked = 0;
  for (const format of DERIVED) {
    const perFoot = format[1];
    for (const fps of [18, 24, 25, 30, 48, 60]) {
      for (let feet = 1; feet <= 240; feet += 7) {
        const result = run(format[0], String(fps), String(feet), String(feet));
        assert.equal(result.frames, Math.round(feet * perFoot), `${format[0]} ${feet} ft: frame count`);
        assert.ok(Math.abs(result.seconds - result.frames / fps) < 1e-9, `${format[0]} ${feet} ft: seconds`);
        assert.ok(Math.abs(result.feetPerMinute - (fps * 60) / perFoot) < 1e-9, `${format[0]} ${feet} ft: film speed`);
        assert.match(result.clock, /^\d+(?::\d{2})?:\d{2}\.\d$/, `${format[0]} ${feet} ft: clock shape`);
        assert.equal(result.reels, 1, 'a load as long as the footage is one reel');
        // One more foot never shortens the run.
        const longer = run(format[0], String(fps), String(feet + 1), String(feet + 1));
        assert.ok(longer.frames >= result.frames, 'frames grow with footage');
        assert.ok(longer.clock >= result.clock || longer.clock.length !== result.clock.length, 'clock advances');
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 200, `checked ${checked} sweeps`);
}

// ---- Reels round up, and the last reel carries the remainder.
{
  assert.equal(run('35-4', '24', '1500', '1000').reels, 2);
  assert.equal(run('35-4', '24', '1500', '1000').lastReelFeet, 500);
  assert.equal(run('35-4', '24', '2000', '1000').reels, 2);
  assert.equal(run('35-4', '24', '2000', '1000').lastReelFeet, 1000);
  assert.equal(run('35-4', '24', '1001', '1000').reels, 2, 'one foot over starts a second reel');
  assert.equal(run('35-4', '24', '1001', '1000').lastReelFeet, 1);
  assert.equal(run('16', '24', '50', '400').reels, 1, 'a load longer than the footage is one reel');
  assert.equal(run('35-4', '29.97', '1234.5', '400').reels, 4);
  assert.equal(run('35-4', '29.97', '1234.5', '400').lastReelFeet, 34.5);
}

// ---- 3-perf frames per foot are exact thirds, so whole-frame rounding is visible.
{
  const result = run('35-3', '24', '1.5', '1000');
  assert.equal(result.exactFrames, 32);
  assert.equal(result.frames, 32);
  const third = run('35-3', '24', '0.5', '1000');
  assert.equal(third.exactFrames, 10.666666666666666);
  assert.equal(third.frames, 11, 'a part frame rounds to the nearest whole frame');
}

// ---- Refusals, by exact message.
const refusal = (input, message) => assert.throws(() => C.analyse(input),
  (error) => { assert.equal(error.message, message); return true; }, `expected "${message}"`);
const base = { format: '35-4', fps: '24', feet: '1000', reel: '1000' };
refusal({ ...base, feet: '' }, 'Footage is required.');
refusal({ ...base, feet: '   ' }, 'Footage is required.');
refusal({ ...base, feet: 'abc' }, 'Footage must be a number of feet.');
refusal({ ...base, feet: '-5' }, 'Footage must be a number of feet.');
refusal({ ...base, feet: '1.2.3' }, 'Footage must be a number of feet.');
refusal({ ...base, feet: '0' }, 'Footage must be more than 0 feet.');
refusal({ ...base, feet: '0.000' }, 'Footage must be more than 0 feet.');
refusal({ ...base, feet: '1000001' }, 'Footage must be 1,000,000 feet or less.');
refusal({ ...base, feet: '0.005', format: 'reg8' }, 'Footage is shorter than one frame of this format.');
refusal({ ...base, feet: '0.0124', format: 'reg8' }, 'Footage is shorter than one frame of this format.');
refusal({ ...base, reel: '' }, 'Reel length is required.');
refusal({ ...base, reel: 'ten' }, 'Reel length must be a number of feet.');
refusal({ ...base, reel: '0' }, 'Reel length must be more than 0 feet.');
refusal({ ...base, reel: '100001' }, 'Reel length must be 100,000 feet or less.');
refusal({ ...base, format: 'imax' }, 'Choose the film format from the list.');
refusal({ ...base, format: '' }, 'Choose the film format from the list.');
refusal({ ...base, fps: '26' }, 'Choose the frame rate from the list.');
refusal({ ...base, fps: '' }, 'Choose the frame rate from the list.');
refusal({ ...base, fps: '24.5' }, 'Choose the frame rate from the list.');

// The largest accepted footage is still supported end to end.
{
  const result = run('reg8', '24', '1000000', '1000');
  assert.equal(result.frames, 80000000);
  assert.equal(result.reels, 1000);
}

// ---- Catalog record, totals, and every case stored in the record.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2311, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2051, 'public tools');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Film Footage Running Time Calculator');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(Array.isArray(record.sources) && record.sources.length >= 3, 'sources present');
for (const source of ['35_mm_movie_film', '16_mm_film', 'Super_8_film']) {
  assert.ok(record.sources.some((entry) => (entry.url || '').includes(`wikipedia.org/wiki/${source}`)),
    `the ${source} reference is cited with its URL`);
}
assert.ok(typeof record.method === 'string' && record.method.length > 500, 'method documented');
assert.ok(Array.isArray(record.aliases) && record.aliases.length >= 6, 'aliases present');
assert.ok(Array.isArray(record.tags) && record.tags.length >= 6, 'tags present');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.ok(record.testCases.length >= 12, `expected at least 12 cases, found ${record.testCases.length}`);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Video').length, 46, 'Video count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(!record.aliases.map((alias) => alias.toLowerCase()).includes(other.name.toLowerCase()),
    `alias collides with ${other.slug}`);
  assert.ok(other.name !== record.name, `name collides with ${other.slug}`);
}

const numeric = (value) => typeof value === 'number';
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.analyse(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.analyse(testCase.input);
  const expected = testCase.expected;
  for (const [field, value] of Object.entries(expected)) {
    if (field === 'seconds') {
      assert.ok(Math.abs(result.seconds - value) < 0.01, `${label}: seconds ${result.seconds} vs ${value}`);
    } else if (field === 'lastReelFeet') {
      assert.ok(numeric(result[field]) && Math.abs(result[field] - value) < 1e-9, `${label}: last reel ${result[field]} vs ${value}`);
    } else {
      assert.equal(result[field], value, `${label}: ${field}`);
    }
  }
  assert.equal(result.clock, expected.clock, `${label}: clock`);
}

// ---- Page contract: inputs, an action, a live result, no network or storage.
assert.match(html, /<label class="f" for="in-format">Film format<\/label>/, 'format label');
assert.match(html, /<label class="f" for="in-fps">Camera frame rate<\/label>/, 'frame rate label');
assert.match(html, /<label class="f" for="in-feet">Footage<\/label>/, 'footage label');
assert.match(html, /<label class="f" for="in-reel">Reel or magazine load<\/label>/, 'reel label');
assert.match(html, /<button type="submit">Work out the running time<\/button>/, 'submit button');
assert.match(html, /<button type="button" class="ghost" id="reset">Reset<\/button>/, 'reset button');
assert.match(html, /id="out" aria-live="polite"/, 'live result region');
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /<th scope="col">Feet<\/th><th scope="col">Frames<\/th><th scope="col">Time<\/th>/, 'load table headings');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
assert.ok(!/innerHTML/.test(html), 'no markup injection');
