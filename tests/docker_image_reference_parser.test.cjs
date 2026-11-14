/* Regression checks for the Docker image reference parser core, catalog cases and page contract. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const slug = 'docker-image-reference-parser';
const html = fs.readFileSync(path.join(root, `frontend/tools/${slug}/index.html`), 'utf8');
const start = html.indexOf('/* docker-ref-core:start */');
const end = html.indexOf('/* docker-ref-core:end */');
assert.ok(start > -1 && end > start, 'docker-ref core markers missing');
const sandbox = { module: {} };
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end + '/* docker-ref-core:end */'.length) + '\nmodule.exports = DockerRef;', sandbox);
const D = sandbox.module.exports;

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/assets/tool-catalog.json'), 'utf8'));
const matches = catalog.tools.filter((tool) => tool.slug === slug);
assert.equal(matches.length, 1, 'catalog slug must exist exactly once');
const entry = matches[0];
assert.equal(entry.category, 'Developer');
assert.equal(entry.subcategory, 'Analysis & validation');
assert.equal(entry.risk, 'low');
assert.equal(entry.maturity, 'draft');
assert.equal(entry.listed, true);
assert.equal(entry.icon, '\u{1F433}');
assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 5, 'aliases present');
assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 2, 'sources present');
assert.ok(typeof entry.method === 'string' && entry.method.length > 200, 'method documented');
assert.equal(catalog.tools.length, 2259, 'catalog total');

const messages = new Set(catalog.tools.map((tool) => tool.slug));
assert.equal(messages.size, catalog.tools.length, 'slugs unique');
const folded = catalog.tools.map((tool) => tool.name.toLowerCase());
assert.equal(new Set(folded).size, folded.length, 'names unique');

const failure = (reference) => {
  try {
    D.compute({ reference });
  } catch (error) {
    return error.message;
  }
  return null;
};

// --- Published anchors. ---
const official = D.compute({ reference: 'nginx' });
assert.equal(official.registry, 'docker.io');
assert.equal(official.registryExplicit, false);
assert.equal(official.repository, 'library/nginx');
assert.equal(official.tag, null);
assert.equal(official.effectiveTag, 'latest');
assert.equal(official.digest, null);
assert.equal(official.normalized, 'docker.io/library/nginx:latest');
assert.equal(official.manifestPath, '/v2/library/nginx/manifests/latest');
assert.equal(official.nameLength, 23);
assert.equal(official.official, true);
assert.equal(official.warningCount, 3);

const privateRegistry = D.compute({ reference: 'registry.example.com:5000/team/api:1.4.2' });
assert.equal(privateRegistry.registry, 'registry.example.com:5000');
assert.equal(privateRegistry.registryExplicit, true);
assert.equal(privateRegistry.repository, 'team/api');
assert.equal(privateRegistry.tag, '1.4.2');
assert.equal(privateRegistry.normalized, 'registry.example.com:5000/team/api:1.4.2');
assert.equal(privateRegistry.manifestPath, '/v2/team/api/manifests/1.4.2');
assert.equal(privateRegistry.official, false);
assert.equal(privateRegistry.warningCount, 0);

const dockerHubAlias = D.compute({ reference: 'index.docker.io/library/ubuntu:22.04' });
assert.equal(dockerHubAlias.registry, 'docker.io');
assert.equal(dockerHubAlias.alias, true);
assert.equal(dockerHubAlias.normalized, 'docker.io/library/ubuntu:22.04');
assert.equal(dockerHubAlias.warningCount, 1);

const localPort = D.compute({ reference: 'localhost:5000/app' });
assert.equal(localPort.registry, 'localhost:5000');
assert.equal(localPort.repository, 'app');
assert.equal(localPort.tag, null);
assert.equal(localPort.normalized, 'localhost:5000/app:latest');
assert.equal(localPort.warningCount, 1);

