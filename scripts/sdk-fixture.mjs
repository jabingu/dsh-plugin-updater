import { readFile } from 'node:fs/promises';

export async function sdkFixture() {
  const client = await readFile(new URL('../work/dsh-0.2.1-rc.5/dsh-client-ui-plugin-manager.js', import.meta.url), 'utf8');
  const sidebar = await readFile(new URL('../work/dsh-0.2.1-rc.5/dsh-client-ui-sidebar.js', import.meta.url), 'utf8');
  const manager = await readFile(new URL('../work/dsh-0.2.1-rc.5/dsh-plugin-manager.js', import.meta.url), 'utf8');
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
  return { client, sidebar, manager, css, prefix,
    functions: declaration('CardHead') + declaration('PackageCard') };
}
