/* Marching band step and timing: the four published step plans, the distance,
   time and speed arithmetic against an exact rational model, the field spans
   and their whole-count rounding, formatting, every refusal, the catalog
   replay, uniqueness and the page contract. 22.5 in for 8-to-5 (eight steps to
   five yards = 180 inches) and 11.25 in for 16-to-5 are transcribed from the
   sources, so a changed constant or denominator fails here. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'marching-band-step-timing-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* marching-step-core:start */';
const endMarker = '/* marching-step-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MarchingStepCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (plan, custom, tempo, counts, interval) => plain(C.solve(plan, custom, tempo, counts, interval));
const failure = (plan, custom, tempo, counts, interval) => {
  try { run(plan, custom, tempo, counts, interval); } catch (error) { return error.message; }
  return null;
};
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);

// ---- The published definitions.
assert.equal(C.IN_PER_YD, 36, 'inches in a yard');
assert.equal(C.CM_PER_IN, 2.54, 'centimetres in an inch');
assert.equal(C.M_PER_IN, 0.0254, 'metres in an inch');
assert.equal(C.IN_PER_MILE, 63360, 'inches in a mile');
assert.equal(C.STEP_YARDS, 5, 'plans are defined over five yards');
assert.equal(C.FIELD_WIDTH_YD, 160 / 3, 'the playing field is 53 1/3 yards wide');
assert.equal(C.FIELD_LENGTH_YD, 100, 'the playing field is 100 yards long');

assert.equal(C.PLANS.length, 5);
assert.deepEqual(plain(C.PLANS.map((plan) => plan.id)), ['8to5', '6to5', '12to5', '16to5', 'custom']);
assert.deepEqual(plain(C.PLANS.map((plan) => plan.steps)), [8, 6, 12, 16, null]);
assert.deepEqual(plain(C.PLANS.map((plan) => plan.short)), ['8-to-5', '6-to-5', '12-to-5', '16-to-5', 'custom']);
assert.equal(C.DEFAULT_PLAN, '8to5');
assert.equal(C.DEFAULT_TEMPO, '120');
assert.equal(C.DEFAULT_COUNTS, '16');
assert.equal(C.DEFAULT_INTERVAL, '2');

assert.equal(C.stepOf('8to5', ''), 22.5, '8-to-5 is 180/8 inches');
assert.equal(C.stepOf('6to5', ''), 30, '6-to-5 is 180/6 inches');
assert.equal(C.stepOf('12to5', ''), 15, '12-to-5 is 180/12 inches');
assert.equal(C.stepOf('16to5', ''), 11.25, '16-to-5 is 180/16 inches');
assert.equal(C.stepOf('16to5', ''), C.stepOf('8to5', '') / 2, '16-to-5 is half of 8-to-5');
assert.equal(C.stepOf('6to5', ''), C.stepOf('12to5', '') * 2, '6-to-5 is twice 12-to-5');
assert.equal(C.stepOf('custom', '24'), 24);
assert.equal(C.stepOf('custom', ' 24,5 '), 24.5, 'a decimal comma is accepted');
assert.equal(C.planOf(' 8TO5 ').id, '8to5');
assert.equal(C.planOf('9to5'), null);

// ---- Exact rational model, independent of the float path in the core.
const frac = (n, d = 1n) => ({ n: BigInt(n), d: BigInt(d) });
const mul = (a, b) => ({ n: a.n * b.n, d: a.d * b.d });
const div = (a, b) => ({ n: a.n * b.d, d: a.d * b.n });
const value = (a) => Number(a.n) / Number(a.d);
const cmp = (a, b) => {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
};

const ceilText = (a) => String((a.n + a.d - 1n) / a.d);
const PLANS = [['8to5', 8n], ['6to5', 6n], ['12to5', 12n], ['16to5', 16n]];
const TEMPOS = [60, 90, 120, 132, 144, 168, 200];
const close = (got, want, label) => assert.ok(Math.abs(got - value(want)) < 1e-9, label + ': ' + got + ' vs ' + value(want));

