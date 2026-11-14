/* Regression checks for the audio latency planner core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'audio-latency-buffer-planner';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* audio-latency-core:start */');
const end = html.indexOf('/* audio-latency-core:end */');
assert.ok(start > -1 && end > start, 'audio latency core markers missing');
const core = html.slice(start, end + '/* audio-latency-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = AudioLatencyCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];

const run = (input) => C.build({ ...C.DEFAULTS, ...input });
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const near = (actual, expected, label, eps = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)),
    `${label}: expected ${expected}, got ${actual}`
  );
};

// --- Independent reference: integer thousandths of a millisecond, no shared code paths. ---
const milliMs = (text) => {
  const parts = String(text === undefined || text === null ? '' : text).trim().split('.');
  const whole = Number(parts[0]);
  const frac = Number(((parts[1] || '') + '000').slice(0, 3));
  return whole * 1000 + frac;
};
// Integer division rounding half up, so no float tie can move a sample either way.
const halfUpDiv = (numerator, denominator) => {
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
};
const floorDiv = (numerator, denominator) => (numerator - (numerator % denominator)) / denominator;
const reference = (input) => {
  const state = { ...C.DEFAULTS, ...input };
  const rate = Number(String(state.sampleRate).trim());
  const frames = Number(String(state.bufferFrames).trim());
  const buffers = Number(String(state.buffers).trim());
  const extraSamples = halfUpDiv(milliMs(state.extraMs) * rate, 1000000);
  const pluginSamples = halfUpDiv(milliMs(state.pluginMs) * rate, 1000000);
  const bufferSamples = frames * buffers;
  const totalSamples = bufferSamples + extraSamples + pluginSamples;
  const budgetSamples = floorDiv(milliMs(state.targetMs) * rate, 1000000);
  let maxFrames = null;
  for (let size = 8192; size >= 8; size /= 2) {
    if (size * buffers + extraSamples + pluginSamples <= budgetSamples) {
      maxFrames = size;
      break;
    }
  }
  return {
    blockMs: (frames * 1000) / rate,
    bufferSamples,
    bufferMs: (bufferSamples * 1000) / rate,
    totalSamples,
    totalMs: (totalSamples * 1000) / rate,
    budgetSamples,
    fits: totalSamples <= budgetSamples,
    maxFrames,
    distanceM: ((totalSamples * 1000) / rate / 1000) * 343,
  };
};

// Documented anchors a reviewer can check by hand.
near(run({ sampleRate: 48000, bufferFrames: 64 }).blockMs, 1.333333, '64 frames at 48 kHz');
near(run({ sampleRate: 96000, bufferFrames: 1024 }).blockMs, 10.666667, '1024 frames at 96 kHz');
near(run({ sampleRate: 44100, bufferFrames: 256 }).blockMs, 5.804989, '256 frames at 44.1 kHz');
const defaults = run({});
near(defaults.totalMs, 5.333333, 'default 128-frame round trip at 48 kHz');
near(defaults.bufferMs, 5.333333, 'default buffer share');
assert.equal(defaults.totalSamples, 256);
assert.equal(defaults.budgetSamples, 480);
assert.equal(defaults.fits, true);
assert.equal(defaults.maxFrames, 128);
near(defaults.distanceM, 1.829333, 'default listening distance');
assert.equal(defaults.warningCount, 1, 'zero converter latency is flagged once');
assert.match(defaults.summary, /5\.333 ms round trip at 48000 Hz with a 128-frame buffer and 2 buffers/);

// Converter latency becomes whole samples at the session rate.
const converter = run({ sampleRate: 44100, bufferFrames: 256, extraMs: '4', targetMs: '20' });
assert.equal(converter.extraSamples, 176, '4 ms at 44.1 kHz is 176.4 samples, round half up');
assert.equal(converter.totalSamples, 688);
assert.equal(converter.maxFrames, 256);
const plugin = run({ bufferFrames: 64, extraMs: '0.5', pluginMs: '1.75' });
assert.equal(plugin.extraSamples, 24);
assert.equal(plugin.pluginSamples, 84);
assert.equal(plugin.totalSamples, 236);
near(plugin.totalMs, 4.916667, 'plugin chain total');

