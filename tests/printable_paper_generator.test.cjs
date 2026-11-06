/* Regression checks for the printable paper generator core. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/printable-paper-generator/index.html'), 'utf8');
const start = html.indexOf('/* paper-core:start */');
const end = html.indexOf('/* paper-core:end */');
assert.ok(start > -1 && end > start, 'paper core markers missing');
const core = html.slice(start, end + '/* paper-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = PaperCore;', sandbox);
const P = sandbox.module.exports;

const kinds = (sheet, kind) => sheet.segments.filter((s) => s.kind === kind);
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 0.011, `${label}: ${a} != ${b}`);

// Defaults: A4 portrait, lined, 7 mm rules, 12 mm margins.
const d = P.normalise({});
assert.equal(d.paper, 'a4');
assert.equal(d.paperLabel, 'A4');
assert.equal(d.orientation, 'portrait');
assert.equal(d.style, 'lined');
assert.equal(d.spacing, 7);
assert.equal(d.margin, 12);
assert.equal(d.pages, 1);
assert.equal(d.width, 210);
assert.equal(d.height, 297);
assert.deepEqual({ ...d.inner }, { x: 12, y: 12, w: 186, h: 273 });

// Lined A4: 273 mm of text area at 7 mm gives 39 rules, the last on the bottom edge.
const a4 = P.normalise({ paper: 'a4', style: 'lined', spacing: 7, margin: 12 });
const a4Sheet = P.buildSheet(a4, 0);
assert.equal(a4Sheet.segments.length, 39);
assert.equal(kinds(a4Sheet, 'major').length, 0);
assert.equal(a4Sheet.dots.length, 0);
close(a4Sheet.segments[0].y1, 19, 'first rule');
close(a4Sheet.segments[38].y1, 285, 'last rule');
for (const s of a4Sheet.segments) {
  assert.equal(s.x1, 12);
  assert.equal(s.x2, 198);
  assert.equal(s.y1, s.y2);
}

// A5 and Letter follow the same rule of one line per full spacing inside the margins.
const a5 = P.buildSheet(P.normalise({ paper: 'a5', style: 'lined', spacing: 7, margin: 12 }), 0);
assert.deepEqual({ ...a5.inner }, { x: 12, y: 12, w: 124, h: 186 });
assert.equal(a5.segments.length, 26);
close(a5.segments[25].y1, 194, 'A5 last rule');

const letter = P.buildSheet(P.normalise({ paper: 'letter', style: 'lined', spacing: 6, margin: 12 }), 0);
close(letter.inner.h, 255.4, 'Letter text height');
assert.equal(letter.segments.length, 42);
close(letter.segments[41].y1, 264, 'Letter last rule');

// Landscape swaps the paper dimensions, not the drawing.
const wide = P.normalise({ paper: 'a4', orientation: 'landscape' });
assert.equal(wide.width, 297);
assert.equal(wide.height, 210);
const wideSheet = P.buildSheet(wide, 0);
assert.equal(wideSheet.segments.length, 26);
assert.equal(wideSheet.segments[0].x1, 12);
assert.equal(wideSheet.segments[0].x2, 285);

// Dot grid: one dot per intersection, centred inside the margins.
const dots = P.buildSheet(P.normalise({ paper: 'a4', style: 'dot', spacing: 5, margin: 12 }), 0);
assert.equal(dots.segments.length, 0);
assert.equal(dots.dots.length, 38 * 55);
close(dots.dots[0].x, 12.5, 'first dot x');
close(dots.dots[0].y, 13.5, 'first dot y');
close(dots.dots[dots.dots.length - 1].x, 197.5, 'last dot x');
close(dots.dots[dots.dots.length - 1].y, 283.5, 'last dot y');

