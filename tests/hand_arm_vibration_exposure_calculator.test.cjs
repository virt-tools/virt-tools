/* Hand-arm vibration exposure calculator: HSE exposure points and A(8),
   the page markup and the catalog record's twenty-three cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hand-arm-vibration-exposure-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hand-arm-vibration-core:start */';
const endMarker = '/* hand-arm-vibration-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HandArmVibrationCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

// ---- Constants, parsing, formatting and rounding.
assert.equal(C.EAV_MAGNITUDE, 2.5);
assert.equal(C.ELV_MAGNITUDE, 5);
assert.equal(C.REFERENCE_MINUTES, 480);
assert.equal(C.EAV_POINTS, 100);
assert.equal(C.ELV_POINTS, 400);
assert.equal(C.MAX_TOOLS, 3);
assert.equal(C.parseMagnitude('', 'Tool 1 vibration magnitude'), null);
assert.equal(C.parseMagnitude(' 3.7 ', 'Tool 1 vibration magnitude'), 3.7);
assert.equal(C.parseMagnitude('8', 'Tool 1 vibration magnitude'), 8);
assert.equal(C.parseMagnitude(8, 'Tool 1 vibration magnitude'), 8);
assert.equal(C.parseMinutes('', 'Tool 1 trigger time'), null);
assert.equal(C.parseMinutes('030', 'Tool 1 trigger time'), 30);
assert.equal(failure({ mag1: '0', min1: '30' }),
  'Tool 1 vibration magnitude must be a number greater than 0 and no more than 50; got "0".');
assert.equal(failure({ mag1: '50.01', min1: '30' }),
  'Tool 1 vibration magnitude must be a number greater than 0 and no more than 50; got "50.01".');
assert.equal(failure({ mag1: '8', min1: '12.5' }),
  'Tool 1 trigger time must be a whole number of minutes from 1 to 1440; got "12.5".');
assert.equal(failure({ mag1: '123456789012345678901', min1: '30' }),
  'Tool 1 vibration magnitude must be a number greater than 0 and no more than 50; got "1234567890123456...".');
assert.equal(C.fmtInt(0), '0');
assert.equal(C.fmtInt(124), '124');
assert.equal(C.fmtInt(1024), '1,024');
assert.equal(C.fmtInt(120000), '120,000');
assert.equal(C.fixed(2, 2), '2.00');
assert.equal(C.fixed(2.5811, 2), '2.58');
assert.equal(C.fixed(0.2165, 2), '0.22');
assert.equal(C.roundTo(46.875, 1), 46.9);
assert.equal(C.roundTo(0, 1), 0);
assert.ok(Object.is(C.roundTo(0, 1), 0), 'no negative zero');
assert.equal(C.timeText(46.875), '46.9 min');
assert.equal(C.timeText(187.5), '3.1 h');
assert.equal(C.statusOf(99.9999999), 'below-eav');
assert.equal(C.statusOf(100), 'at-eav');
assert.equal(C.statusOf(100.0001), 'above-eav');
assert.equal(C.statusOf(399.9), 'above-eav');
assert.equal(C.statusOf(400), 'at-elv');
assert.equal(C.statusOf(400.01), 'above-elv');

// ---- The default day and the formula identities.
const base = C.build({});
assert.equal(base.totalPoints, 64);
assert.equal(base.percentEav, 64);
assert.equal(base.percentElv, 16);
assert.equal(base.a8Text, '2.00');
assert.equal(base.status, 'below-eav');
assert.equal(base.toolCount, 1);
assert.equal(base.rows.length, 1);
assert.equal(base.largestLabel, 'Tool 1');
assert.equal(base.largestPoints, 64);
assert.equal(base.timeToEavMinutes, 46.9);
assert.equal(base.timeToElvMinutes, 187.5);
assert.equal(base.timeToEavText, '46.9 min');
assert.match(base.statusText, /^64 exposure points, A\(8\) 2\.00 m\/s²: below the 100-point exposure action value$/);
assert.match(base.summary, /^One tool gives A\(8\) 2\.00 m\/s², or 64 exposure points\./);
assert.equal(base.warnings.length, 0);
assert.ok(base.explanation.length >= 6);
assert.equal(base.rows[0].shareText, '100.0%');

// Points are the square of A(8) over the action value times one hundred.
for (const payload of [{}, { mag1: '5', min1: '180' }, { mag1: '8', min1: '240' },
  { mag1: '12', min1: '15', mag2: '6', min2: '30', mag3: '2', min3: '120' }]) {
  const result = C.build(payload);
  assert.ok(Math.abs(result.rawPoints - 100 * (result.rawA8 / 2.5) ** 2) < 1e-9, 'point and A(8) identity');
  assert.ok(Math.abs(result.rawA8 - Math.sqrt(result.rows.reduce((sum, row) => sum + row.magnitude ** 2 * row.minutes / 480, 0))) < 1e-9,
    'A(8) equals the quadrature sum of the rows');
}

