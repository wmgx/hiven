# 统一导航与系统设置页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将设置页和插件页合并为统一的"系统设置" surface，升级系统头部栏为面包屑式导航（← hiven / 页面名 ×），支持回退到 Launcher 并保留输入状态。

**Architecture:** 新建一个内置的 `system-settings` plugin surface，在 GlobalLauncher 内渲染。该 surface 内部使用左侧 Tab 栏 + 右侧内容区布局，合并现有 SettingsView 和 ScriptsView 的内容。系统头部栏作为 surface shell 的一部分渲染，提供面包屑导航（回退到 Launcher）和关闭按钮。

**Tech Stack:** React, Zustand, CSS, hiven plugin system

**Design Doc:** `doc/2026-07-01-unified-navigation-design.md`

---

## 文件结构规划

```
新建:
  src/components/SystemSettingsSurface.tsx    — 系统设置 surface 主组件（左侧 Tab + 右侧内容）
  src/components/SystemSettingsSurface.css    — 系统设置布局样式
  src/components/SurfaceBreadcrumbHeader.tsx  — 面包屑式头部栏组件（← hiven / 页面名 ×）

修改:
  src/components/GlobalLauncher.tsx           — 识别系统设置 surface，渲染面包屑头部
  src/store.ts                               — 新增 Launcher 输入状态保持逻辑
  src/workspace/pluginTypes.ts               — shell 类型新增 breadcrumbTitle 字段
  src/plugins/system-settings/index.ts       — 注册系统设置为内置 plugin surface
  src/views/SettingsView.tsx                  — 提取内容为独立子组件供复用
  src/views/ScriptsView.tsx                   — 提取内容为独立子组件供复用
  src/components/Sidebar.tsx                  — 设置按钮改为打开系统设置 surface
  src/App.tsx                                — 移除旧的 settings/scripts view 入口（或保留兼容）
  src/index.css                              — 新增系统设置布局样式、修复滚动
```

---

### Task 1: 创建面包屑式头部栏组件

**Files:**
- Create: `src/components/SurfaceBreadcrumbHeader.tsx`
- Create: `src/components/SurfaceBreadcrumbHeader.css`

- [ ] **Step 1: 创建面包屑头部栏组件**

```tsx
// src/components/SurfaceBreadcrumbHeader.tsx
import { ChevronLeft, X } from 'lucide-react'
import './SurfaceBreadcrumbHeader.css'

type SurfaceBreadcrumbHeaderProps = {
  title: string
  onBack: () => void
  onClose: () => void
}

export function SurfaceBreadcrumbHeader({ title, onBack, onClose }: SurfaceBreadcrumbHeaderProps) {
  return (
    <div className="surface-breadcrumb-header">
      <button
        type="button"
        className="surface-breadcrumb-back"
        onClick={onBack}
        aria-label="Back to hiven"
      >
        <ChevronLeft size={14} />
        <span className="surface-breadcrumb-root">hiven</span>
      </button>
      <span className="surface-breadcrumb-separator">/</span>
      <span className="surface-breadcrumb-current">{title}</span>
      <button
        type="button"
        className="surface-breadcrumb-close"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: 创建面包屑头部栏样式**

```css
/* src/components/SurfaceBreadcrumbHeader.css */
.surface-breadcrumb-header {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 4px;
  user-select: none;
  -webkit-user-select: none;
}

.surface-breadcrumb-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.surface-breadcrumb-back:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.surface-breadcrumb-root {
  font-weight: 600;
}

.surface-breadcrumb-separator {
  color: var(--color-text-tertiary);
  font-size: 13px;
  margin: 0 2px;
}

.surface-breadcrumb-current {
  font-size: 13px;
  color: var(--color-text-secondary);
  font-weight: 400;
}

