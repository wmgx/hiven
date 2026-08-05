# 剪贴板历史 ⌘/Ctrl+Enter 带回 Global Launcher（Object Block）设计

**日期:** 2026-07-19
**状态:** 已确认 · 可关评审开工
**产品:** hiven
**读者:** 执行 AI / 评审 / 后续维护者（假定对代码库零了解；断言均附路径）
**关联:**

- Object Block 模型：`src/launcher/clipboard/objectBlock.ts`（已预留 `source: 'history-item'` 与 `createHistoryItemObjectBlock`，仅文本形态）
- 剪贴板挂载 hook：`src/launcher/clipboard/useClipboardObjectBlock.ts`（打开时 `readClipboard`，会覆盖 block）
- 推荐与执行：`src/launcher/clipboard/actionRecommendation.ts`、`src/launcher/clipboard/actionExecutor.ts`
- ranking 文本抬分：`src/workspace/launcher/useLauncherSession.ts`（`objectBlockText`）、`src/workspace/launcher/ranking.ts`（`textMatch` / `TEXT_MATCH_BOOST`）
- Surface host API：`src/workspace/pluginTypes.ts` `PluginSurfaceHostApi`；注入点 `src/components/pluginSurface/PluginSurfaceRenderer.tsx`
- Pending open 先例：`src/workspace/pluginSurfaceOpenRequest.ts`（localStorage + TTL + consume-once）
- 插件 surface：`src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx`
- 边界约定：`Agents.md`、`doc/diff-plugin-boundary-decision.md`

---

## 1. 背景与目标

### 1.1 现状

剪贴板历史 surface 当前：

| 快捷键 | 行为 |
|--------|------|
| Enter | 粘贴到前台应用并关闭（`host.paste` + `host.close`） |
| ⌘/Ctrl+C | 仅复制预览区 DOM 选区文本 |
| Delete / Backspace | 软删 + toast 撤销 |

**缺口：** 没有「把历史项交给 Global Launcher 做二次动作」的路径。用户若想对历史里的旧文本做 Base64 / 翻译 / 格式化，只能：粘贴上屏 → 再复制 → 再开 Launcher，或手动复制预览。

Global Launcher 已有 Object Block 三段式产品语义（Object → Action → Output），且 `objectBlock.ts` 已预留：

- `ObjectBlockSource: 'history-item'`
- `createHistoryItemObjectBlock(...)`（目前仅文本形态、**未接任何 UI 入口**）

### 1.2 目标

在剪贴板历史中 **⌘/Ctrl+Enter** 将当前选中项挂成 Object Block，并**统一回到 Global Launcher**，以便使用推荐动作（文本变换、粘贴、复制等）。

成功标准（用户可感知）：

1. 历史项 → 一步进入 Launcher，输入行出现 Object Block token（source 为剪贴板历史）。
2. 文本项可立即享受现有 textMatch / 插件动作抬分；图/文件有明确可执行动作（粘贴 / 复制）。
3. Enter 粘贴语义完全不变；中英文 footer 提示齐全。

### 1.3 非目标（一期）

- Object-first 大重构 / 复活 `RecommendedActionRow` 整套 UI（见 §3.5 现状裁决）
- 图片 OCR / 文件内容语义检测推荐
- 多选历史项
- 改变 Enter 粘贴语义
- 插件直接 import host 私有模块（`useClipboardObjectBlock`、`objectBlock` factory 等）
- 记 `pasteCount`（带回 launcher ≠ 粘贴上屏）
- 独立窗 detach 后强制跨窗通信（一期尽力；不可达 toast）

---

## 2. 产品行为

### 2.1 快捷键矩阵

| 快捷键 | 行为 |
|--------|------|
| Enter | **不变**：粘贴到前台 → 关 surface |
| ⌘/Ctrl+Enter | 选中项 → Object Block → 统一打开/回到 Global Launcher |

