/* Magic number and games behind calculator: the race contract, the page markup
   and the catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'magic-number-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* magic-number-core:start */';
const endMarker = '/* magic-number-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Date, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = MagicNumberCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.build(payload); } catch (error) { return error.message; }
  return null;
};
const base = { nameA: 'Team A', winsA: '90', lossesA: '60', remainingA: '12',
  nameB: 'Team B', winsB: '85', lossesB: '65', remainingB: '12', tiebreak: 'undecided' };
const race = (patch) => C.build(Object.assign({}, base, patch));

// ---- Documented constants.
assert.equal(C.MAX_GAMES, 199);
assert.equal(C.MAX_NAME, 24);
assert.deepEqual(Array.from(C.TIEBREAKS), ['undecided', 'leader', 'chaser']);
assert.deepEqual(Object.keys(C.DEFAULTS).sort(),
  ['lossesA', 'lossesB', 'nameA', 'nameB', 'remainingA', 'remainingB', 'tiebreak', 'winsA', 'winsB']);
assert.equal(C.DEFAULTS.winsA, '90');
assert.equal(C.DEFAULTS.lossesB, '65');
assert.equal(C.DEFAULTS.tiebreak, 'undecided');

// ---- Whole-number parsing.
assert.equal(C.parseGames('12', 'wins'), 12);
assert.equal(C.parseGames('  7  ', 'wins'), 7);
assert.equal(C.parseGames('012', 'wins'), 12);
assert.equal(C.parseGames('0', 'wins'), 0);
assert.equal(C.parseGames(5, 'wins'), 5);
assert.equal(C.parseGames('199', 'wins'), 199);
assert.equal(failure({ winsA: '' }), 'Enter the wins of the first team as a whole number from 0 to 199.');
assert.equal(failure({ winsA: '200' }), 'The wins of the first team must be from 0 to 199; 200 is above that.');
assert.equal(failure({ winsA: '-1' }), 'Enter the wins of the first team as a whole number from 0 to 199; "-1" is not a whole number.');
assert.equal(failure({ winsA: '3.5' }), 'Enter the wins of the first team as a whole number from 0 to 199; "3.5" is not a whole number.');
assert.equal(failure({ winsA: '0012' }), 'Enter the wins of the first team as a whole number from 0 to 199; "0012" is not a whole number.');
assert.equal(failure({ lossesA: 'x' }), 'Enter the losses of the first team as a whole number from 0 to 199; "x" is not a whole number.');
assert.equal(failure({ remainingB: '' }), 'Enter the games left for the second team as a whole number from 0 to 199.');
assert.equal(failure({ remainingB: '1e2' }), 'Enter the games left for the second team as a whole number from 0 to 199; "1e2" is not a whole number.');
assert.ok(failure({ winsB: 'a'.repeat(40) }).includes('"aaaaaaaaaaaaaaaa..."'), 'long input is elided');

// ---- Names and the tiebreaker.
assert.equal(C.parseName('', 'Team A'), 'Team A');
assert.equal(C.parseName('   ', 'Team B'), 'Team B');
assert.equal(C.parseName('  Falcons  ', 'Team A'), 'Falcons');
assert.equal(C.parseName('A'.repeat(24), 'Team A'), 'A'.repeat(24));
assert.equal(failure({ nameA: 'A'.repeat(25) }), 'Keep the team name to 24 characters or fewer.');
assert.equal(failure({ nameB: 'Team\u0007B' }), 'A team name cannot contain control characters.');
assert.equal(C.parseTiebreak('leader'), 'leader');
assert.equal(C.parseTiebreak(''), 'undecided');
assert.equal(C.parseTiebreak(undefined), 'undecided');
assert.equal(failure({ tiebreak: 'draw' }),
  'Choose whether a tie is decided for the first team, for the second team, or not at all.');

// ---- The two statistics, computed on their own.
assert.equal(C.winPct(90, 60), 0.6);
assert.equal(C.winPct(0, 0), null);
assert.equal(C.gamesBehind({ wins: 90, losses: 60 }, { wins: 85, losses: 65 }), 5);
assert.equal(C.gamesBehind({ wins: 74, losses: 40 }, { wins: 68, losses: 46 }), 6);
assert.equal(C.gamesBehind({ wins: 68, losses: 46 }, { wins: 74, losses: 40 }), -6);
assert.equal(C.gamesBehind({ wins: 55, losses: 58 }, { wins: 74, losses: 40 }), -18.5);
assert.equal(C.magicNumber({ wins: 96 }, { wins: 93, remaining: 7 }, 'undecided'), 5);
assert.equal(C.magicNumber({ wins: 90 }, { wins: 85, remaining: 12 }, 'leader'), 7);
assert.equal(C.magicNumber({ wins: 90 }, { wins: 85, remaining: 12 }, 'chaser'), 8);

