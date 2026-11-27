/* Regression checks for the Three-Wire Thread Measurement tool: the catalog
   cases, an independent 60-degree thread model over a grid of metric and
   unified threads, the designation parser, the wire limits, the page contract
   and catalog integrity. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'three-wire-thread-measurement';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* twt-core:start */';
const endMarker = '/* twt-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\.|localStorage|fetch\(|XMLHttpRequest/.test(coreSource), 'the core stays free of DOM, storage and network access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = ThreadWireCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Three-Wire Thread Measurement');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.ok(record.tags.includes('threads') && record.tags.includes('metrology'), 'tags name the domain');
assert.ok(record.aliases.length >= 8, 'aliases cover the search spellings');
assert.ok(record.method.length > 1200, 'method records the arithmetic');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 60, 'guidance states the limits');
assert.equal(record.sources.length, 2, 'two sources');
for (const source of record.sources) {
  assert.match(source.url, /^https:\/\//, 'source has an https URL');
  assert.ok(source.title.length > 80, 'source title is specific');
}
assert.ok(record.sources.some((source) => source.url === 'https://www.engineersedge.com/mechanical,045tolerances/measuring_pitch_diameters_14259.htm'), 'Engineers Edge source');
assert.ok(record.sources.some((source) => source.url === 'https://littlemachineshop.com/instructions/threewiremethod.pdf'), 'LittleMachineShop source');

assert.equal(catalog.tools.length, 2489, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2228, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Mechanical & Structural Engineering').length, 56, 'Mechanical & Structural Engineering count');

// The slug, name, aliases and tags must not be shared with another record.
for (const tool of catalog.tools) {
  if (tool.slug === slug) continue;
  const others = [tool.slug, tool.name, ...(tool.aliases || []), ...(tool.tags || [])].map((value) => value.toLowerCase());
  for (const value of [record.name, ...record.aliases]) {
    assert.ok(!others.includes(value.toLowerCase()), `"${value}" collides with ${tool.slug}`);
  }
}

const failure = (input) => {
  try {
    C.calculate(input);
  } catch (error) {
    return error.message;
  }
  return null;
};

const kinds = { golden: 0, boundary: 0, validation: 0 };
for (const testCase of record.testCases) {
  kinds[testCase.kind] = (kinds[testCase.kind] || 0) + 1;
  if (testCase.kind === 'validation') {
    const message = failure(testCase.input);
    assert.ok(message, `${testCase.name}: expected a refusal`);
    assert.ok(
      message.includes(testCase.expectedError),
      `${testCase.name}: "${message}" does not mention "${testCase.expectedError}"`
    );
    continue;
  }
  const result = C.calculate(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
  if (result.measuredPitchDiameter === null) {
    assert.equal(result.rows.length, 4, `${testCase.name}: four rows without a reading`);
  } else {
    assert.equal(result.rows.length, 6, `${testCase.name}: six rows with a reading`);
  }
}
assert.equal(kinds.golden, 8, 'eight golden cases');
assert.equal(kinds.boundary, 4, 'four boundary cases');
assert.equal(kinds.validation, 12, 'twelve validation cases');
assert.equal(record.testCases.length, 24, 'twenty-four catalog cases');

// ---- Independent model, written from the trigonometry rather than the page. ----
const sqrt3over2 = Math.sqrt(3) / 2;
const cos30 = Math.cos(Math.PI / 6);
function reference(unit, major, pitch, wire) {
  const p = unit === 'mm' ? pitch : 1 / pitch;
  const d = unit === 'mm' ? major : major;
  const best = 0.5 * p / cos30;
  const w = wire == null ? best : wire;
  const d2 = d - 0.75 * sqrt3over2 * p;
  const k = 3 * w - sqrt3over2 * p;
  return { best, w, d2, over: d2 + k, k };
}
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

let checked = 0;
for (let major = 0.5; major <= 200; major += 0.5) {
  for (const pitch of [0.2, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 6]) {
    if (pitch >= major) continue;
    const text = `M${major}x${pitch}`;
    const result = C.calculate({ thread: text });
    const ref = reference('mm', major, pitch, null);
    near(result.pitchDiameter, ref.d2, 0.0006, `${text} pitch diameter`);
    near(result.bestWire, ref.best, 0.0006, `${text} best wire`);
    near(result.overWires, ref.over, 0.0006, `${text} over wires`);
    near(result.constant, ref.k, 0.0006, `${text} constant`);
    assert.ok(result.overWires > major, `${text}: the best wires stand above the crest`);
    checked++;
  }
}
for (const [n, d, tpi] of [[1, 16, 64], [1, 4, 20], [5, 16, 18], [3, 8, 16], [1, 2, 13], [3, 4, 10], [1, 1, 8], [2, 1, 4]]) {
  const text = `${n}/${d}-${tpi}`;
  const major = n / d;
  const result = C.calculate({ thread: text });
  const ref = reference('in', major, tpi, null);
  near(result.pitchDiameter, ref.d2, 0.00006, `${text} pitch diameter`);
  near(result.bestWire, ref.best, 0.00006, `${text} best wire`);
  near(result.overWires, ref.over, 0.00006, `${text} over wires`);
  near(result.constant, ref.k, 0.00006, `${text} constant`);
  checked++;
}
for (let number = 0; number <= 12; number++) {
  for (const tpi of [16, 20, 24, 28, 32, 40, 56, 64, 80]) {
    const major = 0.060 + 0.013 * number;
    if (1 / tpi >= major) continue;
    const text = `#${number}-${tpi}`;
    const result = C.calculate({ thread: text });
    assert.equal(result.major, Number(major.toFixed(4)), `${text}: series diameter`);
    const ref = reference('in', major, tpi, null);
    near(result.overWires, ref.over, 0.00006, `${text} over wires`);
    checked++;
  }
}
assert.ok(checked > 500, `independent model covered ${checked} threads`);

// ---- Inversion: the nominal reading comes back to the basic pitch diameter. ----
for (const text of ['M6x1', 'M10x1.5', 'M30x3.5', '1/4-20 UNC', '#10-24', '3/4-10']) {
  const nominal = C.calculate({ thread: text });
  const dp = nominal.unit === 'mm' ? 3 : 4;
  const back = C.calculate({ thread: text, measured: nominal.overWires.toFixed(dp) });
  assert.equal(back.deviation, 0, `${text}: nominal reading inverts to zero deviation`);
  assert.ok(
    Math.abs(back.measuredPitchDiameter - nominal.pitchDiameter) <= 1.5 * Math.pow(10, -dp),
    `${text}: same pitch diameter within the display rounding`
  );
}

// ---- Designation parsing ----
const same = (a, b) => {
  const left = C.calculate({ thread: a });
  const right = C.calculate({ thread: b });
  assert.equal(left.label, right.label, `${a} vs ${b}: label`);
  assert.equal(left.overWires, right.overWires, `${a} vs ${b}: reading`);
};
same('M6X1', 'M6x1');
same('M6\u00d71', 'M6x1');
same('M6 \u00d7 1', 'M6x1');
same('  m6 x 1 ', 'M6x1');
same('1/4-20 unc', '1/4-20 UNC');
same('1/4 - 20', '1/4-20');
assert.equal(C.calculate({ thread: '1/4-20 UNC' }).pitch, 20);
assert.equal(C.calculate({ thread: '#10-24' }).major, 0.19);
assert.equal(C.calculate({ thread: '0.375-16' }).major, 0.375);
assert.equal(C.calculate({ thread: 'M6,5x1' }).major, 6.5, 'a decimal comma is accepted');
assert.equal(C.calculate({ thread: 'M6x1', measured: '6,230' }).measuredPitchDiameter, 5.364, 'a comma reading');
assert.equal(C.calculate({ thread: 'M6x1', measured: '6.230 mm' }).measuredPitchDiameter, 5.364, 'a matching unit is accepted');
assert.equal(C.calculate({ thread: '1/4-20', measured: '0.2608 in' }).measuredPitchDiameter, 0.2175, 'inches are accepted for a unified thread');
assert.equal(C.calculate({ thread: 'M6x1', measured: '6.230 mm', wire: '0.577 mm' }).overWires, 6.215, 'the wire may carry its unit, and a 0.0004 mm wire error moves the reading about 0.001 mm');

// ---- Refusals for values the page must not guess at ----
const refusals = [
  [{ thread: 'M6x1', measured: 'abc' }, 'as a number'],
  [{ thread: 'M6x1', measured: '6.23 in' }, 'millimetres'],
  [{ thread: '1/4-20', wire: '0.06 mm' }, 'inches'],
  [{ thread: 'M6x1', measured: '0' }, 'greater than zero'],
  [{ thread: 'M6x1', measured: '6.23', wire: '0' }, 'greater than zero'],
  [{ thread: 'M6x1', measured: '1e3' }, 'as a number'],
  [{ thread: 'M6x1', measured: '\uff16\uff0e\uff12\uff13' }, 'as a number'],
  [{ thread: 'M6\u00d7\u00d71' }, 'Enter a metric thread'],
  [{ thread: '#-24' }, 'Enter a metric thread'],
  [{ thread: '1/4-20 UNC 2A' }, 'Enter a metric thread'],
  [{ thread: 'M6x-1' }, 'Enter a metric thread'],
];
for (const [input, expected] of refusals) {
  const message = failure(input);
  assert.ok(message, `${JSON.stringify(input)} should be refused`);
  assert.ok(message.includes(expected), `${JSON.stringify(input)}: "${message}" does not mention "${expected}"`);
}

// ---- Wire seating limits ----
for (const [text, pitchMm] of [['M6x1', 1], ['M10x1.5', 1.5], ['1/4-20', 0.05 * 25.4], ['#10-24', 25.4 / 24]]) {
  const unit = text.startsWith('M') ? 'mm' : 'in';
  const limit = unit === 'mm' ? 0.8660254 * pitchMm : 0.8660254 * pitchMm / 25.4;
  const inside = limit * 0.999;
  const result = C.calculate({ thread: text, wire: inside.toFixed(unit === 'mm' ? 4 : 5) });
  assert.ok(result.wire < limit, `${text}: a wire just under the limit is accepted`);
  assert.ok(failure({ thread: text, wire: (limit * 1.0005).toFixed(unit === 'mm' ? 4 : 5) }), `${text}: a wire at the limit is refused`);
}

// ---- Page contract ----
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
assert.equal((markup.match(/<h1\b/g) || []).length, 1, 'one h1');
assert.match(markup, /<form id="twt-form" novalidate>/, 'the form is present');
assert.match(markup, /aria-live="polite"/, 'the result is annunciated');
assert.match(markup, /<label for="thread">/, 'the thread field is labelled');
assert.match(markup, /<label for="measured">/, 'the reading field is labelled');
assert.match(markup, /<label for="wire">/, 'the wire field is labelled');
assert.match(markup, /min-height:46px/, 'the button is touch sized');
assert.ok(!/https?:\/\//.test(html), 'the page makes no external reference');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'nothing is stored');
assert.ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon/.test(html), 'nothing is sent');
assert.ok(html.includes('id="site-header"') && html.includes('/assets/app.js'), 'shared header and app script');

// Rounding follows the unit: 0.001 mm or 0.0001 in.
const metricDecimal = C.calculate({ thread: 'M6x1' }).overWires.toString().split('.')[1].length;
assert.ok(metricDecimal <= 3, 'metric results carry at most three decimals');
const inchDecimal = C.calculate({ thread: '1/4-20' }).overWires.toString().split('.')[1].length;
assert.ok(inchDecimal <= 4, 'inch results carry at most four decimals');

console.log(`three-wire thread measurement: ${record.testCases.length} catalog cases and ${checked} modelled threads pass`);
