/* ISO 3166-1 country code lookup: the 249-entry list, every entry's own forms,
   well-known codes, accent and punctuation folding, official and common names,
   everyday aliases, ambiguity, numeric padding, refusals, list splitting, the
   catalogue replay and the page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'iso-3166-country-code-converter';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const startMarker = '/* iso-core:start */';
const endMarker = '/* iso-core:end */';
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker);
assert.ok(start > -1 && end > start, 'core markers missing');
const core = html.slice(start, end + endMarker.length);
assert.ok(!/document\.|window\./.test(core), 'the core stays free of DOM access');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = Iso3166Core;', sandbox);
const C = sandbox.module.exports;

const plain = (value) => JSON.parse(JSON.stringify(value));
const resolve = (token) => plain(C.resolve(token));
const convert = (text) => plain(C.convert(text));
const failure = (text) => {
  try {
    convert(text);
  } catch (error) {
    return error.message;
  }
  return null;
};
const countries = C.countries();
const byCode = new Map(countries.map((country) => [country.alpha2, country]));

// ---- The list itself.
assert.equal(C.count(countries.length), 249, 'the list holds every assigned entry');
assert.equal(countries.length, 249, '249 countries and territories');
assert.equal(new Set(countries.map((country) => country.alpha2)).size, 249, 'alpha-2 codes are unique');
assert.equal(new Set(countries.map((country) => country.alpha3)).size, 249, 'alpha-3 codes are unique');
assert.equal(new Set(countries.map((country) => country.numeric)).size, 249, 'numeric codes are unique');
for (const country of countries) {
  assert.match(country.alpha2, /^[A-Z]{2}$/, 'alpha-2 shape: ' + country.alpha2);
  assert.match(country.alpha3, /^[A-Z]{3}$/, 'alpha-3 shape: ' + country.alpha3);
  assert.match(country.numeric, /^[0-9]{3}$/, 'numeric keeps three digits: ' + country.numeric);
  assert.ok(country.name.length > 1, 'every entry has a name: ' + country.alpha2);
}

// Well-known rows, including the two codes whose leading zeros are the classic trap.
const anchors = [
  ['AF', 'AFG', '004', 'Afghanistan'], ['AD', 'AND', '020', 'Andorra'],
  ['AT', 'AUT', '040', 'Austria'], ['BR', 'BRA', '076', 'Brazil'],
  ['CA', 'CAN', '124', 'Canada'], ['CH', 'CHE', '756', 'Switzerland'],
  ['CN', 'CHN', '156', 'China'], ['DE', 'DEU', '276', 'Germany'],
  ['ES', 'ESP', '724', 'Spain'], ['FR', 'FRA', '250', 'France'],
  ['GB', 'GBR', '826', 'United Kingdom'], ['IN', 'IND', '356', 'India'],
  ['IT', 'ITA', '380', 'Italy'], ['JP', 'JPN', '392', 'Japan'],
  ['NL', 'NLD', '528', 'Netherlands'], ['NO', 'NOR', '578', 'Norway'],
  ['NZ', 'NZL', '554', 'New Zealand'], ['SE', 'SWE', '752', 'Sweden'],
  ['US', 'USA', '840', 'United States'], ['ZA', 'ZAF', '710', 'South Africa'],
  ['ZW', 'ZWE', '716', 'Zimbabwe'], ['AQ', 'ATA', '010', 'Antarctica'],
  ['TW', 'TWN', '158', 'Taiwan, Province of China'], ['PS', 'PSE', '275', 'Palestine, State of'],
];
for (const [alpha2, alpha3, numeric, name] of anchors) {
  const country = byCode.get(alpha2);
  assert.ok(country, 'missing ' + alpha2);
  assert.equal(country.alpha3, alpha3, alpha2 + ' alpha-3');
  assert.equal(country.numeric, numeric, alpha2 + ' numeric');
  assert.equal(country.name, name, alpha2 + ' name');
}

// Every entry answers to its own alpha-2, alpha-3, numeric and short name.
let ownership = 0;
for (const country of countries) {
  const numericShort = String(Number(country.numeric));
  const forms = [country.alpha2, country.alpha2.toLowerCase(), country.alpha3,
    country.alpha3.toLowerCase(), country.numeric, numericShort, country.name];
  for (const form of forms) {
    const got = resolve(form);
    assert.equal(got.status, 'ok', country.alpha2 + ' should resolve ' + JSON.stringify(form));
    assert.equal(got.country.alpha2, country.alpha2, country.alpha2 + ' owns ' + JSON.stringify(form));
    ownership += 1;
  }
}