// ---- The default race.
const d = race({});
assert.equal(d.gamesBehind, 5);
assert.equal(d.gamesBehindText, '5');
assert.equal(d.pctAText, '0.600');
assert.equal(d.pctBText, '0.567');
assert.equal(d.maxWinsA, 102);
assert.equal(d.maxWinsB, 97);
assert.equal(d.magicNumberValue, 8);
assert.equal(d.magicText, '8');
assert.equal(d.eliminationText, '8');
assert.equal(d.leaderKind, 'first');
assert.equal(d.statusKind, 'ok');
assert.equal(d.warnings.length, 0);
assert.equal(d.rows.length, 2);
assert.equal(d.rows[0].gb, '-');
assert.equal(d.rows[0].record, '90-60');
assert.equal(d.rows[0].leads, true);
assert.equal(d.rows[1].gb, '5');
assert.equal(d.rows[1].leads, false);
assert.ok(d.summary.includes('leads Team B by 5 games'));
assert.ok(d.summary.includes('magic number is 8'));
assert.equal(d.explanation.length, 5);
assert.ok(d.explanation[0].includes('((90 - 85) + (65 - 60)) / 2 = 5'));

// ---- The published worked example: 162-game season, 96-58 against 93-62 with
// seven games left gives a magic number of five.
const published = C.build({ nameA: 'First', winsA: '96', lossesA: '58', remainingA: '8',
  nameB: 'Second', winsB: '93', lossesB: '62', remainingB: '7', tiebreak: 'undecided' });
assert.equal(published.magicNumberValue, 5);
assert.equal(published.gamesBehindText, '3.5');
assert.equal(published.summary.includes('magic number is 5'), true);

// ---- A decided tiebreaker moves the magic number by exactly one.
const tieLeader = race({ tiebreak: 'leader' });
const tieChaser = race({ tiebreak: 'chaser' });
assert.equal(tieLeader.magicNumberValue, 7);
assert.equal(tieChaser.magicNumberValue, 8);
assert.equal(tieLeader.magicNumberValue, tieChaser.magicNumberValue - 1);
assert.ok(tieLeader.warnings.some((line) => line.includes('dropped')));
assert.ok(tieChaser.warnings.some((line) => line.includes('strictly ahead')));
assert.equal(tieLeader.magicText, '7');

// ---- Clinching, a finished season and an inverted race.
const clinched = race({ winsB: '70', lossesB: '80', remainingB: '5' });
assert.equal(clinched.magicText, 'clinched');
assert.equal(clinched.eliminationText, 'eliminated');
assert.ok(clinched.warnings[0].includes('already has'));
assert.equal(clinched.gamesBehind, 20);

const tiedClinch = C.build({ winsA: '90', lossesA: '60', remainingA: '3',
  winsB: '85', lossesB: '65', remainingB: '5', tiebreak: 'leader' });
assert.equal(tiedClinch.magicNumberValue, 0);
assert.equal(tiedClinch.magicText, 'clinched');
assert.ok(tiedClinch.warnings[0].includes('level with the 90'));

const over = C.build({ nameA: 'A', winsA: '74', lossesA: '40', remainingA: '0',
  nameB: 'B', winsB: '68', lossesB: '46', remainingB: '0', tiebreak: 'undecided' });
assert.equal(over.magicText, 'season complete');
assert.equal(over.eliminationText, 'season complete');
assert.equal(over.leaderKind, 'first');
assert.equal(over.gamesBehind, 6);

const behind = C.build({ nameA: 'A', winsA: '80', lossesA: '70', remainingA: '10',
  nameB: 'B', winsB: '85', lossesB: '65', remainingB: '10', tiebreak: 'undecided' });
