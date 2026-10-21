# hiven 整改执行 brief（2026-10-17）

依据：`doc/2026-10-17-ux-audit.md`（体验问题）和 `doc/2026-10-17-full-review.md`（结构问题）。下面所有决策都已经由用户拍板，执行时**不要重新讨论，也不要扩大范围**。

## 通用规则（每个阶段都要遵守）

- 分支：直接在 `dot/ai-reliability` 上提交。提交身份已经是 `haotian <lhtsgx@gmail.com>`，提交前核对一遍。
- 用户原有的未提交改动已经暂存在 `stash@{0}`，**不要 pop、drop 或改动它**。
- **一个逻辑改动一个提交**，message 用 conventional commits 格式，不得重复；不要按文件拆成一堆同名提交。
- **完成标准**：`npm run test:quality-gate` 全绿，`git diff --check` 干净。涉及 UI 或交互的改动，还要按 AGENTS.md 用 web validation 页面实测（vite 跑在 1420 端口，地址 `http://localhost:1420/?window=launcher`）。只跑单个脚本不算完成。
- **禁止新增"读源码字符串再用正则断言"的测试。** 如果改动让已有的源码正则断言失败，直接删掉那条断言，不要修改正则去迁就新代码。
- 测试只给重要逻辑写，最多一个主路径加一个关键失败路径；不为 UI 写单测。
- 所有用户可见文案走 i18n（宿主用 `src/i18n/locales/*.ts`，插件用 `src/plugins/*/locales/{en,zh}.json`），中英文同步。
- **不用 osascript 操作用户 GUI。** 不往用户剪贴板写东西；web validation 时遇到粘贴、复制、删除等有副作用的操作要保守。
- 修改了插件行为或文案，要按 AGENTS.md 提升该插件的版本号。
- 临时文件放 `temp/`，用完删除（只删自己建的）。
- 平台：**macOS 是唯一的验收平台**。Linux/X11 代码保留不动。
- **本轮不做**：抽象收敛（WorkObject/ObjectBlock/LauncherItem 合并）、Launcher 状态机化、全局 CSS 大拆分、AI 通道增删、系统控制命令的任何改动（重启、关机、锁屏、杀进程、窗口切换都**保持原样**，包括它们在默认列表里的位置）、CSV 功能删减。

---

## 阶段 A：止血与删除

1. **修门禁**：从 `scripts/test-quality-gate.mjs` 里去掉 4 个已经不存在的脚本：`test:automatic-learning-settings`、`test:automatic-learning-lifecycle`、`test:self-learning-pr1`、`test:self-learning-pr3`。如果 `test:self-learning-pr0`、`pr2` 测的是已撤除的自学习功能，就一并删除（脚本文件和 package.json 条目都删）；如果测的是仍然存在的手动 Saved Action，就保留并改个名。
2. **修 reachability**：删除死代码 `src/plugins/textDiff/autoDiffMode.ts`，同步修改 AGENTS.md 里引用它的那句话（改成描述 `TextDiffSurface.tsx` 的现状）。`markdownPlain.worker.ts` 和 `regex.worker.ts` 是通过 `new URL(..., import.meta.url)` 加载的 worker：先确认它们确实在用，然后让 reachability 检查能识别这种加载方式，或者把它们加进白名单。
3. **删除短倒计时**：删 `src-tauri/src/short_countdown.rs` 及它在 lib.rs 里的 mod、start、command 注册；删 `src/shortCountdownHandoff.ts`、`src/shortCountdownAvailability.ts` 及它们在 App.tsx、GlobalLauncherHost.tsx 里的接入；删 `launcher/types.ts` 里的 `shortCountdown` API；删 date-time-assistant 里的 countdown 入口、`countdown.ts` 和 `countdown.*` 文案；删 hud.ts 里的 `result.countdown-expired`；删相关测试脚本。
4. **删除飞书插件**：删 `src/plugins/feishu/` 整个目录，以及宿主里所有对它的引用（包括 `useLauncherSession.ts` 里的 `DOCUMENT_DYNAMIC_DEBOUNCE_MS` 和文档动态结果通道。如果这个通道只服务飞书，就整条删掉）。还要删 desktopTargets 里飞书专属的部分、`builtin-plugins/index.json` 里的条目、相关测试脚本和 package.json 条目。已安装用户的释放目录里如果残留旧插件，按现有的 retired package 机制清理。
5. **清理残留**：删除 `src/plugins/behavior-observer/`（只剩一个空的 locales 目录）。
6. 验收：`npm run test:quality-gate` 全绿；`npm run check:reachability` 通过；`cargo check`（在 `src-tauri/` 下）通过。

