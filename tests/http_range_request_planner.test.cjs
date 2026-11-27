/* Regression checks for the HTTP Range Request Planner core and every case in its catalog record.
 *
 * The expected response is rebuilt here by a second, differently shaped parser: it
 * tokenises the header character by character, computes the covered bytes with
 * min/max rather than the page's ceiling-and-clamp flow, and derives the multipart
 * decision from the number of satisfiable ranges instead of reading it off the page.
 * Every recorded catalog case is then replayed, so a drift between the record, the
 * page and the RFC reading fails the suite.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'http-range-request-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* range-core:start */');
const end = html.indexOf('/* range-core:end */');
assert.ok(start > -1 && end > start, 'range core markers missing');
const core = html.slice(start, end + '/* range-core:end */'.length);

const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = RangeCore;', sandbox);
const C = sandbox.module.exports;

const run = (overrides) => C.build(Object.assign({}, C.DEFAULTS, overrides));
// Objects created inside the vm belong to another realm: copy through JSON before a
// structural comparison.
const plain = (value) => JSON.parse(JSON.stringify(value));

// ---- Independent model ---------------------------------------------------
// Splits on the first '=' and then on a single '-' per spec, with no regular
// expressions, so it shares no parsing code with the page.
const parseHeader = (text, size) => {
  const value = String(text).trim();
  const eq = value.indexOf('=');
  if (eq < 1) return { kind: 'ignored' };
  const unit = value.slice(0, eq).trim();
  if (unit.toLowerCase() !== 'bytes') return { kind: 'ignored' };
  const specs = value.slice(eq + 1).split(',');
  const parts = [];
  for (const raw of specs) {
    const spec = raw.trim();
    const dash = spec.indexOf('-');
    if (dash < 0 || spec.indexOf('-', dash + 1) >= 0) return { kind: 'ignored' };
    const left = spec.slice(0, dash);
    const right = spec.slice(dash + 1);
    const digits = /^[0-9]*$/;
    if (!digits.test(left) || !digits.test(right)) return { kind: 'ignored' };
    if (left === '' && right === '') return { kind: 'ignored' };
    if (left.length > 15 || right.length > 15) return { kind: 'ignored' };
    if (left === '') {
      const n = Number(right);
      if (n === 0) {
        parts.push({ spec, satisfiable: false, first: null, last: null, length: 0, clamped: false, whole: false });
      } else {
        const startByte = Math.max(0, size - n);
        parts.push({ spec, satisfiable: true, first: startByte, last: size - 1, length: size - startByte, clamped: false, whole: n >= size });
      }
      continue;
    }
    const from = Number(left);
    if (right === '') {
      if (from >= size) {
        parts.push({ spec, satisfiable: false, first: from, last: null, length: 0, clamped: false, whole: false });
      } else {
        parts.push({ spec, satisfiable: true, first: from, last: size - 1, length: size - from, clamped: false, whole: false });
      }
      continue;
    }
    const to = Number(right);
    if (to < from) return { kind: 'ignored' };
    if (from >= size) {
      parts.push({ spec, satisfiable: false, first: from, last: null, length: 0, clamped: false, whole: false });
    } else {
      const stop = Math.min(to, size - 1);
      parts.push({ spec, satisfiable: true, first: from, last: stop, length: stop - from + 1, clamped: to >= size, whole: false });
    }
  }
  const served = parts.filter((part) => part.satisfiable);
  return { kind: served.length ? 'partial' : 'unsatisfiable', parts, served };
};

const model = (input) => {
  const size = Number(input.size);
  if (input.ifRange === 'mismatch') {
    return { status: 200, bodyBytes: size, servedCount: 0, multipart: false, total: size };
  }
  const parsed = parseHeader(input.range, size);
  if (parsed.kind === 'ignored') return { status: 200, bodyBytes: size, servedCount: 0, multipart: false, total: size };
  if (parsed.kind === 'unsatisfiable') return { status: 416, bodyBytes: 0, servedCount: 0, multipart: false, total: 0 };
  const total = parsed.served.reduce((sum, part) => sum + part.length, 0);
  return {
    status: 206, bodyBytes: total, servedCount: parsed.served.length,
    multipart: parsed.served.length > 1, parts: parsed.parts, total,
  };
};