// ---- Codes are read as codes, case-insensitively, before any name is considered.
for (const [token, expected] of [['de', 'DE'], ['De', 'DE'], ['DEU', 'DE'], ['fra', 'FR'],
    ['and', 'AD'], ['ch', 'CH'], ['in', 'IN'], ['no', 'NO'], ['is', 'IS'], ['to', 'TO'],
    ['me', 'ME'], ['it', 'IT'], ['usa', 'US'], ['gbr', 'GB']]) {
  assert.equal(resolve(token).country.alpha2, expected, 'code lookup ' + token);
}

// ---- Numeric codes are zero-padded, so 4 and 004 are Afghanistan and 40 is Austria.
for (const [token, expected] of [['4', 'AF'], ['04', 'AF'], ['004', 'AF'], ['20', 'AD'],
  ['40', 'AT'], ['040', 'AT'], ['276', 'DE'], ['840', 'US']]) {
  assert.equal(resolve(token).country.alpha2, expected, 'numeric lookup ' + token);
}

// ---- Names: case, accents and punctuation are folded away.
for (const [token, expected] of [['germany', 'DE'], ['GERMANY', 'DE'],
  ["cote d'ivoire", 'CI'], ['Cote d\u2019Ivoire', 'CI'], ['C\u00f4te d\u2019Ivoire', 'CI'],
  ['COTE D IVOIRE', 'CI'], ['curacao', 'CW'], ['aland', 'AX'], ['aland islands', 'AX'],
  ['reunion', 'RE'], ['turkiye', 'TR'], ['T\u00fcrkiye', 'TR'],
  ['saint barthelemy', 'BL'], ['sao tome and principe', 'ST'],
  ['bosnia', 'BA'], ['bosnia and herzegovina', 'BA'], ['new zealand', 'NZ'],
  ['the gambia', 'GM'], ['gambia', 'GM'], ['united states', 'US']]) {
  const got = resolve(token);
  assert.equal(got.status, 'ok', 'name lookup ' + token);
  assert.equal(got.country.alpha2, expected, 'name lookup ' + token);
}

// ---- Official names, ISO common names and the fuller names some tables print.
const official = [['Federal Republic of Germany', 'DE'], ['French Republic', 'FR'],
  ['United Kingdom of Great Britain and Northern Ireland', 'GB'],
  ['United Mexican States', 'MX'], ['Swiss Confederation', 'CH'],
  ['Kingdom of the Netherlands', 'NL'], ['Republic of Korea', 'KR'],
  ['the State of Palestine', 'PS']];
for (const [token, expected] of official) {
  assert.equal(resolve(token).country.alpha2, expected, 'official name ' + token);
}
const common = [['South Korea', 'KR'], ['North Korea', 'KP'], ['Vietnam', 'VN'],
  ['Taiwan', 'TW'], ['Bolivia', 'BO'], ['Iran', 'IR'], ['Laos', 'LA'], ['Moldova', 'MD'],
  ['Syria', 'SY'], ['Tanzania', 'TZ'], ['Venezuela', 'VE']];
for (const [token, expected] of common) {
  assert.equal(resolve(token).country.alpha2, expected, 'common name ' + token);
}
for (const [token, expected] of [['Burma', 'MM'], ['Czech Republic', 'CZ'],
  ['Swaziland', 'SZ'], ['Cape Verde', 'CV'], ['East Timor', 'TL'], ['Holland', 'NL'],
  ['Macau', 'MO'], ['Russia', 'RU'], ['Turkey', 'TR'], ['Britain', 'GB'],
  ['Great Britain', 'GB'], ['UK', 'GB'], ['UAE', 'AE'], ['Ivory Coast', 'CI'],
  ['DRC', 'CD'], ['Falklands', 'FK'], ['Vatican', 'VA']]) {
  const got = resolve(token);
  assert.equal(got.status, 'ok', 'everyday name ' + token);
  assert.equal(got.country.alpha2, expected, 'everyday name ' + token);
}