### 2.2 入口统一（两种进入历史的路径，同一结果）

| 进入历史的方式 | ⌘Enter 后行为 |
|----------------|---------------|
| 从 Global Launcher 压栈进历史（tool surface frame） | 退出 surface frame，**留在 launcher**，挂上块 |
| 从全局快捷键 / 独立窗直进历史 | 关闭 history shell，**打开 Global Launcher**，挂上块 |

产品语义一句：**无论从哪进历史，⌘Enter 的目的地永远是 Global Launcher + Object Block。**

### 2.3 三种 kind 载荷

| kind | Object Block 载荷 | token 展示 |
|------|-------------------|------------|
| text | `payloadText` + content-detect kind（json/url/…） | 预览截断文本 |
| image | `payloadImage: { blobId, contentType, width?, height? }` | 标题「剪贴板历史」+ 副标年龄/尺寸；无正文预览可显示 kind 标签 |
| files | `payloadFiles: { paths, fileNames }` | 文件名摘要；无正文预览 |

`source` 固定为 `'history-item'`。

### 2.4 一期推荐动作

| 块类型 | 动作 | 说明 |
|--------|------|------|
| text | 沿用现有路径 | `objectBlockText = payloadText` → ranking `textMatch` 抬分 + 既有插件命令；**不**依赖已禁用的 `RecommendedActionRow` |
| image | 粘贴图片、复制回系统剪贴板 | host 侧注入列表项或专用动作（见 §3.5） |
| files | 粘贴文件、复制路径 / `writeFiles` | 同上 |

### 2.5 UI 文案

footer / hint 增加一行：

- zh：`⌘↵ 带回 Launcher`（Windows/Linux 用 `Ctrl↵`，与现有平台 hint 惯例一致）
- en：`⌘↵ Return to Launcher` / `Ctrl↵ Return to Launcher`

**禁止 hardcode**；走 `src/plugins/clipboard-history/locales/{zh,en}.json`。

---

## 3. 架构

### 3.1 原则

```text
产品逻辑在 clipboard-history 插件
host 提供通用能力：returnToLauncherWithObject
挂块内容是历史项快照，不是当前系统剪贴板
打开 launcher 时不得用 readClipboard 结果覆盖 pending history block
插件 ↛ import useClipboardObjectBlock / objectBlock 内部实现
```

依赖方向：

```text
clipboard-history → PluginSurfaceHostApi（public SDK）
host → objectBlock factory + pending bridge + open launcher
plugins ↛ host 私有 launcher/clipboard 模块
```

### 3.2 现状关键事实（执行前请现场核对行号）

| # | 事实 | 证据 |
|---|------|------|
| 1 | `PluginSurfaceHostApi` 尚无 `returnToLauncherWithObject` | `src/workspace/pluginTypes.ts` ~L599–611 |
| 2 | host 注入在 `PluginSurfaceRenderer` 内联对象 | `src/components/pluginSurface/PluginSurfaceRenderer.tsx` ~L169–201 |
| 3 | `createHistoryItemObjectBlock` 仅接受 `text` | `objectBlock.ts` ~L306–324 |
| 4 | `LauncherObjectBlock` 仅有 `payloadText`，无 image/files 载荷 | `objectBlock.ts` ~L55–73 |
| 5 | 打开 launcher 时 hook 异步读剪贴板并 `setBlock` | `useClipboardObjectBlock.ts` ~L50–98（180ms 延迟） |
| 6 | 列表推荐主路径是 ranking + `objectBlockText`，**不是** `RecommendedActionRow` | `GlobalLauncherSearchFrame.tsx` L64 硬编码空数组；`GlobalLauncherPanel.tsx` L170–173 `hasObjectActions: false` |
| 7 | `recommendActionsForBlock` 对 `source === 'history-item'` 走 `FALLBACK_ACTIONS` | `actionRecommendation.ts` L428–435 |
| 8 | Enter 粘贴完整实现（含 index-only 加载全文） | `ClipboardHistorySurface.tsx` `handlePaste` ~L235–267；`handleKeyDown` Enter ~L403–408 |
| 9 | footer 仅 paste / delete 两项 | `ClipboardHistorySurface.tsx` ~L598–601 |
| 10 | pending open 先例：localStorage + 30s TTL + consume-once | `pluginSurfaceOpenRequest.ts` |

