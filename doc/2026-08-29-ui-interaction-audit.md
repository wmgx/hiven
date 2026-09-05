# hiven UI / 交互审计（2026-08-29）

## 范围与口径

- 环境：中文、亮色主题、正常桌面窗口、100% 缩放优先。
- 范围：Global Launcher、编辑器内 Launcher、全部 first-party 插件。
- 重点：参数与 choices、quick run、输出路径、IME、错误态、权限态、焦点、动效和窗口边界。
- 小窗口只要求不崩溃，不作为本轮视觉优化目标。
- 插件产品语义保留在插件侧；framework 只提供公共 primitive 和宿主能力。

## 总体结论

主要流程已经统一到同一套 Launcher 语义：命令选择、参数收集、choices、即时预览、错误出口和输出去向共享 controller；Global Launcher 与编辑器 Launcher 的输入来源、输出写回和窗口行为仍保持分离。Quick Editor 现在也通过公共 `PanelInstanceV2` 契约承载 pane-bottom 插件面板，不复制插件产品语义。

动效采用短促反馈：普通 hover / selection 为 100–140ms，抽屉进入为 180ms；仅对背景、颜色、阴影、透明度和 transform 做动画。全局 `prefers-reduced-motion` 会关闭非必要动画。

## Launcher Review

| 项目 | 结论 | 证据 |
|---|---|---|
| 共享语义 | Global 与编辑器入口复用 launcher item / controller、参数、choices 和错误模型 | `test-app-launcher-contract`、`test-global-launcher-v3-ui` |
| I/O 边界 | Global 默认复制/粘贴到前台/带回 Launcher；编辑器默认写当前 pane | `test-quick-editor-launcher-behavior`、`test-workspace-public-api-window-boundary` |
| 窗口边界 | Global 打开/关闭不恢复或激活主窗口；插件和 Pinned Runner 不打开编辑器命令面板 | `test-effect-runner-window-boundary`、`test-global-pinned-launcher` |
| 参数与 choices | 统一 collect-input/controller；关键分支要求明确选择 | 浏览器 DOM、`test-command-optional-params` |
| quick run | Random 等无输入命令直接执行；Base64、Diff 等关键分支不误 quick run | 浏览器 DOM、`test-random-and-variable-case-plugins` |
| IME | composition Enter 只上屏，不触发确认 | `test-ime-enter-confirmation` |
| 错误态 | 共享错误出口为 `role="alert"`，不把失败结果伪装为成功预览 | 浏览器 DOM、插件契约测试 |

## 逐插件 Review

