# 工作台退役清理与止血（第一包）设计文档

> 日期：2026-07-07
> 状态：设计确认，待执行
> 分支：`refactor/workbench-window-architecture`
> 角色分工：本文档由设计侧产出，交给执行 AI 实施；执行者假定对代码库零了解，所有依据都写在文内。
> 证据来源：`doc/archive/2026-07-07-ui-interaction-review.md`、`doc/archive/2026-07-07-architecture-review.md`（两份 2026-07-07 审查报告，行号均为当日快照，执行前请重新定位）。

## 一、背景与已拍板的产品决策

本分支已把产品实际形态改为「系统托盘 + 全局 Launcher 中心 + host surface（页面在 launcher 内原地展开）+ Quick Editor 可 detach 独立窗口」。`src-tauri/tauri.conf.json` 只声明一个隐藏的 `launcher` 窗口；启动只建托盘；`src/main.tsx` 的窗口路由只识别 `launcher` / `plugin-surface` / `quick-editor` 三种取值。

但旧「主工作台窗口」（多 pane 工作区）的整套实现仍留在仓库里，自提交 `97b1e50`（retire standalone editor window entry）起从任何入口都不可达，构建产物中已被 tree-shake 排除。产品负责人已拍板三个决策：

1. **产品形态确定为 launcher 中心**，主工作台代码删除，不保留恢复可能。
2. **Text Diff 的「比较」功能未来迁到 Quick Editor 重建**（第四包，另行设计）；本包只做止血。
3. **Pinned Runner（固定动作运行器）砍掉**，清理全部残骸；未来如需要将以 launcher 原生概念重新设计。

## 二、目标与非目标

目标：

1. 删除全部不可达死代码（工作台链路、Pinned 残骸、旧 settings/plugins fallback）。
2. 修复三处当前用户可感知 / 合并阻塞的问题（settings 失焦关闭、diff 静默失效、架构检查红线）。
3. 让 DESIGN.md 重新成为与代码一致的设计契约。
4. 增加「入口可达性」守卫，防止「代码还在但入口断了」再次无人发现。

非目标（明确不做，执行者不得顺手扩大范围）：

- 不迁移/重建 Diff 展示（第四包）。
- 不修 i18n 硬编码文案问题（第二包），本包新增的提示文案除外（必须走 i18n）。
- 不统一 Escape 处理链（第三包），不动 `launcherEscapeInterceptor` 协议与 `GlobalLauncherHostLifecycle.ts` 的 TODO(escape-migration)。
- 不重构任何仍然可达、工作正常的代码；不改被删文件之外的代码风格/注释/格式。

## 三、删除范围

### 3.1 裁决方法（重要）

以下清单来自审查报告的静态分析。执行时**以可达性分析为最终裁决**：先完成 6.3 节的可达性检查脚本（或用等价手段，如 `npx madge --orphans` / 自写 import 图遍历），从 `src/main.tsx` 的窗口路由入口出发，列出 `src/` 下不可达的 `.ts`/`.tsx` 文件，与本清单核对：

- 清单内且确认不可达 → 删除。
- 清单内但发现仍可达 → 停下，向产品负责人报告后再动。
- 清单外的其它孤儿文件 → 列出报告，不自行决定删除（3.5 节保留清单除外）。

### 3.2 工作台死链路

入口三件套及其整棵依赖树（仅列已确认的主干，附属文件以可达性分析为准）：

- `src/components/EditorWindow.tsx`（全仓无导入者，链路根）
- `src/views/EditorView.tsx`（仅被 EditorWindow 引用）
- `WorkspaceShell`、`PanelHost` / `PanelHostV2`、`PresentationHost`、`RegexTesterPanel`
- `src/workspace` 下的 `effectRunner`、`panelRegistry`、`surfaceCoordinator`、`workspaceStore`（`useWorkspaceStore`）

同步处理散布在活代码里的恒假分支：

- 删除 `isEditorWindowRuntime()`（`src/workspace/launcher/pluginApi.ts:79-83`，判定 `?window=editor`，该取值已无任何窗口会携带，函数恒为 false）。
- `pluginApi.ts` 中以它分流的所有方法（`replaceActiveText` / `insertText` / `getPaneSnapshot` / `dispatchEffects` / `openDiffPage` 等，约 10 处）展开为原 false 分支的单一路径。
- 同样含此分支的其余文件逐一收敛：`pluginInputResolver.ts`、`inputResolver.ts`、`workspacePublicApi`（`executeEffects`）、`pluginCommandExecutor`、`toolbarCommandRunner`（完整名单见架构审查报告第五节第 2 条，或以全仓搜索 `isEditorWindowRuntime` 为准）。
- 注意：`src/workspace/editorWindow.ts` 的 `requestOpenEditorWindow` 等是**有意的兼容转发层**（转发到 `showQuickEditorWindow()`），不是死代码，保留；Rust 侧 `validate_surface_instance_kind` 接受 `"editor"` kind 同理保留。