.surface-breadcrumb-close {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.surface-breadcrumb-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/SurfaceBreadcrumbHeader.tsx src/components/SurfaceBreadcrumbHeader.css
git commit -m "feat: add SurfaceBreadcrumbHeader component with breadcrumb navigation"
```

---

### Task 2: 创建系统设置 Surface 主组件

**Files:**
- Create: `src/components/SystemSettingsSurface.tsx`
- Create: `src/components/SystemSettingsSurface.css`

- [ ] **Step 1: 创建系统设置 surface 主组件**

```tsx
// src/components/SystemSettingsSurface.tsx
import { useState } from 'react'
import { Settings, Puzzle } from 'lucide-react'
import { useT } from '../i18n'
import { SettingsContent } from '../views/SettingsContent'
import { PluginsContent } from '../views/PluginsContent'
import './SystemSettingsSurface.css'

type TabId = 'settings' | 'plugins'

type SystemSettingsSurfaceProps = {
  initialTab?: TabId
}

export function SystemSettingsSurface({ initialTab = 'settings' }: SystemSettingsSurfaceProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const t = useT('systemSettings')

  const tabs: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: 'settings', icon: <Settings size={16} />, label: t('basicSettings') },
    { id: 'plugins', icon: <Puzzle size={16} />, label: t('pluginManagement') },
  ]

  return (
    <div className="system-settings-surface">
      <div className="system-settings-sidebar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`system-settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="system-settings-tab-icon">{tab.icon}</span>
            <span className="system-settings-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="system-settings-content">
        {activeTab === 'settings' && <SettingsContent />}
        {activeTab === 'plugins' && <PluginsContent />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建系统设置 surface 样式**

```css
/* src/components/SystemSettingsSurface.css */
.system-settings-surface {
  display: flex;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.system-settings-sidebar {
  display: flex;
  flex-direction: column;
  width: 180px;
  min-width: 180px;
  padding: 12px 8px;
  border-right: 1px solid var(--border);
  gap: 2px;
  overflow-y: auto;
}

.system-settings-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, color 0.15s;
  width: 100%;
}

.system-settings-tab:hover {
  background: var(--color-bg-hover);
}

.system-settings-tab.active {
  background: var(--color-bg-active);
  color: var(--color-text-primary);
  font-weight: 500;
}

.system-settings-tab-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: inherit;
  opacity: 0.7;
}

.system-settings-tab.active .system-settings-tab-icon {
  opacity: 1;
}

.system-settings-tab-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.system-settings-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}
```

- [ ] **Step 3: 提交**

```bash
git add src/components/SystemSettingsSurface.tsx src/components/SystemSettingsSurface.css
git commit -m "feat: add SystemSettingsSurface component with tab layout"
```

---

### Task 3: 提取 SettingsView 内容为可复用组件

**Files:**
- Create: `src/views/SettingsContent.tsx`
- Modify: `src/views/SettingsView.tsx`

- [ ] **Step 1: 提取 SettingsContent 组件**

将 `SettingsView.tsx` 中的核心内容（`.sscroll` 内的所有设置组）提取为独立的 `SettingsContent` 组件。保留原 `SettingsView` 作为 wrapper 确保向后兼容。

```tsx
// src/views/SettingsContent.tsx
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { Check, Download, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { checkBuiltinPluginsUpdate } from '../configInit'
import { ShortcutRecorder } from '../components/ShortcutRecorder'

export function SettingsContent() {
  const { settings, updateSetting } = useAppStore()
  const locale = useAppStore((s) => s.locale)
  const t = useT('settings')
  const tUpdate = useT('update')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => setAppVersion('dev'))
  }, [])

  return (
    <div className="sscroll">
      {/* 原 SettingsView 中 <div className="sscroll"> 内的全部内容原样搬入 */}
      <SettingGroup title={t('general')}>
        {/* ... 与现有 SettingsView 完全一致 ... */}
      </SettingGroup>
      {/* 其余 SettingGroup: hotkeys, editor, behavior, updates */}
    </div>
  )
}

// SettingGroup, SettingsListRow, Toggle, LocaleSelect, UpdateChecker 等辅助组件也移到此文件
// 并 export SettingGroup、SettingsListRow 供可能的插件设置复用
```

- [ ] **Step 2: 修改 SettingsView 为薄 wrapper**

```tsx
// src/views/SettingsView.tsx（精简后）
import { SettingsContent } from './SettingsContent'

export function SettingsView() {
  return (
    <div className="settings-page body">
      <SettingsContent />
    </div>
  )
}
```

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/views/SettingsContent.tsx src/views/SettingsView.tsx
git commit -m "refactor: extract SettingsContent from SettingsView for reuse"
```

---

### Task 4: 提取 ScriptsView 内容为可复用组件

**Files:**
- Create: `src/views/PluginsContent.tsx`
- Modify: `src/views/ScriptsView.tsx`

- [ ] **Step 1: 提取 PluginsContent 组件**

将 `ScriptsView.tsx` 中的插件管理核心 UI（搜索栏 + tab 栏 + master-detail 布局）提取为 `PluginsContent` 组件。ScriptsView 当前 1402 行，需要将渲染逻辑（约 lines 1191-1333）和相关状态提取到 `PluginsContent`。

```tsx
// src/views/PluginsContent.tsx
// 提取 ScriptsView 中的核心 UI：
// - ptools (搜索栏 + 添加插件按钮)
// - ptabs (builtin | installed | dev tab 栏)
// - scripts-search-results (master-detail 列表)
// - 所有相关 state 和 handlers

export function PluginsContent() {
  // 从 ScriptsView 搬出的状态和逻辑
  // ...
  return (
    <div className="plugins-content-inner">
      <div className="ptools">...</div>
      <div className="ptabs scripts-tabs">...</div>
      <div className="scripts-search-results">...</div>
    </div>
  )
}
```

注意：ScriptsView 很大（1402 行），提取时保持所有状态和逻辑原封不动，只是移到新文件。需要确保所有 import 正确迁移。

- [ ] **Step 2: 修改 ScriptsView 为薄 wrapper**

```tsx
// src/views/ScriptsView.tsx（精简后）
import { PluginsContent } from './PluginsContent'

export function ScriptsView() {
  return (
    <div className="scripts-content body">
      <PluginsContent />
    </div>
  )
}
```

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功，无类型错误

- [ ] **Step 4: 提交**

```bash
git add src/views/PluginsContent.tsx src/views/ScriptsView.tsx
git commit -m "refactor: extract PluginsContent from ScriptsView for reuse"
```

---

### Task 5: 注册系统设置为内置 Plugin Surface

**Files:**
- Create: `src/plugins/system-settings/index.ts`
- Modify: `src/workspace/pluginTypes.ts` — shell 类型新增可选 `breadcrumbTitle` 字段

- [ ] **Step 1: 扩展 shell 类型**

在 `src/workspace/pluginTypes.ts` 的 `PluginUiSurfaceContribution.shell` 中新增：

```typescript
shell?: {
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  closeOnBlur?: boolean
  resizable?: boolean
  breadcrumbTitle?: string         // 新增：面包屑中显示的页面名称
  breadcrumbTitleI18n?: Partial<Record<Locale, string>>  // 新增：国际化
}
```

- [ ] **Step 2: 创建 system-settings 插件入口**

```typescript
// src/plugins/system-settings/index.ts
import type { PluginDefinition } from '../../workspace/pluginTypes'
import { SystemSettingsSurface } from '../../components/SystemSettingsSurface'
import { SurfaceBreadcrumbHeader } from '../../components/SurfaceBreadcrumbHeader'

const definition: PluginDefinition = {
  id: 'system-settings',
  name: 'System Settings',
  nameI18n: { zh: '系统设置', en: 'System Settings' },
  version: '1.0.0',
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'System Settings',
        titleI18n: { zh: '系统设置', en: 'System Settings' },
        icon: '⚙',
        aliases: ['settings', 'preferences', '设置', '偏好设置', 'plugins', '插件'],
        component: SystemSettingsSurface,
        entry: {
          launcher: true,
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+,',
        },
        shell: {
          defaultWidth: 800,
          defaultHeight: 600,
          minWidth: 640,
          minHeight: 480,
          closeOnBlur: false,
          resizable: true,
          breadcrumbTitle: 'System Settings',
          breadcrumbTitleI18n: { zh: '系统设置', en: 'System Settings' },
        },
      },
    ],
  },
}

