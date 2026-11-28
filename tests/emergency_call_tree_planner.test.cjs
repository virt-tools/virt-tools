/* Emergency call tree planner: tree construction, tier timing, the page
   markup and the catalog record's twenty-three cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'emergency-call-tree-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* emergency-call-tree-core:start */';
const endMarker = '/* emergency-call-tree-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Error, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmergencyCallTreeCore;', sandbox);
const C = sandbox.module.exports;

const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};
const names = (count) => Array.from({ length: count }, (_, i) => 'Person ' + String(i + 1).padStart(2, '0')).join('\n');

// ---- Constants, parsing and formatting.
assert.equal(C.MAX_PEOPLE, 60);
assert.equal(C.MAX_NAME, 40);
assert.equal(C.MIN_MINUTES, 1);
assert.equal(C.MAX_MINUTES, 60);
assert.equal(C.MIN_BRANCH, 1);
assert.equal(C.MAX_BRANCH, 8);
assert.equal(JSON.stringify(C.parseRoster(' Ana \n\n  Ben   Okafor \n')), JSON.stringify(['Ana', 'Ben Okafor']));
assert.equal(failure({ roster: 'Ana\nana' }),
  'The name "ana" appears twice; list each person once.');
assert.equal(failure({ roster: 'Ana\n' + 'x'.repeat(41) }),
  'The name "' + 'x'.repeat(16) + '..." is longer than 40 characters; shorten it or use initials.');
assert.equal(failure({ roster: 'Ana' }),
  'Enter at least two names, one per line; the first name is the coordinator.');
assert.equal(failure({ roster: names(61) }), 'The list has 61 names; this planner takes at most 60.');
assert.equal(C.parseMinutes('2'), 2);
assert.equal(C.parseMinutes(2), 2);
assert.equal(failure({ roster: 'Ana\nBen', minutes: '2.5' }),
  'Call length must be a whole number of minutes from 1 to 60; got "2.5".');
assert.equal(failure({ roster: 'Ana\nBen', minutes: '' }),
  'Call length must be a whole number of minutes from 1 to 60; got "".');
assert.equal(failure({ roster: 'Ana\nBen', branch: '9' }),
  'Calls per person must be a whole number from 1 to 8; got "9".');
assert.equal(failure({ roster: 'Ana\nBen', branch: 'two' }),
  'Calls per person must be a whole number from 1 to 8; got "two".');
assert.equal(C.timeText(6), '6 min');
assert.equal(C.timeText(59), '59 min');
assert.equal(C.timeText(60), '1 h');
assert.equal(C.timeText(120), '2 h');
assert.equal(C.timeText(75), '1 h 15 min');
assert.equal(C.fmtInt(7), '7');
assert.equal(C.fmtInt(1200), '1,200');

// ---- The default roster.
const base = C.build({});
assert.equal(base.people, 8);
assert.equal(base.calls, 7);
assert.equal(base.tiers, 3);
assert.equal(base.totalMinutes, 6);
assert.equal(base.totalText, '6 min');
assert.equal(base.coordinatorCalls, 2);
assert.equal(base.busiestCalls, 4);
assert.equal(base.busiestTier, 2);
assert.equal(base.capacity, 15);
assert.equal(base.tierRows.length, 3);
assert.equal(JSON.stringify(base.tierRows.map((row) => row.reached)), JSON.stringify([3, 7, 8]));
assert.equal(JSON.stringify(base.tierRows.map((row) => row.elapsedText)), JSON.stringify(['2 min', '4 min', '6 min']));
assert.equal(base.tree.length, 4);
assert.equal(JSON.stringify(base.tree[0].calls), JSON.stringify([base.names[1], base.names[2]]));
assert.match(base.summary, /^Alex Rivera starts and the tree reaches all 8 people in 3 tiers\./);
assert.match(base.statusText, /^8 people, 7 calls, 3 tiers: 6 min to the last person\.$/);
assert.ok(base.explanation.length >= 6);
assert.equal(base.warnings.length, 0);

