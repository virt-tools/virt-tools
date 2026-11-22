/* Account lockout policy calculator: the cycle arithmetic, an independent
   throughput formulation, the duration table, the catalog cases and the page
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'account-lockout-policy-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* alp-core:start */';
const endMarker = '/* alp-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AlpCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const failure = (input) => {
  try { C.analyse(input); } catch (error) { return error.message; }
  return null;
};

const base = {
  threshold: '5', duration: '15', window: '15', rate: '30', accounts: '1'
};
const answer = (overrides) => C.analyse({ ...base, ...overrides });

// ---- The exported surface and its limits.
assert.deepEqual(plain(Object.keys(C)).sort(), ['analyse', 'durations', 'limits', 'roundTo']);
assert.deepEqual(plain(C.limits.threshold), [1, 1000]);
assert.deepEqual(plain(C.limits.duration), [0.1, 10080]);
assert.deepEqual(plain(C.limits.window), [1, 10080]);
assert.deepEqual(plain(C.limits.rate), [0.01, 100000]);
assert.deepEqual(plain(C.limits.accounts), [1, 100000]);
assert.deepEqual(plain(C.durations), [5, 15, 30, 60, 120, 240, 1440]);

// ---- The default policy: 5 attempts, 15 minutes, 30 attempts a minute.
const d = answer({});
assert.equal(d.attemptsPerCycle, 5);
assert.equal(d.cycleMinutes, 15.167);
assert.equal(d.attemptMinutes, 0.167);
assert.equal(d.lockoutsPerHour, 3.956);
assert.equal(d.guessesPerHour, 19.78);
assert.equal(d.guessesPerDay, 474.725);
assert.equal(d.fleetGuessesPerHour, 19.78);
assert.equal(d.slowdownFactor, 91);
assert.equal(d.lockedSharePercent, 98.9);
assert.equal(d.windowClears, true);
assert.equal(d.optimistic, false);

// ---- The cycle is the attempt time plus the wait, and it yields exactly the
// threshold in guesses.
for (const [threshold, duration, rate] of [[1, 0.1, 0.01], [5, 15, 30], [10, 1, 600], [1000, 10080, 100000], [3, 60, 12]]) {
  const result = C.analyse({
    threshold: String(threshold), duration: String(duration), window: '15',
    rate: String(rate), accounts: '1'
  });
  assert.ok(Math.abs(result.cycleMinutes - (threshold / rate + duration)) < 0.002, 'cycle ' + threshold);
  assert.ok(Math.abs(result.guessesPerHour - threshold * 60 / (threshold / rate + duration)) < 0.002, 'per hour ' + threshold);
  assert.ok(Math.abs(result.lockoutsPerHour - 60 / (threshold / rate + duration)) < 0.002, 'lockouts ' + threshold);
}

// ---- An independent formulation: throughput is the unlocked attempts in a
// cycle scaled by the lockout's share of it, and the slowdown is the
// unthrottled rate over that throughput.
for (const [threshold, duration, rate] of [[1, 30, 1], [5, 15, 30], [8, 20, 240], [1000, 10080, 100000], [2, 0.1, 50000]]) {
  const result = C.analyse({
    threshold: String(threshold), duration: String(duration), window: '15',
    rate: String(rate), accounts: '1'
  });
  const cycle = threshold / rate + duration;
  const unlockedShare = (threshold / rate) / cycle;
  const expected = rate * 60 * unlockedShare;
  assert.ok(Math.abs(result.guessesPerHour - expected) < 0.002, 'unlocked share ' + threshold);
  assert.ok(Math.abs(result.slowdownFactor - rate * 60 / expected) < 0.02, 'slowdown ' + threshold);
  assert.ok(Math.abs(result.guessesPerDay - 24 * result.guessesPerHour) < 0.05, 'daily is 24 hourly ' + threshold);
  assert.ok(result.slowdownFactor >= 1, 'a lockout never speeds an attacker up');
  assert.ok(result.lockedSharePercent > 0 && result.lockedSharePercent <= 100, 'share ' + threshold);
}

