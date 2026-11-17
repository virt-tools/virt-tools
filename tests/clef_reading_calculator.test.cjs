/* Regression checks for the clef reading core, its catalog cases and the page's
   offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'clef-reading-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* clef-core:start */');
const end = html.indexOf('/* clef-core:end */');
assert.ok(start > -1 && end > start, 'clef core markers missing');
const core = html.slice(start, end + '/* clef-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ClefCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(T.calculate(input));
const fromPosition = (input) => plain(T.fromPosition(input));
const CL = { clef: 'treble', letter: 'A', accidental: 'natural', octave: '4' };
const withInput = (overrides) => Object.assign({}, CL, overrides);

// Documented surface.
assert.equal(T.MIN_STEP, -6);
assert.equal(T.MAX_STEP, 14);
assert.deepEqual(Object.keys(T.CLEFS), ['treble', 'treble-8vb', 'soprano', 'mezzo-soprano',
  'alto', 'tenor', 'baritone-c', 'baritone-f', 'bass']);
for (const clef of Object.keys(T.CLEFS)) {
  const spec = T.CLEFS[clef];
  assert.ok(['G', 'F', 'C'].includes(spec.sign), `${clef} sign`);
  assert.ok(spec.line >= 1 && spec.line <= 5, `${clef} line`);
  assert.ok(spec.shift === 0 || spec.shift === -1, `${clef} shift`);
}

// The position naming contract, step by step.
const labels = {
  '-6': 'Ledger line 3 below the staff',
  '-5': 'Space below ledger line 2',
  '-4': 'Ledger line 2 below the staff',
  '-3': 'Space below ledger line 1',
  '-2': 'Ledger line 1 below the staff',
  '-1': 'Space below the staff',
  '0': 'Line 1',
  '1': 'Space 1',
  '2': 'Line 2',
  '3': 'Space 2',
  '4': 'Line 3',
  '5': 'Space 3',
  '6': 'Line 4',
  '7': 'Space 4',
  '8': 'Line 5',
  '9': 'Space above the staff',
  '10': 'Ledger line 1 above the staff',
  '11': 'Space above ledger line 1',
  '12': 'Ledger line 2 above the staff',
  '13': 'Space above ledger line 2',
  '14': 'Ledger line 3 above the staff',
};
for (const [step, label] of Object.entries(labels)) {
  assert.equal(T.positionLabel(Number(step)), label, `label for ${step}`);
}
const ledgers = { '-6': 3, '-5': 2, '-4': 2, '-3': 1, '-2': 1, '-1': 0, '0': 0, '8': 0, '9': 0,
  '10': 1, '11': 1, '12': 2, '13': 2, '14': 3 };
for (const [step, count] of Object.entries(ledgers)) {
  assert.equal(T.ledgerLines(Number(step)), count, `ledgers at ${step}`);
}

// Each clef names one letter on one line: the reference pitch must land there.
const reference = {
  treble: ['G', 4, 2], 'treble-8vb': ['G', 4, 2], soprano: ['C', 4, 1], 'mezzo-soprano': ['C', 4, 2],
  alto: ['C', 4, 3], tenor: ['C', 4, 4], 'baritone-c': ['C', 4, 5], 'baritone-f': ['F', 3, 3], bass: ['F', 3, 4],
};
for (const [clef, [letter, octave, line]] of Object.entries(reference)) {
  const placed = run({ clef, letter, accidental: 'natural', octave: String(octave) });
  assert.equal(placed.step, 2 * (line - 1), `${clef} reference step`);
  assert.equal(placed.position, `Line ${line}`, `${clef} reference line`);
}

// Defaults and the classic middle C readings.
const defaults = run(CL);
assert.equal(defaults.position, 'Space 2');
assert.equal(defaults.ledgerLines, 0);
assert.equal(defaults.step, 3);
assert.equal(defaults.written, 'A4');
assert.equal(defaults.sounding, 'A4');
assert.equal(defaults.clef, 'treble');
assert.equal(defaults.sign, 'G');
assert.equal(defaults.line, 2);
assert.equal(defaults.comparisons.length, 9);
const middleC = {
  treble: 'Ledger line 1 below the staff', bass: 'Ledger line 1 above the staff', alto: 'Line 3',
  tenor: 'Line 4', soprano: 'Line 1', 'mezzo-soprano': 'Line 2', 'baritone-c': 'Line 5',
};
for (const [clef, position] of Object.entries(middleC)) {
  assert.equal(run({ clef, letter: 'C', octave: '4' }).position, position, `${clef} middle C`);
}

// Accidental moves the name, never the position; octave clef sounds an octave lower.
const sharp = run(withInput({ letter: 'F', accidental: 'sharp', octave: '4' }));
const natural = run(withInput({ letter: 'F', octave: '4' }));
assert.equal(sharp.step, natural.step);
assert.equal(sharp.position, natural.position);
assert.equal(sharp.written, 'F♯4');
assert.equal(sharp.sounding, 'F♯4');
const flat = run(withInput({ clef: 'bass', letter: 'B', accidental: 'flat', octave: '3' }));
assert.equal(flat.written, 'B♭3');
assert.equal(flat.position, 'Space above the staff');
const tenorVoice = run(withInput({ clef: 'treble-8vb', letter: 'C', octave: '4' }));
assert.equal(tenorVoice.written, 'C4');
assert.equal(tenorVoice.sounding, 'C3');
assert.equal(tenorVoice.soundingOctave, 3);
assert.equal(tenorVoice.position, 'Ledger line 1 below the staff');

// Position to note, including the octave bookkeeping across a ledger line.
const altoC = fromPosition({ clef: 'alto', position: '4' });
assert.equal(altoC.written, 'C4');
assert.equal(altoC.letter, 'C');
assert.equal(altoC.octave, 4);
assert.equal(altoC.position, 'Line 3');
const altoLow = fromPosition({ clef: 'alto', position: '-2' });
assert.equal(altoLow.written, 'D3');
assert.equal(altoLow.ledgerLines, 1);
const tenorHigh = fromPosition({ clef: 'tenor', position: '14' });
assert.equal(tenorHigh.ledgerLines, 3);
assert.equal(tenorHigh.step, 14);

// Round trips: position -> note -> position over every clef and covered step.
let trips = 0;
for (const clef of Object.keys(T.CLEFS)) {
  for (let step = T.MIN_STEP; step <= T.MAX_STEP; step++) {
    const back = fromPosition({ clef, position: String(step) });
    assert.equal(back.step, step, `${clef}/${step} step`);
    const again = run({ clef, letter: back.letter, octave: String(back.octave) });
    assert.equal(again.step, step, `${clef}/${step} round trip`);
    assert.equal(again.position, back.position);
    assert.equal(again.ledgerLines, back.ledgerLines);
    assert.equal(again.written, back.written);
    trips += 1;
  }
}

// Comparison table invariants over a dense pitch grid.
let comparisons = 0;
function compareCheck(result, label) {
  const rows = result.comparisons;
  assert.equal(rows.length, 9, `${label} row count`);
  assert.equal(rows.filter((row) => row.current).length, 1, `${label} current row`);
  assert.equal(rows.find((row) => row.current).clef, result.clef, `${label} current clef`);
  rows.forEach((row) => {
    assert.equal(row.clef, Object.keys(T.CLEFS)[rows.indexOf(row)], `${label} row order`);
    assert.equal(row.offStaff, row.step < T.MIN_STEP || row.step > T.MAX_STEP, `${label} off-staff flag`);
    assert.equal(row.position, row.offStaff ? 'Off the staff' : T.positionLabel(row.step), `${label} row position`);
    assert.equal(row.ledgerLines, row.offStaff ? null : T.ledgerLines(row.step), `${label} row ledgers`);
    assert.ok(row.written.length >= 2, `${label} written name`);
    assert.ok(['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(row.written[0]), `${label} row letter`);
    comparisons += 1;
  });
}
for (const clef of Object.keys(T.CLEFS)) {
  for (const letter of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
    for (const octave of [2, 3, 4, 5, 6]) {
      let result;
      try {
        result = run({ clef, letter, accidental: 'natural', octave: String(octave) });
      } catch (error) {
        continue;
      }
      compareCheck(result, `${clef}/${letter}${octave}`);
      assert.ok(result.step >= T.MIN_STEP && result.step <= T.MAX_STEP, `${clef}/${letter}${octave} covered`);
      assert.equal(result.position, T.positionLabel(result.step));
      assert.equal(result.ledgerLines, T.ledgerLines(result.step));
      assert.equal(result.inStaff, result.step >= 0 && result.step <= 8);
      assert.equal(result.soundingOctave, result.octave + (clef === 'treble-8vb' ? -1 : 0));
      assert.equal(result.written, letter + octave);
    }
  }
}

// Refusals name the field and the rule, in field order.
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
assert.equal(failure(withInput({ clef: 'violin' })), 'Choose a clef from the list.');
assert.equal(failure(withInput({ clef: '' })), 'Choose a clef from the list.');
assert.equal(failure(withInput({ letter: '' })), 'Choose a note letter from C to B.');
assert.equal(failure(withInput({ letter: 'H' })), 'Choose a note letter from C to B.');
assert.equal(failure(withInput({ accidental: 'double-flat' })), 'Choose natural, sharp or flat.');
assert.equal(failure(withInput({ octave: '' })), 'Octave is required.');
assert.equal(failure(withInput({ octave: 'four' })), 'Octave must be a whole number from 0 to 9.');
assert.equal(failure(withInput({ octave: '-1' })), 'Octave must be a whole number from 0 to 9.');
assert.equal(failure(withInput({ octave: '10' })), 'Octave must be a whole number from 0 to 9.');
assert.equal(failure(withInput({ octave: '4.5' })), 'Octave must be a whole number from 0 to 9.');
assert.equal(failure(withInput({ letter: 'C', octave: '7' })),
  'That note sits outside the staff range; positions cover three ledger lines below to three above.');
assert.equal(failure(withInput({ clef: 'treble', letter: 'A', octave: '1' })),
  'That note sits outside the staff range; positions cover three ledger lines below to three above.');
// Clef is checked before the note, whatever order the fields were set.
assert.equal(failure(withInput({ clef: 'nope', letter: '', octave: '' })), 'Choose a clef from the list.');
const positionFailure = (input) => {
  try {
    fromPosition(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
assert.equal(positionFailure({ clef: 'treble', position: '' }), 'Staff position is required.');
assert.equal(positionFailure({ clef: 'treble', position: '15' }), 'Staff position must be a whole number from -6 to 14.');
assert.equal(positionFailure({ clef: 'treble', position: '-7' }), 'Staff position must be a whole number from -6 to 14.');
assert.equal(positionFailure({ clef: 'treble', position: '1.5' }), 'Staff position must be a whole number from -6 to 14.');
assert.equal(positionFailure({ clef: 'alto', position: '99' }), 'Staff position must be a whole number from -6 to 14.');
assert.equal(positionFailure({ clef: 'bass', position: '' }), 'Staff position is required.');

// Both ends of the covered range are accepted in every clef.
for (const clef of Object.keys(T.CLEFS)) {
  assert.equal(fromPosition({ clef, position: String(T.MIN_STEP) }).step, T.MIN_STEP);
  assert.equal(fromPosition({ clef, position: String(T.MAX_STEP) }).step, T.MAX_STEP);
}

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="clef-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="img"/.test(html), 'the staff diagram is labelled as an image');
for (const control of ['clef', 'letter', 'accidental', 'octave', 'position']) {
  assert.ok(new RegExp(`<label for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has a help text`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Clef Reading Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');

// The clef picker must offer exactly the clefs the core knows.
const options = [...html.matchAll(/<option value="([a-z0-9-]+)"/g)].map((match) => match[1]);
const clefOptions = options.filter((value) => Object.prototype.hasOwnProperty.call(T.CLEFS, value));
assert.deepEqual(clefOptions.sort(), Object.keys(T.CLEFS).sort(), 'clef picker matches the core');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Clef Reading Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.tags.includes('clef') && record.tags.includes('notation'), 'record tags');
assert.ok(record.tags.includes('alto-clef') && record.tags.includes('ledger-lines'), 'record tags cover clefs');
assert.ok(record.aliases.some((alias) => /Staff Position Calculator/.test(alias)), 'record alias');
assert.ok(/three ledger lines below and above the staff/.test(record.method), 'method states the range');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and URL');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 25, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 9, 'nine boundary cases');
assert.equal(kinds('validation'), 8, 'eight validation cases');

let checked = 0;
const clefsCovered = new Set();
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  clefsCovered.add(actual.clef);
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], value, `${testCase.name}.${key}`);
    checked += 1;
  }
}
assert.ok(clefsCovered.size >= 7, 'catalog cases cover most clefs');

console.log('clef-reading-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' expected fields, '
  + trips + ' round trips, ' + comparisons + ' comparison rows)');