// Every person except the coordinator is called exactly once, in a tier they
// can only reach after their caller.
for (const payload of [{}, { roster: names(31), branch: '4' }, { roster: names(60), branch: '2' },
  { roster: names(5), branch: '1' }]) {
  const result = C.build(payload);
  const called = result.tree.flatMap((node) => node.calls.map((name) => result.names.indexOf(name)));
  assert.equal(called.length, result.people - 1, 'one call per person');
  assert.equal(new Set(called).size, result.people - 1, 'no one is called twice');
  assert.ok(!called.includes(0), 'the coordinator is not called');
  assert.equal(result.tierRows[result.tierRows.length - 1].reached, result.people);
}

// ---- Boundaries and the chain case.
const chain = C.build({ roster: 'Ana\nBen\nCid\nDee\nEve', minutes: '4', branch: '1' });
assert.equal(chain.tiers, 4);
assert.equal(chain.totalMinutes, 16);
assert.equal(chain.busiestCalls, 1);
assert.equal(chain.busiestTier, 1);
assert.equal(chain.capacity, 5);
assert.equal(chain.warnings.length, 1);
assert.match(chain.warnings[0], /chain/);
assert.equal(chain.tree.length, 4);
assert.equal(chain.tree[0].calls.length, 1);

const hour = C.build({ roster: names(3), minutes: '60', branch: '1' });
assert.equal(hour.totalMinutes, 120);
assert.equal(hour.totalText, '2 h');

const wide = C.build({ roster: names(60), minutes: '3', branch: '2' });
assert.equal(wide.tiers, 5);
assert.equal(wide.totalMinutes, 15);
assert.equal(wide.busiestCalls, 29);
assert.equal(wide.busiestTier, 5);
assert.equal(wide.capacity, 63);

// ---- Determinism and input immutability.
const pristine = { roster: C.DEFAULTS.roster, minutes: '2', branch: '2' };
const snapshot = JSON.stringify(pristine);
C.build(pristine);
assert.equal(JSON.stringify(pristine), snapshot, 'input is not mutated');
assert.equal(C.build({}).tiers, C.build({ roster: C.DEFAULTS.roster, minutes: '2', branch: '2' }).tiers,
  'deterministic');

// ---- The catalog record and every case in it.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Emergency Call Tree Planner');
assert.equal(record.category, 'Safety & Emergency');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.legacyCategory, null);
assert.ok(record.description.length >= 80 && record.description.length <= 300, 'description length');
assert.equal(record.testCases.length, 23, 'catalog case count');
assert.equal(record.sources.length, 0, 'bespoke arithmetic carries no citation');
assert.ok(record.method.length > 400, 'method explains the arithmetic');
assert.ok(record.tags.includes('emergency') && record.tags.includes('telephone-tree'), 'tags');
assert.ok(record.guidance.length > 40, 'guidance');

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

const keys = ['people', 'calls', 'tiers', 'totalMinutes', 'totalText', 'coordinatorCalls',
  'busiestCalls', 'busiestTier'];
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
assert.match(html, /<title>Emergency Call Tree Planner/);
assert.match(html, /<meta name="description" content="Turn a roster into an emergency telephone tree/);
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/theme-init.js'));
assert.ok(html.includes('/assets/tools.js'));
assert.ok(html.includes('/assets/app.js'));
for (const id of ['in-roster', 'in-minutes', 'in-branch']) {
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
assert.ok(html.includes('<h1>Emergency Call Tree Planner</h1>'));
assert.ok(html.includes('<h3>How this is computed</h3>'));
assert.ok(html.includes('Nothing is saved'), 'storage disclosure');
assert.ok(html.includes('No calls are made'), 'limits disclosure');

console.log('emergency call tree planner: ' + goldens + ' goldens, ' + refusals +
  ' refusals, page and catalog contract ok');
