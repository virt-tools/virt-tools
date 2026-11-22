/* Regression checks for the Kubernetes resource quantity core.
 *
 * The arithmetic is checked against an independent rational oracle written here
 * with BigInt: a quantity is read as numerator/denominator over a power of ten,
 * rounded up to milli precision by integer division, and summed in milli units.
 * That is a different representation from the page's (mantissa, scale) pair, so
 * a sign, scale or suffix mistake cannot agree with itself. The published rules
 * come from the Kubernetes Quantity grammar (Ki..Ei, m and k..E, exponents, the
 * 2^63-1 limit, three decimal places, rounding up) and are pinned below.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'kubernetes-resource-quantity-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* k8s-quantity-core:start */');
const end = html.indexOf('/* k8s-quantity-core:end */');
assert.ok(start > -1 && end > start, 'quantity core markers missing');
const core = html.slice(start, end + '/* k8s-quantity-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = K8sQuantityCore;', sandbox);
const C = sandbox.module.exports;

// ---- Independent oracle: exact rationals over powers of ten.
const SUFFIX_FACTOR = {
  '': [1n, 0], m: [1n, 3], k: [1000n, 0], M: [1000000n, 0], G: [1000000000n, 0],
  T: [1000000000000n, 0], P: [1000000000000000n, 0], E: [1000000000000000000n, 0],
  Ki: [1024n, 0], Mi: [1048576n, 0], Gi: [1073741824n, 0],
  Ti: [1099511627776n, 0], Pi: [1125899906842624n, 0], Ei: [1152921504606846976n, 0]
};

function oracleValue(raw) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?(Ki|Mi|Gi|Ti|Pi|Ei|m|k|M|G|T|P|E)?$/.exec(String(raw).trim());
  if (!match) throw new Error(`oracle cannot parse ${raw}`);
  const fraction = match[3] !== undefined ? match[3] : (match[4] || '');
  let numerator = BigInt((match[2] || '') + fraction);
  if (match[1] === '-') numerator = -numerator;
  let scale = fraction.length - (match[5] ? Number(match[5]) : 0);
  const suffix = match[6] || '';
  if (!(suffix in SUFFIX_FACTOR)) throw new Error(`oracle has no factor for ${suffix}`);
  const [factor, extraScale] = SUFFIX_FACTOR[suffix];
  numerator *= factor;
  scale += extraScale;
  const denominator = 10n ** BigInt(scale);
  return { numerator, denominator };
}

// Round a rational up to the nearest 0.001 in magnitude, as Kubernetes does.
function oracleMilli({ numerator, denominator }) {
  const magnitude = numerator < 0n ? -numerator : numerator;
  const units = (magnitude * 1000n + denominator - 1n) / denominator;
  return numerator < 0n ? -units : units;
}

function oracleDecimal(milliUnits) {
  const negative = milliUnits < 0n;
  let digits = (negative ? -milliUnits : milliUnits).toString();
  while (digits.length <= 3) digits = '0' + digits;
  let text = digits.slice(0, digits.length - 3) + '.' + digits.slice(digits.length - 3);
  text = text.replace(/\.?0+$/, '');
  return (negative ? '-' : '') + (text === '' || text === '-' ? '0' : text);
}

// ---- 1. Worked examples from the documentation, by hand.
// 123Mi = 123 x 2^20 bytes, and the API reference calls 128974848, 129e6, 129M,
// 128974848000m and 123Mi roughly equal amounts of memory.
const mib = C.convert({ kind: 'memory', text: '123Mi' });
assert.equal(mib.rows[0].exact, '128974848', '123Mi is 128974848 bytes');
assert.equal(mib.rows[0].binary, '123MiB');
assert.equal(mib.totalHuman, '123MiB');
assert.equal(mib.totalHumanApprox, false);

const gi = C.convert({ kind: 'memory', text: '1.5Gi' });
assert.equal(gi.rows[0].exact, '1610612736', '1.5Gi is 1536 x 2^20 bytes');
assert.equal(gi.rows[0].binary, '1536MiB', 'the API reference canonicalises 1.5Gi as 1536Mi');
assert.equal(gi.totalHuman, '1.50GiB');
assert.equal(gi.totalHumanApprox, true, '1.5Gi is not a whole number of GiB');

