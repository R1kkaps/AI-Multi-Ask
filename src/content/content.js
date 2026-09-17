/**
 * AI Multi Ask - Content Script
 * 
 * 核心功能：
 * 1. 动态匹配当前网页所属的 AI 适配器
 * 2. 监听来自 Side Panel 的状态查询与 Prompt 填入/发送指令
 * 3. 自动发送后启动 ResponseObserver 捕获流式回答，并实时回传侧边栏
 */

(function () {
  if (window.__AI_MULTI_ASK_CONTENT_ACTIVE__) return;
  const AIMultiAsk = window.AIMultiAsk || {};
  window.__AI_MULTI_ASK_CONTENT_ACTIVE__ = true;
  const requests = new Map();
  let filling = false;

  function getAdapter() {
    if (!AIMultiAsk.registry) return null;
    return AIMultiAsk.registry.findAdapterForUrl(window.location.href);
  }

  let adapter = getAdapter();
  if (!adapter) {
    return;
  }

  console.log(`[AI Multi Ask] Content script active on ${adapter.name} (${window.location.href})`);

  let cachedInputEl = null;
  let activeResponseObserver = null;
  let activeResponseInterval = null;

  function refreshInput() {
    adapter = getAdapter();
    if (!adapter) return null;
    cachedInputEl = adapter.findInput(document);
    return cachedInputEl;
  }

  refreshInput();

  // 监听 SPA DOM 动态挂载
  let observerTimer = null;
  const observer = new MutationObserver(() => {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(() => {
      const prev = cachedInputEl;
      const current = refreshInput();
      if (!prev && current) {
        chrome.runtime.sendMessage({
          type: 'AI_MULTI_ASK_INPUT_READY',
          providerId: adapter.id
        }).catch(() => {});
      }
    }, 200);
  });

  try {
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  } catch (err) {
    console.warn('[AI Multi Ask] Observer warning:', err);
  }

  async function waitForInput(maxWaitMs = 1500) {
    let el = refreshInput();
    if (el) return el;

    const startTime = Date.now();
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        el = refreshInput();
        if (el || Date.now() - startTime >= maxWaitMs) {
          clearInterval(timer);
          resolve(el);
        }
      }, 100);
    });
  }

  /**
   * 停止现有的回答监听器
   */
  function stopResponseObserver() {
    if (activeResponseObserver) {
      activeResponseObserver.disconnect();
      activeResponseObserver = null;
    }
    if (activeResponseInterval) {
      clearInterval(activeResponseInterval);
      activeResponseInterval = null;
    }
  }

  /**
   * 发送后启动 AI 回复流式监听引擎
   */
  function startResponseObserver(previousElement, previousText, requestId, responseTimeoutMs=180000) {
    stopResponseObserver();
    let lastText = '', lastChange = Date.now(), hasResponse = false;
    const started = Date.now();
    const publish = (done, error) => chrome.runtime.sendMessage({
      type:'AI_MULTI_ASK_STREAM_UPDATE', providerId:adapter.id, requestId,
      text:lastText, isDone:done, error
    }).catch(() => {});
    activeResponseInterval = setInterval(() => {
      const el = adapter.getLatestResponseElement(document);
      const text = adapter.getLatestResponseText(document);
      if (el && text && (el !== previousElement || text !== previousText)) {
        if (!hasResponse || text !== lastText) {
          hasResponse = true; lastText = text; lastChange = Date.now(); publish(false);
        }
      }
      if (hasResponse && !adapter.isGenerating(document) && Date.now()-lastChange >= 4000) {
        stopResponseObserver(); publish(true);
      } else if (Date.now()-started > responseTimeoutMs) {
        stopResponseObserver(); publish(true, '回答监听超时，请到网页查看或手动刷新回复');
      }
    }, 350);
  }

  async function handleFill(payload, autoSend) {
    const id = payload.requestId;
    if (id && requests.has(id)) return requests.get(id);
    if (filling) return {success:false,reason:'正在处理上一条请求，请稍候'};
    filling = true;
    const pending = performFill(payload, autoSend).finally(() => { filling = false; });
    if (id) { requests.set(id,pending); if(requests.size > 50) requests.delete(requests.keys().next().value); }
    return pending;
  }

  // 监听来自扩展侧边栏或后台的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    // 轻量心跳检测
    if (message.type === 'AI_MULTI_ASK_PING') {
      adapter = getAdapter();
      sendResponse({
        success: true,
        pong: true,
        providerId: adapter ? adapter.id : null,
        providerName: adapter ? adapter.name : null
      });
      return true;
    }

    if (message.type==='AI_MULTI_ASK_LIST_MODELS' || message.type==='AI_MULTI_ASK_SWITCH_MODEL') {
      if (filling || adapter.isGenerating(document)) {sendResponse({success:false,reason:'正在处理请求，请稍候'});return;}
      filling=true;
      const action=message.type==='AI_MULTI_ASK_LIST_MODELS' ? adapter.listModels(document) : adapter.switchModel(message.model,{},document).then(success=>({success,reason:success?'':'网页未确认模型切换'}));
      action.then(result=>sendResponse({success:true,...result})).catch(err=>sendResponse({success:false,reason:err.message})).finally(()=>{filling=false;});
      return true;
    }

    // 1. 检测页面就绪状态
    if (message.type === 'AI_MULTI_ASK_CHECK_STATUS') {
      waitForInput(1500).then((input) => {
        adapter = getAdapter();
        const latestText = adapter ? adapter.getLatestResponseText(document) : '';
        if (input) {
          sendResponse({
            success: true,
            ready: true,
            providerId: adapter ? adapter.id : null,
            providerName: adapter ? adapter.name : null,
            latestText: latestText
          });
        } else {
          const check = adapter ? adapter.detectPageReady(document) : { ready: false, reason: 'Unsupported page' };
          sendResponse({
            success: true,
            ready: false,
            reason: check.reason || '未找到输入框',
            providerId: adapter ? adapter.id : null,
            providerName: adapter ? adapter.name : null,
            latestText: latestText
          });
        }
      }).catch((err) => {
        sendResponse({
          success: false,
          ready: false,
          reason: err.message || 'Status check error',
          providerId: adapter ? adapter.id : null
        });
      });
      return true;
    }

    // 2. 仅填入 Prompt (不发送)
    if (message.type === 'AI_MULTI_ASK_FILL_PROMPT') {
      handleFill(message, false)
        .then((result) => sendResponse(result))
        .catch((err) => {
          sendResponse({ success: false, reason: err.message, providerId: adapter ? adapter.id : null });
        });
      return true;
    }

    // 3. 填入并自动触发发送 (Auto-Send)
    if (message.type === 'AI_MULTI_ASK_FILL_AND_SEND') {
      handleFill(message, true)
        .then((result) => sendResponse(result))
        .catch((err) => {
          sendResponse({ success: false, reason: err.message, providerId: adapter ? adapter.id : null });
        });
      return true;
    }

    // 4. 主动获取最新回复
    if (message.type === 'AI_MULTI_ASK_GET_RESPONSE') {
      adapter = getAdapter();
      const text = adapter ? adapter.getLatestResponseText(document) : '';
      const isGen = adapter ? adapter.isGenerating(document) : false;
      sendResponse({
        success: true,
        text: text,
        isGenerating: isGen,
        providerId: adapter ? adapter.id : null
      });
      return true;
    }
  });

  async function performFill(payload, autoSend = false) {
    adapter = getAdapter();
    if (!adapter) {
      return { success: false, reason: 'No matching adapter found' };
    }

    if (adapter.id==='gemini' && /^\d+$/.test(payload.geminiAccountIndex||'') && !location.pathname.startsWith('/u/'+payload.geminiAccountIndex+'/')) {
      return {success:false,reason:'Gemini 当前网页不是指定账号，请打开所选账号后重试'};
    }

    const { prompt, mode = 'replace', suffix = '', model = 'default', modelOptions = {} } = payload;
    if (!prompt || typeof prompt !== 'string') {
      return { success: false, reason: 'Prompt is empty', providerId: adapter.id };
    }

    if (adapter.isGenerating(document)) return {success:false,reason:'该平台仍在生成，请等待结束',providerId:adapter.id};

    // 若指定了模型或专属开关，执行模型切换
    if (adapter.switchModel && (model || modelOptions)) {
      try {
        const switched = await adapter.switchModel(model, modelOptions, document);
        if (!switched) return {success:false,reason:'无法确认模型或开关切换，请在网页选择后使用沿用网页当前模型',providerId:adapter.id};
        await new Promise((r) => setTimeout(r, 120));
      } catch (err) {
        return {success:false,reason:err.message || '模型切换失败',providerId:adapter.id};
      }
    }

    let fullText = prompt.trim();
    if (suffix && typeof suffix === 'string' && suffix.trim()) {
      fullText += '\n\n' + suffix.trim();
    }

    const inputEl = await waitForInput(1500);
    if (!inputEl) {
      return { success: false, reason: '未找到输入框', providerId: adapter.id };
    }

    if (payload.files?.length) {
      try { await adapter.uploadFiles(payload.files,document); }
      catch(err) {return {success:false,reason:err.message,providerId:adapter.id,attachmentUncertain:true};}
    }

    // 记录发送前的上一条回复文本
    const previousText = adapter.getLatestResponseText(document);
    const previousElement = adapter.getLatestResponseElement(document);

    const fillSuccess = await adapter.fillPrompt(inputEl, fullText, mode);
    if (!fillSuccess) {
      return { success: false, reason: '未能成功写入输入框', providerId: adapter.id };
    }

    if (autoSend) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const sent = await adapter.sendPrompt(inputEl, document);
        if (!sent) throw new Error('无法确认发送');
        // 启动回复监听引擎
        startResponseObserver(previousElement, previousText, payload.requestId,
          Math.min(900000,Math.max(180000,Number(payload.responseTimeoutMs)||180000)));
        return {
          success: true,
          sent: true,
          providerId: adapter.id,
          providerName: adapter.name
        };
      } catch (err) {
        console.warn('[AI Multi Ask] Auto-send warning:', err);
        return {
          success: true,
          sent: false,
          reason: err.message || '已填入，发送未确认，请到网页检查',
          providerId: adapter.id
        };
      }
    }

    return {
      success: true,
      sent: false,
      providerId: adapter.id,
      providerName: adapter.name
    };
  }
})();
