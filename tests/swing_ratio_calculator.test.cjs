/* Regression checks for the swing ratio core, its catalog cases and the
   page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'swing-ratio-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* swing-core:start */');
const end = html.indexOf('/* swing-core:end */');
assert.ok(start > -1 && end > start, 'swing core markers missing');
const core = html.slice(start, end + '/* swing-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SwingCore;', sandbox);
const T = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (input) => plain(T.calculate(input));
const base = { bpm: '120', subdivision: 'eighth', swing: '60' };
const withInput = (overrides) => Object.assign({}, base, overrides);

// Documented surface.
assert.deepEqual(plain(Object.keys(T.DIVISIONS)), ['eighth', 'sixteenth']);
assert.equal(T.DIVISIONS.eighth.pairBeats, 1);
assert.equal(T.DIVISIONS.sixteenth.pairBeats, 0.5);
assert.equal(T.feels(50), 'Straight time — 1 : 1');
assert.equal(T.feels(60), 'Soft swing — between straight and triplets');
assert.equal(T.feels(66.6667), 'Triplet swing — 2 : 1');
assert.equal(T.feels(66.7), 'Triplet swing — 2 : 1');
assert.equal(T.feels(66.6), 'Soft swing — between straight and triplets');
assert.equal(T.feels(70), 'Hard swing — beyond triplets');
assert.equal(T.feels(74.99), 'Hard swing — beyond triplets');
assert.equal(T.feels(75), 'Dotted hard swing — 3 : 1');

// Default: 120 BPM eighth-note pairs at 60% is 300 ms against 200 ms.
const defaults = run(base);
assert.equal(defaults.bpm, 120);
assert.equal(defaults.subdivision, 'eighth');
assert.equal(defaults.pairBeats, 1);
assert.equal(defaults.swing, 60);
assert.equal(defaults.swingShort, 40);
assert.equal(defaults.straight, false);
assert.equal(defaults.beatMs, 500);
assert.equal(defaults.pairMs, 500);
assert.equal(defaults.longMs, 300);
assert.equal(defaults.shortMs, 200);
assert.equal(defaults.ratio, 1.5);
assert.equal(defaults.offbeatShiftMs, 50);
assert.equal(defaults.feel, 'Soft swing — between straight and triplets');
assert.equal(defaults.events.length, 4);
assert.deepEqual(defaults.events[0], { pair: 1, longMs: 0, shortMs: 300, longBeat: 0, shortBeat: 0.6 });
assert.deepEqual(defaults.events[1], { pair: 2, longMs: 500, shortMs: 800, longBeat: 1, shortBeat: 1.6 });
assert.equal(defaults.events[3].longMs, 1500);
assert.equal(defaults.events[3].shortBeat, 3.6);

// Straight time has no off-beat shift and an even strip.
const straight = run(withInput({ swing: '50' }));
assert.equal(straight.straight, true);
assert.equal(straight.longMs, 250);
assert.equal(straight.shortMs, 250);
assert.equal(straight.ratio, 1);
assert.equal(straight.offbeatShiftMs, 0);
assert.equal(straight.feel, 'Straight time — 1 : 1');

// Sixteenth-note pairs span half a beat.
const sixteenth = run(withInput({ subdivision: 'sixteenth' }));
assert.equal(sixteenth.pairBeats, 0.5);
assert.equal(sixteenth.pairMs, 250);
assert.equal(sixteenth.longMs, 150);
assert.equal(sixteenth.shortMs, 100);
assert.equal(sixteenth.events[1].longBeat, 0.5);
assert.equal(sixteenth.events[1].shortBeat, 0.8);
assert.equal(sixteenth.events[3].longBeat, 1.5);

// Triplet swing is 2:1 within a hundredth of a point.
const triplet = run(withInput({ bpm: '96', swing: '66.67' }));
assert.equal(triplet.pairMs, 625);
assert.equal(triplet.longMs, 416.6875);
assert.equal(triplet.shortMs, 208.3125);
assert.equal(triplet.offbeatShiftMs, 104.1875);
assert.ok(Math.abs(triplet.ratio - 2.0003000300030003) < 1e-12);
assert.equal(triplet.feel, 'Triplet swing — 2 : 1');

