/* Regression checks for the ANSI escape sequence decoder core: the catalog
   cases, palette arithmetic against an independent formula, style invariants,
   position and display round-trips, the listing cap and the page's local-only
   contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = path.join(root, 'frontend/tools/ansi-escape-sequence-decoder/index.html');
const html = fs.readFileSync(page, 'utf8');
const start = html.indexOf('/* ansi-escape-core:start */');
const end = html.indexOf('/* ansi-escape-core:end */');
assert.ok(start > -1 && end > start, 'decoder core markers missing');
const core = html.slice(start, end + '/* ansi-escape-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AnsiEscapeCore;', sandbox);
const C = sandbox.module.exports;
const ESC = '\u001b';
const BEL = '\u0007';
const run = (text, literals) => C.decode({ text, literals });
const err = (text) => {
  try {
    C.decode({ text });
  } catch (error) {
    return error.message;
  }
  throw new Error('expected an error for ' + JSON.stringify(text).slice(0, 80));
};

// ---- Catalog cases -------------------------------------------------------

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'ansi-escape-sequence-decoder');
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'ANSI Escape Sequence Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Analysis & validation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 10, 'ten golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6, 'six validation cases');

for (const testCase of record.testCases){
  if (testCase.expected && testCase.expected.error){
    assert.equal(err(testCase.input.text), testCase.expected.error, testCase.name);
    continue;
  }
  const result = C.decode(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)){
    // The core runs in another VM context, so its arrays have a different
    // prototype; compare by value rather than by realm identity.
    assert.equal(JSON.stringify(result[key]), JSON.stringify(value), testCase.name + ' ' + key);
  }
}

// ---- Palette arithmetic, written out independently -----------------------

