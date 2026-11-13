/* Regression checks for the subtitle line reflow core and its catalog test cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/subtitle-line-reflow/index.html'), 'utf8');
const start = html.indexOf('/* subreflow-core:start */');
const end = html.indexOf('/* subreflow-core:end */');
assert.ok(start > -1 && end > start, 'subtitle reflow core markers missing');
const core = html.slice(start, end + '/* subreflow-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SubReflow;', sandbox);
const C = sandbox.module.exports;

const reflow = (options) => C.reflow(options);
// Cue text lines of a single-cue document (the output always ends with a newline).
const cueLines = (output) => output.split('\n').slice(2, -1);

// Visible lengths ignore markup and count an entity as one character.
assert.equal(C.visibleLength('plain'), 5);
assert.equal(C.visibleLength('<i>italic</i>'), 6);
assert.equal(C.visibleLength('<c.yellow>tint</c>'), 4);
assert.equal(C.visibleLength('&amp;'), 1);
assert.equal(C.visibleLength('&lt;tag&gt;'), 5);
assert.equal(C.visibleLength('<unterminated'), 13);
assert.equal(C.visibleLength('a&amp;b'), 3);

// A 43-character cue at a 42-character limit becomes two even lines.
const base = '1\n00:00:01,000 --> 00:00:04,000\nThe quick brown fox jumps over the lazy dog\n';
const split = reflow({ text: base, maxLine: '42', maxLines: '2', cps: '17' });
assert.equal(split.format, 'srt');
assert.equal(split.cues, 1);
assert.equal(split.changed, 1);
assert.equal(split.overLines, 0);
assert.equal(split.overChars, 0);
assert.equal(split.overCps, 0);
assert.equal(split.maxLine, 23);
assert.equal(split.output, '1\n00:00:01,000 --> 00:00:04,000\nThe quick brown fox\njumps over the lazy dog\n');

// Reflowing the reflowed text changes nothing.
const again = reflow({ text: split.output, maxLine: '42', maxLines: '2', cps: '17' });
assert.equal(again.output, split.output);
assert.equal(again.changed, 0);

// A single word wider than the limit keeps its own line and is reported.
const longWord = reflow({
  text: '1\n00:00:01,000 --> 00:00:02,000\ninternationalisation of things\n',
  maxLine: '12', maxLines: '2', cps: '17'
});
assert.deepEqual(cueLines(longWord.output), ['internationalisation', 'of things']);
assert.equal(longWord.overChars, 1);
assert.equal(longWord.overLines, 0);
assert.equal(longWord.maxLine, 20);
assert.deepEqual(
  JSON.parse(JSON.stringify(longWord.issues.map((issue) => issue.reasons))),
  [['word longer than the limit', 'reading speed exceeded']]
);

// Too many lines for the limit is reported but the text is still emitted.
const tooMany = reflow({
  text: '1\n00:00:01,000 --> 00:00:04,000\none two three four five six seven eight nine ten\n',
  maxLine: '12', maxLines: '1', cps: '17'
});
assert.equal(tooMany.overLines, 1);
assert.ok(cueLines(tooMany.output).length > 3, 'cue text keeps every line');
assert.equal(tooMany.issues[0].reasons[0], 'line limit exceeded');

// A line starting with a dash starts a new run, so dialogue keeps its break.
const dialogue = '1\n00:00:05,000 --> 00:00:07,000\n- Are you coming tonight?\n- In a minute, I promise.\n';
const kept = reflow({ text: dialogue, maxLine: '60', maxLines: '2', cps: '17' });
assert.deepEqual(cueLines(kept.output), ['- Are you coming tonight?', '- In a minute, I promise.']);
assert.equal(kept.changed, 0);
const merged = reflow({ text: dialogue, maxLine: '60', maxLines: '2', cps: '17', keepDialogue: false });
assert.deepEqual(cueLines(merged.output), ['- Are you coming tonight? - In a minute, I promise.']);
assert.equal(merged.changed, 1);

