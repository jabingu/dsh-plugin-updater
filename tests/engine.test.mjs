import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUpdater } from '../src/engine.mjs';
import { fingerprint } from '../src/sources.mjs';
import { PACKAGE, DAY } from '../src/common.mjs';

function fixture(options = {}) {
  let clock = Date.parse('2026-11-02T00:00:00Z');
  let disk = { schema: 1, autoCheck: true, results: {}, ...options.state };
  let bundles = [{ name: 'dsh-example', version: '1.0.0', source: 'dsh-example@^1.0.0', installed: true,
    enabled: options.enabled ?? false, official: false, availability: 'profile' }];
  const calls = []; let checks = 0;
  const store = { load: async () => structuredClone(disk), save: async value => { if (options.failSave) throw new Error('storage denied'); disk = structuredClone(value); } };
  const inspector = async bundle => {
    checks++; if (options.inspect) return options.inspect(bundle);
    return { status: 'available', sourceKind: 'npm', latestVersion: '1.1.0', candidate: {
      manifest: { name: bundle.name, version: '1.1.0' }, spec: `${bundle.name}@1.1.0`, registry: null, notes: 'changes',
    } };
  };
  const manager = {
    listBundles: async () => structuredClone(bundles),
    removeBundle: async name => { calls.push(['remove', name]); if (options.remove) return options.remove({ get: () => bundles, set: v => { bundles = v; } }); bundles = bundles.filter(b => b.name !== name); return { application: 'applied' }; },
    installBundle: async (spec, config) => {
      calls.push(['install', spec, config]);
      if (options.install) { const value = await options.install(spec, config); if (value) return value; }
      const name = spec.slice(0,spec.lastIndexOf('@')); const version = spec.split('@').at(-1);
      bundles = [...bundles.filter(b => b.name !== name), { name, version, source: spec, installed: true,
        enabled: config.enabled, official: false, availability: 'profile' }];
      return { application: options.hmr === false ? 'restart-required' : 'applied', version };
    },
  };
  const engine = createUpdater({ manager, inspector, store, runtimeVersion: '0.2.1-rc.5',
    now: () => clock, hmr: options.hmr !== false, rollbackSource: options.rollbackSource });
  return { engine, manager, calls, get checks() { return checks; }, get disk() { return disk; },
    setBundles: v => { bundles = v; }, advance: ms => { clock += ms; } };
}
async function update(f) { const p = (await f.engine.check()).plugins[0]; return f.engine.startUpdate({ name: p.name, version: p.targetVersion, token: p.token }); }

test('native update ownership is known before checks and follows host eligibility', async () => {
  const f = fixture();
  const bundle = { name: 'dsh-example', version: '1.0.0', source: 'dsh-example@1.0.0',
    installed: true, enabled: false, availability: 'profile', updatable: true };
  f.manager.updateBundle = async () => {};
  f.setBundles([bundle]);
  assert.equal((await f.engine.snapshot()).plugins[0].nativeUpdates, true);
  assert.equal((await f.engine.check()).plugins[0].nativeUpdates, true);
  f.setBundles([{ ...bundle, source: 'github:owner/plugin', updatable: false }]);
  assert.equal((await f.engine.snapshot()).plugins[0].nativeUpdates, false);
  delete f.manager.updateBundle;
  f.setBundles([bundle]);
  assert.equal((await f.engine.snapshot()).plugins[0].nativeUpdates, false);
});

