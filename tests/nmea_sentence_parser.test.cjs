/* Regression checks for the NMEA 0183 parser core, published vectors,
   catalog cases and the page's local-only contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'nmea-sentence-parser';
const html = fs.readFileSync(path.join(root, 'frontend/tools', slug, 'index.html'), 'utf8');
const start = html.indexOf('/* nmea-sentence-core:start */');
const end = html.indexOf('/* nmea-sentence-core:end */');
assert.ok(start > -1 && end > start, 'NMEA core markers missing');
const core = html.slice(start, end + '/* nmea-sentence-core:end */'.length);
const sandbox = { module: {}, Date };
vm.createContext(sandbox);
vm.runInContext(core + '\nmodule.exports = NmeaSentenceCore;', sandbox);
const C = sandbox.module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const parse = (sentence, options) => plain(C.parse(sentence, options));
const decode = (input) => plain(C.decode(input));
const failure = (sentence, options) => {
  try { parse(sentence, options); } catch (error) { return error.message; }
  return null;
};
const independentChecksum = (sentence) => {
  const body = sentence.slice(1).split('*')[0];
  let value = 0;
  for (const character of Buffer.from(body, 'ascii')) value ^= character;
  return value.toString(16).toUpperCase().padStart(2, '0');
};
const withChecksum = (body) => `$${body}*${independentChecksum('$' + body)}`;

// Published examples from JMU's NMEA field guide and nmea-simple's own suite.
const gga = parse('$GPGGA,210230,3855.4487,N,09446.0071,W,1,07,1.1,370.5,M,-29.5,M,,*7A');
assert.equal(gga.talkerId, 'GP');
assert.equal(gga.sentenceId, 'GGA');
assert.equal(gga.time, '21:02:30');
assert.ok(Math.abs(gga.latitude - 38.924145) < 1e-12);
assert.ok(Math.abs(gga.longitude - (-94.766785)) < 1e-12);
assert.equal(gga.fixQualityLabel, 'GPS/SPS fix');
assert.equal(gga.satellitesUsed, 7);
assert.equal(gga.hdop, 1.1);
assert.equal(gga.altitudeMeters, 370.5);
assert.equal(gga.geoidSeparationMeters, -29.5);
assert.equal(gga.checksumValid, true);

const rmc = parse('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A');
assert.equal(rmc.date, '1994-03-23');
assert.equal(rmc.datetime, '1994-03-23T12:35:19Z');
assert.equal(rmc.status, 'valid');
assert.ok(Math.abs(rmc.latitude - 48.1173) < 1e-12);
assert.ok(Math.abs(rmc.longitude - 11.516666666666667) < 1e-12);
assert.equal(rmc.speedKnots, 22.4);
assert.ok(Math.abs(rmc.speedKmh - 41.4848) < 1e-12);
assert.equal(rmc.courseTrue, 84.4);
assert.equal(rmc.magneticVariation, 3.1);
assert.equal(rmc.magneticVariationDirection, 'W');

const gsa = parse('$GPGSA,A,3,12,05,25,29,,,,,,,,,9.4,7.6,5.6*37');
assert.equal(gsa.selectionMode, 'automatic');
assert.equal(gsa.fixModeLabel, '3D');
assert.deepEqual(gsa.satelliteIds, [12, 5, 25, 29]);
assert.equal(gsa.pdop, 9.4);
assert.equal(gsa.hdop, 7.6);
assert.equal(gsa.vdop, 5.6);

const gsv = parse('$GPGSV,3,3,11,14,25,170,00,16,57,208,39,18,67,296,40*49');
assert.equal(gsv.totalMessages, 3);
assert.equal(gsv.messageNumber, 3);
assert.equal(gsv.satellitesInView, 11);
assert.equal(gsv.satellites.length, 3);
assert.deepEqual(gsv.satellites[0], { prn: 14, elevation: 25, azimuth: 170, snr: 0 });
assert.deepEqual(gsv.satellites[2], { prn: 18, elevation: 67, azimuth: 296, snr: 40 });

const gll = parse('$GPGLL,4916.45,N,12311.12,W,225444,A,*1D');
assert.ok(Math.abs(gll.latitude - 49.274166666666666) < 1e-12);
assert.ok(Math.abs(gll.longitude - (-123.18533333333333)) < 1e-12);
assert.equal(gll.time, '22:54:44');
assert.equal(gll.status, 'valid');

const vtg = parse('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48');
assert.equal(vtg.courseTrue, 54.7);
assert.equal(vtg.courseMagnetic, 34.4);
assert.equal(vtg.speedKnots, 5.5);
assert.equal(vtg.speedKmh, 10.2);

