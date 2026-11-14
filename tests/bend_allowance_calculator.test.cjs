/* Regression checks for the sheet metal bend allowance core, page contract and catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/bend-allowance-calculator/index.html'), 'utf8');
const start = html.indexOf('/* bend-allowance-core:start */');
const end = html.indexOf('/* bend-allowance-core:end */');
assert.ok(start > -1 && end > start, 'bend allowance core markers missing');
const core = html.slice(start, end + '/* bend-allowance-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = BendAllowanceCore;', sandbox);
const C = sandbox.module.exports;

const base = { units: 'mm', thickness: '2', radius: '2', angle: '90', kFactor: '0.44', leg1: '50', leg2: '30' };
const plan = (overrides = {}) => C.build({ ...base, ...overrides });
const rejected = (overrides, pattern) => assert.throws(() => plan(overrides), pattern);

// The default 90 degree bend in 2 mm sheet with K = 0.44.
const standard = plan();
assert.equal(standard.units, 'mm');
assert.equal(standard.thickness, 2);
assert.equal(standard.radius, 2);
assert.equal(standard.angle, 90);
assert.equal(standard.kFactor, 0.44);
assert.ok(Math.abs(standard.neutralRadius - 2.88) < 1e-12);
assert.ok(Math.abs(standard.allowance - 4.524) < 1e-12);
assert.equal(standard.setback, 4);
assert.ok(Math.abs(standard.deduction - 3.476) < 1e-12);
assert.ok(Math.abs(standard.flatLength - 76.524) < 1e-12);
assert.equal(standard.minimumLeg, 4);
assert.equal(standard.warnings.length, 0);
assert.equal(C.summary(standard), 'Bend allowance 4.524 mm · outside setback 4 mm · bend deduction 3.476 mm');

// The neutral-axis position moves the allowance but not the setback.
const low = plan({ kFactor: '0' });
assert.equal(low.neutralRadius, 2);
assert.ok(Math.abs(low.allowance - 3.142) < 1e-12);
assert.equal(low.setback, 4);
assert.ok(Math.abs(low.deduction - 4.858) < 1e-12);
assert.ok(Math.abs(low.flatLength - 75.142) < 1e-12);
const high = plan({ kFactor: '0.5' });
assert.equal(high.neutralRadius, 3);
assert.ok(Math.abs(high.allowance - 4.712) < 1e-12);
assert.equal(high.setback, 4);
assert.ok(Math.abs(high.flatLength - 76.712) < 1e-12);

// A 45 degree bend in inch units: labels only, no conversion.
const inch = C.build({ units: 'in', thickness: '0.1', radius: '0.1', angle: '45', kFactor: '0.44', leg1: '4', leg2: '3' });
assert.equal(inch.units, 'in');
assert.ok(Math.abs(inch.neutralRadius - 0.144) < 1e-12);
assert.ok(Math.abs(inch.allowance - 0.113) < 1e-12);
assert.ok(Math.abs(inch.setback - 0.083) < 1e-12);
assert.ok(Math.abs(inch.deduction - 0.053) < 1e-12);
assert.ok(Math.abs(inch.flatLength - 6.947) < 1e-12);

// An obtuse bend grows the setback and the deduction.
const obtuse = C.build({ units: 'mm', thickness: '3', radius: '6', angle: '135', kFactor: '0.5', leg1: '120', leg2: '90' });
assert.ok(Math.abs(obtuse.allowance - 17.671) < 1e-12);
assert.ok(Math.abs(obtuse.setback - 21.728) < 1e-12);
assert.ok(Math.abs(obtuse.deduction - 25.784) < 1e-12);
assert.ok(Math.abs(obtuse.flatLength - 184.216) < 1e-12);

// Decimal commas are accepted wherever a number is expected.
const comma = plan({ thickness: '2,5', radius: '2,5', kFactor: '0,44' });
assert.equal(comma.thickness, 2.5);
assert.equal(comma.radius, 2.5);
assert.equal(comma.kFactor, 0.44);
assert.equal(C.fmt(4), '4');
assert.equal(C.fmt(0.5), '0.5');
assert.equal(C.fmt(76.524), '76.524');
assert.equal(C.fmt(0), '0');
assert.equal(C.fmt(100), '100');
assert.equal(C.fmt(-9138.28), '-9138.28');