## 阶段 E：清理源码正则测试

1. 扫描 `scripts/test-*.mjs`，找出所有"`readFileSync` 读 `.ts/.tsx/.rs/.css` 源码，然后用 `assert.match` / `assert.doesNotMatch` / `includes` 断言"的部分。
2. 断言如果是在验证一个重要行为，并且能通过 import 模块真实调用来验证，就改写成行为断言。其余的一律删除。一个测试文件删空了，就把整个文件和它的 package.json 条目一起删掉，并从门禁中移除。
3. `check-architecture.mjs`、`check-reachability.mjs` 这类**架构检查器不算在内**，保留。
4. 在 AGENTS.md 的"验证要求"里加一条：禁止新增源码字符串断言测试。
5. 验收：门禁全绿；报告删除和改写的数量。

## 阶段 B：核心交互

1. **内容直达**（最高优先级）：
   - 根因在 `src/workspace/launcher/ranking.ts:479-482`：有查询时先按标题过滤，内容识别只参与打分。
   - 修改目标：查询文本如果被识别为强类型（复用 `src/launcher/clipboard/attachPolicy.ts` 的 `findStrongClipboardAttachHits`，覆盖 JSON、JWT、时间戳、URL、Base64 等），就自动把查询转成 Object Block（等同于现在点击"作为内容处理"），列出该类型的内容动作，第一项是最常用的动作。
   - 删除 `GlobalLauncherSearchFrame.tsx` 里的"作为内容处理"按钮和 `palette.useQueryAsContent` 文案。
   - 内容动作列表里不应该混进插件管理、设置、控制台、快捷编辑器这类和内容无关的宿主命令。系统控制命令也按"保持原样"处理：现在出现在哪里，就继续在哪里，不做调整。
   - 验收：用 web validation 粘贴 `{"a":1,"b":[1,2]}`，第一屏就出现 JSON 动作，按 Enter 一步得到格式化结果。
2. **参数默认值**：JSON 格式化（缩进 2、不排序键名）以及其它有参数的常用内容动作，Enter 直接用默认参数执行，⌘Enter 才进入参数页。需要用户明确选择的分支命令（AGENTS.md 点名的 Base64、Set Language、Diff panel 选择）保持不变。
3. **收确认弹窗**：去掉所有一次性工具的"未保存、放弃修改？"守卫（15 个工具里调用 `host.setUnsavedChanges` 的地方），Esc 直接关闭。只保留删除持久数据时的确认，比如删除已保存工具、清空剪贴板历史。把"历史保留期缩短""窗口已有稿件是否放弃"这类确认也去掉。同时删除不再使用的 confirm/discard 文案 key。
4. **HUD 一次出全文**：翻译、二维码、Clean Agent 的 HUD，第一次按快捷键就显示完整结果，Enter 复制，Esc 关闭。去掉"再按一次快捷键查看"的二段式。去掉 `qrHudSensitivity.ts` 这类敏感内容自动隐藏（二维码、curl、HUD 都去掉），curl 解析的值默认显示。
5. **AI provider 缓存**：`src/workspace/ai/runtime.ts:528` 不要在每次生成前都调用 `describeProviders`。改为直接使用缓存的描述，生成失败（认证、不可用）时再刷新并重试一次。
6. **int64 无损**：JSON 的格式化、压缩、排序、语义 diff 都要能正确处理超出安全整数范围的数字和高精度小数，并原样保留数字文本。删除 `requireFaithfulNumbers` 的拒绝逻辑和 numberFidelity 相关文案。纯算法放在 kit 里，并补一条行为测试（大数往返保持不变）。
7. **入口去重**：
   - 同一能力的"JSON 格式化"和"JSON 格式化工作台"这类重复条目合并成一个。
   - 9 个"打开工作台中的对应功能"、8 个"在 CSV Tools 中打开"这类雷同副标题，改成有区分度的内容。
   - "X · 来自 X"这类同义反复的副标题，在宿主层直接去掉"来自"后缀。
   - 搜"剪贴板历史"按 Enter，必须打开主历史，而不是图片视图。
8. 验收：门禁全绿，并用 web validation 走一遍以上各点，附截图说明。

## 阶段 D：边界与 UI 明显问题