const millibytes = C.convert({ kind: 'memory', text: '128974848000m' });
assert.equal(millibytes.rows[0].exact, mib.rows[0].exact, '128974848000m equals 123Mi');
assert.equal(millibytes.warnings.length, 0, 'whole bytes raise no warning');

// 0.1 core and 100m are the same quantity, and the page sample adds to 2 cores.
const tenth = C.convert({ kind: 'cpu', text: '0.1' });
assert.equal(tenth.totalExact, '0.1');
assert.equal(tenth.totalMilli, '100');
const sample = C.convert({ kind: 'cpu', text: C.DEFAULTS.cpu });
assert.equal(sample.totalExact, '2', '0.25 + 1.5 + 250m is two cores');
assert.equal(sample.totalMilli, '2000');
assert.equal(sample.count, 3);
assert.equal(sample.rows[2].name, 'sidecar', 'names are kept');

// 1Ei is 2^60 bytes and 2^63-1 is accepted, 2^63 is not.
const ei = C.convert({ kind: 'memory', text: '1Ei' });
assert.equal(ei.rows[0].exact, (2n ** 60n).toString());
const limit = C.convert({ kind: 'memory', text: '9223372036854775807' });
assert.equal(limit.rows[0].exact, '9223372036854775807');
assert.throws(() => C.convert({ kind: 'memory', text: '9223372036854775808' }),
  /larger than 2\^63-1/);

// ---- 2. Identities that must hold for every accepted quantity.
const pairs = [['1', 1], ['0.5', 0.5], ['250m', 0.25], ['1.5', 1.5], ['0.001', 0.001]];
for (const [raw, expected] of pairs) {
  const one = C.convert({ kind: 'cpu', text: raw });
  assert.equal(Number(one.totalExact), expected, `${raw} reads back as a number`);
}
assert.equal(C.convert({ kind: 'cpu', text: '1.25' }).totalMilli,
  C.convert({ kind: 'cpu', text: '1250m' }).totalMilli, '1.25 is 1250m');
assert.equal(C.convert({ kind: 'memory', text: '1e3' }).rows[0].exact,
  C.convert({ kind: 'memory', text: '1k' }).rows[0].exact, 'exponent and suffix agree');
assert.equal(C.convert({ kind: 'memory', text: '129e6' }).rows[0].exact, '129000000');
assert.equal(C.convert({ kind: 'memory', text: '129M' }).rows[0].exact, '129000000');
assert.equal(C.convert({ kind: 'memory', text: '.5Gi' }).rows[0].exact, (2n ** 29n).toString());
assert.equal(C.convert({ kind: 'memory', text: '+1Ki' }).rows[0].exact, '1024');
assert.equal(C.convert({ kind: 'memory', text: '12.' }).rows[0].exact, '12');

// Doubling every line doubles the total, and the name-less form parses too.
const single = C.convert({ kind: 'memory', text: '250Mi' });
const doubled = C.convert({ kind: 'memory', text: '250Mi\n250Mi' });
assert.equal(doubled.totalExact, (2n * BigInt(single.totalExact)).toString());

// Case matters: 1M is a million bytes while 1m is a thousandth of one.
assert.equal(C.convert({ kind: 'memory', text: '1M' }).rows[0].exact, '1000000');
assert.equal(C.convert({ kind: 'memory', text: '1m' }).rows[0].exact, '0.001');

// The documented round-up: 0.0001 is stored as 1m, and 0.1m (0.0001) as 1m.
const rounded = C.convert({ kind: 'cpu', text: '0.0001' });
assert.equal(rounded.totalExact, '0.001');
assert.equal(rounded.totalMilli, '1');
assert.equal(rounded.warnings.length, 1);
assert.match(rounded.warnings[0], /0\.0001 is stored as 0\.001/);