// ---- The default request, checked number by number.
{
  const result = C.build(C.DEFAULTS);
  assert.deepEqual(plain(C.DEFAULTS), { size: '10485760', range: 'bytes=0-1048575', ifRange: 'none' }, 'documented defaults');
  assert.equal(result.status, 206, 'default: partial content');
  assert.equal(result.contentRange, 'bytes 0-1048575/10485760', 'default: single part Content-Range, ungrouped');
  assert.equal(result.contentType, "the representation's own media type", 'default: no multipart for one part');
  assert.equal(result.bodyBytes, 1048576, 'default: one MiB of body');
  assert.equal(result.bodyText, '1.00 MiB (1,048,576 bytes)', 'default: body wording');
  assert.equal(result.savedBytes, 9437184, 'default: nine MiB saved');
  assert.equal(result.savedPct, 90, 'default: ninety percent saved');
  assert.equal(result.savedPctText, '90.0%', 'default: share wording');
  assert.equal(result.servedCount, 1, 'default: one part served');
  assert.equal(result.parts.length, 1, 'default: one part listed');
  assert.equal(result.parts[0].first, 0, 'default: starts at zero');
  assert.equal(result.parts[0].last, 1048575, 'default: ends at 1,048,575');
  assert.equal(result.statusKind, 'ok', 'default: nothing to warn about');
  assert.deepEqual(plain(result.warnings), [], 'default: no caveats');
  assert.match(result.summary, /206 Partial Content/, 'default: summary names the status');
  assert.match(result.summary, /90\.0% less/, 'default: summary states the saving');
}

// ---- Open-ended and suffix ranges describe the same bytes.
{
  const open = run({ range: 'bytes=1024-' });
  const closed = run({ range: 'bytes=1024-10485759' });
  assert.equal(open.bodyBytes, closed.bodyBytes, '1024- and 1024-last cover the same bytes');
  assert.equal(open.contentRange, closed.contentRange, 'the same Content-Range either way');
  assert.equal(open.contentRange, 'bytes 1024-10485759/10485760', 'the open range resolves to the last byte');
  const suffix = run({ range: 'bytes=-500' });
  const equivalent = run({ range: 'bytes=10485260-10485759' });
  assert.equal(suffix.bodyBytes, 500, 'a 500-byte suffix is 500 bytes');
  assert.equal(suffix.contentRange, equivalent.contentRange, 'suffix equals the explicit tail range');
  assert.equal(suffix.parts[0].first, 10485260, 'the suffix starts 500 bytes from the end');
  assert.equal(suffix.savedPctText, '99.995%', 'a tiny share of a big representation keeps its decimals');
}

// ---- Clamping, suffixes past the end, and a one-byte representation.
{
  const clamped = run({ range: 'bytes=10485700-99999999' });
  assert.equal(clamped.parts[0].last, 10485759, 'a last byte past the end is clamped');
  assert.equal(clamped.bodyBytes, 60, 'the clamped part is 60 bytes');
  assert.equal(clamped.parts[0].clamped, true, 'the clamp is recorded');
  assert.match(clamped.warnings[0], /cut short at byte 10,485,759/, 'the clamp is explained');
  assert.equal(clamped.savedPctText, '99.999%', 'a 60-byte body of 10 MiB is not rounded to nothing');
  const whole = run({ size: '1000', range: 'bytes=-5000' });
  assert.equal(whole.parts[0].first, 0, 'a suffix longer than the representation starts at zero');
  assert.equal(whole.bodyBytes, 1000, 'a suffix longer than the representation returns all of it');
  assert.equal(whole.parts[0].whole, true, 'the whole-representation suffix is recorded');
  assert.match(whole.warnings[0], /more bytes than the representation holds/, 'the oversized suffix is explained');
  const tiny = run({ size: '1', range: 'bytes=0-0,-1' });
  assert.equal(tiny.bodyBytes, 2, 'two parts of a one-byte representation total two bytes');
  assert.equal(tiny.savedBytes, -1, 'that request costs more than the representation');
  assert.match(tiny.summary, /no smaller than the whole representation/, 'the summary admits the parts exceed the resource');
  assert.match(tiny.explanation.join(' '), /saves nothing/, 'the working explains the waste');
}

