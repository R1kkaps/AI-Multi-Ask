# 模型核对记录（2026-09-12）

不把 API 模型名或公开产品名直接当成用户网页可选项。账号、套餐、地区和灰度发布都可能使实际界面不同，因此 1.2.0 使用网页菜单读取 + 切换结果确认。

| 平台 | 官方资料核对 | 扩展处理 |
| --- | --- | --- |
| ChatGPT | 当前说明涵盖 GPT-5.6 和 GPT-6 Pro，以及 Instant、Medium、High、Extra High、Pro 等按套餐开放的选择。 | 读取当前菜单/单选控件的实际文字，不继续提供旧 GPT-4o、o1 等固定选项。纯滑块界面没有可读选项时不猜测。 |
| Gemini | 官方网页说明列出 Flash-Lite、Flash、Pro，模型切换入口位于输入区域。 | 使用真实菜单文字，包括地区语言差异；默认第二个账号。 |
| DeepSeek | 9 月 10 日公告已发布 V4.1-Flash，API 产品代际和此前 V4 不同。公告不能证明某个账号网页一定有对应模型按钮。 | 移除旧 R1/V3 API 名映射；读取网页模型/模式及具有状态属性的思考、搜索开关。 |
| Qwen | 官方聊天页为动态页面，当前抓取没有给出可验证的登录后模型清单。 | 不填入未经证实的所谓最新模型名；从登录后的网页实际读取。 |

来源：[ChatGPT 官方说明](https://help.openai.com/en/articles/20001354)、[Gemini 官方帮助](https://support.google.com/gemini/answer/13275745?hl=en)、[DeepSeek V4.1 公告](https://deepseek.com/en/news/deepseek-v4-1-flash/)、[Qwen 官方聊天页](https://chat.qwen.ai/)。

本次用户浏览器连接三次返回 `nodeRepl.fetch request failed`，没有访问登录后的真实菜单。因此代码具备在线读取和切换确认流程，但不能声称四个平台已完成用户账号下的线上实测。