for (const [planId, steps] of PLANS) {
  const step = frac(180n, steps);
  for (let counts = 1; counts <= 40; counts += 1) {
    for (const tempo of TEMPOS) {
      const result = run(planId, '', String(tempo), String(counts), '2');
      close(result.step, step, planId + ' step');
      close(result.distanceIn, mul(step, frac(counts)), planId + ' distance ' + counts);
      close(result.seconds, div(mul(frac(counts), frac(60)), frac(tempo)), planId + ' time ' + counts + '@' + tempo);
    }
  }
}

// Whole counts round a span up and never below it.
for (const [planId, steps] of PLANS) {
  const step = frac(180n, steps);
  const spans = run(planId, '', '120', '16', '2').spans;
  assert.equal(spans.length, 3);
  const spansYd = [frac(5), frac(160n, 3n), frac(100)];
  for (let index = 0; index < spans.length; index += 1) {
    const inches = mul(spansYd[index], frac(36));
    const counts = div(inches, step);
    assert.equal(spans[index].wholeText, ceilText(counts), planId + ' whole counts, span ' + index);
    const whole = BigInt(spans[index].wholeText);
    assert.ok(cmp(mul(step, frac(whole)), inches) >= 0, 'whole counts cover the span');
    assert.ok(whole === 0n || cmp(mul(step, frac(whole - 1n)), inches) < 0, 'one count fewer does not cover the span');
    const shown = (Math.round(value(counts) * 100 + 1e-9) / 100).toFixed(2);
    assert.equal(spans[index].countsText, shown, 'exact counts display, span ' + index);
  }
}
assert.deepEqual(plain(run('8to5', '', '120', '16', '2').spans.map((row) => row.wholeText)), ['8', '86', '160']);
assert.deepEqual(plain(run('6to5', '', '120', '16', '2').spans.map((row) => row.wholeText)), ['6', '64', '120']);
assert.deepEqual(plain(run('12to5', '', '120', '16', '2').spans.map((row) => row.wholeText)), ['12', '128', '240']);
assert.deepEqual(plain(run('16to5', '', '120', '16', '2').spans.map((row) => row.wholeText)), ['16', '171', '320']);
assert.deepEqual(plain(run('8to5', '', '120', '16', '2').spans.map((row) => row.countsText)), ['8.00', '85.33', '160.00']);
assert.equal(run('8to5', '', '120', '16', '2').spans[0].timeText, '4.00 s');
assert.equal(run('8to5', '', '120', '16', '2').spans[1].timeText, '43.00 s');
assert.equal(run('8to5', '', '120', '16', '2').spans[2].timeText, '1 min 20.00 s');

// ---- Formatting.
assert.equal(C.fmtStep(22.5), '22.50 in (57.15 cm)');
assert.equal(C.fmtStep(11.25), '11.25 in (28.58 cm)');
assert.equal(C.fmtStep(30), '30.00 in (76.20 cm)');
assert.equal(C.fmtDistance(360), '10.00 yd (30.00 ft, 9.14 m)');
assert.equal(C.fmtDistance(22.5), '0.63 yd (1.88 ft, 0.57 m)');
assert.equal(C.fmtSeconds(8), '8.00 s');
assert.equal(C.fmtSeconds(106.66666666666667), '1 min 46.67 s');
assert.equal(C.fmtSeconds(400), '6 min 40.00 s');
assert.equal(C.fmtSeconds(59.996), '1 min 0.00 s', 'a value that rounds to 60 rolls over into minutes');
assert.equal(C.fmtSpeed(45), '3.75 ft/s (2.56 mph, 4.11 km/h)');
assert.equal(C.fmtSpeed(52.8), '4.40 ft/s (3.00 mph, 4.83 km/h)');
assert.equal(C.fmtFeetInches(45), '3 ft 9.00 in');
assert.equal(C.fmtFeetInches(11.25), '11.25 in', 'under a foot prints inches only');
assert.equal(C.fmtFeetInches(360), '30 ft 0.00 in');
assert.equal(C.fmtInterval(2, 22.5), '2 steps apart: 45.00 in (3 ft 9.00 in, 1.14 m)');
assert.equal(C.fmtInterval(1, 11.25), '1 step apart: 11.25 in (11.25 in, 0.29 m)');
assert.equal(C.plain(120), '120');
assert.equal(C.plain(138.5), '138.5');
assert.equal(C.plain(20), '20');
assert.equal(C.plain(100), '100', 'trailing zeros are only stripped after a decimal point');