### 3.3 Host API

扩展 `PluginSurfaceHostApi`（`pluginTypes.ts` + `plugin-sdk.ts` 再导出）：

```ts
returnToLauncherWithObject(block: PluginObjectBlockInput): void

type PluginObjectBlockInput =
  | { kind: 'text'; text: string; ageLabel?: string }
  | {
      kind: 'image'
      blobId: string
      contentType: string
      width?: number
      height?: number
      ageLabel?: string
    }
  | {
      kind: 'files'
      paths: string[]
      fileNames: string[]
      ageLabel?: string
    }
```

**不**把 `LauncherObjectBlock` 整型暴露给插件——插件只提交中立 input，host 负责建成内部 block（source 强制 `'history-item'`）。

`PluginSurfaceRenderer` 注入实现；其它 surface 也可调用（一期只有 clipboard-history 使用，API 仍保持通用命名）。

### 3.4 Pending Object Block bridge

对标 `pluginSurfaceOpenRequest` 的 pending 模式，新建：

**建议路径：** `src/launcher/clipboard/pendingObjectBlock.ts`

```text
plugin: host.returnToLauncherWithObject(input)
  → host 建成 LauncherObjectBlock (source: 'history-item')
  → setPendingObjectBlock(block)   // 模块级内存 + 可选 localStorage（跨 webview 时需要）
  → 清除 plugin surface frame / pluginSurfaceToolTarget
  → openGlobalLauncherOverlay() + 必要时 showLauncherWindow()
  → useClipboardObjectBlock 在 open 时优先 consumePendingObjectBlock()：
       setBlock(block)，跳过当次 readClipboard 覆盖
```

规则：

| 规则 | 值 |
|------|-----|
| TTL | 10s（短于 surface open 的 30s；本路径几乎同步） |
| 消费 | 一次 consume 即清除 |
| 与剪贴板自动挂载 | 有 pending 时，当次 open **不得**用 `readClipboard` 覆盖 |
| 跨窗 | 若 history 在独立 plugin-surface 窗、launcher 在另一窗：pending 需可跨 webview 投递（优先 localStorage 键 + launcher 侧 open 时 consume；与 `pluginSurfaceOpenRequest` 同构）。同窗压栈路径可仅用内存。 |

实现建议：内存为默认；若 `returnToLauncherWithObject` 检测到当前不在 launcher webview，则额外写入 localStorage key（如 `hiven-pending-object-block`），launcher 打开时先 consume。

### 3.5 Object Block 模型扩展

`LauncherObjectBlock` 增量字段（向后兼容）：

```ts
payloadText?: string  // 已有
payloadImage?: {
  blobId: string
  contentType: string
  width?: number
  height?: number
}
payloadFiles?: {
  paths: string[]
  fileNames: string[]
}
```

`ObjectBlockKind` 扩展：

```ts
| 'image'
| 'files'
```

（或等价专用 kind；最小改动优先：新增两个 kind 字面量，KIND_LABELS 补中英文标签——注意 label 走 i18n 的长期债：现 `getKindLabel` 硬编码英文，一期可跟现网一致，token 对用户主要看 preview/title。）

工厂：

- 扩展 `createHistoryItemObjectBlock` 支持三形态（推荐重载 / 联合参数），**不要**拆三个公开工厂除非调用方更清晰。
- text：沿用 detect kind + `payloadText`；`removable: true`（用户应能 ⌫ 去掉块；现工厂写 `removable: false`，一期改为 `true` 与剪贴板块一致，除非产品明确钉死不可删）。
- image/files：`payloadText` 空；`preview` 可用 fileNames 拼接或「图片」占位；`objectBlockText` 为空 → ranking 不走 textMatch。

