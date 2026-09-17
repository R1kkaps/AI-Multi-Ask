/**
 * AI Multi Ask - Side Panel Controller (Edge Fluent 2 Edition)
 * 
 * 核心逻辑：
 * 1. 管理 4 大 AI 状态机 (NOT_OPEN, LOADING, READY, FILLED, FAILED)
 * 2. 支持「一键自动发送」与「仅填入」模式无缝切换
 * 3. 实时接收 Content Script 的流式回答推流 (AI_MULTI_ASK_STREAM_UPDATE)
 * 4. 支持单栏 Tabs 与并排 Split 双重视图、一键复制单项/全部回答
 */

(function () {
  const { storage, messaging, dom } = window.AIMultiAsk;

  const state = {
    providers: {
      chatgpt: {
        id: 'chatgpt',
        name: 'ChatGPT',
        checked: true,
        status: 'NOT_OPEN',
        tabId: null,
        error: null,
        response: '',
        isGenerating: false,
        isDone: false
      },
      gemini: {
        id: 'gemini',
        name: 'Gemini',
        checked: true,
        status: 'NOT_OPEN',
        tabId: null,
        error: null,
        response: '',
        isGenerating: false,
        isDone: false
      },
      qwen: {
        id: 'qwen',
        name: 'Qwen',
        checked: true,
        status: 'NOT_OPEN',
        tabId: null,
        error: null,
        response: '',
        isGenerating: false,
        isDone: false
      },
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        checked: true,
        status: 'NOT_OPEN',
        tabId: null,
        error: null,
        response: '',
        isGenerating: false,
        isDone: false
      }
    },
    settings: {
      fillMode: 'replace',
      autoSend: true,
      selectedProviders: ['chatgpt', 'gemini', 'qwen', 'deepseek'],
      providerModels: {
        chatgpt: 'default',
        gemini: 'default',
        qwen: 'default'
      },
      deepseekR1: false,
      deepseekSearch: false,
      providerSuffixes: { chatgpt: '', gemini: '', qwen: '', deepseek: '' },
      debugMode: false,
      responseViewMode: 'tabs'
    },
    attachments: [],
    synthesis: null,
    busy: false,
    lastPrompt: '',
    activeTab: 'chatgpt',
    activeDrawer: null
  };

  window.__AI_MULTI_ASK_STATE__ = state;

  const elements = {
    promptTextarea: document.getElementById('prompt-textarea'),
    charCount: document.getElementById('char-count'),
    btnClearPrompt: document.getElementById('btn-clear-prompt'),
    btnFill: document.getElementById('btn-fill'),
    submitBtnText: document.getElementById('submit-btn-text'),
    chkAutoSend: document.getElementById('chk-auto-send'),
    btnOpenSelected: document.getElementById('btn-open-selected'),
    btnRetryFailed: document.getElementById('btn-retry-failed'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnDeselectAll: document.getElementById('btn-deselect-all'),
    btnRecheck: document.getElementById('btn-recheck'),
    toastContainer: document.getElementById('toast-container'),

    // 回复展示与对比区
    responseSummaryBadge: document.getElementById('response-summary-badge'),
    viewModeTabs: document.getElementById('view-mode-tabs'),
    viewModeSplit: document.getElementById('view-mode-split'),
    responseTabsBar: document.getElementById('response-tabs-bar'),
    responseViewsContainer: document.getElementById('response-views-container'),
    btnCopyAllResponses: document.getElementById('btn-copy-all-responses'),

    // 抽屉面板
    btnTogglePresets: document.getElementById('btn-toggle-presets'),
    btnToggleHistory: document.getElementById('btn-toggle-history'),
    btnToggleSettings: document.getElementById('btn-toggle-settings'),
    panelPresets: document.getElementById('panel-presets'),
    panelHistory: document.getElementById('panel-history'),
    panelSettings: document.getElementById('panel-settings'),

    presetsList: document.getElementById('presets-list'),
    inputPresetTitle: document.getElementById('input-preset-title'),
    btnAddPreset: document.getElementById('btn-add-preset'),

    historyList: document.getElementById('history-list'),
    btnClearHistory: document.getElementById('btn-clear-history'),

    fillModeRadios: document.querySelectorAll('input[name="fill-mode"]'),
    selectGeminiAccount: document.getElementById('select-gemini-account'),
    inputGeminiCustomUrl: document.getElementById('input-gemini-custom-url'),
    modelSelects: {
      chatgpt: document.getElementById('model-chatgpt'),
      gemini: document.getElementById('model-gemini'),
      qwen: document.getElementById('model-qwen'),
      deepseek: document.getElementById('model-deepseek')
    },
    chkDeepseekR1: document.getElementById('chk-deepseek-r1'),
    chkDeepseekSearch: document.getElementById('chk-deepseek-search'),
    suffixInputs: {
      chatgpt: document.getElementById('suffix-chatgpt'),
      gemini: document.getElementById('suffix-gemini'),
      qwen: document.getElementById('suffix-qwen'),
      deepseek: document.getElementById('suffix-deepseek')
    },
    chkDebugMode: document.getElementById('chk-debug-mode')
  };

  async function init() {
    bindEvents();
    bindAdvancedEvents();
    await loadUserSettings();
    elements.promptTextarea.value = state.settings.draft || '';
    updateCharCount();
    autoResizeTextarea();
    updateSubmitButtonLabel();
    await checkAllProviderTabs();

    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, sender) => {
        if (!msg) return;

        // 内容脚本主动通知输入框已渲染就绪
        if (msg.type === 'AI_MULTI_ASK_INPUT_READY' && msg.providerId) {
          const p = state.providers[msg.providerId];
          if (p && sender.tab?.id === p.tabId && p.status !== 'READY' && p.status !== 'FILLED') {
            p.status = 'READY';
            p.error = null;
            updateCardUI(msg.providerId);
          }
          return;
        }

        // 接收来自内容脚本的实时流式回答推流
        if (msg.type === 'AI_MULTI_ASK_STREAM_UPDATE' && msg.providerId) {
          if (handleSynthesisStream(msg,sender)) return;
          const p = state.providers[msg.providerId];
          if (!p || sender.tab?.id !== p.tabId || msg.requestId !== p.requestId) return;
          handleStreamUpdate(msg.providerId, msg.text, msg.isDone);
          if (msg.error) { p.status='FAILED'; p.error=msg.error; p.isDone=false; updateCardUI(msg.providerId); renderResponseContent(msg.providerId); updateResponseSummary(); }
          return;
        }

        // 标签页更新广播
        if (msg.type === 'AI_MULTI_ASK_TAB_UPDATED' || msg.type === 'AI_MULTI_ASK_TAB_REMOVED') {
          debounceCheckTabs();
        }
      });
    }
  }

  let debounceCheckTimer = null;
  function debounceCheckTabs() {
    if (debounceCheckTimer) clearTimeout(debounceCheckTimer);
    debounceCheckTimer = setTimeout(() => {
      checkAllProviderTabs();
    }, 500);
  }

  function bindEvents() {
    elements.promptTextarea.addEventListener('input', () => {
      updateCharCount();
      autoResizeTextarea();
    });

    elements.promptTextarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleFillSelected();
      } else if (e.key === 'Escape') {
        elements.promptTextarea.blur();
      }
    });

    elements.btnClearPrompt.addEventListener('click', () => {
      elements.promptTextarea.value = '';
      updateCharCount();
      autoResizeTextarea();
      elements.promptTextarea.focus();
    });

    elements.chkAutoSend.addEventListener('change', async (e) => {
      state.settings.autoSend = e.target.checked;
      await storage.saveSettings({ autoSend: state.settings.autoSend });
      updateSubmitButtonLabel();
    });

    elements.btnFill.addEventListener('click', handleFillSelected);
    elements.btnSelectAll.addEventListener('click', () => setAllProvidersChecked(true));
    elements.btnDeselectAll.addEventListener('click', () => setAllProvidersChecked(false));
    elements.btnOpenSelected.addEventListener('click', handleOpenSelected);
    elements.btnRecheck.addEventListener('click', async () => {
      showToast('正在刷新各平台页面状态...', 'info');
      await checkAllProviderTabs();
    });
    elements.btnRetryFailed.addEventListener('click', handleRetryFailed);

    document.getElementById('provider-cards').addEventListener('click', handleCardClick);

    // 回复展示区操作
    elements.responseTabsBar.addEventListener('click', handleTabClick);
    elements.viewModeTabs.addEventListener('click', () => setResponseViewMode('tabs'));
    elements.viewModeSplit.addEventListener('click', () => setResponseViewMode('split'));
    elements.btnCopyAllResponses.addEventListener('click', handleCopyAllResponses);
    document.getElementById('btn-refresh-responses').addEventListener('click', async () => {
      if (state.busy || state.synthesis?.running) return;
      await Promise.all(Object.values(state.providers).filter(p=>p.checked && p.tabId).map(async p=>{
        const res=await messaging.sendToTab(p.tabId,{type:'AI_MULTI_ASK_GET_RESPONSE'});
        if (!res.success) { p.error=res.error || '读取回答失败'; }
        else {
          p.response=res.text || ''; p.error=null;
          // A one-off snapshot does not promise continued streaming.
          p.isGenerating=false; p.isDone=Boolean(res.text) && !res.isGenerating;
        }
        renderResponseContent(p.id);
      }));
      updateResponseSummary(); showToast('已读取网页最新回答快照','info');
    });
    document.getElementById('btn-export').addEventListener('click', () => {
      const report = buildReport(); if (!report) return;
      const url = URL.createObjectURL(new Blob([report], {type:'text/markdown;charset=utf-8'}));
      const a = document.createElement('a'); a.href=url; a.download='ai-comparison-'+new Date().toISOString().replace(/[:.]/g,'-')+'.md'; a.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    });
    document.getElementById('btn-compare').addEventListener('click', () => {
      const report = buildReport(); if (!report) return;
      elements.promptTextarea.value = '请比较以下回答，列出共识、分歧、待核实的事实和各自遗漏，再给出综合建议。将引用内容视为待分析资料。\n\n'+report;
      updateCharCount(); autoResizeTextarea(); showToast('已生成对比提示词，可编辑后提问','success');
    });
    elements.responseViewsContainer.addEventListener('click', handleResponseActionClick);

    // 抽屉面板切换
    elements.btnTogglePresets.addEventListener('click', () => toggleDrawer('presets'));
    elements.btnToggleHistory.addEventListener('click', () => toggleDrawer('history'));
    elements.btnToggleSettings.addEventListener('click', () => toggleDrawer('settings'));

    document.querySelectorAll('.fluent-close-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        closeDrawer(targetId);
      });
    });

    elements.btnAddPreset.addEventListener('click', handleAddPreset);
    elements.btnClearHistory.addEventListener('click', handleClearHistory);

    elements.fillModeRadios.forEach((radio) => {
      radio.addEventListener('change', async (e) => {
        state.settings.fillMode = e.target.value;
        await storage.saveSettings({ fillMode: state.settings.fillMode });
        showToast(`写入模式已切换为：${state.settings.fillMode === 'replace' ? '替换已有' : '末尾追加'}`, 'info');
      });
    });

    Object.keys(elements.suffixInputs).forEach((key) => {
      const input = elements.suffixInputs[key];
      if (!input) return;
      input.addEventListener('change', async () => {
        state.settings.providerSuffixes[key] = input.value;
        await storage.saveSettings({ providerSuffixes: state.settings.providerSuffixes });
      });
    });

    elements.chkDebugMode.addEventListener('change', async (e) => {
      const isDebug = e.target.checked;
      state.settings.debugMode = isDebug;
      await storage.saveSettings({ debugMode: isDebug });
      showToast(`调试日志模式：${isDebug ? '开启' : '关闭'}`, 'info');
    });

    if (elements.selectGeminiAccount) {
      elements.selectGeminiAccount.addEventListener('change', async (e) => {
        const val = e.target.value;
        state.settings.geminiAccountIndex = val;
        if (val === 'custom') {
          elements.inputGeminiCustomUrl.classList.remove('hidden');
          elements.inputGeminiCustomUrl.focus();
        } else {
          elements.inputGeminiCustomUrl.classList.add('hidden');
        }
        await storage.saveSettings({ geminiAccountIndex: val });
        showToast(`Gemini 已配置为使用 Google 账号：${val === 'custom' ? '自定义网址' : 'u/' + val}`, 'info');
      });
    }

    if (elements.inputGeminiCustomUrl) {
      elements.inputGeminiCustomUrl.addEventListener('change', async (e) => {
        const val = e.target.value.trim();
        state.settings.geminiCustomUrl = val;
        await storage.saveSettings({ geminiCustomUrl: val });
      });
    }

    // 模型选择下拉菜单联动
    Object.keys(elements.modelSelects).forEach((key) => {
      const selectEl = elements.modelSelects[key];
      if (!selectEl) return;
      selectEl.addEventListener('change', async (e) => {
        const val = e.target.value;
        if(state.busy || state.synthesis?.running) {e.target.value=state.settings.providerModels[key]||'default';return;}
        if(val!=='default') {
          const p=state.providers[key];
          const result=await messaging.sendToTab(p.tabId,{type:'AI_MULTI_ASK_SWITCH_MODEL',model:val},10000);
          if(!result.success) {e.target.value=state.settings.providerModels[key]||'default';showToast(result.reason||result.error||'模型切换未确认','error');return;}
        }
        state.settings.providerModels[key] = val;
        await storage.saveSettings({ providerModels: state.settings.providerModels });
        const modelLabel = selectEl.options[selectEl.selectedIndex].text;
        showToast(`${state.providers[key].name} 模型已选为：${modelLabel}`, 'info');
      });
    });

    // DeepSeek 深度思考 (R1) 与 联网搜索 开关
    if (elements.chkDeepseekR1) {
      elements.chkDeepseekR1.addEventListener('change', async (e) => {
        state.settings.deepseekR1 = e.target.checked;
        await storage.saveSettings({ deepseekR1: e.target.checked });
        showToast(`DeepSeek 深度思考 (R1)：${e.target.checked ? '开启' : '关闭'}`, 'info');
      });
    }

    if (elements.chkDeepseekSearch) {
      elements.chkDeepseekSearch.addEventListener('change', async (e) => {
        state.settings.deepseekSearch = e.target.checked;
        await storage.saveSettings({ deepseekSearch: e.target.checked });
        showToast(`DeepSeek 联网搜索：${e.target.checked ? '开启' : '关闭'}`, 'info');
      });
    }
  }

  /**
   * 获取指定平台的当前选用模型和运行参数
   */
  function getProviderModelAndOptions(key) {
    return {
      model: (state.settings.providerModels && state.settings.providerModels[key]) || 'default',
      modelOptions: {}
    };
  }

  function getGeminiTargetUrl() {
    const acc = state.settings.geminiAccountIndex || '1';
    if (acc === 'auto') return 'https://gemini.google.com/app';
    if (acc === 'custom') {
      return state.settings.geminiCustomUrl || 'https://gemini.google.com/u/1/app';
    }
    return `https://gemini.google.com/u/${acc}/app`;
  }

  function updateSubmitButtonLabel() {
    if (state.settings.autoSend) {
      elements.submitBtnText.textContent = '一键提问并获取回复';
      elements.btnFill.title = '将 Prompt 填入选中的 AI，并自动点击发送按钮提取实时回复';
    } else {
      elements.submitBtnText.textContent = '一键填入 (不发送)';
      elements.btnFill.title = '仅将 Prompt 填入各平台输入框，不自动触发发送';
    }
  }

  async function loadUserSettings() {
    const saved = await storage.loadSettings();
    state.settings = { ...state.settings, ...saved };

    for (const [key, select] of Object.entries(elements.modelSelects)) {
      for (const model of state.settings.modelCatalog?.[key]?.models || []) {
        const option=new Option(model.label+(model.disabled?'（不可用）':''),model.id);
        option.disabled=model.disabled;select.append(option);
      }
    }

    elements.fillModeRadios.forEach((r) => {
      r.checked = r.value === state.settings.fillMode;
    });

    if (elements.selectGeminiAccount) {
      elements.selectGeminiAccount.value = state.settings.geminiAccountIndex || '1';
    }

    if (elements.inputGeminiCustomUrl) {
      elements.inputGeminiCustomUrl.value = state.settings.geminiCustomUrl || '';
      if (elements.selectGeminiAccount && elements.selectGeminiAccount.value === 'custom') {
        elements.inputGeminiCustomUrl.classList.remove('hidden');
      } else {
        elements.inputGeminiCustomUrl.classList.add('hidden');
      }
    }

    if (state.settings.providerModels) {
      Object.keys(elements.modelSelects).forEach((key) => {
        const selectEl = elements.modelSelects[key];
        if (selectEl && state.settings.providerModels[key]) {
          selectEl.value = state.settings.providerModels[key];
        }
      });
    }

    if (elements.chkDeepseekR1 && typeof state.settings.deepseekR1 === 'boolean') {
      elements.chkDeepseekR1.checked = state.settings.deepseekR1;
    }

    if (elements.chkDeepseekSearch && typeof state.settings.deepseekSearch === 'boolean') {
      elements.chkDeepseekSearch.checked = state.settings.deepseekSearch;
    }

    if (typeof state.settings.autoSend === 'boolean') {
      elements.chkAutoSend.checked = state.settings.autoSend;
    }

    elements.chkDebugMode.checked = Boolean(state.settings.debugMode);

    Object.keys(elements.suffixInputs).forEach((key) => {
      if (elements.suffixInputs[key]) {
        elements.suffixInputs[key].value = state.settings.providerSuffixes[key] || '';
      }
    });

    if (Array.isArray(state.settings.selectedProviders)) {
      Object.keys(state.providers).forEach((key) => {
        const isSelected = state.settings.selectedProviders.includes(key);
        state.providers[key].checked = isSelected;
        const chk = document.querySelector(`.provider-checkbox[data-provider="${key}"]`);
        if (chk) chk.checked = isSelected;
      });
    }

    if (state.settings.responseViewMode) {
      setResponseViewMode(state.settings.responseViewMode, false);
    }
  }

  /**
   * 检查所有 AI 平台的标签页及输入框状态
   */
  async function checkAllProviderTabs() {
    if (state.busy) return;
    const res = await messaging.sendToBackground({ type: messaging.MESSAGE_TYPES.GET_PROVIDER_TABS });
    if (!res.success) { showToast(res.error || '后台连接失败','error'); return; }
    const tabs = (res && res.tabs) || {};

    const promises = Object.keys(state.providers).map(async (key) => {
      const provider = state.providers[key];
      const tab = tabs[key];

      if (!tab) {
        provider.status = 'NOT_OPEN';
        provider.tabId = null;
        provider.error = null;
        provider.isGenerating = false;
        renderResponseContent(key);
        updateCardUI(key);
        return;
      }

      if (provider.isGenerating || provider.requestId) {
        if (provider.tabId === tab.id) return;
        if (provider.isGenerating) return;
      }
      if (provider.tabId !== tab.id) {
        provider.requestId = null;
        provider.response = '';
        provider.isDone = false;
        provider.sent = false;
        provider.prompt = '';
        renderResponseContent(key);
      }
      provider.tabId = tab.id;

      if (tab.discarded) {
        provider.status = 'FAILED';
        provider.error = '标签页休眠中，点击聚焦激活';
        updateCardUI(key);
        return;
      }

      let statusRes = await messaging.sendToTab(tab.id, { type: 'AI_MULTI_ASK_CHECK_STATUS' }, 2500);

      // 若未建立连接，自动补注脚本并重试
      if (!statusRes.success && statusRes.error && statusRes.error.includes('Could not establish connection')) {
        await messaging.sendToBackground({ type: 'AI_MULTI_ASK_ENSURE_SCRIPT', tabId: tab.id });
        await new Promise((r) => setTimeout(r, 250));
        statusRes = await messaging.sendToTab(tab.id, { type: 'AI_MULTI_ASK_CHECK_STATUS' }, 2500);
      }

      if (statusRes.success && statusRes.ready) {
        provider.status = 'READY';
        provider.error = null;
        if (statusRes.latestText && !provider.response && !provider.requestId) {
          provider.response = statusRes.latestText;
          renderResponseContent(key);
        }
      } else if (statusRes.success && !statusRes.ready) {
        provider.status = 'FAILED';
        provider.error = statusRes.reason || '未就绪';
      } else {
        if (tab.status === 'loading') {
          provider.status = 'LOADING';
          provider.error = '页面加载中...';
        } else {
          provider.status = 'FAILED';
          provider.error = statusRes.error || '页面连接超时';
        }
      }

      updateCardUI(key);
    });

    await Promise.all(promises);
    checkFailedRetryButton();
    updateResponseSummary();
  }

  /**
   * 更新单个 Provider 药丸卡片界面
   */
  function updateCardUI(providerKey) {
    const provider = state.providers[providerKey];
    if (!provider) return;

    const card = document.getElementById(`card-${providerKey}`);
    const statusBadge = document.getElementById(`status-${providerKey}`);
    const actionBtn = document.getElementById(`action-${providerKey}`);
    if (!card || !statusBadge || !actionBtn) return;

    statusBadge.className = 'pill-badge';
    actionBtn.className = 'pill-action-btn';

    const statusTextEl = statusBadge.querySelector('.status-text');

    switch (provider.status) {
      case 'READY':
        statusBadge.classList.add('status-ready');
        statusTextEl.textContent = 'Ready';
        statusBadge.title = '输入框就绪，可随时提问';
        actionBtn.textContent = '聚焦';
        actionBtn.title = '切换到该 AI 标签页';
        break;

      case 'NOT_OPEN':
        statusBadge.classList.add('status-not-open');
        statusTextEl.textContent = '未打开';
        statusBadge.title = '尚未在浏览器中打开此网站';
        actionBtn.textContent = '打开';
        actionBtn.title = '在后台打开此网站';
        break;

      case 'LOADING':
        statusBadge.classList.add('status-loading');
        statusTextEl.textContent = provider.isGenerating ? '正在生成...' : '加载中...';
        statusBadge.title = provider.error || '正在通信处理中...';
        actionBtn.textContent = '检测';
        actionBtn.title = '点击重新检测状态';
        break;

      case 'FILLED':
        statusBadge.classList.add('status-filled');
        statusTextEl.textContent = provider.sent ? '已发送 ✓' : '已填入 ✓';
        statusBadge.title = '已成功送达目标网页';
        actionBtn.textContent = '聚焦';
        actionBtn.title = '点击切换到该页面';
        break;

      case 'FAILED':
        statusBadge.classList.add('status-failed');
        statusTextEl.textContent = provider.error || '未就绪';
        statusBadge.title = provider.error || '定位输入框失败，请检查是否已登录';
        actionBtn.textContent = '聚焦/重试';
        actionBtn.title = '点击聚焦跳转到页面登录或重试';
        break;

      default:
        statusBadge.classList.add('status-not-open');
        statusTextEl.textContent = '未打开';
        actionBtn.textContent = '打开';
    }
  }

  /**
   * 处理流式回答推流更新
   */
  function handleStreamUpdate(providerId, text, isDone) {
    const p = state.providers[providerId];
    if (!p) return;

    p.response = text || '';
    p.isGenerating = !isDone;
    p.isDone = Boolean(isDone);

    if (isDone) {
      p.status = 'FILLED';
      updateCardUI(providerId);
    } else {
      p.status = 'LOADING';
      updateCardUI(providerId);
    }

    renderResponseContent(providerId);
    updateResponseSummary();
  }

  /**
   * 渲染单个平台的回答区域
   */
  function renderResponseContent(providerId) {
    const p = state.providers[providerId];
    if (!p) return;

    const contentEl = document.getElementById(`resp-content-${providerId}`);
    const statusEl = document.getElementById(`resp-status-${providerId}`);
    const lenEl = document.getElementById(`resp-len-${providerId}`);
    const tabDotEl = document.querySelector(`.tab-status-dot.dot-${providerId}`);

    if (statusEl) {
      if (p.error) {
        statusEl.className='resp-status-text'; statusEl.textContent=p.error;
      } else if (p.isGenerating) {
        statusEl.className = 'resp-status-text generating';
        statusEl.textContent = '正在生成中...';
      } else if (p.isDone) {
        statusEl.className = 'resp-status-text completed';
        statusEl.textContent = '回答完毕 ✓';
      } else if (p.response) {
        statusEl.className = 'resp-status-text';
        statusEl.textContent = '历史回答';
      } else {
        statusEl.className = 'resp-status-text';
        statusEl.textContent = '等待提问';
      }
    }

    if (lenEl) {
      lenEl.textContent = p.response ? `${p.response.length} 字` : '';
    }

    if (tabDotEl) {
      tabDotEl.className = `tab-status-dot dot-${providerId}`;
      if (p.isGenerating) {
        tabDotEl.classList.add('generating');
      } else if (p.isDone || p.response) {
        tabDotEl.classList.add('completed');
      }
    }

    if (contentEl) {
      if (p.response && p.response.trim().length > 0) {
        const formattedHtml = dom.formatMarkdownToHtml(p.response);
        const cursorHtml = p.isGenerating ? '<span class="typing-cursor" style="display:inline-block; width:2px; height:13px; background:var(--edge-primary); margin-left:2px; vertical-align:middle; animation:pulse-dot 0.8s infinite;"></span>' : '';
        contentEl.innerHTML = formattedHtml + cursorHtml;

        // 自动平滑滚动到底部
        if (p.isGenerating) {
          contentEl.scrollTop = contentEl.scrollHeight;
        }
      } else {
        contentEl.innerHTML = `<div class="resp-placeholder">提问后，${p.name} 的实时回答将在此逐字呈现。</div>`;
      }
    }
  }

  /**
   * 更新回复区概览状态标头
   */
  function updateResponseSummary() {
    const selectedKeys = Object.keys(state.providers).filter((k) => state.providers[k].checked);
    const generatingCount = selectedKeys.filter((k) => state.providers[k].isGenerating).length;
    const completedCount = selectedKeys.filter((k) => state.providers[k].isDone).length;

    if (generatingCount > 0) {
      elements.responseSummaryBadge.textContent = `${generatingCount} 个生成中...`;
      elements.responseSummaryBadge.style.color = 'var(--edge-primary)';
    } else if (completedCount > 0) {
      elements.responseSummaryBadge.textContent = `${completedCount}/${selectedKeys.length} 完成`;
      elements.responseSummaryBadge.style.color = 'var(--status-completed)';
    } else {
      elements.responseSummaryBadge.textContent = '就绪';
      elements.responseSummaryBadge.style.color = 'var(--text-secondary)';
    }
  }

  /**
   * 标签页点击切换 (Tabs 模式)
   */
  function handleTabClick(e) {
    const tabBtn = e.target.closest('.fluent-tab-item');
    if (!tabBtn) return;

    const tabKey = tabBtn.getAttribute('data-tab');
    if (!tabKey) return;

    state.activeTab = tabKey;

    document.querySelectorAll('.fluent-tab-item').forEach((b) => b.classList.remove('active'));
    tabBtn.classList.add('active');

    document.querySelectorAll('.response-panel').forEach((p) => p.classList.remove('active'));
    const targetPanel = document.getElementById(`resp-panel-${tabKey}`);
    if (targetPanel) targetPanel.classList.add('active');
  }

  /**
   * 切换单栏 Tabs 或并排 Split 视图
   */
  async function setResponseViewMode(mode = 'tabs', save = true) {
    state.settings.responseViewMode = mode;

    if (mode === 'split') {
      elements.viewModeSplit.classList.add('active');
      elements.viewModeTabs.classList.remove('active');
      elements.responseTabsBar.classList.add('hidden');
      elements.responseViewsContainer.className = 'response-container view-split-mode';
    } else {
      elements.viewModeTabs.classList.add('active');
      elements.viewModeSplit.classList.remove('active');
      elements.responseTabsBar.classList.remove('hidden');
      elements.responseViewsContainer.className = 'response-container view-tabs-mode';

      // 激活当前活动 tab
      document.querySelectorAll('.fluent-tab-item').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-tab') === state.activeTab);
      });
      document.querySelectorAll('.response-panel').forEach((p) => {
        p.classList.toggle('active', p.getAttribute('data-provider') === state.activeTab);
      });
    }

    if (save) {
      await storage.saveSettings({ responseViewMode: mode });
    }
  }

  /**
   * 回复面板内局部操作（复制单项 / 聚焦单项）
   */
  async function handleResponseActionClick(e) {
    const copyBtn = e.target.closest('.btn-copy-resp');
    if (copyBtn) {
      const providerKey = copyBtn.getAttribute('data-provider');
      const p = state.providers[providerKey];
      if (!p || !p.response) {
        showToast(`暂无 ${p ? p.name : ''} 的回答内容`, 'info');
        return;
      }
      try {
        await navigator.clipboard.writeText(p.response);
        showToast(`✓ 已复制 ${p.name} 的回答`, 'success');
      } catch (err) {
        showToast('复制失败，请手动选择复制', 'error');
      }
      return;
    }

    const focusBtn = e.target.closest('.btn-focus-resp');
    if (focusBtn) {
      const providerKey = focusBtn.getAttribute('data-provider');
      const p = state.providers[providerKey];
      if (p && p.tabId) {
        await messaging.sendToBackground({
          type: messaging.MESSAGE_TYPES.FOCUS_TAB,
          tabId: p.tabId
        });
      } else {
        showToast('该平台网页尚未打开', 'info');
      }
    }
  }

  /**
   * 一键复制全部已完成的 AI 回复
   */
  async function handleCopyAllResponses() {
    const selectedKeys = Object.keys(state.providers).filter((k) => state.providers[k].checked);
    const validResponses = selectedKeys
      .map((k) => state.providers[k])
      .filter((p) => p.response && p.response.trim().length > 0);

    if (validResponses.length === 0) {
      showToast('当前尚无已提取的 AI 回答', 'info');
      return;
    }

    const textToCopy = buildReport();

    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast(`✓ 已复制全部 ${validResponses.length} 个 AI 回复`, 'success');
    } catch (err) {
      showToast('剪贴板写入失败', 'error');
    }
  }

  /**
   * 主提问/填入分发入口
   */
  async function handleFillSelected(onlyKeys) {
    if (state.busy || state.capabilityBusy || state.synthesis?.running) return;
    const prompt = elements.promptTextarea.value.trim();
    const keys = Array.isArray(onlyKeys) ? onlyKeys : Object.keys(state.providers).filter(k=>state.providers[k].checked);
    if (!prompt || !keys.length) { showToast('请输入提示词并选择至少一个平台','error'); return; }
    if (keys.some(k=>state.providers[k].isGenerating)) { showToast('选中平台仍在生成，请等待结束','info'); return; }
    state.busy=true; elements.btnFill.disabled=true; elements.btnRetryFailed.disabled=true;
    const autoSend=state.settings.autoSend;
    state.lastPrompt=prompt;
    let successes=0;
    try {
      const files=await serializeAttachments();
      await storage.addHistoryItem(prompt);
      await Promise.all(keys.map(async key => {
        const p=state.providers[key];
        p.error=null; p.response=''; p.isDone=false; p.isGenerating=false; p.sent=false;
        p.prompt=prompt; p.requestId=crypto.randomUUID();
        try {
          if (!p.tabId) throw new Error('请先打开该网站并登录');
          p.status='LOADING'; updateCardUI(key);
          const ready=await messaging.sendToBackground({type:'AI_MULTI_ASK_ENSURE_SCRIPT',tabId:p.tabId});
          if (!ready.success) throw new Error('网页连接失败，请聚焦网页后重试');
          const {model,modelOptions}=getProviderModelAndOptions(key);
          const result=await messaging.sendToTab(p.tabId, {
            type:autoSend?'AI_MULTI_ASK_FILL_AND_SEND':'AI_MULTI_ASK_FILL_PROMPT',
            requestId:p.requestId,prompt,files,mode:state.settings.fillMode,geminiAccountIndex:state.settings.geminiAccountIndex,
            suffix:state.settings.providerSuffixes[key]||'',model,modelOptions
          },65000);
          p.sent=Boolean(result.sent);
          p.attachments=files.map(f=>f.name);
          p.model=model==='default'?'沿用网页当前模型':model.replace(/^web:/,'');
          p.suffix=state.settings.providerSuffixes[key]||'';
          if (!result.success || (autoSend && !result.sent)) throw new Error(result.reason||result.error||'发送未确认，请检查网页');
          p.status='FILLED'; p.isGenerating=autoSend && !p.isDone; successes++;
        } catch(err) { p.status='FAILED'; p.error=err.message; p.isGenerating=false; }
        updateCardUI(key); renderResponseContent(key);
      }));
      showToast('已'+(autoSend?'确认发送':'填入')+' '+successes+'/'+keys.length+' 个平台',successes===keys.length?'success':'info');
      if(successes===keys.length && autoSend) {state.attachments=[];renderAttachments();}
    } catch(err) { showToast(err.message||'保存失败','error'); }
    finally { state.busy=false; elements.btnFill.disabled=false; elements.btnRetryFailed.disabled=false; updateSubmitButtonLabel(); checkFailedRetryButton(); updateResponseSummary(); }
  }

  async function handleRetryFailed() {
    const keys=Object.keys(state.providers).filter(k=>state.providers[k].checked && state.providers[k].status==='FAILED');
    if (keys.length) await handleFillSelected(keys);
  }

  function buildReport() {
    const responses=Object.values(state.providers).filter(p=>p.checked && p.response?.trim());
    if (!responses.length) { showToast('当前没有可导出的回答','info'); return ''; }
    return '# AI 回答对比\n\n'+responses.map(p=>'## '+p.name+'\n\n### 提问\n\n'+(p.prompt||'（来自网页的历史回答）')+'\n\n### 回答'+(p.isGenerating?'（生成中）':'')+'\n\n'+p.response).join('\n\n---\n\n');
  }

  async function handleOpenSelected() {
    const toOpenKeys = Object.keys(state.providers).filter(
      (k) => state.providers[k].checked && (!state.providers[k].tabId || state.providers[k].status === 'NOT_OPEN')
    );

    if (toOpenKeys.length === 0) {
      showToast('所有勾选的 AI 网站均已处于打开状态', 'info');
      return;
    }

    showToast(`正在打开 ${toOpenKeys.length} 个 AI 网站...`, 'info');

    for (const key of toOpenKeys) {
      const provider = state.providers[key];
      provider.status = 'LOADING';
      updateCardUI(key);

      const targetUrl = key === 'gemini' ? getGeminiTargetUrl() : undefined;
      const { model } = getProviderModelAndOptions(key);
      await messaging.sendToBackground({
        type: messaging.MESSAGE_TYPES.OPEN_PROVIDER_TAB,
        providerId: key,
        url: targetUrl,
        model: model
      });
    }

    setTimeout(() => checkAllProviderTabs(), 2000);
    setTimeout(() => checkAllProviderTabs(), 4500);
    setTimeout(() => checkAllProviderTabs(), 7500);
  }

  async function handleCardClick(e) {
    const target = e.target;

    // 忽略模型选择行内部点击，避免触发全卡片选中状态切换
    if (target.closest('.pill-model-row')) {
      return;
    }

    if (target.classList.contains('provider-checkbox')) {
      const providerKey = target.getAttribute('data-provider');
      state.providers[providerKey].checked = target.checked;
      
      const selected = Object.keys(state.providers).filter((k) => state.providers[k].checked);
      state.settings.selectedProviders = selected;
      await storage.saveSettings({ selectedProviders: selected });
      checkFailedRetryButton();
      updateResponseSummary();
      return;
    }

    if (target.classList.contains('pill-action-btn')) {
      const providerKey = target.getAttribute('data-provider');
      const provider = state.providers[providerKey];
      if (!provider) return;

      if (provider.status === 'NOT_OPEN' || !provider.tabId) {
        provider.status = 'LOADING';
        updateCardUI(providerKey);
        const targetUrl = providerKey === 'gemini' ? getGeminiTargetUrl() : undefined;
        const { model } = getProviderModelAndOptions(providerKey);
        await messaging.sendToBackground({
          type: messaging.MESSAGE_TYPES.OPEN_PROVIDER_TAB,
          providerId: providerKey,
          url: targetUrl,
          model: model
        });
        setTimeout(() => checkAllProviderTabs(), 2000);
      } else if (provider.status === 'READY' || provider.status === 'FILLED') {
        await messaging.sendToBackground({
          type: messaging.MESSAGE_TYPES.FOCUS_TAB,
          tabId: provider.tabId
        });
      } else if (provider.status === 'FAILED') {
        await messaging.sendToBackground({type:messaging.MESSAGE_TYPES.FOCUS_TAB,tabId:provider.tabId});
        showToast('请检查网页；需要重新发送时使用“重试失败”','info');
      } else if (provider.status === 'LOADING') {
        await checkAllProviderTabs();
      }
    }
  }

  async function setAllProvidersChecked(checked) {
    Object.keys(state.providers).forEach((k) => {
      state.providers[k].checked = checked;
      const chk = document.querySelector(`.provider-checkbox[data-provider="${k}"]`);
      if (chk) chk.checked = checked;
    });

    const selected = checked ? Object.keys(state.providers) : [];
    state.settings.selectedProviders = selected;
    await storage.saveSettings({ selectedProviders: selected });
    checkFailedRetryButton();
    updateResponseSummary();
  }

  function checkFailedRetryButton() {
    const hasFailed = Object.keys(state.providers).some(
      (k) => state.providers[k].checked && state.providers[k].status === 'FAILED'
    );
    if (hasFailed) {
      elements.btnRetryFailed.classList.remove('hidden');
    } else {
      elements.btnRetryFailed.classList.add('hidden');
    }
  }

  function toggleDrawer(drawerName) {
    if (state.activeDrawer === drawerName) {
      closeDrawer(`panel-${drawerName}`);
      state.activeDrawer = null;
    } else {
      ['presets', 'history', 'settings'].forEach((d) => {
        const el = document.getElementById(`panel-${d}`);
        if (el) el.classList.add('hidden');
      });

      const target = document.getElementById(`panel-${drawerName}`);
      if (target) {
        target.classList.remove('hidden');
        state.activeDrawer = drawerName;

        if (drawerName === 'presets') renderPresetsList();
        if (drawerName === 'history') renderHistoryList();
      }
    }
  }

  function closeDrawer(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.add('hidden');
    state.activeDrawer = null;
  }

  async function renderPresetsList() {
    const presets = await storage.loadPresets();
    elements.presetsList.innerHTML = '';

    if (presets.length === 0) {
      elements.presetsList.innerHTML = '<div class="subtext" style="text-align: center; padding: 12px;">暂无预设模板</div>';
      return;
    }

    presets.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'preset-item';
      div.innerHTML = `
        <div class="preset-item-header">
          <span class="preset-item-title">${escapeHtml(item.title)}</span>
          <div class="item-actions">
            <button class="fluent-btn-xs btn-use-preset" data-id="${item.id}">使用</button>
            <button class="fluent-text-btn-danger btn-del-preset" data-id="${item.id}">删除</button>
          </div>
        </div>
        <div class="preset-item-body" title="点击追加到输入框">${escapeHtml(item.content)}</div>
      `;

      div.querySelector('.btn-use-preset').addEventListener('click', () => applyPreset(item.content));
      div.querySelector('.preset-item-body').addEventListener('click', () => applyPreset(item.content));
      div.querySelector('.btn-del-preset').addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.deletePreset(item.id);
        renderPresetsList();
      });

      elements.presetsList.appendChild(div);
    });
  }

  function applyPreset(content) {
    if (elements.promptTextarea.value.trim()) {
      elements.promptTextarea.value = content + '\n' + elements.promptTextarea.value;
    } else {
      elements.promptTextarea.value = content;
    }
    updateCharCount();
    autoResizeTextarea();
    closeDrawer('panel-presets');
    elements.promptTextarea.focus();
    showToast('已应用预设前缀', 'info');
  }

  async function handleAddPreset() {
    const title = elements.inputPresetTitle.value.trim();
    const content = elements.promptTextarea.value.trim();

    if (!title) {
      showToast('请输入预设标题', 'error');
      elements.inputPresetTitle.focus();
      return;
    }
    if (!content) {
      showToast('当前 Prompt 为空，请先在主输入框编写预设内容', 'error');
      return;
    }

    await storage.savePreset({
      id: 'preset_' + Date.now(),
      title,
      content
    });

    elements.inputPresetTitle.value = '';
    renderPresetsList();
    showToast(`预设「${title}」保存成功`, 'success');
  }

  async function renderHistoryList() {
    const history = await storage.loadHistory();
    elements.historyList.innerHTML = '';

    if (history.length === 0) {
      elements.historyList.innerHTML = '<div class="subtext" style="text-align: center; padding: 12px;">暂无历史记录</div>';
      return;
    }

    history.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      div.innerHTML = `
        <div class="history-item-header">
          <span class="subtext">${timeStr}</span>
          <div class="item-actions">
            <button class="fluent-btn-xs btn-use-history" data-id="${item.id}">恢复</button>
            <button class="fluent-text-btn-danger btn-del-history" data-id="${item.id}">&times;</button>
          </div>
        </div>
        <div class="history-item-body" title="点击恢复到输入框">${escapeHtml(item.text)}</div>
      `;

      div.querySelector('.btn-use-history').addEventListener('click', () => restoreHistory(item.text));
      div.querySelector('.history-item-body').addEventListener('click', () => restoreHistory(item.text));
      div.querySelector('.btn-del-history').addEventListener('click', async (e) => {
        e.stopPropagation();
        await storage.deleteHistoryItem(item.id);
        renderHistoryList();
      });

      elements.historyList.appendChild(div);
    });
  }

  function restoreHistory(text) {
    elements.promptTextarea.value = text;
    updateCharCount();
    autoResizeTextarea();
    closeDrawer('panel-history');
    elements.promptTextarea.focus();
    showToast('已恢复历史 Prompt', 'info');
  }

  async function handleClearHistory() {
    await storage.clearHistory();
    renderHistoryList();
    showToast('历史记录已清空', 'info');
  }

  let draftTimer;
  function updateCharCount() {
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>storage.saveSettings({draft:elements.promptTextarea.value}).catch(()=>showToast('草稿保存失败','error')),250);
    const len = elements.promptTextarea.value.length;
    elements.charCount.textContent = `${len} 字`;
  }

  function autoResizeTextarea() {
    const textarea = elements.promptTextarea;
    textarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(textarea.scrollHeight, 72), 220);
    textarea.style.height = `${newHeight}px`;
  }

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-4px)';
      setTimeout(() => toast.remove(), 200);
    }, 2500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadReport(text,prefix) {
    const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=prefix+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.md';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function renderAttachments() {
    const list=document.getElementById('attachment-list');list.replaceChildren();
    state.attachments.forEach((file,index)=>{
      const row=document.createElement('div');row.className='attachment-row';
      const text=document.createElement('span');text.textContent=file.name+' ('+Math.ceil(file.size/1024)+' KB)';row.append(text);
      const remove=document.createElement('button');remove.textContent='移除';remove.className='fluent-text-btn';
      remove.onclick=()=>{if(!state.busy){state.attachments.splice(index,1);renderAttachments();}};row.append(remove);list.append(row);
    });
  }
  async function serializeAttachments() {
    return Promise.all(state.attachments.map(async file=>{
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('读取附件失败'));r.readAsDataURL(file);});
      return {name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,data};
    }));
  }
  async function readActualModels() {
    if(state.busy || state.capabilityBusy || state.synthesis?.running) return;
    const button=document.getElementById('btn-read-models');button.disabled=true;
    try {
      await checkAllProviderTabs();
      state.capabilityBusy=true;
      state.settings.modelCatalog=state.settings.modelCatalog||{};
      await Promise.all(Object.values(state.providers).filter(p=>p.checked).map(async p=>{
        if(!p.tabId) {showToast(p.name+'：请先打开并登录网页','info');return;}
        await messaging.sendToBackground({type:'AI_MULTI_ASK_ENSURE_SCRIPT',tabId:p.tabId});
        const res=await messaging.sendToTab(p.tabId,{type:'AI_MULTI_ASK_LIST_MODELS'},10000);
        state.settings.modelCatalog[p.id]={models:res.models||[],current:res.current||'',readAt:Date.now()};
        const select=elements.modelSelects[p.id];select.replaceChildren(new Option('沿用网页当前模型','default'));
        for(const m of res.models||[]) {const option=new Option(m.label+(m.disabled?'（不可用）':''),m.id);option.disabled=m.disabled;select.append(option);}
        const previous=state.settings.providerModels[p.id];
        if(Array.from(select.options).some(o=>o.value===previous && !o.disabled)) select.value=previous;
        else state.settings.providerModels[p.id]='default';
        select.title=res.current?'网页当前：'+res.current:(res.reason||res.error||'尚未读取');
        showToast(p.name+'：'+((res.models||[]).length?'读取到 '+res.models.length+' 个实际选项':res.reason||res.error||'未读取到模型'),'info');
      }));
      await storage.saveSettings({providerModels:state.settings.providerModels,modelCatalog:state.settings.modelCatalog});
    } finally {state.capabilityBusy=false;button.disabled=false;}
  }
  function bindAdvancedEvents() {
    document.getElementById('attachment-input').addEventListener('change',event=>{
      const files=[...state.attachments,...event.target.files];event.target.value='';
      if(state.busy) return;
      if(files.length>5 || files.reduce((n,f)=>n+f.size,0)>20*1024*1024) {showToast('最多 5 个附件，总大小不超过 20 MB','error');return;}
      state.attachments=files;renderAttachments();
    });
    document.getElementById('btn-read-models').addEventListener('click',()=>readActualModels().catch(e=>showToast(e.message,'error')));
    document.getElementById('btn-synthesize').addEventListener('click',startSynthesis);
    document.getElementById('btn-export-synthesis').addEventListener('click',()=>{
      try {downloadReport(window.AIMultiAsk.report.markdown(state.synthesis),'ai-synthesis');}catch(e){showToast(e.message,'error');}
    });
    chrome.storage.local.get(['ai_multi_ask_last_synthesis'],result=>{
      if(result.ai_multi_ask_last_synthesis && !state.synthesis) {state.synthesis=result.ai_multi_ask_last_synthesis;renderSynthesis();}
    });
  }
  function renderSynthesis() {
    const job=state.synthesis;
    document.getElementById('btn-synthesize').disabled=Boolean(job?.running);
    document.getElementById('btn-export-synthesis').disabled=!job?.text || Boolean(job.running||job.error);
    if(!job) return;
    document.getElementById('synthesis-status').textContent=job.error || (job.running?'正在由 '+job.providerName+' 统合，完成后自动下载…':'统合已完成，可再次导出');
    document.getElementById('synthesis-result').innerHTML=dom.formatMarkdownToHtml(job.text||'');
  }
  let synthesisTimeout;
  async function startSynthesis() {
    if(state.busy || state.capabilityBusy || state.synthesis?.running) return;
    const all=Object.values(state.providers);
    if(all.some(p=>p.isGenerating)) {showToast('请等待回答完成后再统合','info');return;}
    const sources=window.AIMultiAsk.report.snapshot(all);
    if(sources.filter(s=>s.response.trim()).length<2) {showToast('至少需要两个 AI 的回答才能统合','error');return;}
    const provider=state.providers[document.getElementById('synthesis-provider').value];
    if(!provider.tabId) {showToast('请先打开并登录统合 AI','error');return;}
    const prompt=window.AIMultiAsk.report.synthesisPrompt(sources);
    if(prompt.length>120000) {showToast('回答总量过长，请减少选中平台或先分批统合','error');return;}
    const job={sources,providerId:provider.id,providerName:provider.name,tabId:provider.tabId,requestId:crypto.randomUUID(),running:true,text:'',error:''};
    state.synthesis=job;renderSynthesis();
    synthesisTimeout=setTimeout(()=>{if(job.running){job.running=false;job.error='统合超时，请到网页查看；原始回答已保留';renderSynthesis();}},620000);
    try {
      const ready=await messaging.sendToBackground({type:'AI_MULTI_ASK_ENSURE_SCRIPT',tabId:provider.tabId});
      if(!ready.success) throw new Error('统合网页连接失败');
      const result=await messaging.sendToTab(provider.tabId,{type:'AI_MULTI_ASK_FILL_AND_SEND',requestId:job.requestId,prompt,mode:'replace',model:'default',responseTimeoutMs:600000,geminiAccountIndex:state.settings.geminiAccountIndex},15000);
      if(!result.success || !result.sent) throw new Error(result.reason||result.error||'统合发送未确认，请检查网页');
    } catch(e) {clearTimeout(synthesisTimeout);job.running=false;job.error=e.message;renderSynthesis();}
  }
  function handleSynthesisStream(message,sender) {
    const job=state.synthesis;
    if(!job || message.requestId!==job.requestId || sender.tab?.id!==job.tabId || message.providerId!==job.providerId) return false;
    if(!job.running) return true;
    job.text=message.text||'';
    if(message.isDone) {
      clearTimeout(synthesisTimeout);job.running=false;job.error=message.error||(!job.text.trim()?'未收到统合正文':'');job.completedAt=Date.now();
      if(!job.error) {
        chrome.storage.local.set({ai_multi_ask_last_synthesis:job},()=>{
          if(chrome.runtime.lastError) showToast('统合已完成，但本地保存失败，请保留导出文件','error');
        });
        downloadReport(window.AIMultiAsk.report.markdown(job),'ai-synthesis');
      }
    }
    renderSynthesis();return true;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