export default definition
```

- [ ] **Step 3: 在插件注册表中注册此内置插件**

找到注册 builtin plugins 的入口文件（`registerBundledPluginPackages` 相关），添加 system-settings 的注册。

- [ ] **Step 4: 验证构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/plugins/system-settings/index.ts src/workspace/pluginTypes.ts
git commit -m "feat: register system-settings as builtin plugin surface"
```

---

### Task 6: 在 GlobalLauncher 中渲染面包屑头部栏

**Files:**
- Modify: `src/components/GlobalLauncher.tsx`

- [ ] **Step 1: 导入面包屑组件**

在 GlobalLauncher.tsx 顶部添加导入：

```typescript
import { SurfaceBreadcrumbHeader } from './SurfaceBreadcrumbHeader'
```

- [ ] **Step 2: 修改 surface 渲染逻辑，添加面包屑头部**

在 GlobalLauncher.tsx 中 surface 渲染部分（约 line 957-1007），当 surface 的 shell 配置了 `breadcrumbTitle` 时，在 surface body 上方渲染面包屑头部栏。

修改 `surfaceFrame` 渲染分支，在 `<PluginSurfaceErrorBoundary>` 内、`global-launcher-surface-shell` div 中，surface body 上方插入面包屑：

```tsx
<PluginSurfaceErrorBoundary pluginId={surfaceFrame.pluginId} onBack={leaveCrashedSurface}>
  <div
    className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
    tabIndex={-1}
    style={{ height: shellHeight }}
  >
    {surface.shell?.breadcrumbTitle && (
      <SurfaceBreadcrumbHeader
        title={localized(
          surface.shell.breadcrumbTitle,
          surface.shell.breadcrumbTitleI18n,
          locale,
        )}
        onBack={requestSurfaceBack}
        onClose={requestSurfaceClose}
      />
    )}
    <div className="global-launcher-body" style={{ maxHeight: bodyHeight, height: bodyHeight, overflow: 'hidden' }}>
      {/* 原有 surface 内容不变 */}
    </div>
  </div>
</PluginSurfaceErrorBoundary>
```

