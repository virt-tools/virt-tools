/* Screenplay page and scene breakdown: the page core is compared with an
   independent model over a sweep of generated headings, the eighth arithmetic
   and its invariants are pinned, the refusal table is checked, catalog cases
   are replayed and the page's offline contract is asserted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'screenplay-page-breakdown';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* screenplay-page-core:start */';
const endMarker = '/* screenplay-page-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ScreenplayPageCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (script, perPage) => plain(C.compute({ script, linesPerPage: perPage === undefined ? '55' : String(perPage) }));
const failure = (input) => {
  try { C.compute(input); } catch (error) { return error.message; }
  return null;
};

// ---- Constants and the page grid.
assert.equal(C.LINES_PER_PAGE, 55, 'a formatted page holds about 55 lines');
assert.equal(C.MIN_LINES_PER_PAGE, 30);
assert.equal(C.MAX_LINES_PER_PAGE, 70);
assert.equal(C.MAX_CHARS, 2000000);
assert.deepEqual(Array.from(C.EIGHTHS), ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8']);

// ---- An independent model of the rules, written without the page's regular
// expression or line loop: it tokenises each line by hand.
const PREFIXES = ['INT', 'EXT', 'INT./EXT', 'EXT./INT', 'I/E'];
function model(text, perPage) {
  let body = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\f/g, '\n');
  const raw = body.split('\n');
  let lo = 0;
  let hi = raw.length - 1;
  while (lo <= hi && raw[lo].trim() === '') lo += 1;
  while (hi >= lo && raw[hi].trim() === '') hi -= 1;
  const rows = raw.slice(lo, hi + 1);
  const out = {
    lines: rows.length, linesPerPage: perPage, pages: rows.length / perPage,
    scenes: 0, interior: 0, exterior: 0, mixed: 0, day: 0, night: 0,
    otherTime: 0, noTime: 0, numbered: 0, unnumbered: 0, duplicates: [],
    noTimeScenes: [], firstSceneLine: 0
  };
  const seen = new Map();
  rows.forEach((rawLine, index) => {
    let line = rawLine.trim().replace(/\s+/g, ' ');
    let number = '';
    const head = /^([0-9]{1,4}[A-Za-z]?)[.)]?\s+/.exec(line);
    if (head) {
      number = head[1].toUpperCase();
      line = line.slice(head[0].length);
    }
    const upper = line.toUpperCase();
    const prefix = PREFIXES.find((candidate) => {
      if (!upper.startsWith(candidate)) return false;
      const next = upper.charAt(candidate.length);
      return next === '.' ? upper.charAt(candidate.length + 1) === ' ' : next === ' ';
    });
    if (!prefix) return;
    out.scenes += 1;
    if (!out.firstSceneLine) out.firstSceneLine = index + 1;
    if (number) {
      out.numbered += 1;
      seen.set(number, (seen.get(number) || 0) + 1);
      if (seen.get(number) === 2) out.duplicates.push(number);
    } else {
      out.unnumbered += 1;
    }
    const solid = prefix.replace(/[^A-Z]/g, '');
    if (solid === 'INT') out.interior += 1;
    else if (solid === 'EXT') out.exterior += 1;
    else out.mixed += 1;
    let rest = line.slice(prefix.length).replace(/^\./, '').trim();
    const pieces = rest.split(/\s+[-\u2013\u2014]\s+/);
    let when = '';
    if (pieces.length > 1) {
      when = pieces[pieces.length - 1].replace(/\([^)]*\)/g, ' ').replace(/\.+$/, '')
        .replace(/\s+/g, ' ').trim().toUpperCase();
    }
    if (!when) {
      out.noTime += 1;
      out.noTimeScenes.push({ scene: number, line: index + 1 });
    } else if (when === 'DAY') out.day += 1;
    else if (when === 'NIGHT') out.night += 1;
    else out.otherTime += 1;
  });
  const eighths = Math.ceil(out.lines * 8 / perPage - 1e-12);
  out.eighths = eighths;
  out.wholePages = Math.floor(eighths / 8);
  out.eighthRemainder = eighths % 8;
  const names = ['', '1/8', '1/4', '3/8', '1/2', '5/8', '3/4', '7/8'];
  const whole = out.wholePages;
  const rem = out.eighthRemainder;
  if (whole === 0) out.pageLabel = names[rem] + ' page';
  else if (rem === 0) out.pageLabel = whole + (whole === 1 ? ' page' : ' pages');
  else out.pageLabel = whole + ' ' + names[rem] + ' pages';
  return out;
}