// ---- Boundaries and multi-tool addition.
const atEav = C.build({ mag1: '2.5', min1: '480' });
assert.equal(atEav.totalPoints, 100);
assert.equal(atEav.a8Text, '2.50');
assert.equal(atEav.status, 'at-eav');
assert.match(atEav.statusText, /exactly at the 100-point exposure action value$/);
assert.equal(atEav.warnings.length, 2, 'threshold and long-trigger warnings');

const atElv = C.build({ mag1: '5', min1: '480' });
assert.equal(atElv.totalPoints, 400);
assert.equal(atElv.a8Text, '5.00');
assert.equal(atElv.status, 'at-elv');
assert.equal(atElv.percentElv, 100);

const aboveElv = C.build({ mag1: '8', min1: '240' });
assert.equal(aboveElv.status, 'above-elv');
assert.equal(aboveElv.percentElv, 128);
assert.match(aboveElv.statusText, /above the 400-point exposure limit value$/);
assert.equal(aboveElv.warnings.length, 1);

const twoTools = C.build({ mag1: '5', min1: '120', mag2: '2.5', min2: '480' });
assert.equal(twoTools.totalPoints, 200);
assert.equal(twoTools.a8Text, '3.54');
assert.equal(twoTools.percentElv, 50);
assert.equal(twoTools.status, 'above-eav');
assert.equal(twoTools.rows[0].shareText, '50.0%');
assert.equal(twoTools.rows[1].shareText, '50.0%');

const threeTools = C.build({ mag1: '12', min1: '15', mag2: '6', min2: '30', mag3: '2', min3: '120' });
assert.equal(threeTools.totalPoints, 124);
assert.equal(threeTools.rows.length, 3);
assert.equal(threeTools.rows[0].pointsText, '72');
assert.equal(threeTools.rows[2].pointsText, '16');
assert.equal(threeTools.rows[0].shareText, '58.1%');
assert.equal(threeTools.highestMagnitudeText, '12');
assert.equal(threeTools.timeToEavMinutes, 20.8);

// ---- Determinism and input immutability.
const pristine = { mag1: '12', min1: '15', mag2: '6', min2: '30', mag3: '2', min3: '120' };
const snapshot = JSON.stringify(pristine);
C.build(pristine);
assert.equal(JSON.stringify(pristine), snapshot, 'input is not mutated');
assert.equal(C.build({}).totalPoints, C.build({ mag1: '8', min1: '30', mag2: '', min2: '', mag3: '', min3: '' }).totalPoints,
  'deterministic');

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Hand-Arm Vibration Exposure Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.equal(record.sources.length, 2, 'two sources');
assert.equal(record.sources[0].url, 'https://www.hse.gov.uk/vibration/hav/readyreckoner.htm');
assert.equal(record.sources[1].url, 'https://www.hse.gov.uk/vibration/hav/advicetoemployers/index.htm');
assert.ok(record.method.length > 400, 'method explains the arithmetic');
assert.ok(record.tags.includes('vibration') && record.tags.includes('havs'), 'tags');

const others = catalog.tools.filter((tool) => tool.slug !== slug);
const takenSlugs = new Set(others.map((tool) => tool.slug));
const takenNames = new Set(others.map((tool) => tool.name.toLowerCase()));
const takenAliases = new Set();
for (const tool of others) for (const alias of tool.aliases || []) takenAliases.add(alias.toLowerCase());
assert.ok(!takenSlugs.has(slug), 'slug collides with another tool');
assert.ok(!takenNames.has(record.name.toLowerCase()), 'name collides with another tool');
for (const alias of record.aliases) {
  const key = alias.toLowerCase();
  assert.ok(!takenAliases.has(key), 'alias collides with another tool: ' + alias);
  assert.ok(!takenNames.has(key), 'alias repeats another tool name: ' + alias);
}
assert.ok(record.aliases.includes(record.name), 'the page title is listed as an alias');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'alias duplicates');

const keys = ['totalPoints', 'percentEav', 'percentElv', 'a8', 'status', 'toolCount',
  'largestLabel', 'largestPoints', 'timeToEavMinutes', 'timeToElvMinutes'];
let goldens = 0;
let refusals = 0;
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.input && testCase.expected, 'malformed case');
  if (testCase.kind === 'golden') {
    const result = C.build(testCase.input);
    for (const key of keys) {
      assert.equal(result[key], testCase.expected[key], testCase.name + ': ' + key);
    }
    goldens += 1;
  } else {
    assert.equal(testCase.kind, 'validation');
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    refusals += 1;
  }
}
assert.equal(goldens, 12, 'golden cases');
assert.equal(refusals, 11, 'refusal cases');

// ---- Page contract.
assert.match(html, /<title>Hand-Arm Vibration Exposure Calculator/);
assert.match(html, /<meta name="description" content="Add up a day of hand-arm vibration/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/tools.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-mag-1', 'in-min-1', 'in-mag-2', 'in-min-2', 'in-mag-3', 'in-min-3']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.ok(html.includes('role="status" aria-live="polite"'), 'live status');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>Hand-Arm Vibration Exposure Calculator</h1>'));
assert.ok(html.includes('<h3>How this is computed</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');
assert.ok(html.includes('not a risk assessment'), 'limits disclosure');

console.log('hand-arm vibration exposure calculator: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
