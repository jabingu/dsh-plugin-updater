import { readFile } from 'node:fs/promises';
import { STATUSES } from './common.mjs';

export function createStore(file, { withFileLock, writeFileAtomic }, defaults = {}) {
  let memory = { schema: 1, autoCheck: true, lastAttemptAt: null, lastCheckedAt: null, results: {}, ...defaults };
  let warning = null;
  let loaded = false;
  async function load() {
    if (loaded) return structuredClone(memory);
    loaded = true;
    try {
      const text = await readFile(file, 'utf8');
      if (text.length > 2000000) throw new Error('cache too large');
      const value = JSON.parse(text);
      if (value.schema !== 1 || typeof value.autoCheck !== 'boolean' || !value.results || Array.isArray(value.results)
        || typeof value.results !== 'object' || Object.keys(value.results).length > 1000
        || Object.values(value.results).some(r => !r || !STATUSES.includes(r.status) || typeof r.fingerprint !== 'string')
        || value.pendingRestarts !== undefined && (!value.pendingRestarts || Array.isArray(value.pendingRestarts)
          || typeof value.pendingRestarts !== 'object')) throw new Error('invalid cache');
      memory = { ...memory, ...value };
    } catch (error) { if (error.code !== 'ENOENT') warning = '更新检查记录不可读，暂不使用旧检查结果'; }
    return structuredClone(memory);
  }
  return {
    load,
    get warning() { return warning; },
    async save(value) {
      await load();
      try {
        await withFileLock(file, async () => writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }));
        memory = structuredClone(value); warning = null;
      } catch { warning = '更新设置或记录未能保存，重启后可能恢复为原值'; throw new Error(warning); }
    },
  };
}