注意：`bodyHeight` 需要减去面包屑高度（40px）。当有面包屑时：`bodyHeight = shellHeight - 40`，否则 `bodyHeight = shellHeight`。

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/components/GlobalLauncher.tsx
git commit -m "feat: render breadcrumb header for surfaces with breadcrumbTitle"
```

---

### Task 7: 实现 Launcher 输入状态保持

**Files:**
- Modify: `src/components/GlobalLauncher.tsx`

- [ ] **Step 1: 修改 leaveSurface 逻辑，保留 query 状态**

当前 `leaveSurface` 调用 `setSurfaceFrame(null)` 返回 Launcher 列表。需要确保在 surface 打开期间，`query` 状态不被清空。

检查现有逻辑：当 surface 打开时，`query` 是否被重置。如果 `openPluginSurface` 或其调用链中有 `setQuery('')`，需要移除该重置。

关键修改点：在 `leaveSurface` 回调中，确保只做 `setSurfaceFrame(null)` 而不触碰 `query`。

```typescript
const leaveSurface = useCallback(() => {
  if (surfaceFrame && pluginSurfaceToolTarget && samePluginSurfaceTarget(surfaceFrame, pluginSurfaceToolTarget)) {
    closeLauncher()
    return
  }
  // 仅清除 surfaceFrame，不清除 query — 回到 Launcher 时保留用户之前的输入
  setSurfaceFrame(null)
}, [closeLauncher, pluginSurfaceToolTarget, surfaceFrame])
```

- [ ] **Step 2: 确保 openPluginSurface 时不清空 query**

检查 `openPluginSurface` 回调中是否有 `setQuery('')` 调用。如果有，移除它，或在打开 surface 前保存 query 到 ref。

- [ ] **Step 3: 确认 focusSearchInputAfterBack 行为正确**

现有的 `focusSearchInputAfterBack` 应该只聚焦输入框而不清空内容，验证这一点。

- [ ] **Step 4: 验证行为**

手动验证：Launcher 输入 "Setting" → 选择系统设置 surface → 点击面包屑回退 → Launcher 恢复，输入框中仍显示 "Setting"。

- [ ] **Step 5: 提交**

```bash
git add src/components/GlobalLauncher.tsx
git commit -m "feat: preserve launcher query state when returning from surface"
```

---

### Task 8: 修复滚动问题

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/SystemSettingsSurface.css`

