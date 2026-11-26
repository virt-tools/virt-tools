/* journald storage budget: the documented percentage defaults and the 4 GiB cap,
   the KeepFree interplay, the one-eighth and 128 MiB file rules, the MaxFiles bump,
   the page parser's refusals, the independent fixtures, the catalog cases and the
   page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'journald-storage-budget-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* journald-budget-core:start */';
const endMarker = '/* journald-budget-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = JournaldCore;', sandbox);
const C = sandbox.module.exports;

const plan = (input) => JSON.parse(JSON.stringify(C.plan(input)));
const refused = (input) => {
  try { C.plan(input); } catch (error) { return error.message; }
  return null;
};

// ---- The documented defaults: 10 % for the limit, 15 % for the reserve, both capped at 4 GiB.
assert.equal(C.useShare, 0.1);
assert.equal(C.keepShare, 0.15);
assert.equal(C.defaultCapMiB, 4096);
assert.equal(C.fileCapMiB, 128);
assert.equal(C.fileCountDefault, 100);
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(C.fsRange), [0.1, 100000]);
assert.deepEqual(plain(C.rateRange), [0.1, 100000]);

// ---- The default design: a 40 GiB filesystem with 28 GiB free and 200 MiB per day.
const base = plan({ fs: '40', free: '28', rate: '200' });
assert.equal(base.storage, 'system');
assert.equal(base.prefix, 'System');
assert.equal(base.fsMiB, 40960);
assert.equal(base.freeMiB, 28672);
assert.equal(base.defaultMaxUseMiB, 4096, '10 % of 40 GiB is exactly the 4 GiB cap');
assert.equal(base.cappedByDefault, false, 'the share reaches the cap exactly, so nothing was cut');
assert.equal(base.keepFreeMiB, 4096, '15 % of 40 GiB is 6,144 MiB, capped at 4 GiB');
assert.equal(base.maxUseMiB, 4096);
assert.equal(base.roomMiB, 24576);
assert.equal(base.limitMiB, 4096, 'the size limit binds, not the room above the reserve');
assert.equal(base.fileSizeMiB, 128, 'one eighth of 4 GiB is 512 MiB, capped at 128 MiB');
assert.equal(base.fileCapped, true);
assert.equal(base.filesNeeded, 32, '4 GiB in files of 128 MiB');
assert.equal(base.days, 20.48, '4,096 MiB at 200 MiB a day');
assert.deepEqual(base.config, ['[Journal]', 'Storage=persistent', 'SystemMaxUse=4G', 'SystemMaxFileSize=128M']);
assert.deepEqual(base.warnings, [], 'the default needs no warning');
assert.equal(base.keepFreeBinds, false);

// ---- The 4 GiB cap only cuts a default above 40 GiB; below it the percentage binds.
assert.equal(plan({ fs: '41', free: '41', rate: '200' }).cappedByDefault, true);
assert.equal(plan({ fs: '8', free: '8', rate: '50' }).maxUseMiB, 819.2);
assert.equal(plan({ fs: '8', free: '8', rate: '50' }).fileSizeMiB, 102.4);
assert.equal(plan({ fs: '8', free: '8', rate: '50' }).filesNeeded, 8, 'one eighth always gives eight files');
assert.equal(plan({ fs: '8', free: '8', rate: '50' }).cappedByDefault, false);

// ---- The KeepFree reserve cuts the limit when the filesystem is nearly full.
const squeezed = plan({ fs: '20', free: '4', rate: '200' });
assert.equal(squeezed.keepFreeMiB, 3072, '15 % of 20 GiB is 3,072 MiB, under the cap');
assert.equal(squeezed.maxUseMiB, 2048);
assert.equal(squeezed.roomMiB, 1024);
assert.equal(squeezed.limitMiB, 1024, 'only the room above the reserve is available');
assert.equal(squeezed.keepFreeBinds, true);
assert.equal(squeezed.days, 5.12);