// Boundaries: the shortest legal leg, a zero radius, the smallest and largest angles.
const shortest = plan({ leg1: '4', leg2: '4' });
assert.equal(shortest.minimumLeg, 4);
assert.ok(Math.abs(shortest.flatLength - 4.524) < 1e-12);
const sharp = plan({ radius: '0', leg1: '30', leg2: '12' });
assert.ok(Math.abs(sharp.allowance - 1.382) < 1e-12);
assert.equal(sharp.setback, 2);
assert.equal(sharp.warnings.length, 1);
assert.match(sharp.warnings[0], /inside radius is smaller than the material thickness/);
const shallow = plan({ angle: '0.1' });
assert.ok(Math.abs(shallow.allowance - 0.005) < 1e-12);
assert.ok(Math.abs(shallow.flatLength - 79.998) < 1e-12);
const steep = plan({ angle: '179.9', leg1: '9000', leg2: '6000' });
assert.ok(Math.abs(steep.setback - 4583.661) < 1e-12);
assert.match(steep.warnings.join(' '), /179\.9 degrees almost folds the sheet/);

// A 165 degree bend warns; 150 degrees does not.
assert.match(plan({ angle: '165', leg1: '100', leg2: '80' }).warnings.join(' '), /165 degrees/);
assert.equal(JSON.stringify(plan({ angle: '150', leg1: '100', leg2: '80' }).warnings), '[]');
assert.equal(JSON.stringify(plan({ thickness: '3', radius: '3', angle: '90' }).warnings), '[]');

// Inputs are refused with the exact reason.
rejected({ thickness: '' }, /^Error: Material thickness is required\.$/);
rejected({ thickness: '   ' }, /^Error: Material thickness is required\.$/);
rejected({ thickness: '0' }, /^Error: Material thickness must be between 0\.001 and 100 mm\.$/);
rejected({ thickness: '100.5' }, /^Error: Material thickness must be between 0\.001 and 100 mm\.$/);
rejected({ thickness: '1e3' }, /^Error: Material thickness must be a number between 0\.001 and 100 mm\.$/);
rejected({ radius: '-2' }, /^Error: Inside bend radius must be a number between 0 and 500 mm\.$/);
rejected({ radius: '501' }, /^Error: Inside bend radius must be between 0 and 500 mm\.$/);
rejected({ angle: '180' }, /^Error: Bend angle must be between 0\.1 and 179\.9 degrees\.$/);
rejected({ angle: '0' }, /^Error: Bend angle must be between 0\.1 and 179\.9 degrees\.$/);
rejected({ kFactor: '0.6' }, /^Error: K-factor must be between 0 and 0\.5\.$/);
rejected({ kFactor: 'abc' }, /^Error: K-factor must be a number between 0 and 0\.5\.$/);
rejected({ leg1: '3.9' }, /^Error: Leg 1 must be at least 4 mm \(inside radius plus thickness\) to clear the bend\.$/);
rejected({ leg2: '3.9' }, /^Error: Leg 2 must be at least 4 mm \(inside radius plus thickness\) to clear the bend\.$/);
rejected({ leg1: '50 mm' }, /^Error: Leg 1 must be a number between 0 and 100000 mm\.$/);
rejected({ angle: '179.9', leg1: '10', leg2: '10' },
  /^Error: The legs are too short for this bend: the flat length would be -9138\.28 mm\.$/);

// Unknown units fall back to millimetres rather than silently converting.
assert.equal(plan({ units: 'cm' }).units, 'mm');
assert.equal(C.limits.angle[1], 179.9);