### 3.3 Pinned Runner 残骸

- 文件整删：`src/workspace/pinnedActionRuntime.ts`、`pinnedActionFactory.ts`、`pinnedActionIdentity.ts`、`pinnedPluginCommandRunner.ts`。
- `src/store.ts`：`pinPluginCommand`（无任何调用点）、`openPinnedAction` / `activePinnedActionId`（无渲染消费者）、`pinnedActions` 状态及 persist 字段、`persistPinnedInput` / `persistPinnedTombstone` 设置项。持久化数据向后兼容：旧 localStorage 里的残留字段直接忽略即可，无需迁移代码。
- `src/components/launcher/GlobalLauncherItems.ts`：删除 `void pinnedActions` 及对应入参。
- `src/components/launcher/GlobalLauncherClose.ts` 的 `finishPinnedLauncherSelection`（42-84 行）。
- `src/components/launcher/useGlobalLauncherSelectionController.ts` 的 `item.kind === 'pinned'` 分支（73-82 行）。
- `src/components/launcher/LauncherMixedList.tsx` 的 `kind: 'pinned'` 类型与文案（9、121 行）。
- `src/surfaces/SettingsContent.tsx:79-84` 的两个死开关 UI（「记住 Pinned 输入内容」「保留 Pinned Tombstone」）。
- 相关 locale key（中英文两份）一并删除。
- `doc/pinned-action-live-runner.md` 移入 `doc/archive/`，文件头加一行：功能已于 2026-07-07 决策移除，本文档仅作历史参考。

### 3.4 旧 settings/plugins fallback 死分支

- `src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx:49-79` 中 `target === 'settings' ? <SettingsSurface /> : <PluginsSurface />` 的 fallback 分支（`openLauncherHostSurface('settings'/'plugins')` 已无调用点，全部改用 `'system-settings'` / `'system-plugins'`）。
- 随之孤儿化的 `src/surfaces/SettingsSurface.tsx`、`src/surfaces/PluginsSurface.tsx`、`SettingsSurfaceContent`。
- `LauncherHostSurfaceTarget` 类型中若仍含 `'settings'` / `'plugins'` 取值，一并移除。

### 3.5 保留清单（禁止删除）

- `src/plugins/textDiff/` 插件目录整体保留（含 `DiffPageView.tsx`）：diff 算法与命令仍是活功能，只是展示端断了。第四包重建候选资产。
- `src/kits/ui/DualEditorView.tsx` 保留：纯 kit 组件，第四包大概率复用。
- `src/workspace/toast.ts` 与 `src/components/workspace/ToastContainer.tsx` 保留：**这是成品反馈组件，当前只被死链引用，但本包 4.4 节会把它们重新挂载到活代码**——它们是迁移对象，不是删除对象。（`RenderStatusBar.tsx` 是纯工作台概念，照删。）
- 前两处在可达性检查白名单中注明「Diff 重建（第四包）候选资产」；toast 两文件在 4.4 完成后自然回到可达图内，不需要白名单。

## 四、修复项

### 4.1 host surface 失焦关闭配置（用户可感知 bug）

现状：`src/components/launcher/hostSurfaceShell.ts:12-14` 的 `HOST_SURFACE_SHELL` 表只登记了 `'quick-editor': { closeOnBlur: false }`；`system-settings` / `system-plugins` 未登记，落到默认「失焦即关闭」。用户从托盘唤起 launcher 打开系统设置页后，切到别的应用或点击桌面，设置页静默关闭。这与 `doc/2026-07-01-unified-navigation-design.md`「`closeOnBlur: false`，必须手动关闭或回退」直接相悖。

修复：

1. `HOST_SURFACE_SHELL` 类型从 `Partial<Record<LauncherHostSurfaceTarget, …>>` 改为 `Record<LauncherHostSurfaceTarget, …>`，**强制每个 host surface 显式声明**，类型层面防止新增 surface 时再遗忘。
2. 补登记 `'system-settings': { closeOnBlur: false }`、`'system-plugins': { closeOnBlur: false }`。

验收：standalone launcher 打开系统设置页 → 点击其它应用 → 设置页保持打开；回到列表态后失焦仍正常关窗（列表态行为不变）。

### 4.2 openDiffPage 止血（消除静默失效）

现状：`src/workspace/launcher/pluginApi.ts:268-274`，`openDiffPage` 的 fallback 分支 `void showQuickEditorSurface()` 直接丢弃 payload。用户执行 Text Diff 的 compare 命令后 Quick Editor 打开但无任何内容、无报错。

修复：fallback 改为向用户展示明确提示「文本比较视图重构中，暂不可用」（具体文案措辞执行时可微调，语气按 PRODUCT.md「精确、有帮助、不废话」）。要求：