| 插件 | 健康度 | 主流程与问题 | 本轮结果 |
|---|---|---|---|
| Calculator | 已修复 | 表达式、进制 choices、结果面板、复制、错误 | 修复 pane-bottom 面板未绑定当前 Quick Editor pane、执行后不可见；真实结果面板、焦点、中文与窗口尺寸已验证 |
| Clipboard History | 健康 | 搜索、筛选、选择、预览、复制 | 亮/暗色层级已统一；列表动效改为明确属性，移除 `transition: all` |
| Crypto | 健康 | 哈希/加密输入、参数、错误 | fallback 错误 i18n，错误出口统一 |
| CSV / TSV | 已改进 | 文件输入、解析、统计、复制、错误 | 元数据中文化；复制 Toast；文件/解析/任务错误使用 alert |
| Date Time Assistant | 已修复 | 时间戳与日期互转、非法输入、输出去向 | 非法日期抛结构化错误，不再允许复制或覆盖编辑器 |
| Encode / Decode | 健康 | Base64、URL 等转换与错误 | 错误前缀 i18n；输出去向清晰 |
| Feishu | 已改进 | 设置、CLI 状态、登录、权限、头像 | 权限和失败 fallback i18n；状态 live region；宿主 Text 转发 aria |
| Formatter | 健康 | 格式化、参数、错误 | fallback 错误 i18n；共享 Launcher 错误态 |
| JS Filter | 已修复 | 编辑器 JSON 表达式过滤 | 正常 Quick Editor 可搜索并打开 pane-bottom 面板；中文 placeholder、有效写回、非法 JSON 错误和关闭均已实测；不进入 Global Launcher |
| JSON Tools | 健康 | 格式化、树形查看、语义工具、错误 | Surface 视觉层级与亮色主题统一；插件语义未进入 framework |
| Line Tools | 健康 | 排序、去重等文本写回 | 参数和编辑器写回路径符合共享协议 |
| QR Code | 健康 | 内容输入、二维码预览、复制/保存 | Surface 与公共 token 对齐；无新增阻断 |
| Random | 已修复 | UUID、密码、随机数、参数 | 删除无关自动输入；默认 quick run；参数入口仍可定制 |
| Regex Tester | 已改进 | 正则、flags、匹配结果、错误 | 亮色视觉和工具栏状态统一；文案 i18n |
| Snippets | 已修复 | 搜索片段、从 selection / clipboard 展开 | 删除无关输入步骤；点击后直接执行 |
| Text Diff | 已改进 | 文本/JSON 自动模式、双栏、导航、fallback | 亮/暗主题、双栏标签、aria；动效改为明确属性，保持插件边界 |
| Text Explode | 已改进 | 文本拆分、链接组、选择、拼接预览 | chip 键盘操作、aria-pressed、group label、focus-visible |
| Text Utils | 已改进 | 文本统计与写回 | 统计结果完整中文化 |
| Translate | 已改进 | Provider、语言选择、翻译、进度、错误 | 设置和 Surface 收敛；Provider / 错误 i18n；reduced-motion |
| Custom Commands | 已修复 | 选择命令、权限、安全确认、Shell 结果 | 删除无关输入；先过 `shell.run` 权限闸门；空输出/超时/失败中文化 |
| Variable Case | 健康 | 多种 case 转换、即时预览、三种输出 | fallback i18n；DOM 验证复制/粘贴/带回 Launcher |
| Web Open | 已改进 | URL、搜索、quick-open、标签/历史可选能力 | 初始建议空态；Provider 中文；浏览器能力保持单插件内聚 |
| YAML | 已改进 | YAML ↔ JSON、错误、三种输出 | 双向转换；中文错误；共享 alert |

## 真实浏览器与 DOM 证据

截图目录：`temp/product-design-plugin-audit-2026-08-29/main-desktop/`

代表性截图：

- `02-text-diff-pane-labels-light.png`：Text Diff 亮色双栏。
- `05-launcher-base64-zh-light-output-paths.png`：三种输出去向。
- `08-csv-zh-light-meta-fixed.png`、`09-csv-error-feedback-zh-light.png`：CSV 正常态与错误态。
- `11-timestamp-invalid-error-zh-light.png`：非法日期错误。
- `13-feishu-settings-zh-light.png`：飞书权限状态。
- `14-text-explode-keyboard-zh-light.png`：Text Explode 键盘选择。
- `15-variable-case-output-paths-zh-light.png`：Variable Case 预览与输出去向。
- `18-js-filter-quick-editor-command-zh-light.png`：正常 Quick Editor 中的 JS Filter 命令入口。
- `19-js-filter-pane-bottom-zh-light.png`：亮色中文 pane-bottom 表达式面板。
- `20-js-filter-valid-result-zh-light.png`：有效表达式写回；非法 JSON 错误由同轮 DOM 的“当前内容不是有效的 JSON”证明。
- `round-8/02-calculator-result-panel.png`：Quick Editor 双 pane 中真实 Calculator 结果面板。

关键 DOM：

```text
textbox "输入要用 camelCase 驼峰 处理的文本": hello world example
generic "预览": helloWorldExample
listbox "切换去向"
  option "复制" [selected]
  option "粘贴到前台"
  option "带回 Launcher"
```

```text
group "可选择的文本碎片"
  button "打" [pressed]
  group "链接碎片"
    button "https://example.com"
button "上屏"
```

```text
button "Echo hello ·自定义 Shell 命令"
generic "需要授权"
text "运行 Shell 命令"
generic "shell.run"
button "允许"
button "返回"
```

Snippets 和 Random UUID 点击后 Launcher 直接关闭，证明命令 quick run，而不是进入 collect-input。

## 验证

已通过：

- 插件专项：Calculator、Date Time、Random、Variable Case、Snippets、Custom Commands、Feishu。
- Launcher：Global、Pinned、Quick Editor、IME、optional params、窗口边界。
- `npm run test:plugin-ui-primitives`
- `npm run test:plugin-product-convergence`
- `npm run test:plugin-i18n-localization`
- `npm run check:architecture`
- `git diff --check`
- `npm run build`

