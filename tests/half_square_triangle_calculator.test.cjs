/* Regression checks for the half-square triangle cutting core, its catalog cases
   and the geometry the closed-form cut size is derived from. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/half-square-triangle-calculator/index.html'), 'utf8');
const start = html.indexOf('/* hst-core:start */');
const end = html.indexOf('/* hst-core:end */');
assert.ok(start > -1 && end > start, 'hst core markers missing');
const core = html.slice(start, end + '/* hst-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = HstCore;', sandbox);
const C = sandbox.module.exports;
const run = (input) => C.calculate(input);
const near = (actual, expected, label, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${label}: expected ${expected}, got ${actual}`);
};

// The default plan: two-at-a-time 2 in units from 2 7/8 in squares.
const base = run({});
assert.equal(base.units, 'in');
assert.equal(base.method, 2);
assert.equal(base.finished, 2);
assert.equal(base.seamAllowance, 0.25);
near(base.offset, 0.25 * (2 + Math.SQRT2), 'offset');
near(base.cutSquare, 2 + 0.25 * (2 + Math.SQRT2), 'exact cut');
assert.equal(base.cutSquareRounded, 2.875);
assert.equal(base.trimSize, 2.5);
near(base.diagonal, 2.875 * Math.SQRT2, 'diagonal');
assert.equal(base.pairs, 4);
assert.equal(base.squares, 8);
assert.equal(base.hstsMade, 8);
assert.equal(base.spareHsts, 0);

// Independent geometric reference: build the cut piece, offset every edge inward
// by the seam allowance, intersect the offset lines and read the finished leg
// back off the resulting triangle. Then bisect the starting square for a target
// finished size and compare with the core's closed form.
const pieces = {
  2: (s) => [[0, 0], [s, 0], [0, s]],
  4: (s) => [[0, 0], [s / 2, s / 2], [s / 2, -s / 2]],
  8: (s) => [[0, 0], [s / 2, 0], [s / 2, s / 2]]
};
const centroid = (v) => [
  v.reduce((sum, p) => sum + p[0], 0) / v.length,
  v.reduce((sum, p) => sum + p[1], 0) / v.length
];
const normalizedLine = (p, q) => {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  // a*x + b*y = c with (a, b) the unit normal of the edge.
  const a = -dy / len;
  const b = dx / len;
  return { a, b, c: a * p[0] + b * p[1] };
};
const offsetInward = (p, q, inner, d) => {
  const line = normalizedLine(p, q);
  const sign = line.a * inner[0] + line.b * inner[1] - line.c > 0 ? 1 : -1;
  return { a: line.a, b: line.b, c: line.c + sign * d };
};
const intersect = (l1, l2) => {
  const det = l1.a * l2.b - l2.a * l1.b;
  assert.ok(Math.abs(det) > 1e-12, 'parallel offset lines');
  return [(l1.c * l2.b - l2.c * l1.b) / det, (l1.a * l2.c - l2.a * l1.c) / det];
};
const finishedLeg = (method, s, d) => {
  const v = pieces[method](s);
  const inner = centroid(v);
  const lines = [
    offsetInward(v[0], v[1], inner, d),
    offsetInward(v[1], v[2], inner, d),
    offsetInward(v[2], v[0], inner, d)
  ];
  const pts = [intersect(lines[0], lines[1]), intersect(lines[1], lines[2]), intersect(lines[2], lines[0])];
  const sides = [0, 1, 2].map((i) => Math.hypot(pts[(i + 1) % 3][0] - pts[i][0], pts[(i + 1) % 3][1] - pts[i][1])).sort((a, b) => a - b);
  // Right isosceles triangle: the two equal short sides are the legs.
  near(sides[0], sides[1], `method ${method} leg symmetry`, 1e-9);
  near(sides[2], sides[0] * Math.SQRT2, `method ${method} hypotenuse`, 1e-9);
  return sides[0];
};
const solveSquare = (method, target, d) => {
  let lo = target;
  let hi = target * 4 + 10;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (finishedLeg(method, mid, d) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};
let geometryCases = 0;
for (const method of [2, 4, 8]) {
  for (const finished of [0.5, 1, 1.75, 2, 2.5, 3, 4, 6]) {
    for (const allowance of [0.2, 0.25, 0.375]) {
      const solved = solveSquare(method, finished, allowance);
      const result = run({ method, finished, seamAllowance: allowance, quantity: method });
      near(result.cutSquare, solved, `geometry ${method}-at-a-time ${finished} in at ${allowance}`, 1e-7);
      near(result.trimSize, finished + 2 * allowance, 'trim size');
      geometryCases += 1;
    }
  }
}

// Published cutting rules agree with the exact figure once rounded to an eighth:
// finished + 7/8 for two at a time, scaled by sqrt(2) and 2 for the batch methods.
const eighthUp = (value) => Math.ceil(value * 8 - 1e-9) / 8;
for (const finished of [0.5, 1, 1.25, 1.5, 2, 2.25, 2.5, 3, 3.5, 4, 5, 6, 8, 10]) {
  const two = run({ method: 2, finished, quantity: 2 }).cutSquareRounded;
  assert.equal(two, eighthUp(finished + 0.875), `2-at-a-time chart rule at ${finished} in`);
  for (const method of [4, 8]) {
    const result = run({ method, finished, quantity: method });
    const shortcut = eighthUp(method === 4 ? (finished + 0.875) * Math.SQRT2 : 2 * (finished + 0.875));
    assert.ok(result.cutSquareRounded <= shortcut + 1e-9,
      `method ${method} at ${finished} in must not exceed the published shortcut`);
    assert.ok(shortcut - result.cutSquareRounded <= 0.125 + 1e-9,
      `method ${method} at ${finished} in is within one eighth of the shortcut`);
  }
}

// Rounding only ever grows the exact figure, by less than one grid step.
for (const units of ['in', 'cm']) {
  const grid = units === 'in' ? 8 : 10;
  const allowance = units === 'in' ? 0.25 : 0.635;
  for (const method of [2, 4, 8]) {
    for (let finished = units === 'in' ? 0.25 : 0.635; finished <= (units === 'in' ? 20 : 50); finished += units === 'in' ? 0.125 : 0.5) {
      const result = run({ units, method, finished, seamAllowance: allowance, quantity: 4 });
      assert.ok(result.cutSquareRounded >= result.cutSquare - 1e-9, 'rounded cut is never smaller');
      assert.ok(result.cutSquareRounded - result.cutSquare < 1 / grid + 1e-9, 'rounded cut is below one step');
      near(result.roundingSlack, result.cutSquareRounded - result.cutSquare, 'rounding slack');
      const back = units === 'in' ? result.cutSquareOther / 2.54 : result.cutSquareOther * 2.54;
      assert.ok(Math.abs(back - result.cutSquareRounded) < 1e-9, 'unit conversion round trip');
    }
  }
}

// Batch arithmetic: pairs, squares, units made and spares stay consistent.
for (const method of [2, 4, 8]) {
  for (let quantity = 1; quantity <= 40; quantity += 1) {
    const result = run({ method, quantity });
    assert.equal(result.pairs, Math.ceil(quantity / method), 'pairs');
    assert.equal(result.squares, result.pairs * 2, 'squares are two per pair');
    assert.equal(result.hstsMade, result.pairs * method, 'units made');
    assert.equal(result.spareHsts, result.hstsMade - quantity, 'spare units');
    assert.ok(result.spareHsts >= 0 && result.spareHsts < method, 'spares stay below one batch');
    near(result.totalArea, result.areaPerSquare * result.squares, 'total area');
  }
}

// Units convert both ways and switching mid-plan is symmetric.
const metric = run({ units: 'cm', finished: 5, seamAllowance: 0.635, method: 2, quantity: 6 });
near(metric.cutSquare, 5 + 0.635 * (2 + Math.SQRT2), 'metric exact cut');
assert.equal(metric.cutSquareRounded, 7.2);
near(metric.cutSquareOther, 7.2 / 2.54, 'metric to inch conversion');
const imperial = run({ units: 'in', finished: 5 / 2.54, seamAllowance: 0.25, method: 2, quantity: 6 });
near(imperial.cutSquare, metric.cutSquare / 2.54, 'same plan in inches', 1e-9);

// Inclusive bounds at both ends of every range.
const bottom = run({ finished: 0.25, seamAllowance: 0.1, quantity: 1, method: 2 });
assert.equal(bottom.cutSquareRounded, 0.625);
const top = run({ finished: 60, seamAllowance: 1, quantity: 2000, method: 8 });
assert.equal(top.cutSquareRounded, 126.875);
assert.equal(top.squares, 500);
const metricTop = run({ units: 'cm', finished: 152.4, seamAllowance: 2.54, quantity: 8, method: 2 });
assert.ok(metricTop.cutSquareRounded > 152.4);

// Bad input fails with an actionable message, never a silent default.
assert.throws(() => run({ units: 'mm' }), /Choose inches or centimetres\./);
assert.throws(() => run({ method: 3 }), /Choose 2, 4 or 8 half-square triangles at a time\./);
assert.throws(() => run({ method: 'two' }), /Choose 2, 4 or 8 half-square triangles at a time\./);
assert.throws(() => run({ finished: '' }), /Finished HST size is required\./);
assert.throws(() => run({ finished: 'two' }), /Finished HST size must be a number from 0.25 to 60 in\./);
assert.throws(() => run({ finished: 0.24 }), /Finished HST size must be a number from 0.25 to 60 in\./);
assert.throws(() => run({ finished: 60.01 }), /Finished HST size must be a number from 0.25 to 60 in\./);
assert.throws(() => run({ units: 'cm', finished: 0.6 }), /Finished HST size must be a number from 0.635 to 152.4 cm\./);
assert.throws(() => run({ seamAllowance: 0 }), /Seam allowance must be a number from 0.1 to 1 in\./);
assert.throws(() => run({ seamAllowance: 1.01 }), /Seam allowance must be a number from 0.1 to 1 in\./);
assert.throws(() => run({ units: 'cm', seamAllowance: 2.55 }), /Seam allowance must be a number from 0.254 to 2.54 cm\./);
assert.throws(() => run({ quantity: '' }), /HSTs needed is required\./);
assert.throws(() => run({ quantity: '6.5' }), /HSTs needed must be a whole number from 1 to 2000\./);
assert.throws(() => run({ quantity: 0 }), /HSTs needed must be a whole number from 1 to 2000\./);
assert.throws(() => run({ quantity: 2001 }), /HSTs needed must be a whole number from 1 to 2000\./);
assert.throws(() => run({ finished: '-2' }), /Finished HST size must be a number/);
assert.throws(() => run({ finished: '1e3' }), /Finished HST size must be a number/);

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html.replace(/https:\/\/virt\.tools[^"]*/g, '')), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === 'half-square-triangle-calculator');
assert.ok(record, 'catalog record missing');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.testCases.length >= 17, 'catalog has the full test case set');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 8, 'eight validation cases');
assert.ok(record.method.includes('browser'), 'method documents local execution');
for (const testCase of record.testCases) {
  const options = { ...C.DEFAULTS, ...testCase.input };
  if (testCase.kind === 'validation') {
    assert.throws(
      () => C.calculate(options),
      new RegExp(testCase.expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = C.calculate(options);
  for (const [key, value] of Object.entries(testCase.expected)) {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      assert.ok(Math.abs(result[key] - value) < 1e-9, testCase.name + ' ' + key);
    } else {
      assert.equal(result[key], value, testCase.name + ' ' + key);
    }
  }
}

console.log('half-square-triangle-calculator: all checks passed ('
  + record.testCases.length + ' catalog cases, ' + geometryCases + ' geometry reference cases)');
