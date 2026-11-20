/* Regression checks for the Makefile build order planner core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'makefile-build-order-planner';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* makefile-build-order-core:start */');
const end = html.indexOf('/* makefile-build-order-core:end */');
assert.ok(start > -1 && end > start, 'makefile build order core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '\nmodule.exports = MakePlan;', sandbox);
const C = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 8, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 3, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 1200, 'method documented');
assert.ok(entry.testCases.length >= 20, 'catalog cases present');
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((folder) => folder.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 53, 'Developer count');
assert.equal(catalog.tools.length, 2423, 'catalog total');

const slugs = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(slugs.size, catalog.tools.length, 'slugs unique');
const names = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(names).size, names.length, 'names unique');
const aliases = catalog.tools.flatMap((tool) => (tool.slug === slug ? [] : tool.aliases || []))
  .map((alias) => alias.toLowerCase());
for (const alias of entry.aliases) {
  assert.ok(!aliases.includes(alias.toLowerCase()), `alias ${alias} is already used`);
}
assert.ok(!catalog.tools.some((tool) => tool.slug !== slug &&
  /makefile|\bmake\b dry run|build order/i.test([tool.name, ...(tool.aliases || []), ...(tool.tags || [])].join(' '))),
'no other make tool');

const failure = (input) => {
  try {
    C.analyze(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const targets = (input) => C.analyze(input).steps.map((step) => step.target);

// --- Default example. ---
const base = C.analyze({});
assert.equal(base.goal, 'all');
assert.deepEqual(Array.from(targets({})), ['main.o', 'util.o', 'app', 'all']);
assert.deepEqual(Array.from(base.externals), ['main.c', 'util.c']);
assert.deepEqual(Array.from(base.steps, (step) => step.kind), ['pattern', 'pattern', 'rule', 'phony']);
assert.equal(base.stats.commands, 3);
assert.equal(base.stats.depth, 3);
assert.equal(base.headline, '4 steps');
assert.match(base.summary, /^make all would run 3 commands in 4 steps/);
assert.equal(base.steps[0].commands[0], 'cc -O2 -Wall -c $< -o $@');
assert.equal(base.steps[2].commands[0], 'cc -O2 -Wall -o $@ $^');
assert.equal(base.steps[3].commands.length, 0, 'the phony goal only groups');
assert.equal(base.steps[0].line, 13, 'the rule line is reported');
assert.ok(base.notes.some((note) => /Phony targets in this plan: all/.test(note)));

// --- Parsing and expansion. ---
assert.equal(C.patternStem('%.o', 'main.o'), 'main');
assert.equal(C.patternStem('build/%.o', 'build/x.o'), 'x');
assert.equal(C.patternStem('%.o', 'main.c'), null);
assert.equal(C.patternStem('lib%.a', 'libz.a'), 'z');

const readTime = C.analyze({
  makefile: 'OBJS = a.o\nall: $(OBJS)\n\techo $(OBJS)\nOBJS = b.o\na.o:\n\ttouch a\nb.o:\n\ttouch b',
  goal: 'all'
});
assert.deepEqual(Array.from(readTime.steps[1].prereqs), ['a.o'], 'prerequisites are expanded when read');
assert.equal(readTime.steps[1].commands[0], 'echo b.o', 'recipes are expanded with the final values');
assert.equal(readTime.externals.length, 0, 'b.o is not pulled in by the earlier rule');

const chain = C.analyze({ makefile: 'A = $(B)\nB = hello $(C)\nC = world\nall:\n\techo $(A)', goal: 'all' });
assert.equal(chain.steps[0].commands[0], 'echo hello world');

assert.equal(C.analyze({ makefile: 'C ?= one\nC ?= two\nall:\n\techo $(C)', goal: 'all' }).steps[0].commands[0], 'echo one');
assert.equal(C.analyze({ makefile: 'F = a\nF += b b\nall:\n\techo $(F)', goal: 'all' }).steps[0].commands[0], 'echo a b b');
assert.equal(C.analyze({ makefile: 'A := $(B)\nB = hello\nall:\n\techo $(A)|$(B)', goal: 'all' }).steps[0].commands[0],
  'echo |hello', 'a simple variable freezes an unset reference as empty');

const continuation = C.analyze({ makefile: 'OBJS = a.o \\\n       b.o\nall: $(OBJS)\n\techo done\na.o:\n\ttouch a\nb.o:\n\ttouch b', goal: 'all' });
assert.deepEqual(Array.from(continuation.steps[continuation.steps.length - 1].prereqs), ['a.o', 'b.o']);

const inline = C.analyze({ makefile: 'all: ; echo inline', goal: 'all' });
assert.deepEqual(Array.from(inline.steps[0].commands), ['echo inline']);

const merge = C.analyze({
  makefile: 'all: a\n\techo one\nall: b\n\techo two\na:\n\ttouch a\nb:\n\ttouch b',
  goal: 'all'
});
assert.deepEqual(Array.from(merge.steps[2].prereqs), ['a', 'b'], 'prerequisites from both rules are kept');
assert.deepEqual(Array.from(merge.steps[2].commands), ['echo two'], 'the last recipe wins');
assert.ok(merge.notes.some((note) => /replaces the one from line/.test(note)));

const inherited = C.analyze({
  makefile: 'all: app\n\tcc -o app a.o b.o\napp: a.o b.o\n\tcc -o app a.o b.o\na.o: a.c common.h\nb.o: b.c\n%.o: %.c\n\tcc -c $< -o $@',
  goal: 'all'
});
assert.equal(inherited.steps[0].kind, 'pattern');
assert.deepEqual(Array.from(inherited.steps[0].prereqs), ['a.c', 'common.h'], 'own prerequisites plus the pattern ones');
assert.deepEqual(Array.from(inherited.steps[0].commands), ['cc -c $< -o $@'], 'the recipe comes from the pattern');
assert.ok(inherited.notes.some((note) => /takes its recipe from the pattern/.test(note)));

// --- Catalog cases. ---
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input), testCase.expectedError, `catalog case ${testCase.name}`);
    continue;
  }
  const result = C.analyze(testCase.input);
  assert.deepEqual(Array.from(targets(testCase.input)), testCase.expected.steps, `steps for ${testCase.name}`);
  assert.equal(result.stats.commands, testCase.expected.commands, `commands for ${testCase.name}`);
  assert.equal(result.stats.depth, testCase.expected.depth, `depth for ${testCase.name}`);
  assert.deepEqual(Array.from(result.externals), testCase.expected.externals, `externals for ${testCase.name}`);
  assert.equal(result.headline, testCase.expected.headline, `headline for ${testCase.name}`);
}

