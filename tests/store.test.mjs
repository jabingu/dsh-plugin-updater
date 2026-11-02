import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createStore } from '../src/store.mjs';
const directory = new URL('../work/store-tests/', import.meta.url); await mkdir(directory, { recursive: true });
const files = () => new URL(randomUUID() + '.json', directory);
const writer = { withFileLock: async (file, fn) => fn(), writeFileAtomic: async (file, value) => writeFile(file, value) };

test('preferences and check records survive reopening a store', async () => {
  const path = files(); const first = createStore(path, writer); const state = await first.load(); state.autoCheck = false;
  state.results.plugin = { fingerprint: 'identity', status: 'current' }; await first.save(state);
  const second = await createStore(path, writer).load(); assert.equal(second.autoCheck, false); assert.equal(second.results.plugin.status, 'current');
});
test('malformed cache is not used as a successful check', async () => {
  const path = files(); await writeFile(path, JSON.stringify({ schema: 1, autoCheck: true, results: { plugin: { status: 'anything' } } }));
  const store = createStore(path, writer); const value = await store.load(); assert.deepEqual(value.results, {}); assert.match(store.warning, /不可读/);
});
test('failed write does not replace the persisted preferences', async () => {
  const path = files(); const first = createStore(path, writer); const initial = await first.load(); await first.save(initial);
  const failed = createStore(path, { ...writer, writeFileAtomic: async () => { throw new Error('permission'); } });
  const value = await failed.load(); value.autoCheck = false; await assert.rejects(failed.save(value), /未能保存/);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).autoCheck, true); assert.match(failed.warning, /未能保存/);
});