// ---- The slowdown identity: 1 + duration x rate / threshold.
for (const [threshold, duration, rate] of [[4, 45, 20], [5, 15, 30], [1, 5, 100], [100, 60, 0.5]]) {
  const result = C.analyse({
    threshold: String(threshold), duration: String(duration), window: '15',
    rate: String(rate), accounts: '1'
  });
  const expected = 1 + duration * rate / threshold;
  assert.ok(Math.abs(result.slowdownFactor - expected) < 0.02, 'slowdown identity ' + threshold);
}

// ---- A faster attacker gains little once the wait dominates: throughput
// approaches threshold x 60 / duration from below.
const fast = C.analyse({ ...base, rate: '100000' });
assert.ok(fast.guessesPerHour <= 5 * 60 / 15, 'the ceiling holds');
assert.ok(Math.abs(fast.guessesPerHour - 20) < 0.01, 'a very fast attacker approaches the wait limit');
assert.ok(fast.slowdownFactor > 10000, 'and the slowdown is enormous');

// ---- Scaling: accounts multiply the fleet figure only.
const two = answer({ accounts: '2' });
assert.equal(two.guessesPerHour, d.guessesPerHour);
assert.equal(two.fleetGuessesPerHour, 39.56);
assert.equal(answer({ accounts: '100000' }).fleetGuessesPerHour, 1978021.978);
const ten = answer({ threshold: '10' });
assert.ok(ten.guessesPerHour > d.guessesPerHour, 'a larger allowance helps the attacker');
assert.ok(ten.slowdownFactor < d.slowdownFactor, 'a larger allowance weakens the slowdown');
assert.ok(answer({ threshold: '4' }).guessesPerHour < d.guessesPerHour, 'a smaller allowance costs the attacker');
assert.ok(answer({ rate: '60' }).guessesPerHour > d.guessesPerHour, 'a faster attacker gets more through');
assert.ok(answer({ rate: '1' }).guessesPerHour < d.guessesPerHour, 'a slower attacker gets less through');

// ---- The counting window only changes the caveat, not the arithmetic.
assert.equal(answer({ duration: '15', window: '15' }).windowClears, true);
assert.equal(answer({ duration: '14.9', window: '15' }).windowClears, false);
assert.equal(answer({ duration: '14.9', window: '15' }).optimistic, true);
assert.equal(answer({ duration: '60', window: '15' }).optimistic, false);

// ---- The duration table: seven rows, ascending, the entered duration marked
// once, throughput falling and slowdown rising as the wait lengthens.
assert.deepEqual(plain(d.table).map((row) => row.durationMinutes), [5, 15, 30, 60, 120, 240, 1440]);
assert.deepEqual(plain(d.table).map((row) => row.current), [false, true, false, false, false, false, false]);
assert.deepEqual(plain(d.table)[1], {
  durationMinutes: 15, cycleMinutes: 15.167, guessesPerHour: 19.78, slowdownFactor: 91, current: true
});
assert.equal(d.table[0].guessesPerHour, 58.065);
assert.equal(d.table[6].guessesPerHour, 0.208);
for (let index = 1; index < d.table.length; index += 1) {
  assert.ok(d.table[index].guessesPerHour < d.table[index - 1].guessesPerHour, 'throughput falls with the wait');
  assert.ok(d.table[index].slowdownFactor > d.table[index - 1].slowdownFactor, 'slowdown rises with the wait');
}
assert.equal(C.analyse({ ...base, duration: '60' }).table[3].current, true);
assert.equal(C.analyse({ ...base, duration: '60' }).table[3].guessesPerHour,
  C.analyse({ ...base, duration: '60' }).guessesPerHour);