test('daily auto check, no background install and startup catch-up', async () => {
  const f = fixture(); await f.engine.tick(); assert.equal(f.checks, 1); assert.equal(f.calls.length, 0);
  await f.engine.tick(); assert.equal(f.checks, 1); f.advance(DAY); await f.engine.tick(); assert.equal(f.checks, 2);
});
test('auto check can be disabled persistently while manual check still works', async () => {
  const f = fixture(); await f.engine.setSchedule({ autoCheck: false }); await f.engine.tick(); assert.equal(f.checks, 0);
  assert.equal(f.disk.autoCheck, false); await f.engine.check(); assert.equal(f.checks, 1);
});
test('failed schedule write returns an error and retains previous setting', async () => {
  const f = fixture({ failSave: true }); await assert.rejects(f.engine.setSchedule({ autoCheck: false }), /storage/);
  assert.equal((await f.engine.snapshot()).autoCheck, true);
});
test('concurrent manual checks share a run and both return snapshots', async () => {
  const f = fixture(); const [a,b] = await Promise.all([f.engine.check(), f.engine.check()]);
  assert.equal(f.checks, 1); assert.equal(a.plugins.length, 1); assert.equal(b.plugins.length, 1); assert.equal(a.checking, false);
});
test('disabled plugin retains its selection after a successful hot update', async () => {
  const f = fixture(); await update(f); const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'complete'); assert.equal(result.plugins[0].installedVersion, '1.1.0');
  assert.equal(result.plugins[0].enabled, false); assert.deepEqual(f.calls.map(c => c[0]), ['remove','install']);
});
test('startup-only hosts update in place without trying to remove running code', async () => {
  const f = fixture({ hmr: false, enabled: true }); await update(f); const result = await f.engine.waitForIdle();
  assert.equal(result.plugins[0].status, 'restart-required'); assert.equal(result.plugins[0].enabled, true);
  assert.deepEqual(f.calls.map(c => c[0]), ['install']);
});
test('failed install restores the exact previous version and disabled state', async () => {
  const f = fixture({ install: async spec => spec.endsWith('@1.1.0') ? { application: 'failed', packageResult: { kind: 'network' } } : null });
  await update(f); const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'failed'); assert.match(result.job.error, /已恢复原版本 1.0.0/);
  assert.equal(result.plugins[0].installedVersion, '1.0.0'); assert.equal(result.plugins[0].enabled, false);
  assert.equal(f.calls.at(-1)[1], 'dsh-example@1.0.0');
});
test('failed restore is visible and never reported as success', async () => {
  const f = fixture({ install: async () => ({ application: 'failed' }) }); await update(f);
  const result = await f.engine.waitForIdle(); assert.equal(result.job.phase, 'failed'); assert.match(result.job.error, /恢复失败/);
});
test('removal failure after disk change also attempts restoration', async () => {
  const f = fixture({ remove: async ({ set }) => { set([]); return { application: 'failed' }; } });
  await update(f); const result = await f.engine.waitForIdle();
  assert.match(result.job.error, /已恢复原版本/); assert.equal(result.plugins[0].installedVersion, '1.0.0');
});
test('no remove or install can run from a forged or stale update token', async () => {
  const f = fixture(); const p = (await f.engine.check()).plugins[0];
  await assert.rejects(f.engine.startUpdate({ name: p.name, version: p.targetVersion, token: 'a'.repeat(36) }), /重新检查/);
  assert.equal(f.calls.length, 0);
});
test('a source change invalidates cached actions before any mutation', async () => {
  const f = fixture(); const p = (await f.engine.check()).plugins[0];
  f.setBundles([{ name: p.name, version: '1.0.0', source: 'link:D:/work', installed: true, enabled: false }]);
  await f.engine.startUpdate({ name: p.name, version: p.targetVersion, token: p.token }); await f.engine.waitForIdle();
  assert.equal(f.calls.length, 0); assert.match((await f.engine.snapshot()).job.error, /已变化/);
});
test('checker cannot uninstall itself during an update', async () => {
  const f = fixture(); f.setBundles([{ name: PACKAGE, version: '1.0.0', source: `${PACKAGE}@^1.0.0`, installed: true, enabled: true }]);
  const result = await f.engine.check(); assert.equal(result.plugins[0].status, 'unsupported');
});
test('network failure is cached as error with a one-hour retry instead of repeating every tick', async () => {
  const f = fixture({ inspect: async () => { throw new Error('offline'); } }); await f.engine.tick();
  assert.equal((await f.engine.snapshot()).plugins[0].status, 'error'); await f.engine.tick(); assert.equal(f.checks, 1);
  f.advance(3600000); await f.engine.tick(); assert.equal(f.checks, 2);
});
test('runtime changes invalidate an earlier compatibility check', async () => {
  const old = { name: 'dsh-example', version: '1.0.0', source: 'dsh-example@^1.0.0' };
  const f = fixture({ state: { results: { 'dsh-example': { status: 'available', fingerprint: fingerprint(old, '0.2.1-rc.2') } } } });
  assert.equal((await f.engine.snapshot()).plugins[0].status, 'unchecked');
});
test('previously cached incompatibility is readable and links to the blocked npm version', async () => {
  const old = { name: 'dsh-example', version: '1.0.0', source: 'dsh-example@^1.0.0' };
  const requirements = { '@deepseek-ai/dsh-tools': '^0.2.2-rc.1', '@deepseek-ai/dsh-agent': '^0.2.2-rc.1' };
  const f = fixture({ state: { results: { 'dsh-example': { status: 'blocked', latestVersion: '1.1.0',
    fingerprint: fingerprint(old, '0.2.1-rc.5'), reason: `需要其他 DSH 版本：${JSON.stringify(requirements)}` } } } });
  const [plugin] = (await f.engine.snapshot()).plugins;
  assert.equal(plugin.reason, '需要 DSH ^0.2.2-rc.1（当前 0.2.1-rc.5）');
  assert.equal(plugin.url, 'https://www.npmjs.com/package/dsh-example/v/1.1.0');
  assert.equal(plugin.token, undefined);
  assert.equal(f.checks, 0);
});
test('GitHub update refuses to remove code without a known immutable rollback source', async () => {
  const f = fixture(); f.setBundles([{ name: 'dsh-example', version: '1.0.0', source: 'https://github.com/u/p', installed: true, enabled: false }]);
  await update(f); const result = await f.engine.waitForIdle(); assert.match(result.job.error, /恢复来源/); assert.equal(f.calls.length, 0);
});
test('multiple startup-only updates retain all pending restart states', async () => {
  const f = fixture({ hmr: false });
  f.setBundles(['one','two'].map(name => ({ name, version: '1.0.0', source: name+'@^1.0.0', installed: true, enabled: false })));
  let s = await f.engine.check();
  for (const name of ['one','two']) {
    const p = s.plugins.find(p => p.name === name);
    await f.engine.startUpdate({ name, version: p.targetVersion, token: p.token }); s = await f.engine.waitForIdle();
  }
  assert.deepEqual(s.plugins.map(p => p.status), ['restart-required','restart-required']);
});
