# 1.2.0 验证记录

## 已执行

- `node tests/browser.cjs`：已有功能回归，包括发送成功/失败区分、重复注入/请求去重、来源标签页隔离、草稿、导出和代码块。
- `node tests/workflows.cjs`：真实 Edge 浏览器中的模拟网站 DOM，覆盖四种平台适配器的动态模型菜单、禁用选项、切换确认；文件字节传输、MIME/数量限制、重复上传阻止；账号设置迁移；侧栏附件传输；统合原文快照、来源隔离、报告实际下载和本地保存。
- `node tests/extension.cjs`：真实解压缩扩展加载、manifest/service worker、侧栏启动、chrome.storage 持久化，以及模拟两个 Gemini 账号页面的第二账号路由与不回退到第一账号。
- 全部 `src/**/*.js` 通过 `node --check`。

测试脚本默认使用本机 bundled Playwright，可通过 `PLAYWRIGHT_PATH` 指定其他安装路径；需要 Edge 浏览器。测试使用独立环境，不接触用户浏览器登录资料。

## 验证边界

上面的模拟网页用于测试扩展代码的行为，并非线上网站克隆，不能证明线上选择器、上传处理或生成状态识别始终兼容。测试中的模型名称仅是测试数据。

线上验收未完成：浏览器连接工具持续报 `nodeRepl.fetch request failed`，无法访问用户登录后的四个平台。未向线上 AI 发送测试附件或测试消息。重新加载扩展后，可使用“读取实际模型”、切换时的确认提示和各平台附件状态进行当前网页验证。

## 测试产物

- `tests/v12-panel.png`：1.2.0 功能界面测试截图。
- `tests/synthesis-example.md`：由测试回调提供模拟统合回答后导出的报告，用于检查综合结论和原文附录。**这是软件测试样例，不是实际 AI 在线统合结果。**
- `tests/.browser-profile-*/`：每次运行新建的独立测试浏览器资料，避免旧 service worker 缓存干扰验证。
