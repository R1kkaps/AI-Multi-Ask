/**
 * AI Multi Ask - DeepSeek Adapter
 * 
 * 支持域名：chat.deepseek.com, deepseek.com
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  class DeepSeekAdapter extends AIMultiAsk.AIAdapter {
    constructor() {
      super({
        id: 'deepseek',
        name: 'DeepSeek',
        homeUrl: 'https://chat.deepseek.com/',
        hostPatterns: ['chat.deepseek.com', 'deepseek.com'],
        preferredSelectors: [
          'textarea',
          'div[class*="textarea"] textarea',
          'textarea#chat-input',
          '#chat-input',
          'div[contenteditable="true"]'
        ],
        fallbackSelectors: [
          '[role="textbox"]'
        ],
        sendButtonSelectors: [
          'button[aria-label*="发送"]',
          'button[aria-label*="Send"]',
        ],
        responseSelectors: [
          '.ds-markdown',
          'div[class*="chat-message"][data-role="assistant"]',
        ],
        generatingSelectors: [
          'button[aria-label*="停止"]',
          'button[aria-label*="Stop"]',
          '.ds-icon-button svg rect',
        ]
      });
    }

    detectPageReady(doc = document) {
      const path = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      if (path.includes('/login') || path.includes('/sign') || href.includes('sign_in')) {
        return { ready: false, reason: '请先登录 DeepSeek 账号' };
      }

      return super.detectPageReady(doc);
    }

    /**
     * DeepSeek 模型与功能开关切换
     * @param {string} modelId - 'default' / 'deepseek-chat' (V3) 或 'deepseek-reasoner' (R1 深度思考)
     * @param {object} options - { search: boolean }
     */
    async switchModel(modelId, options = {}, doc = document) {
      const isTargetR1 = typeof options.r1 === 'boolean' ? options.r1 : (modelId === 'deepseek-reasoner');
      const targetSearch = Boolean(options.search);

      const findToggle = (keywords) => {
        const buttons = Array.from(doc.querySelectorAll('button, div[role="button"], div[class*="ds-switch"], div[class*="switch"], span[class*="button"]'));
        return buttons.filter(AIMultiAsk.dom.isElementUsable).find((btn) => {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          return keywords.some((kw) => text.includes(kw) || aria.includes(kw));
        });
      };

      const isToggleActive = (btn) => {
        if (!btn) return false;
        const cls = String(btn.className || '');
        const ariaChecked = btn.getAttribute('aria-checked') ?? btn.getAttribute('aria-pressed');
        if (ariaChecked === 'true') return true;
        if (ariaChecked === 'false') return false;
        if (/(^|[\s_-])(checked|active|selected)([\s_-]|$)/.test(cls)) return true;
        const innerActive = btn.querySelector('[class*="checked"], [class*="active"], [aria-checked="true"]');
        if (innerActive) return true;
        return false;
      };

      // 1. 处理「深度思考 (R1)」开关
      const r1Btn = findToggle(['深度思考', 'deepthink', 'r1']);
      if (!r1Btn && isTargetR1) return false;
      if (r1Btn) {
        const currentR1Active = isToggleActive(r1Btn);
        if (isTargetR1 && !currentR1Active) {
          this.logDebug('Activating DeepSeek R1 (深度思考)...');
          r1Btn.click();
          await new Promise((r) => setTimeout(r, 100));
        } else if (!isTargetR1 && currentR1Active && modelId) {
          this.logDebug('Deactivating DeepSeek R1 (使用 V3 标准)...');
          r1Btn.click();
          await new Promise((r) => setTimeout(r, 100));
        }
        if (isToggleActive(r1Btn) !== isTargetR1) return false;
      }

      // 2. 处理「联网搜索」开关
      if (typeof options.search === 'boolean') {
        const searchBtn = findToggle(['联网搜索', 'web search', 'search']);
        if (!searchBtn && targetSearch) return false;
        if (searchBtn) {
          const currentSearchActive = isToggleActive(searchBtn);
          if (targetSearch && !currentSearchActive) {
            this.logDebug('Activating DeepSeek 联网搜索...');
            searchBtn.click();
            await new Promise((r) => setTimeout(r, 100));
          } else if (!targetSearch && currentSearchActive) {
            this.logDebug('Deactivating DeepSeek 联网搜索...');
            searchBtn.click();
            await new Promise((r) => setTimeout(r, 100));
          }
          if (isToggleActive(searchBtn) !== targetSearch) return false;
        }
      }

      return true;
    }
  }

  AIMultiAsk.DeepSeekAdapter = DeepSeekAdapter;
})(typeof window !== 'undefined' ? window : this);
