/* Regression checks for the TCP retransmission timer core, its catalog cases and
   the page's offline, no-storage contract. The oracle below evaluates the RFC
   6298 smoothing in closed form (weighted sums) rather than repeating the
   page's running recurrence. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'tcp-retransmission-timer';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* tcp-rto-core:start */');
const end = html.indexOf('/* tcp-rto-core:end */');
assert.ok(start > -1 && end > start, 'tcp rto core markers missing');
const core = html.slice(start, end + '/* tcp-rto-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TcpRtoCore;', sandbox);
const C = sandbox.module.exports;

const closeTo = (actual, expected, label, epsilon) => assert.ok(
  Math.abs(actual - expected) < (epsilon === undefined ? 1e-9 : epsilon),
  label + ': ' + actual + ' vs ' + expected);

const DEFAULTS = { samples: '540 620 580 660', granularity: '1', cap: 'none' };
const run = (overrides) => C.analyze(Object.assign({}, DEFAULTS, overrides));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Closed-form oracle: SRTT after n samples is the geometric weighting of the
// samples themselves, and RTTVAR after n samples is the geometric weighting of
// the first sample's half and the later absolute residuals against the previous
// smoothed value. No running recurrence is reused from the page.
function oracle(samples, granularity, cap) {
  const alpha = 1 / 8;
  const beta = 1 / 4;
  const srttAfter = (n) => {
    let total = Math.pow(1 - alpha, n - 1) * samples[0];
    for (let i = 2; i <= n; i += 1) {
      total += alpha * Math.pow(1 - alpha, n - i) * samples[i - 1];
    }
    return total;
  };
  const steps = [];
  for (let n = 1; n <= samples.length; n += 1) {
    let rttvar = Math.pow(1 - beta, n - 1) * (samples[0] / 2);
    for (let i = 2; i <= n; i += 1) {
      const previous = srttAfter(i - 1);
      rttvar += beta * Math.pow(1 - beta, n - i) * Math.abs(previous - samples[i - 1]);
    }
    const srtt = srttAfter(n);
    const rawRto = srtt + Math.max(granularity, 4 * rttvar);
    let rto = rawRto < 1000 ? 1000 : rawRto;
    const capped = cap > 0 && rto > cap;
    if (capped) rto = cap;
    steps.push({ srtt, rttvar, rawRto, rto, floored: rawRto < 1000, capped });
  }
  return steps;
}

// Documented surface.
assert.equal(C.K, 4);
assert.equal(C.ALPHA, 0.125);
assert.equal(C.BETA, 0.25);
assert.equal(C.MIN_RTO, 1000);
assert.equal(C.MAX_RTO, 60000);
assert.deepEqual([...C.LIMITS.samples], [1, 24]);
assert.deepEqual([...C.LIMITS.rtt], [0, 60000]);
assert.deepEqual([...C.LIMITS.granularity], [0, 1000]);
assert.deepEqual({ ...C.CASES }, { none: 0, sixty: 60000 });
assert.match(C.MESSAGES.single, /single sample/);
assert.match(C.MESSAGES.floored, /under one second/);
assert.match(C.MESSAGES.capped, /60-second cap/);
assert.match(C.MESSAGES.spread, /vary widely/);
assert.match(C.MESSAGES.zero, /zero-millisecond/);
assert.match(C.MESSAGES.rounded, /0\.001 ms/);

// Golden: the RFC 6298 arithmetic for a 600 ms satellite path.
const base = run();
assert.equal(base.count, 4);
closeTo(base.srtt, 567.03125, 'default SRTT');
closeTo(base.rttvar, 157.34375, 'default RTTVAR');
closeTo(base.rawRto, 1196.40625, 'default raw RTO');
closeTo(base.rto, 1196.40625, 'default RTO');
closeTo(base.mean, 600, 'default mean');
assert.equal(base.floored, false);
assert.equal(base.capped, false);
assert.equal(base.initialRto, 1000);
assert.equal(base.steps.length, 4);
closeTo(base.steps[0].rto, 1620, 'first step RTO');
closeTo(base.steps[1].rto, 1440, 'second step RTO');
closeTo(base.steps[2].rto, 1251.25, 'third step RTO');
assert.deepEqual(Array.from(base.warnings), [C.MESSAGES.rounded]);

// The one-second floor: a short local path cannot move the timer.
const local = run({ samples: '24 31 28 45' });
closeTo(local.rawRto, 73.998046875, 'local raw RTO', 1e-6);
assert.equal(local.rto, 1000);
assert.equal(local.floored, true);
assert.equal(local.warnings.indexOf(C.MESSAGES.floored) > -1, true);

