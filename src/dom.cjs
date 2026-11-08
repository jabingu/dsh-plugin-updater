'use strict';

const CSS = `
[data-dshpu-owned]{box-sizing:border-box;color:var(--dsw-alias-label-primary,CanvasText);font:inherit}
.dshpu-button{position:relative;z-index:2;white-space:nowrap;font-size:12px;border:1px solid var(--dsw-alias-border-l3,ButtonBorder);border-radius:7px;background:var(--dsw-alias-bg-layer-2,Canvas);color:var(--dsw-alias-label-primary,CanvasText);padding:5px 10px;cursor:pointer;line-height:20px;text-decoration:none}
.dshpu-button:disabled{opacity:.55;cursor:default}.dshpu-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,ButtonFace)}
.dshpu-primary{background:var(--dsw-alias-label-primary,ButtonText);color:var(--dsw-alias-bg-layer-2,ButtonFace);border-color:transparent}
.dshpu-primary:hover:not(:disabled){background:var(--dsw-alias-label-secondary,ButtonText)}
.dshpu-summary,.dshpu-footer,.dshpu-version{font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary,GrayText);overflow-wrap:anywhere}
.dshpu-summary{display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;margin:0 0 4px}.dshpu-footer{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:8px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l3,ButtonBorder)}
.dshpu-footer label{display:flex;gap:7px;align-items:center}.dshpu-footer input{accent-color:var(--dsw-alias-label-primary,CanvasText)}
.dshpu-badge,.dshpu-nav-badge{font-size:11px;line-height:18px;color:var(--dsw-alias-state-business-primary,LinkText);background:color-mix(in srgb,currentColor 10%,transparent);border-radius:5px;padding:0 6px;white-space:nowrap}
.dshpu-version{position:relative;z-index:2;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshpu-link{font:inherit;background:none;padding:0;border:0;color:var(--dsw-alias-state-business-primary,LinkText);cursor:pointer;position:relative;z-index:2}
.dshpu-actions{position:relative;z-index:2;display:inline-flex;align-items:center;margin-inline-end:8px;flex:none}
[data-dshpu-nav]{position:relative}.dshpu-nav-badge{margin-inline-start:auto;flex:none;min-width:18px;text-align:center}
[data-sidebar-collapsed=true] .dshpu-nav-badge{position:absolute;inset-inline-end:0;top:0;line-height:15px;font-size:10px;min-width:15px;padding:0 3px}
.dshpu-notes{color:var(--dsw-alias-label-secondary,CanvasText);font-size:12px;line-height:20px;white-space:pre-wrap;max-height:220px;overflow:auto;overflow-wrap:anywhere;background:var(--dsw-alias-bg-layer-1,Canvas);border:1px solid var(--dsw-alias-border-l3,ButtonBorder);border-radius:8px;padding:12px;margin:4px 8px 12px}
.dshpu-section{margin-top:20px;border-top:1px solid var(--dsw-alias-border-l3,ButtonBorder);padding-top:18px;display:flex;flex-direction:column;gap:10px}.dshpu-section h3{margin:0;font-size:14px;font-weight:500}.dshpu-section p{margin:0;font-size:12px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:640px){[data-plugin-group="bundles"] [data-plugin-package]>:first-child{flex-wrap:wrap}[data-plugin-group="bundles"] [data-plugin-package]>:first-child>div:last-child:has(.dshpu-actions){margin-inline-start:auto}.dshpu-footer{align-items:flex-start}.dshpu-button{min-height:32px}}
[data-dshpu-owned][hidden]{display:none!important}
`;