### 3.6 推荐动作与执行（关键裁决）

**现状：** 文本智能推荐主路径是：

```text
clipboardBlock.block.payloadText
  → objectBlockText
  → useLauncherSession ranking contentText
  → 插件 textMatch 抬分
```

`RecommendedActionRow` / `onExecuteAction` 专用 UI **已禁用**（`hasObjectActions: false`）。

因此一期策略：

| 类型 | 策略 |
|------|------|
| text history-item | **只挂块 + payloadText**。不复活 RecommendedActionRow。用户在混排列表里看到抬分后的插件命令，行为与「剪贴板自动挂块」一致。 |
| image / files | textMatch 无效。必须 **host 侧注入动作**： |
| | **方案 A（推荐，改动面小）：** 在 `recommendActionsForBlock` 增加 `history-item` + image/files 分支；在 `GlobalLauncherHost` 把这些动作 **merge 进可见列表** 作为伪 `LauncherItem`（或临时重开 `hasObjectActions` 仅当 `block.kind` 为 image/files）。 |
| | **方案 B：** 新建 host dynamic provider，当 block 为 image/files 时产出「粘贴图片」「复制图片」等项。 |

**拍板：方案 A 的最小实现**——当 `block.kind` 为 `image` 或 `files` 时，打开 `hasObjectActions` 子集（或把动作映射为 list 顶部固定项），执行走 `executeRecommendedAction` 扩展分支。text 仍走 ranking，避免双轨 UI。

`executeRecommendedAction` / handlers 增量：

| 动作 id（建议） | 执行 |
|-----------------|------|
| `paste-history-image` | `handlers.pasteImage?.(blobId)` 或复用 paste API |
| `copy-history-image` | `clipboard.writeImage(blobId)` |
| `paste-history-files` | `pasteFiles(paths)` |
| `copy-history-file-paths` | `copyText(paths.join('\n'))` |
| `copy-history-files` | `writeFiles(paths)`（若平台支持） |

handlers 需在 `ActionExecutionHandlers` 增加可选 `pasteImage` / `writeImage` / `pasteFiles` / `writeFiles`；`GlobalLauncherHost` 注入实现。

`recommendActionsForBlock`：

```ts
if (block.source === 'history-item') {
  if (block.kind === 'image') return IMAGE_HISTORY_ACTIONS
  if (block.kind === 'files') return FILES_HISTORY_ACTIONS
  // text：返回 []，交给 ranking；或返回与 clipboard 相同的 TEXT 表但不渲染专用行
  return []
}
```

文本 history-item **不要**再塞一套静态 TEXT_ACTIONS 双轨列表，避免与 ranking 重复。

### 3.7 插件侧

`ClipboardHistorySurface.handleKeyDown` 扩展：

```text
(meta|ctrl)+Enter
  → IME 检查（同 Enter：imeKeyDown.shouldIgnoreKeyDown）
  → 无 selectedItem 则 return
  → load full item（与 handlePaste 相同的 index-only 补全逻辑）
  → map 为 PluginObjectBlockInput
  → host.returnToLauncherWithObject(input)
  // 不调用 paste，不 recordPaste，不 host.close（由 host 决定关 surface / 退栈）
```

映射：

```ts
function toObjectBlockInput(item: ClipboardHistoryItem, ageLabel?: string): PluginObjectBlockInput | null {
  if (item.kind === 'text') {
    if (!item.text) return null
    return { kind: 'text', text: item.text, ageLabel }
  }
  if (item.kind === 'image') {
    if (!item.blobId) return null
    return { kind: 'image', blobId: item.blobId, contentType: item.contentType, width: item.width, height: item.height, ageLabel }
  }
  if (item.kind === 'files') {
    if (!item.paths?.length) return null
    return { kind: 'files', paths: item.paths, fileNames: item.fileNames, ageLabel }
  }
  return null
}
```