// ---- 3. Grid against the rational oracle, in memory units so every suffix is
// reachable. Values are compared exactly; the round-up has no tie to skip.
let seed = 20261117;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const suffixes = ['', 'm', 'k', 'M', 'G', 'T', 'P', 'E', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei'];
let compared = 0;
for (let index = 0; index < 900; index += 1) {
  const whole = Math.floor(random() * 90000);
  const fractionLength = Math.floor(random() * 5);
  let fraction = '';
  for (let digit = 0; digit < fractionLength; digit += 1) fraction += Math.floor(random() * 10);
  const suffix = suffixes[Math.floor(random() * suffixes.length)];
  const raw = fractionLength ? `${whole}.${fraction}${suffix}` : `${whole}${suffix}`;
  const oracle = oracleValue(raw);
  const expectedMilli = oracleMilli(oracle);
  if (expectedMilli === 0n) continue;
  if ((expectedMilli < 0n ? -expectedMilli : expectedMilli) > 9223372036854775807n * 1n) continue;
  let result;
  try {
    result = C.convert({ kind: 'memory', text: raw });
  } catch (error) {
    // Out-of-range quantities are expected above 2^63-1; anything else is a bug.
    assert.match(error.message, /larger than 2\^63-1/, `${raw}: unexpected refusal`);
    continue;
  }
  assert.equal(result.rows[0].milli, expectedMilli.toString(), `milli units for ${raw}`);
  assert.equal(result.totalExact, oracleDecimal(expectedMilli), `base value for ${raw}`);
  compared += 1;
}
assert.ok(compared > 450, `grid should compare more than 450 lines, compared ${compared}`);

// A grid of several lines, summed: the oracle sums milli units independently.
// The suffixes stay below 2^63 for a mantissa under 5,000 so every line is valid.
const summable = ['', 'm', 'k', 'M', 'G', 'Ki', 'Mi', 'Gi'];
for (let round = 0; round < 40; round += 1) {
  const lines = [];
  let expected = 0n;
  for (let line = 0; line < 4; line += 1) {
    const whole = Math.floor(random() * 5000);
    const suffix = summable[Math.floor(random() * summable.length)];
    const raw = `${whole}${suffix}`;
    lines.push(raw);
    expected += oracleMilli(oracleValue(raw));
  }
  if (expected === 0n) continue;
  const result = C.convert({ kind: 'memory', text: lines.join('\n') });
  assert.equal(result.totalExact, oracleDecimal(expected), `total for ${lines.join(' + ')}`);
}

// ---- 4. Refusals and warnings.
const grammar = 'is not a Kubernetes quantity.';
const refusals = [
  ['', 'Enter at least one quantity, one per line.', 'cpu'],
  ['1.5MiB', 'Line 1: "1.5MiB" ' + grammar, 'memory'],
  ['abc', 'Line 1: "abc" ' + grammar, 'memory'],
  ['1e', 'Line 1: "1e" ' + grammar, 'memory'],
  ['1e3Gi', 'Line 1: "1e3Gi" ' + grammar, 'memory'],
  ['1 m', 'Line 1: "1 m" ' + grammar, 'memory'],
  ['1mi', 'Line 1: "1mi" ' + grammar, 'memory'],
  ['app = ', 'Line 1: the name needs a quantity after the "=" sign.', 'cpu'],
  ['= 5', 'Line 1: put a name before the "=" sign, or remove it.', 'cpu']
];
for (const [text, fragment, kind] of refusals) {
  assert.throws(() => C.convert({ kind, text }), (error) => {
    assert.ok(error.message.startsWith(fragment), `${JSON.stringify(text)}: ${error.message}`);
    return true;
  });
}
assert.throws(() => C.convert({ kind: 'cpu', text: '1Mi' }), /binary suffixes like Mi are for memory/);
assert.throws(() => C.convert({ kind: 'cpu', text: '1M' }), /the suffix M is for memory and storage/);
assert.throws(() => C.convert({ kind: 'cpu', text: '1k' }), /the suffix k is for memory and storage/);

const smallMemory = C.convert({ kind: 'memory', text: '400m' });
assert.equal(smallMemory.totalExact, '0.4');
assert.equal(smallMemory.warnings.length, 1);
assert.match(smallMemory.warnings[0], /did you mean 400Mi or 400M\?/);

// Comments and blank lines are skipped, and the line count is capped.
const skipped = C.convert({ kind: 'cpu', text: '# limits\n\n0.5\n\n# done\n0.5' });
assert.equal(skipped.count, 2);
assert.equal(skipped.totalExact, '1');
const many = Array.from({ length: 41 }, () => '1').join('\n');
assert.throws(() => C.convert({ kind: 'cpu', text: many }), /at most 40 quantities/);

// ---- 5. Catalog replay: every stored case, against the core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record missing');
for (const testCase of record.testCases) {
  if (testCase.expectedError) {
    assert.throws(() => C.convert(testCase.input), (error) => {
      assert.equal(error.message, testCase.expectedError, `${testCase.name}: wrong refusal`);
      return true;
    }, `${testCase.name}: expected a refusal`);
    continue;
  }
  const result = C.convert(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (field === 'warningCount') {
      assert.equal(result.warnings.length, value, `${testCase.name}: warning count`);
      continue;
    }
    assert.equal(result[field], value, `${testCase.name}: ${field}`);
  }
}

// ---- 6. Record metadata, totals and uniqueness against the whole catalog.
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.length, 2445, 'catalog records');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2184, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(record.name, 'Kubernetes Resource Quantity Converter');
assert.equal(record.category, 'Developer');
assert.equal(record.subcategory, 'Conversion');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.equal(record.reviewedAt, null);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Developer').length, 54,
  'Developer count');
