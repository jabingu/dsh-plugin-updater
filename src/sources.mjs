import semver from 'semver';

export function userBundles(bundles) {
  return bundles.filter(p => p.installed === true && p.official !== true && p.optional !== true
    && p.availability !== 'installation');
}
export function sourceOf(bundle) {
  const raw = bundle.source;
  if (typeof raw !== 'string' || !raw) return { kind: 'unsupported', reason: '没有可核验的安装来源' };
  if (/^(?:link:|file:|[a-z]:[\\/]|[./~]|\\\\)/i.test(raw)) return { kind: 'local', reason: '本地目录或文件安装，请更新原目录；不自动替换本地代码' };
  const escaped = bundle.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^${escaped}@[^:/\\\\]+$`).test(raw) && !raw.includes('@npm:')) return { kind: 'npm', name: bundle.name };
  let git = raw.replace(/^git\+/, '').replace(/^git@github\.com:/, 'https://github.com/');
  if (git.startsWith('github:')) git = `https://github.com/${git.slice(7)}`;
  try {
    const url = new URL(git);
    if (url.hostname === 'github.com' && ['https:', 'ssh:'].includes(url.protocol) && !url.search
      && (!url.username || url.username === 'git') && !url.password) {
      const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
      if (match && !url.hash.includes('path:')) return {
        kind: 'github', owner: match[1], repo: match[2], ref: decodeURIComponent(url.hash.slice(1)) || null,
        repository: `https://github.com/${match[1]}/${match[2]}`,
      };
    }
  } catch { /* Non-URL sources are displayed explicitly, never treated as npm. */ }
  return { kind: 'unsupported', reason: '暂不支持此安装来源，保留原插件；可手动更新' };
}
export function fingerprint(bundle, runtimeVersion) {
  return JSON.stringify([bundle.name, bundle.version ?? '', bundle.source ?? '', runtimeVersion]);
}
function dshRequirementText(requirements, runtimeVersion) {
  const ranges = [...new Set(Object.values(requirements))];
  return `需要 DSH ${ranges.join(' 且 ')}（当前 ${runtimeVersion}）`;
}
export function normalizeCachedReason(reason, runtimeVersion) {
  const prefix = '需要其他 DSH 版本：';
  if (typeof reason !== 'string' || !reason.startsWith(`${prefix}{`)) return reason;
  try { return dshRequirementText(JSON.parse(reason.slice(prefix.length)), runtimeVersion); }
  catch { return `当前 DSH ${runtimeVersion} 不满足新版的版本要求`; }
}
export function npmVersionUrl(name, version) {
  const path = name.split('/').map(encodeURIComponent).join('/');
  return `https://www.npmjs.com/package/${path}/v/${encodeURIComponent(version)}`;
}
export function compatibilityReason(manifest, runtimeVersion, evaluate, environment = process) {
  if (!manifest?.dsh?.bundle?.patch) return '新版没有声明 DSH 插件组合包';
  try {
    if (evaluate) {
      const issue = evaluate(manifest, {}, runtimeVersion);
      if (issue) return dshRequirementText(issue.requirements, runtimeVersion);
    } else {
      const requirements = Object.hasOwn(manifest.engines ?? {}, 'dsh')
        ? { 'engines.dsh': manifest.engines.dsh }
        : Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).filter(([n]) => n === '@deepseek-ai/dsh' || n.startsWith('@deepseek-ai/dsh-')));
      const unmet = {};
      for (let [key, range] of Object.entries(requirements)) {
        if (key !== 'engines.dsh' && ['workspace:*', 'workspace:^', 'workspace:~'].includes(range)) range = runtimeVersion;
        if (typeof range !== 'string') return '新版兼容性声明无效';
        if (!semver.satisfies(runtimeVersion, range, { includePrerelease: true })) unmet[key] = range;
      }
      if (Object.keys(unmet).length) return dshRequirementText(unmet, runtimeVersion);
    }
    if (manifest.engines?.node && !semver.satisfies(environment.versions.node, manifest.engines.node)) return `需要 Node.js ${manifest.engines.node}`;
    for (const [key, actual] of [['os', environment.platform], ['cpu', environment.arch]]) {
      const rules = manifest[key];
      if (rules !== undefined && (!Array.isArray(rules) || rules.includes(`!${actual}`)
        || rules.some(v => !v.startsWith('!') && v !== 'any') && !rules.includes(actual) && !rules.includes('any'))) return `不支持当前 ${key}：${actual}`;
    }
  } catch { return '新版兼容性声明无效'; }
  return null;
}
export function chooseCandidate(bundle, candidates, runtimeVersion, evaluate) {
  const newer = candidates.filter(c => c.manifest?.name === bundle.name && semver.valid(c.manifest.version)
    && !semver.prerelease(c.manifest.version) && !c.manifest.deprecated
    && semver.valid(bundle.version) && semver.gt(c.manifest.version, bundle.version))
    .sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version));
  const compatible = newer.find(c => !compatibilityReason(c.manifest, runtimeVersion, evaluate));
  if (compatible) return { status: 'available', candidate: compatible, latestVersion: newer[0].manifest.version };
  if (newer.length) return { status: 'blocked', latestVersion: newer[0].manifest.version, url: newer[0].url,
    reason: compatibilityReason(newer[0].manifest, runtimeVersion, evaluate) };
  return { status: 'current' };
}