`ageLabel`：可用 `formatAgeLabel(Date.now() - item.lastCopiedAt)`；若插件不宜依赖 host 的 formatAgeLabel，可只传 ms 或省略（host 再算）。

host 实现 `returnToLauncherWithObject` 时应：

1. 校验 input → 建 block
2. setPending
3. `clearPluginSurfaceTool()` / surface leave（压栈路径：`requestBack` 等价，回到 list frame）
4. `openGlobalLauncherOverlay()`；Tauri 下必要时 `showLauncherWindow()`
5. **不要** `host.close()` 从插件侧关死整个 launcher（压栈场景要保留 launcher）

插件只调 `returnToLauncherWithObject`；关 surface / 退栈由 host API 内部完成，避免插件猜测自己在独立窗还是压栈。

### 3.8 时序（压栈路径）

```text
用户在 launcher 内打开剪贴板历史 surface
  → 选中项 ⌘Enter
  → plugin: host.returnToLauncherWithObject(input)
  → host: build block → pending
  → host: clearPluginSurfaceTool / leaveSurface（回 list）
  → host: 确保 launcher open
  → useClipboardObjectBlock(open=true): consume pending → setBlock
  → 跳过 readClipboard 覆盖
  → objectBlockText = payloadText（text）→ ranking 抬分
```

### 3.9 时序（全局快捷键 / 独立窗路径）

```text
用户全局快捷键打开历史（独立窗或 launcher 工具壳）
  → 选中项 ⌘Enter
  → plugin: host.returnToLauncherWithObject(input)
  → host: build block → pending（必要时 localStorage）
  → host: 关闭独立 surface 窗 / 清 tool target
  → host: showLauncherWindow + openGlobalLauncherOverlay
  → launcher webview: consume pending → setBlock
```

---

## 4. 错误处理与边界

| 场景 | 行为 |
|------|------|
| 无选中项 | 忽略 |
| index-only 加载全文失败 | toast `error.loadFailed`（若无此 key 则复用 `error.pasteFailed` 或新增 `error.returnFailed`），**不离开** surface |
| image 缺 blobId / files 缺 paths | toast 失败，不离开 |
| 文本为空串 | toast 失败，不离开 |
| IME composition | 忽略（同 Enter） |
| 搜索框有 query | 仍对当前列表选中项生效 |
| pending 超时 | 丢弃；launcher 正常读剪贴板 |
| 系统剪贴板与历史项不同 | 有 pending 时不覆盖 |
| 图/文件动作失败 | toast，launcher 保持打开 |
| detach 独立窗且无法打开 launcher | toast `error.returnFailed` |
| 用户已在 launcher 且仅退栈 | 不闪关主窗 |

---

## 5. i18n

`src/plugins/clipboard-history/locales/zh.json` / `en.json` 新增：

| key | zh | en |
|-----|----|----|
| `hint.returnToLauncher` | 带回 Launcher | Return to Launcher |
| `error.returnFailed` | 无法带回 Launcher | Could not return to Launcher |
| `error.loadFailed` | 加载条目失败 | Failed to load item |

footer：

```tsx
<span>↵ {t('hint.paste')}</span>
<span>{modSymbol}↵ {t('hint.returnToLauncher')}</span>
<span>⌫ {t('hint.delete')}</span>
```

`modSymbol` 与项目其它 footer 一致（⌘ / Ctrl）。

若 Object Block 源标签「剪贴板历史」仍 hardcode 在 `SOURCE_LABELS`（`objectBlock.ts`），**本期可不动**（属既有债，列入 UI i18n 清理包时再收）；禁止在插件内再 hardcode 一套。

---

## 6. 主要改动面（实现索引）

