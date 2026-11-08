import { readFile } from 'node:fs/promises';

export async function sdkFixture() {
  const version = process.env.DSH_SDK_VERSION ?? '0.2.1-rc.5';
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('Invalid DSH SDK version');
  const directory = new URL(`../work/dsh-${version}/`, import.meta.url);
  const client = await readFile(new URL('dsh-client-ui-plugin-manager.js', directory), 'utf8');
  const sidebar = await readFile(new URL('dsh-client-ui-sidebar.js', directory), 'utf8');
  const manager = await readFile(new URL('dsh-plugin-manager.js', directory), 'utf8');
  function declaration(name) {
    const start = client.indexOf(`\n\t\tfunction ${name}(`);
    const end = client.indexOf('\n\t\tfunction ', start + 2);
    if (start < 0 || end < 0) throw new Error(`SDK function unavailable: ${name}`);
    return client.slice(start, end);
  }
  const raw = client.match(/const css = ("(?:[^"\\]|\\.)*");/);
  if (!raw) throw new Error('SDK CSS unavailable');
  const css = JSON.parse(raw[1]);
  const prefix = css.match(/\.([\w-]+)_cardHead\{/)[1];
  return { version, client, sidebar, manager, css, prefix,
    detailFunctions: ['rowRef', 'packageRef', 'DetailTop', 'PackageDetail', 'updateAvailable',
      ...(version === '0.2.2-rc.1' ? ['versionUpdate', 'updateCandidate', 'installable'] : [])].map(declaration).join('\n'),
    functions: declaration('CardHead') + declaration('PackageCard') };
}
