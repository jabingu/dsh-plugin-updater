export const PACKAGE = 'dsh-plugin-updater';
export const SERVICE = 'pluginUpdater';
export const DAY = 86400000;
export const STATUSES = ['unchecked', 'current', 'available', 'blocked', 'unsupported', 'error', 'updating', 'cancelled', 'restart-required'];
export function updateActive(job) {
  return !!job && ['validating', 'removing', 'installing', 'restoring'].includes(job.phase);
}
export function updateProgressText(job) {
  if (job.phase === 'restoring') return '正在恢复原版本，请等待完成';
  if (job.cancelError) return job.cancelError;
  if (job.cancelUnavailable) return '插件已进入生效阶段，正在等待 DSH 完成';
  if (job.cancelRequested) return '正在停止更新并等待 DSH 确认';
  return { validating: '正在核对更新', removing: '正在准备替换插件', installing: '正在更新…' }[job.phase] ?? job.error ?? '';
}

export function validateSchedule(value) {
  if (!value || typeof value.autoCheck !== 'boolean' || Object.keys(value).some(key => key !== 'autoCheck')) throw new TypeError('Invalid schedule');
  return { autoCheck: value.autoCheck };
}
export function validateUpdate(value) {
  if (!value || Object.keys(value).sort().join() !== 'name,token,version'
    || typeof value.name !== 'string' || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(value.name)
    || typeof value.version !== 'string' || value.version.length > 100
    || typeof value.token !== 'string' || !/^[a-f0-9-]{36}$/.test(value.token)) throw new TypeError('Invalid update request');
  return { name: value.name, version: value.version, token: value.token };
}
export function validateStopUpdate(value) {
  if (!value || Object.keys(value).join() !== 'id' || typeof value.id !== 'string'
    || !/^[a-f0-9-]{36}$/.test(value.id)) throw new TypeError('Invalid stop request');
  return { id: value.id };
}
export function validateSnapshot(value) {
  if (!value || typeof value.autoCheck !== 'boolean' || typeof value.checking !== 'boolean'
    || !Array.isArray(value.plugins) || value.plugins.length > 1000
    || value.plugins.some(p => !p || typeof p.name !== 'string' || !STATUSES.includes(p.status)
      || typeof p.enabled !== 'boolean' || typeof p.installedVersion !== 'string')) throw new TypeError('Invalid updater snapshot');
  return value;
}
export function descriptors() {
  return ['snapshot', 'check', 'setSchedule', 'startUpdate', 'stopUpdate'].map(method => ({
    id: `${PACKAGE}#${method}`, service: SERVICE, namespace: SERVICE, method,
    invocation: { kind: 'direct' },
    parameters: ['setSchedule', 'startUpdate', 'stopUpdate'].includes(method) ? [{
      name: 'input', wire: 'input', source: 'json', codec: {
        mode: 'strict', typeSymbol: `${PACKAGE}#${method}Input`,
        create: () => ({ parse: { setSchedule: validateSchedule, startUpdate: validateUpdate, stopUpdate: validateStopUpdate }[method] }),
      },
    }] : [],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: `${PACKAGE}#Snapshot`, create: () => ({ parse: validateSnapshot }) },
  }));
}

export function summaryText(snapshot) {
  if (!snapshot) return '正在读取更新信息…';
  if (snapshot.error) return snapshot.error;
  if (snapshot.job?.phase === 'failed') return snapshot.job.error ?? '插件更新失败，请重新检查';
  if (snapshot.job?.phase === 'cancelled') return snapshot.job.error ?? '更新已停止，请重新检查';
  if (updateActive(snapshot.job)) return `${snapshot.job.name} · ${updateProgressText(snapshot.job)}`;
  if (snapshot.checking) return `正在检查 ${snapshot.plugins.length} 个已安装插件…`;
  const counts = Object.fromEntries(STATUSES.map(s => [s, snapshot.plugins.filter(p => p.status === s).length]));
  const parts = [];
  if (counts.available) parts.push(`${counts.available} 个插件可更新`);
  if (counts.updating) parts.push(`${counts.updating} 个正在更新`);
  if (counts['restart-required']) parts.push(`${counts['restart-required']} 个等待重启`);
  if (counts.blocked) parts.push(`${counts.blocked} 个新版暂不兼容`);
  if (counts.error) parts.push(`${counts.error} 个检查或更新失败`);
  if (counts.unsupported) parts.push(`${counts.unsupported} 个需手动处理`);
  if (counts.unchecked) parts.push(`${counts.unchecked} 个尚未检查`);
  if (!parts.length) return snapshot.plugins.length ? '已安装插件均为最新' : '暂无自行安装的插件';
  return parts.join(' · ');
}
export function badgeCount(snapshot) {
  return snapshot?.plugins.filter(p => p.status === 'available').length ?? 0;
}
export function versionText(plugin) {
  const installed = plugin.installedVersion || '未知版本';
  if (plugin.status === 'blocked') {
    return plugin.latestVersion ? `${installed} · 新版 ${plugin.latestVersion}` : installed;
  }
  return plugin.targetVersion ? `${installed} → ${plugin.targetVersion}` : installed;
}
