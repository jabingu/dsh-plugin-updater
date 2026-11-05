import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userBundles, sourceOf, compatibilityReason, chooseCandidate, registryPlan, createInspector } from '../src/sources.mjs';
import { validateUpdate, validateSchedule, descriptors, summaryText } from '../src/common.mjs';

const bundle = { name: 'dsh-example', version: '0.25.0', installed: true, official: false, enabled: false,
  availability: 'profile', source: 'dsh-example@^0.25.0' };
const manifest = (version, extra = {}) => ({ name: bundle.name, version, dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra });
const candidate = (version, extra = {}) => ({ manifest: manifest(version, extra), spec: `dsh-example@${version}` });

test('inventory includes disabled downloads, excludes official, shipped and transitive packages', () => {
  const values = [bundle, { ...bundle, name: 'official', official: true }, { ...bundle, name: 'shipped', availability: 'installation' },
    { ...bundle, name: 'dependency', installed: false }, { ...bundle, name: 'optional', optional: true }];
  assert.deepEqual(userBundles(values), [bundle]);
});
for (const source of ['dsh-example@^0.25.0', 'dsh-example@latest', 'dsh-example@0.25.0']) test(`npm provenance: ${source}`, () => {
  assert.equal(sourceOf({ ...bundle, source }).kind, 'npm');
});
test('scoped packages and dotted names are recognized without regex wildcard confusion', () => {
  assert.equal(sourceOf({ ...bundle, name: '@user/dsh.example', source: '@user/dsh.example@~1.0.0' }).kind, 'npm');
  assert.equal(sourceOf({ ...bundle, source: 'dshXexample@latest' }).kind, 'unsupported');
});
for (const source of ['D:\\code\\plugin', 'link:D:/code/plugin', 'file:D:/release.tgz', '/home/plugin', '../plugin']) test(`local files never become npm: ${source}`, () => {
  assert.equal(sourceOf({ ...bundle, source }).kind, 'local');
});
for (const source of ['github:owner/plugin', 'https://github.com/owner/plugin', 'git+https://github.com/owner/plugin.git#v1.0.0', 'git@github.com:owner/plugin.git']) test(`GitHub provenance: ${source}`, () => {
  const parsed = sourceOf({ ...bundle, source }); assert.equal(parsed.kind, 'github'); assert.equal(parsed.repo, 'plugin');
});
for (const source of ['https://token@github.com/owner/plugin', 'https://github.com/owner/plugin?token=secret', 'https://evil.test/owner/plugin', 'dsh-example@npm:other@latest']) test(`unrecognized origin is not silently redirected: ${source}`, () => {
  assert.equal(sourceOf({ ...bundle, source }).kind, 'unsupported');
});
test('check discovers newer minor versions beyond the original ^0.x range', () => {
  const result = chooseCandidate(bundle, [candidate('0.25.1'), candidate('0.28.2')], '0.2.1-rc.5');
  assert.equal(result.candidate.manifest.version, '0.28.2');
});
test('select highest compatible stable release, ignore deprecated and prerelease releases', () => {
  const result = chooseCandidate(bundle, [candidate('0.28.2'), candidate('0.29.0-beta.1'), candidate('0.29.0', { deprecated: 'bad' }),
    candidate('1.0.0', { engines: { dsh: '>=1' } })], '0.2.1-rc.5');
  assert.equal(result.candidate.manifest.version, '0.28.2'); assert.equal(result.latestVersion, '1.0.0');
});
test('all newer versions incompatible gives a blocked status instead of latest', () => {
  const requirements = { '@deepseek-ai/dsh-tools': '^0.2.2-rc.1', '@deepseek-ai/dsh-agent': '^0.2.2-rc.1' };
  const release = { ...candidate('1.0.0'), url: 'https://www.npmjs.com/package/dsh-example/v/1.0.0' };
  const result = chooseCandidate(bundle, [release], '0.2.1-rc.5', () => ({ requirements }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, '需要 DSH ^0.2.2-rc.1（当前 0.2.1-rc.5）');
  assert.equal(result.url, release.url);
  assert.equal(result.candidate, undefined);
});
test('DSH engine overrides peers, and prerelease DSH participates in ranges', () => {
  assert.equal(compatibilityReason(manifest('0.28.2', { engines: { dsh: '>=0.2.1-rc.1' },
    peerDependencies: { '@deepseek-ai/dsh': '>=9' } }), '0.2.1-rc.5'), null);
  assert.equal(compatibilityReason(manifest('0.28.2', { peerDependencies: { '@deepseek-ai/dsh': 'workspace:*' } }), '0.2.1-rc.5'), null);
});
test('check node/os/cpu and bundle requirements', () => {
  assert.match(compatibilityReason(manifest('1.0.0', { engines: { node: '>=999' } }), '0.2.1-rc.5'), /Node/);
  assert.match(compatibilityReason(manifest('1.0.0', { os: ['!' + process.platform] }), '0.2.1-rc.5'), /os/);
  assert.match(compatibilityReason({ name: bundle.name, version: '1.0.0' }, '0.2.1-rc.5'), /组合包/);
});
test('private default or explicitly selected registry cannot leak package names to a public mirror', () => {
  for (const registry of [null, 'https://private.example/']) assert.deepEqual(registryPlan({ registry,
    resolved: 'https://private.example/', fallbackRegistries: ['https://registry.npmmirror.com/'] }), [registry]);
});
test('public registry plan deduplicates the configured default', () => {
  assert.deepEqual(registryPlan({ registry: null, resolved: 'https://registry.npmjs.org/',
    fallbackRegistries: ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'] }), [null, 'https://registry.npmmirror.com/']);
});
test('npm network failure is an error; success from a configured fallback is allowed', async () => {
  const calls = [];
  const inspect = createInspector({ runtimeVersion: '0.2.1-rc.5', registries: async () => ({ registry: null,
    resolved: 'https://registry.npmjs.org/', fallbackRegistries: ['https://registry.npmmirror.com/'] }),
  lookupNpm: async (name, registry) => { calls.push(registry); if (registry === null) throw new Error('offline'); return [manifest('0.28.2')]; } });
  assert.equal((await inspect(bundle)).status, 'available'); assert.deepEqual(calls, [null, 'https://registry.npmmirror.com/']);
  const offline = createInspector({ runtimeVersion: '0.2.1-rc.5', registries: async () => ({ registry: null, resolved: null }), lookupNpm: async () => { throw new Error('offline'); } });
  await assert.rejects(offline(bundle), /offline/);
});
test('GitHub target is an immutable commit and the package identity is checked', async () => {
  const sha = 'a'.repeat(40); const urls = [];
  const inspect = createInspector({ runtimeVersion: '0.2.1-rc.5', fetchJson: async url => {
    urls.push(url); if (url.includes('/releases?')) return [{ tag_name: 'v0.28.2', body: 'new', prerelease: false }];
    if (url.includes('/commits/')) return { sha };
    return { encoding: 'base64', content: Buffer.from(JSON.stringify(manifest('0.28.2'))).toString('base64') };
  } });
  const result = await inspect({ ...bundle, source: 'https://github.com/owner/plugin' });
  assert.equal(result.candidate.spec, `https://github.com/owner/plugin.git#${sha}`);
  assert.ok(urls.at(-1).endsWith(sha));
});
test('local source is reported without any network request', async () => {
  const inspect = createInspector({ runtimeVersion: '0.2.1-rc.5' });
  assert.equal((await inspect({ ...bundle, source: 'link:D:/repo' })).status, 'unsupported');
});
test('wire input rejects specs, unsafe names, extra fields and forged tokens', () => {
  assert.throws(() => validateUpdate({ name: '--help', version: '1.0.0', token: 'abc' }));
  assert.throws(() => validateSchedule({ autoCheck: true, installAutomatically: true }));
  assert.equal(descriptors().length, 4);
});
test('summary does not call a failed or unsupported check up to date', () => {
  assert.match(summaryText({ plugins: [{ status: 'error' }], checking: false }), /失败/);
  assert.match(summaryText({ plugins: [{ status: 'unsupported' }], checking: false }), /手动/);
});
