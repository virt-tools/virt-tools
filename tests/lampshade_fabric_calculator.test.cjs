/* Lampshade fabric: the trapezoid panel model, the panel-splitting rule, the
   layout down the bolt, the validation paths, the catalog test cases and the
   page contract. The expected numbers in the catalog were produced by a
   separate Python implementation of the same model; this suite also
   re-derives random cases from its own formula so the page core is never
   compared with itself. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'lampshade-fabric-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* lampshade-fabric-core:start */';
const endMarker = '/* lampshade-fabric-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = LampshadeFabricCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ': ' + actual + ' is not within ' + tolerance + ' of ' + expected);
};
const failure = (run) => {
  try { run(); } catch (error) { return error.message; }
  return null;
};

// ---- An independent implementation of the same panel model.
const reference = {
  estimate(input) {
    const pi = Math.PI;
    const n = (raw) => {
      const text = String(raw == null ? '' : raw).replace(/\s+/g, '');
      if (!/^[0-9]*\.?[0-9]+$/.test(text)) throw new Error('bad number');
      return Number(text);
    };
    const bottom = n(input.bottom);
    const height = n(input.height);
    const seam = n(input.seam);
    const turn = n(input.turn);
    const fabric = n(input.fabric);
    const top = input.shape === 'empire' ? n(input.top) : bottom;
    const bottomC = pi * bottom;
    const topC = pi * top;
    const slant = input.shape === 'empire'
      ? (height ** 2 + ((bottom - top) / 2) ** 2) ** 0.5
      : height;
    const panelH = slant + 2 * turn;
    let panels = 0;
    for (let candidate = 1; candidate <= 8; candidate += 1) {
      if (bottomC / candidate + 2 * seam <= fabric) { panels = candidate; break; }
    }
    if (!panels) throw new Error('no panel count');
    const panelW = bottomC / panels + 2 * seam;
    const across = Math.floor(fabric / panelW);
    const rows = Math.ceil(panels / across);
    const length = rows * panelH;
    return {
      bottomCircumference: bottomC,
      topCircumference: topC,
      slant,
      panelWidth: panelW,
      panelHeight: panelH,
      panels,
      rows,
      fabricLength: length,
      fabricPurchase: input.unit === 'cm' ? length / 100 : length / 36,
      trimLength: bottomC + topC
    };
  }
};

// ---- Limits.
assert.equal(C.MIN_DIAMETER, 1);
assert.equal(C.MAX_DIAMETER, 240);
assert.equal(C.MIN_HEIGHT, 2);
assert.equal(C.MAX_HEIGHT, 120);
assert.equal(C.MAX_SEAM, 4);
assert.equal(C.MAX_TURN, 6);
assert.equal(C.MIN_FABRIC, 6);
assert.equal(C.MAX_FABRIC, 200);
assert.equal(C.MAX_PANELS, 8);

const base = {
  unit: 'in', shape: 'drum', top: '10', bottom: '12', height: '8', seam: '0.5', turn: '0.75',
  fabric: '44'
};
const run = (changes) => plain(C.estimate(Object.assign({}, base, changes)));

// ---- The default page state: a 12 in drum shade, 8 in tall, on 44 in fabric.
const drum = run({});
close(drum.bottomCircumference, 37.6991, 1e-4, 'bottom circumference');
close(drum.topCircumference, 37.6991, 1e-4, 'drum top circumference');
close(drum.slant, 8, 1e-12, 'drum slant is the straight height');
close(drum.panelHeight, 9.5, 1e-12, 'panel height adds both edges');
close(drum.panelWidth, 38.6991, 1e-4, 'panel width adds both seams');
assert.equal(drum.panels, 1);
assert.equal(drum.rows, 1);
close(drum.fabricLength, 9.5, 1e-12, 'one length of fabric');
close(drum.fabricPurchase, 9.5 / 36, 1e-12, 'yards');
close(drum.trimLength, 75.3982, 1e-4, 'trim for both rims');

// ---- The trapezoid: the bottom edge is the wide one and the slant is real.
const empire = run({ shape: 'empire', top: '10', bottom: '16', height: '10' });
close(empire.bottomCircumference, 50.2655, 1e-4, 'empire bottom');
close(empire.topCircumference, 31.4159, 1e-4, 'empire top');
close(empire.slant, Math.sqrt(100 + 9), 1e-12, 'empire slant');
assert.ok(empire.slant > 10, 'a tapered shade is longer on the slope');
assert.equal(empire.panels, 2);
assert.equal(empire.rows, 2);
close(empire.panelWidth, 50.2655 / 2 + 1, 1e-4, 'split panel width');
close(empire.fabricLength, 2 * (Math.sqrt(109) + 1.5), 1e-12, 'two lengths');

