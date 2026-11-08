/* Regression checks for the bowling handicap core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'bowling-handicap-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* bowling-handicap-core:start */');
const end = html.indexOf('/* bowling-handicap-core:end */');
assert.ok(start > -1 && end > start, 'handicap core markers missing');
const core = html.slice(start, end + '/* bowling-handicap-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BowlingHandicapCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const analyze = (input) => plain(C.analyze(input));
const match = (input) => plain(C.match(input));

// Ranges, rules and the documented constants.
assert.equal(C.MIN_AVERAGE, 0);
assert.equal(C.MAX_AVERAGE, 300);
assert.equal(C.MIN_BASE, 100);
assert.equal(C.MAX_BASE, 300);
assert.equal(C.MIN_PERCENTAGE, 1);
assert.equal(C.MAX_PERCENTAGE, 100);
assert.equal(C.MIN_GAMES, 1);
assert.equal(C.MAX_GAMES, 10);
assert.deepEqual(plain(C.RULES), [[200, 90], [210, 90], [220, 90], [200, 80]]);

// Oracle, written out by hand: 200 - 170 = 30 pins of gap, 90% of it is 27,
// so three games carry 81 pins.
const base = analyze({ average: '170', base: '200', percentage: '90', games: '3' });
assert.equal(base.average, 170);
assert.equal(base.base, 200);
assert.equal(base.percentage, 90);
assert.equal(base.games, 3);
assert.equal(base.exact, 27);
assert.equal(base.perGame, 27);
assert.equal(base.series, 81);
assert.equal(base.belowBase, 30);
assert.equal(base.capped, false);

// Fractions round to the nearest pin, halves upward.
assert.equal(analyze({ average: '168', base: '200', percentage: '90', games: '3' }).exact, 28.8);
assert.equal(analyze({ average: '168', base: '200', percentage: '90', games: '3' }).perGame, 29);
assert.equal(analyze({ average: '165', base: '200', percentage: '90', games: '4' }).exact, 31.5);
assert.equal(analyze({ average: '165', base: '200', percentage: '90', games: '4' }).perGame, 32);
assert.equal(analyze({ average: '168.4', base: '200', percentage: '90', games: '3' }).perGame, 28);

// An average at or above the base never earns negative pins.
const above = analyze({ average: '205', base: '200', percentage: '90', games: '3' });
assert.equal(above.exact, -4.5);
assert.equal(above.perGame, 0);
assert.equal(above.series, 0);
assert.equal(above.belowBase, 0);
assert.equal(above.capped, true);
const level = analyze({ average: '200', base: '200', percentage: '90', games: '3' });
assert.equal(level.exact, 0);
assert.equal(level.perGame, 0);
assert.equal(level.capped, true);

// The series is the per-game handicap multiplied by the games played.
assert.equal(analyze({ average: '170', base: '200', percentage: '90', games: '1' }).series, 27);
assert.equal(analyze({ average: '100', base: '200', percentage: '90', games: '10' }).series, 900);
assert.equal(analyze({ average: '100', base: '200', percentage: '1', games: '3' }).series, 3);

// A match without an opponent only carries the bowler's own handicap.
const solo = match({ average: '170', base: '200', percentage: '90', games: '3', opponent: '' });
assert.equal(solo.opponent, null);
assert.equal(solo.differential, null);
assert.equal(solo.margin, null);
assert.equal(solo.yourAdjusted, null);
assert.equal(solo.result, null);

// Head to head: 27 a game against 20 a game, so this bowler receives 7 pins.
const head = match({
  average: '170', base: '200', percentage: '90', games: '3',
  opponent: '178', yourScore: '498', opponentScore: '512'
});
assert.equal(head.player.perGame, 27);
assert.equal(head.opponent.perGame, 20);
assert.equal(head.opponent.series, 60);
assert.equal(head.differential, 7);
assert.equal(head.yourAdjusted, 579);
assert.equal(head.opponentAdjusted, 572);
assert.equal(head.margin, 7);
assert.equal(head.result, 'win');

const lost = match({
  average: '190', base: '200', percentage: '90', games: '3',
  opponent: '160', yourScore: '520', opponentScore: '460'
});
assert.equal(lost.differential, -27);
assert.equal(lost.yourAdjusted, 547);
assert.equal(lost.opponentAdjusted, 568);
assert.equal(lost.result, 'loss');
assert.equal(lost.margin, -21);

const tied = match({
  average: '170', base: '200', percentage: '90', games: '3',
  opponent: '170', yourScore: '500', opponentScore: '500'
});
assert.equal(tied.result, 'tie');
assert.equal(tied.margin, 0);
assert.equal(tied.yourAdjusted, tied.opponentAdjusted);

// The quick-rule table keeps the same arithmetic at other bases and rates.
const rows = plain(C.ruleRows('170', '3'));
assert.equal(rows.length, 4);
assert.deepEqual(rows.map((row) => row.base), [200, 210, 220, 200]);
assert.deepEqual(rows.map((row) => row.percentage), [90, 90, 90, 80]);
assert.equal(rows[0].perGame, 27);
assert.equal(rows[1].perGame, 36);
assert.equal(rows[2].perGame, 45);
assert.equal(rows[3].perGame, 24);
assert.equal(rows[0].series, 81);

// Validation: each refusal names the field and the limit.
assert.throws(() => C.analyze({ average: '', base: '200', percentage: '90', games: '3' }),
  /Enter your average as pins per game, for example 170\./);
for (const bad of ['abc', '170,5', '1e2']) {
  assert.throws(() => C.analyze({ average: bad, base: '200', percentage: '90', games: '3' }),
    /The average must be a number of pins such as 170 or 168\.4/, bad);
}
for (const bad of ['301', '400']) {
  assert.throws(() => C.analyze({ average: bad, base: '200', percentage: '90', games: '3' }),
    /The average must be between 0 and 300 pins/, bad);
}
assert.throws(() => C.analyze({ average: '170', base: '', percentage: '90', games: '3' }),
  /Enter the handicap base, for example 200\./);
assert.throws(() => C.analyze({ average: '170', base: '350', percentage: '90', games: '3' }),
  /The handicap base must be between 100 and 300 pins/);
assert.throws(() => C.analyze({ average: '170', base: '200', percentage: '0', games: '3' }),
  /The handicap percentage must be between 1 and 100/);
assert.throws(() => C.analyze({ average: '170', base: '200', percentage: '90', games: '2.5' }),
  /The number of games must be a whole number such as 3/);
assert.throws(() => C.analyze({ average: '170', base: '200', percentage: '90', games: '11' }),
  /The number of games must be between 1 and 10/);
assert.throws(() => C.match({ average: '170', base: '200', percentage: '90', games: '3',
  opponent: '', yourScore: '500', opponentScore: '' }), /Enter the opponent's average to compare a match\./);
assert.throws(() => C.match({ average: '170', base: '200', percentage: '90', games: '3',
  opponent: '178', yourScore: '500', opponentScore: '' }),
  /Enter both scratch series, or leave both blank, to compare the match\./);
assert.throws(() => C.match({ average: '170', base: '200', percentage: '90', games: '3',
  opponent: '178', yourScore: '500', opponentScore: '901' }),
  /A scratch series must be between 0 and 900 pins/);
assert.throws(() => C.ruleRows('abc', '3'), /The average must be a number of pins/);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="hcp-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
for (const control of ['average', 'opponent', 'base', 'percentage', 'games', 'your-score', 'opponent-score']) {
  assert.ok(new RegExp(`<label class="f" for="${control}">`).test(html), `${control} is labelled`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(!/<table/i.test(html), 'page needs no table wrapper');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Bowling Handicap Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Scoring & match play');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.ok(/\(base - average\) x percentage \/ 100/.test(record.method), 'method states the formula');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local execution limits');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 8, 'eight boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

const close = (actual, expected, label) => {
  const tolerance = Math.max(Math.abs(expected) * 1e-4, 1e-9);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

function verify(expected, actual, label) {
  if (expected === null) {
    assert.equal(actual, null, label);
    return;
  }
  if (typeof expected === 'number') {
    close(actual, expected, label);
    return;
  }
  if (typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${label} is an object`);
    for (const [key, value] of Object.entries(expected)) verify(value, actual[key], `${label}.${key}`);
    return;
  }
  assert.deepEqual(actual, expected, label);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const run = (input) => (input.opponent || input.yourScore || input.opponentScore)
  ? C.match(input)
  : C.analyze(input);
for (const testCase of record.testCases) {
  const { expected } = testCase;
  if (expected.error) {
    assert.throws(() => run(testCase.input), new RegExp(escape(expected.error)), testCase.name);
    continue;
  }
  verify(expected, plain(run(testCase.input)), testCase.name);
}

console.log('bowling-handicap-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + rows.length + ' quick rules)');
