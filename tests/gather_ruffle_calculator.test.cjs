/* Regression checks for the gather & ruffle calculator: every catalog case is
   replayed against the page core, then the strip arithmetic is checked as a
   property (whole strips always cover the cut length, one fewer does not),
   the fullness bands and the unit handling are pinned, and the page's offline
   and accessible contract is asserted. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'gather-ruffle-calculator';
const file = path.join(root, 'frontend/tools', slug, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const start = html.indexOf('/* gather-core:start */');
const end = html.indexOf('/* gather-core:end */');
assert.ok(start > -1 && end > start, 'gather core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = GatherCore;', sandbox);
const G = sandbox.module.exports;

const plan = (input) => G.plan(input);
const failure = (input) => {
  try {
    plan(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

function base(overrides) {
  return Object.assign({ unit: 'in', length: '40', ratio: '2', width: '44', allowance: '0.5', sections: '4' }, overrides || {});
}

// Display rounding is half up at the second decimal, applied to the raw
// (unrounded) fabric so the section rows always share the same total.
const round2 = (value) => Math.floor(value * 100 + 0.5) / 100;

// The default ruffle, worked out by hand: 40 x 2 + 2 x 0.5 = 81 inches of
// fabric, 40 inches of take-up, 81 / 44 = 1.84 strips so two strips, and each
// strip averages 40.5 inches.
const standard = plan(base());
assert.equal(standard.unit, 'in');
assert.equal(standard.otherUnit, 'cm');
assert.equal(standard.cut, 81);
assert.equal(standard.takeUp, 40);
assert.equal(standard.strips, 2);
assert.equal(standard.perStrip, 40.5);
assert.equal(standard.converted, 205.74);
assert.equal(standard.band, 'medium');
assert.equal(standard.sections, 4);
assert.deepEqual(JSON.parse(JSON.stringify(standard.rows)), [
  { index: 1, span: 10, fabric: 20.25 },
  { index: 2, span: 10, fabric: 20.25 },
  { index: 3, span: 10, fabric: 20.25 },
  { index: 4, span: 10, fabric: 20.25 },
]);

// An exact fit stays one strip; a quarter of an inch over it does not.
assert.equal(plan(base({ length: '20', ratio: '2', allowance: '1', width: '42' })).strips, 1);
assert.equal(plan(base({ length: '20', ratio: '2', allowance: '1.0625', width: '42' })).strips, 2);

// Every strip count covers the cut length, and one fewer always falls short.
const lengths = ['1', '2.5', '7.5', '19.9', '40', '61.25', '120', '333', '500'];
const ratios = ['1.1', '1.25', '1.5', '1.99', '2', '2.5', '2.99', '3', '4'];
const allowances = ['0', '0.25', '0.5', '0.625', '1', '2.5', '12'];
const widths = ['1', '5', '20', '42', '44', '60', '120'];
const sectionCounts = ['1', '2', '3', '4', '6', '8'];
let grids = 0;
for (const length of lengths) {
  for (const ratio of ratios) {
    for (const allowance of allowances) {
      for (const width of widths) {
        for (const sections of sectionCounts) {
          const result = plan(base({ length, ratio, allowance, width, sections }));
          const fabric = Number(length) * Number(ratio) + Number(allowance) * 2;
          assert.ok(result.strips >= 1, 'at least one strip');
          assert.ok(result.strips * Number(width) >= result.cut - 0.005,
            'strips must cover the cut length ' + JSON.stringify({ length, ratio, allowance, width }));
          assert.ok((result.strips - 1) * Number(width) < result.cut + 0.005,
            'one fewer strip must fall short ' + JSON.stringify({ length, ratio, allowance, width }));
          assert.ok(Math.abs(result.perStrip * result.strips - fabric) <= 0.005 * result.strips + 0.005,
            'per-strip average must rebuild the cut length');
          assert.ok(Math.abs(result.takeUp - (Number(length) * Number(ratio) - Number(length))) < 0.0051,
            'take-up must be the gathered fabric minus the edge');
          assert.equal(result.rows.length, Number(sections), 'a row per section');
          assert.equal(result.rows[0].index, 1);
          assert.equal(result.rows[result.rows.length - 1].index, Number(sections));
          for (const row of result.rows) {
            assert.equal(row.fabric, round2(fabric / Number(sections)), 'section fabric');
            assert.equal(row.span, round2(Number(length) / Number(sections)), 'section span');
          }
          assert.ok(Math.abs(result.converted - result.cut * 2.54) <= 0.018, 'inch to centimetre conversion');
          assert.ok(fabric > 0);
          grids += 1;
        }
      }
    }
  }
}

// Centimetres are the same arithmetic with the fields relabelled.
const metric = plan({ unit: 'cm', length: '100', ratio: '1.5', width: '44', allowance: '1', sections: '2' });
assert.equal(metric.unit, 'cm');
assert.equal(metric.otherUnit, 'in');
assert.equal(metric.cut, 152);
assert.equal(metric.takeUp, 50);
assert.equal(metric.strips, 4);
assert.equal(metric.perStrip, 38);
assert.equal(metric.converted, 59.84);
assert.deepEqual(JSON.parse(JSON.stringify(metric.rows)), [
  { index: 1, span: 50, fabric: 76 },
  { index: 2, span: 50, fabric: 76 },
]);
const twin = plan({ unit: 'in', length: '100', ratio: '1.5', width: '44', allowance: '1', sections: '2' });
for (const field of ['cut', 'takeUp', 'strips', 'perStrip', 'band', 'sections']) {
  assert.equal(twin[field], metric[field], 'unit-free field ' + field);
}

// Fullness bands, at and either side of every threshold.
assert.equal(G.bandOf(1.1), 'soft');
assert.equal(G.bandOf(1.4999), 'soft');
assert.equal(G.bandOf(1.5), 'medium');
assert.equal(G.bandOf(2), 'medium');
assert.equal(G.bandOf(2.4999), 'medium');
assert.equal(G.bandOf(2.5), 'full');
assert.equal(G.bandOf(2.9999), 'full');
assert.equal(G.bandOf(3), 'very full');
assert.equal(G.bandOf(4), 'very full');

// Refusals name the field and the range, including the metric ranges.
assert.equal(failure(base({ length: '' })), 'Finished length must be a number from 1 to 500 in.');
assert.equal(failure(base({ length: 'forty' })), 'Finished length must be a number from 1 to 500 in.');
assert.equal(failure(base({ length: '-10' })), 'Finished length must be a number from 1 to 500 in.');
assert.equal(failure(base({ length: '501' })), 'Finished length must be a number from 1 to 500 in.');
assert.equal(failure(base({ unit: 'cm', length: '2' })), 'Finished length must be a number from 2.5 to 1270 cm.');
assert.equal(failure(base({ ratio: '1' })), 'Gather ratio must be a number from 1.1 to 4.');
assert.equal(failure(base({ ratio: '4.5' })), 'Gather ratio must be a number from 1.1 to 4.');
assert.equal(failure(base({ ratio: '2e0' })), 'Gather ratio must be a number from 1.1 to 4.');
assert.equal(failure(base({ width: '0' })), 'Usable fabric width must be a number from 1 to 120 in.');
assert.equal(failure(base({ width: '121' })), 'Usable fabric width must be a number from 1 to 120 in.');
assert.equal(failure(base({ unit: 'cm', width: '2' })), 'Usable fabric width must be a number from 2.5 to 305 cm.');
assert.equal(failure(base({ allowance: '13' })), 'Seam allowance must be a number from 0 to 12 in.');
assert.equal(failure(base({ allowance: '-0.5' })), 'Seam allowance must be a number from 0 to 12 in.');
assert.equal(failure(base({ sections: '0' })), 'Sections must be a whole number from 1 to 8.');
assert.equal(failure(base({ sections: '9' })), 'Sections must be a whole number from 1 to 8.');
assert.equal(failure(base({ sections: '4.5' })), 'Sections must be a whole number from 1 to 8.');
assert.equal(failure(base({ sections: '' })), 'Sections must be a whole number from 1 to 8.');
assert.equal(failure(base({ unit: 'yd' })), 'Choose inches or centimetres.');
assert.equal(failure(base({ unit: undefined })), 'Choose inches or centimetres.');
assert.equal(failure(base({ length: '1e3' })), 'Finished length must be a number from 1 to 500 in.');
assert.equal(failure(base({ length: '  ' })), 'Finished length must be a number from 1 to 500 in.');

// Whitespace and leading zeros are read, not rejected.
assert.equal(plan(base({ length: ' 040 ', ratio: ' 2.00 ' })).cut, 81);

// Catalog cases ship with the page and must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.category, 'Crafts & Hobbies');
assert.equal(entry.subcategory, 'Estimation & calculation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must describe the arithmetic');
assert.ok(entry.testCases.length >= 30, 'expected at least thirty catalog cases');
const kinds = new Set(entry.testCases.map((testCase) => testCase.kind));
for (const kind of ['golden', 'boundary', 'validation']) assert.ok(kinds.has(kind), 'missing ' + kind + ' case');
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
  } else {
    const result = plan(testCase.input);
    for (const [field, value] of Object.entries(testCase.expected)) {
      assert.equal(JSON.stringify(result[field]), JSON.stringify(value), testCase.name + ' ' + field);
    }
  }
}

// The page stays self-contained and offline.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|sendBeacon/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/gi, '')), 'no inline event handlers');
assert.ok(html.includes('<form id="gather-form"'), 'page form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
for (const id of ['unit', 'length', 'ratio', 'width', 'allowance', 'sections']) {
  assert.ok(html.includes('id="' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="' + id + '"'), 'label ' + id + ' missing');
}
for (const id of ['length', 'ratio', 'width', 'allowance']) {
  assert.ok(html.includes('aria-describedby="' + id + '-hint"'), 'help reference ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('<h1>Gather &amp; Ruffle Calculator</h1>'), 'heading missing');
assert.ok(html.includes('href="/">← All tools</a>'), 'back link missing');
assert.ok(html.includes('name="viewport"'), 'viewport meta missing');

console.log('Gather & ruffle calculator: ' + entry.testCases.length + ' catalog cases and '
  + grids + ' strip/unit grids passed');
