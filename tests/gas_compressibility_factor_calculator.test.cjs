/* Gas compressibility factor: catalog fixtures, Hall-Yarborough model, correlation cross-check and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const slug = 'gas-compressibility-factor-calculator';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* gas-z-core:start */';
const endMarker = '/* gas-z-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + endMarker.length) + '\nmodule.exports = GasZCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog must contain exactly one gas Z calculator');
const record = records[0];
assert.equal(record.name, 'Gas Compressibility Factor Calculator');
assert.equal(record.category, 'Oil, Gas & Marine Engineering');
assert.equal(record.subcategory, 'Estimation & calculation');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.reviewedAt, null);
assert.equal(record.listed, true);
assert.equal(record.legacyCategory, null);
assert.equal(new Set(record.tags).size, record.tags.length);
assert.equal(new Set(record.aliases).size, record.aliases.length);
assert.ok(record.method.length > 1200, 'method documents the equations and their scope');
assert.match(record.method, /Hall-Yarborough/);
assert.match(record.method, /Sutton/);
assert.match(record.method, /756\.8 - 131\.07/);
assert.match(record.method, /0\.02827/);
assert.equal(record.sources.length, 2, 'two fetched references');
assert.match(record.sources[0].url, /^https:\/\/wiki\.whitson\.com\//, 'Whitson source');
assert.match(record.sources[1].url, /^https:\/\/www\.campetro\.com\//, 'CamPetro source');
assert.equal(record.testCases.length, 19);
assert.equal(record.testCases.filter((item) => item.kind === 'golden').length, 5);
assert.equal(record.testCases.filter((item) => item.kind === 'boundary').length, 6);
assert.equal(record.testCases.filter((item) => item.kind === 'validation').length, 8);
assert.equal(catalog.tools.length, 2469, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2208, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Oil, Gas & Marine Engineering').length, 55,
  'Oil, Gas & Marine Engineering count');
// No other record claims this slug, name, alias or distinctive tag.
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name.toLowerCase(), record.name.toLowerCase(), 'name is unique: ' + other.slug);
  for (const alias of record.aliases) {
    assert.ok(!other.aliases.map((aliasValue) => aliasValue.toLowerCase()).includes(alias.toLowerCase()),
      'alias is unique: ' + alias + ' in ' + other.slug);
  }
  for (const tag of ['natural-gas', 'z-factor', 'compressibility-factor', 'real-gas', 'pvt']) {
    assert.ok(!other.tags.includes(tag), tag + ' tag is unique: ' + other.slug);
  }
}
assert.equal(catalog.tools.filter((tool) => tool.slug === 'ideal-gas-law').length, 1,
  'the ideal gas tool stays a separate page');

// Catalog fixtures replay through the page core.
for (const fixture of record.testCases) {
  if (fixture.expectedError) {
    assert.throws(() => C.solve(fixture.input), (error) => error.message === fixture.expectedError,
      fixture.name + ': ' + fixture.expectedError);
  } else {
    const result = C.solve(fixture.input);
    const picked = {
      pPc: result.pPc,
      tPc: result.tPc,
      pPr: result.pPr,
      tPr: result.tPr,
      z: result.z,
      densityLbFt3: result.densityLbFt3,
      densityKgM3: result.densityKgM3,
      bgFt3Scf: result.bgFt3Scf
    };
    assert.deepEqual(picked, fixture.expected, fixture.name);
  }
}

// Published worked values: 0.7 gravity at 200 F, and the gravity and temperature comparisons.
const published = [
  ['1000', 0.922, 0.0172],
  ['3000', 0.886, 0.00550],
  ['5000', 1.000, 0.00373],
  ['8000', 1.254, 0.00292]
];
for (const [pressure, z, bg] of published) {
  const result = C.solve({ gravity: '0.7', pressure, temperature: '200' });
  assert.ok(Math.abs(result.z - z) <= 0.001, 'Z ' + pressure + ': ' + result.z);
  assert.ok(Math.abs(result.bgFt3Scf - bg) <= Math.max(1e-5, 0.01 * bg), 'Bg ' + pressure + ': ' + result.bgFt3Scf);
}
const gravityRows = [
  ['0.6', '3000', 0.920],
  ['0.8', '3000', 0.851],
  ['0.8', '8000', 1.280]
];
for (const [gravity, pressure, z] of gravityRows) {
  const result = C.solve({ gravity, pressure, temperature: '200' });
  assert.ok(Math.abs(result.z - z) <= 0.001, 'gravity ' + gravity + ' at ' + pressure + ': ' + result.z);
}
const bgTemperature = [
  ['150', 0.00337],
  ['250', 0.00409]
];
for (const [temperature, bg] of bgTemperature) {
  const result = C.solve({ gravity: '0.7', pressure: '5000', temperature });
  assert.ok(Math.abs(result.bgFt3Scf - bg) <= 5e-5, 'Bg at ' + temperature + ' F: ' + result.bgFt3Scf);
}
assert.equal(C.solve({ gravity: '0.72', pressure: '100', temperature: '200' }).pPc, 660.6,
  'Sutton pseudo-critical pressure for 0.72 gravity');