// Markup is preserved but not counted, so a styled line fits a short limit.
const markup = reflow({
  text: '1\n00:00:02,000 --> 00:00:04,000\n<i>Italic</i> &amp; &lt;tag&gt; stay short here\n',
  maxLine: '24', maxLines: '2', cps: '17'
});
assert.deepEqual(cueLines(markup.output), ['<i>Italic</i> &amp; &lt;tag&gt;', 'stay short here']);
assert.equal(markup.maxLine, 15);

// The reading speed budget flags a short, fast cue without rewriting it.
const fast = reflow({
  text: '1\n00:00:08,000 --> 00:00:09,000\nThis cue is far too fast to read.\n',
  maxLine: '42', maxLines: '2', cps: '17'
});
assert.equal(fast.overCps, 1);
assert.equal(fast.changed, 0);
assert.equal(fast.maxLine, 33);
assert.ok(Math.abs(fast.issues[0].cps - 33) < 1e-9, 'thirty-three characters in one second');

// A WebVTT file keeps its header, identifier, NOTE block and cue settings.
const vtt = reflow({
  text: 'WEBVTT\n\nNOTE This note must survive.\n\nintro\n00:00:01.000 --> 00:00:03.500 align:start\nThis caption sentence is clearly far too long.\n',
  maxLine: '30', maxLines: '2', cps: '17'
});
assert.equal(vtt.format, 'vtt');
assert.equal(vtt.output, 'WEBVTT\n\nNOTE This note must survive.\n\nintro\n00:00:01.000 --> 00:00:03.500 align:start\nThis caption sentence\nis clearly far too long.\n');

// CRLF input and a block without a timestamp line are handled.
const crlf = reflow({ text: base.replace(/\n/g, '\r\n'), maxLine: '42', maxLines: '2', cps: '17' });
assert.equal(crlf.output, split.output);
const junk = reflow({
  text: '1\n00:00:01,000 --> 00:00:02,000\nA caption line that is a bit too long for thirty.\n\nThis block has no timing line.\n',
  maxLine: '30', maxLines: '2', cps: '17'
});
assert.ok(junk.output.endsWith('\n\nThis block has no timing line.\n'), 'untimed block preserved');