// Dotted hard swing is exactly 3:1.
const dotted = run(withInput({ bpm: '72', swing: '75' }));
assert.ok(Math.abs(dotted.longMs - 625) < 1e-9);
assert.ok(Math.abs(dotted.shortMs - 625 / 3) < 1e-9);
assert.equal(dotted.ratio, 3);
assert.equal(dotted.feel, 'Dotted hard swing — 3 : 1');

// Decimal commas, a leading plus and surrounding spaces are accepted.
assert.equal(run(withInput({ swing: '62,5' })).swing, 62.5);
assert.equal(run(withInput({ bpm: ' +120 ', swing: ' 60 ' })).bpm, 120);

// Validation: each refusal names the field and its range, in field order.
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
assert.equal(failure(withInput({ bpm: '' })), 'Tempo is required.');
assert.equal(failure(withInput({ bpm: '   ' })), 'Tempo is required.');
assert.equal(failure(withInput({ bpm: 'fast' })), 'Tempo must be a number from 20 to 400 BPM.');
assert.equal(failure(withInput({ bpm: '-120' })), 'Tempo must be a number from 20 to 400 BPM.');
assert.equal(failure(withInput({ bpm: '1e2' })), 'Tempo must be a number from 20 to 400 BPM.');
assert.equal(failure(withInput({ bpm: '19' })), 'Tempo must be a number from 20 to 400 BPM.');
assert.equal(failure(withInput({ bpm: '401' })), 'Tempo must be a number from 20 to 400 BPM.');
assert.equal(failure(withInput({ subdivision: 'thirty-second' })), 'Choose eighth-note or sixteenth-note pairs.');
assert.equal(failure(withInput({ swing: '' })), 'Swing amount is required.');
assert.equal(failure(withInput({ swing: 'medium' })), 'Swing amount must be a number from 50 to 75 percent.');
assert.equal(failure(withInput({ swing: '.5e2' })), 'Swing amount must be a number from 50 to 75 percent.');
assert.equal(failure(withInput({ swing: '49.9' })), 'Swing amount must be a number from 50 to 75 percent.');
assert.equal(failure(withInput({ swing: '75.1' })), 'Swing amount must be a number from 50 to 75 percent.');
// Field order wins over the order the fields were set.
assert.equal(failure(withInput({ bpm: '', swing: '' })), 'Tempo is required.');
assert.equal(failure(withInput({ subdivision: 'nope', swing: '99' })), 'Choose eighth-note or sixteenth-note pairs.');

// Both ends of every range are accepted.
assert.equal(run(withInput({ bpm: '20', swing: '50' })).pairMs, 3000);
assert.equal(run(withInput({ bpm: '400', subdivision: 'sixteenth', swing: '75' })).pairMs, 75);
assert.equal(run(withInput({ subdivision: 'sixteenth', swing: '50.01' })).straight, false);