1. **HUD 和快捷键直达的边界**：`src/` 根目录下的 `translationHudHandoff.ts`、`qrHudHandoff.ts`、`cleanAgentHudHandoff.ts`、`historyPasteQueueHandoff.ts`、`clipboardImageSaveHandoff.ts` 直接 import 了插件内部实现。要把宿主侧抽象成通用能力（插件通过 SDK 声明"快捷键触发 → 产出文本结果 → 宿主弹 HUD"），插件专属逻辑搬回各自插件目录。Rust 侧 `text_result_hud.rs` 里写死的 `'translation' | 'qr-scan'` 改为通用标识。如果某一项做完整的通用化成本过高，至少把插件专属逻辑移进插件目录，通过公共 API 注册，并在报告里说明。
2. **扩大架构检查范围**：`scripts/check-architecture.mjs` 的禁止 import 插件规则，从只扫描 `src/workspace` 扩大到 `src/` 下除 `src/plugins/` 以外的全部目录。
3. **i18n 修正**：
   - `src/launcher/clipboard/objectBlock.ts` 的 KIND_LABELS、SOURCE_LABELS、`formatAge` 改走 i18n，并去掉"当前 pane""两个 pane"这类已退役的概念。
   - `FeishuSettingsBody` 已随阶段 A 删除。
   - 删除插件里手写的拼音别名（比如 `'hangquchong'`、`'quchong'`），`searchRanking.ts` 已经通过 pinyin-pro 自动处理拼音匹配。删之前抽测几条，确认拼音搜索仍然能命中。
4. **UI 明显问题**：
   - curl 解析页面改用 `@hiven/plugin-ui` 原语，和其它工具保持同一种风格（深浅色都要正确）。
   - `actionRecommendation.ts` 里退化成单字（粘、复、打）的动作补上 lucide 图标；全仓检查 icon 字符串，看还有没有其它退化。
   - `src/index.css` 里的 `.csv*`、`.schema*` 等插件专属样式，搬到对应插件的样式文件里，宿主按插件的样式机制加载。
   - JSON 工作台：低频的"复制 JSONPath / JSON Pointer"和次要操作收进"更多"菜单，一级界面只保留主操作。
   - 剪贴板历史：时间段筛选和词模式筛选收进一个筛选弹出层，一级界面只保留搜索框和类型筛选。
   - 不改整体视觉语言（白底立体白、现有品牌蓝 #2563eb）。
5. **包体积**：Monaco 只保留实际用到的 worker（editor、json）。去掉 ts、css、html worker 之前，先确认快捷编辑器、diff 等地方没有依赖这几种语言的语言服务。
6. 验收：门禁全绿，`check:architecture` 在新的扫描范围下通过，web validation 截图覆盖每一项 UI 改动（深浅色各一张）。

## 阶段 C：文案全量重写

覆盖全部中英文 locale（宿主 `src/i18n/locales/*.ts` 和全部插件 `locales/*.json`），按以下规则重写：

1. 成功一般不提示；失败用一句话说清"发生了什么 + 怎么办"。
2. 删除安抚句（"已保留""原材料已保留""保持不变""未修改""原文"）。
3. 删除否定式免责（"不读文件""不发请求""不会自动…""仅…"），实现边界写进 `doc/`，不写进 UI。
4. 上限数字（KiB、层、节点、字符）只在真正超限的那条错误里出现，不进常驻说明。
5. 常驻说明（hint、help、description、rules、info、privacy）能删就删；不能删的，中文控制在 20 字以内，英文控制在 12 个词以内。
6. 删除"请先 / 请输入 / 请选择"这类教用户操作的句式，控件自身应该能说明用途。
7. 技术术语（Host、Desktop Target 协议、browser.chromium 等）不出现在 UI 文案里。
8. 删除文案后，同步删除代码里对应的渲染节点和不再使用的 key。不要留下空的说明容器。
9. 验收：给出改写前后的统计（条数、总字数、≥30 字的条数），目标是总字数减少一半以上；门禁全绿；web validation 抽查 Launcher、设置、3 个插件页，中英文各截一张。

---

## 本轮取舍记录（用户 2026-10-17 拍板）

| 事项 | 决定 | 备注 |
|---|---|---|
| 短倒计时 | 删除 | 阶段 A |
| 飞书插件 | 删除 | 阶段 A |
| 系统控制（重启、关机、锁屏、杀进程、窗口） | **保持原样** | 默认列表 ⌘5/⌘6 的误触风险本轮接受 |
| CSV SQL 过滤器 | 保留，只精简文案 | |
| AI 通道（xAI、Codex、Ollama） | 三条都保留 | 只修 describe 缓存；xAI 冒用 grok-cli 身份的风险本轮接受 |
| X11 / Linux 代码 | 先保留 | |
| 确认弹窗 | 只保留删除持久数据时的确认 | 阶段 B |
| HUD | 一次出全文，取消敏感内容自动隐藏 | 阶段 B |
| 内容直达 | 自动转成 Object Block | 阶段 B |
| int64 | 无损处理 | 阶段 B |
| 文案 | 全量按规则重写 | 阶段 C |
| 源码正则测试 | 修门禁并删除 | 阶段 E |
| UI | 只修明显问题 | 阶段 D |
| 分支 | 直接在 dot/ai-reliability 上做；外部改动已存入 stash@{0} | |