assert.equal(record.sources.length, 3, 'three sources');
assert.ok(record.sources.every((entry) => /^https:\/\//.test(entry.url)), 'every source is https');
assert.ok(record.sources.some((entry) => entry.url.endsWith('/common-definitions/quantity/')),
  'Quantity reference cited');
assert.ok(record.sources.some((entry) => entry.url.includes('manage-resources-containers')),
  'resource units page cited');
assert.ok(record.sources.some((entry) => entry.url.includes('apimachinery') && entry.url.endsWith('quantity.go')),
  'apimachinery source cited');
assert.ok(typeof record.method === 'string' && record.method.length > 1200, 'method documented');
assert.ok(typeof record.guidance === 'string' && record.guidance.length > 200, 'guidance present');
assert.ok(record.aliases.length >= 6 && new Set(record.aliases).size === record.aliases.length, 'aliases unique');
assert.ok(record.tags.length >= 6 && new Set(record.tags).size === record.tags.length, 'tags unique');
assert.ok(record.description.length > 80, 'description present');
assert.equal(record.testCases.length, 18, 'catalog cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'golden').length, 6, 'golden cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'boundary').length, 6, 'boundary cases');
assert.equal(record.testCases.filter((testCase) => testCase.kind === 'validation').length, 6, 'validation cases');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug unique');
for (const other of catalog.tools) {
  if (other.slug === slug) continue;
  assert.notEqual(other.name, record.name, `name collides with ${other.slug}`);
  for (const alias of record.aliases) {
    assert.ok(!(other.aliases || []).map((value) => value.toLowerCase()).includes(alias.toLowerCase()),
      `alias ${alias} collides with ${other.slug}`);
  }
}

// ---- 7. Page contract: offline, keyboard-submittable, mobile-safe.
assert.ok(html.includes('id="kq-form"'), 'form present');
for (const id of ['in-kind', 'in-list', 'out', 'err', 'summary', 'result-table', 'warnings']) {
  assert.ok(html.includes(`id="${id}"`), `missing ${id}`);
}
for (const id of ['in-kind', 'in-list']) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(html), `label for ${id}`);
}
assert.ok(/<button\b[^>]*type="submit"/.test(html), 'submit button present');
assert.ok(html.includes('aria-live="polite"'), 'results are announced');
assert.ok(html.includes('role="alert"'), 'errors are announced');
assert.ok(html.includes('<meta name="description"'), 'meta description present');
assert.ok(html.includes('@media (max-width:520px)'), 'mobile layout present');
assert.ok(html.includes('.kq-table[hidden]'), 'hidden table stays hidden on mobile');
assert.equal((html.match(/<script src="\/assets\/theme-init\.js"><\/script>/g) || []).length, 1, 'theme init once');
assert.equal((html.match(/<script src="\/assets\/app\.js"><\/script>/g) || []).length, 1, 'app shell once');
for (const banned of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'innerHTML', 'document.write', 'WebSocket']) {
  assert.ok(!html.includes(banned), `page unexpectedly uses ${banned}`);
}
assert.ok(!/https?:\/\//.test(html.replace(/<script src="[^"]*"><\/script>/g, '')), 'no external URLs in the page');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'ids are unique');

console.log(`k8s quantity: ${record.testCases.length} catalog cases, ${compared} exact-oracle grid lines with 14 suffixes, parsing, warnings and page contract OK`);
