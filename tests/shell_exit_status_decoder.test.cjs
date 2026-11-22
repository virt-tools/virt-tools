/* Shell exit status decoder: the wait-status bit layout against an independent
   macro model, the 128 + n shell convention, every refusal, the catalog replay
   and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'shell-exit-status-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* shell-exit-core:start */';
const endMarker = '/* shell-exit-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = ShellExitCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const decode = (value, mode) => plain(C.decode(value, mode));
const failure = (value, mode) => {
  try { decode(value, mode); } catch (error) { return error.message; }
  return null;
};

// ---- The signal table matches signal(7) for the 31 named signals.
assert.equal(C.SIGNALS.length, 31, 'thirty-one named signals');
C.SIGNALS.forEach((entry, index) => {
  assert.equal(entry[0], index + 1, 'signals are numbered in order');
  assert.match(entry[1], /^[A-Z0-9]+$/, 'signal name ' + entry[1]);
  assert.ok(['Terminate', 'Core', 'Ignore', 'Continue', 'Stop'].includes(entry[2]), 'default action ' + entry[1]);
  assert.ok(entry[3].length > 10, 'meaning for ' + entry[1]);
});
assert.deepEqual(plain(C.SIGNALS.map((entry) => entry[1])),
  ['HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1',
    'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM', 'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP',
    'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'PWR', 'SYS']);
assert.equal(C.SIGNALS.filter((entry) => entry[2] === 'Core').length, 10, 'ten core-dumping signals');
assert.equal(C.signalLabel(9), 'SIGKILL (9)');
assert.equal(C.signalLabel(11), 'SIGSEGV (11)');
assert.equal(C.signalLabel(32), 'signal 32 (reserved by the C library)');
assert.equal(C.signalLabel(33), 'signal 33 (reserved by the C library)');
assert.equal(C.signalLabel(34), 'SIGRTMIN+0 (34)');
assert.equal(C.signalLabel(50), 'SIGRTMIN+16 (50)');
assert.equal(C.signalLabel(64), 'SIGRTMAX (64)');
assert.equal(C.hex(139), '0x008b');
assert.equal(C.hex(1), '0x0001');
assert.equal(C.hex(0xffff), '0xffff');
assert.deepEqual(plain(C.MODES), ['shell', 'raw']);
assert.equal(C.SHELL_MAX, 255);
assert.equal(C.RAW_MAX, 65535);
assert.equal(C.RTMAX, 64);

// ---- Shell mode: 0 to 255, with 129 to 192 read as 128 + a signal.
let shellCases = 0;
for (let code = 0; code <= 255; code += 1) {
  const result = decode(String(code), 'shell');
  const isSignal = code >= 129 && code <= 192;
  assert.equal(result.kind, isSignal ? 'signaled' : 'exited', 'kind at ' + code);
  assert.equal(result.shellCode, code, 'shell code at ' + code);
  assert.equal(result.big, '$? ' + code, 'headline at ' + code);
  if (isSignal) {
    assert.equal(result.signal, code - 128, 'signal at ' + code);
    assert.equal(result.exitCode, null, 'no exit code at ' + code);
    assert.equal(result.coreDumped, null, 'core state is invisible at ' + code);
    assert.equal(result.rawStatus, null, 'a shell code does not carry the raw status');
    assert.ok(result.headline.startsWith('Killed by '), 'signal headline at ' + code);
    assert.ok(result.rows.some((row) => row[0] === '128 + signal' && row[1] === '128 + ' + (code - 128) + ' = ' + code),
      'the 128 + n arithmetic is shown at ' + code);
    assert.ok(result.rows.some((row) => row[0] === 'Wait status' && row[1] === 'not recoverable from $?'),
      'the lost status is stated at ' + code);
    if (code - 128 <= 31) {
      assert.equal(result.signalText, C.signalLabel(code - 128), 'signal text at ' + code);
      assert.ok(result.cause.length > 10 || result.signalMeaning.length > 10, 'a cause for ' + code);
    } else {
      assert.match(result.signalText, /^SIGRT|^signal 3[23] /, 'a real-time or reserved label at ' + code);
    }
  } else {
    assert.equal(result.exitCode, code, 'exit code at ' + code);
    assert.equal(result.signal, null, 'no signal at ' + code);
    assert.equal(result.coreDumped, false, 'no core at ' + code);
    assert.equal(result.rawStatus, code << 8, 'the reconstructed wait status at ' + code);
    assert.ok(result.headline.startsWith('Exited with code ' + code), 'exit headline at ' + code);
  }
  // Hexadecimal input reaches the same result.
  assert.deepEqual(decode('0x' + code.toString(16), 'shell'), result, 'hex form at ' + code);
  shellCases += 1;
}

// ---- Raw mode: the full 16-bit space against an independent bit model.
let rawCases = 0;
let refusals = 0;
for (let status = 0; status <= 65535; status += 1) {
  const low = status & 0x7f;
  const lowByte = status & 0xff;
  let model;
  if (status === 0xffff) {
    model = { kind: 'continued' };
  } else if (lowByte === 0x7f) {
    const stop = (status >> 8) & 0xff;
    model = stop >= 1 && stop <= 64 ? { kind: 'stopped', signal: stop } : { error: 'stop' };
  } else if (low === 0) {
    model = { kind: 'exited', code: (status >> 8) & 0xff };
  } else if (low === 0x7f) {
    model = { error: 'marker' };
  } else if (low > 64) {
    model = { error: 'signal' };
  } else {
    model = { kind: 'signaled', signal: low, core: (status & 0x80) !== 0 };
  }
  let result = null;
  let message = null;
  try { result = decode(String(status), 'raw'); } catch (error) { message = error.message; }
  if (model.error) {
    assert.ok(message, 'status ' + status + ' is refused');
    assert.match(message, model.error === 'stop' ? /marks a stopped process/
      : (model.error === 'marker' ? /sets the core bit on a stop marker/ : /above the 64 Linux signals/),
      'refusal wording at ' + status);
    refusals += 1;
    continue;
  }
  assert.equal(message, null, 'status ' + status + ' decodes');
  assert.equal(result.kind, model.kind, 'kind at ' + status);
  assert.equal(result.rawStatus, status, 'status round-trip at ' + status);
  assert.equal(result.hex, C.hex(status), 'hex at ' + status);
  assert.equal(result.big, C.hex(status), 'big text at ' + status);
  if (model.kind === 'exited') {
    assert.equal(result.exitCode, model.code, 'exit code at ' + status);
    assert.equal(result.shellCode, model.code, 'shell code at ' + status);
    assert.equal(result.signal, null, 'no signal at ' + status);
    assert.ok(result.rows.some((row) => row[1] === 'WIFEXITED true, WEXITSTATUS ' + model.code),
      'exit macros at ' + status);
  } else if (model.kind === 'signaled') {
    assert.equal(result.signal, model.signal, 'signal at ' + status);
    assert.equal(result.coreDumped, model.core, 'core flag at ' + status);
    assert.equal(result.shellCode, 128 + model.signal, 'shell code at ' + status);
    assert.equal(result.exitCode, null, 'no exit code at ' + status);
    assert.ok(result.headline.endsWith(model.core ? 'with a core dump' : ' without a core dump'),
      'core wording at ' + status);
    assert.ok(result.rows.some((row) => row[1] === 'WIFSIGNALED true, WTERMSIG ' + model.signal
      + ', WCOREDUMP ' + model.core), 'signal macros at ' + status);
  } else if (model.kind === 'stopped') {
    assert.equal(result.signal, model.signal, 'stop signal at ' + status);
    assert.equal(result.shellCode, null, 'no shell code while stopped');
    assert.ok(result.headline.startsWith('Stopped by '), 'stop headline at ' + status);
    assert.ok(result.rows.some((row) => row[1] === 'WIFSTOPPED true, WSTOPSIG ' + model.signal),
      'stop macros at ' + status);
  } else {
    assert.equal(result.shellCode, null, 'no shell code while continued');
    assert.equal(result.shellCode === null && result.exitCode === null, true, 'continued has neither code');
  }
  rawCases += 1;
}
assert.equal(rawCases + refusals, 65536, 'the whole 16-bit space is accounted for');
assert.ok(refusals > 0, 'some statuses are refused');

// ---- Golden identities for the common shell codes.
const golden = {
  0: 'Exited with code 0', 1: 'Exited with code 1', 126: 'Exited with code 126 (cannot execute)',
  127: 'Exited with code 127 (command not found)', 130: 'Killed by SIGINT (2)',
  134: 'Killed by SIGABRT (6)', 137: 'Killed by SIGKILL (9)', 139: 'Killed by SIGSEGV (11)',
  143: 'Killed by SIGTERM (15)', 255: 'Exited with code 255'
};
for (const [code, headline] of Object.entries(golden)) {
  assert.equal(decode(code, 'shell').headline, headline, 'headline for ' + code);
}
assert.equal(decode('0x008b', 'raw').headline, 'Killed by SIGSEGV (11) with a core dump');
assert.equal(decode('0x000b', 'raw').headline, 'Killed by SIGSEGV (11) without a core dump');
assert.equal(decode('32512', 'raw').exitCode, 127);
assert.equal(decode('32512', 'raw').shellCode, 127);
assert.equal(decode('0xffff', 'raw').kind, 'continued');
assert.equal(decode('0x1f7f', 'raw').signalText, 'SIGSYS (31)');
assert.equal(decode('0x147f', 'raw').headline, 'Stopped by SIGTSTP (20)');

// ---- Prefix handling and whitespace are tolerated, nothing else is.
assert.equal(decode('$? 139', 'shell').shellCode, 139);
assert.equal(decode('exit status 127', 'shell').exitCode, 127);
assert.equal(decode('exit code: 0x8b', 'shell').signal, 11);
assert.equal(decode('  139  ', 'shell').signal, 11);
assert.equal(decode('139', 'raw').signal, 11, 'raw 139 is signal 11 with no core bit');

// ---- Refusals, with the exact wording the page shows.
for (const [label, value, mode, message] of [
  ['empty', '', 'shell', 'Enter an exit code such as 139, or a raw wait status such as 0x008b.'],
  ['words', 'abc', 'shell', '"abc" is not a decimal number or a 0x hexadecimal value.'],
  ['negative', '-1', 'shell', 'An exit status cannot be negative; a process killed by a signal shows 128 + the signal number.'],
  ['shell over 255', '256', 'shell', 'A shell exit status is eight bits wide: enter 0 to 255, or switch to the raw wait status.'],
  ['hex shell over 255', '0x1ff', 'shell', 'A shell exit status is eight bits wide: enter 0 to 255, or switch to the raw wait status.'],
  ['raw over 65535', '65536', 'raw', 'A wait status is sixteen bits wide: enter 0 to 65535.'],
  ['fraction', '1.5', 'shell', '"1.5" is not a decimal number or a 0x hexadecimal value.'],
  ['bare prefix', '0x', 'shell', '"0x" is not a decimal number or a 0x hexadecimal value.'],
  ['exponent', '1e3', 'shell', '"1e3" is not a decimal number or a 0x hexadecimal value.'],
  ['plus sign', '+139', 'shell', '"+139" is not a decimal number or a 0x hexadecimal value.'],
  ['stop signal 0', '0x007f', 'raw', '0x007f marks a stopped process, but its stop signal is 0; the kernel writes stop signals 1 to 64.'],
  ['stop signal 65', '0x417f', 'raw', '0x417f marks a stopped process, but its stop signal is 65; the kernel writes stop signals 1 to 64.'],
  ['signal 65', '0x0041', 'raw', '0x0041 names signal 65, above the 64 Linux signals.'],
  ['unknown mode', '139', 'signal', 'Choose the shell exit code or the raw wait status.'],
  ['empty with prefix', '$?', 'shell', 'Enter a number after "$?".']
]) {
  assert.equal(failure(value, mode), message, label);
}

// ---- Determinism.
for (const [value, mode] of [['139', 'shell'], ['0x008b', 'raw'], ['0xffff', 'raw'], ['0', 'shell']]) {
  assert.deepEqual(decode(value, mode), decode(value, mode), 'deterministic: ' + value);
}

// ---- Catalog record and its cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Shell Exit Status Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(record.added, '2026-11-22T06:10:00Z');
assert.ok(record.description.length > 100, 'description is descriptive');
assert.ok(record.method.includes('128 + n'), 'method states the shell convention');
assert.ok(record.method.includes('WEXITSTATUS'), 'method states the exit-status byte');
assert.ok(record.method.includes('0xffff'), 'method names the continued status');
assert.ok(record.method.includes('126') && record.method.includes('127'), 'method states the 126 and 127 codes');
assert.ok(record.method.includes('indistinguishable'), 'method states the shell ambiguity');
assert.ok(record.method.includes('browser'), 'method documents local execution');
assert.equal(record.sources.length, 3, 'three references are cited');
assert.ok(record.sources.every((source) => typeof source.title === 'string' && source.title.length > 25),
  'every reference is titled specifically');
assert.ok(record.sources.every((source) => /^https:\/\//.test(source.url)), 'every reference carries a fetched URL');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 30, 'catalog case count');
assert.equal(kinds('golden'), 13, 'thirteen golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 12, 'twelve validation cases');

let replayed = 0;
for (const testCase of record.testCases) {
  const value = testCase.input.value;
  const mode = testCase.input.mode;
  if (testCase.kind === 'validation') {
    assert.equal(failure(value, mode), testCase.expectedError, testCase.name);
    continue;
  }
  const actual = decode(value, mode);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(actual[key], expected, testCase.name + ' ' + key);
    replayed += 1;
  }
  assert.ok(actual.headline.startsWith(actual.kind === 'exited' ? 'Exited' : ''), testCase.name + ' headline');
}

// The new record's slug, name and aliases must not collide with any other record.
const keyOwners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!keyOwners.has(folded)) keyOwners.set(folded, new Set());
    keyOwners.get(folded).add(tool.slug);
  }
}
for (const key of [record.slug, record.name].concat(record.aliases)) {
  assert.deepEqual(Array.from(keyOwners.get(String(key).toLowerCase())), [slug], 'catalog key is unique: ' + key);
}
assert.equal(new Set(record.aliases).size, record.aliases.length, 'aliases are internally unique');
assert.equal(new Set(record.tags).size, record.tags.length, 'tags are internally unique');
for (const tag of ['system', 'shell', 'exit-code', 'wait-status', 'signal']) {
  assert.ok(record.tags.includes(tag), 'new tag present: ' + tag);
}
assert.equal(catalog.tools.length, 2439, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2178, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'System').length, 54, 'system records');