// --- Independent model: random acyclic explicit rules. ---
let seed = 20261119;
const next = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (list) => list[Math.floor(next() * list.length)];

// The model below is written from the rule "finish a prerequisite before its dependent,
// siblings left to right, each target once", not from the shipped traversal.
function modelOrder(graph, goal) {
  const order = [];
  const seen = new Set();
  const walk = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    const record = graph[node];
    if (!record) return;
    for (const dep of record.deps) walk(dep);
    order.push(node);
  };
  walk(goal);
  return order;
}

function modelExternals(graph, goal) {
  const found = [];
  const seen = new Set();
  const walk = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    for (const dep of graph[node].deps) {
      if (graph[dep]) walk(dep);
      else if (!found.includes(dep)) found.push(dep);
    }
  };
  walk(goal);
  return found;
}

for (let round = 0; round < 200; round += 1) {
  const size = 2 + Math.floor(next() * 7);
  const graph = {};
  const lines = [];
  for (let index = 0; index < size; index += 1) {
    const name = `t${round}x${index}`;
    const deps = [];
    for (let other = index + 1; other < size; other += 1) {
      if (next() < 0.22) deps.push(`t${round}x${other}`);
    }
    const leaves = [];
    const leafCount = Math.floor(next() * 3);
    for (let k = 0; k < leafCount; k += 1) leaves.push(`src${round}_${index}_${k}.c`);
    const recipe = next() < 0.85;
    graph[name] = { deps: deps.concat(leaves), own: recipe };
    lines.push(`${name}: ${graph[name].deps.join(' ')}`.trim());
    if (recipe) lines.push(`\tbuild ${name}`);
  }
  const makefile = lines.join('\n');
  const goal = `t${round}x0`;
  const result = C.analyze({ makefile, goal });
  const order = modelOrder(graph, goal);
  assert.deepEqual(Array.from(targets({ makefile, goal })), order, `round ${round} order`);
  assert.deepEqual(Array.from(result.externals), modelExternals(graph, goal), `round ${round} externals`);
  const expectedCommands = Object.keys(graph).filter((name) => graph[name].own && order.includes(name)).length;
  assert.equal(result.stats.commands, expectedCommands, `round ${round} commands`);
  assert.equal(new Set(order).size, order.length, `round ${round} duplicate`);
  const depthMemo = {};
  const depthOf = (node) => {
    if (!graph[node]) return 0;
    if (depthMemo[node]) return depthMemo[node];
    let below = 0;
    for (const dep of graph[node].deps) below = Math.max(below, depthOf(dep));
    depthMemo[node] = 1 + below;
    return depthMemo[node];
  };
  let expectedDepth = 0;
  for (const node of order) expectedDepth = Math.max(expectedDepth, depthOf(node));
  assert.equal(result.stats.depth, expectedDepth, `round ${round} depth`);
  for (const step of result.steps) {
    assert.deepEqual(Array.from(step.prereqs), graph[step.target].deps, `round ${round} prereqs of ${step.target}`);
    assert.deepEqual(Array.from(step.commands), graph[step.target].own ? [`build ${step.target}`] : [],
      `round ${round} recipe of ${step.target}`);
  }
}