- [ ] **Step 1: 确保系统设置 surface 内容区可滚动**

`SystemSettingsSurface` 的 `.system-settings-content` 已经设置了 `overflow-y: auto`。但由于 GlobalLauncher 对 surface body 设置了 `overflow: hidden`（inline style），surface 内部必须自己处理滚动。

确认 `SystemSettingsSurface.css` 中：

```css
.system-settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
```

以及 `.sscroll`（SettingsContent 使用的容器）的滚动规则也需要在 surface 内正常工作。由于 `.sscroll` 原本有 `flex: 1; min-height: 0; overflow-y: auto;`，嵌入到 `.system-settings-content` 内后需要确保外层容器给了它正确的高度约束。

- [ ] **Step 2: 确保 PluginsContent 在 surface 内可滚动**

原 ScriptsView 的滚动是通过 `.a-list` 和 `.a-detail` 的 `overflow-y: auto` 实现的。在新的 `PluginsContent` 中，需要确保父容器 `.system-settings-content` 给了正确的 flex 高度约束。

添加样式确保内部的 `.splitwrap` 填满可用高度：

```css
.system-settings-content .plugins-content-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.system-settings-content .scripts-search-results {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/index.css src/components/SystemSettingsSurface.css
git commit -m "fix: ensure scrolling works correctly in system settings surface"
```

---

### Task 9: 修改 Sidebar 和入口

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 修改 Sidebar 设置按钮**

将 Sidebar 底部的设置按钮从 `setActiveView('settings')` 改为打开系统设置 surface：

```tsx
// src/components/Sidebar.tsx
import { requestOpenPluginSurfaceTool } from '../workspace/pluginSurfaceOpenRequest'

// 在设置按钮的 onClick 中：
onClick={() => {
  requestOpenPluginSurfaceTool({
    source: 'builtin',
    pluginId: 'system-settings',
    surfaceId: 'main',
  })
}}
```

- [ ] **Step 2: 修改 Sidebar 插件按钮**

将 Sidebar 中 scripts nav item 也指向系统设置（plugins tab）：

```tsx
// 将 navItems 中的 scripts 按钮改为打开系统设置 surface 的 plugins tab
// 或者保留 scripts 按钮但改为打开系统设置 surface 并切换到 plugins tab
```

方案：Sidebar 中只保留 `editor` 按钮和 pinned actions。移除 `scripts` nav item。设置按钮保持在底部，打开系统设置 surface。

- [ ] **Step 3: 更新 Tauri 事件监听**

在 `App.tsx` 中，将 `hiven://show-settings-page` 和 `hiven://show-plugins-page` 事件改为打开系统设置 surface：