assert.equal(behind.leaderKind, 'second');
assert.equal(behind.gamesBehind, -5);
assert.equal(behind.gamesBehindText, '-5');
assert.equal(behind.magicText, 'not applicable');
assert.equal(behind.eliminationText, 'not applicable');
assert.equal(behind.statusKind, 'warning');
assert.ok(behind.statusText.includes('second team leads by 5 games'));
assert.ok(behind.warnings[0].includes('Swap the two records'));
assert.equal(behind.rows[0].gb, '5');
assert.equal(behind.rows[1].gb, '-');
assert.equal(behind.rows[1].leads, true);

// ---- Level records, no games played, and a magic number out of reach.
const level = C.build({ winsA: '82', lossesA: '68', remainingA: '5',
  winsB: '82', lossesB: '68', remainingB: '5', tiebreak: 'undecided' });
assert.equal(level.gamesBehind, 0);
assert.equal(level.leaderKind, 'level');
assert.equal(level.magicNumberValue, 6);
assert.equal(level.rows[0].gb, '0');
assert.equal(level.rows[0].leads, false);
assert.ok(level.warnings.some((line) => line.includes('level on games behind')));

const fresh = C.build({ winsA: '0', lossesA: '0', remainingA: '10',
  winsB: '0', lossesB: '0', remainingB: '10', tiebreak: 'undecided' });
assert.equal(fresh.pctA, null);
assert.equal(fresh.pctAText, '-');
assert.equal(fresh.magicNumberValue, 11);
assert.equal(fresh.leaderKind, 'level');

const unreachable = C.build({ winsA: '50', lossesA: '40', remainingA: '0',
  winsB: '50', lossesB: '40', remainingB: '5', tiebreak: 'undecided' });
assert.equal(unreachable.magicNumberValue, 6);
assert.ok(unreachable.warnings.some((line) => line.includes('larger than the 5 games')));
assert.equal(unreachable.warnings.length, 2);

// ---- The games-behind identity: with both teams on the same season length the
// magic number equals half the games left minus games behind plus one.
let identityChecks = 0;
const season = 162;
for (const [wa, la] of [[0, 0], [40, 40], [90, 60], [96, 58], [74, 40], [120, 40]]) {
  for (const [wb, lb] of [[0, 0], [50, 30], [85, 65], [93, 62], [68, 46]]) {
    const ra = season - wa - la;
    const rb = season - wb - lb;
    if (ra < 0 || rb < 0) continue;
    const result = C.build({ winsA: String(wa), lossesA: String(la), remainingA: String(ra),
      winsB: String(wb), lossesB: String(lb), remainingB: String(rb), tiebreak: 'undecided' });
    const expected = (ra + rb) / 2 - result.gamesBehind + 1;
    assert.equal(result.magicNumberValue, expected,
      `identity at ${wa}-${la}/${wb}-${lb} with ${ra}/${rb} left`);
    identityChecks += 1;
  }
}
assert.ok(identityChecks >= 25, 'the identity is exercised across the season');

// ---- Formatting helpers never leak negative zero or trailing noise.
assert.equal(C.fmtHalf(6), '6');
assert.equal(C.fmtHalf(18.5), '18.5');
assert.equal(C.fmtHalf(6.25), '6.3');
assert.equal(C.fmtHalf(-0.04), '0');
assert.equal(C.fmtPct(null), '-');
assert.equal(C.fmtPct(0.6), '0.600');
assert.equal(C.fmtPct(0.9999), '1.000');
assert.equal(C.fmtNum(-0.0001, 2), '0.00');

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'the page declares its language');
assert.ok(/<meta name="viewport"/.test(html), 'the page is mobile ready');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is used');
assert.ok(/<div id="site-header"><\/div>/.test(html), 'the shared header mount is present');
assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('<title>Magic Number &amp; Games Behind Calculator &mdash; virt.tools</title>'));
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'a description is supplied');
assert.ok(/<form id="race-form" novalidate>/.test(html), 'the form owns submission');
for (const id of ['in-name-a', 'in-wins-a', 'in-losses-a', 'in-remaining-a',
  'in-name-b', 'in-wins-b', 'in-losses-b', 'in-remaining-b', 'in-tiebreak']) {
  assert.ok(html.includes(`<label for="${id}">`), 'missing label for ' + id);
}
for (const id of ['in-wins-a', 'in-losses-a', 'in-remaining-a', 'in-wins-b', 'in-losses-b', 'in-remaining-b']) {
  assert.ok(new RegExp(`id="${id}"[^>]*type="number"[^>]*min="0"[^>]*max="199"`).test(html), 'bounded field ' + id);
}
assert.ok(/id="in-tiebreak"[^>]*name="tiebreak"/.test(html));
assert.ok(/<button id="calculate" class="primary" type="submit">/.test(html));
assert.ok(/<button id="example" type="button">/.test(html));
assert.ok(/<button id="reset" type="button">/.test(html));
assert.ok(/role="status" aria-live="polite"/.test(html), 'the status is announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(!/\son(click|change|input|submit|load)=/.test(html), 'no inline event handlers');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(html),
  'the page makes no network or storage calls');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no third-party scripts');
