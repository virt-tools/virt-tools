/* strftime date format builder: the expansion of the C strftime codes, the
   padding flags, the ISO week and week-number edges, the refusals, the catalog
   cases and the page contract. The golden strings in this file were produced by
   CPython's datetime.strftime under LC_ALL=C, so the suite is not only
   self-referential. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'strftime-date-format-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* strftime-core:start */';
const endMarker = '/* strftime-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = StrftimeCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');

const run = (overrides) => C.format(Object.assign({
  epoch: '1795797600',
  offset: '+00:00',
  format: '%Y-%m-%d %H:%M:%S'
}, overrides || {}));
const failure = (overrides) => {
  try {
    run(overrides);
  } catch (error) {
    return error.message;
  }
  return 'no error';
};
const accepted = (overrides) => failure(overrides) === 'no error';

// ---- Golden strings, cross-checked against CPython (LC_ALL=C).
const fixtures = [
  ['1795797600', '+00:00', '2026-11-27T16:40:00+00:00', 'Friday', '2026-W48'],
  ['951827696', '+00:00', '2000-02-29T12:34:56+00:00', 'Tuesday', '2000-W09'],
  ['1609459200', '+00:00', '2021-01-01T00:00:00+00:00', 'Friday', '2020-W53'],
  ['1609459199', '-05:00', '2020-12-31T18:59:59-05:00', 'Thursday', '2020-W53'],
  ['1767225600', '+00:00', '2026-01-01T00:00:00+00:00', 'Thursday', '2026-W01'],
  ['0', '+00:00', '1970-01-01T00:00:00+00:00', 'Thursday', '1970-W01'],
  ['1795797600', '+05:30', '2026-11-27T22:10:00+05:30', 'Friday', '2026-W48'],
  ['1795797600', '+14:00', '2026-11-28T06:40:00+14:00', 'Saturday', '2026-W48']
];
for (const [epoch, offset, iso, weekday, isoWeek] of fixtures) {
  const result = run({ epoch, offset });
  assert.equal(result.iso, iso, 'ISO stamp for ' + epoch + ' at ' + offset);
  assert.equal(result.weekday, weekday, 'weekday for ' + epoch);
  assert.equal(result.isoWeek, isoWeek, 'ISO week for ' + epoch);
  assert.equal(result.epoch, Number(epoch));
}

const golden = {
  '%Y-%m-%d %H:%M:%S': '2026-11-27 16:40:00',
  '%A, %e %B %Y': 'Friday, 27 November 2026',
  '%a %b %d %j %U %W %V %G %u %w': 'Fri Nov 27 331 47 47 48 2026 5 5',
  '%F %T %R %r %p %P': '2026-11-27 16:40:00 16:40 04:40:00 PM PM pm',
  '%s %z %Z': '1795797600 +0000 UTC',
  '%-d/%-m/%Y %_H:%M': '27/11/2026 16:40',
  '%C %y %g %h': '20 26 26 Nov',
  '%c': 'Fri Nov 27 16:40:00 2026',
  '%x %X %D': '11/27/26 16:40:00 11/27/26'
};
for (const [format, expected] of Object.entries(golden)) {
  assert.equal(run({ format }).output, expected, format);
}

// The space-padded %e keeps two spaces on a single-digit day, as strftime does.
assert.equal(run({ epoch: '1609459200', format: '%A, %e %B %Y' }).output, 'Friday,  1 January 2021');
// Leap day is day 060 of the year and ISO week 09.
assert.equal(run({ epoch: '951827696', format: '%a %b %d %j %U %W %V %G %u %w' }).output,
  'Tue Feb 29 060 09 09 09 2000 2 2');
// %s is the input instant, not re-derived from the offset (CPython's %s is wrong here).
assert.equal(run({ epoch: '1609459199', offset: '-05:00', format: '%s %z %Z' }).output,
  '1609459199 -0500 UTC-05:00');
assert.equal(run({ offset: '+05:30', format: '%s %z %Z' }).output, '1795797600 +0530 UTC+05:30');
// The offset moves the calendar day but not the instant.
assert.equal(run({ offset: '+14:00', format: '%Y-%m-%d %H:%M %z' }).output, '2026-11-28 06:40 +1400');

