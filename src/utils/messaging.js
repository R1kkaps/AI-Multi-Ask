/**
 * AI Multi Ask - Unified Messaging Protocol
 * 
 * 职责：
 * 1. 规范跨模块通信消息格式
 * 2. 封装健壮的 Promise 通信方法与错误超时处理
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  const MESSAGE_TYPES = {
    CHECK_STATUS: 'AI_MULTI_ASK_CHECK_STATUS',
    FILL_PROMPT: 'AI_MULTI_ASK_FILL_PROMPT',
    GET_PROVIDER_TABS: 'AI_MULTI_ASK_GET_PROVIDER_TABS',
    OPEN_PROVIDER_TAB: 'AI_MULTI_ASK_OPEN_PROVIDER_TAB',
    FOCUS_TAB: 'AI_MULTI_ASK_FOCUS_TAB'
  };

  /**
   * 安全向指定 Tab 的 Content Script 发送消息
   */
  async function sendToTab(tabId, message, timeoutMs = 4000) {
    return new Promise((resolve) => {
      let isResolved = false;
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          resolve({
            success: false,
            error: 'Tab 响应超时或 Content Script 尚未加载'
          });
        }
      }, timeoutMs);

      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (isResolved) return;
          clearTimeout(timer);
          isResolved = true;

          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message || '无法连接到页面 Content Script'
            });
          } else {
            resolve(response || { success: false, error: '页面未返回处理结果' });
          }
        });
      } catch (err) {
        if (!isResolved) {
          clearTimeout(timer);
          isResolved = true;
          resolve({
            success: false,
            error: err.message || '发送消息异常'
          });
        }
      }
    });
  }

  /**
   * 安全向 Background Service Worker 发送消息
   */
  async function sendToBackground(message, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let isResolved = false;
      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          resolve({
            success: false,
            error: 'Background 响应超时'
          });
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (isResolved) return;
          clearTimeout(timer);
          isResolved = true;

          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message || '后台通信失败'
            });
          } else {
            resolve(response || { success: false, error: '页面未返回处理结果' });
          }
        });
      } catch (err) {
        if (!isResolved) {
          clearTimeout(timer);
          isResolved = true;
          resolve({
            success: false,
            error: err.message || 'Background 通信异常'
          });
        }
      }
    });
  }

  AIMultiAsk.messaging = {
    MESSAGE_TYPES,
    sendToTab,
    sendToBackground
  };
})(typeof window !== 'undefined' ? window : this);
