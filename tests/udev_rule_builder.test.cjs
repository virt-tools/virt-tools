/* Regression checks for the udev rule builder: every catalogued case run
   against the page's own core, a second composer written here independently,
   a strict parse of every composed line, the refusal table, and the page's
   offline contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'udev-rule-builder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* udevrule-core:start */');
const end = html.indexOf('/* udevrule-core:end */');
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, html.indexOf('*/', end) + 2);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = UdevRuleCore;', sandbox);
const C = sandbox.module.exports;

const run = (input) => C.run(input);
const failure = (input) => {
  try {
    run(input);
  } catch (error) {
    return error.message;
  }
  return null;
};
const withCount = (input) => {
  const result = run(input);
  result.warningCount = result.warnings.length;
  return result;
};

// A strict parser for composed rule lines, used by every layer below.
const CLAUSE = [
  /^SUBSYSTEM=="[^"\\]+"$/,
  /^KERNEL=="[^"\\]+"$/,
  /^(?:ATTR|ATTRS)\{[A-Za-z0-9_]+\}=="[^"\\]*"$/,
  /^SYMLINK\+="[^"\\]+"$/,
  /^OWNER="[^"\\]+"$/,
  /^GROUP="[^"\\]+"$/,
  /^MODE="0[0-7]{3}"$/,
];
function parseRule(rule) {
  assert.ok(typeof rule === 'string' && rule.length && rule.length <= 512, 'rule must be a short string');
  assert.ok(!/[\n\r\t]/.test(rule), 'rule must be one line');
  const clauses = rule.split(', ');
  const kinds = [];
  for (const clause of clauses) {
    const match = CLAUSE.findIndex((pattern) => pattern.test(clause));
    assert.ok(match >= 0, 'unexpected clause: ' + clause);
    assert.equal((clause.match(/"/g) || []).length % 2, 0, 'unbalanced quotes in ' + clause);
    kinds.push(match);
  }
  assert.equal(kinds[0], 0, 'SUBSYSTEM must come first');
  const ranks = kinds.map((kind) => (kind === 2 ? 2 : kind));
  for (let i = 1; i < ranks.length; i += 1) {
    assert.ok(ranks[i] >= ranks[i - 1], 'clauses must keep the canonical order: ' + rule);
  }
  return clauses;
}

// --- contract of the page itself -------------------------------------------
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket|sendBeacon/.test(html),
  'page must not use the network or storage');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'page must not load remote scripts');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'page must not load remote styles');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'page must not use inline handlers');
assert.ok(html.includes('<form id="rule-form"'), 'form missing');
assert.ok(html.includes('aria-live="polite"'), 'result region must be announced');
assert.ok(html.includes('role="alert"'), 'error region must be announced');
assert.ok(html.includes('novalidate'), 'form must let the tool report its own errors');
for (const id of ['subsystem', 'kernel', 'match', 'attr1-name', 'attr1-value', 'attr2-name', 'attr2-value',
  'symlink', 'owner', 'group', 'mode']) {
  assert.ok(html.includes('id="in-' + id + '"'), 'control ' + id + ' missing');
  assert.ok(html.includes('for="in-' + id + '"'), 'label ' + id + ' missing');
}
assert.ok(html.includes('/assets/app.js'), 'shared script missing');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet missing');
assert.ok(html.includes('type="submit"'), 'submit button missing');
assert.ok(html.includes('id="reset"'), 'reset button missing');
assert.ok(html.includes('area.readOnly = true'), 'output must be read-only');
assert.ok(html.includes('aria-atomic="true"'), 'result region must be announced as one unit');

