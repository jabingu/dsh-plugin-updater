const { createElement: h, useSyncExternalStore } = require('react');
const { PACKAGE, descriptors, summaryText, badgeCount, versionText } = require('./common.mjs');
const { createDomAdapter } = require('./dom.cjs');

function createClientStore(remote, window) {
  let stopped = false;
  let timer = null;
  let reading = null;
  let sequence = 0;
  let applied = 0;
  let value = { plugins: [], checking: true, autoCheck: true, busy: false, error: null };
  const controller = new AbortController();
  const listeners = new Set();
  function emit(next) { value = next; for (const listener of listeners) listener(); }
  async function call(method, input) {
    const result = await (input === undefined ? remote[method](controller.signal) : remote[method](input, controller.signal));
    if (!result.ok) throw new Error(result.error?.message ?? '无法连接更新服务');
    return result.value;
  }
  function accept(snapshot, rev) { if (!stopped && rev >= applied) { applied = rev; emit({ ...snapshot, busy: value.busy, uiError: null }); } }
  function arm() {
    if (stopped) return;
    window.clearTimeout(timer);
    const active = value.checking || value.job && ['validating', 'removing', 'installing', 'restoring'].includes(value.job.phase);
    timer = window.setTimeout(() => { refresh().finally(arm); }, active ? 1000 : 15000);
  }
  async function refresh() {
    if (reading) return reading;
    const rev = ++sequence;
    reading = call('snapshot').then(result => accept(result, rev)).catch(error => {
      if (!stopped && rev >= applied) emit({ ...value, checking: false, error: '更新服务暂时不可用', uiError: error.message });
    }).finally(() => { reading = null; });
    return reading;
  }
  async function action(method, input) {
    if (stopped || value.busy) return;
    const rev = ++sequence; applied = rev; emit({ ...value, busy: true, uiError: null });
    try { accept(await call(method, input), rev); }
    catch (error) { if (!stopped) emit({ ...value, uiError: error.message }); }
    finally { if (!stopped) { emit({ ...value, busy: false }); arm(); } }
  }
  const api = {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
    check: () => action('check'),
    setSchedule: input => action('setSchedule', input),
    update(name) {
      const p = value.plugins.find(p => p.name === name);
      if (p?.status !== 'available' || !p.token || value.error) return Promise.resolve();
      return action('startUpdate', { name, version: p.targetVersion, token: p.token });
    },
    stop() { stopped = true; controller.abort(); window.clearTimeout(timer); listeners.clear(); },
  };
  refresh().finally(arm);
  return api;
}

function DetailContribution({ subject, store, kind }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (subject?.kind !== 'bundle' || !subject.pkg?.installed || subject.pkg.official || subject.pkg.availability === 'installation') return null;
  const plugin = snapshot.plugins.find(p => p.name === subject.pkg.name);
  if (!plugin) return null;
  const active = snapshot.job && ['validating', 'removing', 'installing', 'restoring'].includes(snapshot.job.phase);
  if (kind === 'actions') return plugin.status === 'available' || plugin.status === 'updating'
    ? h('button', { type: 'button', className: 'dshpu-button dshpu-primary',
      disabled: snapshot.busy || !!snapshot.error || !!active || plugin.status !== 'available',
      onClick: () => store.update(plugin.name) }, plugin.status === 'updating' ? '正在更新…' : `更新到 ${plugin.targetVersion}`) : null;
  if (kind === 'badge') {
    const label = { available: '可更新', blocked: '暂不兼容' }[plugin.status];
    return label ? h('span', { className: 'dshpu-badge' }, label) : null;
  }
  return h('section', { className: 'dshpu-section', 'data-dshpu-detail': plugin.name },
    h('h3', null, '插件更新'),
    h('p', null, `当前版本 ${versionText(plugin)}`),
    h('p', { role: 'status' }, snapshot.uiError ?? plugin.reason ?? ({ current: '已是最新', unchecked: '尚未检查',
      available: '发现兼容当前 DSH 的新版本', updating: '正在更新，完成后将显示是否需要重启', 'restart-required': '更新已安装，重启 DSH 后生效' })[plugin.status] ?? '请查看更新检查结果'),
    plugin.notes && h('p', null, plugin.notes),
    plugin.url?.startsWith('https://') && h('a', { href: plugin.url, target: '_blank', rel: 'noreferrer', className: 'dshpu-link' },
      plugin.status === 'blocked' ? '查看新版' : '查看发布来源'),
    h('div', null, h('button', { type: 'button', className: 'dshpu-button', disabled: snapshot.checking || snapshot.busy || !!active,
      onClick: () => store.check() }, snapshot.checking ? '正在检查…' : '检查更新')));
}

exports.inject = ['slots', 'remote'];
exports.apply = async function apply(ctx) {
  await ctx.remote.$mount({ package: PACKAGE, descriptors: descriptors() });
  ctx.inject(['remote.pluginUpdater'], scope => {
    const remote = scope.get('remote.pluginUpdater');
    scope.effect(() => {
      const store = createClientStore(remote, window);
      const disposeDom = createDomAdapter({ document, store, summaryText, badgeCount, versionText,
        sidebarLabel: () => {
          const entry = scope.slots.entries('sidebar.panellist').find(e => e.options.id === 'plugins');
          const label = entry?.options.label;
          return typeof label === 'function' ? label() : typeof label === 'string' ? label : null;
        } });
      const slots = ['actions', 'badge', 'section'].map(kind => scope.slots.inject(`plugins.detail.${kind}`, () => scope.slots.register({
        name: `plugins.detail.${kind}`, id: `${PACKAGE}.${kind}`, inject: () => ({ store, kind }),
      }, DetailContribution)));
      return () => { for (const dispose of slots) if (typeof dispose === 'function') dispose(); disposeDom(); store.stop(); };
    });
  });
};
exports.createClientStore = createClientStore;
exports.DetailContribution = DetailContribution;
