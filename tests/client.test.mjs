import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { summaryText, badgeCount, versionText } from '../src/common.mjs';
const require = createRequire(import.meta.url);
const { createDomAdapter } = require('../src/dom.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let client;
runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: definition => { client = definition.factory(name => require(name)); } } },
  AbortController, setTimeout, clearTimeout, console,
});

const plugin = { name: 'dsh-example', installedVersion: '1.0.0', targetVersion: '1.1.0', enabled: false,
  status: 'available', token: '1'.repeat(36), notes: 'Fixed memory usage', sourceKind: 'npm' };
const blocked = { name: plugin.name, installedVersion: plugin.installedVersion, enabled: false,
  status: 'blocked', latestVersion: '2.0.0', reason: '需要 DSH ^0.2.2-rc.1（当前 0.2.1-rc.5）',
  url: 'https://www.npmjs.com/package/dsh-example/v/2.0.0' };
function snapshot(extra = {}) { return { plugins: [plugin], autoCheck: true, checking: false, busy: false,
  error: null, lastAttemptAt: '2026-11-02T00:00:00.000Z', ...extra }; }
function card(name) { return `<li data-plugin-package="${name}"><div class="actual-card-head"><span>icon</span><div><div><button type="button">${name}</button></div><span>Description</span></div><div><label><input type="checkbox" role="switch"></label></div></div></li>`; }
function setup() {
  const dom = new JSDOM(`<html><head></head><body><div><nav><button aria-label="插件"><span>插件</span></button></nav></div><main>
    <section data-plugin-scope="global" data-plugin-group="basic"><div><h3>内置插件配置</h3></div><ul>${card('builtin')}</ul></section>
    <section data-plugin-scope="global" data-plugin-group="extensions"><div><h3>实验性插件</h3></div><ul>${card('official')}</ul></section>
    <section data-plugin-scope="global" data-plugin-group="bundles"><div><h3>已安装插件</h3></div><ul>${card('dsh-example')}</ul></section></main></body></html>`);
  let current = snapshot(); const listeners = new Set(); const calls = [];
  const store = { getSnapshot: () => current, subscribe: f => { listeners.add(f); return () => listeners.delete(f); },
    check: async () => calls.push(['check']), setSchedule: async v => calls.push(['schedule', v]), update: async name => calls.push(['update', name]) };
  const before = dom.window.document.body.innerHTML;
  const stop = createDomAdapter({ document: dom.window.document, store, summaryText, badgeCount, versionText, sidebarLabel: () => '插件' });
  return { dom, document: dom.window.document, store, calls, before, stop,
    set(next) { current = next; for (const f of listeners) f(); } };
}

