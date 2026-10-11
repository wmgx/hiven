// Real Chromium acceptance, isolated ephemeral profile and synthetic fixtures only.
// Start npm run dev first; HIVEN_PLAYWRIGHT_MODULE may point to an external installation.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.HIVEN_PLAYWRIGHT_MODULE || 'playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.HIVEN_CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],viewport:{width:1280,height:900}});
 require('node:fs').mkdirSync('temp',{recursive:true});
 try {
 const errors=[];
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
 await page.goto('http://127.0.0.1:1420');
 await page.getByText('Browse all available actions').waitFor();
 await page.evaluate(async()=>{
  const {ensurePluginRuntimeReady}=await import('/src/workspace/pluginRuntimeBootstrap.ts');await ensurePluginRuntimeReady('builtin');
  const {usePluginSettingsStore}=await import('/src/workspace/pluginSettingsStore.ts');
  const {DEFAULT_CLIPBOARD_HISTORY_SETTINGS}=await import('/src/plugins/clipboard-history/settings/model.ts');
  usePluginSettingsStore.setState({pluginSettings:{builtin:{'clipboard-history':{version:1,value:{...DEFAULT_CLIPBOARD_HISTORY_SETTINGS,enabled:true,recordText:false,recordImages:false,recordFiles:false}}},installed:{},dev:{}}});
  const entries=['ALPHA','BRAVO','CHARLIE'].map((name,i)=>({id:'synthetic-'+i,kind:'text',hash:'synthetic-hash-'+i,text:name+'\n'+('完整 synthetic text '+i+'\n').repeat(30)+'END-'+name,preview:name,lastCopiedAt:Date.now()-i*1000,firstCopiedAt:Date.now(),copyCount:1,byteSize:1000}));
  window.synthetic=entries;
  for(const item of entries)localStorage.setItem('hiven-plugin-kv:builtin:clipboard-history:history/items/'+item.id,JSON.stringify(item));
  localStorage.setItem('hiven-plugin-kv:builtin:clipboard-history:history/index',JSON.stringify({entries:entries.map(({text,...item})=>item),updatedAt:Date.now()}));
  const {openLauncherHostedPluginSurface}=await import('/src/workspace/pluginSurfaceOpenRequest.ts');openLauncherHostedPluginSurface({source:'builtin',pluginId:'clipboard-history',surfaceId:'main'});
 });

 await page.evaluate(()=>{window.historyBefore=Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('hiven-plugin-kv:builtin:clipboard-history:')));return navigator.clipboard.writeText('SYNTHETIC CLIPBOARD SENTINEL')});
 await page.getByRole('button',{name:'Select texts',exact:true}).click();
 const search=page.getByRole('searchbox');
 await search.fill('ALPHA');
 await page.locator('.clipboard-history-item-row').filter({hasText:'ALPHA'}).click();
 await search.fill('BRAVO');
 await page.locator('.clipboard-history-item-row').filter({hasText:'BRAVO'}).click();
 await page.getByRole('button',{name:'Compare two',exact:true}).click();

 await page.locator('.monaco-editor').first().waitFor();
 const verifyModels=async(indices)=>{
   await page.waitForFunction(async(indices)=>{
     const monaco=await import('/node_modules/.vite/deps/monaco-editor.js');
     const values=monaco.editor.getModels().map(m=>m.getValue());
     return indices.every(i=>values.includes(window.synthetic[i].text));
   },indices,{timeout:10000});
 };
 await verifyModels([0,1]);
 await page.screenshot({path:'temp/compare.png'});
 await page.locator('.td-bc-back').click();
 await search.waitFor();
 if(await search.inputValue()!=='BRAVO')throw Error('Search lost');
 if(await page.locator('.clipboard-history-merge-order li').count()!==2)throw Error('Selection lost');
 await page.getByRole('button',{name:'Remove item 2 from selection',exact:true}).click();
 await search.fill('CHARLIE');
 await page.locator('.clipboard-history-item-row').filter({hasText:'CHARLIE'}).click();
 await page.getByRole('button',{name:'Compare two',exact:true}).click();
 await verifyModels([0,2]);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'SYNTHETIC CLIPBOARD SENTINEL');
 assert.equal(await page.evaluate(()=>JSON.stringify(window.historyBefore)===JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('hiven-plugin-kv:builtin:clipboard-history:'))))),true);
 await page.getByRole('button',{name:"Copy all Modified text",exact:true}).click();
 const external=await context.newPage();
 await external.setContent('<textarea aria-label="External paste target"></textarea>');
 await external.locator('textarea').focus();
 await external.keyboard.press('Control+V');
 const pasted=await external.locator('textarea').inputValue();
 const expected=await page.evaluate(()=>window.synthetic[2].text);
 if(pasted!==expected)throw Error('External paste differs');
 console.log('PASS: two searches → exact full models → return retained query and order → replace second → exact full models → explicit copy → external textarea full text');
 await external.close();
 await page.bringToFront();
 await page.locator('.td-bc-back').click();
 await search.waitFor();
 await page.screenshot({path:'temp/returned.png'});
 // Delete a selected full item after the preview, then recover without reselecting.
 await page.evaluate(()=>localStorage.removeItem('hiven-plugin-kv:builtin:clipboard-history:history/items/synthetic-2'));
 await page.getByRole('button',{name:'Compare two',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Could not open comparison'}).waitFor();
 assert.equal(await page.locator('.clipboard-history-merge-order li').count(),2);
 assert.equal(await search.inputValue(),'CHARLIE');
 await page.evaluate(()=>localStorage.setItem('hiven-plugin-kv:builtin:clipboard-history:history/items/synthetic-2',JSON.stringify(window.synthetic[2])));
 await page.getByRole('button',{name:'Compare two',exact:true}).click();
 await verifyModels([0,2]);
 await page.locator('.td-bc-back').click();
 await search.waitFor();
 // Full stored text is too large even when the old list preview was small.
 await page.evaluate(()=>localStorage.setItem('hiven-plugin-kv:builtin:clipboard-history:history/items/synthetic-2',JSON.stringify({...window.synthetic[2],text:'中'.repeat(400000)})));
 await page.getByRole('button',{name:'Compare two',exact:true}).click();
 await page.getByRole('status').filter({hasText:'exceed 1 MiB'}).waitFor();
 assert.equal(await page.locator('.clipboard-history-merge-order li').count(),2);
 await page.screenshot({path:'temp/oversize.png'});
 await page.evaluate(()=>localStorage.setItem('hiven-plugin-kv:builtin:clipboard-history:history/items/synthetic-2',JSON.stringify(window.synthetic[2])));
 console.log('PASS: missing full item keeps selection/query and retries; UTF-8 size failure is visible without truncation; comparison never changes history/clipboard');
 assert.deepEqual(errors,[]);

 await page.evaluate(async()=>{
   const {usePluginSettingsStore}=await import('/src/workspace/pluginSettingsStore.ts');
   const state=usePluginSettingsStore.getState().pluginSettings;
   usePluginSettingsStore.setState({pluginSettings:{...state,builtin:{...state.builtin,'clipboard-history':{...state.builtin['clipboard-history'],value:{...state.builtin['clipboard-history'].value,enabled:false}}}}});
 });
 } finally {
   // Ephemeral context destruction drops the enabled synthetic settings even on failure.
   await context.close();
   await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1});
