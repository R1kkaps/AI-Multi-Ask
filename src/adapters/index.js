/**
 * AI Multi Ask - Adapter Registry & Resolver
 * 
 * 统一注册并暴露所有平台的 Adapter 实例
 */

(function (root) {
  const AIMultiAsk = (root.AIMultiAsk = root.AIMultiAsk || {});

  const registeredAdapters = [
    new AIMultiAsk.ChatGPTAdapter(),
    new AIMultiAsk.GeminiAdapter(),
    new AIMultiAsk.QwenAdapter(),
    new AIMultiAsk.DeepSeekAdapter()
  ];

  /**
   * 获取全部已注册的适配器列表
   */
  function getAllAdapters() {
    return registeredAdapters;
  }

  /**
   * 根据 ID 获取适配器
   * @param {string} id 
   */
  function getAdapterById(id) {
    return registeredAdapters.find((a) => a.id === id) || null;
  }

  /**
   * 根据网页 URL 查找匹配的适配器
   * @param {string} url 
   */
  function findAdapterForUrl(url) {
    if (!url) return null;
    return registeredAdapters.find((a) => a.matchHost(url)) || null;
  }

  AIMultiAsk.registry = {
    getAllAdapters,
    getAdapterById,
    getAdapter: getAdapterById,
    findAdapterForUrl
  };
})(typeof window !== 'undefined' ? window : this);
