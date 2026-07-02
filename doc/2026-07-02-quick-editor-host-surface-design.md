# Quick Editor Host Surface 化设计

日期：2026-07-02
分支：`refactor/workbench-window-architecture`

## 背景

Quick Editor 目前寄生在 standalone launcher 窗口内，通过 `globalLauncherMode === 'quick-editor'` 特殊分支渲染，继承了 launcher 的全部生命周期（blur close、resize、mode switch、native hotkey route）。该状态需要在五处代码中保持一致（Host 渲染分支、快捷键注销、blur 特判、resize 特判、Escape 特判），是 "Quick Editor 内按 Cmd+K 导致窗口消失" bug 的病灶。多次点状修复（`e165560`…`12b3b6b`）未根除问题。

## 目标

1. Quick Editor 改为 launcher 内的 host surface，与 system-settings 同一机制原地展开，删除 `quick-editor` mode 及全部特判。
2. 命令 overlay 复用 launcher 统一组件与键盘链，消除独立实现（含 IME 缺失的存量 bug）。
3. 支持"脱离"为独立窗口（单编辑器换宿主模型）。
4. 顺带删除已死的 `globalLauncherMode` 状态（`full`/`pinned-only` 在 `GlobalLauncherItems.ts:26` 被 `void mode` 忽略，无行为差异）。

## 非目标

- 不迁移 settings / plugin surface / permission 的 Escape 处理（见 Future Work）。
- 不给 detached 窗口做 NSPanel 提升、窗口位置记忆。
- 不改 plugin surface 的 blur/Escape 行为。

## 核心模型：单编辑器换宿主

全局只有一个 Quick Editor：一份内容与状态（`quickEditorStore`，zustand persist）。

- **默认宿主**：launcher host surface，从命令列表进入原地展开。
- **脱离（Detach）**：编辑器搬进独立窗口继续用，launcher 收起。同一 `QuickEditorPanel` 组件 + 同一 store，功能对齐天然成立。
- **脱离期间**：launcher 列表再选 Quick Editor → 聚焦已有独立窗口，不展开 surface、不新建实例。
- **回巢**：独立窗口关闭后内容留在 store，下次从 launcher 进入回到 surface 形态。
- 任一时刻编辑器只活在一个宿主中，无双实例并发写。

## 设计

### 1. 状态模型与入口

store（`src/store.ts`）：

- 删除 `GlobalLauncherMode` 类型及 `globalLauncherMode` 状态（含 `'full' | 'pinned-only'`）；`setGlobalLauncherOpen(open, mode?)` 去掉 mode 参数，`openGlobalLauncher(mode)` / `openGlobalLauncherOverlay(mode)` 改为无参。调用点：`App.tsx:167`、`pluginSurfaceOpenRequest.ts:57` 等同步删参。
- 删除 `openQuickEditor` / `closeQuickEditor` / `toggleQuickEditor`（`store.ts:428-436`）。
- `LauncherHostSurfaceTarget` 增加 `'quick-editor'`。
- `quickEditorCommandOpen` / `openQuickEditorCommand` / `closeQuickEditorCommand` 保留；`setGlobalLauncherOpen(false)` 时一并清 `quickEditorCommandOpen: false`。

入口（`hostActions.ts:182-200`，`host:view:quick-editor`）execute 改为：

1. `WebviewWindow.getByLabel('quick-editor')` 检查独立窗口是否存在；
2. 存在 → `showQuickEditorWindow()`（已有语义：show + focus）并关闭 launcher；
3. 不存在 → `openLauncherHostSurface('quick-editor')`。

### 2. 渲染与几何

- 删除 `GlobalLauncherHost.tsx:355-383` 的 quick-editor 渲染分支；Quick Editor 走 `GlobalLauncherPanel` → `GlobalLauncherFrameSwitch` host surface 通道。
- `GlobalLauncherSystemSurfaceFrame` 增加 `target === 'quick-editor'`：`SurfaceBreadcrumbHeader`（返回 / 关闭）+ `QuickEditorPanel`。
- 新增 host surface shell 配置表（launcher 层声明式配置，替代散落特判）：

  ```ts
  const HOST_SURFACE_SHELL: Partial<Record<LauncherHostSurfaceTarget, { closeOnBlur?: boolean }>> = {
    'quick-editor': { closeOnBlur: false },
  }
  ```

  `useCloseStandaloneLauncherOnBlur`（`GlobalLauncherHost.tsx:216` 三元特判改读此表）消费。