| 区域 | 文件（预期） | 改动 |
|------|----------------|------|
| API 类型 | `src/workspace/pluginTypes.ts`、`src/plugin-sdk.ts` | `PluginObjectBlockInput` + `returnToLauncherWithObject` |
| Surface host 注入 | `src/components/pluginSurface/PluginSurfaceRenderer.tsx` | 实现并注入 API |
| Pending bridge | **新建** `src/launcher/clipboard/pendingObjectBlock.ts` | set / consume / TTL / 可选 localStorage |
| Object Block 模型 | `src/launcher/clipboard/objectBlock.ts` | payloadImage/Files、kind、工厂 |
| Hook 消费 pending | `src/launcher/clipboard/useClipboardObjectBlock.ts` | open 时优先 pending，跳过覆盖 |
| 打开 launcher | `src/store.ts` `openGlobalLauncherOverlay`；必要时 `windowManager/launcherWindow` | host 调用 |
| 推荐动作 | `src/launcher/clipboard/actionRecommendation.ts` | image/files history 动作表 |
| 执行 | `src/launcher/clipboard/actionExecutor.ts` + Host handlers | 非文本分支 |
| 列表接线 | `src/launcher/hosts/GlobalLauncherHost.tsx`（及 Panel/Keyboard 若重开 object actions） | image/files 动作可见可执行 |
| Token UI | `src/components/launcher/ObjectBlockToken.tsx` | 无 preview 时回退 title；**可选**顺手 i18n 硬编码（若动则中英齐全） |
| 插件 UI | `src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx` | ⌘Enter + footer |
| i18n | `src/plugins/clipboard-history/locales/{en,zh}.json` | 上表 keys |
| 插件版本 | `src/plugins/clipboard-history/manifest.json` | 行为变更必须 bump version |

---

## 7. 验收标准

1. **文本** ⌘Enter → launcher 显示 history-item Object Block，payload 为历史正文（非当前系统剪贴板）；可对块内文本跑现有 textMatch 命令。
2. **图片** ⌘Enter → 有 token；可「粘贴图片」到前台 / 「复制到剪贴板」。
3. **文件** ⌘Enter → 有 token；可粘贴文件 / 复制路径。
4. 从 launcher 进历史再 ⌘Enter：回到列表帧，无残留 surface，launcher 不关。
5. 全局快捷键直进再 ⌘Enter：launcher 打开并挂块。
6. Enter 粘贴路径回归不变（含 pasteCount、关窗）。
7. IME 组字中 ⌘Enter 不触发。
8. 中英文 footer / 错误文案齐全。
9. 插件不 import `src/launcher/clipboard/*` 私有路径；`npm run check:architecture` 通过。
10. `npm run build`、`git diff --check` 通过。

---

## 8. 测试建议

| 类型 | 覆盖 |
|------|------|
| unit | `createHistoryItemObjectBlock` 三形态（text/image/files 字段、source、kind） |
| unit | pending bridge：set → consume → 二次 consume 为 null；TTL 过期丢弃 |
| unit | `recommendActionsForBlock`：history-item + image/files 返回动作；text 不双轨刷屏 |
| unit | `executeRecommendedAction` image/files 分支 mock handlers |
| 可选契约 / 组件 | ⌘Enter 不调用 `paste*`，会调 `returnToLauncherWithObject` |
| 手测 | 压栈路径 + 独立窗路径各走一遍 text/image/files |

---

## 9. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 带回形态 | 挂成 Object Block（非仅写剪贴板、非填 query） | 与 Launcher 三段式一致；可二次动作 |
| kind 范围 | text + image + files | 与历史数据模型对齐 |
| 图/文件策略 | 扩展 Object Block 载荷，非写回系统剪贴板兜底 | 避免污染系统剪贴板；blobId 仍可用 |
| 入口 | 无论 launcher / 快捷键，统一回 Global Launcher + 挂块 | 单一心智 |
| pasteCount | 不记录 | 未上屏 |
| 文本推荐 UI | 不复活 RecommendedActionRow；走 ranking | 与现网 clipboard 挂块一致 |
| 图/文件推荐 UI | host 注入动作（方案 A） | textMatch 无效时的最小补齐 |
| API 形状 | 中立 `PluginObjectBlockInput`，非暴露 `LauncherObjectBlock` | 插件边界 |

