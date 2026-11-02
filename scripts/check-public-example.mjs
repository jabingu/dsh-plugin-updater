import { execa } from 'execa';
import { createInspector } from '../src/sources.mjs';
import { createNpmLookup } from '../src/npm.mjs';
const runtimeVersion = '0.2.1-rc.5';
const inspect = createInspector({ runtimeVersion,
  registries: async () => ({ registry: 'https://registry.npmjs.org/', resolved: 'https://registry.npmjs.org/', fallbackRegistries: [] }),
  lookupNpm: createNpmLookup({ runtimeVersion, query: async fields => {
    const result = await execa('npm', ['view', ...fields, '--json', '--fetch-retries=0', '--registry=https://registry.npmjs.org/'],
      { timeout: 20000, reject: false, maxBuffer: 4 * 1024 * 1024 });
    if (result.exitCode !== 0) throw new Error('Public npm query failed');
    return JSON.parse(result.stdout);
  } }),
});
const result = await inspect({ name: 'dsh-better-sidebar', version: '0.25.0', source: 'dsh-better-sidebar@^0.25.0' });
console.log(JSON.stringify({ package: 'dsh-better-sidebar', installedExample: '0.25.0', status: result.status,
  compatibleVersion: result.candidate?.manifest.version, latestVersion: result.latestVersion, reason: result.reason }, null, 2));