## 证据边界

- 浏览器运行时覆盖 Global Launcher、插件 Surface、DOM、亮色中文和主要交互。
- Calculator 底部结果面板的当前真实承载入口是独立 Quick Editor（`?window=quick-editor`），不是已退役的主编辑器路由；已通过浏览器镜像完成真实命令执行和截图。
- JS Filter 已在浏览器镜像完成正常 Quick Editor 全流程；Global Launcher 搜索“表达式”只出现 Regex Tester，证明 JS Filter 的入口边界仍然有效。
- 截图与 DOM 不能单独证明完整无障碍合规；键盘、role、aria-live、aria-pressed 和 reduced-motion 已做专项检查。

## 第二轮：其余插件真实流程复审

环境继续固定为中文、亮色、正常桌面窗口。按主使用路径完成以下检查：

1. **JSON Tools｜已修复**：空态、有效格式化、复制禁用逻辑、非法 JSON `alert`。移除浏览器英文异常直出，改为稳定中文错误；共享主按钮禁用态现在有明确降权。
2. **QR Code｜健康**：生成/识别切换、纠错等级、尺寸、文本生成、复制图片、Base64 与下载状态均符合输入驱动逻辑；空态不会给出可执行假按钮。
3. **Regex Tester｜已修复**：有效匹配、flags、无匹配、非法 pattern。Launcher 标题修正为中文，错误不再泄漏浏览器英文实现文案。
4. **Translate｜健康**：源/目标语种、配置组、输入/只读输出、复制、设置、状态栏和额度信息在正常桌面窗口层级清晰；页面 aria 名称已走 locale。
5. **Clipboard History｜健康**：搜索、类型筛选、列表选择、长文本预览、元信息、收藏/删除入口和快捷键提示均可达。未执行删除，避免改动用户真实历史；后台错误已接入插件 locale。
6. **Web Open｜健康**：完整 `https://` URL 会把“直接打开链接”排到首位；普通关键词继续由标签/历史与自定义 quick-open 规则处理，未触发真实外部跳转。

![正则错误态：中文、亮色、正常桌面窗口](../temp/product-design-plugin-audit-2026-08-29/round-2/01-regex-invalid-zh-light.png)

![JSON 错误态与共享按钮禁用态](../temp/product-design-plugin-audit-2026-08-29/round-2/02-json-invalid-zh-light.png)

第二轮完整截图位置：`temp/product-design-plugin-audit-2026-08-29/round-2/`。

第二轮新增验证：`test:plugin-i18n-localization`、`test:clipboard-history-runtime`、`test:plugin-ui-primitives`、`test:plugin-product-convergence`、`check:architecture`、`git diff --check`、`npm run build` 均通过。

## 第三轮：布局、UI、功能状态复审

本轮重新固定为 1280×720 正常桌面视口，并把首次加载、局部刷新、空状态、错误状态与内容稳定性纳入页面审计。

1. **AI 订阅｜已修复**：骨架屏会在切换页面后立即占住两条 Provider 行；Provider 不再被 `Promise.all` 整体阻塞，先完成的订阅会先显示，剩余位置继续保留骨架。默认 Provider / Agent 在加载完成前保持明确禁用态。
2. **插件管理｜已修复**：目录查询期间不再短暂显示“没有插件”，改为六行列表骨架；加载完成后维持稳定列表结构。插件卡片优先使用 command/tool 的功能说明，减少标题与描述重复。
3. **已学｜已修复**：读取期间不再误报“还没学到规则”；加载态使用独立 status，真实空态增加图标、标题和解释，正常桌面页面不再只剩一行孤立文字。
4. **Translate AI 设置｜已改进**：Provider 与模型查询期间从纯文字提示升级为三组字段骨架，并遵守 `prefers-reduced-motion`。
5. **其余插件 Surface｜健康**：复扫全部 first-party 插件的布局、硬编码文案、错误出口、空态、loading、禁用状态和 `transition: all`。JSON、Regex、QR、CSV、Text Diff、Text Explode、Clipboard History 等主页面继续维持上两轮结论；未新增阻断级问题。
6. **Web Open 设置｜已改进**：favicon 缺失回退从 emoji 改为现有 Lucide 图标，避免平台字形差异。

