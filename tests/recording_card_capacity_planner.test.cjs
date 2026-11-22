/* Recording card capacity and offload planner: the media contract, the page
   markup and the catalog record's cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'recording-card-capacity-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* recording-card-core:start */';
const endMarker = '/* recording-card-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { Math, Number, String, Object, JSON, RegExp, Date, module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RecordingCardCore;', sandbox);
const C = sandbox.module.exports;

const near = (value, expected, tolerance, label) => {
  assert.ok(Math.abs(value - expected) <= tolerance, `${label}: ${value} against ${expected}`);
};
const failure = (payload) => {
  try { C.plan(payload); } catch (error) { return error.message; }
  return null;
};
const base = { capacity: '128', bitrate: '400', cards: '2', footage: '60', reader: '800', copies: '2' };
const plan = (patch) => C.plan(Object.assign({}, base, patch));

// ---- Documented constants.
assert.deepEqual(Array.from(C.COPIES), [1, 2, 3]);
assert.equal(C.MAX_TABLE_ROWS, 12);
assert.deepEqual(Array.from(C.LIMITS.capacity), [1, 8192]);
assert.deepEqual(Array.from(C.LIMITS.bitrate), [1, 20000]);
assert.deepEqual(Array.from(C.LIMITS.cards), [1, 99]);
assert.deepEqual(Array.from(C.LIMITS.footage), [1, 60000]);
assert.deepEqual(Array.from(C.LIMITS.reader), [1, 20000]);
assert.deepEqual(Object.keys(C.DEFAULTS).sort(),
  ['bitrate', 'capacity', 'cards', 'copies', 'footage', 'reader']);
assert.equal(C.DEFAULTS.capacity, '128');
assert.equal(C.DEFAULTS.bitrate, '400');
assert.equal(C.DEFAULTS.copies, '2');

// ---- Field parsing.
assert.equal(C.parseDecimal('128', 'card size in GB', 'capacity'), 128);
assert.equal(C.parseDecimal('  64.5  ', 'card size in GB', 'capacity'), 64.5);
assert.equal(C.parseDecimal(440, 'recording bitrate in Mbps', 'bitrate'), 440);
assert.equal(C.parseWhole('2', 'number of cards on hand', 'cards'), 2);
assert.equal(C.parseWhole(' 99 ', 'number of cards on hand', 'cards'), 99);
assert.equal(C.parseCopies(''), 2);
assert.equal(C.parseCopies(undefined), 2);
assert.equal(C.parseCopies('1'), 1);
assert.equal(C.parseCopies('3'), 3);
assert.equal(failure({ capacity: '' }), 'Enter the card size in GB as a number from 1 to 8192.');
assert.equal(failure({ capacity: 'abc' }),
  'Enter the card size in GB as a number from 1 to 8192; "abc" is not a number.');
assert.equal(failure({ capacity: '0.5' }), 'The card size in GB must be at least 1; 0.5 is below that.');
assert.equal(failure({ capacity: '9000' }), 'The card size in GB must be at most 8192; 9000 is above that.');
assert.equal(failure({ capacity: '0000128' }),
  'Enter the card size in GB as a number from 1 to 8192; "0000128" is not a number.');
assert.equal(failure({ bitrate: '0' }), 'The recording bitrate in Mbps must be at least 1; 0 is below that.');
assert.equal(failure({ bitrate: '20001' }), 'The recording bitrate in Mbps must be at most 20000; 20001 is above that.');
assert.equal(failure({ bitrate: '1e3' }),
  'Enter the recording bitrate in Mbps as a number from 1 to 20000; "1e3" is not a number.');
assert.equal(failure({ cards: '0' }), 'The number of cards on hand must be at least 1; 0 is below that.');
assert.equal(failure({ cards: '2.5' }),
  'Enter the number of cards on hand as a whole number from 1 to 99; "2.5" is not a whole number.');
assert.equal(failure({ cards: '100' }), 'The number of cards on hand must be at most 99; 100 is above that.');
assert.equal(failure({ footage: '0' }), 'The footage planned in minutes must be at least 1; 0 is below that.');
assert.equal(failure({ footage: '60001' }),
  'The footage planned in minutes must be at most 60000; 60001 is above that.');
assert.equal(failure({ reader: 'x' }),
  'Enter the reader speed in MB per second as a number from 1 to 20000; "x" is not a number.');
assert.equal(failure({ copies: '4' }),
  'Choose one copy, a working copy and one backup, or a working copy and two backups.');
assert.ok(failure({ capacity: 'a'.repeat(40) }).includes('"aaaaaaaaaaaaaaaa..."'), 'long input is elided');

