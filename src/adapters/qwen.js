/**
 * AI Multi Ask - Qwen Chat Adapter (通义千问)
 * 
 * 支持域名：tongyi.aliyun.com, tongyi.ai, chat.qwenlm.ai, qwen.ai, chat.qwen.ai
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  class QwenAdapter extends AIMultiAsk.AIAdapter {
    constructor() {
      super({
        id: 'qwen',
        name: 'Qwen',
        homeUrl: 'https://chat.qwen.ai/',
        hostPatterns: ['tongyi.aliyun.com', 'tongyi.ai', 'chat.qwenlm.ai', 'qwenlm.ai', 'qwen.ai', 'chat.qwen.ai'],
        preferredSelectors: [
          'textarea.message-input-textarea',
          'textarea[placeholder*="Ask"]',
          'textarea[placeholder*="问"]',
          'textarea[placeholder*="输入"]',
          'textarea.ant-input',
          'textarea',
          'div[contenteditable="true"]'
        ],
        fallbackSelectors: [
          '[role="textbox"]'
        ],
        sendButtonSelectors: [
          'button[class*="send"]',
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
        ],
        responseSelectors: [
          '.qwen-bubble-assistant',
          '.chat-message-assistant',
          '.qwen-markdown'
        ],
        generatingSelectors: [
          'button[class*="stop"]',
          '.typing',
          'button[aria-label*="停止"]'
        ]
      });
    }

    detectPageReady(doc = document) {
      const path = (window.location.pathname || '').toLowerCase();
      if (path.includes('/login') || path.includes('/sign')) {
        return { ready: false, reason: '请先登录通义千问账号' };
      }

      return super.detectPageReady(doc);
    }

    /**
     * 切换通义千问模型
     * @param {string} modelId - 如 'qwen-max', 'qwen-plus', 'qwen-turbo'
     */
    async switchModel(modelId, options = {}, doc = document) {
      if (!modelId || modelId === 'default') return true;
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matches = node => normalize(node.innerText || node.textContent || '') === normalize(modelId);
      const button = doc.querySelector('button[class*="model"], div[class*="model-switch"], div[class*="modelSelect"]');
      if (!button) return false;
      if (matches(button)) return true;
      button.click();
      await new Promise(r=>setTimeout(r,300));
      const item = Array.from(doc.querySelectorAll('[role="menuitem"], [role="option"], mat-option, [class*="model-item"]')).filter(AIMultiAsk.dom.isElementUsable).find(matches);
      if (!item) { button.click(); return false; }
      item.click();
      await new Promise(r=>setTimeout(r,300));
      return matches(button);
    }

  }

  AIMultiAsk.QwenAdapter = QwenAdapter;
})(typeof window !== 'undefined' ? window : this);
