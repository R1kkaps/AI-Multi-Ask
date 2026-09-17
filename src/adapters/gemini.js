/**
 * AI Multi Ask - Google Gemini Adapter
 * 
 * 支持域名：gemini.google.com
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  class GeminiAdapter extends AIMultiAsk.AIAdapter {
    constructor() {
      super({
        id: 'gemini',
        name: 'Gemini',
        homeUrl: 'https://gemini.google.com/app',
        hostPatterns: ['gemini.google.com'],
        preferredSelectors: [
          'rich-textarea .ql-editor',
          'rich-textarea div[contenteditable="true"]',
          '.ql-editor',
          'div[contenteditable="true"][role="textbox"]',
          'div[contenteditable="true"]',
          'rich-textarea textarea',
          'textarea'
        ],
        fallbackSelectors: [
          '[role="textbox"]'
        ],
        sendButtonSelectors: [
          'button.send-button',
          'button[aria-label*="Send"]',
          'button[aria-label*="发送"]',
          'button.mat-mdc-tooltip-trigger[aria-label*="Send"]',
        ],
        responseSelectors: [
          'model-response',
          '.response-container-content',
          '.model-response-text'
        ],
        generatingSelectors: [
          'button[aria-label*="Stop"]',
          'button[aria-label*="停止"]',
          '.generating-animation',
          'mat-progress-bar'
        ]
      });
    }

    matchHost(url) {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return host === 'gemini.google.com';
      } catch {
        return false;
      }
    }

    detectPageReady(doc = document) {
      const title = (doc.title || '').toLowerCase();
      const path = (window.location.pathname || '').toLowerCase();
      
      if (title.includes('sign in') || path.includes('/signin') || path.includes('/accounts')) {
        return { ready: false, reason: '请先登录 Google 账号' };
      }

      if (this.isRegionBlocked(doc)) {
        return { ready: false, reason: '当前 Google 账号地区不可用，请在网页检查账号' };
      }

      return super.detectPageReady(doc);
    }

    isRegionBlocked(doc = document) {
      try {
        const bodyText = (doc.body ? doc.body.innerText || doc.body.textContent || '' : '').toLowerCase();
        if (!bodyText) return false;

        const blockKeywords = [
          "isn't currently supported in your country",
          "isn't supported in your country",
          "not supported in your country",
          "not available in your country",
          "is not currently available in your country",
          "此国家/地区尚不支持",
          "不支持你所在的国家",
          "你所在的国家/地区目前不支持",
          "不受支持的国家/地区",
          "暂未在您所在的国家/地区推出",
          "尚未在你所在的国家/地区推出"
        ];

        return blockKeywords.some((kw) => bodyText.includes(kw.toLowerCase()));
      } catch {
        return false;
      }
    }

    findInput(doc = document) {
      const richTextareas = doc.querySelectorAll('rich-textarea');
      for (const rt of richTextareas) {
        if (rt.shadowRoot) {
          const shadowEl = rt.shadowRoot.querySelector('.ql-editor, [contenteditable="true"], textarea');
          if (shadowEl && AIMultiAsk.dom.isElementUsable(shadowEl)) return shadowEl;
        }
        const innerEl = rt.querySelector('.ql-editor, [contenteditable="true"], textarea');
        if (innerEl && AIMultiAsk.dom.isElementUsable(innerEl)) return innerEl;
      }

      const ql = doc.querySelector('.ql-editor, div[contenteditable="true"][role="textbox"], div[contenteditable="true"]');
      if (ql && AIMultiAsk.dom.isElementUsable(ql)) return ql;

      return super.findInput(doc);
    }

    /**
     * 切换 Google Gemini 模型
     * @param {string} modelId - 如 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
     */
    async switchModel(modelId, options = {}, doc = document) {
      if (!modelId || modelId === 'default') return true;
      const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matches = node => normalize(node.innerText || node.textContent || '') === normalize(modelId);
      const button = doc.querySelector('button[aria-label*="Model"], button[aria-label*="模型"], .model-selector button');
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

  AIMultiAsk.GeminiAdapter = GeminiAdapter;
})(typeof window !== 'undefined' ? window : this);