![AI 订阅首次加载骨架](../temp/product-design-plugin-audit-2026-08-29/round-3/10-ai-loading-final.png)

![插件管理首次加载骨架](../temp/product-design-plugin-audit-2026-08-29/round-3/07-plugin-management-final.png)

![已学页面最终空态](../temp/product-design-plugin-audit-2026-08-29/round-3/09-learned-empty-final.png)

第三轮完整截图位置：`temp/product-design-plugin-audit-2026-08-29/round-3/`。

第三轮验证：`test:ai-provider-runtime`、`test:plugin-i18n-localization`、`test:plugin-ui-primitives`、`test:plugin-product-convergence`、`check:architecture`、`git diff --check`、`npm run build` 均通过。Launcher 最近样本首帧约 28ms；AI 订阅等待主要来自 Provider 描述与额度请求，而不是设置页首帧。

## 第四轮：AI 订阅真实等待治理

本轮继续以 1280×720 正常桌面视口为主，验证冷启动、渐进显示、页面切换复用、亮/暗主题与浏览器镜像启动。

1. **首个可用结果提前**：OpenAI 在账号与模型完成后立即显示连接状态和 Agent，额度请求继续后台完成，不再阻塞整张 Provider 卡片。
2. **Provider 相互隔离**：每个 Provider 独立记录 `latency:ai.provider.describe`，并有 10 秒软超时；单个 Provider 卡住不会拖住另一个。
3. **页面切换复用**：最近 60 秒 descriptor 立即回显并后台刷新，避免每次进入页面重新从两行骨架开始；已有数据时不再重复渲染骨架行。
4. **单项恢复**：每张 Provider 卡片的刷新按钮只重试该 Provider；连接与断开后主动失效对应缓存。
5. **浏览器镜像可恢复**：桌面 localStorage 快照超时不再阻止 React 挂载；镜像会使用已有浏览器状态继续用于 UI 审计。
6. **额度文案**：内部 `gpt-reserve` 在中文界面显示为“其他额度”，原始 ID 仍保留为诊断 title。

![AI 订阅冷启动骨架](../temp/product-design-plugin-audit-2026-08-29/round-4/01-ai-cold-loading.png)

![AI Provider 渐进显示](../temp/product-design-plugin-audit-2026-08-29/round-4/02-ai-progressive-provider.png)

![AI 订阅桌面亮色完成态](../temp/product-design-plugin-audit-2026-08-29/round-4/04-ai-desktop-light.png)

![AI 订阅桌面暗色缓存刷新态](../temp/product-design-plugin-audit-2026-08-29/round-4/06-ai-cached-dark-final.png)

第四轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-4/`。

## 第五轮：正常桌面核心路径

本轮在 1280×720 视口回归三条高频路径：Launcher → 插件 Surface、Launcher → Quick Editor、设置 → 插件管理 → 插件设置。

1. **Launcher 搜索与执行｜健康**：输入 `JSON` 后约 280ms 完成筛选；键盘 Enter 可进入 JSON Surface，返回后保留搜索词和结果上下文。
2. **插件 Surface 生命周期｜已修复**：加载、打开失败、页面不存在和崩溃兜底全部接入系统中英文；失败态不再暴露原始运行时错误，并提供明确“返回”操作。
3. **JSON Surface｜健康**：正常桌面双栏稳定；空态、输入、格式化结果与复制禁用/启用状态一致。
4. **Quick Editor｜已修复**：Monaco 懒加载期间不再显示整块空白，改为本地化 `status`；编辑器初始化阶段也维持加载反馈。命令层 Esc 会关闭浮层并把焦点归还“编辑器内容”。
5. **插件管理与设置｜健康**：正常桌面列表、搜索和设置入口可达；翻译设置关闭后焦点返回原设置按钮，不丢列表位置。
6. **浏览器镜像断线恢复｜已修复**：若本地 relay session 存在但桌面转发已失效，镜像会移除伪原生环境并退回浏览器模式，避免插件初始化被每个原生请求拖慢。

![JSON Surface 正常桌面空态](../temp/product-design-plugin-audit-2026-08-29/round-5/03-json-surface-ready.png)

![Quick Editor 明确加载反馈](../temp/product-design-plugin-audit-2026-08-29/round-5/07-quick-editor-loading-final.png)

![插件管理正常桌面列表](../temp/product-design-plugin-audit-2026-08-29/round-5/06-plugin-management-desktop.png)

第五轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-5/`。拒绝使用本轮早期的英文加载态和 Quick Editor 空白画面截图作为最终证据。

