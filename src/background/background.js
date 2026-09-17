/**
 * AI Multi Ask - Background Service Worker (Manifest V3)
 */

const PROVIDER_CONFIGS = {
  chatgpt: {
    id: 'chatgpt',
    name: 'ChatGPT',
    defaultUrl: 'https://chatgpt.com/',
    matchPatterns: ['chatgpt.com', 'chat.openai.com']
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    defaultUrl: 'https://gemini.google.com/u/1/app',
    matchPatterns: ['gemini.google.com']
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    defaultUrl: 'https://chat.qwen.ai/',
    matchPatterns: ['tongyi.aliyun.com', 'tongyi.ai', 'chat.qwenlm.ai', 'qwenlm.ai', 'qwen.ai', 'chat.qwen.ai']
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    defaultUrl: 'https://chat.deepseek.com/',
    matchPatterns: ['chat.deepseek.com', 'deepseek.com']
  }
};

const CONTENT_SCRIPT_FILES = [
  'src/utils/dom.js',
  'src/utils/storage.js',
  'src/utils/messaging.js',
  'src/adapters/adapter-base.js',
  'src/adapters/chatgpt.js',
  'src/adapters/gemini.js',
  'src/adapters/qwen.js',
  'src/adapters/deepseek.js',
  'src/adapters/index.js',
  'src/adapters/capabilities.js',
  'src/content/content.js'
];

// 配置扩展图标点击直接展开 Side Panel (Chrome / Edge 116+)
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn('[AI Multi Ask] setPanelBehavior warning:', error));
}

// 快捷键命令监听
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === '_execute_side_panel' || command === 'open_side_panel') {
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab && chrome.sidePanel && chrome.sidePanel.open) {
          await chrome.sidePanel.open({ tabId: currentTab.id });
        }
      } catch (err) {
        console.warn('[AI Multi Ask] Command side panel open warning:', err);
      }
    }
  });
}

/**
 * 判断 URL 是否属于特定 Provider
 */
function matchProvider(url, providerKey) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const fullUrl = url.toLowerCase();
    const config = PROVIDER_CONFIGS[providerKey];
    if (!config) return false;

    return config.matchPatterns.some((pattern) => {
      if (pattern.includes('/')) {
        return fullUrl.includes(pattern);
      }
      return host === pattern || host.endsWith('.' + pattern);
    });
  } catch {
    return false;
  }
}

/**
 * 确保目标标签页已注入 Content Script
 */
async function ensureContentScriptInjected(tabId) {
  if (!tabId || !chrome.scripting) return false;

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'AI_MULTI_ASK_PING' }, async (response) => {
      if (!chrome.runtime.lastError && response && response.pong) {
        resolve(true);
      } else {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: CONTENT_SCRIPT_FILES
          });
          setTimeout(() => resolve(true), 150);
        } catch (err) {
          console.warn(`[AI Multi Ask] Failed to inject content script into tab ${tabId}:`, err);
          resolve(false);
        }
      }
    });
  });
}

/**
 * 智能查询当前所有打开的 Provider 对应 Tab
 */