- 文案必须走 i18n 管线，中英文同步补齐（禁止硬编码，这是仓库红线）。
- 提示呈现方式复用现有的轻提示机制（如 Quick Editor 两段式 Esc 使用的底部 hint 通道，见 `useQuickEditorEscape` 相关实现）；若无合适通道可复用，允许在 launcher 层加最小的 toast 原语，但不得为此引入新依赖。
- 加代码注释 `TODO(diff-rebuild)`：第四包完成后移除本提示。
- 不再调用 `showQuickEditorSurface()` 打开一个空编辑器（打开了也没内容，徒增困惑）。

验收：Global Launcher 执行 text-diff compare → 看到明确提示，无空窗口打开；中英文 locale 下文案均正确。

### 4.3 架构检查红线（合并阻塞）

现状：`npm run check:architecture` 失败 3 条，均为「plugin index must not contain large CSS/HTML template strings」：

- `src/plugins/web-open/index.tsx`（本分支 `2b62459` 新引入的 240+ 字符模板串）
- `src/plugins/csv/index.ts`（本分支新增复杂 surface 声明后激活了潜伏违规）
- `src/plugins/json-tools/index.ts`（本分支迁移改名产物）

修复：将各 index 文件中的大 CSS/HTML 模板字符串抽到**该插件目录内**的独立文件（如 `styles.ts` / `template.ts`），index 只做组装。不得放宽检查脚本、不得加豁免名单、不得跨插件共享抽出的文件。

验收：`npm run check:architecture` 全绿。

### 4.4 命令反馈通道重新挂载（消除全应用命令静默）

现状：`setLastCommandStatus`（`src/store.ts:424`）被 9 个文件调用，覆盖几乎所有插件命令执行路径（`pluginCommandExecutor` 的 running/success/error、`PluginSurfaceRenderer.tsx:179` 的 `host.showMessage()`、Quick Editor 命令栏等），但它的唯一读取者 `RenderStatusBar` 和整套已建好的 toast 系统（`src/workspace/toast.ts` 的 `showToast()` + `src/components/workspace/ToastContainer.tsx`，含动画、四级配色、自动消失）都只挂在本包要删除的死代码树（`EditorView`）上。**结果：当前所有插件命令的成功/失败提示——包括剪贴板历史的「已复制」「已删除」——全部静默丢失。** 证据详见 `doc/archive/2026-07-07-ui-opportunities.md` 第 1 条。这与 diff 静默失效同属 `97b1e50` 的连锁回归，故并入本包止血。

修复：

1. `<ToastContainer />` 挂载到实际可达的根组件：launcher 窗口（`LauncherRuntimeApp`）、detached Quick Editor 窗口根、独立 plugin surface 窗口根。
2. `host.showMessage` / `setLastCommandStatus` 的 success/error 路径接线到 `showToast()`（组件与样式已存在，工作量是接线不是新建）。running 态是否展示由执行时判断，不强求。
3. `RenderStatusBar` 随工作台链路删除；接线后若 `lastCommandStatus` 状态无任何消费者，一并删除该状态。
4. toast 展示位置注意 launcher 窗口是小窗，样式如需适配以不遮挡列表/输入框为准，不重新设计视觉。

验收：Global Launcher 执行任意插件命令能看到成功/失败 toast；剪贴板历史删除一条后出现「已删除」提示；detached Quick Editor 内执行命令同样有反馈。

## 五、文档更新

### 5.1 DESIGN.md 重写信息架构部分

- 「Primary product surfaces」与「Information architecture」两节重写为当前真实形态：系统托盘（唯一常驻入口）→ 全局热键/托盘唤起 Global Launcher（隐藏窗口）→ host surfaces 原地展开（quick-editor / system-settings / system-plugins）→ Quick Editor 可 detach 为独立窗口 → 插件 surface 独立窗口。
- 删除全部 Main workbench / sidebar rail / 多 pane / rich tabs 相关描述（对应实现已在本包删除）。
- **视觉语言部分不动**：VS Code Light+ 冷白方案、深色 indigo、字体、间距、图标、Raycast 式 launcher 行样式等 token 级内容全部有效保留。
- 「Source of truth」状态行更新：注明 2026-07-07 随 launcher-only 形态落地重写 IA；Pinned Runner 从 surfaces 清单移除。
- 顺带修正契约自身的三处内伤（证据：`doc/archive/2026-07-07-ui-opportunities.md` 末节）：
  1. dark 模式 accent 色号文内两处矛盾（`#8b93ff` vs `#3b82f6`），代码实际用 `#3b82f6`（`src/index.css:127`），收敛为唯一色号 `#3b82f6`；
  2. 「launcher section headers（建议/结果）分组」的描述已被更晚的 `doc/plans/2026-06-12-launcher-system-design.md`（单一排序列表、不分组）推翻，删除该句并在两份文档间补互相引用；
  3. 动效规范从单一「150-250ms」拆为两档：即时反馈类（hover/按下/选中）≤150ms、结构性状态变化（面板展开、分栏、detach）150-250ms——现状代码大量 120-140ms 的快反馈过渡即为合规。
