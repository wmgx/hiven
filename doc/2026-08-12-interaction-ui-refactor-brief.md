# hiven 交互 & UI 大重构 Brief（给新会话）

**用途：** 本文档给一个**全新的 Claude 会话**冷启动用。目标是对 hiven 做一次**交互形式 + UI 的大范围重构**，同时**完整保留现有能力**（全局 Launcher、全部插件、编辑器能力）。
**背景：** 之前的交互/视觉方案（Pure White v6/v7 + Action Stage 双栏）由 Codex 设计，实测效果不好；本轮已否决"分栏预览"路线，倾向"选中命令即单栏进入"的执行优先模型（详见 §6）。
**日期：** 2026-08-12
**仓库：** `/Users/bytedance/flux_text`（分支 `main`，有大量未提交改动）

---

## 0. 一句话

> hiven 是一个 **macOS/Windows 桌面「文本工作台」**：没有主窗口，靠**系统托盘 + 全局热键唤起的 Launcher** 作为唯一入口，把「搜索 → 选命令 → 执行 → 继续处理文本」做成一条键盘优先的流。**能力已经很全（22 个插件 + Monaco 编辑器 + 剪贴板对象 + 桌面控制），这次只重塑交互与 UI，不动能力本身。**

---

## 1. 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | **Tauri 2**（Rust）— `src-tauri/`，4 个 rs 文件：`lib.rs`(主命令面) / `hotkeys.rs`(全局热键) / `desktop_bridge.rs` / `main.rs` |
| 前端 | **React 19 + TypeScript 6 + Vite 8**，316 个 ts/tsx |
| 状态 | **Zustand**（`src/store.ts` 全局 store + 各子 store） |
| 编辑器 | **Monaco 0.55**（`@monaco-editor/react`） |
| 样式 | **Tailwind v4** + 手写 CSS（`src/index.css`，含 Light/Dark tokens） |
| 其它 | cmdk、lucide-react（图标）、@tanstack/react-virtual、pinyin-pro（中文搜索）、bignumber.js、js-yaml、sql-formatter |
| 包管理 | pnpm |

**启动命令：** `npm run dev`（前端 vite，热更）｜`npm run tauri dev`（桌面端，Rust 改动需重编）｜`npm run build`（前端构建）｜`npm run build:desktop`（打包）。

> ⚠️ **前端热更能看到 tsx/css 改动，但任何 `src-tauri/*.rs` 改动必须重编桌面端才生效**（热更无效）。

---

## 2. 产品形态（surfaces）

| Surface | 角色 | 现状 |
|---|---|---|
| **System tray** | 唯一常驻入口 | 保留 |
| **Global Launcher** | 隐藏窗口，热键唤起；搜索 / 参数 / 结果 / 可选 Action Stage | **核心，交互重构主战场** |
| **Host surfaces** | 就地展开：Quick Editor / Settings / Plugins | 保留能力，UI 可重塑 |
| **Quick Editor** | Monaco；可 detach 成独立窗口；轻量线性分栏（右/下新建 Pane，**非** IDE workbench） | 保留能力 |
| **Plugin surface windows** | 宿主 chrome + 插件 body（CSV/Diff/Translate 等专业界面） | 保留 |

**已退休（不要复活）：** 主 workbench 窗口、图标侧栏做主壳、常驻实时工具 workbench、多 pane 弹性分栏做宿主壳。

---

## 3. 现有能力全景（**这次必须完整保留**）

### 3.1 全局 Launcher（`src/components/launcher/`, `src/workspace/launcher/`, `src/launcher/`）

- **热键唤起**：默认双击 Cmd（可配）；native NSEvent 监听（`hotkeys.rs`）。
- **统一混排搜索**：命令 / 动态结果 / App / 窗口 / 浏览器标签 / 文档（飞书）/ 会话 / 联系人 / 剪贴板历史 / 插件 surface。
- **搜索排序**：`ranking.ts` + `intentEngine.ts`（内容意图抬分）+ `searchRanking.ts`（拼音/模糊）+ `favorites.ts` / `usage.ts`（收藏/高频）。
- **命令执行模型**：`controller.ts`（frame 栈：list / collect-input / param / result / surface）+ `presentation.ts`（`none|preview|form|collection|confirm|surface`）。
- **参数收集**：统一 launcher controller 承载，禁回退旧表单/native select。
- **结果可继续**：复制 / 粘贴回前台 / 覆盖 Editor Pane / 新建 Pane / 打开 Editor / 继续变换 / Diff / 打开 Surface（`output.ts`）。
- **剪贴板 Object Block**：`src/launcher/clipboard/` — age-tracker 缓存、推荐动作、Object 挂载。
- **端内命令入口**：编辑器页面前台时唤起端内命令面板（`QuickEditorCommandOverlay`）；否则唤起 Global Launcher。I/O 路径分离。
- **桌面控制**：Kill 进程（`desktopControl/`）、App/窗口/浏览器标签目标（`desktopTargets/`）。

