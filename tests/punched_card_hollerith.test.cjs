/* Punched card (Hollerith) encoder: the IBM 029 table against the published
   source, the zone/digit rules, the 80-column card layout, the column reader,
   the catalog cases and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'punched-card-hollerith';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* hollerith-core:start */';
const endMarker = '/* hollerith-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = HollerithCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

// ---- The IBM 029 character set, transcribed from Doug Jones's punched card
//      codes page: printed character and the punched rows, zone first. The
//      space row has no punches; the 0-8-2 blank prints nothing.
const published = [
  [" ", ""],
  ["&", "12"],
  ["-", "11"],
  ["0", "0"],
  ["1", "1"],
  ["2", "2"],
  ["3", "3"],
  ["4", "4"],
  ["5", "5"],
  ["6", "6"],
  ["7", "7"],
  ["8", "8"],
  ["9", "9"],
  ["A", "12-1"],
  ["B", "12-2"],
  ["C", "12-3"],
  ["D", "12-4"],
  ["E", "12-5"],
  ["F", "12-6"],
  ["G", "12-7"],
  ["H", "12-8"],
  ["I", "12-9"],
  ["J", "11-1"],
  ["K", "11-2"],
  ["L", "11-3"],
  ["M", "11-4"],
  ["N", "11-5"],
  ["O", "11-6"],
  ["P", "11-7"],
  ["Q", "11-8"],
  ["R", "11-9"],
  ["/", "0-1"],
  ["S", "0-2"],
  ["T", "0-3"],
  ["U", "0-4"],
  ["V", "0-5"],
  ["W", "0-6"],
  ["X", "0-7"],
  ["Y", "0-8"],
  ["Z", "0-9"],
  [":", "8-2"],
  ["#", "8-3"],
  ["@", "8-4"],
  ["'", "8-5"],
  ["=", "8-6"],
  ["\"", "8-7"],
  ["\u00A2", "12-8-2"],
  [".", "12-8-3"],
  ["<", "12-8-4"],
  ["(", "12-8-5"],
  ["+", "12-8-6"],
  ["|", "12-8-7"],
  ["!", "11-8-2"],
  ["$", "11-8-3"],
  ["*", "11-8-4"],
  [")", "11-8-5"],
  [";", "11-8-6"],
  ["\u00AC", "11-8-7"],
  ["", "0-8-2"],
  [",", "0-8-3"],
  ["%", "0-8-4"],
  ["_", "0-8-5"],
  [">", "0-8-6"],
  ["?", "0-8-7"]
];

