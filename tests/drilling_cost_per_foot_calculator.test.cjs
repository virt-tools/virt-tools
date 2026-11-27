/* Drilling cost per foot: the published cost-per-foot identity across a grid,
   the three-way split back to the total, the break-even footage inversion, the
   warnings, the refusals, the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'drilling-cost-per-foot-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* drilling-cost-core:start */';
const endMarker = '/* drilling-cost-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = DrillingCostCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const base = { bitCost: '27000', rigRate: '84000', drillingHours: '50', tripHours: '12', footage: '5000' };
const run = (overrides) => C.calculate(Object.assign({}, base, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const round = (value, digits) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

// ---- The published worked example: 27,000 + 3,500 x (50 + 12) over 5,000 ft.
const published = run();
assert.equal(published.costPerFoot, 48.8, 'the published 48.8 dollars per foot');
assert.equal(published.costPerMetre, 160.1);
assert.equal(published.rigPerHour, 3500);
assert.equal(published.rigCost, 217000);
assert.equal(published.totalCost, 244000);
assert.equal(published.rateOfPenetration, 100);
assert.equal(published.bitShare, 11.1);
assert.equal(published.rigShare, 88.9);
assert.equal(published.target, null);
assert.equal(published.requiredFootage, 0);
assert.equal(published.warnings.length, 0);

// ---- The identity CT = (B + CR (t + T)) / F over a grid of runs.
for (const bit of [0, 5000, 27000, 120000, 500000]) {
  for (const rate of [0, 12000, 60000, 84000, 300000, 600000]) {
    for (const drill of [2, 12.5, 50, 120]) {
      for (const trip of [0, 6, 12, 36]) {
        for (const footage of [120, 900, 5000, 20000]) {
          const result = run({
            bitCost: String(bit),
            rigRate: String(rate),
            drillingHours: String(drill),
            tripHours: String(trip),
            footage: String(footage)
          });
          const perHour = rate / 24;
          const expected = (bit + perHour * (drill + trip)) / footage;
          assert.equal(result.costPerFoot, round(expected, 2),
            'cost per foot follows (B + CR (t + T)) / F: ' + [bit, rate, drill, trip, footage].join('/'));
          assert.equal(result.rigPerHour, round(perHour, 4), 'the daily rate over 24 hours');
          assert.equal(result.totalCost, round(bit + perHour * (drill + trip), 0), 'total interval cost');
          assert.equal(result.rateOfPenetration, round(footage / drill, 1), 'rate of penetration');
          assert.ok(Math.abs(result.costPerMetre - result.costPerFoot / 0.3048) <= 0.03,
            'cost per metre from the cost per foot');
          // The three rounded parts rebuild the rounded cost per foot.
          const parts = result.drillingOnlyPerFoot + result.tripPerFoot + result.bitPerFoot;
          assert.ok(Math.abs(parts - result.costPerFoot) <= 0.031,
            'the split adds back to the cost per foot: ' + [bit, rate, drill, trip, footage].join('/'));
          assert.ok(Math.abs(result.bitShare + result.rigShare - 100) <= 0.11, 'the shares close');
        }
      }
    }
  }
}

// ---- The split matches the closed forms.
for (const [bit, rate, drill, trip, footage] of [[27000, 84000, 50, 12, 5000], [32000, 60000, 60, 20, 4200], [9000, 36000, 36, 0, 1800]]) {
  const result = run({ bitCost: String(bit), rigRate: String(rate), drillingHours: String(drill), tripHours: String(trip), footage: String(footage) });
  const perHour = rate / 24;
  assert.equal(result.drillingOnlyPerFoot, round(perHour / (footage / drill), 2), 'rig while drilling');
  assert.equal(result.tripPerFoot, round(perHour * trip / footage, 2), 'round trip');
  assert.equal(result.bitPerFoot, round(bit / footage, 2), 'bit');
}

// ---- The break-even footage really lands on the target.
const targets = [
  ['27000', '84000', '50', '12', '5000', '45'],
  ['27000', '84000', '50', '12', '5000', '60'],
  ['32000', '60000', '60', '20', '4200', '50'],
  ['120000', '600000', '120', '36', '3000', '1500'],
  ['8000', '30000', '10', '4', '3200', '10']
];
for (const [bit, rate, drill, trip, footage, target] of targets) {
  const result = run({ bitCost: bit, rigRate: rate, drillingHours: drill, tripHours: trip, footage: footage, target: target });
  assert.equal(result.target, Number(target));
  const rop = Number(footage) / Number(drill);
  const perHour = Number(rate) / 24;
  const expected = (Number(bit) + perHour * Number(trip)) / (Number(target) - perHour / rop);
  assert.equal(result.requiredFootage, round(expected, 0), 'break-even footage: ' + target);
  assert.equal(result.extraFootage, round(expected - Number(footage), 0), 'difference from this run');
  // Re-running the same rate of penetration at that footage lands on the target.
  const replay = C.calculate({
    bitCost: bit,
    rigRate: rate,
    drillingHours: String(result.requiredFootage / rop),
    tripHours: trip,
    footage: String(result.requiredFootage),
    target
  });
  assert.ok(Math.abs(replay.costPerFoot - Number(target)) <= 0.02,
    'the break-even footage reaches the target: ' + target + ' -> ' + replay.costPerFoot);
}

// ---- A target at or below the drilling-only floor has no solution.
assert.match(failure({ target: '35' }), /^A target of 35 dollars per foot is at or below the 35 dollars per foot the rig costs while drilling at 100 ft\/h/);
assert.match(failure({ target: '20' }), /so no footage reaches it at this rate\.$/);
// One cent above the floor needs an enormous interval instead.
const tight = run({ target: '35.01' });
assert.equal(tight.requiredFootage, 6900000);
assert.equal(tight.extraFootage, 6895000);
assert.ok(tight.warnings.some((text) => /more than four times the interval drilled/.test(text)),
  'an unreachable target is called out');

// ---- Monotonic behaviour.
const cheapRig = run({ rigRate: '24000' });
const dearRig = run({ rigRate: '240000' });
assert.ok(dearRig.costPerFoot > cheapRig.costPerFoot, 'a dearer rig costs more per foot');
const longRun = run({ footage: '10000' });
assert.ok(longRun.costPerFoot < published.costPerFoot, 'more footage spreads the fixed costs');
const noBit = run({ bitCost: '0' });
assert.equal(noBit.bitPerFoot, 0, 'a re-run bit is free');
assert.equal(noBit.costPerFoot, 43.4, 'the rig alone at 100 ft/h and a 12 h trip');
assert.equal(run({ tripHours: '0' }).tripPerFoot, 0, 'no trip, no trip cost');

// ---- Warnings.
assert.equal(run().warnings.length, 0, 'a routine run is quiet');
assert.equal(run({ rigRate: '0' }).warnings[0],
  'The rig rate is zero, so only the bit cost is counted; the figure is a floor, not a rig cost.');
assert.ok(run({ drillingHours: '6', tripHours: '9', footage: '240' }).warnings
  .some((text) => /round trip is longer than the time on bottom/.test(text)), 'a trip-heavy run is called out');
assert.ok(run({ drillingHours: '10', tripHours: '4', footage: '3200' }).warnings
  .some((text) => /At 320 ft\/h the interval is faster/.test(text)), 'a very fast run is called out');
assert.ok(run({ bitCost: '1000', rigRate: '240000', drillingHours: '40', tripHours: '10', footage: '800' }).warnings
  .some((text) => /The bit is only 0.2 % of the cost/.test(text)), 'a negligible bit cost is called out');
assert.equal(run({ bitCost: '0' }).warnings.some((text) => /The bit is only/.test(text)), false,
  'a zero bit cost does not report a zero share');

// ---- Refusals.
assert.equal(failure({ bitCost: '' }), 'Enter the bit cost in dollars.');
assert.equal(failure({ bitCost: 'abc' }), 'Enter the bit cost in dollars.');
assert.equal(failure({ bitCost: '-1' }), 'The bit cost must be between 0 and 10,000,000 dollars.');
assert.equal(failure({ bitCost: '10000001' }), 'The bit cost must be between 0 and 10,000,000 dollars.');
assert.equal(failure({ rigRate: '' }), 'Enter the rig operating cost in dollars per day.');
assert.equal(failure({ rigRate: '5000001' }), 'The rig operating cost must be between 0 and 5,000,000 dollars per day.');
assert.equal(failure({ drillingHours: '0' }), 'The time on bottom must be greater than 0 and at most 5000 hours.');
assert.equal(failure({ drillingHours: '5001' }), 'The time on bottom must be greater than 0 and at most 5000 hours.');
assert.equal(failure({ tripHours: '-1' }), 'The round-trip time must be between 0 and 5000 hours.');
assert.equal(failure({ tripHours: '5001' }), 'The round-trip time must be between 0 and 5000 hours.');
assert.equal(failure({ footage: '0' }), 'The footage must be greater than 0 and at most 200000 feet.');
assert.equal(failure({ footage: '200001' }), 'The footage must be greater than 0 and at most 200000 feet.');
assert.equal(failure({ footage: 'one mile' }), 'Enter the footage drilled in feet.');
assert.equal(failure({ target: '50 $' }), 'Enter the target cost per foot in dollars, or leave it blank.');
assert.equal(failure({ target: '0' }), 'The target cost per foot must be greater than 0 and at most 100000 dollars.');
assert.equal(failure({ target: '100001' }), 'The target cost per foot must be greater than 0 and at most 100000 dollars.');
const nothing = (value) => {
  try {
    C.calculate(value);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(nothing(null), 'Nothing to calculate.');
assert.equal(nothing('27000'), 'Nothing to calculate.');
assert.equal(C.HOURS_PER_DAY, 24);
assert.equal(C.FEET_TO_METRES, 0.3048);
assert.equal(C.MAX_BIT, 10000000);
assert.equal(C.MAX_RATE, 5000000);
assert.equal(C.MAX_FOOTAGE, 200000);

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2510, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2249, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 57,
  'Oil, Gas & Marine Engineering count');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'every source has a fetched https url');
  assert.ok(source.title.length > 40, 'the citation keeps its wording');
}
assert.ok(record.tags.includes('oil-gas-marine-engineering'));
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');

const kinds = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.deepEqual(kinds, { golden: 8, boundary: 6, validation: 9 });

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.deepEqual(
  catalog.tools.filter((tool) => /cost.?per.?foot/.test(tool.slug) && tool.slug !== slug).map((tool) => tool.slug),
  [],
  'no other cost-per-foot tool exists');
assert.deepEqual(
  catalog.tools.filter((tool) => /drilling.?cost/.test(tool.slug) && tool.slug !== slug).map((tool) => tool.slug),
  [],
  'no other drilling cost tool exists');
assert.ok(catalog.tools.some((tool) => tool.slug === 'drill-pipe-velocity-calculator'),
  'the other drilling tools stay separate');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Drilling Cost per Foot Calculator<\/h1>/);
assert.match(html, /<form id="cost-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 6, 'every control is labelled');
assert.equal((html.match(/<input/g) || []).length, 6);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-example="/g) || []).length, 2);
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* drilling-cost-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* drilling-cost-core:end \*\//g) || []).length, 1);

// Every id the script reaches for exists in the markup.
const ids = ['cost-form', 'bit', 'rate', 'drilling', 'trip', 'footage', 'target', 'err', 'out'];
for (const id of ids) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}

console.log('drilling cost per foot calculator OK: ' + record.testCases.length +
  ' catalog cases, the (B + CR (t + T)) / F identity over 1,920 runs, the three-way split, ' +
  'the break-even footage inversion, warnings, refusals, uniqueness and page contract OK');