// --- catalog entry -----------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'catalog entry missing');
assert.equal(entry.name, 'udev Rule Builder');
assert.equal(entry.category, 'System');
assert.equal(entry.subcategory, 'Generation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 900, 'method must explain the rule grammar and limits');
assert.ok(entry.sources.length >= 2, 'expected at least two sources');
for (const source of entry.sources) assert.ok(/^https:\/\//.test(source.url), 'source URL missing');
assert.ok(entry.testCases.length >= 28, 'expected at least twenty-eight catalog cases');
for (const kind of ['golden', 'boundary', 'validation']) {
  assert.ok(entry.testCases.some((testCase) => testCase.kind === kind), 'missing ' + kind + ' case');
}

// Every page default must be the catalogued default sample, so the first
// render on load is the documented example.
const defaults = C.DEFAULTS;
const sample = entry.testCases.find((testCase) => testCase.name === 'Default FTDI adapter');
assert.ok(sample, 'default sample case missing');
for (const field of Object.keys(defaults)) {
  assert.equal(defaults[field], sample.input[field], 'default ' + field);
  const markup = new RegExp('id="in-' + field.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + '"[^>]*value="([^"]*)"');
  const match = markup.exec(html);
  if (field === 'matchMode') continue;
  assert.ok(match, 'page input for ' + field + ' missing');
  assert.equal(match[1], sample.input[field], 'page default ' + field);
}
assert.ok(/<option value="parent" selected>/.test(html), 'parent attribute target must be selected');

// --- every catalogued case ----------------------------------------------------
const compared = ['rule', 'filename', 'clauseCount', 'ruleLength', 'matchMode', 'symlink', 'devicePath'];
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    assert.equal(failure(testCase.input), testCase.expectedError, testCase.name);
    continue;
  }
  const result = withCount(testCase.input);
  const expected = testCase.expected;
  for (const field of compared) {
    assert.equal(result[field], expected[field], testCase.name + ' ' + field);
  }
  assert.equal(result.warningCount, expected.warningCount, testCase.name + ' warningCount');
  assert.equal(result.rule, parseRule(result.rule).join(', '), testCase.name + ' rule must round-trip');
  assert.equal(result.clauseCount, result.rule.split(', ').length, testCase.name + ' clause count');
  assert.equal(result.ruleLength, result.rule.length, testCase.name + ' rule length');
}

// --- a second composer, written independently of the page ---------------------
function expectRule(parts) {
  const clauses = ['SUBSYSTEM=="' + parts.subsystem + '"'];
  if (parts.kernel) clauses.push('KERNEL=="' + parts.kernel + '"');
  if (parts.attr1Name) clauses.push(parts.matchMode + '{' + parts.attr1Name + '}=="' + parts.attr1Value + '"');
  if (parts.attr2Name) clauses.push(parts.matchMode + '{' + parts.attr2Name + '}=="' + parts.attr2Value + '"');
  if (parts.symlink) clauses.push('SYMLINK+="' + parts.symlink + '"');
  if (parts.owner) clauses.push('OWNER="' + parts.owner + '"');
  if (parts.group) clauses.push('GROUP="' + parts.group + '"');
  if (parts.mode) clauses.push('MODE="' + parts.mode + '"');
  return clauses.join(', ');
}

const subsystems = ['tty', 'usb', 'block', 'net'];
const kernels = ['', 'ttyUSB*', 'sd[a-z]', 'eth0'];
const pairs = [
  ['idVendor', '0403', 'idProduct', '6001'],
  ['serial', 'FT*A1*', '', ''],
  ['', '', '', ''],
];
const assigns = [
  ['ttyFTDI0', '', 'dialout', '0660'],
  ['', 'root', 'disk', '0640'],
  ['sensor0', '1000', '', ''],
  ['', '', '', ''],
];
let grid = 0;
for (const subsystem of subsystems) {
  for (const kernel of kernels) {
    for (const pair of pairs) {
      for (const assign of assigns) {
        for (const matchMode of ['parent', 'device']) {
          const parts = {
            subsystem, kernel, matchMode,
            attr1Name: pair[0], attr1Value: pair[1], attr2Name: pair[2], attr2Value: pair[3],
            symlink: assign[0], owner: assign[1], group: assign[2],
            mode: assign[3] === '0660' ? '660' : assign[3],
          };
          const result = run(parts);
          const keyword = matchMode === 'parent' ? 'ATTRS' : 'ATTR';
          const expected = expectRule({
            subsystem, kernel, symlink: assign[0], owner: assign[1], group: assign[2],
            mode: assign[3] ? '0' + assign[3].slice(-3) : '',
            attr1Name: pair[0], attr1Value: pair[1], attr2Name: pair[2], attr2Value: pair[3],
            matchMode: keyword,
          });
          assert.equal(result.rule, expected, 'grid rule ' + JSON.stringify(parts));
          assert.equal(result.matchMode, keyword, 'grid keyword');
          parseRule(result.rule);
          assert.equal(result.filename, '99-' + (assign[0] || subsystem).toLowerCase() + '.rules', 'grid file name');
          assert.equal(result.devicePath, assign[0] ? '/dev/' + assign[0] : null, 'grid device path');
          assert.ok(result.ruleLength === result.rule.length);
          // Re-running the same input must be deterministic.
          assert.equal(run(parts).rule, result.rule, 'grid must be deterministic');
          grid += 1;
        }
      }
    }
  }
}
assert.ok(grid >= 180, 'grid too small');

