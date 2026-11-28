/* Regression checks for the speed ramp retime core and its catalog cases. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend/tools/speed-ramp-retime-planner/index.html'), 'utf8');
const start = html.indexOf('/* speed-ramp-core:start */');
const end = html.indexOf('/* speed-ramp-core:end */');
assert.ok(start > -1 && end > start, 'speed ramp core markers missing');
const core = html.slice(start, end + '/* speed-ramp-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SpeedRampCore;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === 'speed-ramp-retime-planner');
assert.ok(entry, 'catalog entry missing');
assert.equal(catalog.tools.length, 2514, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2253, 'public tools');
assert.ok(entry.testCases.length >= 24, `expected at least 24 cases, found ${entry.testCases.length}`);

const close = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: not a finite number`);
  assert.ok(Math.abs(actual - expected) < 1e-5, `${message}: ${actual} vs ${expected}`);
};

// Replay every catalog case: refusals by exact message, results by the documented fields.
for (const testCase of entry.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(
      () => C.calculate(testCase.input),
      (error) => {
        assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
        return true;
      },
      `${label}: expected a refusal`
    );
    continue;
  }
  const plan = C.calculate(testCase.input);
  const want = testCase.expected;
  close(plan.outputSeconds, want.outputSeconds, `${label}: output length`);
  assert.equal(plan.outputFrames, want.outputFrames, `${label}: output frames`);
  assert.equal(plan.sourceFrames, want.sourceFrames, `${label}: source frames`);
  assert.equal(plan.frameDelta, want.frameDelta, `${label}: frame delta`);
  close(plan.averageSpeed, want.averageSpeed, `${label}: average speed`);
  assert.equal(plan.direction, want.direction, `${label}: direction`);
  assert.equal(plan.checkpoints.length, want.checkpoints.length, `${label}: checkpoint count`);
  want.checkpoints.forEach((point, index) => {
    const got = plan.checkpoints[index];
    close(got.sourceSeconds, point.sourceSeconds, `${label}: checkpoint ${index} source time`);
    close(got.speed, point.speed, `${label}: checkpoint ${index} speed`);
    close(got.outputSeconds, point.outputSeconds, `${label}: checkpoint ${index} output time`);
    assert.equal(got.outputFrame, point.outputFrame, `${label}: checkpoint ${index} output frame`);
  });
  assert.equal(plan.outputFrames, Math.round(plan.outputSeconds * plan.fps), `${label}: output frames round the length`);
  assert.equal(plan.frameDelta, plan.outputFrames - plan.sourceFrames, `${label}: delta is the difference`);
  close(plan.averageSpeed, plan.sourceSeconds / plan.outputSeconds, `${label}: average speed definition`);
  assert.equal(plan.checkpoints[0].sourceSeconds, 0, `${label}: first checkpoint starts at the source start`);
  assert.equal(plan.checkpoints[0].outputSeconds, 0, `${label}: first checkpoint starts at the output start`);
  assert.equal(plan.checkpoints[4].outputFrame, plan.outputFrames, `${label}: last checkpoint is the last frame`);
}

// Independent oracle: composite Simpson integration of 1 / speed over source time.
function simpson(sourceSeconds, startPct, endPct, sourceTime, n = 40000) {
  if (sourceTime === 0) return 0;
  if (n % 2) n += 1;
  const s1 = startPct / 100;
  const s2 = endPct / 100;
  const f = (t) => 1 / (s1 + (s2 - s1) * (t / sourceSeconds));
  const h = sourceTime / n;
  let total = f(0) + f(sourceTime);
  for (let i = 1; i < n; i += 1) total += (i % 2 ? 4 : 2) * f(i * h);
  return (total * h) / 3;
}

for (const [duration, startPct, endPct] of [[4, 100, 25], [4, 25, 100], [7.5, 125, 40], [0.5, 400, 5], [12.34, 80, 120], [3600, 5, 400]]) {
  const plan = C.calculate({ duration: String(duration), fps: '25', startSpeed: String(startPct), endSpeed: String(endPct) });
  const want = simpson(duration, startPct, endPct, duration);
  close(plan.outputSeconds, want, `oracle ${duration}s ${startPct}->${endPct}: length`);
  for (const point of plan.checkpoints) {
    close(point.outputSeconds, simpson(duration, startPct, endPct, point.sourceSeconds), `oracle ${duration}s ${startPct}->${endPct}: source ${point.sourceSeconds}`);
  }
}

// The published constant-speed anchors.
const slower = C.calculate({ duration: '5', fps: '24', startSpeed: '50', endSpeed: '50' });
assert.equal(slower.outputSeconds, 10, '50 percent doubles the length');
const faster = C.calculate({ duration: '5', fps: '24', startSpeed: '200', endSpeed: '200' });
assert.equal(faster.outputSeconds, 2.5, '200 percent halves the length');
const normal = C.calculate({ duration: '5', fps: '24', startSpeed: '100', endSpeed: '100' });
assert.equal(normal.outputSeconds, 5, '100 percent keeps the length');
assert.equal(normal.direction, 'constant', 'equal speeds are constant');
assert.equal(normal.slowestFrames, 1, 'one output frame per source frame at 100 percent');

// The default example: a ramp down lengthens the clip, and the average speed is not the mean.
const example = C.calculate({ duration: '4', fps: '25', startSpeed: '100', endSpeed: '25' });
assert.equal(example.outputFrames, 185, 'example frames');
assert.equal(example.sourceFrames, 100, 'example source frames');
assert.equal(example.frameDelta, 85, 'example added frames');
close(example.averageSpeed, 0.541011, 'example average speed');
assert.ok(Math.abs(example.averageSpeed - 0.625) > 0.05, 'average is not the mean of the endpoints');
assert.equal(example.checkpoints[2].outputFrame, 63, 'midpoint frame on the output timeline');
assert.equal(example.checkpoints[4].outputFrame, 185, 'the last checkpoint is the last frame');

// A ramp up spends its slow time at the end; the total length matches the mirrored ramp down.
const up = C.calculate({ duration: '4', fps: '25', startSpeed: '25', endSpeed: '100' });
assert.equal(up.direction, 'up', 'ramp up direction');
close(up.outputSeconds, example.outputSeconds, 'mirrored ramps have the same length');
assert.ok(up.outputSeconds > 4, 'a ramp that includes slow speeds is longer than a constant 100 percent pass');
assert.equal(up.checkpoints[1].outputFrame + example.checkpoints[3].outputFrame, example.outputFrames, 'mirror identity at the first quarter');
assert.equal(up.checkpoints[3].outputFrame + example.checkpoints[1].outputFrame, example.outputFrames, 'mirror identity at the third quarter');
assert.ok(example.outputSeconds > 4, 'a ramp down is longer');
assert.ok(up.checkpoints.every((point, index, all) => index === 0 || point.outputSeconds > all[index - 1].outputSeconds), 'output time increases');

// The slug, name, aliases and tags stay unique against the rest of the catalog.
const others = catalog.tools.filter((tool) => tool.slug !== entry.slug);
const folded = new Set();
for (const tool of others) {
  folded.add(tool.slug);
  folded.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) folded.add(alias.toLowerCase());
}
assert.ok(!folded.has(entry.slug), 'slug collides');
assert.ok(!folded.has(entry.name.toLowerCase()), 'name collides');
for (const alias of entry.aliases) assert.ok(!folded.has(alias.toLowerCase()), `alias collides: ${alias}`);
assert.ok(entry.tags.includes('retime') && entry.tags.includes('speed-ramp'));
assert.equal(entry.category, 'Video');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Video').length, 57, 'Video count');
assert.equal(entry.listed, true);
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.ok(entry.sources.length >= 2);
assert.ok(entry.sources.every((source) => source.url && source.url.startsWith('https://')), 'https sources');
assert.ok(entry.sources.some((source) => source.url.includes('final-cut-pro')), 'editing manual cited');
assert.ok(entry.sources.some((source) => source.url.includes('Slow_motion')), 'slow motion cited');
assert.ok(!/https?:\/\//.test(entry.description), 'no links in the description');

// Page contract: the shared shell, labelled controls, and no network or dynamic-code sinks.
assert.match(html, /<html lang="en">/);
assert.match(html, /name="viewport"/);
assert.match(html, /href="\/assets\/style\.css"/);
assert.match(html, /<script src="\/assets\/app\.js"><\/script>/);
assert.match(html, /<div id="site-header"><\/div>/);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.ok(!/\beval\s*\(/.test(html), 'eval is not allowed');
assert.ok(!/new\s+Function\s*\(/.test(html), 'new Function is not allowed');
assert.ok(!/\.innerHTML\s*=/.test(html), 'innerHTML is not allowed');
assert.ok(!/XMLHttpRequest|fetch\(|sendBeacon|WebSocket/.test(html), 'no network calls');
const pageUrls = (html.match(/https?:\/\/[^\s"'<>]+/g) || []).filter((url) => !url.includes('www.w3.org'));
assert.deepEqual(pageUrls, [], 'page markup is offline');
for (const id of ['duration', 'fps', 'start-speed', 'end-speed']) {
  assert.ok(html.includes(`for="${id}"`) && html.includes(`id="${id}"`), `control ${id}`);
}
for (const id of ['error', 'results', 'out-duration', 'out-frames', 'frame-delta', 'avg-speed', 'rows', 'checkpoints']) {
  assert.ok(html.includes(`id="${id}"`), `container ${id}`);
}
assert.ok(!/<button(?![^>]*\btype=)/.test(html), 'every button declares a type');
assert.match(html, /role="alert"/);
assert.match(html, /aria-live="polite"/);
assert.ok(!/\bsrc="\/(?!assets\/)/.test(html), 'only shared assets are loaded');
for (const label of ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60']) {
  assert.ok(html.includes(`value="${label}"`), `frame rate option ${label}`);
}

console.log(`speed ramp retime planner: ${entry.testCases.length} catalog cases replayed`);
