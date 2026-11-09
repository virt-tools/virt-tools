/* Regression checks for the syslog priority decoder core, its catalog cases and
   the page's offline, no-storage contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'syslog-priority-decoder';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* syslog-priority-core:start */');
const end = html.indexOf('/* syslog-priority-core:end */');
assert.ok(start > -1 && end > start, 'syslog priority core markers missing');
const core = html.slice(start, end + '/* syslog-priority-core:end */'.length);
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = SyslogPriorityCore;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const decode = (text) => plain(C.decode(text));
const failure = (text) => {
  try {
    decode(text);
  } catch (error) {
    return error.message;
  }
  return null;
};

const facilities = plain(C.FACILITIES);
const severities = plain(C.SEVERITIES);

// ---- Tables: RFC 5424 section 6.2.1, 24 facilities and 8 severities.
assert.equal(C.MIN, 0);
assert.equal(C.MAX, 191);
assert.equal(facilities.length, 24, 'facility count');
assert.equal(severities.length, 8, 'severity count');
assert.deepEqual(facilities.map((entry) => entry[0]), Array.from({ length: 24 }, (_, i) => i), 'facility codes');
assert.deepEqual(severities.map((entry) => entry[0]), Array.from({ length: 8 }, (_, i) => i), 'severity codes');
assert.equal(new Set(facilities.map((entry) => entry[1])).size, 24, 'facility keywords are unique');
assert.equal(new Set(severities.map((entry) => entry[1])).size, 8, 'severity keywords are unique');
assert.equal(facilities[0][1], 'kern');
assert.equal(facilities[4][1], 'auth');
assert.equal(facilities[10][1], 'authpriv');
assert.equal(facilities[13][1], 'security');
assert.equal(facilities[15][1], 'solaris-cron');
assert.equal(facilities[16][1], 'local0');
assert.equal(facilities[23][1], 'local7');
assert.deepEqual(severities.map((entry) => entry[1]), ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']);
for (const entry of facilities) {
  assert.ok(entry[2].length > 4, `${entry[1]} has a description`);
}
for (const entry of severities) {
  assert.ok(entry[2].length > 3 && entry[3].length > 5, `${entry[1]} has a name and meaning`);
}

// ---- Every one of the 192 priorities, through all three input forms.
for (let n = 0; n <= 191; n += 1) {
  const facility = facilities[Math.floor(n / 8)];
  const severity = severities[n % 8];
  for (const input of [String(n), `<${n}>`, `${facility[1]}.${severity[1]}`]) {
    const result = decode(input);
    assert.equal(result.priority, n, `priority for ${input}`);
    assert.equal(result.facilityCode, facility[0], `facility code for ${input}`);
    assert.equal(result.facilityKeyword, facility[1], `facility keyword for ${input}`);
    assert.equal(result.facilityName, facility[2], `facility name for ${input}`);
    assert.equal(result.severityCode, severity[0], `severity code for ${input}`);
    assert.equal(result.severityKeyword, severity[1], `severity keyword for ${input}`);
    assert.equal(result.severityName, severity[2], `severity name for ${input}`);
    assert.equal(result.severityMeaning, severity[3], `severity meaning for ${input}`);
    assert.equal(result.journalPriority, severity[1], `journal priority for ${input}`);
    assert.equal(result.arithmetic, `${facility[0]} \u00d7 8 + ${severity[0]} = ${n}`, `arithmetic for ${input}`);
  }
}

// Every facility with every severity is reachable and distinct, in order.
const seen = new Set();
for (const facility of facilities) {
  for (const severity of severities) {
    const result = decode(`${facility[1]}.${severity[1]}`);
    assert.equal(result.facilityCode, facility[0]);
    assert.equal(result.severityCode, severity[0]);
    seen.add(result.priority);
  }
}
assert.equal(seen.size, 192, 'all 192 facility/severity combinations are distinct');

// ---- Spelled-out anchors that are easy to check by hand.
assert.equal(decode('<34>').facilityKeyword, 'auth');
assert.equal(decode('<34>').severityKeyword, 'crit');
assert.equal(decode('13').facilityKeyword, 'user');
assert.equal(decode('13').severityKeyword, 'notice');
assert.equal(decode('127').facilityKeyword, 'solaris-cron');
assert.equal(decode('127').severityKeyword, 'debug');
assert.equal(decode('106').facilityKeyword, 'security');
assert.equal(decode('106').severityKeyword, 'crit');

// Numeric parts, aliases and case handling inside a pair.
assert.equal(decode('4.2').priority, 34);
assert.equal(decode('23.7').priority, 191);
assert.equal(decode('auth.3').severityKeyword, 'err');
assert.equal(decode('auth.0').severityKeyword, 'emerg');
assert.equal(decode('auth.panic').priority, 32, 'panic is an alias of emerg');
assert.equal(decode('auth.emergency').priority, 32, 'emergency is an alias of emerg');
assert.equal(decode('auth.critical').severityKeyword, 'crit');
assert.equal(decode('auth.warn').severityKeyword, 'warning');
assert.equal(decode('auth.informational').severityKeyword, 'info');
assert.equal(decode('kernel.crit').priority, 2, 'kernel is an alias of kern');
assert.equal(decode('  AUTH . CRIT  ').priority, 34, 'surrounding spaces are ignored');

// ---- Full log lines decode from the leading priority only.
assert.equal(decode('<134>1 2026-11-09T05:00:00Z host app 123 ID47 - started').priority, 134);
assert.equal(decode('<11>Nov  9 05:00:00 host app: failed').priority, 11);
assert.equal(decode('<0>1 - - - - - emergency').severityKeyword, 'emerg');
assert.equal(decode('<191>1 - - - - - everything').facilityKeyword, 'local7');

// ---- Errors name the problem.
assert.match(failure(''), /Enter a priority such as <34>/);
assert.match(failure('   '), /Enter a priority such as <34>/);
for (const input of ['<34', '<>', '<abc>', '< 34>']) {
  assert.match(failure(input), /A priority in angle brackets must look like <34>/, input);
}
for (const input of ['192', '<192>', '999', '999999999999999999999', '<999999999999999999999>']) {
  assert.match(failure(input), /A syslog priority runs from 0 to 191/, input);
}
for (const input of ['034', '<000>', '<00>', '00']) {
  assert.match(failure(input), /RFC 5424 writes the priority without leading zeros/, input);
}
assert.equal(decode('0').priority, 0, 'a single zero is valid');
assert.equal(decode('<0>').priority, 0, 'a single bracketed zero is valid');
assert.match(failure('nosuch.crit'), /"nosuch" is not a syslog facility/);
assert.match(failure('24.crit'), /"24" is not a syslog facility/);
assert.match(failure('auth.nosuch'), /"nosuch" is not a syslog severity/);
assert.match(failure('auth.8'), /"8" is not a syslog severity/);
assert.match(failure('.crit'), /Enter a facility keyword before the dot/);
assert.match(failure('auth.'), /Enter a severity keyword after the dot/);
assert.match(failure('auth.crit.extra'), /has more than one dot/);
for (const input of ['0x22', '-1', '34 extra', 'auth crit', 'crit', 'local']) {
  assert.match(failure(input), /is not a priority, a number from 0 to 191, or a facility\.severity pair/, input);
}

// The page must not reach the network, store data or use inline handlers.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/.test(html), 'page uses storage or network APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="pri-form"/.test(html), 'page has a form');
assert.ok(/type="submit"/.test(html), 'page has a submit button');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/<label class="f" for="pri">/.test(html), 'the input is labelled');
assert.ok(/id="sev-list"/.test(html) && /id="fac-list"/.test(html), 'reference tables are present');
assert.equal((html.match(/class="chip"/g) || []).length, 5, 'five common-priority shortcuts');
for (const match of html.matchAll(/class="chip" data-value="([^"]+)"/g)) {
  const result = decode(match[1]);
  assert.ok(result.priority >= 0 && result.priority <= 191, 'chip decodes: ' + match[1]);
}

// Catalog record and test cases must agree with the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
assert.equal(record.name, 'Syslog Priority Decoder');
assert.equal(record.category, 'System');
assert.equal(record.subcategory, 'Reference');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'), 'method documents local execution');
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 32, 'catalog case count');
assert.equal(kinds('golden'), 10, 'ten golden cases');
assert.equal(kinds('boundary'), 5, 'five boundary cases');
assert.equal(kinds('validation'), 17, 'seventeen validation cases');
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    assert.throws(
      () => C.decode(input.pri),
      new RegExp(expected.error.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      testCase.name
    );
    continue;
  }
  const result = decode(input.pri);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(result[key], value, `${testCase.name} ${key}`);
  }
}

console.log('syslog-priority-decoder: all checks passed ('
  + record.testCases.length + ' catalog cases, 192 priorities, ' + facilities.length + ' facilities, ' + severities.length + ' severities)');
