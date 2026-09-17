/* Live website capabilities: never advertise a model that was not in the DOM. */
(function(root) {
  const app=root.AIMultiAsk, wait=ms=>new Promise(r=>setTimeout(r,ms));
  const usable=el=>app.dom.isElementUsable(el);
  const label=el=>(el.getAttribute('data-model-name') || el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g,' ');
  const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g,' ').trim();
  const disabled=el=>el.disabled || el.getAttribute('aria-disabled')==='true';
  const selected=el=>['aria-selected','aria-checked','aria-pressed'].some(a=>el.getAttribute(a)==='true') || el.dataset.state==='checked';
  const selectors={
    chatgpt:'[data-testid="model-switcher-dropdown-button"], button[aria-label*="Model"], button[aria-label*="模型"], button[aria-label*="reasoning"], button[aria-label*="Reasoning"]',
    gemini:'[data-test-id="bard-mode-menu-button"], [data-test-id="model-selector"], button[aria-label*="Model"], button[aria-label*="模型"], .model-selector button, .input-area-switch',
    qwen:'button[class*="model"], [data-testid="model-selector"], div[class*="model-switch"], div[class*="modelSelect"], [class*="model-selector"] button',
    deepseek:'[data-testid="model-selector"], button[class*="model"], [class*="model-selector"], [role="combobox"]'
  };
  const modelName=/^(?:GPT[ -]?\d|ChatGPT|Gemini|Qwen|DeepSeek|Instant\b|Medium\b|High\b|Extra High\b|Pro\b|Thinking\b|Think\b|Fast\b|Flash\b|Expert\b|即时|快速|思考|专业|专家|深度思考|标准|高|超高)/i;
  const menuSelector='[role="menuitem"], [role="menuitemradio"], [role="option"], [role="radio"], mat-option, [data-model-name], [class*="model-item"], [role="menu"] button, [role="listbox"] button';
  const toggleName=/^(?:DeepThink(?:\s*\([^)]*\))?|Thinking|Think|Search|Web Search|深度思考(?:\s*\([^)]*\))?|思考|联网搜索|搜索)$/i;
  function toggles(doc) {
    return Array.from(doc.querySelectorAll('button[aria-pressed], [role="switch"][aria-checked], [role="button"][aria-pressed]')).filter(usable).filter(el=>toggleName.test(label(el)));
  }
  function trigger(adapter,doc) {
    const configured=Array.from(doc.querySelectorAll(selectors[adapter.id]||'nosuchtag')).find(usable);
    return configured || Array.from(doc.querySelectorAll('button[aria-haspopup], [role="combobox"]')).filter(usable).find(el=>modelName.test(label(el)));
  }
  function choices(doc) {
    return Array.from(doc.querySelectorAll(menuSelector)).filter(usable).filter(el=>{
      const text=label(el);return text && text.length<=180 && modelName.test(text);
    });
  }
  async function withMenu(adapter,doc,fn) {
    const button=trigger(adapter,doc), opened=button && button.getAttribute('aria-expanded')!=='true';
    if(opened) {button.click(); await wait(350);}
    try {return await fn(button);}
    finally {if(opened && button.isConnected && button.getAttribute('aria-expanded')!=='false' && choices(doc).length) {button.click();}}
  }
  app.AIAdapter.prototype.listModels=async function(doc=document) {
    return withMenu(this,doc,button=>{
      const items=choices(doc), map=new Map();
      for(const el of items) {const text=label(el);map.set(text,{id:'web:'+text,label:text,disabled:Boolean(disabled(el)),selected:selected(el)});}
      for(const el of toggles(doc)) for(const on of [true,false]) {
        const text=label(el)+(on?'：开启':'：关闭');
        map.set(text,{id:'toggle:'+Number(on)+':'+label(el),label:text,disabled:Boolean(disabled(el)),selected:selected(el)===on});
      }
      return {models:[...map.values()],current:button?label(button):'',reason:map.size?'':'未检测到可选模型。请登录并打开网页模型菜单后重新读取。'};
    });
  };
  for(const Name of ['ChatGPTAdapter','GeminiAdapter','QwenAdapter','DeepSeekAdapter']) {
    app[Name].prototype.switchModel=async function(id,options={},doc=document) {
      if(!id || id==='default') return true;
      if(id.startsWith('toggle:')) {
        const [,value,...parts]=id.split(':'), wanted=parts.join(':'), on=value==='1';
        const item=toggles(doc).find(el=>label(el)===wanted);
        if(!item || disabled(item)) return false;
        if(selected(item)===on) return true;
        item.click();
        for(let i=0;i<12;i++) {await wait(150);const current=toggles(doc).find(el=>label(el)===wanted);if(current && selected(current)===on) return true;}
        return false;
      }
      if(!id.startsWith('web:')) return false;
      const wanted=id.slice(4);
      return withMenu(this,doc,async button=>{
        let item=choices(doc).find(el=>norm(label(el))===norm(wanted));
        if(!item || disabled(item)) return false;
        if(selected(item)) return true;
        item.click();
        for(let i=0;i<12;i++) {
          await wait(150);
          item=choices(doc).find(el=>norm(label(el))===norm(wanted));
          const current=trigger(this,doc);
          if((item && selected(item)) || (current && (norm(label(current))===norm(wanted) || norm(wanted).startsWith(norm(label(current))+' ')))) return true;
        }
        return false;
      });
    };
  }
  // File inputs are allowed to be hidden; they must belong to the composer/document.
  function accepts(input,file) {
    const rules=(input.accept||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
    return !rules.length || rules.some(r=>r==='*/*' || (r.startsWith('.')?file.name.toLowerCase().endsWith(r):r.endsWith('/*')?file.type.startsWith(r.slice(0,-1)):file.type===r));
  }
  app.AIAdapter.prototype.uploadFiles=async function(files,doc=document) {
    if(!files?.length) return {success:true};
    if(files.length>5 || files.reduce((n,f)=>n+(f.size||0),0)>20*1024*1024) throw new Error('附件最多 5 个，总大小不超过 20 MB');
    const composer=this.findInput(doc);
    if(!composer) throw new Error('未找到聊天输入框，请先登录');
    let inputs=Array.from(doc.querySelectorAll('input[type="file"]'));
    if(!inputs.length) {
      const button=Array.from(doc.querySelectorAll('button, [role="button"]')).filter(usable).find(el=>/^(添加文件|上传文件|添加照片和文件|上传图片|Add files|Upload files|Attach files|Add photos)/i.test(label(el)));
      if(button) {button.click();await wait(300);inputs=Array.from(doc.querySelectorAll('input[type="file"]'));}
    }
    const input=inputs.find(el=>!disabled(el) && (files.length===1||el.multiple) && files.every(f=>accepts(el,f)));
    if(!input) throw new Error('该网页没有匹配附件类型的上传入口，请在网页打开附件菜单后重试');
    if(Array.from(input.files||[]).some(existing=>files.some(file=>file.name===existing.name && file.size===existing.size))) {
      throw new Error('同一附件已交给网页，请检查网页附件；若已上传，可移除侧栏附件后继续发送，避免重复上传');
    }
    const transfer=new DataTransfer();
    for(const f of files) {
      if(!f.name || typeof f.data!=='string' || f.data.length>28*1024*1024) throw new Error('附件数据无效');
      const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));
      if(bytes.length!==f.size) throw new Error('附件传输不完整：'+f.name);
      transfer.items.add(new File([bytes],f.name,{type:f.type,lastModified:f.lastModified}));
    }
    input.files=transfer.files;
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
    input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    // FileList assignment alone is not proof that the site accepted/uploaded bytes.
    const started=Date.now();let stableSince=0;
    while(Date.now()-started<45000) {
      await wait(250);
      const scope=composer.closest('form') || composer.closest('[class*="composer"], [class*="input-area"]') || doc.body;
      const errors=Array.from(scope.querySelectorAll('[role="alert"], [class*="upload-error"]')).filter(usable).map(label).join(' ');
      if(/失败|不支持|过大|failed|unsupported|too large|error/i.test(errors)) throw new Error('网页附件错误：'+errors.slice(0,150));
      const text=scope.innerText||'';
      const cards=Array.from(scope.querySelectorAll('[title], [aria-label], img[alt]')).filter(usable).map(el=>el.getAttribute('title')||el.getAttribute('aria-label')||el.getAttribute('alt')||'');
      const present=files.every(f=>text.includes(f.name)||cards.some(s=>s.includes(f.name)));
      const busy=Array.from(scope.querySelectorAll('[role="progressbar"], [aria-busy="true"], [class*="uploading"]')).some(usable);
      if(present && !busy) {if(!stableSince) stableSince=Date.now(); if(Date.now()-stableSince>=1500) return {success:true,names:files.map(f=>f.name)};} else stableSince=0;
    }
    throw new Error('附件已交给网页，但上传完成未确认；未发送提问，请检查网页附件后再操作');
  };
})(window);