// ---- Several parts switch the response to multipart.
{
  const result = C.build({ size: '10485760', range: 'bytes=0-99, 5000-5099, -100', ifRange: 'none' });
  assert.equal(result.status, 206, 'three ranges stay partial');
  assert.equal(result.servedCount, 3, 'three parts are served');
  assert.equal(result.bodyBytes, 300, 'three 100-byte parts');
  assert.equal(result.contentType, 'multipart/byteranges; boundary=virt-tools-range-boundary', 'several parts are multipart');
  assert.equal(result.contentRange, 'one line per part, see the table', 'no single Content-Range line for multipart');
  assert.deepEqual(plain(result.parts.map((row) => row.first)), [0, 5000, 10485660], 'each part starts where asked');
  assert.deepEqual(plain(result.parts.map((row) => row.length)), [100, 100, 100], 'each part is 100 bytes');
  assert.equal(result.savedPctText, '99.997%', 'the multipart body is still tiny');
  const single = run({ range: 'bytes=0-9' });
  assert.equal(single.servedCount, 1, 'one range is one part');
  assert.equal(single.contentType, "the representation's own media type", 'one part is not multipart');
}

// ---- Unsatisfiable sets, and sets with only some satisfiable ranges.
{
  const none = run({ size: '1000', range: 'bytes=2000-' });
  assert.equal(none.status, 416, 'a range past the end is 416');
  assert.equal(none.statusText, '416 Range Not Satisfiable', 'the 416 wording');
  assert.equal(none.contentRange, 'bytes */1000', '416 states the current length');
  assert.equal(none.bodyBytes, 0, '416 has no body');
  assert.equal(none.servedCount, 0, 'nothing is served');
  assert.equal(none.savedText, 'no body', 'the saving row says there is no body');
  assert.ok(none.warnings.length >= 1, '416 carries a caveat');
  const zero = run({ size: '1000', range: 'bytes=-0' });
  assert.equal(zero.status, 416, 'a zero-length suffix is unsatisfiable');
  const mixed = run({ size: '1000', range: 'bytes=0-9, 2000-' });
  assert.equal(mixed.status, 206, 'one satisfiable range keeps the response partial');
  assert.equal(mixed.servedCount, 1, 'only the satisfiable range is served');
  assert.equal(mixed.bodyBytes, 10, 'only ten bytes are sent');
  assert.equal(mixed.requestedCount, 2, 'both ranges were requested');
  assert.deepEqual(plain(mixed.parts.map((row) => row.outcome)), ['served', 'not satisfiable'], 'the dropped range is labelled');
  assert.match(mixed.warnings[0], /cannot be satisfied/, 'the dropped range is explained');
}

// ---- If-Range, unknown units and malformed headers.
{
  const stale = run({ ifRange: 'mismatch' });
  assert.equal(stale.status, 200, 'a stale If-Range gives 200');
  assert.equal(stale.bodyBytes, 10485760, 'the whole representation is sent');
  assert.equal(stale.contentRange, 'not sent', 'no Content-Range for a full response');
  assert.equal(stale.savedText, 'none', 'a full response saves nothing');
  assert.deepEqual(plain(stale.parts.map((row) => row.outcome)), ['not applied'], 'the range is not applied');
  assert.match(stale.summary, /validator no longer matches/, 'the summary explains If-Range');
  const matching = run({ ifRange: 'match' });
  assert.equal(matching.status, 206, 'a matching If-Range leaves the partial response alone');
  for (const header of ['items=0-5', 'bytes=0-9/20', 'bytes=500-100', 'bytes=0-1,', 'bytes=abc', 'bytes=']) {
    const ignored = run({ range: header });
    assert.equal(ignored.status, 200, `${header}: the header is ignored`);
    assert.equal(ignored.bodyBytes, 10485760, `${header}: the whole representation is sent`);
    assert.equal(ignored.contentRange, 'not sent', `${header}: no Content-Range`);
    assert.ok(ignored.warnings.length >= 1, `${header}: the ignore is explained`);
  }
  assert.match(run({ range: 'items=0-5' }).reason, /range unit "items"/, 'the unknown unit is named');
  assert.match(run({ range: 'bytes=500-100' }).reason, /"500-100"/, 'the offending specifier is named');
  assert.equal(run({ range: 'BYTES=0-9' }).status, 206, 'the range unit is case-insensitive');
  assert.equal(run({ range: 'bytes= 0-99' }).parts[0].length, 100, 'space after the equals sign is tolerated');
}

