/**
 * AI Multi Ask - ChatGPT Adapter
 * 
 * 支持域名：chatgpt.com, chat.openai.com
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  class ChatGPTAdapter extends AIMultiAsk.AIAdapter {
    constructor() {
      super({
        id: 'chatgpt',
        name: 'ChatGPT',
        homeUrl: 'https://chatgpt.com/',
        hostPatterns: ['chatgpt.com', 'chat.openai.com'],
        preferredSelectors: [
          '#prompt-textarea',
          'div#prompt-textarea',
          'div[contenteditable="true"]#prompt-textarea',
          'div.ProseMirror#prompt-textarea',
          'div.ProseMirror',
          'div[contenteditable="true"]',
          'textarea#prompt-textarea',
          'textarea'
        ],
        fallbackSelectors: [
          '[role="textbox"]'
        ],
        sendButtonSelectors: [
          'button[data-testid="send-button"]',
          'button[aria-label*="Send"]',
          'button[aria-label*="发送"]',
        ],
        responseSelectors: [
          'div[data-message-author-role="assistant"]',
          'article [data-message-author-role="assistant"]',
          '.agent-turn .markdown',
        ],
        generatingSelectors: [
          'button[data-testid="stop-button"]',
          'button[aria-label*="Stop"]',
          'button[aria-label*="停止"]',
          '.result-streaming'
        ]
      });
    }

    detectPageReady(doc = document) {
      const title = (doc.title || '').toLowerCase();
      const path = (window.location.pathname || '').toLowerCase();
      
      if (title.includes('just a moment') || title.includes('cloudflare')) {
        return { ready: false, reason: '正在进行 Cloudflare 安全检查' };
      }
      if (path.includes('/auth') || title.includes('log in') || title.includes('sign in')) {
        return { ready: false, reason: '请先登录 ChatGPT 账号' };
      }

      return super.detectPageReady(doc);
    }

    /**
     * 切换 ChatGPT 模型
     * @param {string} modelId - 如 'gpt-4o', 'gpt-4o-mini', 'o1', 'o3-mini'
     */
    async switchModel(modelId, options = {}, doc = document) {
      if (!modelId || modelId === 'default') return true;
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matches = node => normalize(node.innerText || node.textContent || '') === normalize(modelId);
      const button = doc.querySelector('button[data-testid="model-switcher-dropdown-button"]');
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

  AIMultiAsk.ChatGPTAdapter = ChatGPTAdapter;
})(typeof window !== 'undefined' ? window : this);
