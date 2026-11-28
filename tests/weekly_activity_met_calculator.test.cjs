/* Weekly activity MET calculator: the GPAQ volume arithmetic, the page markup
   and the catalog record's twenty-one cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'weekly-activity-met-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* weekly-activity-met-core:start */';
const endMarker = '/* weekly-activity-met-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = WeeklyActivityMetCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

// ---- Parsing, formatting and rounding.
assert.equal(C.parseCount('', 'Days', 7), 0);
assert.equal(C.parseCount('  2  ', 'Days', 7), 2);
assert.equal(C.parseCount('07', 'Days', 7), 7);
assert.equal(C.parseCount(7, 'Days', 7), 7);
assert.equal(failure({ vigWorkDays: '8' }),
  'Vigorous work days must be a whole number from 0 to 7; got "8".');
assert.equal(failure({ vigWorkDays: '2.5', vigWorkMins: 30 }),
  'Vigorous work days must be a whole number from 0 to 7; got "2.5".');
assert.equal(failure({ vigWorkDays: '123456789012345678901', vigWorkMins: 30 }),
  'Vigorous work days must be a whole number from 0 to 7; got "1234567890123456...".');
assert.equal(C.fmtInt(0), '0');
assert.equal(C.fmtInt(640), '640');
assert.equal(C.fmtInt(2660), '2,660');
assert.equal(C.fmtInt(80640), '80,640');
assert.equal(C.roundTo(22.857142, 1), 22.9);
assert.equal(C.roundTo(73.571428, 1), 73.6);
assert.equal(C.roundTo(0, 1), 0);
assert.ok(Object.is(C.roundTo(0, 1), 0), 'no negative zero');

const zero = { vigWorkDays: 0, vigWorkMins: 0, modWorkDays: 0, modWorkMins: 0, travelDays: 0, travelMins: 0,
  vigLeisureDays: 0, vigLeisureMins: 0, modLeisureDays: 0, modLeisureMins: 0 };
const isolated = (overrides) => C.build(Object.assign({}, zero, overrides));

// ---- The build contract.
const base = C.build({});
assert.equal(base.totalMetMinutes, 640);
assert.equal(base.moderateEquivalentMinutes, 160);
assert.equal(base.totalMinutes, 160);
assert.equal(base.averageMinutesPerDay, 22.9);
assert.equal(base.meetsRecommendation, true);
assert.equal(base.remainingMetMinutes, 0);
assert.equal(base.travelMet, 400);
assert.equal(base.moderateLeisureMet, 240);
assert.equal(base.largestLabel, 'Travel on foot or by bicycle');
assert.equal(base.statusText, '640 MET-minutes a week, 40 above the 600 MET-minute recommendation');
assert.equal(base.rows.length, 5);
assert.equal(base.rows[2].shareText, '62.5%');
assert.equal(base.rows[4].shareText, '37.5%');
assert.equal(base.warnings.length, 0);
assert.ok(base.explanation.length >= 6);
assert.match(base.summary, /^Your week adds up to 640 MET-minutes/);

const exact = isolated({ modWorkDays: 5, modWorkMins: 30 });
assert.equal(exact.totalMetMinutes, 600);
assert.equal(exact.moderateEquivalentMinutes, 150);
assert.equal(exact.statusText, '600 MET-minutes a week, exactly at the 600 MET-minute recommendation');

const short = isolated({ modLeisureDays: 1, modLeisureMins: 149 });
assert.equal(short.totalMetMinutes, 596);
assert.equal(short.remainingMetMinutes, 4);
assert.equal(short.meetsRecommendation, false);
assert.equal(short.statusText, '596 MET-minutes a week, 4 short of the 600 MET-minute recommendation');

const vigorous = isolated({ vigLeisureDays: 1, vigLeisureMins: 75 });
assert.equal(vigorous.vigorousLeisureMet, 600);
assert.equal(vigorous.totalMinutes, 75);
assert.equal(vigorous.statusText, '600 MET-minutes a week, exactly at the 600 MET-minute recommendation');

const heavyWork = isolated({ vigWorkDays: 5, vigWorkMins: 60, modWorkDays: 5, modWorkMins: 60 });
assert.equal(heavyWork.totalMetMinutes, 3600);
assert.equal(heavyWork.moderateEquivalentMinutes, 900);
assert.equal(heavyWork.averageMinutesPerDay, 85.7);

const empty = isolated({});
assert.equal(empty.totalMetMinutes, 0);
assert.equal(empty.averageMinutesPerDay, 0);
assert.equal(empty.meetsRecommendation, false);
assert.equal(empty.remainingMetMinutes, 600);
assert.equal(empty.largestLabel, 'None');
assert.equal(empty.statusText, 'No activity entered: 0 MET-minutes a week');
assert.equal(empty.warnings.length, 1);

const longDay = isolated({ vigWorkDays: 7, vigWorkMins: 300 });
assert.equal(longDay.totalMetMinutes, 16800);
assert.equal(longDay.warnings.length, 1);
assert.match(longDay.warnings[0], /300 minutes on an active day/);

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Weekly Activity MET Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 21, 'catalog case count');
assert.equal(record.sources.length, 2, 'two sources');
assert.match(record.sources[0].url, /^https:\/\/cdn\.who\.int\/media\/docs\/default-source\/ncds\/ncd-surveillance\/gpaq-analysis-guide\.pdf$/);
assert.match(record.sources[1].url, /^https:\/\/www\.who\.int\/news-room\/fact-sheets\/detail\/physical-activity$/);
assert.ok(record.method.length > 400, 'method explains the arithmetic');

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

const keys = ['totalMetMinutes', 'moderateEquivalentMinutes', 'totalMinutes', 'averageMinutesPerDay',
  'meetsRecommendation', 'remainingMetMinutes', 'vigorousWorkMet', 'moderateWorkMet', 'travelMet',
  'vigorousLeisureMet', 'moderateLeisureMet'];
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
assert.equal(refusals, 9, 'refusal cases');
assert.equal(C.build({}).totalMetMinutes, C.build({ travelDays: 5, travelMins: 20, modLeisureDays: 2, modLeisureMins: 30 }).totalMetMinutes, 'deterministic');

const pristine = { vigWorkDays: 2, vigWorkMins: 30, modWorkDays: 4, modWorkMins: 45, travelDays: 5, travelMins: 25, vigLeisureDays: 2, vigLeisureMins: 45, modLeisureDays: 1, modLeisureMins: 60 };
const snapshot = JSON.stringify(pristine);
C.build(pristine);
assert.equal(JSON.stringify(pristine), snapshot, 'input is not mutated');

// ---- Page contract.
assert.match(html, /<title>Weekly Activity MET Calculator/);
assert.match(html, /<meta name="description" content="Add up a typical week/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/tools.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-vig-work-days', 'in-vig-work-mins', 'in-mod-work-days', 'in-mod-work-mins', 'in-travel-days', 'in-travel-mins', 'in-vig-leisure-days', 'in-vig-leisure-mins', 'in-mod-leisure-days', 'in-mod-leisure-mins']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.ok(html.includes('role="status" aria-live="polite"'), 'live status');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok(html.includes('aria-label="MET-minutes a week by activity domain"'), 'chart label');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>Weekly Activity MET Calculator</h1>'));
assert.ok(html.includes('<h3>How this is computed</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');

console.log('weekly activity MET calculator: ' + goldens + ' goldens, ' + refusals + ' refusals, page and catalog contract ok');