## 第六轮：共享失败恢复与桌面终检

本轮继续固定正常桌面窗口，覆盖插件管理共享错误出口、亮/暗色、键盘恢复和减弱动画。

1. **插件目录失败｜已修复**：目录读取失败不再直接展示底层异常；页面显示稳定的本地化失败提示和“重试”，原始信息只保留在诊断 title。
2. **插件操作失败｜已修复**：安装、更新、启停等异常统一为本地化用户提示；浏览器模式下仍保留“需要在桌面应用中执行”这一可行动说明，不被泛化错误覆盖。
3. **共享粘贴反馈｜已修复**：文本、图片、文件路径与辅助功能降级提示均进入系统中英文管线，Clipboard History、Text Explode 和 Launcher 不再收到英文硬编码消息。
4. **Renderer / Panel 缺失｜已修复**：Workspace 与 Quick Editor 的缺失反馈使用当前 locale，同时保留 contribution ID 便于定位。
5. **亮/暗色与焦点恢复｜健康**：插件列表在两套主题下层级、对比度和滚动区域稳定；远程导入 Esc 关闭后焦点返回“添加插件”。
6. **减弱动画｜健康**：浏览器模拟 `prefers-reduced-motion: reduce` 后，插件行与主按钮 transition 均降为 `0.01ms`，骨架动画关闭。
7. **Web Open 浏览器镜像｜已修复**：browser-only 模式下插件网络 API 使用浏览器 `fetch`，不再调用缺失的原生 invoke；favicon 候选的预期跨域失败不再刷屏。刷新后的新日志中未再出现 favicon candidate warning。
8. **添加插件菜单｜已收紧**：移除重复的“从来源安装”标题和三条低价值副说明，保留 GitHub、压缩包、目录三个直接动作。亮/暗色实测由约 `148×190px` 收至 `120×117px`，不改共享菜单，避免影响插件行菜单和右键菜单。

![插件管理亮色正常态](../temp/product-design-plugin-audit-2026-08-29/round-6/01-plugin-management-light.png)

![插件导入可行动失败态](../temp/product-design-plugin-audit-2026-08-29/round-6/02-plugin-import-recovery-light.png)

![插件管理暗色正常态](../temp/product-design-plugin-audit-2026-08-29/round-6/03-plugin-management-dark.png)

![添加插件菜单亮色最终态](../temp/product-design-plugin-audit-2026-08-29/round-6/05-add-plugin-menu-light-final.png)

![添加插件菜单暗色最终态](../temp/product-design-plugin-audit-2026-08-29/round-6/06-add-plugin-menu-dark-final.png)

第六轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-6/`。

第六轮验证已通过：`test:plugin-network-proxy`、`test:plugin-paste-behavior`、`test:plugin-i18n-localization`、`test:plugin-ui-primitives`、`test:plugin-product-convergence`、`test-editor-primitive-boundary`、`test-launcher-web-smoke`、`check:architecture`、`git diff --check`、`npm run build`。

键盘证据边界：插件行的 Enter / Space 展开、远程导入 Esc 关闭和焦点返回已在真实 DOM 验证；当前应用内浏览器无法可靠合成 Tab / Shift+Tab，也不会替原生 button 生成默认激活行为，因此未把这部分自动化结果冒充产品结论。代码追踪确认设置标签和主操作仍使用原生 button/input、插件行保持 `tabIndex={0}`，共享菜单继续由 Base UI Trigger 承载；`test:plugin-ui-primitives` 已锁定这些键盘语义。仍建议在浏览器页面人工走一次 Tab / Shift+Tab。

## 第七轮：页面跳变与进入退出动效

本轮连续往返基础设置、AI 订阅、插件管理和已学页面，并检查 Launcher 与设置 Surface 的尺寸策略。

1. **设置外框｜稳定**：四页切换前后内容外框始终为 `718×630px`，内部页面始终为 `716×628px`，没有真实 resize、横向位移或滚动条挤压。
2. **内容页切换｜已修复**：原实现直接卸载旧页并挂载新页，页面密度差异会形成硬切。现在支持 View Transitions 的 WebView 使用 `90ms` 退出与 `140ms` 进入；不支持时保留 `140ms` 轻量进入兜底。
3. **窗口尺寸｜保持即时**：Global Launcher 原生窗口 resize 不增加 height transition；代码已有明确约束，CSS 高度动画会与原生窗口 resize 竞争并产生二次跳动。
4. **减弱动画｜已覆盖**：`prefers-reduced-motion: reduce` 下新旧页面动画均降至 `0.01ms`。

![基础设置稳定态](../temp/product-design-plugin-audit-2026-08-29/round-7/01-settings-start.png)

![AI 订阅稳定态](../temp/product-design-plugin-audit-2026-08-29/round-7/02-ai-enter.png)

![插件管理切换完成态](../temp/product-design-plugin-audit-2026-08-29/round-7/06-transition-final.png)

![已学空态](../temp/product-design-plugin-audit-2026-08-29/round-7/04-learned-enter.png)

第七轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-7/`。