// ---- The limits themselves are accepted, and every value stays finite.
const lower = C.analyse({ threshold: '1', duration: '0.1', window: '1', rate: '0.01', accounts: '1' });
assert.ok(Number.isFinite(lower.guessesPerHour) && lower.guessesPerHour > 0);
const upper = C.analyse({ threshold: '1000', duration: '10080', window: '10080', rate: '100000', accounts: '100000' });
assert.ok(Number.isFinite(upper.fleetGuessesPerHour) && upper.fleetGuessesPerHour > 0);
assert.ok(Number.isFinite(upper.slowdownFactor));

// ---- A seeded sweep over the input space.
let seed = 20261122;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < 250; index += 1) {
  const threshold = 1 + Math.floor(rnd() * 1000);
  const duration = 0.1 + rnd() * 10079.9;
  const windowMinutes = 1 + rnd() * 10079;
  const rate = 0.01 + rnd() * 99999.99;
  const accounts = 1 + Math.floor(rnd() * 100000);
  const result = C.analyse({
    threshold: String(threshold), duration: String(duration), window: String(windowMinutes),
    rate: String(rate), accounts: String(accounts)
  });
  const cycle = threshold / rate + duration;
  for (const field of ['cycleMinutes', 'attemptMinutes', 'lockoutsPerHour', 'guessesPerHour',
    'guessesPerDay', 'fleetGuessesPerHour', 'slowdownFactor', 'lockedSharePercent']) {
    assert.ok(Number.isFinite(result[field]), 'finite ' + field);
  }
  assert.ok(Math.abs(result.guessesPerHour - threshold * 60 / cycle) < 0.002, 'per hour ' + index);
  assert.ok(Math.abs(result.guessesPerDay - threshold * 1440 / cycle) < 0.002, 'daily ' + index);
  assert.ok(Math.abs(result.fleetGuessesPerHour - accounts * threshold * 60 / cycle) < 0.002, 'fleet ' + index);
  assert.ok(result.slowdownFactor >= 1, 'slowdown floor ' + index);
  assert.equal(result.windowClears, duration >= windowMinutes, 'window flag ' + index);
  assert.equal(result.table.length, 7);
}

// ---- Refusals.
assert.equal(failure({ ...base, threshold: '' }), 'Failed attempts before lockout is required.');
assert.equal(failure({ ...base, threshold: 'five' }), 'Failed attempts before lockout must be a whole number between 1 and 1000.');
assert.equal(failure({ ...base, threshold: '4.5' }), 'Failed attempts before lockout must be a whole number between 1 and 1000.');
assert.equal(failure({ ...base, threshold: '-5' }), 'Failed attempts before lockout must be a whole number between 1 and 1000.');
assert.equal(failure({ ...base, threshold: '0' }), 'Failed attempts before lockout must be between 1 and 1000 attempts.');
assert.equal(failure({ ...base, threshold: '1001' }), 'Failed attempts before lockout must be between 1 and 1000 attempts.');
assert.equal(failure({ ...base, duration: '' }), 'Lockout duration is required.');
assert.equal(failure({ ...base, duration: 'soon' }), 'Lockout duration must be a number between 0.1 and 10080 minutes.');
assert.equal(failure({ ...base, duration: '0.05' }), 'Lockout duration must be between 0.1 and 10080 minutes.');
assert.equal(failure({ ...base, duration: '10081' }), 'Lockout duration must be between 0.1 and 10080 minutes.');
assert.equal(failure({ ...base, window: '' }), 'Counting window is required.');
assert.equal(failure({ ...base, window: 'soon' }), 'Counting window must be a number between 1 and 10080 minutes.');
assert.equal(failure({ ...base, window: '0.5' }), 'Counting window must be between 1 and 10080 minutes.');
assert.equal(failure({ ...base, window: '10081' }), 'Counting window must be between 1 and 10080 minutes.');
assert.equal(failure({ ...base, rate: '' }), 'Attempt rate is required.');
assert.equal(failure({ ...base, rate: 'soon' }), 'Attempt rate must be a number between 0.01 and 100000 attempts per minute.');
assert.equal(failure({ ...base, rate: '0' }), 'Attempt rate must be between 0.01 and 100000 attempts per minute.');
assert.equal(failure({ ...base, rate: '0.001' }), 'Attempt rate must be between 0.01 and 100000 attempts per minute.');
assert.equal(failure({ ...base, rate: '100001' }), 'Attempt rate must be between 0.01 and 100000 attempts per minute.');
assert.equal(failure({ ...base, accounts: '' }), 'Accounts under attack is required.');
assert.equal(failure({ ...base, accounts: 'two' }), 'Accounts under attack must be a whole number between 1 and 100000.');
assert.equal(failure({ ...base, accounts: '1.5' }), 'Accounts under attack must be a whole number between 1 and 100000.');
assert.equal(failure({ ...base, accounts: '0' }), 'Accounts under attack must be between 1 and 100000 accounts.');
assert.equal(failure({ ...base, accounts: '100001' }), 'Accounts under attack must be between 1 and 100000 accounts.');
assert.equal(failure({}), 'Failed attempts before lockout is required.');