// ---- Ambiguity is reported, never guessed: one exact match still wins.
assert.equal(resolve('congo').country.alpha2, 'CG', 'the exact short name wins over a longer one');
assert.equal(resolve('guinea').country.alpha2, 'GN', 'Guinea exact, not Guinea-Bissau');
const ambiguous = (token) => {
  const got = resolve(token);
  assert.equal(got.status, 'ambiguous', token + ' is ambiguous');
  return got;
};
const korea = ambiguous('korea');
assert.deepEqual(korea.candidates.map((candidate) => candidate.alpha2).sort(), ['KP', 'KR']);
assert.equal(korea.candidatesTotal, 2);
const virgin = ambiguous('virgin');
assert.deepEqual(virgin.candidates.map((candidate) => candidate.alpha2).sort(), ['VG', 'VI']);
const saint = ambiguous('saint');
assert.equal(saint.candidatesTotal, 7, 'seven saint entries');
assert.equal(saint.candidates.length, 4, 'at most four candidates are named');
const united = ambiguous('united');
assert.equal(united.candidatesTotal, 6);
assert.equal(united.candidates.length, 4);
for (const candidate of united.candidates) {
  assert.ok(['AE', 'GB', 'MX', 'TZ', 'UM', 'US'].includes(candidate.alpha2),
    'an unexpected united candidate: ' + candidate.alpha2);
}

// ---- Nothing is invented for a code or name ISO does not assign.
for (const token of ['XK', 'xk', 'EU', 'eu', 'zz', 'zzz', 'ZZ', '999', '000', '0', 'zzzz',
  'atlantis', 'wessex', 'united states of x']) {
  assert.equal(resolve(token).status, 'none', 'refuses ' + token);
  assert.equal(resolve(token).country, undefined, 'no country for ' + token);
}

// ---- List splitting, blank entries and the 50-entry cap.
const listed = convert('Germany, FR, 276');
assert.equal(listed.total, 3);
assert.equal(listed.rows.length, 3);
assert.equal(listed.issues.length, 0);
assert.deepEqual(listed.rows.map((row) => row.country.alpha2), ['DE', 'FR', 'DE']);
assert.deepEqual(listed.rows.map((row) => row.entry), ['Germany', 'FR', '276']);
assert.equal(listed.rows[0].country.name, 'Germany');
assert.equal(listed.rows[0].country.officialName, 'Federal Republic of Germany');
assert.equal(listed.rows[1].country.officialName, 'French Republic');
assert.equal(convert('DE\nFR;IT').rows.length, 3, 'newlines and semicolons split');
assert.equal(convert('DE\tFR\tIT').rows.length, 3, 'tab-separated columns split');
assert.equal(convert('DE,,FR,,').total, 2, 'blank segments are dropped');
assert.equal(convert('  DE  ').rows[0].entry, 'DE', 'entries are trimmed');
assert.equal(convert('Germany, korea, XK').total, 3);
assert.equal(convert('Germany, korea, XK').rows.length, 1);
assert.deepEqual(convert('Germany, korea, XK').issues.map((issue) => issue.status),
  ['ambiguous', 'none']);
assert.equal(failure(''), C.MESSAGES.empty);
assert.equal(failure('   '), C.MESSAGES.empty);
assert.equal(failure([',', ';'].join('')), C.MESSAGES.empty);
assert.equal(failure(new Array(51).fill('FR').join(',')), C.MESSAGES.tooMany);
assert.equal(convert(new Array(50).fill('FR').join(',')).rows.length, 50, 'fifty entries are accepted');
assert.equal(C.MAX_ENTRIES, 50);

// ---- The catalogue record, replayed case by case.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const pageDirs = fs.readdirSync(path.join(root, 'frontend', 'tools'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory()).length;
assert.equal(catalog.tools.filter((tool) => tool.listed !== false).length, pageDirs,
  'every listed tool record has a page');
assert.equal(catalog.tools.filter((tool) => tool.listed).length, 2262, 'public tools');
const entry = catalog.tools.find((tool) => tool.slug === slug);
assert.ok(entry, 'the new record is present');
assert.equal(entry.name, 'ISO 3166 Country Code Converter');
assert.equal(entry.category, 'Geography');
assert.equal(entry.subcategory, 'Conversion');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.reviewedAt, null);
assert.ok(entry.method.includes('browser'), 'method documents local execution');
assert.ok(entry.method.includes('249'), 'method states how many entries ISO assigns');
assert.ok(entry.method.includes('alpha-2') && entry.method.includes('alpha-3'),
  'method names the code sets');