// ---- The primitives, computed on their own.
assert.equal(C.secondsPerCard(128, 400), 2560);
near(C.secondsPerCard(256, 440), 4654.5454, 0.001, '256 GB at 440 Mbps');
near(C.secondsPerCard(64.5, 150), 3440, 0.001, '64.5 GB at 150 Mbps');
assert.equal(C.gbPerHour(400), 180);
assert.equal(C.gbPerHour(440), 198);
assert.equal(C.gbPerHour(50), 22.5);
near(C.gibFor(128), 119.20928955, 1e-6, '128 GB in GiB');
near(C.gibFor(1024), 953.6743164, 1e-5, '1024 GB in GiB');

// ---- The default plan.
const d = plan({});
assert.equal(d.perCardSeconds, 2560);
assert.equal(d.perCardMinutes, 42.67);
assert.equal(d.perCardText, '42.7 min (42:40)');
assert.equal(d.totalMinutes, 85.3);
assert.equal(d.totalText, '85.3 min (1:25:20)');
assert.equal(d.gbHour, 180);
assert.equal(d.gbHourText, '180.0 GB');
assert.equal(d.neededCards, 2);
assert.equal(d.storageGb, 360);
assert.equal(d.storageText, '360.0 GB');
assert.equal(d.offloadSeconds, 160);
assert.equal(d.offloadText, '2:40');
assert.equal(d.offloadTotalSeconds, 320);
assert.equal(d.gib, 119.2);
assert.equal(d.gibText, '119.2 GiB');
assert.equal(d.statusKind, 'ok');
assert.ok(d.statusText.includes('The shoot fits: 2 cards for 60 minutes'), d.statusText);
assert.equal(d.warnings.length, 1, 'the copies note is the only default warning');
assert.ok(d.warnings[0].includes('2 copies need 360.0 GB'), d.warnings[0]);
assert.equal(d.rows.length, 2);
assert.deepEqual({ ...d.rows[0] }, { card: '1', content: '42:40', space: '128.0 GB', fill: 'full', part: false });
assert.deepEqual({ ...d.rows[1] }, { card: '2', content: '17:20', space: '52.0 GB', fill: 'part used', part: true });
assert.equal(d.hiddenRows, 0);
assert.equal(d.explanation.length, 6);
assert.ok(d.explanation[0].includes('128 x 8000 / 400 = 2560 s = 42:40'), d.explanation[0]);
assert.ok(d.explanation[1].includes('400 x 0.45 = 180.0 GB'), d.explanation[1]);
assert.ok(d.explanation[2].includes('60 / 42.7 = 1.41, so 2'), d.explanation[2]);
assert.ok(d.explanation[3].includes('60 x 3 x 2 = 360.0 GB'), d.explanation[3]);
assert.ok(d.explanation[4].includes('128000 MB / 800 MB/s = 160 s = 2:40'), d.explanation[4]);
assert.ok(d.explanation[5].includes('119.2 GiB'), d.explanation[5]);
assert.ok(d.summary.includes('42.7 min'), d.summary);

// ---- A card and a bitrate every field of the plan can be re-derived from.
const example = C.plan({ capacity: '256', bitrate: '440', cards: '4', footage: '150', reader: '900', copies: '2' });
near(example.perCardSeconds, 4654.5, 0.05, 'example card seconds');
assert.equal(example.perCardText, '77.6 min (1:17:35)');
assert.equal(example.gbHour, 198);
assert.equal(example.neededCards, 2);
assert.equal(example.storageGb, 990);
assert.equal(example.offloadSeconds, 284.4);
assert.equal(example.offloadText, '4:44');
assert.equal(example.gib, 238.4);
assert.equal(example.statusKind, 'ok');
assert.ok(example.warnings.some((line) => line.includes('the spare cards stay empty')), example.warnings.join(' | '));

// ---- Shortfalls, the twelve-row cap and the tiny-card wording.
const short = C.plan({ capacity: '64', bitrate: '800', cards: '1', footage: '120', reader: '400', copies: '1' });
assert.equal(short.statusKind, 'warning');
assert.equal(short.statusText, 'Short by 11 cards for 120 minutes of footage');
assert.ok(short.warnings[0].includes('needs 12 cards at 64.0 GB each'), short.warnings[0]);
assert.equal(short.rows.length, 12, 'the table stops at twelve rows');
assert.equal(short.hiddenRows, 0);
assert.equal(short.rows[11].content, '2:40');
assert.equal(short.rows[11].fill, 'part used');