// ---- The catalog record and its cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'Account Lockout Policy Calculator');
assert.equal(entry.category, 'Security');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 700, 'method must document the model and its limits');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => /^https:\/\//.test(source.url)), 'https sources');
assert.equal(entry.testCases.length, 30, 'catalog case count');
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'golden').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6);
assert.equal(entry.testCases.filter((testCase) => testCase.kind === 'validation').length, 18);

for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = C.analyse(testCase.input);
  for (const [field, expected] of Object.entries(testCase.expected)) {
    assert.deepEqual(plain(result[field]), expected, testCase.name + ' ' + field);
  }
}

// ---- A name or alias belongs to one tool only.
const names = new Map();
for (const tool of catalog.tools) {
  for (const value of [tool.name, ...(tool.aliases || [])]) {
    const key = value.toLowerCase();
    if (!names.has(key)) names.set(key, new Set());
    names.get(key).add(tool.slug);
  }
}
for (const value of [entry.name, ...entry.aliases]) {
  const holders = names.get(value.toLowerCase());
  assert.deepEqual([...holders], [slug], 'name or alias is not shared: ' + value);
}

// ---- Page contract.
assert.ok(/<h1>Account Lockout Policy Calculator<\/h1>/.test(html), 'heading');
assert.ok(/<form id="lockout-form" novalidate>/.test(html), 'form');
for (const id of ['in-threshold', 'in-duration', 'in-window', 'in-rate', 'in-accounts',
  'err', 'run', 'out', 'chart-wrap', 'chart-title', 'chart-rows']) {
  assert.ok(html.includes('id="' + id + '"'), 'element id: ' + id);
}
for (const label of ['Failed attempts before lockout', 'Lockout duration', 'Counting window',
  'Attacker attempt rate', 'Accounts under attack']) {
  assert.ok(html.includes('>' + label + '</label>'), 'label: ' + label);
}
assert.ok(/<button type="submit" id="run">Model the lockout<\/button>/.test(html), 'submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/Nothing is uploaded, stored or fetched/.test(html), 'the note states local only');
assert.ok(/\[hidden\]\{display:none!important\}/.test(html), 'hidden elements stay hidden');
assert.ok(!/https?:\/\//.test(html), 'no off-site links or requests');
assert.ok(!/<script[^>]+src="(?!\/assets\/)/.test(html), 'only local scripts');
assert.ok(!/\son(click|input|change|submit|keydown)=/.test(html), 'no inline event handlers');
assert.equal(html.match(/<script/g).length, 3, 'theme init, shared app and the tool script');
assert.ok(/min-height:44px/.test(html), '44px touch targets');
assert.ok(/<caption>/.test(html) && /scope="col"/.test(html), 'table caption and headers');
assert.ok(!/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
const ids = html.match(/\bid="[^"]+"/g).map((value) => value.slice(4, -1));
assert.equal(new Set(ids).size, ids.length, 'no duplicate ids');

console.log('account lockout policy calculator: all assertions passed');