// ---- Defaults and the reported rows.
const golden = run('8to5', '', '120', '16', '2');
assert.equal(golden.bigLabel, 'Distance covered');
assert.equal(golden.bigText, '10.00 yd');
assert.equal(golden.subText, '16 counts at 8-to-5, 8.00 s at 120 counts per minute');
assert.deepEqual(golden.rows, [
  { k: 'Step length', v: '22.50 in (57.15 cm)' },
  { k: 'Distance covered', v: '10.00 yd (30.00 ft, 9.14 m)' },
  { k: 'Marching time', v: '8.00 s' },
  { k: 'Ground speed', v: '3.75 ft/s (2.56 mph, 4.11 km/h)' },
  { k: 'Rank interval', v: '2 steps apart: 45.00 in (3 ft 9.00 in, 1.14 m)' }
]);
assert.equal(run('8to5', '', '120', '1', '2').subText, '1 count at 8-to-5, 0.50 s at 120 counts per minute');
assert.equal(run('custom', '24', '132', '12', '2').subText, '12 counts at a 24 in custom step, 5.45 s at 132 counts per minute');
assert.equal(run('custom', '24', '132', '12', '2').bigText, '8.00 yd');
assert.ok(run('custom', '24', '132', '12', '2').copyText.endsWith('3.00 mph'));
assert.ok(/^[0-9]+(\.[0-9]+)? yd$/.test(golden.bigText));

// ---- Refusals.
assert.equal(failure('x', '', '120', '16', '2'), 'Choose a step size plan.');
assert.equal(failure('', '', '120', '16', '2'), 'Choose a step size plan.');
assert.equal(failure('custom', '  ', '120', '16', '2'), 'Enter the custom step length in inches.');
assert.equal(failure('custom', 'abc', '120', '16', '2'),
  'Enter the custom step length as a number of inches, such as 24.');
assert.equal(failure('custom', '0', '120', '16', '2'), 'Enter a custom step between 1 and 60 inches.');
assert.equal(failure('custom', '0.5', '120', '16', '2'), 'Enter a custom step between 1 and 60 inches.');
assert.equal(failure('custom', '60.5', '120', '16', '2'), 'Enter a custom step between 1 and 60 inches.');
assert.equal(failure('custom', '-24', '120', '16', '2'),
  'Enter the custom step length as a number of inches, such as 24.');
assert.equal(failure('8to5', '', '', '16', '2'), 'Enter a tempo in counts per minute.');
assert.equal(failure('8to5', '', 'fast', '16', '2'), 'Enter the tempo as a number of counts per minute, such as 120.');
assert.equal(failure('8to5', '', '1e3', '16', '2'), 'Enter the tempo as a number of counts per minute, such as 120.');
assert.equal(failure('8to5', '', '19.9', '16', '2'), 'Enter a tempo between 20 and 300 counts per minute.');
assert.equal(failure('8to5', '', '300.5', '16', '2'), 'Enter a tempo between 20 and 300 counts per minute.');
assert.equal(failure('8to5', '', '120', '', '2'), 'Enter the number of counts in the move.');
assert.equal(failure('8to5', '', '120', '1.5', '2'), 'Enter the counts as a whole number, such as 16.');
assert.equal(failure('8to5', '', '120', '1,5', '2'), 'Enter the counts as a whole number, such as 16.');
assert.equal(failure('8to5', '', '120', '-16', '2'), 'Enter the counts as a whole number, such as 16.');
assert.equal(failure('8to5', '', '120', '0', '2'), 'Enter between 1 and 2000 counts.');
assert.equal(failure('8to5', '', '120', '2001', '2'), 'Enter between 1 and 2000 counts.');
assert.equal(failure('8to5', '', '120', '16', ''), 'Enter the interval between ranks in steps.');
assert.equal(failure('8to5', '', '120', '16', '0'), 'Enter an interval between 1 and 32 steps.');
assert.equal(failure('8to5', '', '120', '16', '33'), 'Enter an interval between 1 and 32 steps.');
assert.equal(failure('8to5', '', '120', '16', 'two'), 'Enter the interval as a whole number of steps, such as 2.');