// Validation messages are exact.
assert.throws(() => reflow({ text: '', maxLine: '42', maxLines: '2', cps: '17' }), /^Error: Subtitle text is required\.$/);
assert.throws(() => reflow({ text: 'just words\n', maxLine: '42', maxLines: '2', cps: '17' }), /^Error: No subtitle cues were found\. Paste SRT or WebVTT text\.$/);
assert.throws(() => reflow({ text: base, maxLine: '', maxLines: '2', cps: '17' }), /^Error: Characters per line is required\.$/);
assert.throws(() => reflow({ text: base, maxLine: 'wide', maxLines: '2', cps: '17' }), /^Error: Characters per line must be a whole number from 10 to 100\.$/);
assert.throws(() => reflow({ text: base, maxLine: '9', maxLines: '2', cps: '17' }), /^Error: Characters per line must be between 10 and 100\.$/);
assert.throws(() => reflow({ text: base, maxLine: '101', maxLines: '2', cps: '17' }), /^Error: Characters per line must be between 10 and 100\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42.5', maxLines: '2', cps: '17' }), /^Error: Characters per line must be a whole number from 10 to 100\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '0', cps: '17' }), /^Error: Maximum lines per cue must be between 1 and 5\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '6', cps: '17' }), /^Error: Maximum lines per cue must be between 1 and 5\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '2.5', cps: '17' }), /^Error: Maximum lines per cue must be a whole number from 1 to 5\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '2', cps: '' }), /^Error: Reading speed budget is required\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '2', cps: 'fast' }), /^Error: Reading speed budget must be a number between 5 and 60 characters per second\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '2', cps: '4' }), /^Error: Reading speed budget must be between 5 and 60 characters per second\.$/);
assert.throws(() => reflow({ text: base, maxLine: '42', maxLines: '2', cps: '61' }), /^Error: Reading speed budget must be between 5 and 60 characters per second\.$/);

// A cue count above the ceiling is refused rather than processed.
const many = [];
for (let i = 1; i <= 5001; i += 1) {
  many.push(`${i}\n00:00:0${i % 10},000 --> 00:00:0${i % 10},500\nShort cue.\n`);
}
assert.throws(
  () => reflow({ text: many.join('\n'), maxLine: '42', maxLines: '2', cps: '17' }),
  /^Error: Subtitle text has more than 5,000 cues\.$/
);

// Invariant sweep: reflow is idempotent, preserves every word and timestamp,
// and never exceeds the line limit unless a single word cannot fit.
const words = ['a', 'caption', 'reader', 'extraordinarily', 'subtitle', 'line', 'break',
  '<i>styled</i>', '&amp;', 'nine', 'dash-', 'supercalifragilistic'];
let rng = 20261113;
const next = () => {
  rng = (rng * 1103515245 + 12345) % 2147483648;
  return rng / 2147483648;
};
let checked = 0;
for (const maxLine of [10, 12, 16, 20, 25, 30, 42, 60, 100]) {
  for (const maxLines of [1, 2, 3, 5]) {
    for (let round = 0; round < 6; round += 1) {
      const cues = [];
      for (let cue = 0; cue < 3; cue += 1) {
        const count = 1 + Math.floor(next() * 8);
        const text = Array.from({ length: count }, () => words[Math.floor(next() * words.length)]).join(' ');
        const startMs = cue * 3000;
        const endMs = startMs + 700 + Math.floor(next() * 3000);
        const stamp = (ms) => {
          const pad = (value, size) => String(value).padStart(size, '0');
          return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms % 3600000 / 60000), 2)}:${pad(Math.floor(ms % 60000 / 1000), 2)},${pad(ms % 1000, 3)}`;
        };
        cues.push(`${cue + 1}\n${stamp(startMs)} --> ${stamp(endMs)}\n${text}\n`);
      }
      const input = cues.join('\n');
      const keepDialogue = round % 2 === 0;
      const first = reflow({ text: input, maxLine: String(maxLine), maxLines: String(maxLines), cps: '17', keepDialogue });
      const second = reflow({ text: first.output, maxLine: String(maxLine), maxLines: String(maxLines), cps: '17', keepDialogue });
      assert.equal(second.output, first.output, `idempotent at ${maxLine}/${maxLines}`);
      assert.equal(second.changed, 0, `second pass changes nothing at ${maxLine}/${maxLines}`);

      const before = C.parse(input);
      const after = C.parse(first.output);
      assert.equal(after.blocks.length, before.blocks.length, 'block count preserved');
      before.blocks.forEach((block, index) => {
        const other = after.blocks[index];
        assert.equal(other.kind, block.kind, 'block kind preserved');
        if (block.kind === 'raw') {
          assert.deepEqual(other.lines, block.lines, 'raw block preserved');
          return;
        }
        assert.equal(other.timing, block.timing, 'timestamp line preserved');
        assert.deepEqual(other.pre, block.pre, 'identifier preserved');
        const wordList = (lines) => lines.join(' ').split(/\s+/).filter(Boolean);
        if (keepDialogue) {
          assert.deepEqual(wordList(other.text), wordList(block.text), 'words preserved');
        } else {
          assert.deepEqual(wordList(other.text), wordList(block.text), 'words preserved');
        }
        if (!first.issues.some((issue) => issue.cue === index + 1 && issue.reasons.includes('line limit exceeded'))) {
          assert.ok(other.text.length <= maxLines, `line count within limit at ${maxLine}/${maxLines}`);
          for (const line of other.text) {
            if (C.visibleLength(line) > maxLine) {
              assert.equal(line.trim().split(/\s+/).length, 1, 'only a single long word may overflow');
            }
          }
        }
      });
      checked += 1;
    }
  }
}
assert.ok(checked >= 216, 'sweep covered every limit combination');

// Replay every canonical catalog test case against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2247, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === 'subtitle-line-reflow');
assert.ok(record, 'catalog entry present');
assert.equal(record.category, 'Video');
assert.equal(record.risk, 'low');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 20, 'catalog has the full test case set');
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.throws(() => reflow(testCase.input), new RegExp('^Error: ' + escape(testCase.expected.error) + '$'), testCase.name);
    continue;
  }
  const result = reflow(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log('subtitle-line-reflow: all checks passed (' + record.testCases.length + ' catalog cases, ' + checked + ' sweep rounds)');
