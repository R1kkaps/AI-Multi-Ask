const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/17301/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const profile=fs.mkdtempSync(path.join(root,'tests/.browser-profile-'));
 const context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`]});
 try {
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
 const id=new URL(worker.url()).host;
 assert.equal(await worker.evaluate(()=>chrome.runtime.getManifest().version),'1.2.0');
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`chrome-extension://${id}/src/sidepanel/sidepanel.html`);
 await page.waitForFunction(()=>window.__AI_MULTI_ASK_STATE__?.settings.geminiAccountIndex==='1');
 await page.locator('#prompt-textarea').fill('extension persistence check');await page.waitForTimeout(400);await page.reload();
 await page.waitForFunction(()=>document.querySelector('#prompt-textarea').value==='extension persistence check');
 await context.route('https://gemini.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<textarea></textarea>'}));
 const first=await context.newPage();await first.goto('https://gemini.google.com/u/0/app');
 const second=await context.newPage();await second.goto('https://gemini.google.com/u/1/app');
 assert.equal((await worker.evaluate(()=>getProviderTabs())).gemini.url,'https://gemini.google.com/u/1/app');
 await second.close();assert.equal((await worker.evaluate(()=>getProviderTabs())).gemini,null);
 assert.deepEqual(errors,[]);
 console.log('PASS: real unpacked extension manifest, service worker, side panel startup, chrome.storage persistence and Gemini second-account routing');
 } finally {await context.close();}
})().catch(e=>{console.error(e);process.exit(1);});
