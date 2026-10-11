# AI 配置搜索入口

Launcher 新增唯一固定的「AI 设置 / AI settings」宿主动作，使用既有固定动作别名匹配。支持 ChatGPT、AI settings、settings ai、AI 设置、人工智能设置等查询；查询 AI 时也可发现入口，同等匹配下普通 AI 工具优先。

入口通过受限的 `system-ai-settings` 路由打开既有 SystemSettingsSurface 的 AI 页签。复用原返回处理，不清空查询或重新创建搜索会话；插件内打开 AI 设置的草稿会话协议不变。

此入口仅索引公开固定名称，不读取账号、凭证、配置值或用户文本，不扩展插件字段索引，也不增加插件权限。

验证采用真实 registry/ranker/bridge 逻辑与隔离 profile 原生交互；不请求模型，不修改账号或设置。

本次 Linux X11 原生验收：五种中英文查询均直达 AI services，Escape 保留查询、选中项和输入焦点；AI 查询下 AI Summary 在前，选中第二项配置入口并往返仍保留第二项选择；AI Summary 的合成草稿经配置页往返完整保留。中文查询通过真实剪贴板粘贴输入，未覆盖中文 IME 组词上屏或中文显示语言。未覆盖 macOS、Windows、Wayland。