### 3.2 插件系统（`src/plugins/`，22 个 first-party 插件）

```
calculator  csv  translate  json-tools  textDiff  regex-tester
encode-decode  crypto  formatter  clipboard-history  feishu
snippets  user-commands  web-open  browser-tabs  date-time-assistant
line-tools  variable-case  yaml  random  jsFilter  text-utils
```

- **目录包为单位**，固定入口约定（`index.tsx/ts/...`），目录约定优先于 manifest 冗余配置。
- **能力经 host API / SDK**（`plugin-sdk.ts`, `pluginHostSdk.ts`, `pluginRuntime.ts`, `pluginRegistry.ts`）；插件**不跨目录 import** workspace/framework 内部实现。
- 插件有：command / dynamic items / surface（专业界面）/ settings（schema）/ permission / i18n。
- **共享纯算法下沉 kit**（`src/kits/`：`content` / `diff` / `editor` / `ui`），kit 不是插件也不是 framework API。

### 3.3 编辑器能力（`src/components/quickEditor/`, `src/workspace/quickEditor/`）

- Monaco 实例生命周期、decorations bridge（`monacoBridge.ts`）。
- 内嵌 Editor（用 Launcher 外框）+ 独立 Editor 窗口（可 detach）。
- 轻量线性分栏（`Cmd+\` 右 / `Shift+Cmd+\` 下新建 Pane）。
- 覆盖历史（`QuickEditorVersionHistory` — 外部覆盖前存档，正常输入不建版本）。
- 端内命令 overlay（`QuickEditorCommandOverlay`）。

### 3.4 系统级能力

- **i18n**（`src/i18n/`）：中英双语，**所有用户可见文案必须走 locale**（禁 hardcode）。
- **telemetry**（`src/workspace/telemetry/`）：always-on NDJSON 埋点（`~/.local/hiven/logs/launcher-perf.ndjson`）；`npm run telemetry -- --last 5` 看会话漏斗。
- **权限系统**（`pluginPermissions.ts`）：最小权限。
- **设置**（`SystemSettingsSurface`）、**effect runner**、**surface 占用协调**（`surfaceCoordinator.ts`）。

---

## 4. 架构红线（**重构必须遵守**，详见 `CLAUDE.md` / `AGENTS.md`）

**framework = plugin host**，只负责：registry / command / renderer / panel / renderer 生命周期 / workspace + pane 状态 / pane 文本读写 / editor primitive + Monaco 生命周期 / settings / effect runner / surface 占用。

**framework 不含产品语义**：diff / compare / JSON / Markdown / AST / code semantic / 双栏 diff 布局 / 具体插件的 toolbar 与文案。

- **Diff 是插件，不是 framework 能力**（`text-diff`/`json-diff`/`markdown-diff` 皆 first-party 插件；`core.diff` 不做 JSON-aware 默认入口）。
- **依赖方向**：`plugins → workspace public API / kits`；`framework 不依赖 plugins`；`kits 不依赖 framework/plugins`。
- **Kit 准入**：需要 framework 对象 / 持有运行时状态副作用 / 只服务单插件单策略 → 都**不进** kit。
- **i18n**：command title / description / 参数 label / choices / 卡片标题 / 空状态 / 错误 / toolbar 全部走 locale。唯一原生文案例外：托盘菜单 `desktop_tray_text()`。
- **Launcher I/O 分离**：Global Launcher 不自动展示/激活/隐藏主窗口；App 内输出默认写当前 pane，Global 输出默认展示在 launcher 或写剪贴板，二者不串路。
- **IME**：中文输入法 Enter 上屏不得触发命令确认。

> 校验：`npm run check:architecture`（边界）｜`npm run check:reachability`｜`npm run test:quality-gate`。

---

## 5. 现有交互/UI 现状 & 为什么要重构

现有视觉方案 = **Pure White / Cold Blue v7**（合同 `doc/2026-08-11-light-theme-pure-white-blue-v7-notes.md`，色板 tokens.css，视觉板 v6.html）。色彩方向（纯白 + 冷蓝信号，无绿、无暖灰、选中淡蓝、主按钮近黑）**用户认可，可保留**。

**问题出在交互形态（用户实测否决）：**

1. **Action Stage 双栏预览 = 败笔**。选中命令后右侧弹并排预览栏 → 在小 launcher 窗口里既挤又**分散注意力**。用户明确：「选中了命令就直接进入这个命令就好了，分栏反而分散注意力」。
2. **↑↓ 随手弹 Stage** → 上下浏览时右栏频繁弹出/收起，视觉跳动、突兀。
3. **idle 透明占位列** → 为防宽度 thrash 在非 stage 行保留透明空列，实测读作「右侧空一大块、布局坏了」。
4. **渲染性能**：Launcher 渲染链路（Panel→FrameSwitch→SearchFrame→列表/Stage）层层缺 memo + 内联 callback，打字/选择/hover 触发整树重渲染 → **打字卡、不跟手**。（本轮已部分修：`LauncherMixedList` 加 memo、`runSelected/onHide` 用 ref 稳定、`listIdentity` useMemo。）
5. **唤起慢**：窗口用 hide/show 复用、webview 不重载、暖树常驻 —— 但 `lib.rs` 用 non-activating panel（不抢前台）导致 **hide 后 WKWebView 被 occlude、show 时拿不到渲染优先级 → 首帧恢复几秒**（telemetry first-paint p50 ~1.5s / p90 ~4.6s，用户体感「每次都慢」）。属 native 层，需改 App Nap / webview 保活。
6. **误唤起**：双击 Cmd 日常极易误触；native 已有硬化（`hotkeys.rs`：短按≤180ms、间隔55–320ms、同物理键、路由防抖900ms）但需重编才生效（日志曾 2364 次路由 / 0 次 debounce = 旧 native）。用户暂不换热键。

---

## 6. 本次重构方向（起点建议，最终与用户共同敲定）

用户诉求：**重新设计交互形式 + UI**，能力全保留。本轮已讨论出的方向（供新会话作为起点，可再迭代）：

**核心心智：执行优先，不是预览优先。**

```
列表态（单栏占满）
  输入 query → 混排结果
  ↑↓ 只高亮，不弹任何东西          ← 去掉「随手预览分栏」

