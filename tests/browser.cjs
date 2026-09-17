const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'C:/Users/17301/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:480,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
   window.calls=[];window.listeners=[];window.saved={ai_multi_ask_settings:{selectedProviders:['chatgpt'],draft:'saved draft'}};
   window.chrome={runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:(m,cb)=>{
     const r=m.type==='AI_MULTI_ASK_GET_PROVIDER_TABS'?{success:true,tabs:{chatgpt:{id:1,status:'complete'}}}:{success:true};cb?.(r);return Promise.resolve(r);
   }},storage:{local:{get:(keys,cb)=>cb(saved),set:(v,cb)=>{Object.assign(saved,v);cb?.();}}},tabs:{sendMessage:(id,m,cb)=>{
      calls.push(m);const r=m.type==='AI_MULTI_ASK_CHECK_STATUS'?{success:true,ready:true}:m.type==='AI_MULTI_ASK_GET_RESPONSE'?{success:true,text:'refreshed answer',isGenerating:false}:window.sendResult||{success:true,sent:false};setTimeout(()=>cb(r),50);
   }}};
 });
 await page.goto('file:///'+path.join(root,'src/sidepanel/sidepanel.html').replaceAll('\\','/'));
 await page.waitForFunction(()=>window.__AI_MULTI_ASK_STATE__?.providers.chatgpt.status==='READY');
 assert.equal(await page.locator('#prompt-textarea').inputValue(),'saved draft');
 await page.locator('#prompt-textarea').fill('test question');await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>saved.ai_multi_ask_settings.draft),'test question');
 await page.locator('#btn-fill').click();await page.waitForFunction(()=>!__AI_MULTI_ASK_STATE__.busy);
 assert.equal(await page.evaluate(()=>__AI_MULTI_ASK_STATE__.providers.chatgpt.status),'FAILED');
 assert.equal(await page.evaluate(()=>__AI_MULTI_ASK_STATE__.providers.chatgpt.isGenerating),false);
 await page.evaluate(()=>window.sendResult={success:true,sent:true});
 await page.locator('#btn-retry-failed').click();await page.waitForFunction(()=>!__AI_MULTI_ASK_STATE__.busy);
 assert.equal(await page.evaluate(()=>__AI_MULTI_ASK_STATE__.providers.chatgpt.sent),true);
 await page.evaluate(()=>{const p=__AI_MULTI_ASK_STATE__.providers.chatgpt;listeners.forEach(f=>f({type:'AI_MULTI_ASK_STREAM_UPDATE',providerId:'chatgpt',requestId:p.requestId,text:'wrong tab',isDone:true},{tab:{id:2}}));});
 assert.equal(await page.evaluate(()=>__AI_MULTI_ASK_STATE__.providers.chatgpt.response),'');
 await page.evaluate(()=>{const p=__AI_MULTI_ASK_STATE__.providers.chatgpt;listeners.forEach(f=>f({type:'AI_MULTI_ASK_STREAM_UPDATE',providerId:'chatgpt',requestId:p.requestId,text:'Answer **one**',isDone:true},{tab:{id:1}}));});
 assert.equal(await page.locator('#resp-content-chatgpt strong').innerText(),'one');
 const downloadPromise=page.waitForEvent('download');await page.locator('#btn-export').click();const download=await downloadPromise;await download.saveAs(path.join(root,'tests/export-check.md'));
 assert.match(fs.readFileSync(path.join(root,'tests/export-check.md'),'utf8'),/test question/);
 await page.locator('#btn-compare').click();assert.match(await page.locator('#prompt-textarea').inputValue(),/共识、分歧/);
 await page.locator('#btn-refresh-responses').click();await page.waitForFunction(()=>__AI_MULTI_ASK_STATE__.providers.chatgpt.response==='refreshed answer');
 await page.locator('#btn-toggle-presets').click();
 await page.evaluate(async()=>{const presets=await AIMultiAsk.storage.loadPresets();for(const p of presets) await AIMultiAsk.storage.deletePreset(p.id);});
 assert.equal(await page.evaluate(async()=>(await AIMultiAsk.storage.loadPresets()).length),0);
 await page.locator('#btn-toggle-presets').click();
 await page.waitForTimeout(2800);
 await page.screenshot({path:path.join(root,'tests/sidepanel.png'),fullPage:true});
 await page.setViewportSize({width:360,height:900});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
 await page.screenshot({path:path.join(root,'tests/sidepanel-narrow.png'),fullPage:true});
 // Real browser DOM tests for content adapters and idempotent content listener.
 const content=await browser.newPage();await content.route('https://chatgpt.com/**',r=>r.fulfill({contentType:'text/html',body:'<textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>'}));await content.goto('https://chatgpt.com/');
 await content.evaluate(()=>{window.listeners=[];window.updates=[];window.chrome={runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:m=>{updates.push(m);return Promise.resolve();}},storage:{local:{get:(k,cb)=>cb({})}}};});
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
 for(const f of manifest.content_scripts[0].js) await content.addScriptTag({path:path.join(root,f)});
 await content.addScriptTag({path:path.join(root,'src/content/content.js')});assert.equal(await content.evaluate(()=>listeners.length),1);
 assert.equal(await content.evaluate(()=>new AIMultiAsk.ChatGPTAdapter().matchHost('https://evilchatgpt.com/')),false);
 await content.evaluate(()=>{window.clicks=0;document.querySelector('button').onclick=()=>{clicks++;document.querySelector('textarea').value='';};});
 const result=await content.evaluate(async()=>{
   const m={type:'AI_MULTI_ASK_FILL_AND_SEND',requestId:'one',prompt:'hello'};
   const send=()=>new Promise(resolve=>listeners[0](m,{},resolve));return Promise.all([send(),send()]);
 });assert.ok(result.every(r=>r.sent));assert.equal(await content.evaluate(()=>clicks),1);
 await content.evaluate(()=>{document.querySelector('button').disabled=true;document.querySelector('textarea').value='retained';});
 assert.equal(await content.evaluate(async()=>{try{await new AIMultiAsk.ChatGPTAdapter().sendPrompt(document.querySelector('textarea'));return false;}catch{return true;}}),true);
 assert.equal(await content.evaluate(async()=>new AIMultiAsk.ChatGPTAdapter().switchModel('missing-model')),false);
 assert.equal(await content.evaluate(async()=>new AIMultiAsk.DeepSeekAdapter().switchModel('deepseek-reasoner',{r1:true})),false);
 assert.equal(await content.evaluate(()=>AIMultiAsk.dom.formatMarkdownToHtml('```js\n**literal**\n\n<tag>\n```').includes('<strong>')),false);
 // Provider selectors exercised against representative editable DOM types.
 for(const [adapterName,html] of [
   ['GeminiAdapter','<rich-textarea><div class="ql-editor" contenteditable="true"></div></rich-textarea>'],
   ['QwenAdapter','<textarea class="message-input-textarea"></textarea>'],
   ['DeepSeekAdapter','<textarea id="chat-input"></textarea>']
 ]) {
   await content.evaluate(html=>{document.body.innerHTML=html;},html);
   const filled=await content.evaluate(async name=>{
     const adapter=new AIMultiAsk[name](),el=adapter.findInput(document);
     if(!el) return '';
     await adapter.fillPrompt(el,'第一行\nsecond line');
     return el.value??el.innerText;
   },adapterName);
   assert.equal(filled,'第一行\nsecond line');
 }
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: draft, truthful send status, retry, tab isolation, response rendering, export, comparison prompt, empty presets, duplicate injection, request deduplication, domain matching, disabled send and missing model.');
})().catch(e=>{console.error(e);process.exit(1);});