assert.ok(html.includes('@media(max-width:720px)'), 'the layout reflows for phones');
assert.ok(html.includes('min-height:44px'), 'controls keep a 44 px target');
assert.ok(html.includes('scope="col"'), 'table headers are scoped');
assert.ok(!/[\u0080-\uFFFF]/.test(html), 'the source stays ASCII');
for (const id of ['out-gb', 'out-gb-note', 'out-magic', 'out-elim', 'out-max', 'rows-body',
  'warnings', 'explanation', 'summary', 'status', 'error']) {
  assert.ok(html.includes(`id="${id}"`), 'missing output ' + id);
}
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'the shared scripts load last');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2301, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Magic Number & Games Behind Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Scoring & match play');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f3c6}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('((first wins - second wins) + (second losses - first losses)) / 2'),
  'the method states the games behind formula');
assert.ok(record.method.includes('second wins + second games left - first wins + 1'),
  'the method states the magic number formula');
assert.ok(record.method.includes('0 to 199'), 'the method states the input bounds');
assert.ok(record.method.includes('whole numbers'), 'the method states the integer rule');
assert.ok(record.method.includes('no uploads'), 'the method states the privacy position');
assert.ok(record.guidance.includes('win-loss records only'), 'the guidance states the scope');
assert.equal(record.sources.length, 2, 'sources are cited');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Games_behind');
assert.equal(record.sources[1].url, 'https://en.wikipedia.org/wiki/Magic_number_(sports)');
assert.ok(record.sources.every((source) => source.title.length > 30), 'sources are described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('magic-number'));
assert.ok(record.aliases.includes('Games Behind Calculator'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 46, 'Sports & Outdoors count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'no rival record');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'duplicate name: ' + tool.slug);
  assert.notEqual(tool.slug, slug, 'duplicate slug');
  const aliases = new Set((tool.aliases || []).map((alias) => alias.trim().toLowerCase()));
  for (const alias of record.aliases) {
    assert.ok(!aliases.has(alias.trim().toLowerCase()), `alias ${alias} clashes with ${tool.slug}`);
  }
}

assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 10);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.build(testCase.input);
  const expected = testCase.expected;
  near(result.gamesBehind, expected.gamesBehind, 0.05, testCase.name + ' games behind');
  if (expected.pctA === null) {
    assert.equal(result.pctA, null, testCase.name + ' first percentage');
  } else {
    near(result.pctA, expected.pctA, 0.0001, testCase.name + ' first percentage');
  }
  if (expected.pctB === null) {
    assert.equal(result.pctB, null, testCase.name + ' second percentage');
  } else {
    near(result.pctB, expected.pctB, 0.0001, testCase.name + ' second percentage');
  }
  assert.equal(result.maxWinsA, expected.maxWinsA, testCase.name + ' first maximum');
  assert.equal(result.maxWinsB, expected.maxWinsB, testCase.name + ' second maximum');
  assert.equal(result.magicNumberValue, expected.magic, testCase.name + ' magic number');
  assert.equal(result.magicText, expected.magicText, testCase.name + ' magic text');
  assert.equal(result.eliminationText, expected.elimText, testCase.name + ' elimination text');
  assert.equal(result.leaderKind, expected.leaderKind, testCase.name + ' leader kind');
  assert.equal(result.statusKind, expected.statusKind, testCase.name + ' status kind');
  assert.equal(result.warnings.length, expected.warnings, testCase.name + ' warnings');
  assert.ok(result.summary.length > 40, testCase.name + ' summary is written');
  assert.ok(result.explanation.length === 5, testCase.name + ' explanation is complete');
  assert.ok(result.statusText.length > 10, testCase.name + ' status is written');
}

console.log('magic number and games behind: all checks passed');