const digestOnly = D.compute({ reference: 'ubuntu@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' });
assert.equal(digestOnly.tag, null);
assert.equal(digestOnly.effectiveTag, null);
assert.equal(digestOnly.digest, 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
assert.equal(digestOnly.normalized, 'docker.io/library/ubuntu@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
assert.equal(digestOnly.manifestPath, '/v2/library/ubuntu/manifests/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');

// --- Tag and digest together: the digest wins the manifest path, the tag stays in the name. ---
const pinned = D.compute({ reference: 'ghcr.io/acme/api:1.4.2@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' });
assert.equal(pinned.tag, '1.4.2');
assert.equal(pinned.manifestPath, '/v2/acme/api/manifests/sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
assert.ok(pinned.normalized.endsWith(':1.4.2@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'));
assert.equal(pinned.warningCount, 1);

// --- Every catalog case must agree with the core. ---
let goldenCount = 0;
let boundaryCount = 0;
let validationCount = 0;
for (const testCase of entry.testCases) {
  if (testCase.kind === 'validation') {
    validationCount += 1;
    assert.equal(failure(testCase.input.reference), testCase.expectedError, `${testCase.name}: validation message`);
    continue;
  }
  if (testCase.kind === 'golden') goldenCount += 1;
  else if (testCase.kind === 'boundary') boundaryCount += 1;
  else assert.fail(`unexpected test kind ${testCase.kind}`);
  const result = D.compute(testCase.input);
  for (const [key, expected] of Object.entries(testCase.expected)) {
    assert.equal(result[key], expected, `${testCase.name}: ${key}`);
  }
}
assert.ok(goldenCount >= 5, 'expected golden cases');
assert.ok(boundaryCount >= 3, 'expected boundary cases');
assert.ok(validationCount >= 10, 'expected validation cases');

// --- Extra vectors derived from an independent implementation of the reference grammar. ---
const vectors = [
  ['ghcr.io/acme/sub/my.app:2.0-rc.1', 'ghcr.io/acme/sub/my.app:2.0-rc.1', 0, false],
  ['index.docker.io/team/a_b@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'docker.io/team/a_b@sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', 1, false],
  ['[::1]:8080/library/api-gateway:latest', '[::1]:8080/library/api-gateway:latest', 0, false],
  ['localhost:5000/acme/sub/x__y:SHA_1', 'localhost:5000/acme/sub/x__y:SHA_1', 0, false],
  ['10.0.0.5/app:1.27-alpine', '10.0.0.5/app:1.27-alpine', 0, false],
  ['docker.io/team/nginx', 'docker.io/team/nginx:latest', 1, false],
  ['my.app', 'docker.io/library/my.app:latest', 3, true],
  ['registry.example.com:443/api-gateway', 'registry.example.com:443/api-gateway:latest', 1, false],
  ['ghcr.io/library/nginx@blake3:abc123', 'ghcr.io/library/nginx@blake3:abc123', 1, false],
  ['docker.io/library/nginx:latest', 'docker.io/library/nginx:latest', 0, true],
];
for (const [reference, normalized, warningCount, official] of vectors) {
  const result = D.compute({ reference });
  assert.equal(result.normalized, normalized, reference);
  assert.equal(result.warningCount, warningCount, `${reference}: warnings`);
  assert.equal(result.official, official, `${reference}: official`);
}

// --- Sweep: normalization identities hold across registries, namespaces, tags and digests. ---
const HEX64 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const registries = ['', 'docker.io/', 'index.docker.io/', 'ghcr.io/', 'localhost:5000/', '[::1]:8080/', 'registry.example.com:443/'];
const namespaces = ['', 'team/', 'acme/sub/', 'library/'];
const repos = ['app', 'nginx', 'api-gateway', 'my.app', 'a_b', 'x__y'];
const tags = ['', ':latest', ':1.27-alpine', ':2.0-rc.1', ':SHA_1'];
const digests = ['', '@sha256:' + HEX64, '@blake3:abc123'];
let plans = 0;
for (const registry of registries) {
  for (const namespace of namespaces) {
    for (const repo of repos) {
      for (const tag of tags) {
        for (const digest of digests) {
          const reference = registry + namespace + repo + tag + digest;
          const result = D.compute({ reference });
          const label = reference;
          assert.ok(result.normalized.startsWith(result.registry + '/'), `registry prefix ${label}`);
          assert.ok(result.normalized.includes('/' + result.repository), `repository in name ${label}`);
          assert.equal(result.nameLength, result.registry.length + 1 + result.repository.length, `name length ${label}`);
          assert.equal(result.warningCount, result.warnings.length, `warning count ${label}`);
          assert.equal(result.official, /^library\/[^/]+$/.test(result.repository) && result.registry === 'docker.io', `official ${label}`);
          assert.equal(result.manifestPath, '/v2/' + result.repository + '/manifests/' +
            (result.digest || result.tag || 'latest'), `manifest path ${label}`);
          if (digest) {
            assert.ok(result.normalized.endsWith('@' + digest.slice(1)), `digest suffix ${label}`);
            assert.equal(result.effectiveTag, tag ? tag.slice(1) : null, `effective tag ${label}`);
          } else {
            assert.ok(result.normalized.endsWith(':' + (tag ? tag.slice(1) : 'latest')), `tag suffix ${label}`);
            assert.equal(result.effectiveTag, tag ? tag.slice(1) : 'latest', `effective tag ${label}`);
          }
          plans += 1;
        }
      }
    }
  }
}

// --- Page contract, including a few rejected shapes. ---
assert.ok(/<html lang="en">/.test(html), 'language attribute');
assert.ok(/name="viewport"/.test(html), 'viewport meta');
assert.ok(html.includes('/assets/style.css'), 'shared stylesheet');
assert.ok(html.includes('/assets/tools.js') && html.includes('/assets/app.js'), 'shared scripts');
assert.equal((html.match(/<h1>/g) || []).length, 1, 'exactly one h1');
assert.ok(html.includes('id="site-header"'), 'shared header mount');
assert.ok(html.includes('role="status"') && html.includes('aria-live="polite"'), 'live status region');
for (const id of ['reference', 'parse', 'dr-status', 'normalized-out', 'copy', 'registry-out', 'repository-out',
  'tag-out', 'digest-out', 'manifest-out', 'length-out', 'official-out', 'notes']) {
  assert.ok(html.includes(`id="${id}"`), `missing control or output ${id}`);
}
assert.ok(/<button id="parse" class="primary" type="submit">/.test(html), 'submit button');
assert.ok(/<form id="dr-form" novalidate>/.test(html), 'form contract');
assert.ok(!/innerHTML|insertAdjacentHTML|document\.write/.test(html), 'no raw HTML sinks');
assert.ok(!/localStorage|sessionStorage|indexedDB/.test(html), 'no browser storage');
assert.ok(!/https?:\/\//.test(html.replace(/<meta name="description"[^>]*>/, '')), 'no external requests in the page');
assert.equal(failure('nginx@sha256:abc'), 'A sha256 digest must have 64 hexadecimal characters; this one has 3.');
assert.equal(failure('registry.example.com:99999/app'), 'The registry port must be a number from 1 to 65535.');
assert.equal(failure('ghcr.io//app'), 'The reference contains an empty path segment; check for doubled slashes.');

console.log(`${slug}: ${goldenCount} golden, ${boundaryCount} boundary and ${validationCount} validation cases passed; ` +
  `${vectors.length} extra vectors and ${plans} sweep references checked`);