- light 模式 accent（文档 `#007ACC` vs 代码 `#2563eb`）**本包不动**，留待视觉对齐专项由产品负责人拍板后一并更新。
- PRODUCT.md 仅做最小校正：如「desktop workbench」比喻可保留（品牌人设层面仍成立），但不得出现与具体已删 UI（sidebar、多 pane 工作台）绑定的描述。

### 5.2 AGENTS.md 补例外条目

在多语言规则一节追加一条：原生托盘菜单文案（`src-tauri/src/lib.rs` 的 `desktop_tray_text()`）因 webview 未加载时读不到应用内 locale，允许按系统环境变量硬编码中英文双语，是唯一被认可的原生层文案例外；新增其它原生 UI 文案不得援引此例外。

## 六、守卫与测试

### 6.1 契约测试同步

- `scripts/test-window-architecture-phases.mjs`：删除对 `isEditorWindowRuntime` / `effectRunner` / `workspaceStore` 等已删符号的字符串断言，改为断言新现实（这些符号在 `src/` 中不再出现）。
- `scripts/test-editor-window-launch.mjs` 等涉及旧 editor 窗口语义的测试：逐个评估，语义已不存在的删除，转发层（`requestOpenEditorWindow` → Quick Editor）语义仍在的改写断言。
- package.json 中对应 `test:` 脚本条目同步增删。

### 6.2 已知局限的记录

本仓库契约测试是「源码文本正则匹配」，结构性看不见「文件在、路径不可达」。在 `scripts/` 目录 README 或 AGENTS.md 验证要求一节补一句说明，并引入 6.3 的补偿手段。

### 6.3 入口可达性检查脚本（新增）

新增 `scripts/check-reachability.mjs`（并加入 package.json）：

- 从 `src/main.tsx` 声明的窗口路由入口出发，静态遍历 import 图（含 lazy import），列出 `src/**/*.{ts,tsx}` 中不可达文件。
- 支持白名单文件（含理由注释），初始白名单：3.5 节的两处 Diff 资产、类型声明文件、测试辅助文件。
- 输出非空且不在白名单 → 退出码非 0。
- 实现允许自写轻量遍历（es-module-lexer / 正则提取 import 均可），不追求完美解析，够抓住「整棵子树孤儿化」即可；动态字符串拼接路径的 import 可以不支持，遇到时打印警告。
- 本包删除完成后运行，预期除白名单外清零——这同时是删除工作本身的验收手段。

## 七、执行顺序建议与验证

建议顺序（每步后跑一次完整验证，出问题好定位）：

1. 修复项 4.3（架构红线）——先让基线全绿。
2. 可达性脚本 6.3——先有尺子再动刀。
3. 删除 3.2 → 3.3 → 3.4（每删一块跑 build + 可达性）。
4. 修复项 4.1、4.2、4.4（4.4 需在删除 3.2 前先把 toast 两文件的新挂载点接好，避免中间态误删）。
5. 契约测试同步 6.1。
6. 文档更新 5.1、5.2。

完整验证命令（仓库规定）：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
node scripts/check-reachability.mjs
```

真机冒烟路径：

1. 托盘唤起 launcher → 打开系统设置页 → 切换到其它应用 → 设置页不消失。
2. Global Launcher 执行 text-diff compare → 出现「暂不可用」提示（中英文各验一次），无空窗口。
3. Launcher 搜索 / Quick Editor 进出 / detach 回巢等既有路径无回归（对照 `doc/2026-07-02-quick-editor-host-surface-design.md` 验证清单 1-7 抽测）。
4. 设置页不再出现 Pinned 相关开关。
5. 执行任意插件命令（如剪贴板历史删除一条）→ 出现成功 toast；构造一次失败（如断网跑翻译）→ 出现错误 toast。

## 八、风险与注意

- `isEditorWindowRuntime` 分支收敛面广（7-8 个文件），是本包最容易引入回归的部分。要求：每收敛一个文件即跑 build；false 分支展开时不改动其内部逻辑，只做「去分支」。
- store 持久化字段删除后，老用户 localStorage 中的残留字段必须被静默忽略（zustand persist 默认行为即如此，勿添加报错逻辑）。
- 删除量大，建议执行侧按 3.2 / 3.3 / 3.4 分三次提交，便于回滚定位。
- 后续包依赖声明：第二包（i18n）、第三包（Escape 统一）的审查证据行号在本包执行后会漂移，届时以符号名重新定位。