function refPalette(index){
  if (index < 16){
    const base = ['000000', '800000', '008000', '808000', '000080', '800080', '008080', 'c0c0c0',
      '808080', 'ff0000', '00ff00', 'ffff00', '0000ff', 'ff00ff', '00ffff', 'ffffff'];
    return '#' + base[index];
  }
  if (index < 232){
    const steps = [0, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
    const n = index - 16;
    const parts = [];
    parts.push(steps[Math.trunc(n / 36)]);
    parts.push(steps[Math.trunc((n % 36) / 6)]);
    parts.push(steps[n % 6]);
    return '#' + parts.map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  const grey = 8 + (index - 232) * 10;
  return '#' + [grey, grey, grey].map((value) => value.toString(16).padStart(2, '0')).join('');
}
for (let index = 0; index < 256; index += 1){
  assert.equal(C.paletteColor(index), refPalette(index), 'palette index ' + index);
}

// ---- Style invariants ----------------------------------------------------

const defaultStyle = () => ({
  bold: false, dim: false, italic: false, underline: false,
  blink: false, reverse: false, hidden: false, strike: false, fg: null, bg: null
});

// Reset always returns to the default style, whatever came before it.
const attributeSets = ['1', '1;31', '3;4;9', '7;8', '38;5;196', '48;5;17;1', '38;2;1;2;3', '2;5;21', '90;107'];
for (const attributes of attributeSets){
  const result = run(ESC + '[' + attributes + 'mX' + ESC + '[0mY');
  assert.equal(JSON.stringify(result.finalStyle), JSON.stringify(defaultStyle()), 'reset after ' + attributes);
  assert.equal(JSON.stringify(result.segments[result.segments.length - 1].style), JSON.stringify(defaultStyle()), 'reset segment after ' + attributes);
}

// Applying parameters one at a time reaches the same style as applying them
// together, because SGR is a sequential state machine either way.
const combined = ['1', '3', '4', '9', '31', '44'];
const together = run(ESC + '[' + combined.join(';') + 'mA').finalStyle;
let sequential = run('plain').finalStyle;
for (const attribute of combined){
  sequential = run(ESC + '[' + attribute + 'm' + ESC + '[0m').finalStyle;
  assert.equal(JSON.stringify(sequential), JSON.stringify(defaultStyle()), 'single attribute ' + attribute + ' then reset');
}
sequential = run(combined.map((attribute) => ESC + '[' + attribute + 'm').join('') + 'A').finalStyle;
assert.equal(JSON.stringify(together), JSON.stringify(sequential), 'combined SGR equals sequential SGR');

// Reverse swaps the drawing colours; hidden is drawn faintly.
const reversed = C.cssFor({ bold: false, dim: false, italic: false, underline: false, blink: false,
  reverse: true, hidden: false, strike: false, fg: '#010203', bg: '#0a0b0c' });
assert.equal(reversed.color, '#0a0b0c');
assert.equal(reversed.backgroundColor, '#010203');
const hiddenCss = C.cssFor({ bold: false, dim: false, italic: false, underline: false, blink: false,
  reverse: false, hidden: true, strike: false, fg: null, bg: null });
assert.equal(hiddenCss.opacity, '0.15');
assert.equal(C.describeStyle(defaultStyle()), 'default');

// ---- Positions, displays and segment bookkeeping -------------------------

function refPositions(parts){
  // parts alternate plain text and real escape sequences; each position is the
  // one-based line and column where that sequence starts, counted by hand.
  const positions = [];
  let line = 1, column = 1;
  for (const part of parts){
    if (part.sequence) positions.push(line + ':' + column);
    for (const char of part.text){
      if (char === '\n'){ line += 1; column = 1; } else { column += 1; }
    }
  }
  return positions;
}
function unescapeDisplay(display){
  let out = '';
  for (let index = 0; index < display.length; index += 1){
    if (display.charAt(index) !== '\\'){ out += display.charAt(index); continue; }
    const rest = display.slice(index);
    const match = /^\\(x[0-9a-f]{2}|u[0-9a-f]{4}|[abtnrvf\\])/.exec(rest);
    if (!match){ out += '\\'; continue; }
    const token = match[1];
    const table = { a: '\u0007', b: '\b', t: '\t', n: '\n', r: '\r', v: '\v', f: '\f', '\\': '\\' };
    if (table[token] !== undefined) out += table[token];
    else if (token.charAt(0) === 'x') out += String.fromCharCode(parseInt(token.slice(1), 16));
    else out += String.fromCharCode(parseInt(token.slice(1), 16));
    index += match[0].length - 1;
  }
  return out;
}

const layouts = [
  [{ text: 'plain ' }, { text: ESC + '[1m', sequence: true }, { text: 'bold' }, { text: ESC + '[0m\n', sequence: true }, { text: 'next' }],
  [{ text: ESC + '[31m', sequence: true }, { text: 'red\nred' }, { text: ESC + ']0;t' + BEL, sequence: true }, { text: 'after' }],
  [{ text: 'a\nb' }, { text: ESC + '[38;5;40m', sequence: true }, { text: '\nc' }]
];
for (const layout of layouts){
  const text = layout.map((part) => part.text).join('');
  const result = run(text);
  assert.equal(JSON.stringify(result.positions), JSON.stringify(refPositions(layout)), 'positions for ' + JSON.stringify(text));
  // Every listed sequence is reproduced exactly by its display form.
  for (let index = 0; index < result.sequences.length; index += 1){
    assert.equal(unescapeDisplay(result.displays[index]), result.sequences[index].raw,
      'display round-trip for ' + JSON.stringify(result.displays[index]));
  }
  // The preview carries the same text as the stripped paste, and the stripped
  // paste never contains an escape character.
  assert.equal(result.segmentTexts.join(''), result.plain, 'segments compose the plain text');
  assert.ok(!result.plain.includes(ESC), 'plain text has no escape characters');
}

// ---- Bounds and listing cap ---------------------------------------------

assert.equal(C.decode({ text: 'a'.repeat(C.MAX_INPUT) }).escapeCount, 0);
assert.equal(err('a'.repeat(C.MAX_INPUT + 1)),
  'Keep the paste under ' + C.MAX_INPUT + ' characters; split a long log into smaller pieces.');
const many = [];
for (let index = 0; index < C.MAX_LISTED + 100; index += 1) many.push(ESC + '[31mx');
const capped = run(many.join(''));
assert.equal(capped.escapeCount, C.MAX_LISTED + 100);
assert.equal(capped.sequences.length, C.MAX_LISTED);
assert.equal(capped.truncated, true);
assert.ok(capped.warnings.length >= 1, 'the cap is reported');

// An unterminated string stops at the documented limit instead of running on;
// what follows the cut-off is reported as text, not silently swallowed.
const runawayText = 'x' + ESC + ']0;' + 'a'.repeat(600) + 'y';
const runaway = run(runawayText);
assert.equal(runaway.incompleteCount, 1);
assert.equal(runaway.sequences[0].description,
  'unterminated operating system command: no BEL or string terminator within 512 characters');
assert.ok(runaway.plain.startsWith('x') && runaway.plain.endsWith('y'), 'the tail after the cut-off stays text');
assert.ok(runaway.sequences[0].raw.length <= 516, 'the string stops near the documented limit');
assert.equal(runaway.textCharacters + runaway.sequences.reduce((total, sequence) => total + sequence.raw.length, 0),
  runawayText.length, 'every character is either text or part of a sequence');

// ---- Page contract ------------------------------------------------------

assert.ok(!/https?:\/\//.test(html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="ae-form"/.test(html), 'page has a submittable form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/<label class="f" for="in-text"/.test(html), 'page labels the paste field');
assert.ok(/<label class="check" for="in-literals"/.test(html), 'page labels the written-forms option');
assert.ok(/role="status"/.test(html), 'copy status is announced');
assert.ok(/function placeholder\(/.test(html) && /createElement\("span"\)/.test(html), 'preview is built with DOM nodes');

console.log('ansi-escape-sequence-decoder: all checks passed ('
  + record.testCases.length + ' catalog cases, 256 palette entries, '
  + layouts.length + ' position layouts)');