function createDomAdapter({ document, store, summaryText, badgeCount, versionText, sidebarLabel = () => null }) {
  let disposed = false;
  let scheduled = null;
  let groupMount = null;
  let nav = null;
  const cards = new Map();
  const owned = new Set();
  const win = document.defaultView;
  const style = document.createElement('style'); style.textContent = CSS; style.dataset.dshpuOwned = 'style';
  document.head.append(style);
  function element(tag, className, text = '') {
    const node = document.createElement(tag); node.className = className; node.dataset.dshpuOwned = '';
    node.textContent = text; owned.add(node); return node;
  }
  function setText(node, text) { if (node.textContent !== String(text ?? '')) node.textContent = text ?? ''; }
  function removeOwned(node) {
    for (const child of node.querySelectorAll('[data-dshpu-owned]')) owned.delete(child);
    owned.delete(node); node.remove();
  }
  function button(text, action, primary = false) {
    const node = element('button', `dshpu-button${primary ? ' dshpu-primary' : ''}`, text); node.type = 'button';
    node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); Promise.resolve().then(action).catch(() => {}); });
    return node;
  }
  function dropCard(card) {
    const mounted = cards.get(card); if (!mounted) return;
    for (const node of [mounted.version, mounted.badge, mounted.action, mounted.notes]) removeOwned(node);
    cards.delete(card);
  }
  function makeGroup(group) {
    const heading = group.querySelector(':scope > div:has(h3)');
    if (!heading) return null;
    const check = button('检查更新', () => store.check()); heading.append(check);
    const summary = element('div', 'dshpu-summary'); const line = element('span', ''); line.setAttribute('role', 'status'); line.setAttribute('aria-live', 'polite');
    const timestamp = element('span', ''); summary.append(line, timestamp); heading.after(summary);
    const footer = element('div', 'dshpu-footer'); const label = element('label', ''); const auto = element('input', ''); auto.type = 'checkbox';
    auto.addEventListener('change', () => { store.setSchedule({ autoCheck: auto.checked }).catch(() => {}); });
    label.append(auto, document.createTextNode('自动检查更新')); const hint = element('span', '', '每天检查，仅提醒'); footer.append(label, hint); group.append(footer);
    return { group, check, summary, line, timestamp, footer, auto, hint };
  }
  function makeCard(card, name) {
    const head = card.firstElementChild;
    const main = head?.children[1];
    const title = main?.firstElementChild;
    const end = head?.lastElementChild;
    if (!main || !title || end === main || !title.querySelector('button')) return null;
    const badge = element('span', 'dshpu-badge'); title.append(badge);
    const version = element('div', 'dshpu-version'); main.append(version);
    const text = element('span', '');
    const showNotes = element('button', 'dshpu-link', '更新内容'); showNotes.type = 'button'; showNotes.setAttribute('aria-expanded', 'false');
    const notes = element('div', 'dshpu-notes'); notes.hidden = true; card.append(notes);
    showNotes.addEventListener('click', event => { event.stopPropagation(); event.preventDefault(); notes.hidden = !notes.hidden; showNotes.setAttribute('aria-expanded', String(!notes.hidden)); });
    version.append(text, showNotes);
    const action = element('span', 'dshpu-actions'); const update = button('更新', () => store.update(name), true);
    const release = element('a', 'dshpu-button', '查看新版');
    release.target = '_blank'; release.rel = 'noreferrer';
    release.addEventListener('click', event => event.stopPropagation());
    action.append(update, release); end.prepend(action);
    const mounted = { main, badge, version, text, showNotes, notes, action, update, release }; cards.set(card, mounted); return mounted;
  }
  function sync() {
    if (disposed) return;
    if (!style.isConnected) document.head.append(style);
    const snapshot = store.getSnapshot();
    const active = snapshot.job && ['validating', 'removing', 'installing', 'restoring'].includes(snapshot.job.phase);
    const plugins = new Map(snapshot.plugins.map(p => [p.name, p]));
    const group = document.querySelector('[data-plugin-scope="global"][data-plugin-group="bundles"]');
    if (groupMount && (groupMount.group !== group || !groupMount.check.isConnected || !groupMount.footer.isConnected)) {
      for (const node of [groupMount.check, groupMount.summary, groupMount.footer]) removeOwned(node); groupMount = null;
    }
    if (group && !groupMount) groupMount = makeGroup(group);
    if (groupMount) {
      const m = groupMount;
      m.check.disabled = snapshot.checking || !!active || snapshot.busy;
      setText(m.check, snapshot.checking ? '正在检查…' : '检查更新');
      setText(m.line, snapshot.uiError ?? summaryText(snapshot));
      const timestamp = snapshot.lastAttemptAt && new Date(snapshot.lastAttemptAt);
      setText(m.timestamp, timestamp && Number.isFinite(timestamp.getTime()) ? `上次检查：${timestamp.toLocaleString()}` : '尚未检查');
      m.auto.checked = snapshot.autoCheck; m.auto.disabled = snapshot.busy;
      setText(m.hint, snapshot.persistenceError ?? (snapshot.autoCheck ? '每天检查，仅提醒' : '仅手动检查'));
    }
    for (const [card, mounted] of cards) if (!card.isConnected || !group?.contains(card) || !mounted.version.isConnected || !plugins.has(card.dataset.pluginPackage)) dropCard(card);
    if (group) for (const card of group.querySelectorAll('[data-plugin-package]')) {
      const p = plugins.get(card.dataset.pluginPackage); if (!p) continue;
      const m = cards.get(card) ?? makeCard(card, p.name); if (!m) continue;
      const badgeLabel = { available: '可更新', blocked: '暂不兼容', error: '检查或更新失败', updating: '正在更新', 'restart-required': '待重启' }[p.status];
      m.badge.hidden = !badgeLabel || p.status === 'available' && p.nativeUpdates === true;
      setText(m.badge, badgeLabel);
      setText(m.text, `${versionText(p)}${p.status === 'current' ? ' · 已是最新' : ''}${p.reason ? ` · ${p.reason}` : p.status === 'unchecked' ? ' · 尚未检查' : ''}`);
      m.update.hidden = !['available', 'updating'].includes(p.status);
      m.update.disabled = p.status !== 'available' || snapshot.busy || !!snapshot.error || !!snapshot.uiError || !!active;
      setText(m.update, p.status === 'updating' ? '正在更新…' : '更新');
      m.release.hidden = p.status !== 'blocked' || !p.url?.startsWith('https://');
      if (m.release.hidden) m.release.removeAttribute('href');
      else m.release.href = p.url;
      m.action.hidden = m.update.hidden && m.release.hidden;
      m.showNotes.hidden = !p.notes;
      setText(m.notes, `${p.targetVersion ?? p.latestVersion ?? ''} 更新信息\n${p.notes ?? ''}`);
    }
    // Resolve the registered sidebar label, rather than guessing Chinese or English text.
    const label = sidebarLabel();
    const buttons = label ? [...document.querySelectorAll('nav button[aria-label]')].filter(b => b.getAttribute('aria-label') === label && !b.hasAttribute('aria-haspopup')) : [];
    const target = buttons.length === 1 ? buttons[0] : null;
    if (nav && (nav.target !== target || !nav.badge.isConnected)) { nav.target.removeAttribute('data-dshpu-nav'); nav.badge.remove(); nav = null; }
    if (target && !nav) { const badge = element('span', 'dshpu-nav-badge'); target.dataset.dshpuNav = ''; target.append(badge); nav = { target, badge }; }
    if (nav) { const count = badgeCount(snapshot); nav.badge.hidden = !count || !!snapshot.error; setText(nav.badge, count > 99 ? '99+' : count); nav.badge.setAttribute('aria-label', `${count} 个已安装插件可更新`); }
  }
  function schedule() {
    if (scheduled !== null || disposed) return;
    scheduled = win.setTimeout(() => { scheduled = null; sync(); }, 0);
  }
  const isOurs = node => node.nodeType === 1 && (node.hasAttribute('data-dshpu-owned') || node.closest('[data-dshpu-owned]'));
  const observer = new win.MutationObserver(records => {
    if (!style.isConnected || records.some(r => !isOurs(r.target) && [...r.addedNodes, ...r.removedNodes].some(n => !isOurs(n)))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const unsubscribe = store.subscribe(schedule); sync();
  return () => {
    disposed = true; observer.disconnect(); unsubscribe(); if (scheduled !== null) win.clearTimeout(scheduled);
    for (const card of cards.keys()) dropCard(card);
    if (nav) { nav.target.removeAttribute('data-dshpu-nav'); nav.badge.remove(); }
    for (const node of owned) node.remove(); owned.clear(); style.remove();
  };
}

exports.createDomAdapter = createDomAdapter;
exports.CSS = CSS;