- 尺寸：跟随 host surface 通用尺寸 920×760（`STANDALONE_SURFACE_MAX_WIDTH/HEIGHT`），删除 `GlobalLauncherGeometry.ts:45-50` 的 mode 特判，无需 per-target 尺寸配置。
- `QuickEditorToolbar` 保留在 Panel 内（语言标签 + Detach 按钮）；breadcrumb 管导航，toolbar 管编辑器自身。
- 删除 `GlobalLauncherHost.tsx:100-111` 输入源 effect 的 mode 特判（surface 化后不存在 mode 翻转触发的输入源切换）。

### 3. 键盘与快捷键

**Cmd+K（surface 内）**：保留现有双层拦截——React `onKeyDownCapture`（`QuickEditorPanel.tsx:37-43`）+ Monaco `addAction`（`:112-122`）→ `openQuickEditorCommand()`。

**全局快捷键**（`hiven://route-global-pinned-launcher-shortcut` 广播到 main 与 launcher 两个 webview）：

- `routeGlobalPinnedLauncherShortcut`（`globalPinnedLauncher.ts:195`）判断从 `mode === 'quick-editor'` 改为 `launcherHostSurfaceTarget === 'quick-editor'` → 打开命令 overlay。
- `syncShortcutNow` 的"Quick Editor 激活时注销 Cmd+K 类 accelerator"机制保留，条件同步改为 hostSurfaceTarget（`:27-29`、`:90-98`）。这是必要机制而非特判：accelerator 在系统层吞掉按键，其 handler 可能运行在 main webview（store 不跨窗口实时同步），注销后按键才能落到 launcher webview DOM 由窗口内拦截可靠处理。

**Escape 通用接管协议**（新增 `src/components/launcher/launcherEscapeInterceptor.ts`）：

- launcher 层通用机制，不含产品语义：`useLauncherEscapeInterceptor(handler: (event: KeyboardEvent) => boolean)`，单注册槽，挂载注册、卸载注销。
- `useGlobalLauncherHostEscape` 在 IME 检查后先询问 interceptor：返回 `true` = 页面已接管，默认链不执行；`false` = 走默认链。是否 `preventDefault` 由接管者决定。
- host 默认链（settings → plugin surface → host surface → permission → controller.back → 关窗）本次原样保留，仅删除 `GlobalLauncherHostLifecycle.ts:130-139` 的 quick-editor mode 特判。

**Quick Editor 两段式 Escape**（产品逻辑收归 `src/components/quickEditor/`，如 `useQuickEditorEscapeTakeover`）：

```ts
(event) => {
  if (命令 overlay 打开) return true            // overlay 在 bubble 阶段自行处理
  if (提示窗口期内) { 退出动作(); preventDefault; return true }
  显示"再按一次 Esc 返回"轻提示（约 1.5s，surface 内底部 hint）
  return true                                   // 第一次不 preventDefault，Monaco 可处理 find widget 等
}
```

- surface 宿主的退出动作 = `clearLauncherHostSurface()`（返回列表）；detached 宿主 = 关闭窗口。动作作为参数注入，两处复用同一 hook。

### 4. 命令 overlay 重构

`QuickEditorCommandOverlay` 现状已半复用（controller frame 态走 `GlobalLauncherFrameSwitch`），本次收尾：

- list 态也走 `GlobalLauncherFrameSwitch`（`GlobalLauncherSearchFrame` 通道），删除自绘输入框、列表与 `CommandOverlayItem`。
- 键盘处理换成 `handleGlobalLauncherKeyDown`，以 overlay 语义参数化（`closeLauncher → closeQuickEditorCommand`，surface/settings/permission 参数传空值）。自动获得 IME composition 保护，消除现状 Enter 无 IME 检查、中文上屏误触发命令的存量 bug。
- 接线 `onCompositionStart/End`（复用 `useGlobalLauncherImeComposition`）。
- session 机制不变：`useLauncherSession({ hostId: 'quick-editor-command', makeApi: createQuickEditorLauncherApi })`。