// ---- The sweep: prefixes, numbers, locations, times and padding, at several
// lines-per-page settings and line endings.
const prefixes = ['INT.', 'EXT.', 'INT./EXT.', 'EXT./INT.', 'I/E', 'INT', 'EXT.', 'int.', 'ext.'];
const numbers = ['', '1   ', '12A ', '7.  ', '1024 '];
const places = ['KITCHEN', 'CAR', 'STREET 5', 'MAGGIE\u2019S GARAGE', 'FIELD'];
const times = ['DAY', 'NIGHT', 'DUSK', 'CONTINUOUS', 'DAY (CONTINUOUS)', '', 'LATER'];
const paddings = [0, 4];
let swept = 0;
for (const perPage of [30, 55, 70]) {
  for (const prefix of prefixes) {
    for (const number of numbers) {
      for (const place of places) {
        for (const time of times) {
          const heading = number + prefix + ' ' + place + (time ? ' - ' + time : '');
          for (const pad of paddings) {
            const filler = Array.from({ length: pad }, (_, i) => 'Action line ' + i + '.');
            const text = [heading].concat(filler).join('\n') + '\n';
            const expected = model(text, perPage);
            const actual = run(text, perPage);
            for (const key of Object.keys(expected)) {
              assert.deepEqual(actual[key], expected[key],
                'sweep ' + prefix + ' ' + number.trim() + ' ' + place + ' ' + time + ' pad ' + pad
                + ' per page ' + perPage + ': ' + key);
            }
            swept += 1;
          }
        }
      }
    }
  }
}
assert.ok(swept >= 4000, 'the sweep covers the heading grammar: ' + swept);

// ---- CRLF, CR, form feeds and a byte-order mark are normalised before counting.
const mixedEndings = 'INT. A - DAY\r\n\r\nINT. B - NIGHT\fINT. C - DAWN\rINT. D - DAY';
const normalised = run(mixedEndings, 55);
assert.equal(normalised.lines, 5, 'CRLF, CR and form feeds become single line breaks');
assert.equal(normalised.scenes, 4);
assert.deepEqual(normalised.duplicates, []);
assert.equal(run('\uFEFFINT. A - DAY', 55).scenes, 1, 'a byte-order mark does not hide the first heading');

// ---- Blank lines at the very start and end are ignored, inside ones are not.
assert.equal(run('\n\n\nINT. A - DAY\n\n\n', 55).lines, 1, 'outer blanks are trimmed');
assert.equal(run('INT. A - DAY\n\nB\n\nC', 55).lines, 5, 'inner blanks are counted');