// Algebraic identities over a dense bpm x swing x pair grid.
let identityChecks = 0;
function identities(result, label) {
  const eps = Math.max(result.pairMs * 1e-12, 1e-12);
  const checks = [
    [Math.abs(result.longMs + result.shortMs - result.pairMs) <= eps, 'long + short = pair'],
    [Math.abs(result.longMs - result.pairMs * result.swing / 100) <= eps, 'long = p% of pair'],
    [Math.abs(result.ratio - result.swing / (100 - result.swing)) <= Math.max(result.ratio * 1e-12, 1e-12), 'ratio = p/(100-p)'],
    [Math.abs(result.offbeatShiftMs - (result.longMs - result.pairMs / 2)) <= eps, 'shift = long - midpoint'],
    [Math.abs(result.pairMs - result.beatMs * result.pairBeats) <= eps, 'pair = beat x pair beats'],
    [Math.abs(result.beatMs - 60000 / result.bpm) <= Math.max(result.beatMs * 1e-12, 1e-12), 'beat = 60000/bpm'],
    [result.longMs >= 0 && result.shortMs >= 0, 'lengths non-negative'],
    [result.swing >= 50 && result.swing <= 75, 'swing inside range'],
    [result.events[0].longMs === 0, 'first onset at zero'],
    [Math.abs(result.events[1].longMs - result.pairMs) <= eps, 'second pair starts one span later'],
    [Math.abs(result.events[3].longMs - 3 * result.pairMs) <= eps, 'fourth pair starts three spans later'],
    [Math.abs(result.events[1].shortMs - (result.pairMs + result.longMs)) <= eps, 'short onset follows its long note'],
    [Math.abs(result.events[2].shortBeat - (2 * result.pairBeats + result.pairBeats * result.swing / 100)) <= 1e-12, 'short beat follows the grid'],
    [result.events.every((event, index) => event.pair === index + 1), 'pairs are numbered in order'],
    [result.feel.length > 0, 'feel is named'],
  ];
  checks.forEach(([ok, name]) => {
    assert.ok(ok, `${label}: ${name}`);
    identityChecks += 1;
  });
}
for (let bpm = 20; bpm <= 400; bpm += 20) {
  for (const subdivision of ['eighth', 'sixteenth']) {
    for (const swing of ['50', '52.5', '55', '57.5', '60', '62.5', '65', '66.67', '70', '72.5', '75']) {
      identities(run({ bpm: String(bpm), subdivision, swing }), `${bpm}/${subdivision}/${swing}`);
    }
  }
}

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket/.test(html),
  'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="swing-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/type="button" id="reset"/.test(html), 'page has an explicit reset button');
assert.ok(/role="alert"/.test(html), 'errors are announced as alerts');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const control of ['tempo', 'division', 'swing']) {
  assert.ok(new RegExp(`<label for="${control}">`).test(html), `${control} is labelled`);
  assert.ok(new RegExp(`id="${control}"[^>]*aria-describedby=`).test(html), `${control} has a help text`);
}
assert.ok(/min-height:44px/.test(html), 'controls keep a 44 px target');
assert.ok(/<html lang=/.test(html) && /name="viewport"/.test(html), 'page has language and viewport');
assert.ok(/<h1>Swing Ratio Calculator<\/h1>/.test(html), 'page has its heading');
assert.ok(/name="description"/.test(html), 'page has a description');
assert.ok(/<\/html>\s*$/.test(html), 'page is complete');

// Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Swing Ratio Calculator');
assert.equal(record.category, 'Music');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.tags.includes('swing') && record.tags.includes('shuffle'), 'record tags');
assert.ok(record.tags.includes('groove') && record.tags.includes('rhythm'), 'record tags cover timing');
assert.ok(record.aliases.some((alias) => /Triplet Feel Calculator/.test(alias)), 'record alias');
assert.ok(/p \/ \(100 - p\)/.test(record.method), 'method states the ratio rule');
assert.ok(/no storage, uploads or network access/.test(record.method), 'method documents local limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.ok(source.title && /^https:\/\//.test(source.url), 'source has a title and URL');
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 20, 'catalog case count');
assert.equal(kinds('golden'), 5, 'five golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');

let checked = 0;
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = run(testCase.input);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number') {
      const tolerance = Math.max(Math.abs(value) * 1e-9, 1e-9);
      assert.ok(Math.abs(actual[key] - value) <= tolerance,
        `${testCase.name}.${key}: ${actual[key]} vs ${value}`);
      checked += 1;
    } else {
      assert.equal(actual[key], value, `${testCase.name}.${key}`);
    }
  }
}

// Every feel band must be reachable from the catalog cases and the band edges.
const covered = new Set(record.testCases.filter((testCase) => testCase.kind !== 'validation')
  .map((testCase) => T.calculate(testCase.input).feel));
assert.ok(covered.has('Straight time — 1 : 1') && covered.has('Soft swing — between straight and triplets')
  && covered.has('Triplet swing — 2 : 1') && covered.has('Dotted hard swing — 3 : 1'),
  'catalog cases cover the main feels');

console.log('swing-ratio-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + checked + ' numeric fields, '
  + identityChecks + ' identity checks)');