// ---- When free space sits inside the reserve the page reports it and caps at what is free.
const reserve = plan({ fs: '40', free: '4', rate: '200' });
assert.equal(reserve.roomMiB, 0);
assert.equal(reserve.limitMiB, 4096);
assert.deepEqual(reserve.warnings, [
  'Free space is at or below the 15 % KeepFree reserve, so journald raises its limit to what is actually '
  + 'free and stops writing instead of deleting older files.'
]);
const thin = plan({ fs: '40', free: '4.1', rate: '200' });
assert.equal(thin.roomMiB, 102.4);
assert.equal(thin.limitMiB, 102.4);
assert.equal(thin.days, 0.51);
assert.deepEqual(thin.warnings, [
  'Under a day of logs fits at this limit; raise the size limit or lower the daily volume.'
]);

// ---- Exactly one day does not warn; a hair less does.
const oneDay = plan({ fs: '40', free: '28', rate: '200', limit: '200' });
assert.equal(oneDay.days, 1);
assert.deepEqual(oneDay.warnings, []);
assert.equal(oneDay.fileSizeMiB, 25, 'one eighth of a 200 MiB limit');
assert.equal(plan({ fs: '40', free: '28', rate: '200', limit: '199' }).warnings.length, 1);

// ---- The largest file is one eighth, capped at 128 MiB, and never rounds the file count down.
assert.equal(plan({ fs: '40', free: '28', rate: '100', limit: '1024' }).fileSizeMiB, 128);
assert.equal(plan({ fs: '40', free: '28', rate: '100', limit: '1024' }).fileCapped, false,
  'exactly 128 MiB is the cap, not over it');
assert.equal(plan({ fs: '40', free: '28', rate: '100', limit: '1024' }).filesNeeded, 8);
const over = plan({ fs: '40', free: '28', rate: '100', limit: '1025' });
assert.equal(over.fileSizeMiB, 128);
assert.equal(over.fileCapped, true);
assert.equal(over.filesNeeded, 9, '8.008 files round up to 9');

// ---- 100 files of 128 MiB cannot hold more than 12,800 MiB, so the drop-in raises the count.
const hundred = plan({ fs: '1024', free: '900', rate: '200', limit: '12800' });
assert.equal(hundred.filesNeeded, 100);
assert.equal(hundred.config.length, 4, 'no MaxFiles line at exactly 100');
const bumped = plan({ fs: '1024', free: '900', rate: '200', limit: '12928' });
assert.equal(bumped.filesNeeded, 101);
assert.deepEqual(bumped.config, ['[Journal]', 'Storage=persistent', 'SystemMaxUse=12928M',
  'SystemMaxFileSize=128M', 'SystemMaxFiles=101']);
assert.deepEqual(bumped.warnings, ['The default SystemMaxFiles=100 caps the journal below this limit, '
  + 'so the drop-in raises it to 101 files.']);

// ---- Volatile storage switches to the Runtime* settings.
const volatile = plan({ storage: 'runtime', fs: '4', free: '3', rate: '20' });
assert.equal(volatile.prefix, 'Runtime');
assert.equal(volatile.maxUseMiB, 409.6);
assert.equal(volatile.keepFreeMiB, 614.4);
assert.equal(volatile.fileSizeMiB, 51.2);
assert.equal(volatile.limitMiB, 409.6);
assert.equal(volatile.days, 20.48);
assert.deepEqual(volatile.config, ['[Journal]', 'Storage=volatile', 'RuntimeMaxUse=410M', 'RuntimeMaxFileSize=51M']);

// ---- A limit above the filesystem is called out rather than silently accepted.
const oversized = plan({ fs: '40', free: '28', rate: '200', limit: '50000' });
assert.equal(oversized.limitMiB, 24576, 'the room above the reserve still binds');
assert.deepEqual(oversized.warnings, [
  'The size limit is larger than the 40 GiB filesystem it lives on.',
  'The default SystemMaxFiles=100 caps the journal below this limit, so the drop-in raises it to 391 files.'
], 'a limit over the filesystem is called out, and so is the file count it needs');

// ---- Size tokens round to whole MiB and use G only for whole gibibytes.
assert.equal(C.sizeToken(4096), '4G');
assert.equal(C.sizeToken(819.2), '819M');
assert.equal(C.sizeToken(1024), '1G');
assert.equal(C.sizeToken(1025), '1025M');
assert.equal(C.sizeToken(128), '128M');

