import { randomUUID } from 'node:crypto';
import { DAY, PACKAGE, updateActive, updateProgressText, validateSchedule, validateUpdate, validateStopUpdate } from './common.mjs';
import { fingerprint, normalizeCachedReason, npmVersionUrl, sourceOf, userBundles } from './sources.mjs';

const stoppedError = (message = '更新已停止，请重新检查') => Object.assign(new Error(message), { cancelled: true });
const runIdentity = Symbol.for('dsh-plugin-updater.host-run');
const defaultProcessId = globalThis[runIdentity] ??= randomUUID();
const operationOkay = result => result && !result.error && !['failed', 'cancelled'].includes(result.application);
const resultProblem = result => {
  const code = result?.error?.code ?? result?.packageResult?.kind ?? result?.application ?? 'unknown';
  return ({ 'build-blocked': '安装需要批准构建脚本，请通过 DSH 原生安装流程处理',
    'stop-profile': '当前 DSH 不支持在线替换这个插件，请退出后更新',
    'incompatible-version': 'DSH 拒绝了不兼容的插件版本', 'already-installed': '插件安装状态已改变，请重新检查',
    'network': '下载失败，请检查网络后重试', 'timeout': '下载超时，请重试',
    'permission': '插件目录不可写', 'disk-full': '磁盘空间不足' })[code] ?? `DSH 包管理操作失败（${code}）`;
};