// The budget is floored, so a chain of exactly the budget still fits.
const exact = run({ bufferFrames: 256, targetMs: '10.667' });
assert.equal(exact.budgetSamples, 512);
assert.equal(exact.totalSamples, 512);
assert.equal(exact.fits, true);
assert.equal(exact.marginMs, 0);
const justUnder = run({ bufferFrames: 256, targetMs: '10.6' });
assert.equal(justUnder.budgetSamples, 508);
assert.equal(justUnder.fits, false);
assert.ok(justUnder.warnings[0].includes('over your 10.60 ms target'));

// Nothing fits when the fixed latency alone exceeds the budget.
const hopeless = run({ pluginMs: '1000', targetMs: '200' });
assert.equal(hopeless.maxFrames, null);
assert.equal(hopeless.fits, false);
assert.ok(hopeless.warnings.some((line) => line.includes('no standard buffer size meets it')));

// Odd buffer sizes are accepted but called out.
const odd = run({ bufferFrames: 3000, targetMs: '200' });
assert.equal(odd.totalSamples, 6000);
assert.ok(odd.warnings.some((line) => line.includes('is not a power of two')));
assert.equal(C.framesThatFit(2, 0, 480), 128);
assert.equal(C.framesThatFit(2, 84, 480), 128);
assert.equal(C.framesThatFit(4, 9600, 9600), null);

// --- Sweep against the independent reference over the whole input lattice. ---
let compared = 0;
for (const rate of [8000, 11025, 22050, 44100, 48000, 88200, 96000, 176400, 192000]) {
  for (const frames of [8, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192]) {
    for (const buffers of [1, 2, 3, 4]) {
      for (const extraMs of ['0', '0.5', '3.7', '47.125', '200']) {
        const input = {
          sampleRate: String(rate), bufferFrames: String(frames), buffers: String(buffers),
          extraMs, pluginMs: '1.25', targetMs: '12.667',
        };
        const got = run(input);
        const want = reference(input);
        near(got.blockMs, want.blockMs, `sweep block ${JSON.stringify(input)}`);
        near(got.bufferMs, want.bufferMs, `sweep buffer ${JSON.stringify(input)}`);
        near(got.totalMs, want.totalMs, `sweep total ${JSON.stringify(input)}`);
        near(got.distanceM, want.distanceM, `sweep distance ${JSON.stringify(input)}`);
        assert.equal(got.bufferSamples, want.bufferSamples, `sweep samples ${JSON.stringify(input)}`);
        assert.equal(got.totalSamples, want.totalSamples, `sweep total samples ${JSON.stringify(input)}`);
        assert.equal(got.budgetSamples, want.budgetSamples, `sweep budget ${JSON.stringify(input)}`);
        assert.equal(got.fits, want.fits, `sweep fits ${JSON.stringify(input)}`);
        assert.equal(got.maxFrames, want.maxFrames, `sweep max frames ${JSON.stringify(input)}`);
        compared += 1;
      }
    }
  }
}
assert.ok(compared >= 1800, `sweep too small: ${compared}`);

// Standard buffer table: seven power-of-two rows, the current size marked once.
const table = defaults.table;
assert.deepEqual(Array.from(table, (row) => row.frames), [32, 64, 128, 256, 512, 1024, 2048]);
assert.equal(table.filter((row) => row.current).length, 1);
assert.equal(table.filter((row) => row.current)[0].frames, 128);
assert.equal(table.filter((row) => row.fits).length, 3, '32, 64 and 128 frames fit a 10 ms target at 48 kHz');
near(table[0].ms, 1.333333, 'table 32-frame row');

// --- Catalog case replay. ---
assert.ok(Array.isArray(entry.testCases) && entry.testCases.length > 0, 'catalog cases missing');
let golden = 0;
let boundary = 0;
let validation = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validation += 1;
    const message = failure(testCase.input);
    assert.ok(message !== null, `${testCase.name}: expected a refusal`);
    assert.equal(message, testCase.expectedError, `${testCase.name}: wrong message`);
    continue;
  }
  if (testCase.kind === 'golden') golden += 1;
  else if (testCase.kind === 'boundary') boundary += 1;
  else assert.fail(`${testCase.name}: unknown kind ${testCase.kind}`);
  const result = run(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    if (typeof expected === 'number' && !Number.isInteger(expected)) {
      near(result[key], expected, `${testCase.name} ${key}`);
    } else {
      assert.equal(result[key], expected, `${testCase.name} ${key}`);
    }
  }
}
assert.equal(golden, 8);
assert.equal(boundary, 6);
assert.equal(validation, 13);
assert.equal(entry.testCases.length, 27);

