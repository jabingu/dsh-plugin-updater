import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNpmLookup } from '../src/npm.mjs';

test('query the version index and exact manifests to find the highest compatible npm release', async () => {
  const calls = [];
  const lookup = createNpmLookup({ runtimeVersion: '0.2.1-rc.5', query: async fields => {
    calls.push(fields);
    if (fields[1] === 'versions') return ['1.0.0','1.1.0','2.0.0','3.0.0-beta.1'];
    const version = fields[0].split('@').at(-1);
    return { name: 'plugin', version, engines: { dsh: version === '2.0.0' ? '>=1' : '>=0.2.1-rc.1' }, dsh: { bundle: { patch: './p.yml' } } };
  } });
  const result = await lookup('plugin', null, undefined, '1.0.0');
  assert.deepEqual(result.map(m => m.version), ['2.0.0','1.1.0']);
  assert.deepEqual(calls.map(c => c[0]), ['plugin','plugin@2.0.0','plugin@1.1.0']);
});
test('exact-version manifest identity is checked before use', async () => {
  const lookup = createNpmLookup({ runtimeVersion: '0.2.1-rc.5', query: async fields => fields[1] === 'versions'
    ? ['1.1.0'] : { name: 'wrong', version: '1.1.0' } });
  await assert.rejects(lookup('plugin', null, undefined, '1.0.0'), /身份/);
});