### 第七轮扩大范围：全部插件与设置入口

本轮重新建立 23 个 first-party 插件的完整交互矩阵，并按真实交互形态逐类验证，而不是只抽查小页面。

| 交互形态 | 覆盖插件 | 结论 |
| --- | --- | --- |
| 完整 Surface | 剪贴板历史、CSV / TSV、JSON 工具、二维码、正则测试器、大爆炸、文本对比、翻译 | 固定尺寸 Surface 无内容 resize；自动高度的大爆炸进入 45ms 与稳定态均为 `702×276px` |
| Launcher 工具 / 参数流程 | 计算器、加密、时间助手、编解码、飞书、格式化、JS Filter、行工具、随机生成、文本片段、文本工具、自定义命令、变量转换、浏览器、JSON ↔ YAML | 共用 Launcher controller、参数与结果帧；不为每个工具复制页面动画 |
| 插件设置 | 剪贴板历史、飞书、文本片段、翻译、自定义命令、浏览器 | 六页均使用 `780×672px` 共享设置容器；打开 150ms，关闭后焦点返回原“设置”按钮 |
| 嵌套设置 | 翻译 AI、浏览器缓存 / 实时浏览器等 modal field | 共用 520px 弹层；背景层、标题和关闭焦点层级正确 |
| 插件详情 | 全部 23 个插件 | 详情高度按真实内容展开；新增 140ms Grid 淡入展开，消除约 122px 内容瞬间出现的生硬感 |

共享修复：Global Launcher 中插件 Surface、系统 Surface 和插件设置 Frame 统一增加 `140ms` 的轻量进入动画，只改变透明度和 `3px` 位移，不参与宽高计算。返回 Launcher 保持即时，原生窗口 resize 也继续不做 CSS 高度动画，避免二次缩放。

![剪贴板历史设置](../temp/product-design-plugin-audit-2026-08-29/round-7/07-clipboard-settings.png)

![翻译嵌套 AI 设置](../temp/product-design-plugin-audit-2026-08-29/round-7/10-translate-nested-settings.png)

![二维码 Surface](../temp/product-design-plugin-audit-2026-08-29/round-7/12-qr-surface-entry.png)

![自动高度大爆炸 Surface](../temp/product-design-plugin-audit-2026-08-29/round-7/13-text-explode-autoheight.png)

![插件详情最终态](../temp/product-design-plugin-audit-2026-08-29/round-7/18-plugin-drawer-final.png)

![插件详情暗色动效完成态](../temp/product-design-plugin-audit-2026-08-29/round-7/19-plugin-drawer-dark.png)

## 第八轮：Quick Editor 与 pane-bottom 插件面板

