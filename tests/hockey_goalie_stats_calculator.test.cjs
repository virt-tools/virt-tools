/* Regression checks for the hockey goalie stats core.
 *
 * The arithmetic is checked against an exact rational oracle written here with
 * BigInt: each rate is rounded from an integer numerator and denominator, so the
 * oracle never shares the page's floating-point rounding step. The published
 * definitions come from the Hockey-Reference glossary (GAA = GA / MIN x 60,
 * SV% = SV / SA, SV = SA - GA) and are pinned as fixed expectations below.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hockey-goalie-stats-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* goalie-core:start */');
const end = html.indexOf('/* goalie-core:end */');
assert.ok(start > -1 && end > start, 'goalie core markers missing');
const core = html.slice(start, end + '/* goalie-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GoalieStatsCore;', sandbox);
const C = sandbox.module.exports;

// ---- Exact decimal rounding, half away from zero, on a non-negative fraction.
// Returns the rounded value as a Number of numerator/denominator at `digits`.
function exactRound(numerator, denominator, digits, label) {
  const factor = 10n ** BigInt(digits);
  const num = BigInt(numerator) * factor;
  const den = BigInt(denominator);
  const rounded = (2n * num + den) / (2n * den);
  const value = Number(rounded) / Number(factor);
  if (!Number.isFinite(value)) throw new Error(`${label}: oracle overflow`);
  return value;
}
const isTie = (numerator, denominator) => {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  return (2n * (num % den)) === den;
};

// ---- 1. Worked examples from the definitions, by hand.
// 2 goals in 58:12 is 2 x 60 / 58.2 minutes.
const defaultLine = C.calculate({ minutes: '58:12', goalsAgainst: 2, saves: 27 });
assert.equal(defaultLine.seconds, 3492, '58:12 is 3492 seconds');
assert.equal(defaultLine.minutesPlayed, 58.2, 'fractional minutes');
assert.equal(defaultLine.minutesText, '58:12', 'normalised clock');
assert.equal(defaultLine.shotsAgainst, 29, 'shots faced is saves plus goals');
assert.equal(defaultLine.gaa, 2.06, 'GAA to two decimals');
assert.equal(defaultLine.savePct, 0.931, '27 of 29 is .931');
assert.equal(defaultLine.savePctPercent, 93.1, 'the same as a percentage');
assert.equal(defaultLine.shotsAgainstPer60, 29.9, '29 shots over 58.2 minutes is 29.90 per 60');
assert.equal(C.formatGaa(defaultLine), '2.06');
assert.equal(C.formatSavePct(defaultLine), '.931');
assert.equal(C.formatPercent(defaultLine), '93.1%');
assert.equal(C.formatRate(defaultLine.shotsAgainstPer60), '29.90');

// A 2,400-minute season with 100 goals against is exactly 2.50, and 1,100 saves
// out of 1,200 shots is .917.
const season = C.calculate({ minutes: '2400', goalsAgainst: 100, saves: 1100 });
assert.equal(season.seconds, 144000);
assert.equal(season.minutesText, '2400:00');
assert.equal(season.gaa, 2.5);
assert.equal(season.savePct, 0.917);
assert.equal(season.savePctPercent, 91.7);
assert.equal(season.shotsAgainstPer60, 30);

// A shutout cannot have a goals against average above zero, and a goalie who
// stopped every shot has a save percentage of 1.000.
const shutout = C.calculate({ minutes: '65:00', goalsAgainst: 0, saves: 45 });
assert.equal(shutout.gaa, 0);
assert.equal(shutout.savePct, 1);
assert.equal(C.formatSavePct(shutout), '1.000');
assert.equal(shutout.shotsAgainstPer60, 41.54, '45 shots in 65 minutes');