assert.equal(C.CODES.length, 64, '64 codes');
assert.equal(published.length, 64, 'the transcribed table has 64 rows');
C.CODES.forEach((entry, index) => {
  assert.equal(entry.char, published[index][0], 'character ' + index);
  assert.equal(entry.rows.join('-'), published[index][1], 'punches for ' + JSON.stringify(published[index][0]));
});
assert.equal(new Set(C.CODES.map((entry) => entry.char)).size, 64, 'every character appears once');
assert.equal(new Set(C.CODES.map((entry) => entry.rows.join('-'))).size, 64, 'every punch pattern appears once');
assert.equal(JSON.stringify(C.ROWS),
  JSON.stringify(['12', '11', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']),
  'the 12 rows top to bottom');

// ---- The zone and digit rule: letters are one zone punch and one digit punch,
//      digits are a single hole, and the row 8 symbols sit between the two.
const byChar = {};
C.CODES.forEach((entry) => { byChar[entry.char] = entry.rows; });
for (let i = 0; i < 9; i += 1) {
  assert.equal(JSON.stringify(byChar[String.fromCharCode(65 + i)]), JSON.stringify(['12', String(i + 1)]), 'A to I use zone 12');
  assert.equal(JSON.stringify(byChar[String.fromCharCode(74 + i)]), JSON.stringify(['11', String(i + 1)]), 'J to R use zone 11');
}
for (let i = 0; i < 8; i += 1) {
  assert.equal(JSON.stringify(byChar[String.fromCharCode(83 + i)]), JSON.stringify(['0', String(i + 2)]), 'S to Z use zone 0');
}
for (let digit = 0; digit <= 9; digit += 1) {
  assert.equal(JSON.stringify(byChar[String(digit)]), JSON.stringify([String(digit)]), 'digit ' + digit + ' is one hole');
}
for (let index = 2; index <= 7; index += 1) {
  assert.equal(JSON.stringify(byChar[':#@\'="'[index - 2]]), JSON.stringify(['8', String(index)]), 'row 8 symbols');
  assert.equal(JSON.stringify(byChar['\u00A2.<(+|'[index - 2]]), JSON.stringify(['12', '8', String(index)]), 'zone 12 row 8 symbols');
  assert.equal(JSON.stringify(byChar['!$*);\u00AC'[index - 2]]), JSON.stringify(['11', '8', String(index)]), 'zone 11 row 8 symbols');
}
assert.equal(JSON.stringify(byChar[' ']), JSON.stringify([]), 'space is a column with no holes');
assert.equal(JSON.stringify(byChar['']), JSON.stringify(['0', '8', '2']), 'the 0-8-2 blank');

// ---- Encoding: text becomes columns, padded to 80 per card.
const hello = C.encode('HELLO WORLD');
assert.equal(hello.cardCount, 1);
assert.equal(hello.columnCount, 11);
assert.equal(JSON.stringify(hello.codes), JSON.stringify(['12-8', '12-5', '11-3', '11-3', '11-6', '', '0-6', '11-6', '11-9', '11-3', '12-4']));
assert.equal(hello.cards[0].columns.length, 80, 'every card is padded to 80 columns');
assert.equal(JSON.stringify(hello.cards[0].columns[5].rows), JSON.stringify([]), 'the space column has no holes');
assert.equal(hello.cards[0].columns[79].char, ' ', 'padding is blank');
assert.equal(JSON.stringify(hello.invalid), JSON.stringify([]));

const raised = C.encode('hello world');
assert.equal(JSON.stringify(raised.codes), JSON.stringify(hello.codes), 'lowercase is raised before punching');
assert.equal(JSON.stringify(raised.invalid), JSON.stringify([]));

const unknown = C.encode('CAF\u00C9 \t!');
assert.equal(JSON.stringify(unknown.invalid), JSON.stringify(['\u00C9', '\t']), 'characters outside the set are reported once each');
assert.equal(unknown.codes[3], '?', 'an unknown character is marked, not guessed');
assert.equal(JSON.stringify(C.encode('').cards), JSON.stringify([]), 'empty input punches nothing');
assert.equal(C.encode('').cardCount, 0);

// ---- Line breaks and the 80-column card boundary.
assert.equal(C.encode('A'.repeat(80)).cardCount, 1);
assert.equal(C.encode('A'.repeat(81)).cardCount, 2);
assert.equal(C.encode('A'.repeat(81)).cards[1].columns[0].char, 'A', 'the 81st column starts the next card');
assert.equal(C.encode('A'.repeat(81)).cards[1].columns[1].char, ' ', 'the rest of the second card is blank');
assert.equal(C.encode('AB\nCD').cardCount, 2);
assert.equal(C.encode('AB\nCD').codes.join(' '), '12-1 12-2 12-3 12-4');
assert.equal(C.encode('AB\n').cardCount, 1, 'a trailing new line adds no card');
assert.equal(C.encode('\n').cardCount, 1, 'an explicit blank line still makes a blank card');
assert.equal(C.encode('A'.repeat(640)).cardCount, 8);
assert.throws(() => C.encode('A'.repeat(641)), /needs 9/);

// ---- The column reader canonicalises the row order and names the result.
const period = C.decodeColumn('12-8-3');
assert.equal(period.char, '.');
assert.equal(period.code, '12-8-3');
assert.equal(period.blank, false);
assert.equal(C.decodeColumn('8-3-12').code, '12-8-3', 'rows can be entered in any order');
assert.equal(C.decodeColumn('3 12 8').char, '.', 'spaces separate rows too');
assert.equal(C.decodeColumn('10-8-2').code, '0-8-2', 'row 10 is the row 0 punch');
assert.equal(C.decodeColumn('10-8-2').blank, true);
assert.equal(C.decodeColumn('none').code, '', 'no holes read as a space');
assert.equal(C.decodeColumn('space').char, ' ');
assert.equal(C.decodeColumn('blank').code, '0-8-2');

const failure = (input) => {
  try {
    if (input.punch !== undefined) { C.decodeColumn(input.punch); } else { C.encode(input.text); }
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
assert.equal(failure({ punch: '' }), 'Enter the rows punched in one column, for example 12-8-3.');
assert.equal(failure({ punch: '13' }), 'Rows are 12, 11, 0 (or 10) and 1 to 9.');
assert.equal(failure({ punch: '12-1-2' }), 'No IBM 029 character uses rows 12-1-2.');

// ---- Every printable code round-trips through the encoder and the reader.
C.CODES.forEach((entry) => {
  if (entry.char === '' || entry.char === ' ') { return; }
  const result = C.encode(entry.char);
  assert.equal(result.codes[0], entry.rows.join('-'), 'encoding ' + entry.char);
  assert.equal(C.decodeColumn(entry.rows.join('-')).char, entry.char, 'reading back ' + entry.char);
});

// ---- Catalog record: counts, cases and metadata.
assert.equal(catalog.tools.length, 2524, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2263, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Encoding').length, 57, 'Encoding count');
assert.equal(record.category, 'Encoding');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600, 'the method explains the card code');
assert.ok(/IBM 029/.test(record.method), 'the method names the keypunch');
assert.ok(/0-8-2/.test(record.method), 'the method names the blank column');
assert.equal(record.sources.length, 3);
assert.equal(record.sources[0].url, 'https://homepage.divms.uiowa.edu/~jones/cards/codes.html');
assert.equal(record.sources[1].url, 'http://homepage.cs.uiowa.edu/~jones/pdp8/man/card.html');
assert.equal(record.sources[2].url, 'https://en.wikipedia.org/wiki/Punched_card');
for (const source of record.sources) {
  assert.match(source.title, /card/i, 'every source title names the card');
  assert.match(source.url, /^https?:\/\//);
}
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');
assert.match(record.added, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.equal(record.testCases.length, 17);

const counts = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(counts.golden, 6);
assert.equal(counts.boundary, 7);
assert.equal(counts.validation, 4);

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = testCase.input.punch !== undefined
    ? C.decodeColumn(testCase.input.punch)
    : C.encode(testCase.input.text);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness across the catalog: no other tool claims this name, alias or slug.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) => /hollerith|punched-card|keypunch/.test(tool.slug) && tool.slug !== slug),
  'no other punched-card tool is filed');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>Punched Card \(Hollerith\) Code<\/h1>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<textarea/g) || []).length, 1, 'one text area');
assert.equal((html.match(/<input/g) || []).length, 1, 'one reader input');
assert.equal((html.match(/<label for="/g) || []).length, 2, 'both fields are labelled');
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/<button type="button"/g) || []).length, 2);
assert.match(html, /min-height:4[46]px/, 'controls keep a touch-sized target');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored/i, 'the privacy note stays on the page');
assert.match(html, /IBM 029/, 'the page names the keypunch');
assert.equal((html.match(/\/\* hollerith-core:start \*\//g) || []).length, 1);
assert.equal((html.match(/\/\* hollerith-core:end \*\//g) || []).length, 1);

console.log('punched_card_hollerith: all checks passed');
