import { readFile, mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const check = process.argv.includes('--check');
const outputs = new Map();
for (const name of ['index.mjs', 'common.mjs', 'sources.mjs', 'npm.mjs', 'store.mjs', 'engine.mjs']) outputs.set(`lib/${name}`, await readFile(new URL(`src/${name}`, root), 'utf8'));
const common = outputs.get('lib/common.mjs');
const names = [...common.matchAll(/^export (?:const|function) (\w+)/gm)].map(m => m[1]);
const dom = await readFile(new URL('src/dom.cjs', root), 'utf8');
const client = await readFile(new URL('src/client.cjs', root), 'utf8');
outputs.set('lib/client.js', `window.__ModuleLoader__.load({id:'dsh-plugin-updater',factory:function(require){\n'use strict';\nconst common=(function(){\n${common.replace(/^export /gm, '')}\nreturn {${names.join(',')}};})();\nconst dom=(function(){const module={exports:{}};const exports=module.exports;\n${dom}\nreturn module.exports;})();\nconst module={exports:{}};const exports=module.exports;const external=require;require=name=>name==='./common.mjs'?common:name==='./dom.cjs'?dom:external(name);\n${client}\nreturn module.exports;\n}});\n`);
if (!check) await mkdir(new URL('lib/', root), { recursive: true });
for (const [file, source] of outputs) {
  if (check) {
    let current; try { current = await readFile(new URL(file, root), 'utf8'); } catch { /* Report missing builds together with stale builds. */ }
    if (current !== source) throw new Error(`${file} is stale; run npm run build`);
  } else await writeFile(new URL(file, root), source);
}
console.log(check ? 'Build artifacts match source.' : 'Built host modules and browser client.');