assert.ok(entry.method.includes('leading zeros'), 'method names the leading-zero rule');
assert.ok(entry.description.length > 100, 'description is descriptive');
assert.equal(entry.sources.length, 2, 'two references are cited');
for (const source of entry.sources) {
  assert.ok(source.title.length > 20, 'a source names the document and the part used');
  assert.match(source.url, /^https:\/\//, 'every URL is absolute https');
}
assert.ok(entry.sources.some((source) => /^https:\/\/www\.iban\.com\/country-codes$/.test(source.url)),
  'the printed ISO table is cited');
assert.ok(entry.sources.some((source) => source.url.startsWith(
  'https://salsa.debian.org/iso-codes-team/iso-codes/')), 'the machine-readable copy is cited');
const project = (value) => ({
  total: value.total,
  rows: value.rows.map((row) => ({
    entry: row.entry, alpha2: row.country.alpha2, alpha3: row.country.alpha3,
    numeric: row.country.numeric, name: row.country.name,
  })),
  issues: value.issues.map((issue) => ({
    entry: issue.entry, status: issue.status,
    candidates: issue.candidates.map((candidate) => candidate.alpha2),
  })),
});
const kinds = (kind) => entry.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(entry.testCases.length, 21, 'catalog case count');
assert.equal(kinds('golden'), 8, 'eight golden cases');
assert.equal(kinds('boundary'), 3, 'three boundary cases');
assert.equal(kinds('validation'), 10, 'ten validation cases');
for (const testCase of entry.testCases) {
  if (testCase.expectedError) {
    assert.equal(failure(testCase.input.text), testCase.expectedError, testCase.name);
    continue;
  }
  assert.deepEqual(project(convert(testCase.input.text)), testCase.expected, testCase.name);
}

// ---- The new record's keys must not collide with any other record.
const owners = new Map();
for (const tool of catalog.tools) {
  for (const key of [tool.slug, tool.name].concat(tool.aliases || [])) {
    const folded = String(key).toLowerCase();
    if (!owners.has(folded)) owners.set(folded, new Set());
    owners.get(folded).add(tool.slug);
  }
}
for (const key of [entry.slug, entry.name].concat(entry.aliases)) {
  assert.deepEqual(Array.from(owners.get(String(key).toLowerCase())), [slug],
    'catalog key is unique: ' + key);
}
assert.equal(new Set(entry.aliases).size, entry.aliases.length, 'aliases are internally unique');
assert.equal(new Set(entry.tags).size, entry.tags.length, 'tags are internally unique');
for (const tag of ['geography', 'country-codes', 'iso-3166', 'alpha-2', 'alpha-3']) {
  assert.ok(entry.tags.includes(tag), 'new tag present: ' + tag);
}
const geography = catalog.tools.filter((tool) => tool.category === 'Geography').length;
assert.equal(geography, 57, 'Geography count');

// ---- Page contract: labelled control, no storage or network, ASCII source.
const markup = html.replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
const controlIds = [...markup.matchAll(/<(?:input|select|textarea)\b[^>]*\sid="([^"]+)"/g)]
  .map((match) => match[1]);
assert.equal(controlIds.length, 1, 'one control carries the query');
for (const id of controlIds) {
  assert.ok(new RegExp(`<label\\b[^>]*\\bfor="${id}"`).test(markup), 'control has a visible label: ' + id);
}
const requestedIds = [...html.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
const markupIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
for (const id of requestedIds) assert.ok(markupIds.has(id), 'script looks up a missing element id: ' + id);
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
assert.ok(/role="alert"/.test(html), 'refusals are announced');
assert.ok(/role="status"/.test(html), 'the summary is a status region');
assert.ok(/\/assets\/style\.css/.test(html), 'shared stylesheet');
assert.ok(/\/assets\/theme-init\.js/.test(html) && /\/assets\/app\.js/.test(html), 'shared scripts');
assert.ok(/<main>/.test(html) && /<h1>/.test(html), 'landmark and heading');
assert.ok(/min-height:44px/.test(html), 'the button keeps a touch-sized target');
assert.ok(/focus-visible/.test(html), 'keyboard focus is visible');
assert.ok(/<form id="code-form" novalidate>/.test(html), 'the form is a real form and does not native-validate');
assert.ok(/<button type="submit" class="primary">Convert<\/button>/.test(html), 'the action button submits');
assert.ok(/Ctrl/.test(html) && /Enter/.test(html), 'the keyboard shortcut is documented');
assert.ok(/<caption>/.test(html), 'the results table has a caption');
assert.ok(!/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|new Function|eval\s*\(/.test(html),
  'no network, storage or dynamic evaluation');
assert.ok(!/[^\x00-\x7f]/.test(html), 'the page source stays ASCII');
assert.ok(/@media \(max-width:560px\)/.test(html), 'a phone layout is defined');
assert.ok(/td\[data-label\]::before/.test(html), 'the stacked table labels its cells');

console.log('iso 3166: 249 entries, ' + ownership + ' ownership lookups, '
  + (official.length + common.length + 17) + ' name forms, numeric padding, ambiguity, '
  + entry.testCases.length + ' catalogue cases and the page contract pass');