1. **真实入口｜已澄清**：`?window=editor` 已退役；桌面入口为独立 Quick Editor，浏览器降级时由 Launcher host 承载。
2. **Calculator 面板｜已修复**：共享 `panel.openV2` effect 原先未给 `pane-bottom` 自动补当前 pane scope，导致状态已打开但视图永远筛选不到。现在统一绑定 active pane，所有同类插件面板同时受益。
3. **进入表现｜已改进**：pane-bottom 插件面板复用现有 `140ms` 淡入与 `3px` 位移，不动画高度；减弱动画设置继续由全局规则处理。
4. **尺寸与焦点｜健康**：稳定态视口与 document 均为 `582×884px`，无溢出；结果面板为 `289.75×219.5px`，执行后焦点返回当前“编辑器内容”。双 pane 下信息完整但略紧凑，属于次要视觉债，不为小窗口另造布局。

![Calculator 真实 pane-bottom 结果面板](../temp/product-design-plugin-audit-2026-08-29/round-8/02-calculator-result-panel.png)

第八轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-8/`。

## 第九轮：插件设置进入与退出

1. **进入定位｜已修复**：插件设置原先复用下拉菜单的 transform 动画，会在居中弹窗上额外产生垂直位移。现在改为专用 `140ms` 透明度进入，不改变定位或尺寸。
2. **退出反馈｜已修复**：关闭不再直接卸载；Popup 与 Backdrop 保持挂载并执行 `90ms` 透明度退出，结束后再移除。
3. **逐帧证据｜健康**：亮色进入期间弹窗矩形始终为 `780×672px @ (250,24)`，仅 opacity 从 `0` 变化到 `1`；退出约 20ms 进入 closing，约 110ms 完成卸载，焦点返回原插件行“设置”按钮。
4. **暗色抽查｜健康**：暗色下边框、表单、遮罩与焦点环层级正常；抽查后已恢复亮色。

![插件设置亮色稳定态](../temp/product-design-plugin-audit-2026-08-29/round-9/01-plugin-settings-stable-entry.png)

![插件设置暗色抽查](../temp/product-design-plugin-audit-2026-08-29/round-9/02-plugin-settings-dark.png)

第九轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-9/`。

## 第十轮：嵌套设置与插件 Surface 返回

1. **嵌套设置进入｜已修复**：翻译 AI、浏览器缓存等共享嵌套 Popup 不再复用下拉位移动画，改为 `140ms` 透明度进入；AI Provider 骨架到真实字段期间弹层高度保持稳定。
2. **嵌套设置退出｜已修复**：原实现约 30ms 内直接卸载；现在保留 Popup 与 Backdrop 完成 `90ms` 淡出，再返回父设置，焦点回到原“配置”按钮。
3. **插件 Surface 返回｜已修复**：二维码等插件 Surface 原先约 20ms 内硬切回 Launcher；现在由共享 surface navigation 延迟 `90ms` 完成离场，期间禁止重复交互。
4. **尺寸与焦点｜健康**：二维码返回全过程视口保持 `1280×720px`，无 resize 或 document overflow；返回后搜索框重新获得焦点并保留“二维码”查询。

![翻译 AI 嵌套设置稳定态](../temp/product-design-plugin-audit-2026-08-29/round-10/01-translate-nested-settings.png)

第十轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-10/`。

## 第十一轮：系统 Surface 返回与关闭

1. **设置返回｜已修复**：系统设置原先约 30ms 内直接卸载；现在由共享 Host Surface 导航层执行 `90ms` 淡出，再回到 Launcher。
2. **Quick Editor 返回｜已修复**：浏览器降级 Quick Editor 使用相同离场状态；Monaco 不会提前卸载，返回后搜索框恢复焦点并保留“快捷编辑器”查询。
3. **已学页面｜已覆盖**：已学、设置、插件管理和 Quick Editor 共用同一个 Host Surface 外壳，离场逻辑只在宿主层实现一次。
4. **尺寸稳定｜健康**：设置与 Quick Editor 返回全过程视口和 document 均保持 `1280×720px`，没有 CSS 高度动画、滚动条挤压或二次 resize。

![系统设置稳定态](../temp/product-design-plugin-audit-2026-08-29/round-11/01-system-settings-surface.png)

第十一轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-11/`。

## 第十二轮：Launcher 次级流程与全插件进入链路

本轮把范围补齐到所有插件共享的参数、输入、结果和权限帧，并再次串联插件详情、插件设置、嵌套设置、插件 Surface 与系统 Surface。

