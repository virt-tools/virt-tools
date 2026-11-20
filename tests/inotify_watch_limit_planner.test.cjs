/* inotify watch limits: the per-user watch arithmetic, the queue target, the
   formatter, the parser's refusals, the comparison statuses, the snippet floor,
   the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'inotify-watch-limit-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* inotify-limits-core:start */';
const endMarker = '/* inotify-limits-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = InotifyLimitsCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};

const base = () => ({
  directories: '2400',
  files: '0',
  processes: '2',
  rate: '400',
  drain: '2',
  headroom: '20'
});

// ---- The arithmetic, restated as an independent model.
const roundUp = (value) => (value <= 0 ? 0 : Math.ceil(value - 1e-9));
const model = (directories, files, processes, rate, drain, headroom) => ({
  watchesPerProcess: directories + files,
  watchesPerUser: (directories + files) * processes,
  watchesTarget: roundUp((directories + files) * processes * (1 + headroom / 100)),
  queueRaw: rate * drain,
  queueTarget: roundUp(rate * drain * (1 + headroom / 100)),
  instancesNeeded: processes
});

// Deterministic pseudo-random sweep with a small LCG.
let seed = 20261120;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let step = 0; step < 300; step += 1) {
  const directories = Math.floor(next() * 40000);
  const files = Math.floor(next() * 500);
  const processes = 1 + Math.floor(next() * 8);
  const rate = Math.round(next() * 20000) / 10;
  const drain = Math.round((0.1 + next() * 30) * 100) / 100;
  const headroom = Math.round(next() * 400) / 2;
  const result = C.calculate({
    directories, files, processes, rate, drain, headroom
  });
  const want = model(directories, files, processes, rate, drain, headroom);
  assert.deepEqual(
    {
      watchesPerProcess: result.watchesPerProcess,
      watchesPerUser: result.watchesPerUser,
      watchesTarget: result.watchesTarget,
      queueRaw: result.queueRaw,
      queueTarget: result.queueTarget,
      instancesNeeded: result.instancesNeeded
    },
    want,
    'model at case ' + step
  );
  assert.ok(Number.isInteger(result.watchesTarget), 'the watch target is a whole number');
  assert.ok(Number.isInteger(result.queueTarget), 'the queue target is a whole number');
}

// ---- Rounding: a whole target is reached without counting binary dust, and a
// fractional need always rounds up.
assert.equal(C.roundUp(0), 0);
assert.equal(C.roundUp(0.25), 1);
assert.equal(C.roundUp(1200 * 1.1), 1320);
assert.equal(C.roundUp(0.75 * 1.1), 1);

// ---- Thousands separators.
assert.equal(C.group(0), '0');
assert.equal(C.group(999), '999');
assert.equal(C.group(1024), '1,024');
assert.equal(C.group(5000000), '5,000,000');

// ---- The defaults on the page.
const defaults = C.calculate(base());
assert.deepEqual(plain({
  watchesPerProcess: defaults.watchesPerProcess,
  watchesPerUser: defaults.watchesPerUser,
  watchesTarget: defaults.watchesTarget,
  queueRaw: defaults.queueRaw,
  queueTarget: defaults.queueTarget,
  instancesNeeded: defaults.instancesNeeded
}), {
  watchesPerProcess: 2400,
  watchesPerUser: 4800,
  watchesTarget: 5760,
  queueRaw: 800,
  queueTarget: 960,
  instancesNeeded: 2
});
assert.equal(defaults.headline, '5,760 watches per user');
assert.equal(defaults.summary,
  '2,400 directories + 0 individually watched files = 2,400 watches per process; 2 processes = 4,800 watches per user, and 20% headroom takes the target to 5,760.');
assert.equal(defaults.queueSummary,
  '800 events between drains at 400 events/s over 2 s; with 20% headroom the queue target is 960 events per instance.');
assert.equal(defaults.capacity, '');
assert.equal(defaults.snippet, null);
assert.deepEqual(plain(defaults.rows.map((row) => row.status)), ['not-entered', 'not-entered', 'not-entered']);

// ---- Singular wording at one watch and one process, and the zero-rate path.
const single = C.calculate({ directories: '1', files: '0', processes: '1', rate: '0', drain: '1', headroom: '0' });
assert.equal(single.headline, '1 watch per user');
assert.equal(single.summary,
  '1 directory + 0 individually watched files = 1 watch per process; 1 process = 1 watch per user, and 0% headroom takes the target to 1.');
assert.equal(single.queueSummary,
  'No queue growth is added when the peak rate is 0; the queue target stays at 0 events.');
assert.equal(single.queueTarget, 0);

// ---- Comparison statuses.
assert.equal(C.statusFor(null, 10, 20), 'not-entered');
assert.equal(C.statusFor(9, 10, 20), 'too-low');
assert.equal(C.statusFor(10, 10, 20), 'below-target');
assert.equal(C.statusFor(20, 10, 20), 'sufficient');

const comfortable = C.calculate(Object.assign(base(), { currentWatches: '8192', currentInstances: '128', currentQueue: '16384' }));
assert.deepEqual(plain(comfortable.rows.map((row) => row.status)), ['sufficient', 'sufficient', 'sufficient']);
assert.equal(comfortable.capacity,
  'At 8,192 watches and 2 processes, each process can watch up to 4,096 directories (1,696 spare beyond the 2,400 you listed).');