// ---- Cross-checks against the independent parser over a range matrix.
{
  const sizes = ['1', '2', '999', '1000', '10485760', '123456789', '1099511627776'];
  const headers = [
    'bytes=0-0', 'bytes=0-1023', 'bytes=1024-', 'bytes=0-', 'bytes=-1', 'bytes=-500',
    'bytes=-5000', 'bytes=-0', 'bytes=999-999', 'bytes=1000-', 'bytes=500-100',
    'bytes=0-9, 5-14', 'bytes=0-99, 5000-5099, -100', 'bytes=1-1, 0-0', 'bytes=0-1,',
    'items=0-5', 'bytes=abc', 'bytes=0-9/20', 'BYTES=0-9', 'bytes= 0-99',
    'bytes=0-999999999999999', 'bytes=0000000000000000001-5', 'bytes=0-9, 99999999-',
  ];
  let checked = 0;
  for (const size of sizes) {
    for (const range of headers) {
      for (const ifRange of ['none', 'mismatch']) {
        const input = { size, range, ifRange };
        const got = C.build(input);
        const want = model(input);
        const label = `${size} ${range} ${ifRange}`;
        assert.equal(got.status, want.status, `${label}: status`);
        assert.equal(got.bodyBytes, want.bodyBytes, `${label}: body bytes`);
        assert.equal(got.servedCount, want.servedCount, `${label}: served count`);
        assert.equal(got.savedBytes, want.status === 200 ? 0 : Number(size) - want.bodyBytes, `${label}: saved bytes`);
        assert.equal(got.savedBytes + got.bodyBytes, Number(size), `${label}: body and saving account for the whole`);
        assert.equal(/multipart/.test(got.contentType), want.multipart, `${label}: multipart decision`);
        if (want.parts) {
          assert.equal(got.parts.length, want.parts.length, `${label}: part count`);
          for (let i = 0; i < want.parts.length; i += 1) {
            const gp = got.parts[i];
            const wp = want.parts[i];
            assert.equal(gp.spec, wp.spec, `${label}: part ${i} spec`);
            assert.equal(gp.first, wp.first, `${label}: part ${i} first byte`);
            assert.equal(gp.last, wp.last, `${label}: part ${i} last byte`);
            assert.equal(gp.length, wp.length, `${label}: part ${i} length`);
            assert.equal(gp.satisfiable, wp.satisfiable, `${label}: part ${i} satisfiability`);
            assert.equal(gp.clamped, wp.clamped, `${label}: part ${i} clamp`);
            if (gp.satisfiable) {
              assert.ok(gp.last < Number(size), `${label}: part ${i} stays inside the representation`);
              assert.ok(gp.length >= 1, `${label}: part ${i} covers at least one byte`);
            }
          }
        }
        if (got.status === 206 && got.servedCount === 1) {
          const part = got.parts.find((row) => row.outcome === 'served');
          assert.equal(got.contentRange, `bytes ${part.first}-${part.last}/${size}`, `${label}: Content-Range`);
        }
        checked += 1;
      }
    }
  }
  assert.equal(checked, 322, 'the matrix is complete');
}

// ---- Determinism: the same request answered twice is identical.
{
  const input = { size: '10485760', range: 'bytes=0-9, 5000-5099', ifRange: 'none' };
  assert.deepEqual(plain(C.build(input)), plain(C.build(input)), 'repeated builds agree');
}

// ---- Refusals, by exact message.
{
  const cases = [
    [{ size: '' }, 'Enter the representation size in whole bytes, from 1 to 1,099,511,627,776.'],
    [{ size: '0' }, 'The representation size must be from 1 to 1,099,511,627,776 bytes; 0 is outside that range.'],
    [{ size: '1099511627777' }, 'The representation size must be from 1 to 1,099,511,627,776 bytes; 1,099,511,627,777 is outside that range.'],
    [{ size: '10mb' }, 'Enter the representation size as a whole number of bytes, from 1 to 1,099,511,627,776; "10mb" is not a byte count.'],
    [{ size: '-1' }, 'Enter the representation size as a whole number of bytes, from 1 to 1,099,511,627,776; "-1" is not a byte count.'],
    [{ range: '' }, 'Enter a Range header value such as bytes=0-1023.'],
    [{ ifRange: 'sometimes' }, 'Choose whether the If-Range validator matches: none, matches or does not match.'],
    [{ range: 'bytes=' + Array.from({ length: 33 }, (_, i) => `${i * 2}-${i * 2 + 1}`).join(', ') },
      'List at most 32 ranges in one header; a server will not serve more than a handful.'],
  ];
  for (const [override, message] of cases) {
    assert.throws(() => run(override), (error) => {
      assert.equal(error.message, message, `refusal for ${JSON.stringify(override)}`);
      return true;
    }, `expected a refusal for ${JSON.stringify(override)}`);
  }
}