### 5. Detach 与独立窗口

- Detach 按钮（`QuickEditorToolbar.tsx:15-23`）：`showQuickEditorWindow()` 成功后调用 `closeLauncher()`（原 `closeQuickEditor` 已删除）。内容经 persist store 自然移交（同步写 localStorage，新窗口 rehydrate 读到最新值）。
- 回巢：独立窗口关闭无需额外逻辑。
- `QuickEditorDetachedView.tsx` 补齐：
  - Escape 从直接销毁窗口改为复用两段式 hook（第二次 Esc = 关闭窗口）；
  - Toolbar 在 detached 模式显示关闭按钮（窗口 `decorations: false` 无系统关闭钮）；
  - 保持普通可激活窗口，不做 NSPanel 提升（Cmd+K 走窗口内拦截，无 NSPanel 修饰键问题）。
- Rust 侧 `show_quick_editor_window` / `close_quick_editor_window` 保留不动。

### 6. 特判清理清单

| 位置 | 现状 | 处置 |
|---|---|---|
| `GlobalLauncherHost.tsx:355-383` | quick-editor 渲染分支 | 删，走 host surface 通道 |
| `GlobalLauncherHost.tsx:216` | closeOnBlur 三元特判 | 改读 shell 配置表 |
| `GlobalLauncherHost.tsx:100-111` | 输入源 mode 特判 | 删 |
| `GlobalLauncherGeometry.ts:45-50` | mode 尺寸特判 | 删，host surface 通用尺寸 |
| `GlobalLauncherHostLifecycle.ts:130-139` | Escape mode 特判 | 删，interceptor 协议 |
| `globalPinnedLauncher.ts:27-29, 90-98, 195` | mode 检查 ×3 | 条件改为 hostSurfaceTarget |
| `store.ts` | `globalLauncherMode` 全套 | 整个删除（含 full/pinned-only） |
| `GlobalLauncherKeyboard.ts:171-176` | quick-editor 检查 | 删 |

### 7. i18n 与错误处理

- 新增 `quickEditor` locale namespace（`src/i18n/locales/`），覆盖：面板标题、Detach / 关闭按钮 title、"Run a command..." placeholder、"No commands found"、Esc 轻提示文案。现存硬编码文案均在本次改动文件内，随改动收编，中英文同步补齐。
- `showQuickEditorWindow` / `closeQuickEditorWindow` 调用点补 try-catch 与 `console.warn`（现 DetachedView Esc 处理无错误处理）。

## Future Work

- **Escape 链迁移（TODO）**：将 settings / plugin surface / permission 各页面的 Escape 处理逐个迁移到 interceptor 协议，host 默认链最终瘦身为「IME 检查 → interceptor → controller.back → 关窗」。本次仅 Quick Editor 接入。在 `useGlobalLauncherHostEscape` 留代码 TODO 注释。

## 验证

命令验证：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

真机手动路径：

1. surface 内 Cmd+K 连按多次，launcher 窗口不消失（原 bug 路径）；
2. 两段式 Esc：overlay 打开时先关 overlay；编辑器内第一次 Esc 出提示（Monaco find widget 打开时正常关闭 widget）、第二次返回列表、列表 Esc 关窗；
3. blur（点击窗口外 / 切换 app）不关闭 surface；
4. 命令 overlay 中文 IME 输入，Enter 上屏不误触发命令确认；
5. Detach → 内容带到独立窗口 → launcher 重开显示命令列表 → 列表选 Quick Editor 聚焦独立窗口；
6. 独立窗口两段式 Esc 关闭 → 从 launcher 进入回到 surface 形态、内容保留；
7. 全局快捷键在 surface 激活时打开命令 overlay；关窗重开回到命令列表。

## 风险

原 bug 根因未实锤定位（macOS non-activating NSPanel 对 Cmd 修饰键的特殊路由仍是嫌疑）。本次删除了全部 mode 寄生路径（最大嫌疑群）；若 bug 在 NSPanel 层面残留，detached 普通窗口是逃生舱，验证阶段若复现则单独立案调查。
