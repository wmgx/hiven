#!/usr/bin/env node
// Real plugin runtime, registry, controller, result builder and host API, with
// synthetic installs and fail-closed native/UI boundaries. No browser or disk deletion.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const requireRepo = createRequire(process.cwd() + '/package.json');
const ts = requireRepo('typescript');
const no = () => {};
const fail = name => () => { throw new Error('Forbidden I/O: ' + name); };
function loadSource(src, imports = {}, extra = {}, filename = 'probe') {
  const out = ts.transpileModule(src, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports = {};
  const box = {exports,module:{exports},console,URL,setTimeout,clearTimeout,structuredClone,...extra,require:id=>{
    if (Object.hasOwn(imports,id)) return imports[id];
    throw new Error('Unstubbed dependency: ' + id + ' in ' + filename);
  }};
  vm.runInNewContext(out,box,{filename});
  return box.module.exports;
}
const load = (path, imports={}, extra={}) => loadSource(fs.readFileSync(path,'utf8'),imports,extra,path);
const state={opens:[],copies:[],apps:[],native:[],clears:[],stops:[],cleanup:[],selections:[],events:[]};
const localStorageData = new Map();
const localStorage={getItem:key=>localStorageData.get(key)??null,setItem:(key,value)=>localStorageData.set(key,value),removeItem:key=>localStorageData.delete(key)};
const storeDeps={'zustand':requireRepo('zustand'),'zustand/middleware':{persist:config=>config},'../utils/persistMigration':{migrateLocalStorageKey:no}};
const pluginStore=load('src/workspace/pluginStore.ts',storeDeps);
const settings=load('src/workspace/pluginSettingsStore.ts',storeDeps);
const permissions=load('src/workspace/pluginPermissions.ts',storeDeps);
const registry=load('src/workspace/pluginRegistry.ts',{'react':{useSyncExternalStore:(_sub,get)=>get()}});
const i18n=load('src/i18n/registry.ts');
i18n.registerMessages('palette', load('src/i18n/locales/palette.ts').default);
const pluginI18n=load('src/i18n/pluginI18nRegistry.ts',{'./registry':i18n});
const pluginSource=load('src/workspace/launcher/pluginSource.ts',{'../pluginStore':pluginStore});
const types=load('src/workspace/launcher/types.ts');
const identity=load('src/workspace/launcher/identity.ts',{'./types':types});
const normalize=load('src/workspace/launcher/normalizeContribution.ts',{'./identity':identity,'./pluginSource':pluginSource,'../pluginRegistry':registry});
const editor={cleanupEditorPluginContributions:async value=>state.cleanup.push(value),getActiveEditorContextSnapshot:()=>null,getActiveEditorPaneSnapshot:()=>null};
const pluginStorage={clearPluginPrivateStorage:(...args)=>state.clears.push(['storage',...args]),createPluginPrivateStorage:()=>({kv:{get:async()=>undefined,set:async()=>{}}})};
const native={invoke:async(command,args)=>{
  state.native.push({command,args});
  if(command==='get_config_dir') return '/tmp/hiven-synthetic-config-no-disk';
  if(command==='remove_plugin_dir') {assert.equal(args.rootPath,'/tmp/hiven-synthetic-config-no-disk/plugins/installed');return;}
  throw new Error('Forbidden native command: '+command);
},convertFileSrc:fail('asset import')};
const runtime=load('src/workspace/pluginRuntime.ts',{
  './editorBridge':editor,'./pluginRegistry':registry,'./pluginStore':pluginStore,'./toast':{showToast:no},
  './pluginScaffold.ts':{createPluginScaffoldFiles:fail('scaffold')},'./pluginDebugRunner.ts':{parsePluginDefinitionSource:fail('dev loader')},
  '../pluginHostSdk.ts':{createPluginHostSdk:fail('sdk')},'../i18n/pluginI18nRegistry.ts':pluginI18n,
  './pluginBackgroundManager.ts':{stopPluginBackground:async(...args)=>state.stops.push(args)},'./pluginStorage.ts':pluginStorage,
  './pluginPermissions.ts':permissions,'./pluginSettingsStore.ts':settings,
  './pluginSurfaceShortcuts.ts':{usePluginSurfaceShortcutStore:{getState:()=>({clearPluginShortcuts:(...args)=>state.clears.push(['shortcuts',...args])})}},
  '@tauri-apps/api/core':native,'@tauri-apps/plugin-fs':{watch:fail('watch')},'@tauri-apps/plugin-dialog':{open:fail('dialog')},
},{localStorage,window:{localStorage}});
const pluginApi=load('src/workspace/launcher/pluginApi.ts',{
  '../effectRunner':{openExternalUrl:async url=>state.opens.push(url)},'../toast':{showToast:no},
  '../launcherHostSurfaceBridge':{requestOpenLauncherHostSurface:fail('host surface')},'../pluginSurfaceOpenRequest':{openLauncherHostedPluginSurface:fail('plugin surface')},
  '../pluginRegistry':registry,'../pluginStorage':pluginStorage,'../pluginPermissions':permissions,'../editorBridge':editor,
  '../quickEditor/quickEditorRequests':{createQuickEditorPane:fail('pane'),overwriteQuickEditorText:fail('editor'),showQuickEditorSurface:fail('show editor')},
  '../quickEditor/quickEditorPaneSnapshot':{readQuickEditorPaneSnapshot:()=>null},'../nativeClipboard':{readNativeClipboardText:fail('clipboard read')},
  '../pluginPaste':{createPluginPaste:fail('paste')},'../appLauncher/appLaunchError':{rethrowAppLaunchError:fail('app error')},
  '../pluginClipboard':{writeClipboardText:async(...args)=>state.copies.push(args)},'@tauri-apps/api/core':native,
});
const output=load('src/workspace/launcher/output.ts',{'./types':types,'../../i18n':i18n});
const {LauncherController}=load('src/workspace/launcher/controller.ts',{
  './pluginLifetime':load('src/workspace/launcher/pluginLifetime.ts'),
  '../usageJournal':{appendUsageJournal:async()=>{}},'./output':output,'./foregroundSelectionCapture':{captureForegroundSelectionText:fail('foreground capture')},'../../i18n':i18n,
  '../telemetry':{TelemetryEvents:{},itemTelemetryProps:()=>({}),trackBehavior:no,trackLatencyFrom:no,telemetryNow:Date.now},
  '../experience/journal':{appendExperienceEvent:no,currentExperienceSessionId:x=>x,newExperienceId:x=>x+'-id'},
  '../experience/errorType':{classifyExperienceError:()=>({status:'failure',errorType:'output-failed'})},'../contentBoundary':{isSafeExperienceIdentifier:()=>true},
  '../experience/saveableParams':{extractSaveableParams:()=>({ok:true,params:{}})},'../experience/miningFingerprint':{createMiningFingerprints:async()=>null},
  '../savedActions/lastSaveableRun':{setLastSaveableRun:no},'../savedActions/store':{touchSavedAction:no},
});
// Actual web-open callbacks and history data, isolated from its optional browser UI.
const model=load('src/plugins/web-open/settings/model.ts');
const queryHistory=load('src/plugins/web-open/queryHistory.ts',{'@hiven/plugin':{}});
const learnedRules=load('src/plugins/web-open/learnedRules.ts',{'./settings/model':model});
const matchPatternCache=load('src/plugins/web-open/matchPatternCache.ts');
const definition=load('src/plugins/web-open/index.tsx',{
  '@hiven/plugin':{definePlugin:def=>def,getPluginHostSdk:fail('sdk')},
  './settings/model':model,'./queryHistory':queryHistory,'./learnedRules':learnedRules,
  './matchPatternCache':matchPatternCache,
  './settings/FaviconCacheModal':{FaviconCacheModal:fail('modal')},
  './settings/BrowserTabsConnectionModal':{BrowserTabsConnectionModal:fail('modal')},
  './faviconCache':{extractDomain:url=>new URL(url).hostname,getFaviconIconSync:()=> 'Globe',resolveFaviconIconForLauncher:()=> 'Globe',FALLBACK_ICON:'Globe'},
  './browserProvider':{},'./browserTabsModel':{},
}).default;
function getLauncherItemSettings(item) {
  const def=registry.pluginRegistry.getPluginDefinition(item.pluginId,item.source);
  return def?.settings ? settings.resolvePluginSettings(item.source,item.pluginId,def.settings).value : undefined;
}
const selection=load('src/components/launcher/GlobalLauncherSelection.ts',{
  '../../workspace/pluginRegistry':registry,'../../workspace/pluginPermissions':permissions,
  '../../workspace/pluginBackgroundManager':{restartPluginBackground:fail('background restart')},
  './launcherParamShortcuts':load('src/components/launcher/launcherParamShortcuts.ts'),
});
const launcherRegistry=load('src/workspace/launcher/registry.ts',{
  '../../i18n':i18n,'../../i18n/pluginI18nRegistry':pluginI18n,'../pluginRegistry':registry,
  '../launcherHostSurfaceBridge':{requestOpenLauncherPluginSettingsSurface:fail('settings')},
  '../pluginSettingsStore':settings,'./types':types,'./identity':identity,'./pluginApi':pluginApi,
  './pluginLifetime':load('src/workspace/launcher/pluginLifetime.ts'),
  '../pluginNetwork':{createPluginNetwork:()=>({})},'../ai/runtime':{createPluginAi:()=>({})},
  '../pluginShell':{createPluginShell:()=>({})},'../pluginPermissions':permissions,
  './perf':{launcherPerfNow:Date.now,logLauncherPerfDuration:no,measureLauncherPerf:(_label,run)=>run()},
  './pluginSource':pluginSource,'./toolAdapter':{adaptToolToLauncherItem:fail('unexpected tool')},
  './normalizeContribution':normalize,'../pluginProductCatalog':{resolvePluginProductMetadata:()=>({}),applyProductProviderToLauncherItem:item=>item},
  '../savedActions/provider':{getSavedActionLauncherItems:()=>[]},'./hostActions':{createSaveLastRunItem:()=>null},
  './display':{resolveDisplayTitle:display=>display.title},'../savedActions/lastSaveableRun':{freshLastSaveableRun:()=>null},
  '../savedActions/compatibility':{savedActionDisabledReason:()=>null},'../savedActions/store':{listSavedActions:()=>[]},
});
const savedActions=load('src/workspace/savedActions/provider.ts',{
  '../launcher/output':output,'./compatibility':{isGlobalLauncherSavedActionOutput:()=>true,savedActionDisabledReason:()=>null},
  './store':{listSavedActions:()=>[],setSavedActionDisabledReason:no},
  './display':{describeSavedAction:()=>({}),savedActionDisabledMessage:reason=>reason},
});
const disposals=[];
const defer=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const settle=()=>new Promise(setImmediate);
let serial=0;
function fixture(source='builtin',kind='submit',locale='en',overrides={}) {
  Object.keys(state).forEach(key=>state[key]=[]);
  const id=kind==='submit'||kind==='history'?'web-open':`lifetime-${++serial}`;
  const settingsSource=source==='builtin'?'builtin':source==='dev'?'dev':'installed';
  const def=kind==='submit'||kind==='history'?definition:{launcher:{items:[]}};
  const record={pluginId:id,displayName:id,version:'1.0.0',entry:'index.mjs',folderPath:'/tmp/hiven-synthetic-config-no-disk/plugins/installed/'+id,packagePath:'/tmp/hiven-synthetic-config-no-disk/plugins/installed/'+id,source,status:'enabled',permissions:['clipboard.write'],capabilities:[],installedAt:1,updatedAt:1};
  pluginStore.usePluginStore.getState().installPlugin(record);
  const register=()=>source==='dev'
    ? registry.pluginRegistry.registerDevPlugin(id,[],[],[],[],def,['clipboard.write'])
    : registry.pluginRegistry.registerProductionPlugin(id,[],[],[],[],def,['clipboard.write']);
  register();
  permissions.usePluginPermissionStore.getState().grantPermissions(settingsSource,id,['clipboard.write']);
  const values=new Map();
  const storage={kv:{get:async key=>structuredClone(values.get(key)),set:async(key,value)=>values.set(key,structuredClone(value)),delete:async key=>values.delete(key)}};
  let contribution;
  if(kind==='submit'||kind==='history') {
    const configured=structuredClone(model.DEFAULT_WEB_QUICK_OPEN_SETTINGS);
    configured.entries=configured.entries.map(entry=>({...entry,recordQueryHistory:true}));
    settings.usePluginSettingsStore.getState().setPluginSettings(settingsSource,id,configured,def.settings.version);
    contribution=def.launcher.itemsFor(settings.resolvePluginSettings(settingsSource,id,def.settings).value).find(item=>item.id==='google');
  } else {
    contribution={id:'copy',display:{title:'Synthetic action'},behavior:{type:'perform'},execute:ctx=>{
      const result=output.textResult('synthetic payload',ctx.api,locale);
      result.output.choices.push({id:'inert-second-option',title:'Other',primaryAction:no});
      return result;
    }};
  }
  Object.assign(contribution,overrides);
  const item=()=>normalize.normalizeContribution(contribution,{systemKey:`plugin:${id}:launcher:${contribution.id}`,kind:'plugin',pluginId:id,source:source==='dev'?'dev':'production'});
  const api=()=>pluginApi.createPluginLauncherApi();
  const controller=new LauncherController({surfaceId:'global-launcher',api:api(),makeApi:item=>({...pluginApi.createPluginLauncherApi({pluginId:item.pluginId,source:item.source,requestedPermissions:registry.pluginRegistry.getPluginPermissions(item.pluginId,item.source)}),apps:{launchApp:async id=>state.apps.push(id)}}),getSettings:getLauncherItemSettings,getStorage:()=>storage,locale,makeT:()=>key=>key,recordSelection:(_surface,item)=>state.selections.push(item.systemKey),requestClose:no,onChange:no,appendExperienceEvent:event=>state.events.push(event)});
  const unsubscribe=registry.pluginRegistry.subscribe(()=>controller.invalidateUnavailablePlugin());
  const dispose=()=>{controller.reset();unsubscribe();source==='dev'?registry.pluginRegistry.unregisterDevPlugin(id):registry.pluginRegistry.unregisterProductionPlugin(id)};
  disposals.push(dispose);
  return {id,item:item(),freshItem:item,controller,storage,settingsSource,register,def,record,unsubscribe};
}
function unavailable(f,locale='en') {
  assert.equal(f.controller.getState().busy,false);
  assert.equal(f.controller.getState().error,i18n.translate(locale,'palette','pluginActionUnavailable'));
}
function untouched() { assert.equal(state.opens.length,0);assert.equal(state.copies.length,0);assert.equal(state.apps.length,0);assert.equal(state.selections.length,0) }
let passed=0;
async function check(name,run) {
  try {await run();passed++;}
  catch(error){error.message=`${name}: ${error.message}`;throw error;}
  finally {while(disposals.length) disposals.pop()();}
}

for(const source of ['builtin','local']) for(const operation of ['disablePlugin','uninstallPlugin']) for(const kind of ['submit','history','result']) {
  await check(`${source}/${operation}/${kind}`,async()=>{
    const f=fixture(source,kind);
    if(kind==='history') await queryHistory.recordQueryHistory(f.storage,'google','saved synthetic query',20);
    // Same shared entry used by mouse, keyboard and contextual object actions.
    selection.executeGlobalLauncherDomainItem({item:f.item,controller:f.controller});
    await settle();
    if(kind==='submit') f.controller.setInputText('synthetic query');
    const before=f.controller.getState().frames.at(-1);
    assert.equal(before.kind,kind==='result'?'result':'collect-input');
    const choice=kind==='result'?before.output.choices[0]:kind==='history'?before.previewOutput.choices[0]:null;
    if(kind==='history') assert.ok(choice,'real web-open history choice exists');
    await runtime[operation](f.id);
    assert.equal(registry.pluginRegistry.getPluginDefinition(f.id,'production'),undefined);
    assert.equal(getLauncherItemSettings(f.item),undefined);
    assert.equal(f.controller.getState().frames.at(-1),before,'draft remains available');
    unavailable(f);
    if(kind==='submit') await f.controller.submitInput(before);
    else { await f.controller.activateChoice(choice); await f.controller.activateSecondary(choice,'copy'); }
    untouched();
    if(operation==='uninstallPlugin') assert.equal(state.native.filter(x=>x.command==='remove_plugin_dir').length,source==='builtin'?0:1);
  });
}

await check('entry guard works before any session render/subscriber',async()=>{
  const f=fixture(); f.unsubscribe();
  await f.controller.selectItem(f.item); f.controller.setInputText('draft');
  runtime.disablePlugin(f.id);
  await f.controller.submitInput(); untouched();unavailable(f);
});

for(const change of ['disable','replace','uninstall']) await check(`${change} never revives retained item, frame or choice`,async()=>{
  const f=fixture('local','result');
  await f.controller.selectItem(f.item);
  const choice=f.controller.getState().frames.at(-1).output.choices[0];
  if(change==='replace') registry.pluginRegistry.registerProductionPlugin(f.id,[],[],[],[],{});
  else await runtime[change==='disable'?'disablePlugin':'uninstallPlugin'](f.id);
  f.register(); // Even exactly the same definition object is a new registration.
  await f.controller.activateChoice(choice);
  await f.controller.selectItem(f.item);untouched();unavailable(f);
  await f.controller.selectItem(f.freshItem());
  await f.controller.activateChoice(f.controller.getState().frames.at(-1).output.choices[0]);
  assert.equal(state.copies.length,1,'a newly selected request works');
});

await check('metadata, duplicate registration and unrelated plugin preserve active draft',async()=>{
  const f=fixture(); await f.controller.selectItem(f.item);f.controller.setInputText('draft');
  const before=f.controller.getState().frames.at(-1);const lifetime=f.item.pluginLifetime;
  pluginStore.usePluginStore.getState().updatePluginMetadata(f.id,{displayName:'Updated title'});
  f.register();
  registry.pluginRegistry.registerProductionPlugin('unrelated',[],[],[],[],{});
  registry.pluginRegistry.unregisterProductionPlugin('unrelated');
  assert.equal(f.freshItem().pluginLifetime,lifetime);assert.equal(f.controller.getState().frames.at(-1),before);
  assert.equal(f.controller.getState().error,null);
  await f.controller.submitInput();assert.equal(state.opens.length,1);
});

await check('production and dev registrations are independent',async()=>{
  const f=fixture('dev','result');await f.controller.selectItem(f.item);
  registry.pluginRegistry.registerProductionPlugin(f.id,[],[],[],[],{});
  runtime.disablePlugin(f.id);
  await f.controller.activateChoice(f.controller.getState().frames.at(-1).output.choices[0]);
  assert.equal(state.copies.length,1);
  await f.controller.selectItem(f.freshItem());
  registry.pluginRegistry.clearAllDev();unavailable(f);
  await f.controller.activateChoice(f.controller.getState().frames.at(-1).output.choices[0]);assert.equal(state.copies.length,1);
});

await check('host-owned material draft survives unrelated revocation and can return',async()=>{
  const f=fixture();let saved;
  await f.controller.selectItem({systemKey:'host:material',kind:'host',display:{title:'Material'},behavior:{type:'collect-input',input:{}},recordUsage:false,execute:({input})=>{saved=input.text;return {ok:true,keepOpen:true}}});
  f.controller.setInputText('keep material');runtime.disablePlugin(f.id);
  assert.equal(f.controller.getState().error,null);
  await f.controller.submitInput();assert.equal(saved,'keep material');
});

for(const method of ['copyText','openUrl','apps.launchApp']) await check(`pending execute cannot start ${method} after disable`,async()=>{
  const gate=defer();let calls=0;
  const f=fixture('local','result','en',{execute:async({api})=>{calls++;await gate.promise;if(method==='apps.launchApp') await api.apps.launchApp('synthetic-app');else await api[method]('synthetic payload');return {ok:true}}});
  const run=f.controller.selectItem(f.item);assert.equal(calls,1);
  runtime.disablePlugin(f.id);unavailable(f);gate.resolve();await run;await settle();
  untouched();assert.equal(state.events.filter(event=>event.eventType==='run.finished'&&event.status==='success').length,0);
  assert.equal(f.controller.getState().frames.at(-1).kind,'list');
});

await check('late execute output never auto-delivers or records success',async()=>{
  const gate=defer();const f=fixture('builtin','result','en',{execute:async({api})=>{await gate.promise;return output.textResult('late output',api,'en')}});
  const run=f.controller.selectItem(f.item);runtime.disablePlugin(f.id);f.register();gate.resolve();await run;await settle();
  untouched();unavailable(f);assert.equal(f.controller.getState().frames.at(-1).kind,'list');
  assert.equal(state.events.filter(event=>event.eventType==='run.finished'&&event.status==='success').length,0);
});

await check('pending suggestion and preview cannot restore revoked actions',async()=>{
  const gate=defer();const f=fixture('local','result','zh',{behavior:{type:'collect-input',input:{}},suggest:async({api})=>{await gate.promise;return output.textResult('late suggestion',api,'zh').output}});
  await f.controller.selectItem(f.item);runtime.disablePlugin(f.id);f.register();gate.resolve();await settle();
  unavailable(f,'zh');assert.equal(f.controller.getState().frames.at(-1).previewOutput,undefined);untouched();
  f.controller.setInputText('草稿');await f.controller.refreshSuggestions();await f.controller.previewInput();await f.controller.submitInput();untouched();
  assert.equal(f.controller.getState().frames.at(-1).inputText,'草稿');
  f.controller.back();assert.equal(f.controller.getState().frames.at(-1).kind,'list');assert.equal(f.controller.getState().error,null);
});

await check('retained API survives successful navigation but not registration removal',async()=>{
  let api;const f=fixture('local','result','en',{execute:ctx=>{api=ctx.api;return {ok:true}}});
  await f.controller.selectItem(f.item);
  await api.copyText('after ordinary success');assert.equal(state.copies.length,1);
  runtime.disablePlugin(f.id);f.register();assert.throws(()=>api.copyText('obsolete'),/no longer available/);assert.equal(state.copies.length,1);
});

await check('dynamic provider API captured by execute is revoked before late delivery',async()=>{
  const gate=defer();const f=fixture('local','result');
  f.def.launcher.dynamicItems=({api})=>[{id:'dynamic-copy',display:{title:'Dynamic copy'},execute:async()=>{await gate.promise;await api.copyText('late dynamic');return {ok:true}}}];
  const [item]=await launcherRegistry.collectDynamicItems('query','global-launcher','en',()=>({}),undefined,{includeHost:false});
  assert.ok(item);assert.equal(item.pluginLifetime,f.item.pluginLifetime);
  const run=f.controller.selectItem(item);runtime.disablePlugin(f.id);gate.resolve();await run;untouched();unavailable(f);
});

await check('pending provider cannot stamp stale items with a replacement registration',async()=>{
  const gate=defer();const started=defer();const f=fixture('local','result');
  f.def.launcher.dynamicItems=async()=>{started.resolve();await gate.promise;return [{id:'late',display:{title:'Late'},execute:no}]};
  const partials=[];
  const collection=launcherRegistry.collectDynamicItems('query','global-launcher','en',()=>({}),undefined,{includeHost:false,onPartial:update=>partials.push(...update.items)});
  await started.promise;runtime.disablePlugin(f.id);f.register();gate.resolve();
  assert.equal((await collection).length,0);assert.equal(partials.length,0);untouched();
});

await check('saved-action projection retains the producer registration',async()=>{
  const f=fixture('local','result');const artifact={id:'synthetic-saved',name:'Saved action',baseActionKey:f.item.systemKey,inputBinding:'prompt',savedParams:{},outputIntent:'copy'};
  const projected=savedActions.projectSavedAction(artifact,f.item,true,false,()=>[f.freshItem()]);
  assert.equal(projected.pluginLifetime,f.item.pluginLifetime);
  await f.controller.selectItem(projected);f.controller.setInputText('saved draft');
  runtime.disablePlugin(f.id);f.register();await f.controller.submitInput();untouched();unavailable(f);
});

await check('parameter and pending prepare paths share the lifecycle gate',async()=>{
  let executions=0;const f=fixture('local','result','en',{params:[{key:'n',type:'text',label:'Name'}],executeWithParams:async()=>{executions++;return {ok:true}}});
  await f.controller.selectItem(f.item,{customizeParams:true});f.controller.setParamQuery('parameter draft');runtime.disablePlugin(f.id);
  await f.controller.commitCurrentParam('name');await f.controller.submitParams();assert.equal(executions,0);unavailable(f);
  assert.equal(f.controller.getState().frames.at(-1).query,'parameter draft');
  f.register();const gate=defer();const item=f.freshItem();item.prepare=async()=>{await gate.promise;return {...item,pluginLifetime:undefined}};
  const run=f.controller.selectItem(item);runtime.disablePlugin(f.id);f.register();gate.resolve();await run;
  assert.equal(f.controller.getState().frames.at(-1).kind,'list');unavailable(f);untouched();
});

console.log(`launcher plugin lifetime: ${passed} real-module behavior scenarios passed`);
