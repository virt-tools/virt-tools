/* Regression checks for the household emergency plan card core, its catalog
   cases, the plain-text rendering and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'household-emergency-plan-card';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* household-emergency-plan-card-core:start */';
const endMarker = '/* household-emergency-plan-card-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = EmergencyCardCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(C.build(input));
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

// ---- Library surface.
assert.deepEqual(plain(C.LIMITS.household), [1, 60, 'Household']);
assert.deepEqual(plain(C.LIMITS.members), [0, 10, 'Household members']);
assert.deepEqual(plain(C.LIMITS.memberPhone), [0, 32, 'Member phone']);
assert.equal(typeof C.lines, 'function');

// ---- Tidying is whitespace-only: every other character survives untouched.
const messy = run({
  household: '  Maple\t Street\n household ',
  indoor: '  front   steps  ',
  members: 'Ana R.\t,  07700 900123\n\n Ben',
  utilities: 'Gas meter in\nthe side passage.'
});
assert.equal(messy.household, 'Maple Street household');
assert.equal(messy.indoor, 'front steps');
assert.equal(messy.utilities, 'Gas meter in the side passage.');
assert.deepEqual(messy.members, [
  { name: 'Ana R.', phone: '07700 900123' },
  { name: 'Ben', phone: '' }
]);

// ---- Members split on the first comma only, and blank lines never count.
const split = run({ household: 'A', members: 'Ana, 555-0100, ext 2\n\n   \nBen' });
assert.equal(split.memberCount, 2);
assert.deepEqual(split.members[1], { name: 'Ben', phone: '' });
assert.deepEqual(split.members[0], { name: 'Ana', phone: '555-0100, ext 2' });

// ---- Gaps are reported, never invented.
const gaps = run({ household: 'A' });
assert.deepEqual(gaps.missing, ['emergency', 'meeting', 'contacts', 'shutOffs']);
assert.equal(gaps.emergency, '');
assert.equal(gaps.contact.name, '');
assert.equal(gaps.indoor, '');
const withOutdoor = run({ household: 'A', outdoor: 'the corner shop', members: 'Ben' });
assert.deepEqual(withOutdoor.missing, ['emergency', 'shutOffs']);
assert.equal(withOutdoor.members.length, 1);

// ---- Plain text: one section per block, gaps spelled out, phones kept whole.
const text = C.lines(run({
  household: 'Flat 3',
  emergency: '112',
  indoor: 'front steps',
  outdoor: '',
  contactName: 'Sam',
  contactPhone: '555 0100',
  members: 'Ana, 07700 900123',
  utilities: ''
}));
assert.equal(text[0], 'Flat 3');
assert.equal(text[2], 'EMERGENCY: 112');
assert.ok(text.includes('  Neighbourhood: not set'), 'blank meeting point is named');
assert.ok(text.includes('  Out of area: Sam · 555 0100'), 'contact and phone on one line');
assert.ok(text.includes('  Ana · 07700 900123'), 'member and phone on one line');
assert.ok(text.includes('  not set'), 'blank shut-offs are named');
assert.equal(text[text.length - 1], '  not set');
assert.ok(!/[<>]/.test(text.join('\n')), 'plain text carries no markup');
const bare = C.lines(run({ household: 'Flat 3' }));
assert.ok(bare.includes('  Household members: not set'), 'no members is stated, not omitted');

// ---- Length limits and list limits are enforced with named messages.
assert.equal(failure({ household: '   ' }), 'Household is required.');
assert.equal(failure({ household: 'x'.repeat(61) }), 'Household must be at most 60 characters.');
assert.equal(failure({ household: 'A', emergency: '9'.repeat(25) }), 'Emergency number must be at most 24 characters.');
assert.equal(failure({ household: 'A', contactPhone: '555 0100' }),
  'Add a name next to the out-of-area phone number.');
assert.equal(failure({ household: 'A', indoor: 'i'.repeat(81) }), 'Indoor meeting point must be at most 80 characters.');
assert.equal(failure({ household: 'A', utilities: 'u'.repeat(161) }), 'Shut-off notes must be at most 160 characters.');
assert.equal(failure({ household: 'A', members: ', 555' }),
  'Line 1 of household members needs a name before the comma.');
assert.equal(failure({ household: 'A', members: Array.from({ length: 11 }, (_, i) => 'P' + i).join('\n') }),
  'List at most 10 household members.');

// ---- The first ten members are accepted, the eleventh is not.
const ten = run({ household: 'A', members: Array.from({ length: 10 }, (_, i) => 'P' + i).join('\n') });
assert.equal(ten.memberCount, 10);

// ---- Catalog record: one entry, documented, with runnable cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'slug is unique');
const record = records[0];
assert.equal(record.name, 'Household Emergency Plan Card');
assert.equal(record.category, 'Safety & Emergency');
assert.equal(record.listed, true);
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.ok(record.method.length > 200, 'method is documented');
assert.ok(record.guidance.length > 80, 'scope guidance is recorded');
assert.deepEqual(record.sources, [], 'bespoke formatting carries no citation');
const kinds = (kind) => record.testCases.filter((item) => (item.kind || 'golden') === kind).length;
assert.equal(kinds('golden'), 2, 'two golden cases');
assert.equal(kinds('edge'), 2, 'two edge cases');
assert.equal(kinds('validation'), 6, 'six validation cases');
assert.equal(catalog.tools.length, 2397, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2137, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Safety & Emergency').length, 50, 'Safety & Emergency count');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.ok(other.slug !== slug, 'slug collides');
  assert.ok(!(other.aliases || []).some((alias) => alias.toLowerCase() === record.name.toLowerCase()),
    'name collides with an alias of ' + other.slug);
  assert.ok(!(other.aliases || []).includes(record.aliases[0]),
    'alias collides with ' + other.slug);
}
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ' ' + key);
  }
}

// ---- The page contract: local, labelled, keyboard reachable, mobile safe.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="plan-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/<h1>Household Emergency Plan Card<\/h1>/.test(html), 'page heading');
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'meta description');
const inputs = ['in-household', 'in-emergency', 'in-indoor', 'in-outdoor',
  'in-contact-name', 'in-contact-phone', 'in-members', 'in-utilities'];
for (const id of inputs) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'input #' + id);
  assert.ok(new RegExp('<label[^>]*\\bfor="' + id + '"').test(html), 'label for ' + id);
}
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');
const markupIds = new Set(ids);
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 12, 'the page looks up its controls');
for (const id of requestedIds) {
  assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
}
for (const id of ['err', 'card', 'warnings', 'copy', 'status', 'method']) {
  assert.ok(markupIds.has(id), 'page has #' + id);
}
assert.ok(/value="Our household"/.test(html), 'the page opens on a usable household name');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/min-height:44px/.test(html), 'touch targets');
assert.ok(/@media \(max-width:560px\)/.test(html), 'mobile layout');
assert.ok(/@media print/.test(html), 'the card has a print rule');

console.log('household emergency plan card: all checks passed');