// Page contract: shared shell, labelled controls, no inline handlers or external requests.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style.css"/);
assert.match(html, /src="\/assets\/app\.js"/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /<div id="site-footer"><\/div>/);
assert.match(html, /<main>/);
assert.match(html, /<h1>[^<]+<\/h1>/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /element\("div", "table-wrap"\)/);
assert.match(html, /element\("table", "values"\)/);
assert.doesNotMatch(html, /\son[a-z]+=/i);
assert.doesNotMatch(html, /https?:\/\//);
for (const id of ['in-units', 'in-thickness', 'in-radius', 'in-angle', 'in-k', 'in-leg1', 'in-leg2']) {
  assert.match(html, new RegExp(`<label for="${id}">`), `${id} label`);
  assert.match(html, new RegExp(`id="${id}"`), `${id} control`);
}

// Deterministic cross-check: an independent tangent construction for the flat length.
let seed = 20261114;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (min, max, dp) => {
  const factor = 10 ** dp;
  return Math.round((min + rand() * (max - min)) * factor) / factor;
};
let checked = 0;
for (let i = 0; i < 400; i += 1) {
  const thickness = pick(0.05, 12, 3);
  const radius = pick(0, 20, 3);
  const angle = pick(5, 175, 2);
  const kFactor = pick(0, 0.5, 3);
  const minimumLeg = radius + thickness;
  const leg1 = Math.round((minimumLeg + rand() * 200) * 1000) / 1000;
  const leg2 = Math.round((minimumLeg + rand() * 200) * 1000) / 1000;
  const theta = angle * Math.PI / 180;
  const tangency = (leg1 - (radius + thickness) * Math.tan(theta / 2))
    + (leg2 - (radius + thickness) * Math.tan(theta / 2))
    + theta * (radius + kFactor * thickness);
  const input = {
    units: 'mm', thickness: String(thickness), radius: String(radius), angle: String(angle),
    kFactor: String(kFactor), leg1: String(leg1), leg2: String(leg2),
  };
  let result;
  try { result = C.build(input); } catch (error) {
    assert.ok(tangency <= 0, `refused a valid part: ${JSON.stringify(input)}`);
    continue;
  }
  assert.ok(Math.abs(result.flatLength - tangency) < 2e-3, `flat length for ${JSON.stringify(input)}`);
  assert.ok(Math.abs(result.deduction - (2 * (radius + thickness) * Math.tan(theta / 2) - theta * (radius + kFactor * thickness))) < 2e-3);
  assert.equal(result.flatLength, Math.round(result.flatLength * 1000) / 1000);
  checked += 1;
}
assert.ok(checked > 300, `checked only ${checked} valid parts`);

// Catalog integrity and recorded cases.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
assert.equal(catalog.tools.length, 2267, 'catalog total');
const record = catalog.tools.find((tool) => tool.slug === 'bend-allowance-calculator');
assert.ok(record, 'catalog record');
assert.equal(record.name, 'Sheet Metal Bend Allowance Calculator');
assert.equal(record.category, 'Mechanical & Structural Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'moderate');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.ok(record.tags.includes('mechanical-&-structural-engineering'));
assert.ok(record.tags.includes('estimation-calculation'));
assert.ok(record.method.length > 400);
assert.equal(record.testCases.length, 25);
assert.equal(catalog.tools.filter((tool) => tool.category === record.category).length, 44, 'Mechanical count');

const names = new Map();
for (const tool of catalog.tools) {
  if (tool.slug === record.slug) continue;
  for (const value of [tool.slug, tool.name, ...(tool.aliases || [])]) {
    names.set(String(value).toLowerCase(), tool.slug);
  }
}
for (const value of [record.slug, record.name, ...record.aliases]) {
  assert.equal(names.get(String(value).toLowerCase()), undefined, `duplicate name or alias: ${value}`);
}
assert.ok(fs.existsSync(path.join(root, 'frontend/tools', record.slug, 'index.html')));

const fields = ['neutralRadius', 'allowance', 'setback', 'deduction', 'flatLength'];
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.build(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, testCase.name);
      return true;
    });
    continue;
  }
  const result = C.build(testCase.input);
  for (const field of fields) {
    assert.ok(Math.abs(result[field] - testCase.expected[field]) < 1e-9, `${testCase.name}: ${field}`);
  }
  assert.equal(JSON.stringify(result.warnings), JSON.stringify(testCase.expected.warnings), `${testCase.name}: warnings`);
}

console.log('bend allowance calculator checks passed');
