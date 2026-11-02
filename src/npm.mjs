import semver from 'semver';
import { compatibilityReason } from './sources.mjs';

// npm/pnpm "view name@* <fields>" may return only the latest manifest. Ask for
// the version index first, then inspect exact versions until a compatible one is found.
export function createNpmLookup({ query, runtimeVersion, evaluate }) {
  return async (name, registry, signal, installedVersion) => {
    const index = await query([name, 'versions'], registry, signal);
    const versions = (Array.isArray(index) ? index : [index])
      .filter(v => typeof v === 'string' && semver.valid(v) && !semver.prerelease(v)).sort(semver.rcompare);
    if (!versions.length) throw new Error('注册表没有可核验的稳定版本');
    const newer = versions.filter(v => semver.gt(v, installedVersion));
    const targets = (newer.length ? newer : versions.slice(0,1)).slice(0,20);
    const results = [];
    for (const version of targets) {
      const manifest = await query([`${name}@${version}`, 'name', 'version', 'engines', 'peerDependencies',
        'dsh', 'deprecated', 'os', 'cpu', 'description'], registry, signal);
      if (!manifest || manifest.name !== name || manifest.version !== version) throw new Error('注册表返回的包身份或版本不符');
      results.push(manifest);
      if (!manifest.deprecated && !compatibilityReason(manifest, runtimeVersion, evaluate)) break;
    }
    return results;
  };
}
