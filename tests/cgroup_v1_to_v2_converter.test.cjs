/* Regression checks for the cgroup v1 to v2 converter core, its catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'cgroup-v1-to-v2-converter';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* cgroup-core:start */');
const end = html.indexOf('/* cgroup-core:end */');
assert.ok(start > -1 && end > start, 'cgroup core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* cgroup-core:end */'.length) + '\nmodule.exports = CgroupConvert;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.listed, true);
assert.equal(entry.maturity, 'draft');

const failure = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Hand-checkable anchors: shares 2, 1024 and 262144 keep the ends and the default. ---
assert.equal(C.sharesToWeightCurrent(2), 1, 'v1 minimum maps to v2 minimum');
assert.equal(C.sharesToWeightCurrent(1024), 100, 'v1 default maps to v2 default');
assert.equal(C.sharesToWeightCurrent(262144), 10000, 'v1 maximum maps to v2 maximum');
assert.equal(C.sharesToWeightLegacy(2), 1);
assert.equal(C.sharesToWeightLegacy(1024), 39, 'KEP-2254 maps the default below 100');
assert.equal(C.sharesToWeightLegacy(262144), 10000);
assert.equal(C.sharesToWeightCurrent(512), 59);
assert.equal(C.sharesToWeightCurrent(2048), 174);
assert.equal(C.convert('cpu-shares', { shares: '1024' }).value, '100');
assert.equal(C.convert('cpu-shares', { shares: '1024' }).legacy, '39');
assert.equal(C.convert('cpu-quota', { quota: '50000', period: '100000' }).value, '50000 100000');
assert.equal(C.convert('cpu-quota', { quota: '-1' }).value, 'max 100000');
assert.equal(C.convert('cpu-quota', { quota: '-1' }).cpus, null);
assert.equal(C.convert('memory-limit', { bytes: '-1' }).value, 'max');
assert.equal(C.convert('memory-limit', { bytes: '536870912' }).human, '512 MiB');
assert.equal(C.convert('memory-limit', { bytes: '0' }).human, '0 bytes');
assert.equal(C.convert('cpu-shares', { shares: ' 001024 ' }).weight, 100, 'spaces and leading zeros accepted');
assert.equal(failure(() => C.convert('nope', {})), 'Choose one of the three supported conversions.');

// --- Independent reference for the full shares range. ---
const referenceExponent = (shares) => {
  const level = Math.log(shares) / Math.LN2;
  return (level * level + 125 * level) / 612 - 7 / 34;
};
let compared = 0;
let previous = 0;
const reached = new Set();
for (let shares = 2; shares <= 262144; shares += 1) {
  const raw = Math.pow(10, referenceExponent(shares));
  const nearest = Math.round(raw);
  if (Math.abs(raw - nearest) < 1e-9) continue; // exact anchor point, asserted above
  const expected = Math.min(10000, Math.max(1, Math.ceil(raw)));
  const actual = C.sharesToWeightCurrent(shares);
  assert.equal(actual, expected, `shares ${shares}`);
  assert.ok(actual >= previous, `shares ${shares} is not monotone`);
  previous = actual;
  reached.add(actual);
  compared += 1;
}
assert.equal(compared, 262140);
assert.equal(reached.size, 9999, 'only weight 1 is unique to the skipped shares 2 anchor');

// --- Catalog cases. ---
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    validation += 1;
    assert.equal(failure(() => C.convert(input.mode, input)), testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const actual = C.convert(input.mode, input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, `${testCase.name} ${key}`);
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 7);
assert.equal(validation, 11);
assert.equal(entry.testCases.length, 26);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(html), 'no HTML string sinks');
assert.ok(html.includes('<form id="cg-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:600px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
assert.ok(html.includes('.grid[hidden]{display:none}'), 'hidden field groups must collapse');
assert.ok(html.includes('<caption class="sr-only">'), 'table caption missing');
for (const mode of ['cpu-shares', 'cpu-quota', 'memory-limit']) {
  assert.ok(html.includes(`value="${mode}"`), `mode option ${mode} missing`);
}
for (const id of ['cg-form', 'mode-select', 'shares-input', 'quota-input', 'period-input', 'memory-input',
  'convert', 'cg-status', 'v1-out', 'file-out', 'value-out', 'extra-label', 'extra-out', 'extra-sub',
  'cg-note', 'copy-value', 'table-body']) {
  assert.ok(html.includes(`id="${id}"`), `element ${id} missing`);
}
for (const id of ['mode-select', 'shares-input', 'quota-input', 'period-input', 'memory-input']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id} missing`);
}
for (const id of ['v1-out', 'value-out', 'extra-out']) {
  assert.ok(html.includes(`<output id="${id}"`), `output ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)|\$\('([^']+)'\)/g)) {
  const id = match[1] || match[2];
  assert.ok(ids.includes(id), `script references missing id ${id}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"'), 'tools registry missing');
assert.ok(html.includes('src="/assets/app.js"'), 'app bootstrap missing');
console.log('cgroup-v1-to-v2-converter: 26 catalog cases and 262140 reference comparisons passed');
