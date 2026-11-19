import { readFile } from 'node:fs/promises';
import { Script, runInNewContext } from 'node:vm';

export async function sdkFixture() {
  const version = process.env.DSH_SDK_VERSION ?? '0.2.1-rc.5';
  if (!/^[0-9A-Za-z.+-]+$/.test(version)) throw new Error('Invalid DSH SDK version');
  const directory = new URL(`../work/dsh-${version}/`, import.meta.url);
  const client = await readFile(new URL('dsh-client-ui-plugin-manager.js', directory), 'utf8');
  const sidebar = await readFile(new URL('dsh-client-ui-sidebar.js', directory), 'utf8');
  const manager = await readFile(new URL('dsh-plugin-manager.js', directory), 'utf8');
  function declaration(name) {
    const start = client.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`SDK function unavailable: ${name}`);
    // Syntax checking finds the complete function in formatted and minified bundles.
    for (let end = client.indexOf('}', start); end !== -1; end = client.indexOf('}', end + 1)) {
      const source = client.slice(start, end + 1);
      try {
        new Script(`(${source})`);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      return source;
    }
    throw new Error(`SDK function unavailable: ${name}`);
  }
  const raw = client.match(/const css\s*=\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`);/);
  if (!raw) throw new Error('SDK CSS unavailable');
  const css = runInNewContext(raw[1], {}, { timeout: 1000 });
  const prefix = css.match(/\.([\w-]+)_cardHead\{/)[1];
  const nativeUpdates = manager.includes('async updateBundle(');
  const nativeUpdateMetadata = /\bupdate:\s*target\.kind/.test(manager) ? { update: 'registry' } : { updatable: true };
  return { version, client, sidebar, manager, css, prefix, nativeUpdates, nativeUpdateMetadata,
    detailFunctions: ['rowRef', 'packageRef', 'DetailTop', 'PackageDetail', 'updateAvailable',
      ...(nativeUpdates ? ['versionUpdate', 'updateCandidate', 'installable'] : [])].map(declaration).join('\n'),
    functions: declaration('CardHead') + declaration('PackageCard') };
}