// ---- 2. Identities: the minutes form must not change the answer, doubling the
// workload must not change GAA, and every extra save must not lower SV%.
assert.deepEqual(C.calculate({ minutes: '58.2', goalsAgainst: 2, saves: 27 }), defaultLine);
const doubled = C.calculate({ minutes: '116:24', goalsAgainst: 4, saves: 54 });
assert.equal(doubled.gaa, defaultLine.gaa, 'doubling goals and ice time keeps GAA');
assert.equal(doubled.savePct, defaultLine.savePct, 'doubling saves and goals keeps SV%');
assert.equal(doubled.shotsAgainst, 58);
for (let saves = 0; saves <= 29; saves += 1) {
  const line = C.calculate({ minutes: '60', goalsAgainst: 2, saves });
  const previous = saves === 0 ? -1 : C.calculate({ minutes: '60', goalsAgainst: 2, saves: saves - 1 }).savePct;
  assert.ok(line.savePct >= previous, `SV% must not fall when save ${saves} is added`);
}

// ---- 3. Grid against the exact oracle. Ties at the rounding boundary are
// counted and skipped instead of being judged, because two correct
// implementations may disagree on exact halves.
let seed = 20261117;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
let compared = 0;
let ties = 0;
for (let index = 0; index < 900; index += 1) {
  const seconds = 1 + Math.floor(random() * 59999);
  const goalsAgainst = Math.floor(random() * 40);
  const saves = Math.floor(random() * 60);
  const minutesText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const line = C.calculate({ minutes: minutesText, goalsAgainst, saves });
  assert.equal(line.seconds, seconds, 'clock round trip');
  assert.equal(line.shotsAgainst, saves + goalsAgainst);
  if (isTie(360000 * goalsAgainst, seconds) || isTie(360000 * line.shotsAgainst, seconds)
      || (line.shotsAgainst > 0 && isTie(saves * 1000, line.shotsAgainst))) {
    ties += 1;
    continue;
  }
  assert.equal(line.gaa, exactRound(3600 * goalsAgainst, seconds, 2, 'gaa'), `GAA for ${minutesText}`);
  assert.equal(line.shotsAgainstPer60, exactRound(3600 * line.shotsAgainst, seconds, 2, 'sa60'), `SA/60 for ${minutesText}`);
  if (line.shotsAgainst === 0) {
    assert.equal(line.savePct, null, 'no shots means no save percentage');
    assert.equal(C.formatSavePct(line), '\u2014');
  } else {
    const thousandths = Math.round(Number(exactRound(saves * 1000, line.shotsAgainst, 0, 'sv')) / 1);
    assert.equal(line.savePct, exactRound(saves, line.shotsAgainst, 3, 'sv'), `SV% for ${minutesText}`);
    assert.equal(line.savePctPercent, thousandths / 10, `SV% percentage for ${minutesText}`);
  }
  compared += 1;
}
assert.ok(compared >= 500, `grid should compare at least 500 lines, compared ${compared}`);
assert.ok(ties < 90, `too many rounding ties skipped: ${ties}`);

// ---- 4. Minutes parsing: both accepted forms, and each refusal.
const secondsOf = (minutes) => C.calculate({ minutes, goalsAgainst: 0, saves: 1 }).seconds;
assert.equal(secondsOf('0:01'), 1);
assert.equal(secondsOf('0.5'), 30);
assert.equal(secondsOf('1'), 60);
assert.equal(secondsOf('009:07'), 547);
assert.equal(secondsOf('100000'), 6000000);
const refusals = [
  ['', 'Minutes played is required.'],
  ['1:60', 'Minutes played must be minutes and seconds with the seconds below 60, like 58:12, or a decimal number of minutes like 58.2.'],
  ['1:2', 'Minutes played must be minutes and seconds with the seconds below 60, like 58:12, or a decimal number of minutes like 58.2.'],
  ['forty', 'Minutes played must be minutes and seconds with the seconds below 60, like 58:12, or a decimal number of minutes like 58.2.'],
  ['-5', 'Minutes played must be minutes and seconds with the seconds below 60, like 58:12, or a decimal number of minutes like 58.2.'],
  ['0:00', 'Minutes played must be greater than zero.'],
  ['0.001', 'Minutes played must be at least one second.'],
  ['100001', 'Minutes played must be 100000 minutes or fewer.'],
  ['100000:01', 'Minutes played must be 100000 minutes or fewer.']
];
for (const [minutes, message] of refusals) {
  assert.throws(() => C.calculate({ minutes, goalsAgainst: 1, saves: 1 }), (error) => {
    assert.equal(error.message, message, `minutes ${JSON.stringify(minutes)}`);
    return true;
  });
}
assert.throws(() => C.calculate({ minutes: '58:12', goalsAgainst: 2.5, saves: 27 }),
  /^Error: Goals against must be a whole number from 0 to 10000\.$/);
