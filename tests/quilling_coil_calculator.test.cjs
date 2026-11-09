/* Regression checks for the quilling coil core, published anchors, catalog
   vectors and the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'quilling-coil-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* quilling-coil-core:start */';
const endMarker = '/* quilling-coil-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'quilling coil core markers missing');
const core = html.slice(start, end + endMarker.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = QuillingCoilCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const plan = (options) => plain(C.plan(options));
const failure = (options) => {
  try { plan(options); } catch (error) { return error.message; }
  return null;
};
const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label || 'value'}: ${actual} != ${expected} within ${tolerance}`);
};
const base = { unit: 'mm', mode: 'diameter', thickness: 0.15, core: 2, length: 300, stock: 450, coils: 1 };
const targetBase = { unit: 'mm', mode: 'length', thickness: 0.15, core: 2, diameter: 10, stock: 450, coils: 1 };

// Units, strict bounds and the two solve modes.
assert.deepEqual(Object.keys(plain(C.UNITS)).sort(), ['in', 'mm']);
for (const unit of ['mm', 'in']) {
  const spec = plain(C.UNITS)[unit];
  assert.equal(spec.label, unit);
  for (const key of ['thickness', 'core', 'length', 'diameter', 'stock']) {
    const range = spec.bounds[key];
    assert.ok(Array.isArray(range) && range.length === 2 && range[0] < range[1], `${unit} ${key} bounds`);
    assert.ok(range[0] >= 0, `${unit} ${key} is nonnegative`);
  }
}
assert.equal(plain(C.UNITS).mm.other, 'in');
assert.equal(plain(C.UNITS).in.other, 'mm');
near(plain(C.UNITS).in.otherFactor, 25.4, 1e-12, 'inch conversion');
assert.equal(plan({ unit: 'mm', thickness: 0.15, core: 2, length: 300, stock: 450, coils: 1 }).mode, 'diameter');
assert.equal(failure({ unit: 'mm' }), 'Paper thickness must be a number from 0.05 to 1 mm.');

// Independent published worked examples: FeuTex and PaperFrost.
const publishedDiameter = plan(base);
near(publishedDiameter.diameter, 7.829162120756111, 0.00005, 'FeuTex published diameter');
assert.equal(publishedDiameter.diameter, 7.8292);
assert.equal(publishedDiameter.turns, 19.43);
const publishedTarget = plan(targetBase);
near(publishedTarget.length, 502.6548245743669, 0.00005, 'FeuTex published target length');
assert.equal(publishedTarget.length, 502.6548);
assert.equal(publishedTarget.turns, 26.67);
const paperfrost = plan({ ...base, thickness: 0.3, core: 0 });
near(paperfrost.diameter, 10.704704744402064, 0.00005, 'PaperFrost diameter');
assert.equal(paperfrost.turns, 17.84);
for (const [diameter, expectedLength] of [[6, 113.09733552923255], [12, 452.3893421169302], [24, 1809.5573684677208]]) {
  const result = plan({ unit: 'mm', mode: 'length', thickness: 0.25, core: 0, diameter, stock: 450, coils: 1 });
  near(result.length, expectedLength, 0.00005, `PaperFrost ${diameter} mm reference`);
}

// Independent geometry: Simpson integration of an Archimedean centreline.
// The annulus identity omits only the small radial-pitch part of arc length.
{
  const thickness = 0.15;
  const innerRadius = 1;
  const stripLength = 300;
  const outerRadius = Math.sqrt(innerRadius ** 2 + stripLength * thickness / Math.PI);
  const pitch = thickness / (2 * Math.PI);
  const angle = (outerRadius - innerRadius) / pitch;
  const intervals = 20000;
  const step = angle / intervals;
  const integrand = (theta) => {
    const radius = innerRadius + pitch * theta;
    return Math.sqrt(radius ** 2 + pitch ** 2);
  };
  let sum = integrand(0) + integrand(angle);
  for (let i = 1; i < intervals; i += 1) sum += (i % 2 ? 4 : 2) * integrand(i * step);
  const integratedLength = sum * step / 3;
  near(integratedLength / stripLength, 1, 0.0001, 'independent spiral arc-length integration');
  near(publishedDiameter.diameter, 2 * outerRadius, 0.00005, 'integrated outer diameter');
}

// Round trips, project totals, stock allocation and boundary behavior.
for (const input of [
  base,
  targetBase,
  { ...base, thickness: 0.25, core: 2, coils: 3 },
  { unit: 'mm', mode: 'length', thickness: 0.25, core: 0, diameter: 20, stock: 450, coils: 2 },
  { unit: 'in', mode: 'diameter', thickness: 0.0059, core: 0.0787, length: 11.811, stock: 17.7165, coils: 2 },
]) {
  const result = plan(input);
  const reverse = plan({
    unit: result.unit, mode: result.mode === 'diameter' ? 'length' : 'diameter',
    thickness: input.thickness, core: input.core,
    [result.mode === 'diameter' ? 'diameter' : 'length']: result.mode === 'diameter' ? result.diameter : result.length,
    stock: input.stock, coils: input.coils,
  });
  near(reverse.diameter, result.diameter, 0.00011, 'diameter round trip');
  // A diameter returned to four decimals has a half-unit quantization of
  // 0.00005; propagate it through dL/dD = pi*D/(2t) on the reverse solve.
  const lengthTolerance = result.mode === 'diameter'
    ? Math.PI * result.diameter * 0.00005 / (2 * Number(input.thickness)) + 0.00011
    : 0.00011;
  near(reverse.length, result.length, lengthTolerance, 'length round trip');
  near(result.totalLength, result.length * result.coils, 0.00011, 'project length total');
  near(result.turns, (result.diameter - result.core) / (2 * result.thickness), 0.006, 'turn count');
  assert.equal(result.totalPieces, result.piecesPerCoil * result.coils);
  assert.equal(result.joinsPerCoil, result.piecesPerCoil - 1);
  near(result.offcutPerCoil, result.piecesPerCoil * result.stock - result.length, 0.00011, 'stock offcut');
  assert.ok(result.offcutPerCoil >= 0 && result.offcutPerCoil < result.stock + 0.0001, 'offcut below one stock strip');
}
assert.equal(plan({ ...base, length: 450 }).piecesPerCoil, 1, 'exact stock boundary');
assert.equal(plan({ ...base, length: 449.9999 }).piecesPerCoil, 1, 'just below stock boundary');
assert.equal(plan({ ...base, length: 450.0001 }).piecesPerCoil, 2, 'just above stock boundary');
assert.equal(plan({ ...base, coils: '0003' }).coils, 3, 'leading-zero whole number');
assert.equal(plan({ ...base, thickness: '.15' }).diameter, 7.8292, 'fractionless leading zero');
assert.equal(plan({ ...base, core: 0 }).diameter > 0, true, 'zero core is allowed');

// Errors are exact and name the bad input.
for (const bad of ['2e2', 'abc', '1.2.3', '-5', '+5', ' ', 'NaN', 'Infinity', '0x10']) {
  assert.ok(failure({ ...base, length: bad }), `refuses ${JSON.stringify(bad)}`);
}
assert.equal(failure({ ...base, unit: 'cm' }), 'Choose millimetres or inches.');
assert.equal(failure({ ...base, mode: 'spiral' }), 'Choose coil diameter or strip length.');
assert.equal(failure({ ...targetBase, diameter: 2 }), 'Target coil diameter must be greater than the core diameter.');
assert.equal(failure({ ...base, coils: '2.5' }), 'Matching coils must be a whole number from 1 to 100.');

// The page is local-only, accessible and wired to real controls.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="quilling-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<h1>Quilling Coil Calculator<\/h1>/.test(html), 'page heading');
for (const id of ['mode', 'unit', 'thickness', 'core', 'measure', 'stock', 'coils']) {
  assert.ok(new RegExp(`for="${id}"`).test(html), `label for ${id}`);
  assert.ok(new RegExp(`id="${id}"`).test(html), `control ${id}`);
}
assert.ok(/name="viewport"/.test(html), 'viewport');
assert.ok(/min-height:44px/.test(html), '44px controls');
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 20, 'page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), `missing element id: ${id}`);
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');

// Replay every catalog vector and enforce catalog identity and metadata.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'catalog record must be unique');
assert.equal(record.name, 'Quilling Coil Calculator');
assert.equal(record.category, 'Crafts & Hobbies');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'));
assert.ok(record.sources.length >= 3);
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 29);
assert.equal(kinds('golden'), 10);
assert.equal(kinds('boundary'), 3);
assert.equal(kinds('validation'), 16);
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.equal(failure(input), expected.error, testCase.name);
    continue;
  }
  const result = plan(input);
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') near(result[key], value, 1e-9, `${testCase.name} ${key}`);
    else assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases || [])) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], `catalog key collides: ${key}`);
}
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.aliases.some((alias) => alias === alias.toLowerCase()));

console.log(`quilling-coil-calculator: all checks passed (${record.testCases.length} catalog cases, 2 modes, 2 unit systems)`);