// nmea-simple 3.3.0 encoder anchors, including both coordinate extremes.
const extreme = parse('$GPGGA,000000,9000.000000,S,18000.000000,W,8,0,0.0,-12.3,M,-45.6,M,,*43');
assert.equal(extreme.latitude, -90);
assert.equal(extreme.longitude, -180);
assert.equal(extreme.fixQualityLabel, 'simulation');
assert.equal(extreme.altitudeMeters, -12.3);
const extremeGll = parse('$GNGLL,9000.000000,N,18000.000000,E,235959,A,D*5D');
assert.equal(extremeGll.latitude, 90);
assert.equal(extremeGll.longitude, 180);
assert.equal(extremeGll.mode, 'differential');
const zeroVtg = parse('$GPVTG,359.90,T,000.00,M,0.00,N,,,A*70');
assert.equal(zeroVtg.courseTrue, 359.9);
assert.equal(zeroVtg.speedKnots, 0);
assert.equal(zeroVtg.speedKmh, null);
assert.equal(zeroVtg.mode, 'autonomous');
const generic = parse('$GPHDT,123.4,T*31');
assert.equal(generic.sentenceName, 'Unspecialised sentence');
assert.equal(generic.fieldCount, 2);
assert.deepEqual(generic.fields, ['123.4', 'T']);

// Checksums are independently recomputed and malformed checksums remain visible.
for (const sentence of [
  '$GPGGA,210230,3855.4487,N,09446.0071,W,1,07,1.1,370.5,M,-29.5,M,,*7A',
  '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A',
  '$GPGSA,A,3,12,05,25,29,,,,,,,,,9.4,7.6,5.6*37',
  '$GPGSV,3,3,11,14,25,170,00,16,57,208,39,18,67,296,40*49',
  '$GPGLL,4916.45,N,12311.12,W,225444,A,*1D',
  '$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48',
  C.DEFAULT_TEXT.split('\n')[0]
]) assert.equal(C.checksum(sentence.slice(1).split('*')[0]), independentChecksum(sentence), sentence);
const badChecksum = parse('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00');
assert.equal(badChecksum.valid, false);
assert.equal(badChecksum.checksumValid, false);
assert.equal(badChecksum.actualChecksum, '00');
assert.equal(badChecksum.expectedChecksum, '6A');
assert.equal(badChecksum.latitude, rmc.latitude, 'bad checksum does not hide decoded fields');
const noChecksum = parse(withChecksum('GPGLL,4916.45,N,12311.12,W,225444,A').split('*')[0]);
assert.equal(noChecksum.checksumProvided, false);
assert.equal(noChecksum.checksumValid, null);
assert.equal(noChecksum.valid, true);

// Invalid fixes may omit positions, times and other unavailable values.
const invalidRmc = parse(withChecksum('GPRMC,,V,,,,,,,230394,,,N'));
assert.equal(invalidRmc.status, 'invalid');
assert.equal(invalidRmc.latitude, null);
assert.equal(invalidRmc.longitude, null);
assert.equal(invalidRmc.speedKnots, null);
assert.equal(invalidRmc.date, '1994-03-23');
assert.equal(invalidRmc.mode, 'not valid');
const invalidGll = parse(withChecksum('GPGLL,,,,,,V,N'));
assert.equal(invalidGll.latitude, null);
assert.equal(invalidGll.time, null);
const noFix = parse(withChecksum('GPGGA,123519,,,,,0,00,99.9,,M,,M,,0000'));
assert.equal(noFix.latitude, null);
assert.equal(noFix.longitude, null);
assert.equal(noFix.fixQualityLabel, 'no fix');

// Independent coordinate oracle: integer degrees plus a minute numerator.
let seed = 0x4e4d4541;
const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0x100000000; };
for (let i = 0; i < 600; i += 1) {
  const latSign = random() < 0.5 ? -1 : 1;
  const lonSign = random() < 0.5 ? -1 : 1;
  const latDeg = Math.floor(random() * 90);
  const lonDeg = Math.floor(random() * 180);
  const latMinuteMillionths = Math.floor(random() * 60000000);
  const lonMinuteMillionths = Math.floor(random() * 60000000);
  const latText = String(latDeg).padStart(2, '0') + String(Math.floor(latMinuteMillionths / 1000000)).padStart(2, '0') + '.' + String(latMinuteMillionths % 1000000).padStart(6, '0');
  const lonText = String(lonDeg).padStart(3, '0') + String(Math.floor(lonMinuteMillionths / 1000000)).padStart(2, '0') + '.' + String(lonMinuteMillionths % 1000000).padStart(6, '0');
  const sentence = withChecksum(`GPGLL,${latText},${latSign < 0 ? 'S' : 'N'},${lonText},${lonSign < 0 ? 'W' : 'E'},123519,A`);
  const result = parse(sentence);
  const expectedLat = latSign * (latDeg + latMinuteMillionths / 60000000);
  const expectedLon = lonSign * (lonDeg + lonMinuteMillionths / 60000000);
  assert.ok(Math.abs(result.latitude - expectedLat) < 1e-12, `latitude oracle ${sentence}`);
  assert.ok(Math.abs(result.longitude - expectedLon) < 1e-12, `longitude oracle ${sentence}`);
  assert.equal(result.expectedChecksum, independentChecksum(sentence));
  assert.equal(result.valid, true);
}

