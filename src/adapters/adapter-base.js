/**
 * AI Multi Ask - AIAdapter Base Class
 * 
 * 扩展支持：
 * 1. 触发一键自动发送 (sendPrompt)
 * 2. 实时定位最新 AI 回复容器 (getLatestResponseElement)
 * 3. 实时感知生成状态 (isGenerating)
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  class AIAdapter {
    constructor(options = {}) {
      this.id = options.id || 'base';
      this.name = options.name || 'Base AI';
      this.homeUrl = options.homeUrl || '';
      this.hostPatterns = options.hostPatterns || [];
      this.preferredSelectors = options.preferredSelectors || [];
      this.fallbackSelectors = options.fallbackSelectors || [];
      this.sendButtonSelectors = options.sendButtonSelectors || [];
      this.responseSelectors = options.responseSelectors || [];
      this.generatingSelectors = options.generatingSelectors || [];
    }

    matchHost(url) {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        return this.hostPatterns.some((pattern) => {
          if (pattern.startsWith('*.')) {
            const rootDomain = pattern.slice(2);
            return host === rootDomain || host.endsWith('.' + rootDomain);
          }
          return host === pattern || host.endsWith('.' + pattern);
        });
      } catch {
        return false;
      }
    }

    detectPageReady(doc = document) {
      if (doc.readyState === 'loading') {
        return { ready: false, reason: '页面正在加载中...' };
      }

      const input = this.findInput(doc);
      if (input) {
        return { ready: true };
      }

      const title = (doc.title || '').toLowerCase();
      const path = (window.location.pathname || '').toLowerCase();
      const href = (window.location.href || '').toLowerCase();
      
      if (
        path.includes('/login') ||
        path.includes('/sign_in') ||
        path.includes('/signin') ||
        path.includes('/auth') ||
        href.includes('sign_in') ||
        href.includes('login') ||
        title.includes('log in') ||
        title.includes('sign in') ||
        title.includes('登录')
      ) {
        return { ready: false, reason: `请先登录 ${this.name} 账号` };
      }

      return { ready: false, reason: '未找到输入框' };
    }

    findInput(doc = document) {
      const allSelectors = [...this.preferredSelectors, ...this.fallbackSelectors];
      const found = AIMultiAsk.dom.findBestEditableElement(doc, allSelectors);

      if (!found) {
        this.logDebug('Input element not found. Attempted selectors:', allSelectors);
      }
      return found;
    }

    async fillPrompt(inputEl, text, mode = 'replace') {
      if (!inputEl) {
        throw new Error('Input element is null or undefined');
      }

      const success = AIMultiAsk.dom.fillEditableElement(inputEl, text, mode);
      if (success) {
        this.focusInput(inputEl);
      }
      return success;
    }

    focusInput(inputEl) {
      if (!inputEl) return;
      try {
        inputEl.focus();
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        AIMultiAsk.dom.logger.warn(`Failed to focus input for ${this.name}:`, err);
      }
    }

    /**
     * 定位发送按钮
     */
    findSendButton(doc = document, inputEl = null) {
      // 1. 尝试配置的选择器
      for (const sel of this.sendButtonSelectors) {
        try {
          const btns = Array.from(doc.querySelectorAll(sel)).filter(AIMultiAsk.dom.isElementUsable);
          const activeBtn = btns.find((b) => !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true');
          if (activeBtn) return activeBtn;
          
        } catch (e) {
          // ignore selector error
        }
      }

      // 2. 检查输入框容器内的按钮
      if (inputEl) {
        const container = inputEl.closest('form, div[class*="input"], div[class*="chat"]') || inputEl.parentElement;
        if (container) {
          const btns = Array.from(container.querySelectorAll('button, div[role="button"]')).filter(AIMultiAsk.dom.isElementUsable);
          const sendBtn = btns.find((b) => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.innerText || '').toLowerCase();
            return aria.includes('send') || aria.includes('发送') || text.includes('发送') || text.includes('send');
          });
          if (sendBtn) return sendBtn;
          // 若容器内仅有 1 个按钮，通常就是发送按钮
          
        }
      }

      return null;
    }

    /**
     * 触发 Prompt 发送
     */
    async sendPrompt(inputEl, doc = document) {
      if (!inputEl) {
        throw new Error('Input element is null');
      }

      if (this.isGenerating(doc)) throw new Error('该平台仍在生成，请等待结束');
      this.focusInput(inputEl);
      const previous = this.getLatestResponseElement(doc);
      let clicked = false;
      for (let i = 0; i < 12; i++) {
        const btn = this.findSendButton(doc, inputEl);
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          btn.click(); clicked = true; break;
        }
        await new Promise(r => setTimeout(r, 150));
      }
      if (!clicked) AIMultiAsk.dom.dispatchEnterKey(inputEl);
      // Synthetic key dispatch / click alone is not proof of submission.
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 150));
        const currentInput = this.findInput(doc);
        const value = currentInput ? (currentInput.value ?? currentInput.innerText ?? currentInput.textContent ?? '') : 'pending';
        if (this.isGenerating(doc) || (currentInput && !value.trim()) ||
            (this.getLatestResponseElement(doc) && this.getLatestResponseElement(doc) !== previous)) return true;
      }
      throw new Error('已填入，但无法确认发送；请到网页检查，避免重复发送');
    }

    /**
     * 获取页面上最新的 AI 回复容器节点
     */
    getLatestResponseElement(doc = document) {
      for (const sel of this.responseSelectors) {
        try {
          const els = Array.from(doc.querySelectorAll(sel)).filter(AIMultiAsk.dom.isElementUsable);
          if (els.length > 0) {
            return els[els.length - 1];
          }
        } catch (e) {
          // ignore
        }
      }
      return null;
    }

    /**
     * 检测该平台是否正在流式生成内容
     */
    isGenerating(doc = document) {
      for (const sel of this.generatingSelectors) {
        try {
          const found = Array.from(doc.querySelectorAll(sel)).find(AIMultiAsk.dom.isElementUsable);
          if (found) return true;
        } catch (e) {
          // ignore
        }
      }
      return false;
    }

    /**
     * 提取最新的回答纯文本
     */
    getLatestResponseText(doc = document) {
      const el = this.getLatestResponseElement(doc);
      if (!el) return '';
      return AIMultiAsk.dom.extractCleanText(el);
    }

    /**
     * 切换平台模型（子类可按需覆盖重写）
     * @param {string} modelId - 目标模型标识符 (如 'gpt-4o', 'deepseek-reasoner')
     * @param {object} options - 额外参数 (如 { search: true })
     * @param {Document} doc
     */
    async switchModel(modelId, options = {}, doc = document) {
      if (!modelId || modelId === 'default') {
        return true;
      }
      this.logDebug(`switchModel called with ${modelId}`, options);
      return true;
    }

    logDebug(...args) {
      AIMultiAsk.dom.logger.log(`[Adapter:${this.id}]`, ...args);
    }
  }

  AIMultiAsk.AIAdapter = AIAdapter;
})(typeof window !== 'undefined' ? window : this);
