/**
 * AI Multi Ask - DOM Utilities & Smart Input Detector
 * 
 * 核心功能：
 * 1. 智能定位各 AI 输入框与发送按钮
 * 2. 派发原生按键事件 (Enter) 与受控写入
 * 3. 提取 AI 回复文本与轻量 Markdown 格式化渲染
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  const logger = {
    log(...args) {
      console.log('[AI Multi Ask]', ...args);
    },
    warn(...args) {
      console.warn('[AI Multi Ask]', ...args);
    },
    error(...args) {
      console.error('[AI Multi Ask]', ...args);
    }
  };

  /**
   * 检查元素是否真实可用（非 display:none，非透明度为0的隐藏元素）
   */
  function isElementUsable(el) {
    if (!el || el.nodeType !== 1) return false;

    if (el.closest('[hidden], [inert]') || el.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    if (style.opacity === '0' || parseFloat(style.opacity) < 0.01) {
      return false;
    }

    if (style.position === 'fixed' && (parseInt(style.top, 10) < -100 || parseInt(style.left, 10) < -100)) {
      return false;
    }

    return true;
  }

  /**
   * 启发式评分：当页面存在多个候选可编辑元素时，挑选最符合主聊天输入框的一个
   */
  function scoreEditableElement(el) {
    let score = 10;
    const tagName = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
    const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

    if (id.includes('prompt-textarea') || id.includes('chat-input')) {
      score += 100;
    }

    const promptKeywords = [
      'prompt', 'message', 'ask', 'chat', 'send', '输入', '提问', '发消息', '发送',
      'deepseek', 'chatgpt', 'gemini', '通义', '千问', 'qwen', '想问什么', '聊聊'
    ];
    for (const kw of promptKeywords) {
      if (placeholder.includes(kw) || ariaLabel.includes(kw)) {
        score += 50;
        break;
      }
    }

    if (
      className.includes('prosemirror') ||
      className.includes('ql-editor') ||
      className.includes('editor') ||
      className.includes('chat') ||
      className.includes('textarea') ||
      className.includes('prompt')
    ) {
      score += 30;
    }

    if (tagName === 'textarea') {
      score += 30;
    } else if (isContentEditable || role === 'textbox') {
      score += 30;
    }

    if (!el.closest('header, nav, [role="navigation"]')) {
      score += 20;
    }

    return score;
  }

  /**
   * 智能定位最佳可编辑输入框
   */
  function findBestEditableElement(rootNode = document, preferredSelectors = []) {
    for (const selector of preferredSelectors) {
      try {
        const candidates = rootNode.querySelectorAll(selector);
        for (const el of candidates) {
          if (isElementUsable(el) && !el.disabled && !el.readOnly && el.getAttribute('aria-disabled') !== 'true') {
            logger.log(`Found input via selector "${selector}":`, el);
            return el;
          }
        }
      } catch (e) {
        logger.warn(`Selector error for "${selector}":`, e);
      }
    }

    const query = [
      'textarea',
      'div[contenteditable="true"]',
      'div[contenteditable=""]',
      '.ql-editor',
      '.ProseMirror',
      '[role="textbox"]'
    ].join(', ');

    const allCandidates = Array.from(rootNode.querySelectorAll(query)).filter(el=>isElementUsable(el) && !el.disabled && !el.readOnly);

    if (allCandidates.length === 1) {
      return allCandidates[0];
    }

    if (allCandidates.length > 1) {
      const mainCandidates = allCandidates.filter((el) => {
        return !el.closest('header, nav, [role="navigation"]');
      });

      const listToPick = mainCandidates.length > 0 ? mainCandidates : allCandidates;
      listToPick.sort((a, b) => scoreEditableElement(b) - scoreEditableElement(a));
      return listToPick[0];
    }

    return null;
  }

  /**
   * 为 textarea / input 写入受控值（兼容 React/Vue）
   */
  function setNativeValue(el, value) {
    const isTextarea = el instanceof HTMLTextAreaElement || el.tagName.toLowerCase() === 'textarea';
    const prototype = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  /**
   * 为 contenteditable / ProseMirror 富文本编辑器填入文本
   */
  function fillContentEditable(el, text, mode = 'replace') {
    el.focus();

    const selection = window.getSelection();
    if (!selection) return false;

    const range = document.createRange();

    if (mode === 'replace') {
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, text);
      } catch (err) {
        logger.warn('execCommand error:', err);
      }

      if (!inserted) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      }
    } else {
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      const textToInsert = (el.textContent && el.textContent.trim().length > 0 ? '\n\n' : '') + text;
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, textToInsert);
      } catch (err) {
        logger.warn('execCommand append error:', err);
      }

      if (!inserted) {
        el.textContent = (el.textContent ? el.textContent + '\n\n' : '') + text;
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: textToInsert
        }));
      }
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return true;
  }

  /**
   * 通用填入入口
   */
  function fillEditableElement(el, text, mode = 'replace') {
    if (!el) return false;

    const isTextarea = el instanceof HTMLTextAreaElement || el.tagName.toLowerCase() === 'textarea';
    const isInput = el instanceof HTMLInputElement || el.tagName.toLowerCase() === 'input';

    if (isTextarea || isInput) {
      let finalVal = text;
      if (mode === 'append' && el.value && el.value.trim().length > 0) {
        finalVal = el.value + '\n\n' + text;
      }
      setNativeValue(el, finalVal);
      el.focus();
      if (typeof el.setSelectionRange === 'function') {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
      return true;
    }

    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
      const result = fillContentEditable(el, text, mode);
      el.focus();
      return result;
    }

    el.innerText = text;
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return true;
  }

  /**
   * 向输入元素模拟派发 Enter 回车键 (提交 Prompt)
   */
  function dispatchEnterKey(el) {
    if (!el) return false;
    try {
      el.focus();
      const eventInit = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true
      };
      el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      el.dispatchEvent(new KeyboardEvent('keypress', eventInit));
      el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      return true;
    } catch (err) {
      logger.warn('dispatchEnterKey failed:', err);
      return false;
    }
  }

  /**
   * 从 DOM 节点中提取干净纯净的回答正文（过滤复制按钮、操作图标等干扰物）
   */
  function extractCleanText(node) {
    if (!node) return '';
    try {
      const clone = node.cloneNode(true);
      const distractors = clone.querySelectorAll(
        'button, svg, [role="button"], .copy-button, .action-buttons, .cursor, .ds-icon-button'
      );
      distractors.forEach((d) => d.remove());
      clone.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
      clone.querySelectorAll('p, div, li, pre, h1, h2, h3, h4, tr').forEach(el => el.append('\n'));
      return (clone.textContent || '').trim();
    } catch {
      return (node.innerText || node.textContent || '').trim();
    }
  }

  /**
   * 轻量级安全的 Markdown 格式化渲染器（支持代码块、行内代码、粗体、分段）
   */
  function formatMarkdownToHtml(markdown = '') {
    if (!markdown) return '';

    const escape = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const inline = text => text.split(/(`[^`]+`)/g).map(chunk => {
      if(chunk.startsWith('`') && chunk.endsWith('`')) return '<code class="inline-code">'+escape(chunk.slice(1,-1))+'</code>';
      return escape(chunk).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
    }).join('');
    // Parse fenced blocks separately so inline markup never rewrites code.
    return markdown.split(/(```[\s\S]*?```)/g).map(part => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const body=part.slice(3,-3), newline=body.indexOf('\n');
        const code=newline < 0 ? body : body.slice(newline+1);
        return '<pre><code>'+escape(code)+'</code></pre>';
      }
      return part.split(/\n\n+/).filter(Boolean).map(p => {
        const lines=p.trim().split('\n'), heading=lines[0].match(/^(#{1,4})\s+(.+)$/);
        if(heading) return '<h'+heading[1].length+'>'+inline(heading[2])+'</h'+heading[1].length+'>'+(lines.length>1?'<p>'+inline(lines.slice(1).join('\n'))+'</p>':'');
        return '<p>'+inline(p)+'</p>';
      }).join('');
    }).join('');

  }

  AIMultiAsk.dom = {
    logger,
    isElementUsable,
    findBestEditableElement,
    setNativeValue,
    fillContentEditable,
    fillEditableElement,
    dispatchEnterKey,
    extractCleanText,
    formatMarkdownToHtml
  };
})(typeof window !== 'undefined' ? window : this);
