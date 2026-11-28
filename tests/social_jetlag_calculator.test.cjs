/* Social jetlag calculator: the mid-sleep arithmetic, the page markup and the
   catalog record's twenty-three cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'social-jetlag-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* social-jetlag-core:start */';
const endMarker = '/* social-jetlag-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SocialJetlagCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};

// ---- Time parsing and window lengths.
assert.equal(C.parseTime('23:00', 'workday bedtime'), 1380);
assert.equal(C.parseTime(' 7:05 ', 'workday wake time'), 425);
assert.equal(C.parseTime('07:05:00', 'workday wake time'), 425);
assert.equal(failure({ workBed: '23:00', workWake: '07:00', freeBed: '24:01', freeWake: '09:00' }),
  'The free-day bedtime "24:01" is not a valid 24-hour time; hours run from 00 to 23 and minutes from 00 to 59.');
assert.equal(failure({ workBed: '7', workWake: '07:00', freeBed: '01:00', freeWake: '09:00' }),
  'The workday bedtime "7" is not a 24-hour time; use HH:MM, for example 23:00.');
assert.equal(C.durationOf(C.parseTime('23:00', 'bed'), C.parseTime('07:00', 'wake'), 'workday'), 480);
assert.equal(C.durationOf(C.parseTime('22:15', 'bed'), C.parseTime('06:45', 'wake'), 'workday'), 510);
assert.equal(C.durationOf(C.parseTime('09:00', 'bed'), C.parseTime('23:00', 'wake'), 'workday'), 840);
assert.equal(failure({ workBed: '09:00', workWake: '09:00', freeBed: '01:00', freeWake: '09:00' }),
  'The workday bedtime and wake time are the same (09:00); a sleep window must differ and may cross midnight, up to 16 hours.');
assert.equal(failure({ workBed: '20:00', workWake: '13:00', freeBed: '01:00', freeWake: '09:00' }),
  'The workday window runs 20:00 to 13:00, which is 17 h; enter a main sleep window of at most 16 hours.');

// ---- Midpoints, wrapping and formatting.
assert.equal(C.midpointOf(1380, 480), 180);
assert.equal(C.midpointOf(60, 480), 300);
assert.equal(C.signedShift(180, 300), 120);
assert.equal(C.signedShift(300, 180), -120);
assert.equal(C.signedShift(1430, 10), 20);
assert.equal(C.signedShift(10, 1430), -20);
assert.equal(C.signedShift(0, 720), 720);
assert.equal(C.fmtClock(160.5), '02:41');
assert.equal(C.fmtClock(0), '00:00');
assert.equal(C.fmtClock(1439.6), '00:00');
assert.equal(C.fmtDuration(45), '45 min');
assert.equal(C.fmtDuration(60), '1 h');
assert.equal(C.fmtDuration(90), '1 h 30 min');
assert.equal(C.fmtDuration(480), '8 h');
assert.equal(C.fmtSignedDuration(0), '0 min');
assert.equal(C.fmtSignedDuration(60), '+1 h');
assert.equal(C.fmtSignedDuration(-90), '\u22121 h 30 min');

// ---- The build contract.
const base = C.build({});
assert.equal(base.shift, 120);
assert.equal(base.socialJetlag, 120);
assert.equal(base.workDuration, 480);
assert.equal(base.freeDuration, 480);
assert.equal(base.workMidText, '03:00');
assert.equal(base.freeMidText, '05:00');
assert.equal(base.jetlagText, '2 h');
assert.equal(base.gapText, '0 min');
assert.equal(base.directionText, 'later');
assert.equal(base.statusText, 'Free-day mid-sleep is 2 h later than on workdays');
assert.equal(base.warnings.length, 0);
assert.equal(base.explanation.length, 6);
assert.match(base.summary, /^Mid-sleep is 03:00 on workdays and 05:00 on free days/);

const earlier = C.build({ workBed: '23:00', workWake: '07:00', freeBed: '18:00', freeWake: '02:00' });
assert.equal(earlier.shift, -300);
assert.equal(earlier.directionText, 'earlier');
assert.equal(earlier.statusText, 'Free-day mid-sleep is 5 h earlier than on workdays');

const same = C.build({ workBed: '23:00', workWake: '07:00', freeBed: '23:30', freeWake: '06:30' });
assert.equal(same.shift, 0);
assert.equal(same.jetlagText, '0 min');
assert.equal(same.statusKind, 'flat');
assert.equal(same.gapText, '\u22121 h');

const longFree = C.build({ workBed: '23:00', workWake: '05:00', freeBed: '01:00', freeWake: '09:00' });
assert.equal(longFree.lengthGap, 120);
assert.ok(longFree.warnings.some((line) => line.includes('Free-day sleep is 2 h longer')));

const halfDay = C.build({ workBed: '20:00', workWake: '04:00', freeBed: '08:00', freeWake: '16:00' });
assert.equal(halfDay.shift, 720);
assert.ok(halfDay.warnings.some((line) => line.includes('twelve-hour difference')));

const odd = C.build({ workBed: '23:10', workWake: '06:11', freeBed: '00:40', freeWake: '08:11' });
assert.equal(odd.workDuration, 421);
assert.equal(odd.workMidText, '02:41');
assert.equal(odd.freeMidText, '04:26');
assert.equal(odd.shift, 105);

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Social Jetlag Calculator');
assert.equal(record.category, 'Health');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.equal(record.sources.length, 1, 'one source');
assert.match(record.sources[0].url, /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/16687322\/$/);
assert.match(record.sources[0].title, /Wittmann/);
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

const keys = ['shift', 'socialJetlag', 'workDuration', 'freeDuration', 'workMidText', 'freeMidText', 'jetlagText', 'gapText', 'directionText'];
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
assert.equal(goldens, 16, 'golden cases');
assert.equal(refusals, 7, 'refusal cases');
assert.equal(C.build({}).shift, C.build({ workBed: '23:00', workWake: '07:00', freeBed: '01:00', freeWake: '09:00' }).shift, 'deterministic');

const pristine = { workBed: '23:00', workWake: '07:00', freeBed: '01:00', freeWake: '09:00' };
const snapshot = JSON.stringify(pristine);
C.build(pristine);
assert.equal(JSON.stringify(pristine), snapshot, 'input is not mutated');

// ---- Page contract.
assert.match(html, /<title>Social Jetlag Calculator/);
assert.match(html, /<meta name="description" content="Compare weekday and free-day/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/tools.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-work-bed', 'in-work-wake', 'in-free-bed', 'in-free-wake']) {
  assert.ok(html.includes('id="' + id + '"'), 'input ' + id);
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
}
assert.ok(html.includes('role="status" aria-live="polite"'), 'live status');
assert.ok(html.includes('role="alert"'), 'error alert');
assert.ok(html.includes('aria-label="Sleep windows on an evening-to-evening axis"'), 'chart label');
assert.ok((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), 'button types');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline handlers');
assert.ok(!/eval\(|new Function\(/.test(html), 'no eval');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/https?:\/\//.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, '')), 'no off-site references in markup');
assert.equal((html.match(/<script(?![^>]*\bsrc=)/g) || []).length, 1, 'one inline script');
assert.ok(html.includes('<h1>Social Jetlag Calculator</h1>'));
assert.ok(html.includes('<h3>How this is computed</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');

console.log('social jetlag calculator: ' + goldens + ' goldens, ' + refusals + ' refusals, page and catalog contract ok');
