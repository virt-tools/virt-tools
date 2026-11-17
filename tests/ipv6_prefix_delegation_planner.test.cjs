/* IPv6 prefix delegation: the per-site split against Python's ipaddress reference,
   the catalog cases, the identities that follow from a power-of-two split, and the
   page contract. No expected address or count comes from the page. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'ipv6-prefix-delegation-planner';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* pdplanner:start */';
const endMarker = '/* pdplanner:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const coreSource = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(coreSource), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(coreSource + '\nmodule.exports = PrefixPlanner;', sandbox);
const P = sandbox.module.exports;

const failure = (input) => {
  try { P.analyze(input); } catch (error) { return error.message; }
  return null;
};
const digits = (text) => Number(String(text).replace(/,/g, ''));
const toBig = (text) => {
  const halves = text.split('::');
  let groups;
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves[1] ? halves[1].split(':') : [];
    groups = head.concat(new Array(8 - head.length - tail.length).fill('0'), tail);
  } else {
    groups = text.split(':');
  }
  assert.equal(groups.length, 8, 'expansion of ' + text);
  return groups.reduce((acc, group) => (acc << BigInt(16)) + BigInt(parseInt(group, 16)), BigInt(0));
};

const fixture = JSON.parse(fs.readFileSync(
  path.join(root, 'tests/fixtures/ipv6_prefix_delegation_vectors.json'), 'utf8'));

// ---- The constants the model turns on.
assert.equal(P.BITS, 128);
assert.equal(P.SUBNET, 64);
assert.equal(P.MAX_SITES, 1000);
assert.equal(P.MAX_DELEGATION, 64);

// ---- The independent reference: 22 plans computed with Python's ipaddress module.
for (const vector of fixture.vectors) {
  const result = P.analyze(vector.input);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), vector.expected, vector.name);
  assert.equal(result.sites.length, result.shown, vector.name + ': listing length');
  assert.ok(result.shown <= 16, vector.name + ': at most sixteen sites are listed');
  assert.equal(result.siteLength >= result.delegationLength, true, vector.name + ': site prefix fits');
  assert.equal(digits(result.sitePrefixCount) * digits(result.subnetsPerSite),
    digits(result.totalSubnets), vector.name + ': capacity x per-site subnets = total subnets');
  assert.equal(digits(result.subnetsInUse), result.sitesWanted * digits(result.subnetsPerSite),
    vector.name + ': subnets in use');
  // Sites must tile the delegation without a gap or an overlap.
  const step = BigInt(1) << BigInt(128 - result.siteLength);
  if (result.sites.length > 1) {
    const first = toBig(result.sites[0].prefix.split('/')[0]);
    const second = toBig(result.sites[1].prefix.split('/')[0]);
    assert.equal(second - first, step, vector.name + ': sites are contiguous');
  }
  for (const site of result.sites) {
    const siteStart = toBig(site.prefix.split('/')[0]);
    const firstSubnet = toBig(site.firstSubnet.split('/')[0]);
    const lastSubnet = toBig(site.lastSubnet.split('/')[0]);
    assert.equal(firstSubnet, siteStart, vector.name + ': the first /64 starts the site');
    assert.equal((lastSubnet - firstSubnet) / (BigInt(1) << BigInt(64)) + BigInt(1),
      BigInt(digits(result.subnetsPerSite)), vector.name + ': the last /64 ends the site');
    assert.equal(lastSubnet % (BigInt(1) << BigInt(64)), BigInt(0),
      vector.name + ': a /64 boundary is 64-bit aligned');
  }
}

// ---- RFC 5952 text form, checked against the reference strings.
for (const vector of fixture.addresses) {
  assert.equal(P.parseAddress(vector.input), vector.expected, vector.name);
  assert.equal(P.parseAddress('  ' + vector.input.toUpperCase() + ' '), vector.expected,
    vector.name + ': case and padding are irrelevant');
}

// ---- The catalog record, and the cases it stores.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.name, 'IPv6 Prefix Delegation Planner');
assert.equal(entry.category, 'Networking');
assert.equal(entry.subcategory, 'Planning');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.reviewedAt, null);
assert.equal(entry.listed, true);
assert.equal(entry.legacyCategory, null);
assert.equal(entry.icon, '\u{1F310}');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'duplicate tags');
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'duplicate aliases');
assert.ok(entry.method.length > 1200, 'method must document the model, the limits and the exclusions');
assert.equal(entry.sources.length, 4, 'four cited sources');
assert.deepEqual(entry.sources.map((source) => source.url), [
  'https://www.rfc-editor.org/rfc/rfc4291.html',
  'https://www.rfc-editor.org/rfc/rfc6177.html',
  'https://www.rfc-editor.org/rfc/rfc8415.html',
  'https://www.rfc-editor.org/rfc/rfc5952.html',
]);
assert.ok(entry.testCases.length >= 20, 'the record stores its cases');
const kinds = entry.testCases.reduce((seen, item) => {
  seen[item.kind] = (seen[item.kind] || 0) + 1;
  return seen;
}, {});
assert.ok(kinds.golden >= 5 && kinds.boundary >= 4 && kinds.validation >= 10,
  'golden, boundary and validation cases are present: ' + JSON.stringify(kinds));
for (const item of entry.testCases) {
  if (item.kind === 'validation') {
    assert.equal(failure(item.input), item.error, item.name || JSON.stringify(item.input));
  } else {
    assert.deepEqual(JSON.parse(JSON.stringify(P.analyze(item.input))), item.expected, item.name);
  }
}

