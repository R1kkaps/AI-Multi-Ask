const {chromium}=require(process.env.PLAYWRIGHT_PATH||'C:/Users/17301/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
 const page=await browser.newPage();
 await page.goto('about:blank');
 for(const f of ['src/utils/dom.js','src/adapters/adapter-base.js','src/adapters/chatgpt.js','src/adapters/gemini.js','src/adapters/qwen.js','src/adapters/deepseek.js','src/adapters/capabilities.js']) await page.addScriptTag({path:path.join(root,f)});
 // Real DOM: menu labels, disabled models, re-rendered trigger and selection evidence.
 for(const [name,label,attr] of [['ChatGPTAdapter','Extra High','data-testid="model-switcher-dropdown-button"'],['GeminiAdapter','Gemini Pro','data-test-id="bard-mode-menu-button"'],['QwenAdapter','Qwen3.8','data-testid="model-selector"'],['DeepSeekAdapter','专家模式','data-testid="model-selector"']]) {
   await page.evaluate(({attr,label})=>{
     document.body.innerHTML='<button '+attr+' aria-expanded="false">Instant</button><div role="menu" hidden><button role="menuitemradio">'+label+'</button><button role="menuitemradio" aria-disabled="true">Pro unavailable</button></div>';
     const trigger=document.querySelector('button'),menu=document.querySelector('[role="menu"]');
     trigger.onclick=()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));};
     menu.firstChild.onclick=()=>{trigger.textContent=label;menu.firstChild.setAttribute('aria-checked','true');menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
   },{attr,label});
   const models=await page.evaluate(async name=>new AIMultiAsk[name]().listModels(),name);
   assert.equal(models.models.length,2);assert.equal(models.models[1].disabled,true);
   assert.equal(await page.evaluate(async name=>new AIMultiAsk[name]().switchModel('web:Pro unavailable'),name),false);
   assert.equal(await page.evaluate(async ({name,label})=>new AIMultiAsk[name]().switchModel('web:'+label),{name,label}),true);
 }
 await page.evaluate(()=>{
   document.body.innerHTML='<form><textarea id="prompt-textarea"></textarea><input type="file" accept="image/*,.txt" multiple hidden><div id="chips"></div></form>';
   document.querySelector('input').onchange=e=>{window.received=Array.from(e.target.files);for(const f of received){const chip=document.createElement('span');chip.textContent=f.name;document.querySelector('#chips').append(chip);}};
 });
 const files=[{name:'test.txt',type:'text/plain',data:Buffer.from('hello 世界').toString('base64'),size:Buffer.byteLength('hello 世界')},{name:'pixel.png',type:'image/png',data:'AAECAw==',size:4}];
 const uploaded=await page.evaluate(async files=>new AIMultiAsk.ChatGPTAdapter().uploadFiles(files),files);assert.equal(uploaded.success,true);
 assert.equal(await page.evaluate(async()=>received[0].text()),'hello 世界');
 assert.deepEqual(await page.evaluate(async()=>Array.from(new Uint8Array(await received[1].arrayBuffer()))),[0,1,2,3]);
 assert.equal(await page.evaluate(async()=>{try{await new AIMultiAsk.ChatGPTAdapter().uploadFiles([{name:'bad.exe',type:'application/octet-stream',data:'AA==',size:1}]);return false;}catch{return true;}}),true);
 assert.equal(await page.evaluate(async()=>{try{await new AIMultiAsk.ChatGPTAdapter().uploadFiles(Array(6).fill({size:1}));return false;}catch{return true;}}),true);
 assert.equal(await page.evaluate(async files=>{try{await new AIMultiAsk.ChatGPTAdapter().uploadFiles(files);return false;}catch(e){return e.message.includes('同一附件');}},files),true);
 await page.evaluate(()=>{document.body.innerHTML='<button aria-pressed="false">深度思考</button>';document.querySelector('button').onclick=e=>e.target.setAttribute('aria-pressed',e.target.getAttribute('aria-pressed')==='true'?'false':'true');});
 assert.equal(await page.evaluate(async()=>new AIMultiAsk.DeepSeekAdapter().switchModel('toggle:1:深度思考')),true);
 assert.equal(await page.evaluate(async()=>new AIMultiAsk.DeepSeekAdapter().switchModel('toggle:0:深度思考')),true);
 // Full side-panel workflow with isolated chrome messaging, actual FileReader and download.
 const panel=await browser.newPage({viewport:{width:420,height:1000}});const errors=[];panel.on('pageerror',e=>errors.push(e.message));
 await panel.addInitScript(()=>{
   window.messages=[];window.listeners=[];window.saved={};
   window.chrome={runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:(m,cb)=>{const r=m.type==='AI_MULTI_ASK_GET_PROVIDER_TABS'?{success:true,tabs:{chatgpt:{id:1,status:'complete'},gemini:{id:2,status:'complete'}}}:{success:true};cb?.(r);return Promise.resolve(r);}},storage:{local:{get:(k,cb)=>cb(saved),set:(v,cb)=>{Object.assign(saved,v);cb?.();}}},tabs:{sendMessage:(id,m,cb)=>{
     messages.push(m);
     if(m.type==='AI_MULTI_ASK_CHECK_STATUS') return cb({success:true,ready:true});
     if(m.type==='AI_MULTI_ASK_LIST_MODELS') return cb({success:true,models:[{id:'web:High',label:'High',disabled:false}],current:'Instant'});
     cb({success:true,sent:true});
   }}};
 });
 await panel.goto('file:///'+path.join(root,'src/sidepanel/sidepanel.html').replaceAll('\\','/'));
 await panel.waitForFunction(()=>__AI_MULTI_ASK_STATE__?.providers.gemini.status==='READY');
 assert.equal(await panel.evaluate(()=>__AI_MULTI_ASK_STATE__.settings.geminiAccountIndex),'1');
 await panel.locator('#btn-read-models').click();await panel.waitForFunction(()=>!document.querySelector('#btn-read-models').disabled);
 await panel.locator('#model-chatgpt').selectOption('web:High');await panel.waitForTimeout(50);
 assert.equal(await panel.evaluate(()=>messages.some(m=>m.type==='AI_MULTI_ASK_SWITCH_MODEL' && m.model==='web:High')),true);
 await panel.locator('#attachment-input').setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('attachment data')});
 assert.match(await panel.locator('#attachment-list').innerText(),/note.txt/);
 await panel.locator('#prompt-textarea').fill('同一个问题');
 await panel.locator('#btn-fill').click();await panel.waitForFunction(()=>!__AI_MULTI_ASK_STATE__.busy);
 const send=await panel.evaluate(()=>messages.find(m=>m.files?.length));assert.equal(Buffer.from(send.files[0].data,'base64').toString(),'attachment data');assert.equal(send.geminiAccountIndex,'1');
 await panel.evaluate(()=>{for(const [key,id,text] of [['chatgpt',1,'方案 A：优先成本'],['gemini',2,'方案 B：优先可靠性']]){const p=__AI_MULTI_ASK_STATE__.providers[key];listeners.forEach(f=>f({type:'AI_MULTI_ASK_STREAM_UPDATE',providerId:key,requestId:p.requestId,text,isDone:true},{tab:{id}}));}});
 await panel.locator('#btn-synthesize').click();await panel.waitForFunction(()=>__AI_MULTI_ASK_STATE__.synthesis?.running);
 const prompt=await panel.evaluate(()=>messages.at(-1).prompt);assert.match(prompt,/方案 A/);assert.match(prompt,/方案 B/);
 const job=await panel.evaluate(()=>__AI_MULTI_ASK_STATE__.synthesis);
 await panel.evaluate(job=>listeners.forEach(f=>f({type:'AI_MULTI_ASK_STREAM_UPDATE',providerId:'gemini',requestId:job.requestId,text:'错误来源',isDone:true},{tab:{id:99}})),job);
 assert.equal(await panel.evaluate(()=>__AI_MULTI_ASK_STATE__.synthesis.text),'');
 const downloading=panel.waitForEvent('download');
 await panel.evaluate(job=>listeners.forEach(f=>f({type:'AI_MULTI_ASK_STREAM_UPDATE',providerId:'gemini',requestId:job.requestId,text:'## 综合结论\n[ChatGPT] 建议成本优先；[Gemini] 强调可靠性。应根据失效代价选择。',isDone:true},{tab:{id:2}})),job);
 const downloaded=await downloading;await downloaded.saveAs(path.join(root,'tests/synthesis-example.md'));
 const report=fs.readFileSync(path.join(root,'tests/synthesis-example.md'),'utf8');assert.match(report,/方案 A/);assert.match(report,/方案 B/);assert.match(report,/综合结论/);assert.match(report,/未收到回答/);
 assert.equal(await panel.evaluate(()=>__AI_MULTI_ASK_STATE__.providers.gemini.response),'方案 B：优先可靠性');
 assert.ok(await panel.evaluate(()=>saved.ai_multi_ask_last_synthesis.text));
 await panel.waitForTimeout(2700);await panel.screenshot({path:path.join(root,'tests/v12-panel.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS: four live-DOM model adapters, disabled choices, switch verification, binary/text upload, type/count limits, account migration, panel file transfer, synthesis provenance/isolation/download/persistence.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
