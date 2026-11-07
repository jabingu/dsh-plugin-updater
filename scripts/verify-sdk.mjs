import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { sdkFixture } from './sdk-fixture.mjs';
import { summaryText, badgeCount, versionText } from '../src/common.mjs';
const require = createRequire(import.meta.url);
const { createDomAdapter } = require('../src/dom.cjs');
const sdk = await sdkFixture();
for (const text of ['"data-plugin-package": pkg.name', 'renderGroup("bundles"', '"plugins.detail.actions"', '"plugins.detail.badge"', '"plugins.detail.section"']) assert.ok(sdk.client.includes(text), text);
for (const method of ['listBundles()', 'installBundle(spec, options)', 'removeBundle(name)', 'async registries()']) assert.ok(sdk.manager.includes(method), method);
assert.ok(sdk.sidebar.includes('"aria-label": label') && sdk.sidebar.includes('"nav"'));
const dom = new JSDOM('<html><head></head><body><div id="root"></div></body></html>');
const previous = { window: globalThis.window, document: globalThis.document };
globalThis.window = dom.window; globalThis.document = dom.window.document;
const styles = new Proxy({}, { get: (_, key) => `${sdk.prefix}_${key}` });
const Empty = () => null;
const Enable = ({ pkg, onSetEnabled }) => React.createElement('input', { type: 'checkbox', role: 'switch', checked: pkg.enabled, onChange: e => onSetEnabled(e.target.checked) });
const { PackageCard } = new Function('react', 'react_jsx_runtime', '_deepseek_ai_dsh_client_ui_primitives',
  'PluginManagerPage_module_css_default', 'packageText', 'packageStatus', 'PackageArtwork', 'EnableSwitch', 'MetadataError', 'updateAvailable',
  `${sdk.functions}\nreturn {PackageCard};`)(React, jsxRuntime, { Tag: ({ children }) => React.createElement('span', null, children) },
  styles, p => ({ title: p.name, description: p.description }), p => p.enabled ? 'running' : 'disabled', Empty, Enable, Empty, () => false);
let current = { plugins: [{ name: 'dsh-example', installedVersion: '1.0.0', targetVersion: '1.1.0', status: 'available', enabled: false, notes: 'Release notes' }], autoCheck: true };
const listeners = new Set();
const store = { getSnapshot: () => current, subscribe: f => { listeners.add(f); return () => listeners.delete(f); }, check: async () => {}, update: async () => {}, setSchedule: async () => {} };
const root = createRoot(document.getElementById('root'));
const packageInfo = { name: 'dsh-example', description: 'Actual DSH PackageCard', installed: true, enabled: false,
  official: false, availability: 'profile', rows: [], removable: true, version: '1.0.0' };
function render(enabled) {
  root.render(React.createElement('section', { 'data-plugin-group': 'bundles', 'data-plugin-scope': 'global' },
    React.createElement('div', null, React.createElement('h3', null, '已安装插件')),
    React.createElement('ul', null, React.createElement(PackageCard, { pkg: { ...packageInfo, enabled }, t: x => x,
      resolveText: x => x, onOpen() {}, onSetEnabled() {} }))));
}
try {
  render(false); await new Promise(r => setTimeout(r, 25));
  const stop = createDomAdapter({ document, store, summaryText, badgeCount, versionText });
  assert.equal(document.querySelectorAll('.dshpu-actions').length, 1);
  assert.equal(document.querySelector('input[role="switch"]').checked, false);
  render(true); await new Promise(r => setTimeout(r, 25));
  assert.equal(document.querySelector('input[role="switch"]').checked, true);
  assert.equal(document.querySelectorAll('.dshpu-actions').length, 1);
  assert.equal(document.querySelectorAll('.dshpu-version').length, 1);
  stop(); assert.equal(document.querySelector('[data-dshpu-owned]'), null);
  console.log(`PASS: actual DSH ${sdk.version} PackageCard, React reconciliation, detail slots and manager API contract.`);
} finally { root.unmount(); globalThis.window = previous.window; globalThis.document = previous.document; dom.window.close(); }