const wide = C.plan({ capacity: '1', bitrate: '20000', cards: '2', footage: '5', reader: '1000', copies: '3' });
assert.equal(wide.perCardText, '0.4 s');
assert.equal(wide.rows.length, 12);
assert.equal(wide.hiddenRows, 738);
assert.ok(wide.warnings.some((line) => line.includes('under a minute')), wide.warnings.join(' | '));
assert.equal(wide.statusKind, 'warning');

const slow = C.plan({ capacity: '4096', bitrate: '50', cards: '99', footage: '60000', reader: '1', copies: '1' });
assert.equal(slow.offloadText, '1137:46:40');
assert.ok(slow.warnings.some((line) => line.includes('Copying one full card takes 1137:46:40')), slow.warnings.join(' | '));

// ---- Identity sweep: the plan must agree with the definitions of a byte and a
// decimal gigabyte, not with a table of remembered answers.
let checks = 0;
for (const capacity of [8, 32, 64, 64.5, 128, 256, 512, 1024]) {
  for (const bitrate of [24, 50, 150, 240, 400, 800]) {
    for (const copies of [1, 2]) {
      const r = C.plan({ capacity: String(capacity), bitrate: String(bitrate), cards: '3',
        footage: '45', reader: '600', copies: String(copies) });
      near(r.perCardSeconds * bitrate / 8000, capacity, 0.002, `seconds identity ${capacity}/${bitrate}`);
      near(r.gbHour, bitrate * 0.45, 1e-9, `GB per hour ${bitrate}`);
      near(r.storageGb, 45 * (bitrate * 0.45 / 60) * copies, 0.06, `storage ${capacity}/${bitrate}/${copies}`);
      near(r.offloadSeconds, capacity * 1000 / 600, 0.06, `offload ${capacity}`);
      near(r.gib, capacity * 1e9 / 1073741824, 0.06, `GiB ${capacity}`);
      assert.equal(r.neededCards, Math.max(1, Math.ceil(45 / (r.perCardSeconds / 60))),
        `card count ${capacity}/${bitrate}`);
      near(r.totalMinutes, r.perCardSeconds / 60 * 3, 0.06, `total ${capacity}/${bitrate}`);
      checks += 7;
    }
  }
}
assert.ok(checks >= 500, 'the identity sweep stays broad');

// ---- The rows add back up to the footage, and every row fits inside a card.
for (const state of [base, { capacity: '256', bitrate: '440', cards: '4', footage: '150', reader: '900', copies: '3' },
  { capacity: '32', bitrate: '240', cards: '3', footage: '128', reader: '1000', copies: '1' }]) {
  const r = C.plan(state);
  const seconds = r.rows.reduce((sum, row) => {
    const parts = row.content === '<1 s' ? [0, 0, 1] : row.content.split(':').map(Number);
    const value = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    assert.ok(value <= Math.round(r.perCardSeconds) + 1, 'a row never exceeds one card');
    return sum + value;
  }, 0);
  if (r.hiddenRows === 0) {
    near(seconds, Number(state.footage) * 60, 2, 'rows add up to the footage');
  }
  const space = r.rows.reduce((sum, row) => sum + Number(row.space.replace(/[^0-9.]/g, '')), 0);
  near(space, Number(state.footage) * (r.gbHour / 60), 1, 'row space adds up to the footage');
}

// ---- Formatting helpers.
assert.equal(C.fmtClock(2560), '42:40');
assert.equal(C.fmtClock(4654.5), '1:17:35');
assert.equal(C.fmtClock(160), '2:40');
assert.equal(C.fmtClock(245000), '68:03:20');
assert.equal(C.fmtClock(0.4), '<1 s');
assert.equal(C.fmtClock(0), '0:00');
assert.equal(C.fmtGb(128), '128.0 GB');
assert.equal(C.fmtGb(1234.56), '1,234.6 GB');
assert.equal(C.fmtGb(40.75), '40.8 GB', 'an exact half rounds up');
assert.equal(C.fmtDuration(42.6667), '42.7 min (42:40)');
assert.equal(C.fmtDuration(0.4), '24 s');
assert.equal(C.fmtDuration(1.5), '1.5 min (1:30)');
assert.equal(C.fmtDuration(2), '2 min (2:00)');
assert.equal(C.roundTo(-0.04, 1), 0, 'no negative zero');