Enter / 点击选中命令 →
  ├ 具体目标(App/Tab/Doc/联系人)   → 直接打开/聚焦，不进入
  ├ 纯函数工具(Base64/Case/JSON…)
  │    有源(Object/剪贴板)         → 直接执行 → 单栏结果（复制/继续）
  │    无源                        → 进入命令：顶栏命令 Tag + 源输入框，
  │                                  结果实时显示在下方（上下排，不左右分栏）
  ├ 需要参数                        → 进入单栏参数收集
  ├ 危险操作                        → 进入单栏确认
  └ 插件                           → 进入插件 surface（已有）

Esc / ⌫(空输入) → 退回列表
```

**一句话：没有并排 Stage。选中命令 = 整个面板变成那个命令。** 预览/结果如需，也在进入命令后同一栏上下排。

> 注意：这会让现有 `presentation.ts` 的 `preview`（双栏 LIVE）、`GlobalLauncherSearchFrame` 的双栏布局、`LauncherStageHost`/`LauncherActionStage` 大改或移除；`form/confirm/surface` 的**单栏进入**语义可复用 controller 的 frame 栈。

**UI 方向：** 色彩沿用 Pure White / Cold Blue（用户认可），但**布局/动效/信息层级重做**。避免：SaaS landing 美学、浑浊玻璃、低对比 hover、把宿主做成 code-review 产品。参考审美红线：`PRODUCT.md`。

**别忘了一起解决的技术债（可纳入重构）：** 渲染 memo 化（打字跟手）、唤起慢（native webview 保活）、误唤起（重编让硬化生效 / 或引导改组合键）。

---

## 7. 关键文件地图

```
入口 / 壳
  src/App.tsx                         # 热键→open→store，唤起埋点 t0
  src/store.ts                        # zustand 全局 store（open/epoch/settings…）
  src-tauri/src/lib.rs                # 窗口 show/hide、non-activating panel、命令面
  src-tauri/src/hotkeys.rs            # 双击修饰键检测（误唤起硬化）