// ---- The parser refuses rather than guesses.
assert.equal(refused({ fs: '', free: '28', rate: '200' }),
  'Enter the filesystem size in GiB, such as 40.');
assert.equal(refused({ fs: '40g', free: '28', rate: '200' }),
  'Enter the filesystem size as a number of GiB, such as 40.');
assert.equal(refused({ fs: '0.05', free: '0.05', rate: '200' }),
  'Enter the filesystem size from 0.1 to 100,000 GiB.');
assert.equal(refused({ fs: '100001', free: '28', rate: '200' }),
  'Enter the filesystem size from 0.1 to 100,000 GiB.');
assert.equal(refused({ fs: '40', free: '50', rate: '200' }),
  'Free space cannot exceed the 40 GiB filesystem.');
assert.equal(refused({ fs: '40', free: '28', rate: '0' }),
  'Enter the daily log volume from 0.1 to 100,000 MiB.');
assert.equal(refused({ fs: '40', free: '28', rate: '200', limit: '0' }),
  'Enter the size limit from 1 to 100,000,000 MiB.');
assert.equal(refused({ storage: 'disk', fs: '40', free: '28', rate: '200' }),
  'Choose persistent or volatile storage.');
assert.equal(refused({ fs: '40', free: '-1', rate: '200' }),
  'Enter the free space as a number of GiB, such as 28.');

// ---- The independent fixtures: every figure rebuilt in Python from the documented rules.
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/journald_storage_cases.json'), 'utf8'));
assert.ok(fixtures.cases.length >= 18, 'the fixture set covers defaults, caps, reserves and both storages');
for (const item of fixtures.cases) {
  const actual = plan(item.input);
  for (const [key, value] of Object.entries(item.expected)) {
    if (key === 'warnings') continue;
    assert.deepEqual(actual[key], value, item.name + ': ' + key);
  }
  assert.equal(actual.warnings.length, item.expected.warnings.length, item.name + ': warning count');
  assert.equal(actual.limitMiB <= actual.maxUseMiB, true, item.name + ': the limit never exceeds the setting');
  assert.equal(actual.limitMiB <= Math.max(actual.freeMiB, 0), true, item.name + ': the limit fits the free space');
}

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.name, 'journald Storage Budget Planner');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(typeof record.method, 'string', 'method is a plain string');
assert.equal(typeof record.guidance, 'string', 'guidance is a plain string');
assert.ok(record.sources.length >= 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\//);
const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 10, validation: 9 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(refused(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plan(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: name, slug and aliases stay distinct.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  const owners = catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase()));
  assert.deepEqual(owners.map((tool) => tool.slug), [slug], 'alias is unique: ' + alias);
}
for (const tag of record.tags) assert.ok(tag.length > 1);

// ---- Page contract: one self-contained page on the shared shell.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>journald Storage Budget Planner<\/h1>/);
assert.match(html, /<form id="journald-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
for (const id of ['storage', 'fs', 'free', 'rate', 'limit']) {
  assert.match(html, new RegExp('<label for="' + id + '">'), 'label for ' + id);
}
assert.match(html, /<input id="fs"[^>]*value="40"/);
assert.match(html, /<input id="free"[^>]*value="28"/);
assert.match(html, /<input id="rate"[^>]*value="200"/);
assert.match(html, /<input id="limit"[^>]*value=""[^>]*placeholder="journald default"/);
assert.match(html, /<option value="system" selected>/);
assert.match(html, /<option value="runtime">/);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas|<svg/.test(html), 'no embedded media');
assert.match(html, /aria-hidden="true"/, 'the usage bar is decorative');
assert.match(html, /nothing is sent anywhere else/i, 'the privacy note stays on the page');
assert.equal((html.match(/\/\* journald-budget-core:start \*\//g) || []).length, 1);

console.log('journald-storage-budget-planner: percentage defaults, 4 GiB cap, KeepFree reserve, '
  + 'one-eighth file size, MaxFiles bump, refusals, ' + fixtures.cases.length + ' fixtures, '
  + record.testCases.length + ' catalog cases, uniqueness and page contract OK');