---

## 10. 实施计划（原子任务，执行 AI 按序）

> 假设执行者零上下文。每步可独立验证。TDD：单测与实现可分 agent，禁止同一 agent 又写测又改实现又自判通过（见全局 TDD 职责隔离）；若平台仅单 agent，须在提交说明中显式声明降级。

### Task 1: Pending bridge

**Files:** Create `src/launcher/clipboard/pendingObjectBlock.ts`；可选 `*.test.ts`

- `setPendingObjectBlock(block)` / `consumePendingObjectBlock(): block | null`
- TTL 10s；consume 后清空
- 可选：`setPendingObjectBlockPersistent` 写 localStorage（跨窗）

**验证:** unit set/consume/TTL

### Task 2: Object Block 模型

**Files:** Modify `src/launcher/clipboard/objectBlock.ts`

- 增 `payloadImage` / `payloadFiles`、`ObjectBlockKind` 的 `image` | `files`
- 扩展 `createHistoryItemObjectBlock`；text 保持 detect；image/files 填专用载荷
- `removable: true`（与剪贴板块可 ⌫ 一致）

**验证:** unit 三形态

### Task 3: Host API 类型 + 注入

**Files:** `pluginTypes.ts`、`plugin-sdk.ts`、`PluginSurfaceRenderer.tsx`

- 类型 + 注入 `returnToLauncherWithObject`
- 实现：input → factory → pending → clear surface tool → open launcher

**验证:** 类型检查；手工可从临时调用点验证（或 Task 6 一并手测）

### Task 4: Hook 消费 pending

**Files:** `useClipboardObjectBlock.ts`

- `open` 时先 `consumePendingObjectBlock()`
- 命中则 `setBlock`，**当次**不跑 readClipboard 覆盖逻辑（`didReadRef` 仍置位，避免后续 effect 再覆盖）

**验证:** unit 或集成级 mock

### Task 5: image/files 推荐与执行

**Files:** `actionRecommendation.ts`、`actionExecutor.ts`、`GlobalLauncherHost.tsx`（handlers + 可见性）

- IMAGE/FILES 动作表
- executor 分支 + handlers
- 仅 image/files 让动作出现在 UI（text 不双轨）

**验证:** unit 分发；手测两项动作

### Task 6: 插件快捷键 + i18n + 版本

**Files:** `ClipboardHistorySurface.tsx`、locales、`manifest.json`

- ⌘Enter 路径 + footer
- bump 插件版本

**验证:** 验收标准 1–8 手测清单

### Task 7: 仓库验证

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

---

## 11. 明确禁止

1. 插件 `import` `src/launcher/clipboard/**` 或 `useClipboardObjectBlock`
2. ⌘Enter 写系统剪贴板「假装」成挂块
3. 改变 Enter 粘贴 / pasteCount 语义
4. 为文本 history-item 同时渲染 RecommendedActionRow + ranking 双列表
5. hardcode 中英文 footer
6. 一次 PR 顺手做 OCR / 多选 / Object-first 重构

---

## 12. 文档状态

- [x] 背景 / 目标 / 非目标
- [x] 产品行为与入口统一
- [x] 架构与现状证据
- [x] API / pending / 模型 / 推荐裁决
- [x] 错误边界
- [x] i18n keys
- [x] 改动面索引
- [x] 验收与测试
- [x] 决策记录
- [x] 原子实施计划
- [x] 禁止事项

**结论：设计完成，可交执行 AI 按 §10 开工。**