// A single sample sets the variation to half of it and warns.
const single = run({ samples: '24' });
closeTo(single.srtt, 24, 'single SRTT');
closeTo(single.rttvar, 12, 'single RTTVAR');
closeTo(single.rawRto, 72, 'single raw RTO');
assert.equal(single.rto, 1000);
assert.deepEqual(Array.from(single.warnings), [C.MESSAGES.single, C.MESSAGES.floored, C.MESSAGES.rounded]);

// A wide spread raises the variation warning.
const wide = run({ samples: '10 200 15 180' });
assert.equal(wide.warnings.indexOf(C.MESSAGES.spread) > -1, true);
closeTo(wide.mean, 101.25, 'wide mean');
closeTo(wide.srtt, 49.98046875, 'wide SRTT');
closeTo(wide.rttvar, 69.4921875, 'wide RTTVAR');

// The optional cap only bites above 60 seconds, and the uncapped run keeps the
// raw figure.
const capped = run({ samples: '60000 60000 60000', cap: 'sixty' });
closeTo(capped.rawRto, 127500, 'capped raw RTO');
assert.equal(capped.rto, 60000);
assert.equal(capped.capped, true);
assert.equal(capped.warnings.indexOf(C.MESSAGES.capped) > -1, true);
const uncapped = run({ samples: '60000 60000 60000', cap: 'none' });
closeTo(uncapped.rto, 127500, 'uncapped RTO');
assert.equal(uncapped.capped, false);

// A coarse clock tick can lift the timer above the floor.
const coarse = run({ samples: '1000', granularity: '250' });
closeTo(coarse.rawRto, 3000, 'coarse raw RTO');
assert.equal(coarse.rto, 3000);
assert.equal(coarse.floored, false);

// A zero-millisecond sample is possible on loopback and is called out.
const zero = run({ samples: '0' });
assert.equal(zero.warnings.indexOf(C.MESSAGES.zero) > -1, true);
closeTo(zero.rawRto, 1, 'zero raw RTO');

// Separators are interchangeable.
for (const text of ['24 31 28 45', '24,31,28,45', '24, 31\n28;45', '  24   31 28 45  ']) {
  const result = run({ samples: text });
  assert.equal(result.count, 4, 'sample count for ' + JSON.stringify(text));
  closeTo(result.srtt, 27.732421875, 'SRTT for ' + JSON.stringify(text));
}

// Random sweep: every step of every run must agree with the closed-form oracle.
let seed = 20261115;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
let compared = 0;
for (let trial = 0; trial < 300; trial += 1) {
  const count = 1 + Math.floor(random() * 10);
  const samples = [];
  for (let i = 0; i < count; i += 1) samples.push(Math.round(random() * 60000 * 1000) / 1000);
  const granularity = [0, 0.5, 1, 10, 250, 1000][Math.floor(random() * 6)];
  const cap = random() < 0.5 ? 'none' : 'sixty';
  const result = run({ samples: samples.join(' '), granularity: String(granularity), cap });
  const expectedSteps = oracle(samples, granularity, cap === 'sixty' ? 60000 : 0);
  assert.equal(result.steps.length, expectedSteps.length, 'step count');
  for (let i = 0; i < expectedSteps.length; i += 1) {
    const want = expectedSteps[i];
    closeTo(result.steps[i].srtt, want.srtt, 'trial ' + trial + ' step ' + (i + 1) + ' SRTT', 1e-6);
    closeTo(result.steps[i].rttvar, want.rttvar, 'trial ' + trial + ' step ' + (i + 1) + ' RTTVAR', 1e-6);
    closeTo(result.steps[i].rawRto, want.rawRto, 'trial ' + trial + ' step ' + (i + 1) + ' raw RTO', 1e-6);
    closeTo(result.steps[i].rto, want.rto, 'trial ' + trial + ' step ' + (i + 1) + ' RTO', 1e-6);
    assert.equal(result.steps[i].floored, want.floored, 'trial ' + trial + ' floor flag');
    assert.equal(result.steps[i].capped, want.capped, 'trial ' + trial + ' cap flag');
    compared += 1;
  }
}
assert.ok(compared > 1500, 'sweep exercised only ' + compared + ' steps');

