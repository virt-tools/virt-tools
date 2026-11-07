/* Regression checks for the baseball slash line calculator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(
  path.join(root, 'frontend/tools/baseball-slash-line-calculator/index.html'),
  'utf8'
);
const start = html.indexOf('/* baseball-slash-core:start */');
const end = html.indexOf('/* baseball-slash-core:end */');
assert.ok(start > -1 && end > start, 'baseball slash core markers missing');
const core = html.slice(start, end + '/* baseball-slash-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BaseballSlashCore;', sandbox);
const C = sandbox.module.exports;

const near = (actual, expected, label, eps = 1e-12) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};
const base = {
  atBats: 415,
  hits: 128,
  doubles: 24,
  triples: 3,
  homers: 18,
  walks: 47,
  hitByPitch: 6,
  sacFlies: 4
};
const build = (overrides = {}) => C.calculate({ ...base, ...overrides });
const rejects = (overrides, message) => {
  assert.throws(
    () => C.calculate({ ...base, ...overrides }),
    (error) => error.message === message,
    `expected rejection: ${message}`
  );
};

// Independent reference: count bases hit by hit and rebuild every rate.
function reference(line) {
  const singles = line.hits - line.doubles - line.triples - line.homers;
  const totalBases = singles + 2 * line.doubles + 3 * line.triples + 4 * line.homers;
  const plateAppearances =
    line.atBats + line.walks + line.hitByPitch + line.sacFlies;
  return {
    singles,
    extraBaseHits: line.doubles + line.triples + line.homers,
    totalBases,
    plateAppearances,
    average: line.hits / line.atBats,
    onBase: (line.hits + line.walks + line.hitByPitch) / plateAppearances,
    slugging: totalBases / line.atBats
  };
}

// The default 128-for-415 line with 24 doubles, 3 triples, 18 homers, 47 walks,
// 6 hit-by-pitch and 4 sac flies: .308/.383/.511 with a .894 OPS.
const a = build();
const ref = reference(base);
assert.equal(a.singles, 83);
assert.equal(a.extraBaseHits, 45);
assert.equal(a.totalBases, 212);
assert.equal(a.plateAppearances, 472);
near(a.average, ref.average, 'default average');
near(a.average, 128 / 415, 'default average fraction');
near(a.onBase, ref.onBase, 'default on-base');
near(a.onBase, 181 / 472, 'default on-base fraction');
near(a.slugging, ref.slugging, 'default slugging');
near(a.slugging, 212 / 415, 'default slugging fraction');
near(a.ops, ref.onBase + ref.slugging, 'default ops');
near(a.average, 0.30843373493975904, 'default average decimal');
near(a.onBase, 0.38347457627118644, 'default on-base decimal');
near(a.slugging, 0.5108433734939759, 'default slugging decimal');
near(a.ops, 181 / 472 + 212 / 415, 'default ops decimal');

// Total bases equal hits plus one extra base per double, two per triple and
// three per home run; a single is worth exactly one base.
assert.equal(a.totalBases, a.hits + a.doubles + 2 * a.triples + 3 * a.homers);

// A four-for-four game with four home runs is a 1.000/1.000/4.000 line.
const perfect = build({ atBats: 4, hits: 4, doubles: 0, triples: 0, homers: 4, walks: 0, hitByPitch: 0, sacFlies: 0 });
assert.equal(perfect.singles, 0);
assert.equal(perfect.totalBases, 16);
assert.equal(perfect.plateAppearances, 4);
assert.equal(perfect.average, 1);
assert.equal(perfect.onBase, 1);
assert.equal(perfect.slugging, 4);
assert.equal(perfect.ops, 5);

// A hitless line is all zeroes but keeps its plate appearances.
const hitless = build({ atBats: 9, hits: 0, doubles: 0, triples: 0, homers: 0, walks: 0, hitByPitch: 0, sacFlies: 0 });
assert.equal(hitless.average, 0);
assert.equal(hitless.onBase, 0);
assert.equal(hitless.slugging, 0);
assert.equal(hitless.ops, 0);
assert.equal(hitless.totalBases, 0);
assert.equal(hitless.plateAppearances, 9);

// Walks reach base but never count as at-bats or total bases.
const walked = build({ atBats: 2, hits: 1, doubles: 1, triples: 0, homers: 0, walks: 3, hitByPitch: 0, sacFlies: 1 });
assert.equal(walked.plateAppearances, 6);
near(walked.average, 0.5, 'walked average');
near(walked.onBase, 4 / 6, 'walked on-base');
near(walked.slugging, 1, 'walked slugging');
near(walked.ops, 4 / 6 + 1, 'walked ops');

// A sacrifice fly adds a plate appearance without adding an at-bat.
const sacFly = build({ atBats: 3, hits: 2, doubles: 0, triples: 0, homers: 1, walks: 0, hitByPitch: 0, sacFlies: 1 });
assert.equal(sacFly.plateAppearances, 4);
near(sacFly.average, 2 / 3, 'sac fly average');
near(sacFly.onBase, 2 / 4, 'sac fly on-base');
near(sacFly.slugging, 5 / 3, 'sac fly slugging');
near(sacFly.ops, 0.5 + 5 / 3, 'sac fly ops');

// Every hit may be an extra-base hit, and doubles, triples and homers may
// each use the full hit count.
const allExtra = build({ atBats: 10, hits: 3, doubles: 3, triples: 0, homers: 0, walks: 0, hitByPitch: 0, sacFlies: 0 });
assert.equal(allExtra.singles, 0);
assert.equal(allExtra.extraBaseHits, 3);
assert.equal(allExtra.totalBases, 6);