// ---- Slant height only grows with the taper and is linear in height.
for (const [top, bottom, height] of [['8', '16', '10'], ['4', '20', '10'], ['12', '20', '14']]) {
  const shade = run({ shape: 'empire', top, bottom, height });
  close(shade.slant, Math.sqrt(Number(height) ** 2 + ((Number(bottom) - Number(top)) / 2) ** 2),
    1e-12, 'slant for ' + top + '/' + bottom);
}
const tall = run({ shape: 'empire', top: '10', bottom: '16', height: '20' });
assert.ok(tall.slant > empire.slant, 'a taller shade has a longer slant');
close(tall.panelHeight - 1.5, tall.slant, 1e-12, 'edge allowances are the only addition');

// ---- The panel count is the smallest that fits the fabric width.
assert.equal(run({ bottom: '8', fabric: '12', seam: '0.5' }).panels, 3);
assert.equal(run({ bottom: '40', fabric: '44' }).panels, 3);
assert.equal(run({ bottom: '60', fabric: '44' }).panels, 5);
assert.equal(run({ bottom: '12', fabric: '60', seam: '3.5' }).panels, 1);
for (const fabric of ['14', '18', '24', '30', '36', '44', '60', '90', '120', '200']) {
  const shade = run({ bottom: '26', fabric });
  assert.ok(shade.panelWidth <= Number(fabric) + 1e-9,
    'the chosen panel fits ' + fabric + ' in of fabric');
  assert.ok(shade.panels >= 1 && shade.panels <= 8, 'the panel count stays in range');
}

// ---- More fabric width never needs more panels, and more panels never widen a panel.
let previousPanels = 99;
let previousRows = 99;
for (let width = 12; width <= 80; width += 1) {
  const shade = run({ bottom: '26', fabric: String(width) });
  assert.ok(shade.panels <= previousPanels, 'panels fall as the fabric widens at ' + width);
  assert.ok(shade.rows <= previousRows, 'rows fall as the fabric widens at ' + width);
  previousPanels = shade.panels;
  previousRows = shade.rows;
}

// ---- Taller and wider shades take more fabric; wider fabric takes less.
const small = run({});
const bigger = run({ bottom: '18', height: '12' });
assert.ok(bigger.fabricLength > small.fabricLength, 'a bigger shade takes more fabric');
const longer = run({ bottom: '10', height: '20' });
assert.ok(longer.fabricLength > run({ bottom: '10', height: '10' }).fabricLength,
  'a taller shade takes more fabric');
const wide = run({ bottom: '18', fabric: '60' });
assert.ok(wide.fabricPurchase <= run({ bottom: '18', fabric: '44' }).fabricPurchase,
  'wider fabric takes no more length');

// ---- Metric output converts the cut length to metres.
const metric = run({ unit: 'cm', bottom: '30', height: '20', seam: '1', turn: '2', fabric: '110' });
close(metric.fabricLength, 24, 1e-12, 'metric cut length in centimetres');
close(metric.fabricPurchase, 0.24, 1e-12, 'metric purchase in metres');
close(metric.bottomCircumference, Math.PI * 30, 1e-12, 'metric circumference');

// ---- Seeded random cases agree with the independent implementation.
let seed = 20261115;
const random = (limit) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % limit;
};
for (let round = 0; round < 300; round += 1) {
  const shape = random(2) === 0 ? 'drum' : 'empire';
  const bottom = 3 + random(2800) / 100;
  const top = 1 + random(Math.floor((bottom - 0.5) * 100)) / 100;
  const height = 2 + random(4000) / 100;
  const seam = random(120) / 100;
  const turn = random(180) / 100;
  const fabric = 6 + random(12000) / 100;
  const input = {
    unit: random(2) === 0 ? 'in' : 'cm',
    shape,
    top: String(top),
    bottom: String(bottom),
    height: String(height),
    seam: String(seam),
    turn: String(turn),
    fabric: String(fabric)
  };
  let actual;
  try {
    actual = plain(C.estimate(input));
  } catch (error) {
    assert.match(error.message, /too wide|top diameter smaller/,
      'random case ' + round + ' refused for a range reason: ' + error.message);
    continue;
  }
  const expected = reference.estimate(input);
  close(actual.fabricLength, expected.fabricLength, 1e-9, 'random case ' + round + ' length');
  close(actual.panelWidth, expected.panelWidth, 1e-9, 'random case ' + round + ' width');
  close(actual.panelHeight, expected.panelHeight, 1e-9, 'random case ' + round + ' height');
  close(actual.trimLength, expected.trimLength, 1e-9, 'random case ' + round + ' trim');
  assert.equal(actual.panels, expected.panels, 'random case ' + round + ' panels');
  assert.equal(actual.rows, expected.rows, 'random case ' + round + ' rows');
  assert.ok(actual.panelWidth <= Number(input.fabric) + 1e-9,
    'random case ' + round + ' panel fits the fabric');
}

// ---- Refusals, one per failure path.
const one = (changes) => Object.assign({}, base, changes);
assert.equal(failure(() => C.estimate(one({ unit: 'ft' }))), 'Choose inches or centimetres.');
assert.equal(failure(() => C.estimate(one({ shape: 'cone' }))), 'Choose a drum or an empire shade.');
assert.equal(failure(() => C.estimate(one({ bottom: '' }))), 'Enter the bottom ring diameter.');
assert.equal(failure(() => C.estimate(one({ bottom: 'twelve' }))),
  'Enter the bottom ring diameter as a number, such as 12.');