// ---- Catalog record.
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'Marching Band Step & Timing Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.added), 'added is a UTC timestamp');
assert.ok(record.description.length > 80, 'description is descriptive');
assert.ok(record.method.length > 800, 'method explains the arithmetic');
for (const tag of ['music', 'marching-band', 'drill', 'step-size', '8-to-5', 'tempo']) {
  assert.ok(record.tags.includes(tag), 'tag ' + tag);
}
assert.ok(record.sources.length >= 3, 'sources are cited');
const urls = record.sources.filter((source) => source.url);
assert.ok(urls.length >= 3, 'three sources carry a URL');
for (const source of urls) assert.ok(/^https:\/\//.test(source.url), 'source URL is https');
assert.equal(urls.filter((source) => /en\.wikibooks\.org\/wiki\/Corps-Style_Marching\/Technique\/Step_Sizes/.test(source.url)).length, 1);
assert.equal(urls.filter((source) => /purdue\.edu\/bands\//.test(source.url)).length, 1);
assert.equal(urls.filter((source) => /en\.wikipedia\.org\/wiki\/Glide_step/.test(source.url)).length, 1);
assert.equal(urls.filter((source) => /en\.wikipedia\.org\/wiki\/American_football_field/.test(source.url)).length, 1);

// ---- Replay every catalog case against the core.
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 24, 'catalog case count');
assert.equal(kinds('golden'), 9, 'nine golden cases');
assert.equal(kinds('boundary'), 4, 'four boundary cases');
assert.equal(kinds('validation'), 11, 'eleven validation cases');
for (const testCase of record.testCases) {
  const { plan, custom, tempo, counts, interval } = testCase.input;
  if (testCase.expectedError) {
    assert.equal(failure(plan, custom, tempo, counts, interval), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(plan, custom, tempo, counts, interval);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], expected, testCase.name + ': ' + key);
  }
}

// ---- No duplicate: slug, name and aliases are unique across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1, 'name is unique');
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
assert.equal(catalog.tools.filter((tool) => /marching/.test(tool.slug) || /marching/i.test(tool.name)).length, 1,
  'no other marching tool');
const stepWords = /8-to-5|8 to 5|drill step|step size/i;
assert.equal(catalog.tools.filter((tool) => stepWords.test(tool.slug) || stepWords.test(tool.name) ||
  (tool.aliases || []).some((alias) => stepWords.test(alias))).length, 1, 'no other drill step tool');

// ---- Page contract.
assert.ok(html.includes('<html lang="en">'));
assert.ok(/<title>Marching Band Step &amp; Timing Calculator &mdash; Virtual Tools<\/title>/.test(html));
assert.ok(/<meta name="description" content="[^"]{80,}">/.test(html));
assert.ok(html.includes('<script src="/assets/theme-init.js"></script>'));
assert.ok(html.includes('<link rel="stylesheet" href="/assets/style.css">'));
assert.ok(html.includes('<script src="/assets/app.js"></script>'));
assert.ok(html.includes('<div id="site-header"></div>'));
assert.ok(/<h1>Marching Band Step &amp; Timing Calculator<\/h1>/.test(html));
assert.ok(/<label for="plan">Step size plan<\/label>/.test(html));
assert.ok(/<label for="custom">Custom step length \(inches\)<\/label>/.test(html));
assert.ok(/<label for="tempo">Tempo \(counts per minute\)<\/label>/.test(html));
assert.ok(/<label for="counts">Counts in the move<\/label>/.test(html));
assert.ok(/<label for="interval">Interval between ranks \(steps\)<\/label>/.test(html));
assert.ok(/<button type="submit">Calculate<\/button>/.test(html));
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('@media (max-width:560px)'));
assert.ok(html.includes('autocomplete="off"'));
assert.ok(!/https?:\/\//.test(html), 'the page fetches nothing from the network');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no fetch or storage');
assert.ok(/Everything runs in your browser/.test(html));
console.log('marching band step and timing: all assertions passed');