// ---- ISO week edges: the week belongs to the year that owns its Thursday.
const isoEdges = [
  ['1609459200', '+00:00', '2020-W53-5'], // Friday 2021-01-01
  ['1609286400', '+00:00', '2020-W53-3'], // Wednesday 2020-12-30
  ['1609372800', '+00:00', '2020-W53-4'], // Thursday 2020-12-31
  ['1577664000', '+00:00', '2020-W01-1'], // Monday 2019-12-30
  ['1577836800', '+00:00', '2020-W01-3'], // Wednesday 2020-01-01
  ['1767225600', '+00:00', '2026-W01-4'], // Thursday 2026-01-01
  ['951782400', '+00:00', '2000-W09-2']   // Tuesday 2000-02-29
];
for (const [epoch, offset, expected] of isoEdges) {
  assert.equal(run({ epoch, offset, format: '%G-W%V-%u' }).output, expected, 'ISO ' + epoch);
}

// ---- %U starts on Sunday and %W on Monday; days before the first one are week 00.
const weekEdges = [
  ['1609459200', '00', '00'], // Fri 2021-01-01
  ['1609632000', '01', '00'], // Sun 2021-01-03
  ['1609718400', '01', '01'], // Mon 2021-01-04
  ['1767225600', '00', '00'], // Thu 2026-01-01
  ['1767484800', '01', '00'], // Sun 2026-01-04
  ['1767571200', '01', '01']  // Mon 2026-01-05
];
for (const [epoch, sunday, monday] of weekEdges) {
  assert.equal(run({ epoch, format: '%U' }).output, sunday, '%U ' + epoch);
  assert.equal(run({ epoch, format: '%W' }).output, monday, '%W ' + epoch);
}

// ---- Day of year, weekday numbers and the 12-hour clock.
assert.equal(run({ epoch: '1609459200', format: '%j|%u|%w|%I|%l|%k|%H' }).output,
  '001|5|5|12|12| 0|00');
assert.equal(run({ epoch: '951827696', format: '%j|%u|%w|%p|%P' }).output,
  '060|2|2|PM|pm');
assert.equal(run({ epoch: '1795797600', offset: '-05:00', format: '%H|%I|%p' }).output,
  '11|11|AM');
assert.equal(run({ epoch: '1795797600', format: '%y|%C|%g|%G' }).output, '26|20|26|2026');

// ---- GNU padding flags: no padding, space padding, zero padding.
assert.equal(run({ epoch: '1772694249', format: '%-d %_d %0e %-m %_m %0k %-H %_H' }).output,
  '5  5 05 3  3 07 7  7');
assert.equal(run({ epoch: '1609459200', format: '%-d/%-m/%Y %_H:%M' }).output, '1/1/2021  0:00');

// ---- The reference table covers every supported code, and each one expands.
assert.ok(C.REFERENCE.length >= 40, 'the reference lists the whole set');
const codes = new Set(C.REFERENCE.map((item) => item.code.slice(1)));
for (const code of ['a','A','b','B','C','c','d','D','e','F','g','G','h','H','I','j','k','l','m','M',
  'n','p','P','r','R','s','S','t','T','u','U','V','w','W','x','X','y','Y','z','Z','%']) {
  assert.ok(codes.has(code), 'the reference lists %' + code);
}
for (const item of C.REFERENCE) {
  const result = run({ format: item.code });
  assert.equal(JSON.stringify(result.warnings), '[]', item.code + ' is supported');
  assert.ok(result.output.length > 0, item.code + ' renders a value');
  assert.notEqual(result.output, item.code, item.code + ' is expanded, not left as written');
  assert.equal(result.directives.length, 1, item.code + ' is one directive');
  assert.equal(result.directives[0].token, item.code);
  assert.equal(result.directives[0].meaning, item.meaning);
}
assert.equal(run({ format: '%n' }).directives[0].value, 'newline');
assert.equal(run({ format: '%t' }).directives[0].value, 'tab');
assert.equal(run({ format: '%n|%t' }).output, '\n|\t');

// ---- Unknown and dangling codes are preserved, with a warning.
const unknown = run({ format: 'Q%q%_q%' });
assert.equal(unknown.output, 'Q%q%_q%');
assert.equal(unknown.directives.length, 2);
assert.equal(unknown.warnings.length, 3);
assert.match(unknown.warnings[0], /%q/);
assert.match(unknown.warnings[2], /trailing %/);
assert.equal(run({ format: '100%%' }).output, '100%');
assert.equal(JSON.stringify(run({ format: '100%%' }).warnings), '[]');