```typescript
unlistenSettings = await listen('hiven://show-settings-page', () => {
  requestOpenPluginSurfaceTool({
    source: 'builtin',
    pluginId: 'system-settings',
    surfaceId: 'main',
  })
})
unlistenPlugins = await listen('hiven://show-plugins-page', () => {
  requestOpenPluginSurfaceTool({
    source: 'builtin',
    pluginId: 'system-settings',
    surfaceId: 'main',
  })
})
```

- [ ] **Step 4: 验证构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat: route settings/plugins navigation to system-settings surface"
```

---

### Task 10: 国际化文案

**Files:**
- Modify: i18n 相关文件（`src/i18n.ts` 或 locale JSON 文件）

- [ ] **Step 1: 添加 systemSettings 命名空间的文案**

```typescript
// 中文
systemSettings: {
  basicSettings: '基础设置',
  pluginManagement: '插件管理',
}

// 英文
systemSettings: {
  basicSettings: 'Settings',
  pluginManagement: 'Plugins',
}
```

- [ ] **Step 2: 确认面包屑中的 "hiven" 文字不需要国际化**

"hiven" 是品牌名，中英文一致，无需 i18n。

- [ ] **Step 3: 验证构建通过**

Run: `npm run build`
Expected: 构建成功

- [ ] **Step 4: 提交**

```bash
git add src/i18n.ts
git commit -m "feat: add i18n strings for system settings surface"
```

---

### Task 11: 清理旧 View（可选/渐进）

**Files:**
- Modify: `src/store.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: 评估是否立即移除旧 View**

可以渐进式处理：
- 阶段一（本次）：新系统设置 surface 作为主入口，旧 `settings`/`scripts` view 仍保留但 Sidebar 不再直接导航到它们
- 阶段二（后续）：确认无回归后，从 `ViewId` 中移除 `settings` 和 `scripts`，删除旧 View 文件

本次暂不删除旧代码，只确保新入口正常工作。

- [ ] **Step 2: 提交（如有改动）**

```bash
git add -A
git commit -m "chore: document plan for gradual removal of legacy settings/scripts views"
```

---

### Task 12: 端到端验证

- [ ] **Step 1: 验证基本流程**

1. 打开 Launcher → 输入 "Setting" → 选择 "System Settings"
2. 系统设置 surface 打开，显示面包屑头部 `← hiven / 系统设置 ×`
3. 左侧 Tab 可切换"基础设置" / "插件管理"
4. 右侧内容可滚动
5. 点击 `← hiven` 回退到 Launcher，搜索框中仍保留 "Setting"
6. 点击 `×` 关闭 surface，Launcher 一并关闭

- [ ] **Step 2: 验证失焦行为**

1. 打开系统设置 surface
2. 点击桌面其他窗口（失焦）
3. 系统设置 surface 不应自动关闭（`closeOnBlur: false`）

- [ ] **Step 3: 验证 Sidebar 入口**

1. 点击 Sidebar 底部设置图标 → 打开系统设置 surface
2. 快捷键 `Cmd+,` → 打开系统设置 surface

- [ ] **Step 4: 验证 Escape 键行为**

1. 在系统设置 surface 内按 Escape → 回退到 Launcher（等同于点击 `← hiven`）

---

## 依赖关系

```
Task 1 (面包屑组件) ─┐
                     ├─ Task 6 (GlobalLauncher 集成)
Task 2 (Surface 主组件) ─┤
                     │
Task 3 (SettingsContent 提取) ─┤
                               ├─ Task 5 (注册插件)
Task 4 (PluginsContent 提取) ──┘
                     │
Task 7 (状态保持) ──── 独立
Task 8 (滚动修复) ──── 在 Task 6 之后验证
Task 9 (入口修改) ──── 在 Task 5, 6 之后
Task 10 (i18n) ───── 在 Task 2 之后
Task 11 (清理) ───── 最后
Task 12 (验证) ───── 最后
```

**推荐执行顺序：** 1 → 3 → 4 → 2 → 5 → 6 → 7 → 8 → 10 → 9 → 11 → 12

Tasks 1, 3, 4 可并行执行。