// Keep private registries private. Mirrors are used only when DSH's own configured plan includes them.
export function registryPlan(configured) {
  const normalize = v => typeof v === 'string' ? new URL(v).href.replace(/\/?$/, '/') : null;
  const own = normalize(configured.resolved);
  const first = normalize(configured.registry);
  const fallbacks = (configured.fallbackRegistries ?? []).map(normalize);
  const known = [null, ...fallbacks];
  const firstKey = first ?? own;
  if (!firstKey) return [null];
  if ((first === null || firstKey === own) && own !== 'https://registry.npmjs.org/' && !fallbacks.includes(own)) return [first];
  if (first !== null && first !== 'https://registry.npmjs.org/' && !fallbacks.includes(first) && first !== own) return [first];
  const result = [first];
  const seen = new Set([firstKey]);
  for (const next of known) {
    const key = next ?? own;
    if (key && !seen.has(key) && (next !== null || own === 'https://registry.npmjs.org/' || fallbacks.includes(own))) { result.push(next); seen.add(key); }
  }
  return result;
}

export function createInspector({ lookupNpm, registries, fetchJson, evaluate, runtimeVersion }) {
  return async function inspect(bundle, signal) {
    const source = sourceOf(bundle);
    if (!semver.valid(bundle.version)) return { status: 'error', reason: '无法读取已安装版本', sourceKind: source.kind };
    if (source.kind !== 'npm' && source.kind !== 'github') return { status: 'unsupported', reason: source.reason, sourceKind: source.kind };
    let candidates;
    if (source.kind === 'npm') {
      const plan = registryPlan(await registries());
      let lastError;
      for (const registry of plan) {
        try {
          const metadata = await lookupNpm(bundle.name, registry, signal, bundle.version);
          const manifests = Array.isArray(metadata) ? metadata : [metadata];
          if (!manifests.length || manifests.some(m => m.name !== bundle.name || !semver.valid(m.version))) throw new Error('注册表返回的版本信息无效');
          candidates = manifests.map(manifest => ({ manifest, spec: `${bundle.name}@${manifest.version}`, registry,
            notes: typeof manifest.description === 'string' ? manifest.description : '', url: npmVersionUrl(bundle.name, manifest.version) }));
          break;
        } catch (error) { lastError = error; if (signal?.aborted) throw error; }
      }
      if (!candidates) throw lastError ?? new Error('注册表查询失败');
    } else {
      const api = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
      const releases = await fetchJson(`${api}/releases?per_page=20`, signal);
      if (!Array.isArray(releases)) throw new Error('GitHub 返回的发布列表无效');
      const stable = releases.filter(r => !r.draft && !r.prerelease && semver.valid(r.tag_name?.replace(/^v/, '')))
        .sort((a, b) => semver.rcompare(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, ''))).slice(0,10);
      const branch = source.ref && !source.ref.startsWith('semver:') && !/^[a-f0-9]{40}$/.test(source.ref)
        && !semver.valid(source.ref.replace(/^v/, '')) ? source.ref : 'HEAD';
      const refs = stable.length ? stable.map(r => ({ ref: r.tag_name, notes: r.body ?? '' }))
        : [{ ref: branch, notes: '发布分支中的插件版本。' }];
      candidates = [];
      for (const { ref, notes } of refs) {
        if (candidates.length && !compatibilityReason(candidates.at(-1).manifest, runtimeVersion, evaluate)) break;
        const commit = await fetchJson(`${api}/commits/${encodeURIComponent(ref)}`, signal);
        if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('GitHub 未返回有效提交编号');
        const content = await fetchJson(`${api}/contents/package.json?ref=${commit.sha}`, signal);
        if (content.encoding !== 'base64' || typeof content.content !== 'string' || content.content.length > 1400000) throw new Error('GitHub 插件清单不可读');
        const manifest = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'));
        if (manifest.name !== bundle.name || !semver.valid(manifest.version)) throw new Error('GitHub 包身份与已安装插件不匹配');
        const url = stable.length ? `${source.repository}/releases/tag/${encodeURIComponent(ref)}` : source.repository;
        candidates.push({ manifest, spec: `${source.repository}.git#${commit.sha}`, notes: String(notes).slice(0,12000), url });
      }
    }
    const chosen = chooseCandidate(bundle, candidates, runtimeVersion, evaluate);
    return { ...chosen, sourceKind: source.kind };
  };
}