assert.throws(() => C.calculate({ minutes: '58:12', goalsAgainst: 0, saves: 10001 }),
  /^Error: Saves must be a whole number from 0 to 10000\.$/);
assert.throws(() => C.calculate({ minutes: '58:12', goalsAgainst: -1, saves: 27 }),
  /^Error: Goals against must be a whole number from 0 to 10000\.$/);
assert.throws(() => C.calculate({ minutes: '58:12', goalsAgainst: 1, saves: 'many' }),
  /^Error: Saves must be a whole number from 0 to 10000\.$/);

// ---- 5. Catalog replay: every stored case, against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.calculate(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, `${testCase.name}: wrong refusal`);
      return true;
    }, `${testCase.name}: expected a refusal`);
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    assert.equal(result[field], value, `${testCase.name}: ${field}`);
  }
}

// ---- 6. Record metadata, totals and uniqueness against the whole catalog.
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2468, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2207, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(record.name, 'Hockey Goalie Stats Calculator');
assert.equal(record.category, 'Sports & Outdoors');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1F3D2}');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Sports & Outdoors').length, 55,
  'Sports & Outdoors count');
assert.ok(Array.isArray(record.sources) && record.sources.length === 3, 'three sources');
assert.ok(record.sources.every((entry) => /^https:\/\//.test(entry.url)), 'every source is https');
assert.ok(record.sources.some((entry) => entry.url.includes('hockey-reference.com/about/glossary')),
  'Hockey-Reference glossary cited');
assert.ok(record.sources.some((entry) => entry.url.endsWith('/Goals_against_average')), 'GAA definition cited');
assert.ok(record.sources.some((entry) => entry.url.endsWith('/Save_percentage')), 'SV% definition cited');
assert.ok(typeof record.method === 'string' && record.method.length > 900, 'method documented');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 200, 'guidance present');
assert.ok(record.aliases.length >= 6 && new Set(record.aliases).size === record.aliases.length, 'aliases unique');
assert.ok(record.tags.length >= 6 && new Set(record.tags).size === record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 18, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 6, 'golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6, 'boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6, 'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, `name collides with ${other.slug}`);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).map((value) => value.toLowerCase()).includes(alias.toLowerCase()),
      `alias ${alias} collides with ${other.slug}`);
  }
}

// ---- 7. Page contract: offline, keyboard-submittable, mobile-safe.
assert.ok(html.includes('id="goalie-form"'), 'form present');
for (const id of ['in-minutes', 'in-goals', 'in-saves', 'out', 'err']) {
  assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
}
for (const id of ['in-minutes', 'in-goals', 'in-saves']) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(html), `label for ${id}`);
}
assert.ok(/<button\b[^>]*type="submit"/.test(html), 'submit button present');
assert.ok(html.includes('aria-live="polite"'), 'results are announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(html.includes('<meta name="description"'), 'meta description present');
assert.ok(html.includes('@media (max-width:380px)'), 'mobile layout present');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1, 'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write', 'WebSocket']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')), 'no external URLs in the page');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');

console.log(`hockey goalie stats: ${record.testCases.length} catalog cases, ${compared} exact-oracle grid lines (${ties} ties skipped), parsing, formatting and page contract OK`);