// ---- Eighths: a page is eight eighths, a partial eighth is rounded up.
for (let lines = 1; lines <= 400; lines += 1) {
  for (const perPage of [30, 55, 70]) {
    const text = Array.from({ length: lines }, () => 'x').join('\n');
    const result = run(text, perPage);
    assert.equal(result.lines, lines);
    assert.equal(result.eighths, Math.ceil(lines * 8 / perPage), 'eighths for ' + lines + ' lines');
    assert.ok(result.eighths * perPage >= lines * 8, 'the eighth covers the lines: ' + lines);
    assert.ok((result.eighths - 1) * perPage < lines * 8, 'no whole eighth is dropped: ' + lines);
    assert.equal(result.eighths, result.wholePages * 8 + result.eighthRemainder);
    assert.equal(result.scenes, 0);
    assert.equal(result.pageLabel,
      result.wholePages === 0
        ? C.EIGHTHS[result.eighthRemainder] + ' page'
        : result.eighthRemainder === 0
          ? result.wholePages + (result.wholePages === 1 ? ' page' : ' pages')
          : result.wholePages + ' ' + C.EIGHTHS[result.eighthRemainder] + ' pages',
      'page label for ' + lines + ' lines');
  }
}
assert.equal(run('x', 55).pageLabel, '1/8 page');
assert.equal(run(Array.from({ length: 55 }, () => 'x').join('\n'), 55).pageLabel, '1 page');
assert.equal(run(Array.from({ length: 56 }, () => 'x').join('\n'), 55).pageLabel, '1 1/8 pages');
assert.equal(run(Array.from({ length: 110 }, () => 'x').join('\n'), 55).pageLabel, '2 pages');
assert.equal(run(Array.from({ length: 825 }, () => 'x').join('\n'), 55).pageLabel, '15 pages', '15 pages of 55 lines');

// ---- Scene grammar: the documented forms and the traps around them.
assert.equal(run('INT. KITCHEN - DAY', 55).interior, 1);
assert.equal(run('EXT. STREET - NIGHT', 55).exterior, 1);
assert.equal(run('INT./EXT. CAR - DAY', 55).mixed, 1, 'INT./EXT. is a mixed heading');
assert.equal(run('EXT./INT. CAR - DAY', 55).mixed, 1, 'EXT./INT. is a mixed heading');
assert.equal(run('I/E TUNNEL - DAY', 55).mixed, 1, 'I/E is a mixed heading');
assert.equal(run('12A INT. KITCHEN - DAY', 55).numbered, 1, 'a lettered scene number is read');
assert.equal(run('12A INT. KITCHEN - DAY\n12A EXT. ROAD - DAY', 55).duplicates.length, 1, 'a repeated number is flagged');
assert.equal(run('12A INT. KITCHEN - DAY\n12A EXT. ROAD - DAY\n12A INT. HALL - DAY', 55).duplicates.length, 1, 'a number repeated three times is flagged once');
assert.equal(run('INT. KITCHEN-DAY', 55).noTime, 1, 'a hyphen without spaces is not a time-of-day separator');
assert.equal(run('INT. KITCHEN - ', 55).noTime, 1, 'a blank time of day is missing');
assert.equal(run('INT. KITCHEN \u2013 NIGHT', 55).night, 1, 'an en dash separates the time of day');
assert.equal(run('INT. KITCHEN \u2014 DUSK', 55).otherTime, 1, 'an em dash separates the time of day');
assert.equal(run('INT. KITCHEN - DAY (CONTINUOUS)', 55).day, 1, 'a parenthetical does not change DAY');
assert.equal(run('INTERIOR - KITCHEN - DAY', 55).scenes, 0, 'INTERIOR is not the INT prefix');
assert.equal(run('INT KITCHEN - DAY', 55).scenes, 1, 'the dot is optional');
assert.equal(run('Int. Kitchen - Day', 55).scenes, 1, 'headings are read case-insensitively');
const counts = run('INT. A - DAY\nEXT. B - NIGHT\nINT./EXT. C\nINT. D - DAY', 55);
assert.equal(counts.scenes, counts.interior + counts.exterior + counts.mixed);
assert.equal(counts.scenes, counts.day + counts.night + counts.otherTime + counts.noTime);
assert.equal(counts.numbered + counts.unnumbered, counts.scenes);
assert.equal(counts.noTimeScenes.length, counts.noTime);
assert.equal(counts.noTimeScenes[0].line, 3, 'the reported line is the heading line');
assert.equal(counts.noTimeScenes[0].scene, '', 'an unnumbered scene reports no number');