// ---- Refusals.
assert.equal(failure({ epoch: '' }), 'The Unix time must be a whole number of seconds.');
assert.equal(failure({ epoch: '1.5' }), 'The Unix time must be a whole number of seconds.');
assert.equal(failure({ epoch: 'now' }), 'The Unix time must be a whole number of seconds.');
assert.equal(failure({ epoch: '253402300800' }), 'The Unix time must be between 0001-01-01 and 9999-12-31.');
assert.equal(failure({ epoch: '-62135596801' }), 'The Unix time must be between 0001-01-01 and 9999-12-31.');
assert.equal(failure({ offset: '' }), 'The UTC offset must look like +02:00, between -12:00 and +14:00.');
assert.equal(failure({ offset: '2:00' }), 'The UTC offset must look like +02:00, between -12:00 and +14:00.');
assert.equal(failure({ offset: '+14:30' }), 'The UTC offset must look like +02:00, between -12:00 and +14:00.');
assert.equal(failure({ offset: '-12:30' }), 'The UTC offset must look like +02:00, between -12:00 and +14:00.');
assert.ok(accepted({ offset: '+14:00' }), 'the +14:00 edge is accepted');
assert.ok(accepted({ offset: '-12:00' }), 'the -12:00 edge is accepted');
assert.ok(accepted({ offset: '+0530' }), 'a colon is optional');
assert.equal(failure({ format: '' }), 'The format must contain at least one character.');
assert.equal(failure({ format: 'x'.repeat(241) }), 'The format must be at most 240 characters.');
assert.ok(accepted({ format: 'x'.repeat(240) }), '240 characters are accepted');
assert.equal(C.MAX_FORMAT, 240);
assert.equal(C.MIN_EPOCH, -62135596800);
assert.equal(C.MAX_EPOCH, 253402300799);

// ---- Catalog record: totals, cases and metadata.
assert.equal(catalog.tools.length, 2509, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2248, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Time').length, 57, 'Time count');
assert.equal(record.category, 'Time');
assert.equal(record.subcategory, 'Generation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.method.length > 600);
assert.equal(record.sources.length, 2);
assert.equal(record.sources[0].url, 'https://man7.org/linux/man-pages/man3/strftime.3.html');
assert.equal(record.sources[1].url, 'https://docs.python.org/3/library/datetime.html');
assert.match(record.sources[0].title, /strftime/);
assert.match(record.sources[1].title, /format code/i);
assert.equal(record.tags.length, new Set(record.tags).size, 'tags are internally unique');
assert.match(record.added, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const counts = record.testCases.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
assert.equal(record.testCases.length, 19);
assert.equal(counts.golden, 8);
assert.equal(counts.boundary, 5);
assert.equal(counts.validation, 6);

for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = C.format(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(JSON.stringify(actual[key]), JSON.stringify(expected), testCase.name + ': ' + key);
  }
}

// ---- Uniqueness: no rename, alias or slug collision anywhere in the catalog.
assert.equal(catalog.tools.filter((tool) => tool.name.toLowerCase() === record.name.toLowerCase()).length, 1);
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1);
for (const alias of record.aliases) {
  assert.equal(catalog.tools.filter((tool) =>
    (tool.aliases || []).some((item) => item.toLowerCase() === alias.toLowerCase())).length,
  1, 'alias is unique: ' + alias);
}
assert.ok(!catalog.tools.some((tool) =>
  tool.slug !== slug && /strftime|date-format-builder|format-string-builder/.test(tool.slug)),
'no other strftime builder is filed');
assert.ok(!catalog.tools.some((tool) =>
  tool.slug !== slug && /strftime/i.test([tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')].join(' '))),
'no other record claims strftime');

// ---- Page contract.
assert.match(html, /<html lang="en">/);
assert.match(html, /<meta name="viewport"/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /<link rel="stylesheet" href="\/assets\/style.css">/);
assert.match(html, /<script src="\/assets\/app.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<h1>strftime Date Format Builder<\/h1>/);
assert.match(html, /<form id="format-form" novalidate>/);
assert.equal((html.match(/<h1/g) || []).length, 1, 'one page heading');
assert.equal((html.match(/<label for="/g) || []).length, 3, 'each field is labelled');
assert.equal((html.match(/<input/g) || []).length, 3);
assert.equal((html.match(/<button type="submit">/g) || []).length, 1);
assert.equal((html.match(/data-format="/g) || []).length, 5);
assert.equal((html.match(/<tbody id="reference"><\/tbody>/g) || []).length, 1, 'the reference body is filled by script');
assert.ok(!/\bfetch\(|XMLHttpRequest|import\s*\(|\beval\(|new Function|localStorage|sessionStorage/.test(html),
  'no network calls, no eval, no storage');
assert.ok(!/<iframe|<img|<canvas/.test(html), 'no embedded media');
assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html), 'no external reference in the page');
assert.match(html, /nothing is stored and nothing is sent/i, 'the privacy note stays on the page');
assert.match(html, /min-height:46px/, 'controls keep a touch-sized target');
assert.equal((html.match(/\/\* strftime-core:start \*\//g) || []).length, 1);
assert.match(html, /strftime/, 'the page names the format family it follows');

console.log('strftime_date_format_builder: all checks passed');
