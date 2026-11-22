/* Regression checks for the teleprompter scroll planner core, its catalog cases,
   and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'teleprompter-scroll-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* teleprompter-core:start */');
const end = html.indexOf('/* teleprompter-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + '/* teleprompter-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = TeleprompterCore;', sandbox);
const T = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (got, want, tolerance, label) => {
  assert.ok(Math.abs(got - want) <= tolerance, `${label}: ${got} != ${want}`);
};

const NARRATION = (
  'Good evening. Tonight we are looking at three things: the water level in the reservoir, the '
  + 'repairs on the north bridge, and the vote that decides both. The reservoir has risen four '
  + 'centimetres since Friday. The bridge closes again on Monday, and the council meets on Tuesday.'
);

const input = (script, chars, lineHeight, screenHeight, wpm, slot) => ({
  script,
  chars: String(chars),
  lineHeight: String(lineHeight),
  screenHeight: String(screenHeight),
  wpm: String(wpm),
  slot: slot === undefined || slot === null ? '' : String(slot)
});
const run = (options) => plain(T.plan(options));
const failure = (options) => {
  try {
    T.plan(options);
  } catch (error) {
    return error.message;
  }
  return null;
};

// Independent wrapper: cut each joined paragraph at the last space at or before the
// width, rather than growing a line word by word as the page does.
function oracleWrap(text, width) {
  const lines = [];
  let overlong = 0;
  for (const paragraph of text.trim().split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    for (const word of words) if (word.length > width) overlong += 1;
    let rest = words.join(' ');
    while (rest) {
      if (rest.length <= width) {
        lines.push(rest);
        break;
      }
      const cut = rest.lastIndexOf(' ', width);
      if (cut > 0) {
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut + 1);
      } else {
        const next = rest.indexOf(' ');
        if (next === -1) {
          lines.push(rest);
          break;
        }
        lines.push(rest.slice(0, next));
        rest = rest.slice(next + 1);
      }
    }
  }
  return { lines, overlong };
}

// Documented surface.
assert.equal(T.MAX_CHARS, 20000);
assert.deepEqual(Object.keys(T.LIMITS), ['chars', 'lineHeight', 'screenHeight', 'wpm', 'slot']);
assert.equal(T.LIMITS.chars.min, 8);
assert.equal(T.LIMITS.chars.max, 200);
assert.equal(T.LIMITS.lineHeight.max, 400);
assert.equal(T.LIMITS.screenHeight.max, 4320);
assert.equal(T.LIMITS.wpm.min, 40);
assert.equal(T.LIMITS.slot.max, 7200);

// Wrapping: greedy word wrap, blank lines kept, tabs and doubled spaces collapsed.
assert.deepEqual(plain(T.wrapScript('The quick brown fox jumps over the lazy dog.', 20).lines),
  ['The quick brown fox', 'jumps over the lazy', 'dog.']);
assert.deepEqual(plain(T.wrapScript('Line one here.\n\nSecond paragraph is a bit longer.', 14).lines),
  ['Line one here.', '', 'Second', 'paragraph is a', 'bit longer.']);
assert.deepEqual(plain(T.wrapScript('One\ttwo  three\nfour', 10).lines), ['One two', 'three', 'four']);
assert.deepEqual(plain(T.wrapScript('a\n\nb\n\n\n', 40).lines), ['a', '', 'b']);
assert.deepEqual(plain(T.wrapScript('extraordinarily short', 8).lines), ['extraordinarily', 'short']);
assert.equal(T.wrapScript('extraordinarily short', 8).overlong, 1);
assert.deepEqual(plain(T.wrapScript('aaaa bbbb', 9).lines), ['aaaa bbbb'], 'a line exactly at the width holds both words');
assert.deepEqual(plain(T.wrapScript('a b c', 8).lines), ['a b c']);

// Plain planning arithmetic.
const fox = run(input('The quick brown fox jumps over the lazy dog.', 20, 40, 200, 150));
assert.equal(fox.words, 9);
assert.equal(fox.lines, 3);
assert.equal(fox.heightPx, 120);
assert.equal(fox.durationSeconds, 3.6);
near(fox.speedPxPerSecond, 120 / 3.6, 1e-9, 'speed is height over read time');
near(fox.linesPerSecond, 120 / 3.6 / 40, 1e-9, 'lines per second');
assert.equal(fox.linesPerScreen, 5);
near(fox.screens, 0.6, 1e-9, 'screens of text');
near(fox.screenSeconds, 200 / (120 / 3.6), 1e-9, 'one screen passes in');
assert.equal(fox.overlongWords, 0);
assert.equal(fox.chars, 20);
assert.equal(fox.lineHeight, 40);
assert.equal(fox.screenHeight, 200);
assert.equal(fox.wpm, 150);
assert.deepEqual(fox.preview, ['The quick brown fox', 'jumps over the lazy', 'dog.']);
assert.equal(fox.slot, null);

// A target slot reports the pace it needs and how far the current pace misses it.
const slotted = run(input('The quick brown fox jumps over the lazy dog.', 20, 40, 200, 150, 5));
near(slotted.slot.wpm, 108, 1e-9, 'required pace');
near(slotted.slot.speedPxPerSecond, 24, 1e-9, 'required speed');
near(slotted.slot.overrunSeconds, -1.4, 1e-9, 'under-run is negative');
assert.equal(slotted.slot.seconds, 5);

// Blank and tab handling, paragraph height, preview truncation and the rate bounds.
const paras = run(input('Line one here.\n\nSecond paragraph is a bit longer.', 14, 30, 180, 120));
assert.equal(paras.lines, 5, 'the blank line counts as one line');
assert.equal(paras.heightPx, 150);
assert.equal(paras.durationSeconds, 4.5);
const many = run(input('one two three four five six seven eight nine ten eleven twelve', 8, 20, 200, 150));
assert.equal(many.lines, 9);
assert.equal(many.preview.length, 8, 'preview is capped at eight lines');
assert.equal(many.preview[7], 'eleven');
assert.equal(failure(input('', 40, 56, 1080, 150)), 'Enter a script with at least one word.');
assert.equal(failure(input(' \n\t ', 40, 56, 1080, 150)), 'Enter a script with at least one word.');
assert.equal(failure({ ...input('a', 40, 56, 1080, 150), script: 'a'.repeat(20001) }),
  'Enter no more than 20,000 characters of script.');
assert.equal(run({ ...input('a'.repeat(20000), 200, 400, 4320, 400) }).words, 1, 'the maximum script is accepted');
assert.equal(run(input('a b', 8, 8, 120, 40)).linesPerScreen, 15, 'minimum controls');
assert.equal(failure(input('a', 40, 400, 120, 150)),
  'The screen height must be at least one line tall; raise it or lower the line height.');

// Field validation names each field and its range.
assert.equal(failure(input('a', '', 56, 1080, 150)), 'Characters per line is required.');
assert.equal(failure(input('a', 7, 56, 1080, 150)), 'Characters per line must be from 8 to 200 characters.');
assert.equal(failure(input('a', 201, 56, 1080, 150)), 'Characters per line must be from 8 to 200 characters.');
assert.equal(failure(input('a', '12.5', 56, 1080, 150)), 'Characters per line must be a whole number.');
assert.equal(failure(input('a', 40, 7, 1080, 150)), 'Line height must be from 8 to 400 pixels.');
assert.equal(failure(input('a', 40, 56, 119, 150)), 'Screen height must be from 120 to 4320 pixels.');
assert.equal(failure(input('a', 40, 56, '1080.5', 150)), 'Screen height must be a whole number.');
assert.equal(failure(input('a', 40, 56, 1080, 39)), 'Reading rate must be from 40 to 400 words per minute.');
assert.equal(failure(input('a', 40, 56, 1080, 401)), 'Reading rate must be from 40 to 400 words per minute.');
assert.equal(failure(input('a', 40, 56, 1080, 'fast')), 'Reading rate must be a number.');
assert.equal(failure(input('a', 40, 56, 1080, 150, 4)), 'Target slot must be from 5 to 7200 seconds.');
assert.equal(failure(input('a', 40, 56, 1080, 150, 7201)), 'Target slot must be from 5 to 7200 seconds.');
assert.equal(run(input('a', 40, 56, 1080, 150, 7200)).slot.seconds, 7200);
assert.equal(run(input('a', 40, 56, 1080, 150, 5)).slot.seconds, 5);

// Differential check against the independent wrapper over many generated scripts.
let state = 20261122;
const random = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const vocabulary = ['a', 'to', 'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
  'reservoir', 'centimetres', 'extraordinarily', 'night', 'four', 'a,b,c', 'bridge', 'vote'];
for (let trial = 0; trial < 200; trial += 1) {
  const count = 1 + Math.floor(random() * 30);
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    if (roll < 0.08) parts.push('\n\n');
    else if (roll < 0.12) parts.push('\t');
    else if (roll > 0.88) parts.push('  ');
    parts.push(vocabulary[Math.floor(random() * vocabulary.length)]);
  }
  const script = parts.join(' ').replace(/\n\n /g, '\n\n');
  const width = 8 + Math.floor(random() * 33);
  const lineHeight = 8 + Math.floor(random() * 393);
  const screenHeight = 120 + Math.floor(random() * 500);
  const wpm = 40 + Math.floor(random() * 361);
  const expected = oracleWrap(script, width);
  const wrapped = plain(T.wrapScript(script, width));
  assert.deepEqual(wrapped.lines, expected.lines, 'wrapping trial ' + trial);
  assert.equal(wrapped.overlong, expected.overlong, 'overlong words trial ' + trial);
  if (!(screenHeight >= lineHeight)) continue;
  const result = T.plan(input(script, width, lineHeight, screenHeight, wpm));
  const words = script.split(/\s+/).filter(Boolean).length;
  assert.equal(result.words, words, 'word count trial ' + trial);
  assert.equal(result.lines, expected.lines.length, 'line count trial ' + trial);
  assert.equal(result.heightPx, expected.lines.length * lineHeight, 'height trial ' + trial);
  near(result.durationSeconds, 60 * words / wpm, 1e-9, 'duration trial ' + trial);
  near(result.speedPxPerSecond, result.heightPx / result.durationSeconds, 1e-9, 'speed trial ' + trial);
  near(result.screens, result.heightPx / screenHeight, 1e-9, 'screens trial ' + trial);
  assert.equal(result.linesPerScreen, Math.floor(screenHeight / lineHeight), 'lines on screen trial ' + trial);
  assert.equal(result.preview.length, Math.min(8, expected.lines.length), 'preview trial ' + trial);
}

// The catalog record and every published case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Teleprompter Scroll Planner');
assert.equal(record.category, 'Video');
assert.equal(record.subcategory, 'Planning');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.icon, '\u{1f4dc}');
assert.ok(record.description.length > 120, 'description is descriptive');
assert.ok(record.description.length < 260, 'description stays short');
assert.ok(record.method.length > 900, 'method documents the arithmetic');
assert.ok(record.method.includes('60 x words / reading rate'), 'the method states the read time');
assert.ok(record.method.includes('height x rate / (60 x words)'), 'the method states the speed formula');
assert.ok(record.method.includes('floor(screen height / line height)'), 'the method states the lines on screen');
assert.ok(record.method.includes('8-200 characters per line'), 'the method states the input bounds');
assert.ok(record.method.includes('no storage, uploads'), 'the method states the privacy position');
assert.equal(record.sources.length, 0, 'the arithmetic is bespoke, so no source is claimed');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are unique');
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are unique');
assert.ok(record.tags.includes('teleprompter'));
assert.ok(record.aliases.includes('Teleprompter Speed Calculator'));
assert.equal(catalog.tools.length, 2451, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2190, 'public tools');
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
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug && /teleprompt|prompter|autocue/.test(
  tool.slug + ' ' + tool.name + ' ' + tool.aliases.join(' ') + ' ' + tool.tags.join(' '))),
  'no other teleprompter tool');

assert.equal(record.testCases.length, 26, 'catalog case count');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 5);
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 11);
for (const testCase of record.testCases) {
  assert.ok(testCase.name && testCase.kind && testCase.input, 'catalog case shape');
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = T.plan(testCase.input);
  const expected = testCase.expected;
  assert.equal(result.words, expected.words, testCase.name + ' words');
  assert.equal(result.lines, expected.lines, testCase.name + ' lines');
  assert.equal(result.heightPx, expected.heightPx, testCase.name + ' height');
  near(result.durationSeconds, expected.durationSeconds, 0.002, testCase.name + ' read time');
  near(result.speedPxPerSecond, expected.speedPxPerSecond, 0.002, testCase.name + ' speed');
  near(result.linesPerSecond, expected.linesPerSecond, 0.002, testCase.name + ' lines per second');
  assert.equal(result.linesPerScreen, expected.linesPerScreen, testCase.name + ' lines on screen');
  near(result.screens, expected.screens, 0.002, testCase.name + ' screens');
  near(result.screenSeconds, expected.screenSeconds, 0.002, testCase.name + ' screen seconds');
  assert.equal(result.overlongWords, expected.overlongWords, testCase.name + ' overlong');
  assert.equal(result.preview.length, expected.preview, testCase.name + ' preview');
  if (expected.slot) {
    assert.ok(result.slot, testCase.name + ' slot present');
    near(result.slot.wpm, expected.slot.wpm, 0.002, testCase.name + ' slot pace');
    near(result.slot.speedPxPerSecond, expected.slot.speedPxPerSecond, 0.002, testCase.name + ' slot speed');
    near(result.slot.overrunSeconds, expected.slot.overrunSeconds, 0.002, testCase.name + ' over-run');
  } else {
    assert.equal(result.slot, null, testCase.name + ' no slot');
  }
}

// Page contract: no network, storage or external assets; labelled controls.
assert.match(html, /<h1>Teleprompter Scroll Planner<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]{80,}"/);
assert.ok(html.includes('/assets/style.css'));
assert.ok(html.includes('/assets/app.js'));
assert.ok(!/https?:\/\//.test(html), 'no absolute URLs');
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\b/.test(html),
  'no network or storage');
assert.ok(!/<(?:img|iframe|link[^>]+href="https?:)/.test(html), 'no remote media');
assert.ok(html.includes('aria-live="polite"'));
assert.ok(html.includes('role="alert"'));
assert.equal((html.match(/<label\b/g) || []).length, 6, 'every control is labelled');
assert.ok(html.includes('<textarea id="script"'), 'the script is a textarea');
assert.ok(html.includes('white-space:pre'), 'the preview keeps the wrapped lines');
assert.equal((html.match(/<button\b/g) || []).length, 2);
assert.equal((html.match(/type="(?:(?:button)|(?:submit))"/g) || []).length, 2, 'buttons declare a type');
console.log('teleprompter scroll planner: all checks passed');