assert.equal(failure(() => C.estimate(one({ bottom: '0.5' }))), 'Enter a bottom diameter from 1 to 240.');
assert.equal(failure(() => C.estimate(one({ bottom: '241' }))), 'Enter a bottom diameter from 1 to 240.');
assert.equal(failure(() => C.estimate(one({ height: '  ' }))), 'Enter the shade height.');
assert.equal(failure(() => C.estimate(one({ height: '8 in' }))), 'Enter the height as a number, such as 8.');
assert.equal(failure(() => C.estimate(one({ height: '1.9' }))), 'Enter a shade height from 2 to 120.');
assert.equal(failure(() => C.estimate(one({ height: '121' }))), 'Enter a shade height from 2 to 120.');
assert.equal(failure(() => C.estimate(one({ seam: '' }))), 'Enter the seam allowance.');
assert.equal(failure(() => C.estimate(one({ seam: '-0.5' }))),
  'Enter the seam allowance as a number, such as 0.5.');
assert.equal(failure(() => C.estimate(one({ seam: '4.5' }))), 'Enter a seam allowance from 0 to 4.');
assert.equal(failure(() => C.estimate(one({ turn: '' }))), 'Enter the edge allowance.');
assert.equal(failure(() => C.estimate(one({ turn: '6.5' }))), 'Enter an edge allowance from 0 to 6.');
assert.equal(failure(() => C.estimate(one({ fabric: '' }))), 'Enter the usable fabric width.');
assert.equal(failure(() => C.estimate(one({ fabric: '5' }))), 'Enter a usable fabric width from 6 to 200.');
assert.equal(failure(() => C.estimate(one({ fabric: '201' }))), 'Enter a usable fabric width from 6 to 200.');
assert.equal(failure(() => C.estimate(one({ shape: 'empire', top: '' }))),
  'Enter the top ring diameter.');
assert.equal(failure(() => C.estimate(one({ shape: 'empire', top: '16' }))),
  'An empire shade needs a top diameter smaller than the bottom diameter.');
assert.equal(failure(() => C.estimate(one({ bottom: '30', fabric: '6', seam: '0', turn: '0' }))),
  'The shade is too wide for this fabric even in 8 panels; use a wider fabric.');
assert.equal(failure(() => C.estimate(one({ bottom: '1e2' }))),
  'Enter the bottom ring diameter as a number, such as 12.');
assert.equal(failure(() => C.estimate(one({ seam: '0.' }))),
  'Enter the seam allowance as a number, such as 0.5.');
assert.equal(failure(() => C.estimate(one({ turn: '.75' }))), null); // a leading dot is a number

// ---- The catalog record and every test case it carries.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record present');
assert.equal(record.name, 'Lampshade Fabric Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.sources.length, 0);
assert.ok(record.method && record.method.length > 400, 'the method explains the model');
assert.equal(record.testCases.length, 27);
for (const testCase of record.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(() => C.estimate(testCase.input)), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = plain(C.estimate(testCase.input));
  const want = testCase.expected;
  for (const key of ['bottomCircumference', 'topCircumference', 'slant', 'panelWidth',
    'panelHeight', 'fabricLength', 'fabricPurchase', 'trimLength']) {
    close(actual[key], want[key], 1e-9, testCase.name + ' ' + key);
  }
  assert.equal(actual.panels, want.panels, testCase.name + ' panels');
  assert.equal(actual.rows, want.rows, testCase.name + ' rows');
}
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2101, 'public tools');

// ---- Page contract: shared shell, labelled controls, one hash-pinnable script.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /\/assets\/style\.css/);
assert.match(html, /<h1>Lampshade Fabric Calculator<\/h1>/);
assert.match(html, /<meta name="description" content="[^"]+">/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /role="alert"/);
assert.match(html, /role="status"/);
assert.match(html, /min-height:44px/);
assert.match(html, /inputmode="decimal"/);
assert.equal(/<a\b[^>]*href="http/.test(html), false, 'no off-site links in the page');
assert.equal(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML/.test(html), false,
  'no network, storage or innerHTML');
for (const id of ['shape', 'fabric', 'top', 'bottom', 'height', 'seam', 'turn', 'unit']) {
  assert.ok(html.includes('for="' + id + '"'), 'label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id);
}
for (const id of ['example', 'shade-err', 'shade-out', 'shade-warn', 'shade-form']) {
  assert.ok(html.includes('id="' + id + '"'), 'element ' + id);
}
assert.equal((html.match(/<button\b[^>]*>/g) || []).every((tag) => /type="(button|submit)"/.test(tag)), true,
  'every button has a type');
assert.equal((html.match(/<script[^>]*src=/g) || []).length, 2, 'theme-init and app.js only');
assert.match(html, /lampshade-fabric-core:start/);

console.log('lampshade fabric calculator: passed');
