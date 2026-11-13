import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { getDshRuntimeVersion, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess';
import { execa } from 'execa';
import { parseDocument } from 'yaml';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PACKAGE, SERVICE, descriptors } from './common.mjs';
import { createStore } from './store.mjs';
import { createInspector, sourceOf } from './sources.mjs';
import { createUpdater } from './engine.mjs';
import { createNpmLookup } from './npm.mjs';

export const name = PACKAGE;
export const inject = ['pluginManager', 'profileContext', 'typert'];

class PluginUpdater extends TypertRemoteService {
  constructor(ctx, config) {
    super(ctx, SERVICE);
    const manager = ctx.pluginManager;
    const profile = ctx.profileContext;
    const runtimeVersion = getDshRuntimeVersion();
    const identity = createHash('sha256').update(resolve(profile.dir)).digest('hex').slice(0,24);
    const directory = join(resolveDshHome(), 'storages', PACKAGE);
    const storageReady = mkdir(directory, { recursive: true, mode: 0o700 });
    storageReady.catch(() => {}); // Report a write failure through the UI, never as an unhandled rejection.
    const file = join(directory, `${identity}.json`);
    const store = createStore(file, {
      withFileLock: async (...args) => { await storageReady; return withFileLock(...args); }, writeFileAtomic,
    }, { autoCheck: config.autoCheck !== false });
    const timeoutMs = config.timeoutMs ?? 20000;
    const inspector = createInspector({
      runtimeVersion, evaluate: evaluatePluginCompatibility,
      registries: () => manager.registries(),
      lookupNpm: createNpmLookup({ runtimeVersion, evaluate: evaluatePluginCompatibility, query: async (fields, registry, signal) => {
        const packageManager = profile.packageManager ?? { command: manager.pnpmCommand ?? 'pnpm' };
        const result = await execa(packageManager.command, [
          ...(packageManager.args ?? []), 'view', ...fields, '--json',
          '--config.fetch-retries=0', ...(registry === null ? [] : [`--registry=${registry}`]),
        ], {
          cwd: profile.dir, env: { ...scrubbedParentEnv(), ...(packageManager.env ?? {}) }, extendEnv: false,
          stdin: 'ignore', reject: false, timeout: timeoutMs, cancelSignal: signal,
          maxBuffer: 4 * 1024 * 1024, forceKillAfterDelay: 1000,
        });
        if (result.exitCode !== 0 || result.timedOut) throw new Error(result.timedOut ? '注册表查询超时' : '注册表查询失败，请检查网络、认证或插件是否仍在发布');
        try { return JSON.parse(result.stdout); } catch { throw new Error('注册表返回的 JSON 无法解析'); }
      } }),
      fetchJson: async (url, signal) => {
        const target = new URL(url);
        if (target.origin !== 'https://api.github.com' || target.username || target.password) throw new Error('无效的 GitHub 检查地址');
        const response = await fetch(target, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': `${PACKAGE}/0.1.6` } });
        if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 403 || response.status === 429
          ? 'GitHub 检查达到限额，请稍后重试' : `GitHub 检查失败（${response.status}）`); }
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        try {
          while (true) { const part = await reader.read(); if (part.done) break;
            size += part.value.length; if (size > 2 * 1024 * 1024) throw new Error('GitHub 响应过大'); chunks.push(Buffer.from(part.value)); }
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } finally { await reader.cancel().catch(() => {}); }
      },
    });
    this.updater = createUpdater({ manager, inspector, store, runtimeVersion, hmr: !!ctx.get('hmr'),
      initialAutoCheck: config.autoCheck !== false,
      rollbackSource: async bundle => {
        const source = sourceOf(bundle);
        if (source.kind !== 'github') return null;
        let revision;
        if (/^[a-f0-9]{40}$/.test(source.ref ?? '')) revision = source.ref;
        if (!revision) {
          try {
            const text = await readFile(join(profile.dir, 'pnpm-lock.yaml'), 'utf8');
            if (text.length > 16 * 1024 * 1024) return null;
            const document = parseDocument(text);
            if (document.errors.length) return null;
            const lock = document.toJS({ maxAliasCount: 0 });
            const item = lock.importers?.['.']?.dependencies?.[bundle.name] ?? lock.dependencies?.[bundle.name];
            const recorded = typeof item === 'string' ? item : item?.version;
            revision = recorded?.match(/\b[a-f0-9]{40}\b/)?.[0];
          } catch { return null; }
        }
        return revision ? `${source.repository}.git#${revision}` : null;
      },
    });
    ctx.on('plugin-manager/update-state', progress => this.updater.nativeProgress(progress));
    ctx.effect(() => {
      const run = () => this.updater.tick().catch(() => {});
      run(); const timer = setInterval(run, 60000); timer.unref?.();
      return async () => { clearInterval(timer); await this.updater.dispose(); };
    });
  }
  async snapshot() { return this.updater.snapshot(); }
  async check() { return this.updater.check(); }
  async setSchedule(input) { return this.updater.setSchedule(input); }
  async startUpdate(input) { return this.updater.startUpdate(input); }
  async stopUpdate(input) { return this.updater.stopUpdate(input); }
}

export function apply(ctx, config = {}) {
  if (config.autoCheck !== undefined && typeof config.autoCheck !== 'boolean') throw new TypeError('autoCheck must be boolean');
  if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 60000)) throw new TypeError('timeoutMs must be 1000–60000');
  ctx.plugin(PluginUpdater, { ...config });
  ctx.typert.register({ package: PACKAGE, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: descriptors() });
}