// ---- Page contract.
assert.ok(/<html lang="en">/.test(html), 'the page declares its language');
assert.ok(/<meta name="viewport"/.test(html), 'the page is mobile ready');
assert.ok(/<link rel="stylesheet" href="\/assets\/style.css">/.test(html), 'the shared stylesheet is used');
assert.ok(/<div id="site-header"><\/div>/.test(html), 'the shared header mount is present');
assert.equal((html.match(/<h1/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('<title>Recording Card Capacity &amp; Offload Planner &mdash; virt.tools</title>'));
assert.ok(/<meta name="description" content="[^"]{80,}"/.test(html), 'a description is supplied');
assert.ok(/<form id="media-form" novalidate>/.test(html), 'the form owns submission');
for (const id of ['in-capacity', 'in-bitrate', 'in-cards', 'in-footage', 'in-reader', 'in-copies']) {
  assert.ok(html.includes(`<label for="${id}">`), 'missing label for ' + id);
}
for (const id of ['in-capacity', 'in-bitrate', 'in-reader']) {
  assert.ok(new RegExp(`id="${id}"[^>]*type="number"`).test(html), 'numeric field ' + id);
  assert.ok(new RegExp(`id="${id}"[^>]*step="`).test(html), 'decimal steps on ' + id);
}
for (const id of ['in-cards', 'in-footage']) {
  assert.ok(new RegExp(`id="${id}"[^>]*type="number"[^>]*step="1"`).test(html), 'whole-number field ' + id);
}
assert.ok(/id="in-copies"[^>]*name="copies"/.test(html));
assert.equal((html.match(/<option value="[123]"/g) || []).length, 3, 'three copy choices');
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
for (const id of ['out-percard', 'out-percard-note', 'out-total', 'out-gbh', 'out-cards', 'out-cards-note',
  'out-storage', 'out-storage-note', 'out-offload', 'out-offload-note', 'out-gib', 'card-body',
  'warnings', 'explanation', 'summary', 'status', 'error', 'table-caption']) {
  assert.ok(html.includes(`id="${id}"`), 'missing output ' + id);
}
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'the shared scripts load last');

// ---- Catalog record and every case in it must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Recording Card Capacity & Offload Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.icon, '\u{1f4be}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.includes('card size in GB x 8000 / bitrate in Mbps'), 'the method states the time formula');
assert.ok(record.method.includes('bitrate x 0.45'), 'the method states the space per hour');
assert.ok(record.method.includes('1 to 8192 GB'), 'the method states the input bounds');
assert.ok(record.method.includes('2^30'), 'the method states the binary unit');
assert.ok(record.method.includes('no uploads'), 'the method states the privacy position');
assert.ok(record.guidance.includes('Media card planning only'), 'the guidance states the scope');
assert.equal(record.sources.length, 1, 'the decimal unit is cited');
assert.equal(record.sources[0].url, 'https://en.wikipedia.org/wiki/Gigabyte');
assert.ok(record.sources[0].title.length > 30, 'the source is described');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('offload'));
assert.ok(record.aliases.includes('Card Capacity Calculator'));
assert.equal(catalog.tools.filter((tool) => tool.category === 'Video').length, 54, 'Video count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'no rival record');
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  assert.notEqual(tool.name.toLowerCase(), record.name.toLowerCase(), 'duplicate name: ' + tool.slug);
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
  const result = C.plan(testCase.input);
  const expected = testCase.expected;
  near(result.perCardSeconds, expected.perCardSeconds, 0.06, testCase.name + ' seconds');
  near(result.perCardMinutes, expected.perCardMinutes, 0.01, testCase.name + ' minutes');
  near(result.totalMinutes, expected.totalMinutes, 0.06, testCase.name + ' total');
  near(result.gbHour, expected.gbHour, 0.01, testCase.name + ' GB per hour');
  assert.equal(result.neededCards, expected.needed, testCase.name + ' cards');
  near(result.storageGb, expected.storageGb, 0.06, testCase.name + ' storage');
  near(result.offloadSeconds, expected.offloadSeconds, 0.06, testCase.name + ' offload');
  near(result.gib, expected.gib, 0.06, testCase.name + ' GiB');
  assert.equal(result.hiddenRows, expected.hiddenRows, testCase.name + ' hidden rows');
  assert.equal(result.rows.length, expected.rows.length, testCase.name + ' row count');
  for (let index = 0; index < expected.rows.length; index += 1) {
    const want = expected.rows[index];
    const got = result.rows[index];
    assert.equal(got.card, want.card, testCase.name + ' card label');
    assert.equal(got.content, want.content, testCase.name + ' content');
    assert.equal(got.fill, want.fill, testCase.name + ' fill');
    near(Number(got.space.replace(/[^0-9.]/g, '')), want.spaceGb, 0.06, testCase.name + ' row space');
  }
  assert.ok(result.summary.length > 40, testCase.name + ' summary is written');
  assert.ok(result.explanation.length === 6, testCase.name + ' explanation is complete');
  assert.ok(result.statusText.length > 10, testCase.name + ' status is written');
  assert.ok(['ok', 'warning'].includes(result.statusKind), testCase.name + ' status kind');
}

console.log('recording card capacity and offload: all checks passed');