Global Launcher（交互重构主战场）
  src/launcher/hosts/GlobalLauncherHost.tsx        # 宿主：暖树/焦点/surface/foreground
  src/components/launcher/GlobalLauncherPanel.tsx  # 面板容器 + 键盘路由
  src/components/launcher/GlobalLauncherFrames.tsx # frame 切换（search/param/result/surface/settings/permission）
  src/components/launcher/GlobalLauncherSearchFrame.tsx  # 搜索层 + 现双栏 Stage + arm + localQuery
  src/components/launcher/LauncherMixedList.tsx    # 统一混排列表（行级 memo）
  src/components/launcher/LauncherActionStage.tsx / LauncherStageHost.tsx  # 现分栏 Stage（本次要改/去）
  src/components/launcher/GlobalLauncherKeyboard.ts     # 键盘合同
  src/components/launcher/GlobalLauncher{Close,WindowLifecycle,Geometry,HostLifecycle}.ts

Launcher 逻辑
  src/workspace/launcher/controller.ts        # frame 栈 / 执行 / 参数
  src/workspace/launcher/presentation.ts      # none|preview|form|collection|confirm|surface
  src/workspace/launcher/pureTransforms.ts    # 预览/执行共享 transform
  src/workspace/launcher/{ranking,intentEngine,searchRanking(../),favorites,usage}.ts
  src/workspace/launcher/output.ts            # 结果继续处理目标

剪贴板 Object Block
  src/launcher/clipboard/{useClipboardObjectBlock,objectBlock,actionExecutor,actionRecommendation}.ts

编辑器
  src/components/quickEditor/*  src/workspace/quickEditor/*  src/workspace/monacoBridge.ts

插件系统
  src/plugins/*                 # 22 个 first-party 插件
  src/workspace/plugin*.ts      # registry/runtime/sdk/permissions/settings/surface…
  src/kits/{content,diff,editor,ui}

样式 / 视觉
  src/index.css                 # tokens + launcher/editor/plugin 样式
  DESIGN.md                     # UI 决策源头 + v7 摘要
  doc/2026-08-11-light-theme-pure-white-blue-v7-notes.md  # 现视觉/交互合同（含本轮 v7.1 修订）
  doc/2026-08-11-light-theme-pure-white-blue-v6.html      # 视觉板
  doc/2026-08-11-light-theme-pure-white-blue-v6-tokens.css
  PRODUCT.md / AGENTS.md        # 品牌红线 / framework-plugin 边界
```

---

## 8. 验证要求（每次改动后）

```bash
git status --short --ignored
npm run check:architecture       # 架构边界（红线）
npm run check:reachability
npm run build                    # 前端构建
git diff --check                 # 空白/冲突标记
```

交互/UI 改动**尽量补浏览器验证**，看真实 DOM/画面，不只看构建通过。
Launcher 相关契约测试（部分）：

```bash
node scripts/test-launcher-presentation.mjs      # Stage presentation（改交互模型时会需要同步更新）
node scripts/test-launcher-selection-preserve.mjs
node scripts/test-launcher-high-risk-enter.mjs   # danger Enter 硬闸
node scripts/test-launcher-stage-geometry.mjs    # 窗口高度 / 双栏（改单栏后需重写）
node scripts/test-ime-enter-confirmation.mjs     # IME Enter 不确认
npm run telemetry -- --last 5                    # 唤起/打字性能
```

> 契约测试很多锁定了**旧交互决策**（尤其 Stage/双栏/idle）。大改交互模型时，**要同步重写对应契约测试 + 更新 DESIGN.md / v7 notes**，而不是绕过它们。

---

## 9. 给新会话的开场建议

1. 先读本文档 + `CLAUDE.md` + `PRODUCT.md` + `DESIGN.md`，建立边界认知。
2. 和用户敲定**新交互模型**（§6 是起点，非定稿），画清「列表态 / 进入命令态 / 结果态」三态与键盘合同。
3. **保留能力、重塑交互**：不要动插件能力、编辑器能力、桌面控制；只改 launcher 呈现层 + controller frame 呈现 + 样式。
4. 增量落地 + 每步验证（build + 契约 + 浏览器）；契约变更同步测试与文档。
5. 性能/唤起/误唤起可并入，但主线是交互 + UI。
```