// Graph grid: same lattice as lines, with every fifth row and column drawn heavier.
const grid = P.buildSheet(P.normalise({ paper: 'a4', style: 'grid', spacing: 5, margin: 12 }), 0);
assert.equal(grid.segments.length, 38 + 55);
assert.equal(kinds(grid, 'major').length, 7 + 11);
assert.equal(grid.dots.length, 0);
assert.equal(grid.segments.filter((s) => s.x1 === s.x2).length, 38);
assert.equal(grid.segments.filter((s) => s.y1 === s.y2).length, 55);

// Cornell: ruled notes above a summary band, plus a cue column 30 % of the text width.
const cornell = P.buildSheet(P.normalise({ paper: 'a4', style: 'cornell', spacing: 7, margin: 12 }), 0);
const cue = kinds(cornell, 'major').find((s) => s.x1 === s.x2);
const band = kinds(cornell, 'major').find((s) => s.y1 === s.y2);
assert.ok(cue && band, 'Cornell divider missing');
close(cue.x1, 67.8, 'cue column');
close(band.y1, 214.02, 'summary band');
assert.equal(kinds(cornell, 'rule').length, 28);
assert.ok(kinds(cornell, 'rule').every((s) => s.y1 <= 214.021), 'rule crosses the summary band');
assert.equal(cornell.segments.length, 30);

// Multi-page plans repeat the identical geometry with increasing indexes.
const plan = P.planPages(P.normalise({ paper: 'a4', style: 'lined', spacing: 8, margin: 15, pages: 3 }));
assert.equal(plan.length, 3);
assert.deepEqual(Array.from(plan.map((s) => s.index)), [0, 1, 2]);
assert.deepEqual(plan[1].segments, plan[0].segments);
assert.deepEqual(plan[2].segments, plan[0].segments);

// Every drawn point stays inside the printable area.
for (const paper of Object.keys(P.PAPER)) {
  for (const style of P.STYLES) {
    for (const spacing of [4, 5, 7, 10, 15]) {
      const spec = P.normalise({ paper, style, spacing, margin: 25, pages: 1 });
      const sheet = P.buildSheet(spec, 0);
      const maxX = spec.width - 25, maxY = spec.height - 25;
      for (const s of sheet.segments) {
        for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
          assert.ok(x >= 25 - 0.011 && x <= maxX + 0.011 && y >= 25 - 0.011 && y <= maxY + 0.011, `${paper}/${style}/${spacing}: ${x},${y} outside`);
        }
      }
      for (const p of sheet.dots) {
        assert.ok(p.x >= 25 - 0.011 && p.x <= maxX + 0.011 && p.y >= 25 - 0.011 && p.y <= maxY + 0.011, `${paper}/${style}/${spacing}: dot outside`);
      }
    }
  }
}

// Rejections: unknown paper, out-of-range spacing/margin/page counts, unknown ruling.
const throws = (input, pattern) => assert.throws(() => P.normalise(input), pattern);
throws({ paper: 'b5' }, /Choose A4, A5, Letter or Legal/);
throws({ style: 'blank' }, /Choose lined, dot grid, graph or Cornell/);
throws({ spacing: 3 }, /Rule spacing must be from 4 to 15/);
throws({ spacing: 16 }, /Rule spacing must be from 4 to 15/);
throws({ spacing: '' }, /Rule spacing must be a number/);
throws({ margin: 5 }, /Margin must be from 6 to 30/);
throws({ margin: 31 }, /Margin must be from 6 to 30/);
throws({ pages: 0 }, /Pages must be from 1 to 12/);
throws({ pages: 13 }, /Pages must be from 1 to 12/);
throws({ pages: 1.5 }, /Pages must be a whole number/);
throws({ pages: null }, /Pages must be a number/);

// Unknown orientation falls back to portrait instead of failing.
assert.equal(P.normalise({ orientation: 'sideways' }).orientation, 'portrait');
// Half-millimetre values are accepted and rounded to two decimals.
assert.equal(P.normalise({ spacing: 7.25 }).spacing, 7.25);
assert.equal(P.normalise({ margin: 12.5 }).margin, 12.5);

console.log('printable paper generator core: all checks passed');