async function getProviderTabs() {
  const currentWindow = await chrome.windows.getCurrent().catch(() => null);
  const currentWindowId = currentWindow ? currentWindow.id : null;
  const allTabs = await chrome.tabs.query({});

  let geminiAccountIndex = '1';
  try {
    const saved = await new Promise((resolve) => {
      chrome.storage.local.get(['ai_multi_ask_settings'], (res) => {
        resolve(res && res.ai_multi_ask_settings ? res.ai_multi_ask_settings : null);
      });
    });
    if (saved && saved.geminiAccountIndex) {
      geminiAccountIndex = saved.geminiAccountIndex;
    }
  } catch (e) {}

  // 优先级排序：未休眠 > 账号偏好匹配 > 当前窗口 > 活跃标签
  allTabs.sort((a, b) => {
    if (!a.discarded && b.discarded) return -1;
    if (a.discarded && !b.discarded) return 1;

    // Gemini 账号偏好优先（例如 u/1 优于 u/0）
    const urlA = a.url || a.pendingUrl || '';
    const urlB = b.url || b.pendingUrl || '';
    const isGemA = matchProvider(urlA, 'gemini');
    const isGemB = matchProvider(urlB, 'gemini');
    if (isGemA && isGemB && geminiAccountIndex && geminiAccountIndex !== 'custom' && geminiAccountIndex !== 'auto') {
      const matchA = urlA.includes(`/u/${geminiAccountIndex}/`);
      const matchB = urlB.includes(`/u/${geminiAccountIndex}/`);
      if (matchA && !matchB) return -1;
      if (matchB && !matchA) return 1;
    }

    if (a.windowId === currentWindowId && b.windowId !== currentWindowId) return -1;
    if (b.windowId === currentWindowId && a.windowId !== currentWindowId) return 1;
    if (a.active && !b.active) return -1;
    if (b.active && !a.active) return 1;
    return 0;
  });

  const result = {
    chatgpt: null,
    gemini: null,
    qwen: null,
    deepseek: null
  };

  for (const tab of allTabs) {
    const targetUrl = tab.url || tab.pendingUrl;
    if (!targetUrl) continue;

    for (const key of Object.keys(PROVIDER_CONFIGS)) {
      if (key==='gemini' && /^\d+$/.test(geminiAccountIndex) && !new URL(targetUrl).pathname.startsWith('/u/'+geminiAccountIndex+'/')) continue;
      if (!result[key] && matchProvider(targetUrl, key)) {
        result[key] = {
          id: tab.id,
          windowId: tab.windowId,
          url: targetUrl,
          title: tab.title,
          status: tab.status,
          discarded: Boolean(tab.discarded)
        };
      }
    }
  }

  for (const key of Object.keys(result)) {
    const tabInfo = result[key];
    if (tabInfo && !tabInfo.discarded && tabInfo.status === 'complete') {
      ensureContentScriptInjected(tabInfo.id);
    }
  }

  return result;
}

// 监听来自 Side Panel 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  const type = message.type;

  if (type === 'AI_MULTI_ASK_GET_PROVIDER_TABS') {
    getProviderTabs().then((tabs) => sendResponse({ success: true, tabs })).catch(err => sendResponse({success:false,error:err.message}));
    return true;
  }

  if (type === 'AI_MULTI_ASK_OPEN_PROVIDER_TAB') {
    const { providerId, url, model } = message;
    let targetUrl = url || (PROVIDER_CONFIGS[providerId] && PROVIDER_CONFIGS[providerId].defaultUrl);

    if (!targetUrl || !matchProvider(targetUrl, providerId) || new URL(targetUrl).protocol !== 'https:') {
      sendResponse({ success: false, error: 'Unknown provider url' });
      return;
    }

    chrome.tabs.create({ url: targetUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({
          success: true,
          tab: {
            id: tab.id,
            url: tab.url || tab.pendingUrl || targetUrl,
            status: tab.status
          }
        });
      }
    });
    return true;
  }

  if (type === 'AI_MULTI_ASK_FOCUS_TAB') {
    const { tabId } = message;
    if (!tabId) {
      sendResponse({ success: false, error: 'tabId is required' });
      return;
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        sendResponse({ success: false, error: 'Tab not found' });
        return;
      }

      chrome.tabs.update(tabId, { active: true }, () => {
        if (tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (type === 'AI_MULTI_ASK_ENSURE_SCRIPT') {
    ensureContentScriptInjected(message.tabId).then((success) => {
      sendResponse({ success });
    });
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = tab.url || tab.pendingUrl;
  chrome.runtime.sendMessage({
    type: 'AI_MULTI_ASK_TAB_UPDATED',
    tabId,
    status: changeInfo.status || tab.status,
    url
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.runtime.sendMessage({
    type: 'AI_MULTI_ASK_TAB_REMOVED',
    tabId
  }).catch(() => {});
});