assert.equal(C.solve({ gravity: '0.72', pressure: '100', temperature: '200' }).tPc, 382.5,
  'Sutton pseudo-critical temperature for 0.72 gravity');

// Independent Hall-Yarborough solve: scan for the first sign change, then bisect that bracket.
function objective(y, ppr, tpr) {
  const t = 1 / tpr;
  const a = 0.06125 * t * Math.exp(-1.2 * (1 - t) * (1 - t));
  const b = 14.76 * t - 9.76 * t * t + 4.58 * t * t * t;
  const c = 90.7 * t - 242.2 * t * t + 42.4 * t * t * t;
  const exponent = 2.18 + 2.82 * t;
  return -a * ppr + (y + y * y + y * y * y - y ** 4) / (1 - y) ** 3 - b * y * y + c * y ** exponent;
}
function independentZ(ppr, tpr) {
  let previousY = 1e-10;
  let previousF = objective(previousY, ppr, tpr);
  let low = null;
  let high = null;
  for (let step = 1; step <= 2000; step++) {
    const y = (0.9999 * step) / 2000;
    const value = objective(y, ppr, tpr);
    if ((value > 0) !== (previousF > 0)) {
      low = previousY;
      high = y;
      break;
    }
    previousY = y;
    previousF = value;
  }
  assert.notEqual(low, null, 'the reduced-density equation has a root');
  for (let step = 0; step < 100; step++) {
    const mid = (low + high) / 2;
    const value = objective(mid, ppr, tpr);
    if ((value > 0) === (objective(low, ppr, tpr) > 0)) low = mid; else high = mid;
  }
  const y = (low + high) / 2;
  const t = 1 / tpr;
  return 0.06125 * t * Math.exp(-1.2 * (1 - t) * (1 - t)) * ppr / y;
}

// Independent Dranchuk-Abou-Kassem correlation, solved by bisection on Z.
function dakZ(ppr, tpr) {
  const A = [0.3265, -1.0700, -0.5339, 0.01569, -0.05165,
    0.5475, -0.7361, 0.1844, 0.1056, 0.6134, 0.7210];
  function residual(z) {
    const rr = (0.27 * ppr) / (z * tpr);
    return 1
      + (A[0] + A[1] / tpr + A[2] / tpr ** 3 + A[3] / tpr ** 4 + A[4] / tpr ** 5) * rr
      + (A[5] + A[6] / tpr + A[7] / tpr ** 2) * rr * rr
      - A[8] * (A[6] / tpr + A[7] / tpr ** 2) * rr ** 5
      + A[9] * (1 + A[10] * rr * rr) * (rr * rr / tpr ** 3) * Math.exp(-A[10] * rr * rr)
      - z;
  }
  let low = 0.2;
  let high = 2.5;
  let lowResidual = residual(low);
  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    const value = residual(mid);
    if ((value > 0) === (lowResidual > 0)) { low = mid; lowResidual = value; } else high = mid;
  }
  return (low + high) / 2;
}

function sutton(gravity) {
  return {
    tPc: 169.2 + 349.5 * gravity - 74 * gravity * gravity,
    pPc: 756.8 - 131.07 * gravity - 3.6 * gravity * gravity
  };
}