assert.equal(comfortable.snippet,
  '# /etc/sysctl.d/60-inotify.conf\nfs.inotify.max_user_watches = 8192\nfs.inotify.max_user_instances = 128\nfs.inotify.max_queued_events = 16384');

const tight = C.calculate(Object.assign(base(), { currentWatches: '4800', currentInstances: '2', currentQueue: '800' }));
assert.deepEqual(plain(tight.rows.map((row) => row.status)), ['below-target', 'sufficient', 'below-target']);
assert.equal(tight.capacity, 'At 4,800 watches and 2 processes, each process can watch up to 2,400 directories (exactly the 2,400 you listed).');

const short = C.calculate({
  directories: '2400', files: '100', processes: '3', rate: '400', drain: '2', headroom: '20',
  currentWatches: '5000', currentInstances: '1', currentQueue: '500'
});
assert.deepEqual(plain(short.rows.map((row) => row.status)), ['too-low', 'too-low', 'too-low']);
assert.equal(short.capacity, 'At 5,000 watches and 3 processes, each process can watch up to 1,566 directories; the 2,400 you listed do not fit.');

// ---- The snippet never lowers a limit, and stays absent until all three are known.
for (let step = 0; step < 120; step += 1) {
  const currentWatches = String(1 + Math.floor(next() * 200000));
  const currentInstances = String(1 + Math.floor(next() * 500));
  const currentQueue = String(1 + Math.floor(next() * 100000));
  const result = C.calculate(Object.assign(base(), { currentWatches, currentInstances, currentQueue }));
  const values = {};
  for (const line of result.snippet.split('\n').slice(1)) {
    const [key, value] = line.split(' = ');
    values[key.trim()] = Number(value);
  }
  assert.ok(values['fs.inotify.max_user_watches'] >= Number(currentWatches), 'watches never lowered');
  assert.ok(values['fs.inotify.max_user_watches'] >= result.watchesTarget, 'watches reach the target');
  assert.ok(values['fs.inotify.max_user_instances'] >= Number(currentInstances), 'instances never lowered');
  assert.ok(values['fs.inotify.max_user_instances'] >= result.instancesNeeded, 'instances reach the floor');
  assert.ok(values['fs.inotify.max_queued_events'] >= Number(currentQueue), 'queue never lowered');
  assert.ok(values['fs.inotify.max_queued_events'] >= result.queueTarget, 'queue reaches the target');
}
assert.equal(C.calculate(Object.assign(base(), { currentWatches: '8192' })).snippet, null);
assert.equal(C.calculate(Object.assign(base(), { currentInstances: '128', currentQueue: '16384' })).snippet, null);

// ---- Refusals.
assert.equal(failure(Object.assign(base(), { directories: '' })), 'Enter the number of directories, such as 2400.');
assert.equal(failure(Object.assign(base(), { directories: 'two thousand' })), 'Enter the number of directories as a whole number, such as 2400.');
assert.equal(failure(Object.assign(base(), { directories: '-4' })), 'Enter the number of directories as a whole number, such as 2400.');
assert.equal(failure(Object.assign(base(), { directories: '5000001' })), 'Directories must be between 0 and 5,000,000.');
assert.equal(failure(Object.assign(base(), { files: '' })), 'Enter the number of files, such as 0.');
assert.equal(failure(Object.assign(base(), { processes: '0' })), 'Processes must be between 1 and 4,096.');
assert.equal(failure(Object.assign(base(), { rate: 'bursty' })), 'Enter the peak event rate as a number, such as 400.');
assert.equal(failure(Object.assign(base(), { drain: '0' })), 'The drain interval must be between 0.1 and 3,600 seconds.');
assert.equal(failure(Object.assign(base(), { headroom: '1001' })), 'Headroom must be between 0 and 1,000 percent.');
assert.equal(failure(Object.assign(base(), { currentWatches: '12k' })), 'max_user_watches must be a whole number, or left empty.');
assert.equal(failure({}), 'Enter the number of directories, such as 2400.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'the slug appears once');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 2);
for (const source of record.sources) assert.match(source.url, /^https:\/\/man7\.org\//);
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 53, 'System count');
assert.equal(catalog.tools.length, 2428, 'catalog total');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2167, 'public total');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 10 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.calculate(testCase.input));
  actual.statuses = actual.rows.map((row) => row.status).join(',');
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(actual[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: slug, name and aliases stay distinct.
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
assert.match(html, /<h1>inotify Watch Limit Planner<\/h1>/);
assert.match(html, /<form id="iw-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 9, 'every control is labelled');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.match(html, /id="directories"[^>]*value="2400"/, 'the default tree size is in the markup');
assert.match(html, /id="processes"[^>]*value="2"/, 'the default process count is in the markup');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(/.test(html), 'no network calls');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is sent or stored/i, 'the privacy note stays on the page');
assert.match(html, /min-height:44px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* inotify-limits-core:start \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
for (const id of html.match(/getElementById\("([^"]+)"\)/g) || []) {
  const name = id.slice(16, -2);
  assert.ok(html.includes('id="' + name + '"'), 'the page defines #' + name);
}

console.log('inotify-watch-limit-planner: 300 model cases, formatter, ' +
  record.testCases.length + ' catalog cases, statuses, snippet floor, uniqueness and page contract OK');
