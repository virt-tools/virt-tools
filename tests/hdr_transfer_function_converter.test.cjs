/* Regression checks for the HDR transfer function converter core, its catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'hdr-transfer-function-converter';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* hdr-core:start */');
const end = html.indexOf('/* hdr-core:end */');
assert.ok(start > -1 && end > start, 'hdr core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* hdr-core:end */'.length) + '\nmodule.exports = HdrTransfer;', sandbox);
const H = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Video');
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
const close = (actual, expected, tolerance, label) => {
  assert.ok(Number.isFinite(actual), `not a finite number: ${actual} ${label || ''}`);
  const limit = Math.max(Math.abs(expected) * (tolerance || 1e-9), 1e-12);
  assert.ok(Math.abs(actual - expected) <= limit, `${label || 'value'}: ${actual} != ${expected} (limit ${limit})`);
};

// --- Published anchors: PQ table and the HLG reference white. ---
close(H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: '100' }).nits, 0.306, 5e-3);
close(H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: '512' }).nits, 92.698, 1e-3);
close(H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: '769' }).nits, 998.932, 1e-5);
assert.equal(H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: '1023' }).nits, 10000);
assert.equal(H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: '0' }).nits, 0);
close(H.convert({ transfer: 'hlg', direction: 'to-luminance', units: 'percent', signal: '75', peak: '1000' }).nits, 203.1521, 1e-5);
close(H.hlgGamma(1000), 1.2, 1e-12);
close(H.hlgGamma(100), 0.78, 1e-12);
close(H.convert({ transfer: 'bt1886', direction: 'to-luminance', units: 'percent', signal: '50', peak: '100' }).nits, 18.946457, 1e-6);
close(H.convert({ transfer: 'srgb', direction: 'to-luminance', units: 'percent', signal: '50', peak: '100' }).nits, 21.404114, 1e-6);

// --- Monotonicity and round trips across every 10-bit code for PQ. ---
let previous = -1;
for (let code = 0; code <= 1023; code += 1) {
  const nits = H.convert({ transfer: 'pq', direction: 'to-luminance', units: 'code10', signal: String(code) }).nits;
  assert.ok(nits >= previous, `PQ is not monotone at ${code}`);
  previous = nits;
  const back = H.signalFromNits('pq', nits, 10000);
  if (code > 0) close(back, code / 1023, 1e-8, `round trip ${code}`);
}
for (const transfer of ['hlg', 'bt1886', 'srgb']) {
  const peak = transfer === 'hlg' ? 1000 : 100;
  let last = -1;
  for (let step = 0; step <= 100; step += 1) {
    const nits = H.nitsFromSignal(transfer, step / 100, peak);
    assert.ok(nits >= last, `${transfer} is not monotone at ${step} %`);
    last = nits;
    close(H.signalFromNits(transfer, nits, peak), step / 100, 1e-8);
  }
  close(H.nitsFromSignal(transfer, 1, peak), peak, 1e-12);
}

// --- Catalog cases. ---
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  const input = testCase.input;
  if (testCase.kind === 'validation') {
    validation += 1;
    assert.equal(failure(() => H.convert(input)), testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const actual = H.convert(input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number') close(actual[key], expected, 1e-9);
    else assert.equal(actual[key], expected, `${testCase.name} ${key}`);
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 7);
assert.equal(validation, 12);
assert.equal(entry.testCases.length, 27);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(!/innerHTML\s*=|insertAdjacentHTML|document\.write/.test(html), 'no HTML string sinks');
assert.ok(html.includes('<form id="hdr-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:600px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
assert.ok(html.includes('.grid[hidden]{display:none}'), 'hidden field groups must collapse');
assert.ok(html.includes('<caption class="sr-only">'), 'table caption missing');
for (const transfer of ['pq', 'hlg', 'bt1886', 'srgb']) {
  assert.ok(html.includes(`value="${transfer}"`), `transfer option ${transfer} missing`);
}
for (const id of ['hdr-form', 'transfer-select', 'direction-select', 'units-select', 'signal-input',
  'luminance-input', 'peak-input', 'convert', 'hdr-status', 'signal-fields', 'luminance-fields',
  'peak-fields', 'transfer-out', 'signal-out', 'code-out', 'nits-out', 'nits-sub', 'share-out',
  'peak-out', 'hdr-note', 'table-head', 'table-body', 'table-caption']) {
  assert.ok(html.includes(`id="${id}"`), `element ${id} missing`);
}
for (const id of ['transfer-select', 'direction-select', 'units-select', 'signal-input', 'luminance-input', 'peak-input']) {
  assert.ok(html.includes(`for="${id}"`), `label for ${id} missing`);
}
for (const id of ['transfer-out', 'signal-out', 'code-out', 'nits-out', 'share-out', 'peak-out']) {
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
console.log('hdr-transfer-function-converter: 27 catalog cases, 1024 PQ luminance points and 1326 round trips passed');