// 200 deterministic random states against the independent solve.
let seed = 987654321;
function random() {
  seed = (1103515245 * seed + 12345) % 2147483648;
  return seed / 2147483648;
}
let worstIndependent = 0;
let worstDak = 0;
let dakPoints = 0;
for (let index = 0; index < 200; index++) {
  const gravity = 0.56 + random() * 0.64;
  const pressure = 100 + random() * 9900;
  const temperature = 60 + random() * 240;
  const result = C.solve({
    gravity: gravity.toFixed(3),
    pressure: pressure.toFixed(2),
    temperature: temperature.toFixed(2)
  });
  const critical = sutton(Number(gravity.toFixed(3)));
  const tPr = (Number(temperature.toFixed(2)) + 459.67) / critical.tPc;
  const pPr = Number(pressure.toFixed(2)) / critical.pPc;
  const reference = independentZ(pPr, tPr);
  worstIndependent = Math.max(worstIndependent, Math.abs(result.z - reference));
  assert.ok(result.z > 0.2 && result.z < 2.2, 'Z stays in a physical band: ' + result.z);
  assert.ok(result.bgFt3Scf > 0, 'Bg is positive');
  assert.ok(result.densityLbFt3 > 0, 'density is positive');
  if (tPr >= 1.4 && pPr >= 0.3 && pPr <= 10) {
    const dak = dakZ(pPr, tPr);
    dakPoints += 1;
    worstDak = Math.max(worstDak, Math.abs(result.z - dak) / dak);
  }
}
assert.ok(worstIndependent <= 0.002, 'independent solve agrees: ' + worstIndependent);
assert.ok(dakPoints >= 40, 'enough DAK comparison points: ' + dakPoints);
assert.ok(worstDak <= 0.02, 'Dranchuk-Abou-Kassem agrees within 2 %: ' + worstDak);

// Z tends to 1 as the pressure falls, dips below 1 and then recovers above it.
assert.ok(Math.abs(C.solve({ gravity: '0.7', pressure: '100', temperature: '200' }).z - 1) < 0.02,
  'low pressure is close to ideal');
const rows = C.solve({ gravity: '0.7', pressure: '3000', temperature: '200' }).rows;
assert.equal(rows.length, 8, 'eight reference pressures');
const zs = rows.map((row) => row.z);
const lowest = zs.indexOf(Math.min(...zs));
assert.ok(lowest > 0 && lowest < zs.length - 1, 'the dip is interior');
assert.ok(zs[zs.length - 1] > zs[lowest] + 0.2, 'Z recovers at high pressure');
for (let index = 1; index < rows.length; index++) {
  assert.ok(rows[index].pressurePsia > rows[index - 1].pressurePsia, 'pressures ascend');
}
assert.equal(rows[0].pressurePsia, 500);
assert.equal(rows[rows.length - 1].pressurePsia, 8000);
assert.equal(rows.filter((row) => row.mine).length, 0, 'no extra row when the pressure is listed');
assert.equal(rows[3].z, C.solve({ gravity: '0.7', pressure: '3000', temperature: '200' }).z);

// An unlisted pressure joins the sweep once, marked as the reader's own.
const extra = C.solve({ gravity: '0.7', pressure: '3500', temperature: '200' });
assert.equal(extra.rows.length, 9, 'the reader pressure is appended');
assert.equal(extra.rows[8].mine, true);
assert.equal(extra.rows[8].pressurePsia, 3500);
assert.equal(extra.rows[8].z, extra.z);
assert.equal(C.solve({ gravity: '0.7', pressure: '3005', temperature: '200' }).rows.length, 8,
  'a pressure within half a percent of a listed point is not duplicated');

// Boundary refusals beyond the catalog fixtures.
assert.throws(() => C.solve({ gravity: '0.7', pressure: '3000', temperature: '301' }), /from 60 to 300/);
assert.throws(() => C.solve({ gravity: '0.7', pressure: '3000', temperature: 'abc' }), /from 60 to 300/);
assert.throws(() => C.solve({ gravity: '0.7', pressure: '3000', temperature: '' }), /Temperature is required/);
assert.equal(C.solve({ gravity: '0.56', pressure: '100', temperature: '60' }).z, 0.986);
assert.equal(C.solve({ gravity: '1.2', pressure: '10000', temperature: '300' }).z, 1.595);

// Page contract.
assert.match(html, /<h1>Gas Compressibility Factor Calculator<\/h1>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.match(html, /src="\/assets\/theme-init\.js"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /src="\/assets\/app\.js"/);
assert.match(html, /id="gravity"/);
assert.match(html, /id="pressure"/);
assert.match(html, /id="temperature"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /min-height:44px/);
assert.match(html, /inputmode="decimal"/);
assert.ok(!/https?:\/\//.test(html), 'no outbound URLs in the page');
assert.ok(!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/.test(html), 'no external scripts');