## 下一轮待办（本轮明确不做）

1. **抽象收敛**：WorkObject、ObjectBlock、LauncherItem、RecommendedAction 收敛成"内容 → 动作 → 输出"一套模型；`src/launcher` 和 `src/workspace/launcher` 两个目录合并。
2. **Launcher 状态机化**：用显式状态机替代 26/27 个 ref 加 generation 守卫的写法。
3. **全局 CSS 拆分**：把 11608 行的 `index.css` 拆到组件，清理 99 条 `.flux-*` 和 285 处 `!important`、208 处内联 style。
4. **巨型文件拆分**：`lib.rs`（8943 行、92 个 command）、`ClipboardHistorySurface.tsx`、`controller.ts`、`CsvSurface.tsx`。
5. **复议**：系统控制命令是否移出空查询默认列表；xAI 通道去留；X11 去留；CSV SQL 去留。
6. **剪贴板历史**：图片行加缩略图，进一步降低一屏按钮数。
7. **内置插件源码重复打包**：`builtinPluginSources` 是否继续以 raw 形式再打一份包（1.7MB），连同"释放"机制的必要性一起评估。
8. **仓库卫生**：`doc/`、`docs/`、`wiki/` 合并；根目录 3 个未跟踪的草稿目录、`CLAUDE-FABLE-5-simplified.md`、`temp/` 下历史遗留文件的处理（需用户确认后再删）。
9. **AGENTS.md 增加 Codex 约束**：完成的定义、提交粒度、文案上限、新增确认/设置/插件须经批准（本轮阶段 E 只加"禁止源码断言测试"这一条）。
10. **stash@{0}** 里的外部改动由用户决定是否恢复。
11. **方向调整后的待办（2026-10-17 用户定为"更懂你的 macOS 全能 launcher + AI 融合"，见 README）**：
    - ~~同步四份文档旧定位~~（已于 2026-10-17 完成，未提交）；
    - 用户不做工作流，评估删除 `src/workflow/`（1266 行）；
    - Launcher 层的 AI 统一：目前意图建议走第三方 Jev（单独的 endpoint 和 key，输入框文本不经过滤直接发出），和 Codex/xAI/Ollama 运行时是两套，需要合并成一条 AI 通道。
12. **阶段 E 遗留**：
    - Rust 侧安全约束（desktop_bridge 验证路由仅 debug、origin 校验等）原先由源码断言守着，已随测试删除，需要补 `cargo test` 行为测试；
    - 12 个不在门禁里的历史失败测试（多为 vm 沙箱缺桩）：修桩或删除；
    - toast_hud.rs 删除 deferred_passive 后未跑 `cargo test`。
13. **阶段 B 遗留**：`ai_ollama_tests.rs` 有 2–5 个超时/取消用例不稳定失败（131/370/385 行），本轮未改动 Ollama 代码，属于既有问题。
14. **阶段 D 遗留**：
    - HUD（翻译 / 二维码 / Clean Agent）重构只在原生 Tauri 下运行，web 无法验证，需要用户桌面端手测；新补的宿主动作图标同样未截图验证；
    - `PluginSurfaceRenderer` 仍硬编码 `pluginId === 'clipboard-history'`（compareHistoryTexts）；
    - `.schema*` 样式归宿主插件设置渲染器，但 web-open 的 `FaviconCacheModal` 借用了 `schema-button`；
    - `monacoEditorFeatures.ts` 镜像 `editor.main.js` 的导入，升级 monaco-editor 时要重新对照；
    - 拼音：`hangquchong` 这类带"行"的组合词不再命中。
15. **阶段 C 遗留**：csv SQL 解析器的硬编码英文错误未走 locale；web-open 浏览器扩展 `extension/manifest.json` 版本号未提升；Ollama 本地边界说明已整条删除（如需提示再补一句）；系统控制和编辑器命令的内联文案未改。

## 执行结果（2026-10-17）

A → E → B → D → C 全部完成，共 48 个提交（8b23532..HEAD），477 个文件，+5230 / −28130 行；最终门禁全绿。