// ---- Page contract: shared assets, labelled controls, no storage or network.
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
const requestedIds = [...html.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]);
assert.ok(requestedIds.length >= 7, 'the page looks up its controls');
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/<label[^>]*for="value">/.test(html) && /<label[^>]*for="mode">/.test(html), 'both controls are labelled');
assert.ok(/<option value="shell" selected>/.test(html), 'the shell code is the default mode');
assert.ok(/<option value="raw">/.test(html), 'the raw status is offered');
assert.ok(/id="value"[^>]*value="139"/.test(html), 'the default value is in the markup');
assert.equal((html.match(/class="chip"/g) || []).length, 7, 'seven common values are offered');
assert.equal((html.match(/data-mode="shell"/g) || []).length, 6, 'six shell chips');
assert.equal((html.match(/data-mode="raw"/g) || []).length, 1, 'one raw chip');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'errors are announced');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'controls keep a touch-sized target');
assert.ok(/min-height:46px/.test(html), 'the input keeps a comfortable height');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/inputmode="numeric"/.test(html), 'a numeric keyboard is offered on touch');
assert.ok(/@media \(max-width:560px\)/.test(html), 'the layout has a narrow breakpoint');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/https?:\/\//.test(html), 'no external URLs');
assert.ok(!/<img\b|<iframe\b|@import/.test(html), 'no foreign assets');
assert.ok(!/[^\x00-\x7F]/.test(html), 'the page source stays ASCII');

console.log('shell exit status decoder: ' + shellCases + ' shell codes, ' + rawCases + ' raw statuses, '
  + refusals + ' refusals, ' + replayed + ' replayed catalog values and the page contract pass');