// ---- Refusals.
assert.equal(failure({ script: '', linesPerPage: '55' }), 'Paste a screenplay to count.');
assert.equal(failure({ script: ' \n\t\n ', linesPerPage: '55' }), 'Paste a screenplay to count.');
assert.equal(failure({ script: 42, linesPerPage: '55' }), 'Paste a screenplay to count.');
assert.equal(failure({ script: null, linesPerPage: '55' }), 'Paste a screenplay to count.');
assert.equal(failure({}), 'Paste a screenplay to count.');
assert.equal(failure({ script: 'a'.repeat(2000001), linesPerPage: '55' }),
  'The script is longer than 2,000,000 characters; paste one act at a time.');
assert.equal(failure({ script: 'x', linesPerPage: '' }), 'Enter the lines per page as a whole number.');
assert.equal(failure({ script: 'x', linesPerPage: '  ' }), 'Enter the lines per page as a whole number.');
assert.equal(failure({ script: 'x', linesPerPage: 'fifty-five' }), 'Enter the lines per page as a whole number.');
assert.equal(failure({ script: 'x', linesPerPage: '55.5' }), 'Enter the lines per page as a whole number.');
assert.equal(failure({ script: 'x', linesPerPage: '29' }), 'Enter 30 to 70 lines per page.');
assert.equal(failure({ script: 'x', linesPerPage: '71' }), 'Enter 30 to 70 lines per page.');
assert.equal(run('x', '55').linesPerPage, 55);
assert.equal(run('x', ' 55 ').linesPerPage, 55, 'surrounding spaces are accepted');
assert.equal(run('x', '5,5').linesPerPage, 55, 'the thousands separator is stripped, so 5,5 reads 55');

// ---- Catalog replay.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog record missing');
assert.equal(entry.name, 'Screenplay Page & Scene Breakdown');
assert.equal(entry.category, 'Video');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.ok(entry.sources.length >= 1, 'the page grid is cited');
for (const source of entry.sources) {
  assert.ok(source.title && source.title.length > 40, 'source titles are specific');
  assert.ok(/^https:\/\//.test(source.url), 'sources are fetched over https');
}
assert.ok(entry.method && entry.method.length > 900, 'the method explains the rules and their limits');
assert.ok(entry.guidance && entry.guidance.length > 100 && entry.guidance.length < 500, 'the guidance fits the banner');
assert.ok(entry.testCases.length >= 20, 'enough catalog cases');
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.ok(kinds('golden') >= 8, 'golden cases');
assert.ok(kinds('boundary') >= 5, 'boundary cases');
assert.ok(kinds('validation') >= 6, 'validation cases');

for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = run(testCase.input.script, testCase.input.linesPerPage);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(result[key], value, testCase.name + ': ' + key);
  }
}

// ---- Uniqueness: no other record claims this slug, name, alias or capability.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const haystack = [tool.slug, tool.name, tool.description, (tool.aliases || []).join(' '), (tool.tags || []).join(' ')]
    .join(' ').toLowerCase();
  assert.ok(!/screenplay|slug line|scene heading|script breakdown/.test(haystack),
    'no duplicate scene-breakdown record: ' + tool.slug);
}

// ---- The page stays self-contained, offline and keyboard accessible.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(html.includes('<form id="script-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('<div id="site-header"></div>'), 'shared header hook missing');
assert.ok(html.includes('<meta name="viewport"'), 'viewport meta missing');
for (const [id, needle] of [['script', 'id="script"'], ['lines-per-page', 'value="55"']]) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id + ' missing');
  assert.ok(html.includes(needle), 'control content for ' + id + ' missing');
}
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/type="hidden"/i.test(html), 'no hidden inputs');
assert.ok((html.match(/<button /g) || []).length === 2, 'two buttons');
assert.ok(html.includes('No network request is made'), 'the note states the offline contract');
assert.ok(html.includes('55 lines'), 'the note gives the page grid');

console.log('screenplay page breakdown: ' + entry.testCases.length + ' catalog cases, '
  + swept + ' sweep cases and the refusal table pass');