// --- refusal table beyond the catalog ---------------------------------------
const refusals = [
  [{ kernel: 'a'.repeat(129) }, 'A kernel name pattern is at most 128 characters.'],
  [{ attr1Value: 'v'.repeat(129) }, 'An attribute value is at most 128 characters.'],
  [{ symlink: 'x'.repeat(64) }, 'A link name is one path component of at most 63 characters.'],
  [{ owner: '1'.repeat(11) }, 'A user is a name of letters, digits, dots, underscores and hyphens, or a numeric id.'],
  [{ group: '-dialout' }, 'A group is a name of letters, digits, dots, underscores and hyphens, or a numeric id.'],
  [{ mode: '77777' }, 'MODE is three or four octal digits from 0 to 7, such as 0660.'],
  [{ matchMode: 'parent-' }, 'Choose whether the attribute match reads the device itself or a parent device.'],
  [{ kernel: 'tty]USB' }, 'A kernel name pattern closes a character class before opening one.'],
  [{ attr2Name: 'ser ial' }, 'Attribute match 2 name is letters, digits and underscores only, as sysfs shows it (idVendor, product, serial).'],
  [{ attr2Name: 'serial', attr2Value: '  ' }, 'ATTRS{serial} needs a value; clear the name to drop this match.'],
];
for (const [changes, expectedError] of refusals) {
  assert.equal(failure(Object.assign({}, defaults, changes)), expectedError, JSON.stringify(changes));
}

// A rule with no assignment and no narrowing must carry both warnings.
const loose = withCount(Object.assign({}, defaults, {
  kernel: '', attr1Name: '', attr1Value: '', attr2Name: '', attr2Value: '',
  symlink: '', owner: '', group: '', mode: '',
}));
assert.equal(loose.warningCount, 2, 'an unconstrained rule must warn twice');
assert.equal(loose.clauseCount, 1);
assert.equal(loose.rule, 'SUBSYSTEM=="tty"');

// Blank optional fields must leave no empty clauses behind.
const bare = run(Object.assign({}, defaults, {
  kernel: '', attr1Name: '', attr1Value: '', attr2Name: '', attr2Value: '', owner: '',
}));
assert.equal(bare.rule, 'SUBSYSTEM=="tty", SYMLINK+="ttyFTDI0", GROUP="dialout", MODE="0660"');
assert.equal(parseRule(bare.rule).length, 4);

// The reload commands must follow the composed rule.
const commands = run(defaults).commands;
assert.equal(commands[0], 'sudo udevadm control --reload-rules');
assert.equal(commands[1], 'sudo udevadm trigger --subsystem-match=tty');
assert.equal(commands[2], 'udevadm info --query=all --name=/dev/ttyFTDI0');
assert.equal(run(Object.assign({}, defaults, { symlink: '' })).commands.length, 2);

console.log('udev rule builder: ' + entry.testCases.length + ' catalog cases and ' + grid +
  ' grid rows verified, ' + refusals.length + ' extra refusals');
