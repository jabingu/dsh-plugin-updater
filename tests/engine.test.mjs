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
  const inspector = async (bundle, signal) => {
    checks++; if (options.inspect) return options.inspect(bundle, signal);
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
    now: () => clock, hmr: options.hmr !== false, rollbackSource: options.rollbackSource,
    cancelWaitMs: options.cancelWaitMs ?? 15000 });
  return { engine, manager, calls, get checks() { return checks; }, get disk() { return disk; },
    setBundles: v => { bundles = v; }, advance: ms => { clock += ms; } };
}
async function update(f) { const p = (await f.engine.check()).plugins[0]; return f.engine.startUpdate({ name: p.name, version: p.targetVersion, token: p.token }); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const nativeBundle = { name: 'dsh-example', version: '1.0.0', source: 'dsh-example@1.0.0',
  installed: true, enabled: false, availability: 'profile', updatable: true };

test('eligible overview updates call the native updater exactly once', async () => {
  const f = fixture(); f.setBundles([nativeBundle]);
  let request;
  f.manager.updateBundle = async (name, version, options) => {
    request = { name, version, options };
    f.setBundles([{ ...nativeBundle, version, source: name + '@' + version }]);
    return { from: '1.0.0', to: version, step: 'install', result: { application: 'applied' } };
  };
  await update(f); const result = await f.engine.waitForIdle();
  assert.equal(request.name, nativeBundle.name); assert.equal(request.version, '1.1.0');
  assert.equal(request.options.requestId, result.job.id);
  assert.equal(result.job.phase, 'complete');
  assert.deepEqual(f.calls, [], 'the wrapper must not remove or reinstall around the native update');
});
test('native update failure uses the host restoration result without a second rollback', async () => {
  const f = fixture(); f.setBundles([nativeBundle]);
  f.manager.updateBundle = async () => ({ step: 'install', result: { application: 'failed' }, restore: { application: 'applied' } });
  await update(f); const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'failed'); assert.match(result.job.error, /保留或恢复/);
  assert.deepEqual(f.calls, []);
});
test('stopping a native install waits for the host to restore the previous version', async () => {
  const f = fixture(); f.setBundles([nativeBundle]);
  const started = deferred(); const outcome = deferred(); const restore = deferred();
  f.manager.updateBundle = async (name, version, { requestId }) => {
    f.engine.nativeProgress({ requestId, step: 'installing' }); started.resolve(requestId);
    await outcome.promise;
    f.engine.nativeProgress({ requestId, step: 'restoring' });
    await restore.promise;
    return { step: 'install', result: { application: 'cancelled' }, restore: { application: 'applied' } };
  };
  let cancelledId;
  f.manager.cancelInstall = async id => { cancelledId = id; outcome.resolve(); return { status: 'cancelled' }; };
  await update(f); const id = await started.promise;
  await assert.rejects(f.engine.stopUpdate({ id: 'b'.repeat(36) }), /已结束/);
  await f.engine.stopUpdate({ id }); await new Promise(r => setTimeout(r, 5));
  const pending = await f.engine.snapshot();
  assert.equal(pending.job.phase, 'restoring'); assert.equal(pending.job.canStop, false);
  await assert.rejects(f.engine.stopUpdate({ id }), /恢复/);
  restore.resolve(); const result = await f.engine.waitForIdle();
  assert.equal(cancelledId, id); assert.equal(result.job.phase, 'cancelled');
  assert.equal(result.plugins[0].installedVersion, '1.0.0'); assert.equal(result.plugins[0].enabled, false);
  assert.deepEqual(f.calls, []);
});
test('a stop requested before native installation is registered is retried with the same id', async () => {
  const f = fixture(); f.setBundles([nativeBundle]);
  const started = deferred(); const finished = deferred(); let attempts = 0;
  f.manager.updateBundle = async (name, version, { requestId }) => {
    started.resolve(requestId); await finished.promise;
    return { step: 'install', result: { application: 'cancelled' } };
  };
  f.manager.cancelInstall = async () => {
    attempts++;
    if (attempts === 1) return { status: 'not-running' };
    finished.resolve(); return { status: 'cancelled' };
  };
  await update(f); const id = await started.promise; await f.engine.stopUpdate({ id });
  assert.equal((await f.engine.snapshot()).job.cancelRequested, true);
  const result = await f.engine.waitForIdle();
  assert.equal(attempts, 2); assert.equal(result.job.phase, 'cancelled');
});
test('too-late cancellation reports the application phase and accepts a completed native update', async () => {
  const f = fixture(); f.setBundles([nativeBundle]); const started = deferred(); const finished = deferred();
  f.manager.updateBundle = async (name, version, { requestId }) => {
    started.resolve(requestId); await finished.promise;
    f.setBundles([{ ...nativeBundle, version, source: name + '@' + version }]);
    return { step: 'install', result: { application: 'applied' } };
  };
  f.manager.cancelInstall = async () => ({ status: 'too-late' });
  await update(f); await f.engine.stopUpdate({ id: await started.promise });
  const pending = await f.engine.snapshot();
  assert.equal(pending.job.canStop, false); assert.equal(pending.job.cancelUnavailable, true);
  finished.resolve(); assert.equal((await f.engine.waitForIdle()).job.phase, 'complete');
});
test('an unconfirmed stop remains active after its response timeout and can be retried', async () => {
  const f = fixture({ cancelWaitMs: 10 }); f.setBundles([nativeBundle]);
  const started = deferred(); const finished = deferred(); const confirmation = deferred();
  f.manager.updateBundle = async (name, version, { requestId }) => {
    started.resolve(requestId); await finished.promise;
    return { step: 'install', result: { application: 'cancelled' } };
  };
  f.manager.cancelInstall = () => confirmation.promise;
  await update(f); const id = await started.promise;
  await f.engine.stopUpdate({ id }); await new Promise(r => setTimeout(r, 25));
  const pending = await f.engine.snapshot();
  assert.equal(pending.job.phase, 'validating'); assert.equal(pending.job.canStop, true);
  assert.match(pending.job.cancelError, /尚未确认/);
  const cached = f.disk.results[nativeBundle.name];
  await assert.rejects(f.engine.startUpdate({ name: nativeBundle.name, version: cached.targetVersion, token: cached.token }), /正在更新/);
  await f.engine.stopUpdate({ id }); confirmation.resolve({ status: 'cancelled' }); finished.resolve();
  assert.equal((await f.engine.waitForIdle()).job.phase, 'cancelled');
});
test('failed native restoration is an error even after the stop was accepted', async () => {
  const f = fixture(); f.setBundles([nativeBundle]);
  f.manager.updateBundle = async () => {
    f.setBundles([]);
    return { step: 'install', result: { application: 'cancelled' }, restore: { application: 'failed' } };
  };
  await update(f); const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'failed'); assert.match(result.job.error, /恢复失败/);
  assert.deepEqual(f.calls, []);
});
test('cancelling validation ends the task even when a read-only inspector ignores the signal', async () => {
  const options = {}; const f = fixture(options); const [target] = (await f.engine.check()).plugins;
  const started = deferred();
  options.inspect = () => { started.resolve(); return new Promise(() => {}); };
  await f.engine.startUpdate({ name: target.name, version: target.targetVersion, token: target.token });
  await started.promise;
  await f.engine.stopUpdate({ id: (await f.engine.snapshot()).job.id });
  assert.equal((await f.engine.waitForIdle()).job.phase, 'cancelled');
  assert.deepEqual(f.calls, []);
});
test('legacy cancellation during removal restores the original without installing the target', async () => {
  const started = deferred(); const finishRemoval = deferred();
  const f = fixture({ remove: async ({ set }) => {
    started.resolve(); await finishRemoval.promise; set([]); return { application: 'applied' };
  } });
  await update(f); await started.promise;
  await f.engine.stopUpdate({ id: (await f.engine.snapshot()).job.id }); finishRemoval.resolve();
  const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'cancelled'); assert.equal(result.plugins[0].installedVersion, '1.0.0');
  assert.deepEqual(f.calls.filter(c => c[0] === 'install').map(c => c[1]), ['dsh-example@1.0.0']);
});
test('legacy installation cancellation restores the removed version and keeps recovery protected', async () => {
  const started = deferred(); const cancel = deferred(); const restoring = deferred(); const restored = deferred();
  const f = fixture({ install: async spec => {
    if (spec.endsWith('@1.1.0')) { started.resolve(); await cancel.promise; return { application: 'cancelled' }; }
    restoring.resolve(); await restored.promise; return null;
  } });
  f.manager.cancelInstall = async () => { cancel.resolve(); return { status: 'cancelled' }; };
  await update(f); await started.promise; const id = (await f.engine.snapshot()).job.id;
  await f.engine.stopUpdate({ id }); await restoring.promise;
  await assert.rejects(f.engine.stopUpdate({ id }), /恢复/);
  restored.resolve(); const result = await f.engine.waitForIdle();
  assert.equal(result.job.phase, 'cancelled'); assert.equal(result.plugins[0].enabled, false);
  assert.equal(result.plugins[0].installedVersion, '1.0.0');
});

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