// The floor never produces a timer under one second, and the cap never exceeds
// sixty seconds, over a dense grid.
let grid = 0;
for (let a = 0; a <= 2000; a += 100) {
  for (let b = 0; b <= 2000; b += 100) {
    for (const cap of ['none', 'sixty']) {
      const result = run({ samples: a + ' ' + b, cap });
      assert.ok(result.rto >= 1000, 'grid ' + a + ' ' + b + ' under the floor');
      if (cap === 'sixty') assert.ok(result.rto <= 60000, 'grid ' + a + ' ' + b + ' over the cap');
      grid += 1;
    }
  }
}
assert.ok(grid > 800, 'grid exercised only ' + grid + ' rows');

// The core refuses an unknown cap selector even though the page offers a select.
assert.equal(failure({ cap: 'ninety' }), 'Choose the maximum timeout from the list.');

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'TCP Retransmission Timer Calculator');
assert.equal(entry.category, 'IT & Networking');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 1);
assert.match(entry.sources[0].url, /^https:\/\/www\.rfc-editor\.org\/rfc\/rfc6298\.html$/);
assert.ok(entry.testCases.length >= 18, 'expected at least eighteen catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (key === 'stepRtos' || key === 'stepSrtts') {
      const field = key === 'stepRtos' ? 'rto' : 'srtt';
      assert.deepEqual(Array.from(result.steps, (step) => Math.round(step[field] * 1e6) / 1e6), value, testCase.name + ' ' + key);
    } else if (Array.isArray(value)) {
      assert.deepEqual(Array.from(result[key]), Array.from(value), testCase.name + ' ' + key);
    } else if (typeof value === 'string' || typeof value === 'boolean') {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    } else {
      closeTo(result[key], value, testCase.name + ' ' + key, 1e-6);
    }
  }
}

// Refusals name the field in the order it appears on the page.
assert.equal(failure({ samples: '' }), 'Enter at least one RTT sample in milliseconds.');
assert.equal(failure({ samples: '24 3x' }), 'RTT samples must be numbers in milliseconds.');
assert.equal(failure({ samples: '24.5.5' }), 'RTT samples must be numbers in milliseconds.');
assert.equal(failure({ samples: '-5' }), 'Each RTT sample must be between 0 and 60000 ms.');
assert.equal(failure({ samples: '60001' }), 'Each RTT sample must be between 0 and 60000 ms.');
assert.equal(failure({ samples: Array.from({ length: 25 }, () => '30').join(' ') }), 'Enter at most 24 RTT samples.');
assert.equal(failure({ granularity: '' }), 'Enter the clock granularity.');
assert.equal(failure({ granularity: '1001' }), 'The clock granularity must be between 0 and 1000 ms.');
assert.equal(failure({ granularity: '-1' }), 'The clock granularity must be between 0 and 1000 ms.');
assert.equal(failure({ granularity: 'fast' }), 'The clock granularity must be a number.');

// Twenty-four samples is the documented maximum and must be accepted.
const most = C.parseSamples(Array.from({ length: 24 }, (_, index) => String(index)).join(' '));
assert.equal(most.length, 24);

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/https?:\/\/[a-z]/i.test(html.replace(/http:\/\/www\.w3\.org/g, '')), 'page must not reference an external URL');
assert.ok(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(html), 'page source must stay ASCII');
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, 'page needs exactly one h1');
assert.ok(html.includes('<form id="rto-form"'), 'page form missing');
assert.ok(html.includes('type="submit"'), 'page needs an explicit submit button');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('min-height:44px'), 'controls must keep a 44 px target');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'page must not use inline event handlers');
for (const id of ['samples', 'granularity', 'cap', 'err', 'out', 'reset']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
}
for (const value of ['>540 620 580 660<', 'value="1"']) {
  assert.ok(html.includes(value), 'default ' + value + ' missing from the markup');
}
assert.ok(html.includes('<textarea id="samples"'), 'the samples field must be a wrapping textarea');
assert.ok(html.includes('<option value="none" selected>'), 'the no-cap option must start selected');
// Every id the script looks up must exist in the markup.
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'getElementById(' + match[1] + ') has no element');
}
// Every label points at a control that exists.
for (const match of html.matchAll(/<label class="f" for="([^"]+)"/g)) {
  assert.ok(html.includes('id="' + match[1] + '"'), 'label for ' + match[1] + ' has no control');
}

console.log('tcp retransmission timer: ' + entry.testCases.length
  + ' catalog cases, ' + compared + ' oracle steps and ' + grid + ' grid rows passed');
