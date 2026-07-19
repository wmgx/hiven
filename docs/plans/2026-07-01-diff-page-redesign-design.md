# Text Diff 插件重设计 - 全屏页面方案

> **日期**: 2026-07-01
> **状态**: 已确认

## 目标

将 Text Diff 从 pane renderer overlay + 独立窗口 改为编辑器内全屏页面切换，统一来源选择交互。

## 核心决策

| 决策点 | 选择 |
|--------|------|
| 页面承载方式 | 替换 EditorView（条件渲染） |
| 来源选择交互 | Launcher 内多选 |
| 2 pane 快捷路径 | 不保留，统一弹选择列表 |
| Diff 可编辑性 | 全部可编辑；editor-pane 同步回原 pane，clipboard/empty 不同步 |

## 架构

### 数据流

```
用户唤起 Launcher → 选择 "文本对比" 命令
    → Launcher 展示来源列表（当前 pane 们 + 剪贴板）
    → 用户勾选 2 个来源
    → 触发 workspace action: openDiffPage({ original, modified })
    → workspaceStore.activeFullscreenView = { type: 'diff', original, modified }
    → EditorView 条件渲染：activeFullscreenView ? <DiffPageView /> : <正常编辑器>
    → DiffPageView 内 ESC → clearActiveFullscreenView()
    → 回到正常编辑器
```

### workspace store 新增

```ts
// 新字段
activeFullscreenView: null | { type: 'diff'; original: DiffSource; modified: DiffSource }

// 新 actions
openDiffPage(payload: { original: DiffSource; modified: DiffSource }): void
clearActiveFullscreenView(): void
```

### 来源类型

| kind | 说明 | 文本获取 | 可编辑 | 同步 |
|------|------|----------|--------|------|
| `editor-pane` | 当前编辑器内的 pane | 实时引用 paneId | ✓ | 同步回原 pane |
| `clipboard` | 系统剪贴板 | 打开时快照 | ✓ | 不同步 |
| `empty` | 新建空白 | 空字符串 | ✓ | 不同步 |

### DiffPageView 组件结构

```
DiffPageView
├── DiffToolbar
│   ├── 标题 "文本对比"
│   ├── 来源名称: "Panel A ↔ 剪贴板"
│   ├── 模式切换: [按行] / [JSON]
│   └── 关闭按钮 (ESC)
└── DualEditorView (复用现有 kit)
    ├── Left Monaco (original, 可编辑)
    └── Right Monaco (modified, 可编辑)
```

### 关键行为

1. **ESC 关闭**: 全局 keydown 监听，ESC → `clearActiveFullscreenView()`
2. **可编辑同步**: `editor-pane` 修改通过 `onLeftChange` / `onRightChange` 写回 workspace store pane text
3. **diff 高亮**: 复用 `kits/diff` 的 `computeTextLineDiff` 和 JSON semantic diff
4. **语言检测**: 从原 pane 的 language 继承，clipboard/empty 默认 plaintext
5. **JSON 模式**: 两侧都是合法 JSON 时可切换 JSON 语义对比

## 变更清单

### 删除

| 文件/内容 | 原因 |
|-----------|------|
| `TextDiffSurface.tsx` | textarea 独立窗口版本 |
| `index.tsx` 中 `ui.surfaces` | 不再注册 plugin surface window |
| `index.tsx` 中 `renderers` | 不再使用 pane renderer overlay |
| `index.tsx` 中 `commands` | 不再走 pane.setRenderer effect |
| `textDiffEffects()` 及相关函数 | 不再需要 effect dispatch |

### 新增

| 文件/位置 | 内容 |
|-----------|------|
| `src/plugins/textDiff/DiffPageView.tsx` | 全屏 Diff 页面组件 |
| `workspaceStore` 新增字段 | `activeFullscreenView` + actions |
| `EditorView.tsx` 条件渲染 | 三目判断切换 |

### 保留

| 内容 | 原因 |
|------|------|
| `autoDiffMode.ts` | ESC 检测、JSON 校验逻辑复用 |
| `kits/diff/` | 纯算法 kit |
| `locales/*.json` | i18n 文案复用 |
| `style.css` | 样式大部分复用 |
| `launcher.items` | 保留入口，改写 execute 逻辑 |

### Launcher execute 改写

```ts
execute(ctx) {
  const snapshot = ctx.api.getPaneSnapshot()
  const sources = buildSourceList(snapshot) // 所有 pane + clipboard
  return {
    output: {
      choices: sources.map(s => ({ id: s.sourceId, title: sourceLabel(s) })),
      selection: {
        type: 'multi', min: 2, max: 2,
        submitTitle: ctx.t('choice.compareSelected'),
        submit: (selected) => {
          ctx.api.openDiffPage({ original: selected[0], modified: selected[1] })
          return { ok: true }
        }
      }
    }
  }
}
```

## 框架侧最小改动

1. workspaceStore 加一个 `activeFullscreenView` 字段和两个 action
2. EditorView 加一个条件渲染
3. 不改 surface 系统、不改 plugin 协议、不开新窗口