1. **参数选择 → 输入 → 结果｜已改进**：原来共享 controller 会直接替换次级 Frame，视觉上是硬切。现在参数、collect-input、result 和 permission 共用 `120ms` 透明度进入；不移动、不动画宽高，多参数步骤也按参数索引重新触发。
2. **返回路径｜健康**：从输入返回上一个参数后，焦点回到参数筛选框；从命令退出后回到 Launcher 搜索框，原查询继续保留。返回后的目标 Frame 使用同一轻量进入反馈，不额外保留两份 DOM。
3. **尺寸策略｜健康**：普通 Launcher 流程继续受 `318px` 原生窗口最小高度保护，参数页、输入预览和结果更新不增加 CSS height transition；Surface / 设置仍使用固定外框与既有 `90ms` 离场。
4. **全插件覆盖｜完成**：15 个 Launcher 工具统一从本次共享 Frame 修复受益；8 个完整插件 Surface、6 个插件设置、翻译与浏览器嵌套设置沿用第七至十一轮已验证的共享进入/退出链路，没有再增加插件私有动画。
5. **无障碍｜保持**：参数与 collect-input 返回仍是原生 button，输入自动聚焦；全局 `prefers-reduced-motion` 会把新动画缩短到 `0.01ms`。截图无法证明完整键盘遍历，结论仍以 DOM 语义与现有契约测试为限。

![Launcher 基线](../temp/product-design-plugin-audit-2026-08-29/round-12/01-launcher-home.jpg)

![Base64 输入页](../temp/product-design-plugin-audit-2026-08-29/round-12/02-base64-input.jpg)

![进制转换参数页返回动效](../temp/product-design-plugin-audit-2026-08-29/round-12/04-param-return-30ms.jpg)

第十二轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-12/`。

## 第十三轮：全插件完成性审计

本轮不再从既有报告推断覆盖，而是以当前 `src/plugins/*/manifest.json`、内置释放索引和浏览器稳定态重新逐项核对。

1. **23 个 first-party 插件｜已证明**：插件管理稳定态逐项出现 23 个插件；文本片段、文本对比、加密、计算器、JSON 工具、变量转换、翻译、飞书、正则测试器、二维码、大爆炸、编解码、格式化、CSV / TSV、JSON 表达式、JSON ↔ YAML、时间助手、随机生成、文本工具、自定义命令、剪贴板历史、行工具、浏览器均可见。
2. **6 个插件设置｜健康**：文本片段、翻译、飞书、自定义命令、剪贴板历史和浏览器设置均从真实插件行打开；关闭后焦点返回各自“设置”按钮。
3. **嵌套设置｜健康**：翻译 AI 从骨架稳定切换到服务商、模型和思考深度；浏览器图标缓存从 loading 切换到 36 条缓存，浏览器连接页显示连接状态和全部控制。嵌套关闭后焦点分别返回“配置”“管理”“打开”。
4. **亮暗色｜健康**：23 插件列表在亮色、暗色下均保持边界、层级和滚动稳定；抽查后恢复亮色。
5. **内置插件释放｜已修复**：完成性契约发现 Calculator 的索引/manifest 版本不一致、JS Filter 的反向不一致，以及释放索引漏列飞书、随机生成、文本片段、大爆炸、自定义命令、变量转换。当前索引版本升至 53，包含全部 23 个插件并与各 manifest 版本一致；契约测试新增集合相等检查，避免“源码能看到、释放目录没更新”。
6. **设置数值精度｜已修复**：共享设置 schema 现在把 `storageScale` 换算后的浮点噪声限制在 6 位小数，并把插件声明的 `step` 传给 NumberField。剪贴板文本容量的无障碍值由 `1.010000228881836` 恢复为 `1.01`，显示值与操作步进一致。

![23 个插件亮色稳定态](../temp/product-design-plugin-audit-2026-08-29/round-13/01-all-23-plugins.jpg)

![翻译 AI 嵌套设置稳定态](../temp/product-design-plugin-audit-2026-08-29/round-13/02-translate-ai-nested-stable.jpg)

![浏览器缓存嵌套设置](../temp/product-design-plugin-audit-2026-08-29/round-13/03-browser-cache-nested.jpg)

![23 个插件暗色稳定态](../temp/product-design-plugin-audit-2026-08-29/round-13/04-all-23-plugins-dark.jpg)

第十三轮截图位置：`temp/product-design-plugin-audit-2026-08-29/round-13/`。
