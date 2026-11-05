import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sdkFixture } from './sdk-fixture.mjs';
import { startChrome, delay } from './chrome.mjs';
const root = new URL('../', import.meta.url);
const output = new URL('work/browser/', root); await mkdir(output, { recursive: true });
const sdk = await sdkFixture();
const client = await readFile(new URL('lib/client.js', root), 'utf8');
const react = pathToFileURL(fileURLToPath(new URL('node_modules/react/umd/react.development.js', root))).href;
const reactDom = pathToFileURL(fileURLToPath(new URL('node_modules/react-dom/umd/react-dom.development.js', root))).href;
const inline = text => text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
:root{color-scheme:light;--dsw-alias-label-primary:#17191d;--dsw-alias-label-secondary:#626a77;--dsw-alias-label-tertiary:#7c8491;--dsw-alias-label-caption:#89919c;--dsw-alias-bg-layer-1:#f7f8fa;--dsw-alias-bg-layer-2:#fff;--dsw-alias-border-l3:#e4e7ec;--dsw-alias-state-business-primary:#376ee3;--dsw-alias-interactive-bg-hover:#f3f5f8;--dsw-radius-xl:12px;--dsw-radius-lg:10px;--dsw-radius-md:8px;--dsw-radius-sm:6px}*{box-sizing:border-box}body{margin:0;font:14px/1.5 'Segoe UI','Microsoft YaHei',sans-serif;color:#17191d;background:#fff}#native-root{display:flex;min-height:100vh}aside{width:220px;flex:none;background:#f7f8fa;padding:28px 16px}aside h2{margin:0 10px 28px;font-size:20px}nav button{display:flex;align-items:center;width:100%;padding:12px 16px;border:0;border-radius:9px;background:#eceef2;font:inherit;color:inherit;text-align:left}main{flex:1;min-width:0}.fixture-switch{appearance:none;width:36px;height:21px;border-radius:12px;background:#ddd;position:relative;margin:0}.fixture-switch:checked{background:#14171c}.fixture-switch:after{content:'';position:absolute;top:3px;left:3px;width:15px;height:15px;border-radius:50%;background:#fff}.fixture-switch:checked:after{left:18px}.fixture-icon{width:24px;height:24px;background:linear-gradient(110deg,#4b93ff,#40cdb0);border-radius:5px}.fixture-native-title{font-size:22px;font-weight:500;margin:26px 0 12px}@media(max-width:700px){aside{display:none}}
${sdk.css}</style><script src="${react}"></script><script src="${reactDom}"></script></head><body><div id="native-root"></div><script>
const h=React.createElement;const jsx=(type,props,key)=>h(type,key===undefined?props:{...props,key});const jsxs=(type,props,key)=>jsx(type,{...props,children:React.Children.toArray(props.children)},key);
const prefix=${JSON.stringify(sdk.prefix)};const styles=new Proxy({},{get:(_,key)=>prefix+'_'+key});
const Empty=()=>null;const Enable=({pkg,onSetEnabled})=>h('input',{type:'checkbox',role:'switch',className:'fixture-switch',checked:pkg.enabled,onChange:e=>onSetEnabled(e.target.checked),'aria-label':'启用 '+pkg.name});
const nativeFactory=new Function('react','react_jsx_runtime','_deepseek_ai_dsh_client_ui_primitives','PluginManagerPage_module_css_default','packageText','packageStatus','PackageArtwork','EnableSwitch','MetadataError','updateAvailable',${JSON.stringify(inline(sdk.functions+'\nreturn {PackageCard};'))});
const {PackageCard}=nativeFactory(React,{jsx,jsxs,Fragment:React.Fragment},{Tag:({children})=>h('span',null,children)},styles,p=>({title:p.title||p.name,description:p.description}),p=>p.enabled?'running':'disabled',()=>h('span',{className:'fixture-icon'}),Enable,Empty,()=>false);
const packages=[{name:'dsh-better-sidebar',title:'Better Sidebar',version:'0.25.0',enabled:false,description:'更好用的右侧边栏——文件树、编辑器、任务和侧边对话。'},{name:'dsh-reply-suggestions',title:'Reply Suggestions',version:'0.1.20',enabled:true,description:'根据上一轮对话，自动推荐下一句提问。'},{name:'dsh-selection-group',title:'Selection Toolbar',version:'1.6.5',enabled:true,description:'选中文字后，批注、引用或放入侧边对话。'}].map(p=>({...p,installed:true,official:false,availability:'profile',rows:[],removable:true}));
let server={autoCheck:true,checking:false,error:null,plugins:[],lastAttemptAt:null,job:null};let opened=0;let updates=0;let checks=0;
function snapshot(){
  server.plugins=packages.map((p,i)=>{
    const installed={name:p.name,installedVersion:p.version,enabled:p.enabled};
    if(i!==0)return {...installed,status:'current'};
    if(server.job?.phase==='installing')return {...installed,status:'updating',targetVersion:'0.28.2'};
    if(p.version==='0.25.0')return {...installed,status:'available',targetVersion:'0.28.2',token:'11111111-1111-1111-1111-111111111111',notes:'优化大体积历史会话读取，降低启动时内存占用。'};
    return {...installed,status:'blocked',latestVersion:'0.30.1',reason:'需要 DSH ^0.2.2-rc.1（当前 0.2.1-rc.5）',url:'https://www.npmjs.com/package/dsh-better-sidebar/v/0.30.1'};
  });
  return JSON.parse(JSON.stringify(server));
}
const reactRoot=ReactDOM.createRoot(document.getElementById('native-root'));
function packageCard(p){return h(PackageCard,{key:p.name,pkg:p,t:k=>k,resolveText:x=>x,onOpen:()=>opened++,onSetEnabled:enabled=>{p.enabled=enabled;renderNative();}})}
function group(id,title,rows){return h('section',{'data-plugin-group':id,'data-plugin-scope':'global',className:styles.group},h('div',{className:styles.groupHead},h('h3',{className:styles.groupTitle},title)),h('ul',{className:styles.cards},rows.map(packageCard)))}
function renderNative(){ReactDOM.flushSync(()=>reactRoot.render(h(React.Fragment,null,h('aside',null,h('h2',null,'deepseek'),h('nav',null,h('button',{'aria-label':'插件'},'插件'))),h('main',{className:styles.page},h('h1',{className:'fixture-native-title'},'插件'),group('basic','内置插件配置',[{...packages[1],name:'builtin',title:'子智能体',official:true,availability:'installation'}]),group('extensions','实验性插件',[{...packages[1],name:'official',title:'开发者工具',official:true,availability:'installation'}]),group('bundles','已安装插件',packages)))))}renderNative();
const remote={snapshot:async()=>({ok:true,value:snapshot()}),check:async()=>{checks++;await new Promise(r=>setTimeout(r,150));server.lastAttemptAt=new Date().toISOString();return {ok:true,value:snapshot()}},setSchedule:async input=>{server.autoCheck=input.autoCheck;return {ok:true,value:snapshot()}},startUpdate:async input=>{updates++;server.job={name:input.name,phase:'installing'};setTimeout(()=>{packages[0].version='0.28.2';server.job={name:input.name,phase:'complete'};renderNative()},300);return {ok:true,value:snapshot()}}};
const effects=[];const slots={entries:()=>[{options:{id:'plugins',label:()=> '插件'}}],inject:(name,callback)=>{callback();return ()=>{}},register:()=>()=>{}};
const scope={slots,get:()=>remote,effect:callback=>effects.push(callback())};const ctx={remote:{$mount:async()=>{}},inject:(names,callback)=>callback(scope)};
window.__ModuleLoader__={load:definition=>{const plugin=definition.factory(name=>{if(name==='react')return React;throw Error(name)});plugin.apply(ctx)}};
window.__fixture={get opened(){return opened},get updates(){return updates},get checks(){return checks},packages,renderNative,stop:()=>effects.reverse().forEach(f=>f())};
</script><script>${inline(client)}</script></body></html>`;
const preview = new URL('preview.html', output); await writeFile(preview, html);
const chrome = await startChrome(fileURLToPath(output));
try {
  for (const width of [1100,736,375,320]) {
    await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 920, deviceScaleFactor: 1, mobile: false });
    await chrome.send('Page.navigate', { url: preview.href }); await delay(350);
    const metrics = await chrome.evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,actions:[...document.querySelectorAll('.dshpu-actions')].filter(e=>getComputedStyle(e).display!=='none').length,builtin:document.querySelector('[data-plugin-group="basic"] [data-dshpu-owned]')!==null,experimental:document.querySelector('[data-plugin-group="extensions"] [data-dshpu-owned]')!==null})`);
    assert.ok(metrics.scroll <= metrics.width, `overflow at ${width}`); assert.equal(metrics.actions, 1); assert.equal(metrics.builtin, false); assert.equal(metrics.experimental, false);
    if (width === 1100 || width === 375) { const shot = await chrome.send('Page.captureScreenshot', { format: 'png' }); await writeFile(new URL(`preview-${width}.png`, output), Buffer.from(shot.data, 'base64')); }
    console.log(`PASS: ${width}px actual DSH card layout and update scope`);
  }
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 920, deviceScaleFactor: 1, mobile: false });
  await chrome.send('Page.navigate', { url: preview.href }); await delay(250);
  await chrome.evaluate(`document.querySelector('[data-plugin-group="bundles"] .dshpu-summary').previousElementSibling.querySelector('button').click()`); await delay(250);
  assert.equal(await chrome.evaluate('window.__fixture.checks'), 1);
  const bounds = await chrome.evaluate(`(()=>{const e=document.querySelector('[data-plugin-package="dsh-better-sidebar"] .dshpu-primary');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  for (const type of ['mousePressed','mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { type, ...bounds, button: 'left', clickCount: 1 });
  await delay(1500);
  const final = await chrome.evaluate(`({updates:window.__fixture.updates,opened:window.__fixture.opened,enabled:document.querySelector('[data-plugin-package="dsh-better-sidebar"] input').checked,version:document.querySelector('[data-plugin-package="dsh-better-sidebar"] .dshpu-version').textContent})`);
  assert.equal(final.updates, 1); assert.equal(final.opened, 0); assert.equal(final.enabled, false); assert.match(final.version, /0.28.2/);
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 920, deviceScaleFactor: 1, mobile: false });
  const blocked = await chrome.evaluate(`(() => {
    const card = document.querySelector('[data-plugin-package="dsh-better-sidebar"]');
    const release = card.querySelector('.dshpu-actions a');
    return { version: card.querySelector('.dshpu-version').textContent, href: release.href,
      releaseVisible: release.getBoundingClientRect().width > 0,
      updateVisible: card.querySelector('.dshpu-primary').getBoundingClientRect().width > 0,
      overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  assert.match(blocked.version, /新版 0\.30\.1/);
  assert.match(blocked.href, /\/v\/0\.30\.1$/);
  assert.equal(blocked.releaseVisible, true);
  assert.equal(blocked.updateVisible, false);
  assert.equal(blocked.overflow, false);
  console.log('PASS: incompatible release information remains actionable at 320px');
  await chrome.evaluate('window.__fixture.stop()'); assert.equal(await chrome.evaluate('document.querySelectorAll("[data-dshpu-owned]").length'), 0);
  console.log('PASS: pointer click, update polling, disabled-state preservation, React reconciliation and cleanup');
  console.log(`Preview: ${fileURLToPath(preview)}`);
} finally { await chrome.close(); }