// Multi-line logs retain source line numbers and isolate bad records.
const log = decode({ text: '\n' + C.DEFAULT_TEXT + '\nnot a sentence\n' + badChecksum.raw });
assert.equal(log.total, 7);
assert.equal(log.validCount, 5);
assert.equal(log.invalidCount, 2);
assert.equal(log.positionCount, 2);
assert.equal(log.records[0].line, 2);
assert.equal(log.records[5].error, 'An NMEA sentence must begin with $ or !.');
assert.equal(log.records[6].checksumValid, false);
assert.equal(log.latestPosition.line, 3);
const strictLog = decode({ text: noChecksum.raw, requireChecksum: true });
assert.equal(strictLog.invalidCount, 1);
assert.match(strictLog.records[0].error, /has no checksum/);

// Targeted validation boundaries.
assert.match(failure(''), /Enter an NMEA sentence/);
assert.match(failure('GPGGA,1'), /must begin with/);
assert.match(failure('$GPGGA,1*0'), /exactly two hexadecimal/);
assert.match(failure('$GPGGA,1*000'), /exactly two hexadecimal/);
assert.match(failure('$GPGGA,1*0G'), /exactly two hexadecimal/);
assert.match(failure('$GPGGA,1*00*00'), /only one checksum delimiter/);
assert.match(failure('$gpgga,1*00'), /five-character uppercase address/);
assert.match(failure('$GPGGA'), /RMC|needs at least|checksum|time/);
assert.match(failure('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W'), /RMC requires/);
assert.match(failure(withChecksum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,320294,003.1,W')), /real calendar day/);
assert.match(failure(withChecksum('GPGLL,9000.000001,N,12311.12,W,225444,A')), /impossible degrees or minutes/);
assert.match(failure(withChecksum('GPGLL,4960.45,N,12311.12,W,225444,A')), /impossible degrees or minutes/);
assert.match(failure(withChecksum('GPGLL,4916.45,X,12311.12,W,225444,A')), /hemisphere/);
assert.match(failure(withChecksum('GPGGA,126060,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')), /impossible hour/);
assert.match(failure(withChecksum('GPGSA,A,3,12,05,25,29,,,,,,,,,9.4,7.6')), /at least 17/);
assert.match(failure(withChecksum('GPGSV,3,4,11,14,25,170,00')), /at most 3/);
assert.match(failure(withChecksum('GPVTG,054.7,X,034.4,M,005.5,N,010.2,K')), /marker must be T/);
assert.match(failure(withChecksum('GPVTG,054.7,T,034.4,M,10.0,N,10.0,K')), /speeds disagree/);

// The page stays local, uses safe DOM writes and wires every explicit ID.
assert.ok(!/https?:\/\//.test(html), 'page references an external URL');
assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|WebSocket|Web Serial|navigator\.serial/.test(html), 'page uses storage, network or serial APIs');
assert.ok(!/\son[a-z]+\s*=/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'page uses inline event handlers');
assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(html), 'page injects markup strings');
assert.ok(!/\beval\(|new Function/.test(html), 'page evaluates strings');
assert.ok(/<form id="nmea-form"/.test(html) && /type="submit"/.test(html), 'page has a submittable form');
assert.ok(/<label class="f" for="nmea-input">/.test(html), 'textarea is labelled');
assert.ok(/aria-live="polite"/.test(html), 'results are announced');
for (const match of html.matchAll(/getElementById\("([^"]+)"\)/g)) {
  assert.ok(new RegExp(`id="${match[1]}"`).test(html), `missing element #${match[1]}`);
}
const defaults = decode({});
assert.equal(defaults.validCount, 5, 'all five demo defaults are legal');

// Catalog cases replay through the same public core.
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const records = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(records.length, 1, 'catalog slug occurs exactly once');
const record = records[0];
assert.equal(record.name, 'NMEA 0183 Sentence Parser');
assert.equal(record.category, 'Geography');
assert.equal(record.subcategory, 'GNSS & NMEA');
assert.equal(record.risk, 'low');
assert.equal(record.maturity, 'draft');
assert.equal(record.listed, true);
assert.ok(record.method.includes('browser'));
assert.ok(record.sources.length >= 2);
for (const testCase of record.testCases) {
  const { input, expected } = testCase;
  if (expected.error) {
    let thrown = null;
    try { C.parse(input.sentence, input.options || {}); } catch (error) { thrown = error; }
    assert.ok(thrown, `${testCase.name}: expected an error`);
    assert.equal(thrown.message, expected.error, testCase.name);
    continue;
  }
  const result = parse(input.sentence, input.options || {});
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value === 'number') assert.ok(Math.abs(result[key] - value) < 1e-9, `${testCase.name} ${key}: ${result[key]} != ${value}`);
    else assert.deepEqual(result[key], value, `${testCase.name} ${key}`);
  }
}
const kinds = (kind) => record.testCases.filter((testCase) => testCase.kind === kind).length;
assert.equal(record.testCases.length, 32, 'catalog case count');
assert.equal(kinds('golden'), 13, 'thirteen golden cases');
assert.equal(kinds('boundary'), 6, 'six boundary cases');
assert.equal(kinds('validation'), 13, 'thirteen validation cases');

console.log('nmea-sentence-parser: all checks passed ('
  + record.testCases.length + ' catalog cases, 600 coordinate/checksum oracle comparisons, '
  + defaults.total + ' demo sentences)');