// ---- The model's own edges.
assert.equal(failure({ prefix: '2001:db8:1200::/48', siteLength: '56', sites: '256' }), null,
  'a /48 holds exactly 256 /56 sites');
assert.equal(P.analyze({ prefix: '2001:db8:1200::/48', siteLength: '56', sites: '256' }).sites.length, 16,
  'the listing stops at sixteen');
assert.equal(P.analyze({ prefix: '2001:db8::/32', siteLength: '56', sites: '64' }).shown, 16);
assert.equal(P.analyze({ prefix: '2001:db8:1200::/48', siteLength: '56', sites: '1' }).sites.length, 1);
assert.equal(failure({ prefix: '2001:db8:1200::/48', siteLength: '56', sites: '256' }), null);

// A site prefix equal to the delegation leaves one site.
const one = P.analyze({ prefix: '2001:db8:1200::/48', siteLength: '48', sites: '1' });
assert.equal(one.sitePrefixCount, '1');
assert.equal(one.subnetsPerSite, '65,536');
assert.equal(one.warnings.length, 1, 'the single-site warning is emitted');
assert.equal(failure({ prefix: '2001:db8:1200::/48', siteLength: '48', sites: '2' }),
  'A /48 delegation holds 1 /48 site prefix; plan that many sites or fewer.');

// A /64 delegation is a single subnet.
const single = P.analyze({ prefix: '2001:db8:1200:1::/64', siteLength: '64', sites: '1' });
assert.equal(single.sitePrefixCount, '1');
assert.equal(single.totalSubnets, '1');
assert.equal(single.sites[0].firstSubnet, single.sites[0].lastSubnet);
assert.equal(single.warnings.length, 1, 'a /64 delegation is a single site');
assert.match(single.warnings[0], /as long as the delegation/);

// The /64 warning and the unusually large site warning are the only two left.
assert.equal(P.analyze({ prefix: '2001:db8::/32', siteLength: '64', sites: '16' }).warnings.length, 1);
assert.match(P.analyze({ prefix: '2001:db8::/32', siteLength: '64', sites: '16' }).warnings[0],
  /^Every site gets a single \/64/);
assert.match(P.analyze({ prefix: '2001:db8::/32', siteLength: '40', sites: '2' }).warnings[0],
  /needs 16,777,216 \/64 subnets/);

// Host bits are refused, and the aligned block is named.
assert.equal(failure({ prefix: ' 2001:DB8:1200:0000::1/48 ', siteLength: '56', sites: '1' }),
  '2001:db8:1200::1/48 does not begin a /48 block; the block starts at 2001:db8:1200::/48.');

// Grouping and canonical form.
assert.equal(P.count(BigInt('18446744073709551616')), '18,446,744,073,709,551,616');
assert.equal(P.count(BigInt(0)), '0');
assert.equal(P.format(BigInt(0)), '::');
assert.equal(P.parseAddress('::ffff:192.0.2.128'), '::ffff:c000:280');

// The same block entered in a different but equivalent form gives the same plan.
const a = P.analyze({ prefix: '2001:0db8:00aa::/48', siteLength: '56', sites: '4' });
const b = P.analyze({ prefix: '2001:DB8:AA::/48', siteLength: '/56', sites: '4' });
assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)),
  'spelling does not change the split');

// ---- Page contract: shared shell, accessible controls, no runtime foreign APIs.
assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|WebSocket/.test(html), 'network or storage API found');
assert.ok(!/<script[^>]+src="https?:/i.test(html), 'remote script');
assert.ok(!/<link[^>]+href="https?:/i.test(html), 'remote stylesheet');
assert.ok(!/on(?:click|input|change|submit)=/i.test(html), 'inline handler');
assert.ok(!/\beval\s*\(|new\s+Function\b/.test(html), 'unsafe script evaluation');
assert.ok(html.includes('<form id="pd-form" novalidate>'), 'form missing');
assert.ok(html.includes('type="submit"'), 'submit missing');
assert.ok(html.includes('role="alert"'), 'error announcement missing');
assert.ok(html.includes('aria-live="polite" aria-atomic="true"'), 'result region missing');
assert.ok(html.includes('/assets/app.js') && html.includes('/assets/style.css'), 'shared shell assets missing');
assert.ok(html.includes('/assets/theme-init.js'), 'theme bootstrap missing');
for (const id of ['prefix', 'sitelength', 'sites']) {
  assert.ok(html.includes('for="' + id + '"'), 'missing label for ' + id);
  assert.ok(html.includes('id="' + id + '"'), 'missing control ' + id);
}
for (const id of ['pd-form', 'pd-err', 'pd-out', 'pd-sites', 'note', 'reset', 'submit']) {
  assert.ok(html.includes('id="' + id + '"'), 'missing id ' + id);
}
assert.ok(html.includes('min-height:44px'), 'controls must stay at a 44 px touch target');
assert.ok(/@media \(max-width:360px\)/.test(html), 'small-screen rule missing');
assert.ok(!/<table/i.test(html), 'the listing stays a flow of cards, not a table');
assert.ok(!/style="[^"]*width:\s*\d{3,}px/.test(html), 'fixed wide inline styles');

const publicCount = catalog.tools.filter((tool) => tool.listed).length;
assert.equal(publicCount, 2105, 'the catalog keeps growing: ' + publicCount);
assert.equal(catalog.tools.filter((tool) => tool.category === 'Networking').length, 50,
  'Networking count');

console.log(slug + ': ' + fixture.vectors.length + ' reference plans, ' +
  fixture.addresses.length + ' address forms, ' + entry.testCases.length +
  ' catalog cases, split identities and page contracts passed');