// --- Static offline, accessibility and DOM-wiring contract. ---
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.clipboard/.test(html), 'no network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'no remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'no remote styles');
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers');
assert.ok(!/\beval\(|new Function/.test(html), 'no dynamic code evaluation');
assert.ok(html.includes('<form id="lat-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'live result missing');
assert.ok(html.includes('role="status"'), 'status role missing');
assert.ok(html.includes('@media(max-width:640px)'), 'mobile breakpoint missing');
assert.ok(html.includes('min-height:44px'), '44 px controls required');
assert.ok(html.includes('max-width:none'), 'text inputs must escape the shared 720 px cap');
for (const id of ['in-sampleRate', 'in-bufferFrames', 'in-buffers', 'in-extraMs', 'in-pluginMs', 'in-targetMs']) {
  assert.ok(html.includes(`id="${id}"`), `control ${id} missing`);
  assert.ok(html.includes(`for="${id}"`), `label ${id} missing`);
}
for (const id of ['preset-tracking', 'preset-mixing', 'preset-live', 'preset-usb', 'calculate', 'reset']) {
  assert.ok(html.includes(`id="${id}"`), `button ${id} missing`);
}
const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate HTML id');
for (const match of html.matchAll(/getElementById\('([^']+)'\)/g)) {
  assert.ok(ids.includes(match[1]), `script references missing id ${match[1]}`);
}
assert.ok(html.includes('src="/assets/theme-init.js"'), 'theme bootstrap missing');
assert.ok(html.includes('href="/assets/style.css"'), 'shared stylesheet missing');
assert.ok(html.includes('src="/assets/tools.js"') && html.includes('src="/assets/app.js"'), 'shared scripts missing');
// The markup must open on the core defaults, not in a validation-error state.
assert.ok(html.includes('id="in-sampleRate" type="number" min="8000" max="192000" step="1" value="48000"'),
  'sample rate must default to 48000');
assert.ok(html.includes('id="in-bufferFrames" type="number" min="8" max="8192" step="1" value="128"'),
  'buffer size must default to 128');
assert.ok(html.includes('id="in-buffers" type="number" min="1" max="4" step="1" value="2"'),
  'buffer count must default to 2');
assert.ok(html.includes('id="in-targetMs" type="number" min="1" max="200" step="0.5" value="10"'),
  'target must default to 10 ms');

// --- Catalog record contract. ---
assert.equal(entry.name, 'Audio Latency & Buffer Planner');
assert.equal(entry.category, 'Audio');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.sources.length, 3);
assert.ok(entry.method.includes('343 m/s') && entry.method.includes('power of two'));
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.equal(catalog.tools.length, 2265);
const allAliases = new Map();
for (const tool of catalog.tools) {
  for (const alias of tool.aliases || []) {
    const key = alias.toLowerCase();
    if (!allAliases.has(key)) allAliases.set(key, new Set());
    allAliases.get(key).add(tool.slug);
  }
}
for (const alias of entry.aliases) {
  const owners = allAliases.get(alias.toLowerCase());
  assert.deepEqual([...owners], [slug], `alias ${alias} must belong only to ${slug}`);
}
for (const value of [entry.slug, entry.name]) {
  const key = value.toLowerCase();
  const clash = catalog.tools.filter((tool) => tool.slug !== slug
    && (tool.slug.toLowerCase() === key || tool.name.toLowerCase() === key));
  assert.equal(clash.length, 0, `${value} clashes with ${clash.map((tool) => tool.slug).join(', ')}`);
}

console.log(`audio latency planner: ${compared} sweep cases, ${golden} golden, ${boundary} boundary, ${validation} validation checks passed`);