export function createUpdater({ manager, inspector, store, runtimeVersion, hmr = true,
  rollbackSource, now = () => Date.now(), processId = defaultProcessId, initialAutoCheck = true, cancelWaitMs = 15000 }) {
  let state;
  let initialized;
  let checking = null;
  let disposed = false;
  let globalError = null;
  let job = null;
  let jobTask = null;
  let jobAbort = null;
  let nativeUpdate = false;
  let cancelGeneration = 0;
  let cancelTimer = null;
  let cancelRetry = null;
  let persistenceError = null;
  let writes = Promise.resolve();
  const abort = new AbortController();
  const initialize = () => initialized ??= store.load().then(value => {
    state = { autoCheck: initialAutoCheck, results: {}, ...value };
    if (!state.results || Array.isArray(state.results)) state.results = {};
    state.pendingRestarts ??= {};
  });
  const persist = () => {
    const work = writes.catch(() => {}).then(async () => {
      try { await store.save(structuredClone(state)); persistenceError = null; }
      catch (error) { persistenceError = error.message; throw error; }
    });
    writes = work; return work;
  };
  const list = async () => userBundles(await manager.listBundles()).slice(0,1000);
  function dueAt() {
    if (!state.autoCheck) return null;
    const last = Date.parse(state.lastAttemptAt);
    const failed = Object.values(state.results).some(r => r.status === 'error');
    return Number.isFinite(last) ? last + (failed ? 3600000 : DAY) : now();
  }
  function project(bundle) {
    const key = fingerprint(bundle, runtimeVersion);
    const record = state.results[bundle.name];
    const valid = record && record.fingerprint === key;
    const source = sourceOf(bundle);
    const entry = {
      name: bundle.name, installedVersion: bundle.version ?? '', enabled: bundle.enabled === true,
      sourceKind: source.kind, status: 'unchecked', checkedAt: null,
      nativeUpdates: typeof manager.updateBundle === 'function' && bundle.updatable === true,
    };
    if (valid) for (const field of ['status', 'checkedAt', 'latestVersion', 'targetVersion', 'reason', 'notes', 'url', 'token']) {
      if (record[field] !== undefined) entry[field] = record[field];
    }
    if (entry.status === 'blocked') {
      entry.reason = normalizeCachedReason(entry.reason, runtimeVersion);
      if (!entry.url && entry.latestVersion) {
        if (source.kind === 'npm') entry.url = npmVersionUrl(source.name, entry.latestVersion);
        if (source.kind === 'github') entry.url = source.repository;
      }
    }
    if (job?.name === bundle.name && updateActive(job)) { entry.status = 'updating'; entry.reason = updateProgressText(job); }
    if (job?.name === bundle.name && job.phase === 'cancelled') { entry.status = 'cancelled'; entry.reason = job.error; delete entry.token; }
    if (job?.name === bundle.name && job.phase === 'failed') { entry.status = 'error'; entry.reason = job.error; }
    if (job?.name === bundle.name && job.phase === 'complete' && bundle.version === job.to) entry.status = 'current';
    const pending = state.pendingRestarts[bundle.name];
    if (pending?.version === bundle.version && pending.processId === processId) {
      entry.status = 'restart-required'; entry.reason = pending.reason ?? '更新已安装，重启 DSH 后生效'; delete entry.token;
    }
    if (bundle.name === PACKAGE && entry.status === 'available') {
      entry.status = 'unsupported'; entry.reason = '更新检查器自身需先停用，再通过 DSH 原生安装流程更新'; delete entry.token;
    }
    return entry;
  }
  async function snapshot() {
    await initialize();
    let bundles = [];
    try { bundles = await list(); globalError = null; }
    catch { globalError = '无法读取 DSH 的已安装插件列表，请重新连接后重试'; }
    const plugins = bundles.map(project);
    return {
      autoCheck: state.autoCheck, checking: checking !== null, plugins,
      runtimeVersion, lastAttemptAt: state.lastAttemptAt ?? null, lastCheckedAt: state.lastCheckedAt ?? null,
      nextCheckAt: state.autoCheck ? new Date(dueAt()).toISOString() : null,
      error: globalError, persistenceError: persistenceError ?? store.warning ?? null,
      job: job ? { ...job, canStop: updateActive(job) && job.phase !== 'restoring' && !job.cancelPending
        && !job.cancelUnavailable && (job.phase !== 'installing' || typeof manager.cancelInstall === 'function') } : null,
    };
  }
  function check() {
    if (checking) return checking.then(snapshot);
    if (disposed) return Promise.reject(new Error('更新检查器已停止'));
    const operation = (async () => {
      await initialize();
      if (updateActive(job)) return;
      job = null;
      const bundles = await list();
      state.lastAttemptAt = new Date(now()).toISOString();
      const results = {};
      let cursor = 0;
      async function worker() {
        while (cursor < bundles.length && !disposed) {
          const bundle = bundles[cursor++];
          const base = { fingerprint: fingerprint(bundle, runtimeVersion), checkedAt: new Date(now()).toISOString() };
          try {
            const value = await inspector(bundle, abort.signal);
            const { candidate, ...publicValue } = value;
            results[bundle.name] = { ...base, ...publicValue, ...(candidate ? {
              targetVersion: candidate.manifest.version, token: randomUUID(),
              spec: candidate.spec, registry: candidate.registry ?? null,
              notes: String(candidate.notes ?? '').slice(0,12000), url: candidate.url,
            } : {}) };
          } catch (error) {
            results[bundle.name] = { ...base, status: 'error', reason: String(error.message ?? '版本检查失败').slice(0,300) };
          }
        }
      }
      await Promise.all([worker(), worker()]);
      if (disposed) return;
      state.results = results;
      if (Object.values(results).every(r => r.status !== 'error')) state.lastCheckedAt = new Date(now()).toISOString();
      await persist().catch(() => {});
    })();
    checking = operation.then(() => { globalError = null; }, () => { globalError = '无法读取或检查已安装插件，请重试'; })
      .finally(() => { checking = null; });
    return checking.then(snapshot);
  }
  async function setSchedule(input) {
    const { autoCheck } = validateSchedule(input);
    await initialize();
    const before = state.autoCheck;
    state.autoCheck = autoCheck;
    try { await persist(); } catch (error) { state.autoCheck = before; throw error; }
    return snapshot();
  }
  async function startUpdate(input) {
    const request = validateUpdate(input);
    await initialize();
    if (disposed) throw new Error('更新检查器已停止');
    if (checking) throw new Error('正在检查版本，请稍后点击更新');
    if (updateActive(job)) throw new Error('已有插件正在更新，请等待完成');
    const cached = state.results[request.name];
    if (!cached || cached.status !== 'available' || cached.token !== request.token || cached.targetVersion !== request.version) throw new Error('更新信息已变化，请重新检查后更新');
    if (request.name === PACKAGE) throw new Error('请使用 DSH 原生安装流程更新检查器自身');
    job = { id: randomUUID(), name: request.name, from: '', to: request.version, phase: 'validating',
      startedAt: new Date(now()).toISOString(), completedAt: null, error: null,
      cancelRequested: false, cancelPending: false, cancelError: null, cancelUnavailable: false };
    jobAbort = new AbortController();
    nativeUpdate = false;
    jobTask = runUpdate(request, cached).catch(error => {
      job.phase = error.cancelled ? 'cancelled' : 'failed'; job.error = String(error.message ?? '更新失败').slice(0,500);
    }).finally(async () => {
      clearCancellation();
      job.completedAt = new Date(now()).toISOString();
      // Changed on-disk identity invalidates stale "Update" actions, including in another browser.
      if (['failed', 'cancelled'].includes(job.phase)) delete state.results[request.name];
      await persist().catch(() => {});
    });
    return snapshot();
  }
  function clearCancellation() {
    cancelGeneration++;
    clearTimeout(cancelTimer); clearTimeout(cancelRetry);
    if (job) job.cancelPending = false;
  }
  async function stopUpdate(input) {
    const { id } = validateStopUpdate(input);
    await initialize();
    if (!updateActive(job) || job.id !== id) throw new Error('这次更新已结束，请刷新后查看结果');
    if (job.phase === 'restoring') throw new Error('正在恢复原版本，请等待文件恢复完成');
    if (job.cancelPending || job.cancelUnavailable) return snapshot();
    clearCancellation();
    const generation = cancelGeneration;
    job.cancelRequested = true; job.cancelPending = true; job.cancelError = null;
    jobAbort.abort(stoppedError());
    cancelTimer = setTimeout(() => {
      if (generation !== cancelGeneration || !updateActive(job)) return;
      job.cancelPending = false;
      job.cancelError = '停止请求已发送，DSH 尚未确认；可稍后重试停止';
    }, cancelWaitMs);
    async function attempt() {
      if (generation !== cancelGeneration || !updateActive(job) || job.phase === 'restoring') return;
      if (!nativeUpdate && job.phase !== 'installing') return;
      try {
        if (typeof manager.cancelInstall !== 'function') throw new Error('当前 DSH 不支持停止安装');
        const result = await manager.cancelInstall(id);
        if (generation !== cancelGeneration || !updateActive(job)) return;
        if (result?.status === 'not-running') {
          cancelRetry = setTimeout(attempt, 250);
        } else if (result?.status === 'too-late') {
          clearCancellation(); job.cancelUnavailable = true; job.cancelError = null;
        } else if (result?.status !== 'cancelled') throw new Error('DSH 未确认停止结果');
      } catch (error) {
        if (generation !== cancelGeneration || !updateActive(job)) return;
        clearCancellation(); job.cancelError = `${error.message}；可重试停止`;
      }
    }
    void attempt();
    return snapshot();
  }
  function nativeProgress({ requestId, step }) {
    if (!nativeUpdate || job?.id !== requestId || !updateActive(job)) return;
    const phase = { checking: 'validating', removing: 'removing', installing: 'installing', restoring: 'restoring' }[step];
    if (phase) job.phase = phase;
    if (phase === 'restoring') clearCancellation();
  }
  async function inspectUpdate(bundle) {
    const signal = AbortSignal.any([abort.signal, jobAbort.signal]);
    signal.throwIfAborted();
    let onAbort;
    try {
      return await Promise.race([inspector(bundle, signal), new Promise((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      })]);
    } finally { signal.removeEventListener('abort', onAbort); }
  }
  function completeUpdate(bundle, after, installed) {
    if (!after || after.version !== job.to || after.enabled !== bundle.enabled) throw new Error('安装后的版本或启停状态与目标不符');
    state.results[bundle.name] = { fingerprint: fingerprint(after, runtimeVersion), status: 'current', checkedAt: new Date(now()).toISOString() };
    if (installed.application === 'restart-required') {
      state.pendingRestarts[bundle.name] = { version: job.to, processId };
      job.phase = 'restart-required';
    } else job.phase = 'complete';
  }
  async function runNativeUpdate(bundle, candidate) {
    nativeUpdate = true;
    const outcome = await manager.updateBundle(bundle.name, job.to, {
      requestId: job.id, ...(candidate.registry == null ? {} : { registry: candidate.registry }),
    });
    const after = (await list()).find(b => b.name === bundle.name);
    if (operationOkay(outcome?.result) && outcome.step === 'install') {
      completeUpdate(bundle, after, outcome.result);
      return;
    }
    const unchanged = after?.version === bundle.version && after.enabled === bundle.enabled;
    if (outcome?.restore && (!operationOkay(outcome.restore) || !unchanged)) {
      throw new Error(`更新未完成，原版本恢复失败，请通过 DSH 原生入口重新安装 ${bundle.name}@${bundle.version}`);
    }
    const cancelled = outcome?.result?.application === 'cancelled';
    const reason = cancelled ? '更新已停止' : resultProblem(outcome?.result);
    if (outcome?.restore?.application === 'restart-required') {
      state.pendingRestarts[bundle.name] = { version: bundle.version, processId, reason: `原版本已恢复，重启 DSH 后生效；${reason}` };
    }
    const message = unchanged ? `${reason}；原版本 ${bundle.version} 已保留或恢复`
      : `${reason}；请通过 DSH 原生入口检查插件安装状态`;
    if (cancelled && unchanged) throw stoppedError(message);
    throw new Error(message);
  }
  async function runUpdate(request, cached) {
    let bundle = (await list()).find(b => b.name === request.name);
    if (!bundle || fingerprint(bundle, runtimeVersion) !== cached.fingerprint || bundle.readOnlyReason) throw new Error('插件版本、来源或管理权限已变化，请重新检查');
    if (state.pendingRestarts[bundle.name]?.processId === processId) throw new Error('此插件的更新需要先重启 DSH');
    job.from = bundle.version;
    const verified = await inspectUpdate(bundle);
    const candidate = verified.candidate;
    if (verified.status !== 'available' || candidate?.manifest.version !== request.version || candidate.spec !== cached.spec) throw new Error('上游版本或兼容性已变化，请重新检查');
    const oldSource = sourceOf(bundle);
    if (job.cancelRequested) throw stoppedError();
    if (typeof manager.updateBundle === 'function' && bundle.updatable === true && oldSource.kind === 'npm') {
      const latest = (await list()).find(b => b.name === bundle.name);
      if (!latest || fingerprint(latest, runtimeVersion) !== cached.fingerprint) throw new Error('插件安装状态已变化，请重新检查');
      if (job.cancelRequested) throw stoppedError();
      bundle = latest;
      return runNativeUpdate(bundle, candidate);
    }
    const restoreSpec = oldSource.kind === 'npm' ? `${bundle.name}@${bundle.version}` : await rollbackSource?.(bundle);
    if (!restoreSpec) throw new Error('无法确认旧版本的恢复来源，暂不替换这个插件');
    const latest = (await list()).find(b => b.name === bundle.name);
    if (!latest || fingerprint(latest, runtimeVersion) !== cached.fingerprint) throw new Error('插件安装状态已变化，请重新检查');
    bundle = latest; // Preserve even a toggle made while the version was being checked.
    let removalAttempted = false;
    let installationStarted = false;
    try {
      if (job.cancelRequested) throw stoppedError();
      if (hmr) {
        job.phase = 'removing';
        removalAttempted = true;
        const removal = await manager.removeBundle(bundle.name);
        if (!operationOkay(removal)) throw new Error(resultProblem(removal));
        if ((await list()).some(b => b.name === bundle.name)) throw new Error('插件被其他操作重新安装，本次停止更新');
      }
      if (job.cancelRequested) throw stoppedError();
      job.phase = 'installing'; installationStarted = true;
      const installed = await manager.installBundle(candidate.spec, {
        enabled: bundle.enabled, saveExact: true, requestId: job.id,
        ...(candidate.registry == null ? {} : { registry: candidate.registry }),
      });
      if (installed?.application === 'cancelled') throw stoppedError();
      if (!operationOkay(installed)) throw new Error(resultProblem(installed));
      const after = (await list()).find(b => b.name === bundle.name);
      completeUpdate(bundle, after, installed);
    } catch (error) {
      const after = (await list()).find(b => b.name === bundle.name);
      if (after?.version === bundle.version && after.enabled === bundle.enabled) throw error;
      if (!removalAttempted && !installationStarted) throw error;
      if (after && (!installationStarted || ![bundle.version, request.version].includes(after.version))) throw new Error(`${error.message}；检测到其他安装操作，未覆盖其结果`);
      job.phase = 'restoring'; clearCancellation();
      try {
        if (hmr && after) {
          const removal = await manager.removeBundle(bundle.name);
          if (!operationOkay(removal)) throw new Error('恢复前无法移除新版本');
        }
        const restored = await manager.installBundle(restoreSpec, { enabled: bundle.enabled, saveExact: true,
          requestId: `${job.id}-restore`, ...(candidate.registry == null ? {} : { registry: candidate.registry }) });
        const restoredBundle = (await list()).find(b => b.name === bundle.name);
        if (!operationOkay(restored) || restoredBundle?.version !== bundle.version || restoredBundle.enabled !== bundle.enabled) throw new Error('恢复结果不符');
        if (restored.application === 'restart-required') state.pendingRestarts[bundle.name] = { version: bundle.version, processId,
          reason: `原版本已恢复，重启 DSH 后生效；${error.message}` };
        throw Object.assign(new Error(`${error.message}；已恢复原版本 ${bundle.version}`), { restored: true, cancelled: error.cancelled === true });
      } catch (restoreError) {
        if (restoreError.restored) throw restoreError;
        throw new Error(`${error.message}；原版本恢复失败，请通过 DSH 原生安装入口重新安装 ${bundle.name}@${bundle.version}`);
      }
    }
  }
  async function tick() {
    await initialize();
    if (!disposed && state.autoCheck && now() >= dueAt() && !checking && !updateActive(job)) return check();
    return snapshot();
  }
  return { snapshot, check, setSchedule, startUpdate, stopUpdate, nativeProgress, tick,
    async waitForIdle() { await checking; await jobTask; await writes.catch(() => {}); return snapshot(); },
    async dispose() {
      if (updateActive(job) && job.phase !== 'restoring') await stopUpdate({ id: job.id }).catch(() => {});
      disposed = true; abort.abort(); await checking; await jobTask; clearCancellation(); await writes.catch(() => {});
    },
  };
}