// Boundaries: a one-at-bat line and the maximum count are both accepted.
const one = build({ atBats: 1, hits: 0, doubles: 0, triples: 0, homers: 0, walks: 0, hitByPitch: 0, sacFlies: 0 });
assert.equal(one.plateAppearances, 1);
assert.equal(one.totalBases, 0);
const max = build({ atBats: 20000, hits: 20000, doubles: 20000, triples: 0, homers: 0, walks: 0, hitByPitch: 0, sacFlies: 0 });
assert.equal(max.totalBases, 40000);
assert.equal(max.slugging, 2);
assert.equal(max.plateAppearances, 20000);

// Form strings normalise to the same numbers, including surrounding spaces.
const fromForm = C.calculate({
  atBats: '415',
  hits: ' 128 ',
  doubles: '24',
  triples: '3',
  homers: '18',
  walks: '47',
  hitByPitch: '6',
  sacFlies: '4'
});
near(fromForm.ops, a.ops, 'form ops');
assert.equal(fromForm.totalBases, a.totalBases);

// Rejections: blanks, non-integers, negatives, signs, exponents and ranges.
rejects({ atBats: '' }, 'At-bats is required.');
rejects({ atBats: undefined }, 'At-bats is required.');
rejects({ atBats: '0' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: '20001' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: '415.0' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: '-415' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: '+415' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: '4e2' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ atBats: 'many' }, 'At-bats must be a whole number from 1 to 20000.');
rejects({ hits: '-1' }, 'Hits must be a whole number from 0 to 20000.');
rejects({ doubles: '2.5' }, 'Doubles must be a whole number from 0 to 20000.');
rejects({ triples: 'x' }, 'Triples must be a whole number from 0 to 20000.');
rejects({ homers: '20001' }, 'Home runs must be a whole number from 0 to 20000.');
rejects({ walks: '  ' }, 'Walks is required.');
rejects({ hitByPitch: '1.5' }, 'Hit by pitch must be a whole number from 0 to 20000.');
rejects({ sacFlies: '-4' }, 'Sacrifice flies must be a whole number from 0 to 20000.');

// Cross-field checks: hits cannot exceed at-bats, and extra-base hits cannot
// exceed hits.
rejects({ hits: 416 }, 'Hits cannot exceed at-bats.');
rejects({ hits: 416, atBats: 415, doubles: 0 }, 'Hits cannot exceed at-bats.');
rejects({ doubles: 129 }, 'Doubles, triples and home runs cannot add up to more than hits.');
rejects({ doubles: 24, triples: 60, homers: 50 }, 'Doubles, triples and home runs cannot add up to more than hits.');

// A deterministic sweep against the independent reference model.
let seed = 20261107;
const rnd = (n) => {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
};
for (let i = 0; i < 400; i += 1) {
  const atBats = 1 + rnd(600);
  const hits = rnd(atBats + 1);
  const doubles = rnd(hits + 1);
  const triples = rnd(hits - doubles + 1);
  const homers = rnd(hits - doubles - triples + 1);
  const line = {
    atBats,
    hits,
    doubles,
    triples,
    homers,
    walks: rnd(120),
    hitByPitch: rnd(10),
    sacFlies: rnd(10)
  };
  const got = C.calculate(line);
  const want = reference(line);
  near(got.singles, want.singles, `sweep ${i} singles`);
  near(got.extraBaseHits, want.extraBaseHits, `sweep ${i} extra-base hits`);
  near(got.totalBases, want.totalBases, `sweep ${i} total bases`);
  near(got.plateAppearances, want.plateAppearances, `sweep ${i} plate appearances`);
  near(got.average, want.average, `sweep ${i} average`);
  near(got.onBase, want.onBase, `sweep ${i} on-base`);
  near(got.slugging, want.slugging, `sweep ${i} slugging`);
  near(got.ops, want.onBase + want.slugging, `sweep ${i} ops`);
  assert.ok(got.average >= 0 && got.average <= 1, `sweep ${i} average range`);
  assert.ok(got.onBase >= 0 && got.onBase <= 1, `sweep ${i} on-base range`);
}

// The catalog record must describe this page and its cases must hold.
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8')
);
const records = catalog.tools.filter((tool) => tool.slug === 'baseball-slash-line-calculator');
assert.equal(records.length, 1, 'catalog must contain exactly one baseball slash line record');
const record = records[0];
assert.equal(record.name, 'Baseball Slash Line Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.aliases.includes('OPS Calculator'), 'catalog aliases must include OPS Calculator');
assert.ok(record.testCases.length >= 10, 'catalog must carry at least ten checks');

for (const test of record.testCases) {
  if (test.kind === 'validation') {
    assert.throws(
      () => C.calculate(test.input),
      (error) => error.message === test.expected.error,
      `catalog validation case: ${test.name}`
    );
    continue;
  }
  assert.equal(test.kind, 'golden', `catalog case kind: ${test.name}`);
  const got = C.calculate(test.input);
  for (const [key, expected] of Object.entries(test.expected)) {
    if (typeof expected === 'number') {
      near(got[key], expected, `catalog case ${test.name} ${key}`, 1e-9);
    } else {
      assert.equal(got[key], expected, `catalog case ${test.name} ${key}`);
    }
  }
}

assert.equal(C.MAX, 20000, 'maximum count is exposed');
assert.equal(C.FIELDS.length, 8, 'eight input fields are exposed');

console.log('baseball slash line calculator: all assertions passed');