// --- Independent model: pattern rules with an explicit prereq on some targets. ---
for (let round = 0; round < 120; round += 1) {
  const size = 2 + Math.floor(next() * 5);
  const graph = {};
  const lines = ['%.o: %.c', '\tcc -c $< -o $@'];
  for (let index = 0; index < size; index += 1) {
    const name = `o${round}_${index}.o`;
    const extra = next() < 0.5 ? [`h${round}_${index}.h`] : [];
    graph[name] = { deps: extra.concat([`${name.slice(0, -2)}.c`]) };
    if (extra.length > 0) lines.push(`${name}: ${extra.join(' ')}`);
  }
  const goal = `o${round}_0.o`;
  if (!graph[goal].deps.length) continue;
  const makefile = lines.join('\n');
  const result = C.analyze({ makefile, goal });
  assert.deepEqual(Array.from(targets({ makefile, goal })), modelOrder(graph, goal), `pattern round ${round}`);
  assert.deepEqual(Array.from(result.externals), modelExternals(graph, goal), `pattern round ${round} externals`);
  assert.equal(result.stats.commands, 1, `pattern round ${round} command count`);
}

// --- Refusals outside the catalog. ---
assert.equal(failure({ makefile: 'a:\n\tx', goal: 'a b' }), 'Enter one goal, for example all.');
assert.equal(failure({ makefile: 'x'.repeat(30001), goal: 'all' }),
  'Keep the Makefile to at most 30000 characters; this reads one file.');
assert.equal(failure({ makefile: Array.from({ length: 401 }, (item, index) => `t${index}:`).join('\n'), goal: 't0' }),
  'This Makefile has more than 400 rule lines; paste a smaller file.');
assert.equal(failure({ makefile: 'a: b\n\tx\nb: a\n\ty', goal: 'a' }),
  'Circular dependency: a -> b -> a. make would drop one of these prerequisites with a warning; no build order exists for the file as written.');
assert.match(failure({ makefile: 'a:\n\tx\nb:\n\ty', goal: 'c' }), /^No rule to make target 'c'\./);

// Notes are capped and still explain the assumptions.
const noisy = C.analyze({ makefile: Array.from({ length: 30 }, (item, index) => `v${index} := $(u${index})`).join('\n') + '\nall:\n\techo $(v0)', goal: 'all' });
assert.ok(noisy.notes.length <= 25, 'notes are capped');
assert.ok(noisy.notes.some((note) => /not defined at this point/.test(note)), 'undefined variables are reported');

// --- Page contract. ---
assert.match(html, /<h1>Makefile Build Order Planner<\/h1>/);
assert.match(html, /id="steps-out"/);
assert.match(html, /role="status" aria-live="polite"/);
assert.match(html, /type="submit"/);
assert.match(html, /<label for="makefile">/);
assert.match(html, /<label for="goal">/);
assert.match(html, /<table class="sheet">/);
assert.match(html, /<caption>/);
assert.ok(!/onclick=|oninput=|onchange=/.test(html), 'no inline event handlers');
assert.ok(!/src="https?:/.test(html), 'no remote scripts');

console.log(`${slug}: ${entry.testCases.length} catalog cases, 200 explicit and 120 pattern plans passed`);
