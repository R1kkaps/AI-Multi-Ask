/**
 * AI Multi Ask - Storage Manager
 * 
 * 职责：
 * 1. 管理用户历史 Prompt（最多 30 条，去重保鲜）
 * 2. 管理 Prompt 预设模板（增删改查）
 * 3. 持久化用户的配置偏好（写入模式、选中的 AI、独立后缀、Debug 开关）
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  const STORAGE_KEYS = {
    SETTINGS: 'ai_multi_ask_settings',
    HISTORY: 'ai_multi_ask_history',
    PRESETS: 'ai_multi_ask_presets'
  };

  const DEFAULT_SETTINGS = {
    fillMode: 'replace', // 'replace' | 'append'
    autoSend: true,
    responseViewMode: 'tabs',
    geminiAccountIndex: '1', // 默认使用第 2 个 Google 账号 (u/1)
    geminiCustomUrl: '',
    selectedProviders: ['chatgpt', 'gemini', 'qwen', 'deepseek'],
    providerModels: {
      chatgpt: 'default',
      gemini: 'default',
      qwen: 'default'
    },
    deepseekR1: false,
    deepseekSearch: false,
    providerSuffixes: {
      chatgpt: '',
      gemini: '',
      qwen: '',
      deepseek: ''
    },
    debugMode: false
  };

  const DEFAULT_PRESETS = [
    {
      id: 'preset_programming',
      title: '编程与架构',
      content: '你是一位资深全栈工程师与系统架构师。请以严谨、现代且易维护的代码风格回答以下问题，并提供清晰的思路解释、边缘情况处理与完整的代码示例：\n\n'
    },
    {
      id: 'preset_translation',
      title: '中英精准翻译',
      content: '请将以下内容翻译为地道、准确、符合语境的目标语言（中文译为英文，外文译为中文）。请保持原始排版，并在必要时给出关键术语的解析：\n\n'
    },
    {
      id: 'preset_research',
      title: '深度研究分析',
      content: '请针对以下课题进行客观、详实且多视角的分析。梳理核心论点、论据支持，并提出至少 2 个反向质疑或深层延伸思考：\n\n'
    },
    {
      id: 'preset_summary',
      title: '要点极简提炼',
      content: '请阅读以下内容，以清晰的 Bullet Points 提炼其核心结论、关键数字与行动建议，避免冗余修饰：\n\n'
    }
  ];

  const MAX_HISTORY_COUNT = 30;

  /**
   * 读取存储辅助函数
   */
  async function getFromStorage(key, defaultValue) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve(defaultValue);
        return;
      }
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          console.error('[AI Multi Ask] Storage get error:', chrome.runtime.lastError);
          resolve(defaultValue);
        } else {
          resolve(result[key] !== undefined ? result[key] : defaultValue);
        }
      });
    });
  }

  /**
   * 写入存储辅助函数
   */
  async function setInStorage(key, value) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.error('[AI Multi Ask] Storage set error:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * 设置相关 API
   */
  async function loadSettings() {
    const saved = await getFromStorage(STORAGE_KEYS.SETTINGS, {});
    if (saved.schemaVersion !== 2) {
      saved.geminiAccountIndex='1'; saved.schemaVersion=2;
      saved.providerModels={chatgpt:'default',gemini:'default',qwen:'default',deepseek:'default'};
      await setInStorage(STORAGE_KEYS.SETTINGS,saved);
    }
    return { ...DEFAULT_SETTINGS, ...saved,
      providerModels: {...DEFAULT_SETTINGS.providerModels, ...saved.providerModels},
      providerSuffixes: {...DEFAULT_SETTINGS.providerSuffixes, ...saved.providerSuffixes}
    };
  }

  let saveSettingsQueue = Promise.resolve();
  async function saveSettings(settings) {
    return new Promise((resolve, reject) => {
      saveSettingsQueue = saveSettingsQueue.then(async () => {
        try {
          const current = await loadSettings();
          const updated = { ...current, ...settings };
          await setInStorage(STORAGE_KEYS.SETTINGS, updated);
          resolve(updated);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /**
   * 历史记录相关 API (最多 30 条)
   */
  async function loadHistory() {
    return await getFromStorage(STORAGE_KEYS.HISTORY, []);
  }

  async function addHistoryItem(promptText) {
    if (!promptText || !promptText.trim()) return;
    const text = promptText.trim();
    const history = await loadHistory();

    // 去重并排在第一位
    const filtered = history.filter((item) => item.text !== text);
    filtered.unshift({
      id: 'hist_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      text: text,
      timestamp: Date.now()
    });

    // 截断至最多 30 条
    const limited = filtered.slice(0, MAX_HISTORY_COUNT);
    await setInStorage(STORAGE_KEYS.HISTORY, limited);
    return limited;
  }

  async function deleteHistoryItem(id) {
    const history = await loadHistory();
    const filtered = history.filter((item) => item.id !== id);
    await setInStorage(STORAGE_KEYS.HISTORY, filtered);
    return filtered;
  }

  async function clearHistory() {
    await setInStorage(STORAGE_KEYS.HISTORY, []);
    return [];
  }

  /**
   * 预设模板相关 API
   */
  async function loadPresets() {
    const presets = await getFromStorage(STORAGE_KEYS.PRESETS, null);
    if (!presets || !Array.isArray(presets)) {
      await setInStorage(STORAGE_KEYS.PRESETS, DEFAULT_PRESETS);
      return DEFAULT_PRESETS;
    }
    return presets;
  }

  async function savePreset(preset) {
    const presets = await loadPresets();
    const existingIndex = presets.findIndex((p) => p.id === preset.id);

    if (existingIndex >= 0) {
      presets[existingIndex] = { ...presets[existingIndex], ...preset };
    } else {
      presets.push({
        id: preset.id || 'preset_' + Date.now(),
        title: preset.title || '未命名预设',
        content: preset.content || ''
      });
    }

    await setInStorage(STORAGE_KEYS.PRESETS, presets);
    return presets;
  }

  async function deletePreset(id) {
    const presets = await loadPresets();
    const filtered = presets.filter((p) => p.id !== id);
    await setInStorage(STORAGE_KEYS.PRESETS, filtered);
    return filtered;
  }

  async function resetPresets() {
    await setInStorage(STORAGE_KEYS.PRESETS, DEFAULT_PRESETS);
    return DEFAULT_PRESETS;
  }

  AIMultiAsk.storage = {
    DEFAULT_SETTINGS,
    DEFAULT_PRESETS,
    loadSettings,
    saveSettings,
    loadHistory,
    addHistoryItem,
    deleteHistoryItem,
    clearHistory,
    loadPresets,
    savePreset,
    deletePreset,
    resetPresets
  };
})(typeof window !== 'undefined' ? window : this);