// ---- Catalog record: every recorded case, plus the house-keeping fields.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const record = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(record, 'catalog record exists');
assert.equal(record.name, 'HTTP Range Request Planner', 'catalog name');
assert.equal(record.category, 'Networking', 'catalog category');
assert.equal(record.subcategory, 'Analysis & validation', 'catalog subcategory');
assert.equal(record.risk, 'low', 'risk classification');
assert.equal(record.maturity, 'draft', 'maturity');
assert.equal(record.listed, true, 'record is public');
assert.equal(record.sources.length, 1, 'the RFC is cited');
assert.match(record.sources[0].url, /^https:\/\/www\.rfc-editor\.org\/rfc\/rfc9110\.html$/, 'the RFC URL');
assert.match(record.sources[0].title, /RFC 9110/, 'the RFC title');
assert.equal(record.testCases.length, 31, 'recorded case count');

const numericFields = new Set(['status', 'bodyBytes', 'savedBytes', 'savedPct', 'servedCount', 'requestedCount', 'partCount']);
for (const testCase of record.testCases) {
  const label = testCase.name;
  if (testCase.expected.error) {
    assert.throws(() => C.build(testCase.input), (error) => {
      assert.equal(error.message, testCase.expected.error, `${label}: wrong refusal`);
      return true;
    }, `${label}: expected a refusal`);
    continue;
  }
  const result = C.build(testCase.input);
  for (const [field, value] of Object.entries(testCase.expected)) {
    if (numericFields.has(field)) {
      assert.equal(typeof result[field], 'number', `${label}: ${field} is numeric`);
      assert.ok(Math.abs(result[field] - value) <= 1e-9 * Math.max(1, Math.abs(value)), `${label}: ${field} is ${value}`);
    } else {
      assert.equal(result[field], value, `${label}: ${field}`);
    }
  }
}

// ---- Catalog totals and uniqueness against every other record.
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2251, 'public tools');
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 57, 'Networking count');
assert.equal(catalog.tools.filter((tool) => tool.slug === slug).length, 1, 'slug is unique');
const names = new Set();
const aliases = new Set();
for (const tool of catalog.tools) {
  names.add(tool.name.toLowerCase());
  for (const alias of tool.aliases || []) aliases.add(alias.toLowerCase());
}
assert.equal(names.size, catalog.tools.length, 'names are unique');
for (const alias of record.aliases) {
  const elsewhere = catalog.tools.filter((tool) => tool.slug !== slug &&
    (tool.name.toLowerCase() === alias.toLowerCase() || (tool.aliases || []).some((a) => a.toLowerCase() === alias.toLowerCase())));
  assert.equal(elsewhere.length, 0, `alias is not used elsewhere: ${alias}`);
}

// ---- Page contract: one form, one action, a live result, no network or storage.
assert.match(html, /<div id="site-header"><\/div>/, 'shared header slot');
assert.match(html, /\/assets\/app\.js/, 'shared app script');
assert.match(html, /<h1>HTTP Range Request Planner<\/h1>/, 'headline matches the catalog name');
assert.match(html, /<label for="in-size">Representation size \(bytes\)<\/label>/, 'size label');
assert.match(html, /<label for="in-range">Range header value<\/label>/, 'range label');
assert.match(html, /<label for="in-if-range">If-Range validator<\/label>/, 'If-Range label');
assert.match(html, /<button id="calculate" class="primary" type="submit">Plan the response<\/button>/, 'submit button');
assert.match(html, /<button id="reset" type="button">Reset<\/button>/, 'reset button');
assert.match(html, /id="status" class="status" role="status" aria-live="polite"/, 'live status region');
assert.match(html, /<th scope="col">Range spec<\/th><th scope="col">First byte<\/th><th scope="col">Last byte<\/th><th scope="col">Bytes<\/th><th scope="col">Response<\/th>/, 'part headings');
assert.match(html, /class="table-wrap" role="region" aria-label="[^"]+" tabindex="0"/, 'the scrollable table is a labelled region');
assert.match(html, /not what yours will/, 'the page says it models a conforming server');
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(html), 'no network or storage');
assert.ok(!/onclick=|onchange=|oninput=/.test(html), 'no inline handlers');
assert.ok(!/https?:\/\//.test(html), 'no third-party requests in the page');
assert.ok(!/innerHTML/.test(html), 'no markup injection');

console.log('http range request planner: all checks passed');