test('only the downloaded bundles group receives update controls', () => {
  const f = setup();
  assert.equal(f.document.querySelector('[data-plugin-group="basic"] [data-dshpu-owned]'), null);
  assert.equal(f.document.querySelector('[data-plugin-group="extensions"] [data-dshpu-owned]'), null);
  assert.equal(f.document.querySelectorAll('[data-plugin-group="bundles"] .dshpu-primary').length, 1);
  assert.equal(f.document.querySelector('.dshpu-nav-badge').textContent, '1'); f.stop(); f.dom.window.close();
});
test('update and release-note clicks do not trigger the native package card navigation', async () => {
  const f = setup(); let navigated = 0;
  f.document.querySelector('[data-plugin-package="dsh-example"]').addEventListener('click', () => navigated++);
  f.document.querySelector('.dshpu-primary').click(); await wait(5);
  assert.deepEqual(f.calls, [['update','dsh-example']]); assert.equal(navigated, 0);
  f.document.querySelector('.dshpu-link').click(); assert.equal(navigated, 0); assert.equal(f.document.querySelector('.dshpu-notes').hidden, false);
  f.stop(); f.dom.window.close();
});
test('native enable switches remain unchanged when update state refreshes', async () => {
  const f = setup(); const input = f.document.querySelector('[data-plugin-package="dsh-example"] input');
  assert.equal(input.checked, false); f.set(snapshot({ plugins: [{ ...plugin, status: 'updating' }] })); await wait(5);
  assert.equal(input.checked, false); assert.equal(f.document.querySelector('.dshpu-primary').disabled, true);
  f.stop(); f.dom.window.close();
});
test('a native React-style card replacement is enhanced again without duplicates', async () => {
  const f = setup(); f.document.querySelector('[data-plugin-group="bundles"] ul').innerHTML = card('dsh-example'); await wait(15);
  assert.equal(f.document.querySelectorAll('.dshpu-version').length, 1); assert.equal(f.document.querySelectorAll('.dshpu-primary').length, 1);
  f.stop(); f.dom.window.close();
});
test('updater uninstall cleanup restores original page and sidebar', () => {
  const f = setup(); f.stop(); assert.equal(f.document.body.innerHTML, f.before);
  assert.equal(f.document.head.querySelector('style'), null); f.dom.window.close();
});
test('upstream text is rendered as text and cannot create HTML', async () => {
  const f = setup(); f.set(snapshot({ plugins: [{ ...plugin, notes: '<img src=x onerror="alert(1)">' }] })); await wait(5);
  assert.equal(f.document.querySelector('img'), null); assert.match(f.document.querySelector('.dshpu-notes').textContent, /<img/);
  f.stop(); f.dom.window.close();
});
test('failed checks do not retain an update badge or enabled update button', async () => {
  const f = setup(); f.set(snapshot({ plugins: [{ ...plugin, status: 'error', reason: 'offline' }] })); await wait(5);
  assert.equal(f.document.querySelector('.dshpu-nav-badge').hidden, true); assert.equal(f.document.querySelector('.dshpu-actions').hidden, true);
  assert.match(f.document.querySelector('.dshpu-summary').textContent, /失败/); f.stop(); f.dom.window.close();
});
test('blocked versions offer release information in the list and details without an install action', async () => {
  const f = setup();
  f.set(snapshot({ plugins: [blocked] })); await wait(5);
  const { document } = f;
  const action = document.querySelector('.dshpu-actions');
  const link = action.querySelector('a');
  assert.equal(action.hidden, false);
  assert.equal(action.querySelector('button').hidden, true);
  assert.equal(link.hidden, false);
  assert.equal(link.href, blocked.url);
  assert.equal(link.textContent, '查看新版');
  assert.match(document.querySelector('.dshpu-version').textContent, /1\.0\.0 · 新版 2\.0\.0 · 需要 DSH/);
  assert.equal(document.querySelector('.dshpu-nav-badge').hidden, true);
  const subject = { kind: 'bundle', pkg: { name: plugin.name, installed: true } };
  const render = kind => renderToStaticMarkup(React.createElement(client.DetailContribution, { subject, store: f.store, kind }));
  assert.equal(render('actions'), '');
  assert.match(render('badge'), /暂不兼容/);
  assert.match(render('section'), /新版 2\.0\.0.*查看新版/);
  f.set(snapshot()); await wait(5);
  assert.equal(link.hidden, true);
  assert.equal(link.hasAttribute('href'), false);
  assert.equal(action.querySelector('button').hidden, false);
  f.stop(); f.dom.window.close();
});
test('current plugins hide the action visually, not just through the hidden property', async () => {
  const f = setup(); f.set(snapshot({ plugins: [{ ...plugin, status: 'current' }] })); await wait(5);
  assert.equal(f.dom.window.getComputedStyle(f.document.querySelector('.dshpu-actions')).display, 'none');
  f.stop(); f.dom.window.close();
});
test('native-managed packages keep one detail action owner after delayed checks', async () => {
  const f = setup();
  const subject = { kind: 'bundle', pkg: { name: plugin.name, installed: true } };
  const render = kind => renderToStaticMarkup(React.createElement(client.DetailContribution, { subject, store: f.store, kind }));
  for (const status of ['unchecked', 'available', 'updating']) {
    f.set(snapshot({ plugins: [{ ...plugin, nativeUpdates: true, status }] })); await wait(5);
    assert.equal(render('actions'), '');
    assert.equal(f.document.querySelector('.dshpu-badge').hidden, status === 'unchecked' || status === 'available');
  }
  f.set(snapshot({ plugins: [{ ...plugin, nativeUpdates: true, status: 'available' }] })); await wait(5);
  assert.equal(render('badge'), '');
  assert.match(render('section'), /1\.0\.0 → 1\.1\.0/);
  assert.equal(f.document.querySelector('.dshpu-primary').hidden, false);
  f.set(snapshot({ plugins: [{ ...blocked, nativeUpdates: true }] })); await wait(5);
  assert.match(render('badge'), /暂不兼容/);
  assert.equal(f.document.querySelector('.dshpu-badge').hidden, false);
  f.set(snapshot({ plugins: [{ ...plugin, sourceKind: 'github', nativeUpdates: false }] })); await wait(5);
  assert.match(render('actions'), /更新到 1\.1\.0/);
  f.stop(); f.dom.window.close();
});
test('detail contributions reject official and not-installed subjects', () => {
  const store = { getSnapshot: () => snapshot(), subscribe: () => () => {} };
  for (const pkg of [{ name: plugin.name, installed: true, official: true }, { name: plugin.name, installed: false }]) {
    assert.equal(renderToStaticMarkup(React.createElement(client.DetailContribution, { subject: { kind: 'bundle', pkg }, store, kind: 'section' })), '');
  }
  assert.match(renderToStaticMarkup(React.createElement(client.DetailContribution, { subject: { kind: 'bundle', pkg: { name: plugin.name, installed: true, official: false } }, store, kind: 'actions' })), /更新到 1.1.0/);
});
test('late snapshot response cannot overwrite a newer manual check', async () => {
  let release; const initial = new Promise(resolve => { release = resolve; });
  const remote = { snapshot: () => initial, check: async () => ({ ok: true, value: snapshot({ plugins: [{ ...plugin, targetVersion: '1.2.0' }] }) }) };
  const store = client.createClientStore(remote, globalThis); await store.check();
  release({ ok: true, value: snapshot() }); await wait(5);
  assert.equal(store.getSnapshot().plugins[0].targetVersion, '1.2.0'); store.stop();
});
test('client sends only a verified package identity and token when Update is clicked', async () => {
  let request; const remote = { snapshot: async () => ({ ok: true, value: snapshot() }),
    startUpdate: async v => { request = v; return { ok: true, value: snapshot() }; } };
  const store = client.createClientStore(remote, globalThis); await wait(5); await store.update(plugin.name);
  assert.equal(request.name, plugin.name); assert.equal(request.version, plugin.targetVersion); assert.equal(request.token, plugin.token);
  assert.equal('spec' in request, false); store.stop();
});
