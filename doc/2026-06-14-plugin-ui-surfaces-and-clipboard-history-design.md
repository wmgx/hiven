# Plugin UI Surfaces and Clipboard History Design

## 背景

hiven 现有插件系统已经支持 command、launcher item、renderer、panel、settings body。网页快开证明了插件可以提供设置页 body，由 host 负责弹窗外壳；regex tester 证明了 first-party 插件可以提供 workspace panel。下一阶段需要把这些零散 UI 能力整理成明确的平台能力，让插件可以提供完整工具界面，同时不越过 host 的权限、安全和生命周期边界。

剪贴板历史是第一个高要求样板。它需要后台采集剪贴板、保存文本/图片/文件路径、全局快捷键唤起、自定义列表和预览 UI、直接粘贴到前台应用、插件设置页和清理策略。这个能力不应实现成 framework 内置产品逻辑，也不应让插件随意调用系统 API。目标是：clipboard-history 是一个高权限 first-party plugin，但它使用的 UI、权限、后台、存储和快捷键模型应可服务后续第三方插件。

## 目标

- 扩展插件规范，支持插件声明自定义 UI surface。
- 插件 UI surface 由 plugin 渲染 body，host 控制 shell、来源、返回、关闭、焦点、错误边界和权限。
- 插件可声明后台生命周期，由 host 在授权后启动和停止。
- 插件可声明系统权限，用户授权后 host API 强制检查。
- 插件可使用 host 提供的 private storage，按 `pluginId` 隔离 KV 和 blob cache。
- 插件列表提供 surface 级快捷键绑定界面。一个插件可有多个 surface，因此可绑定多个快捷键。
- GlobalLauncher 默认可搜索可打开的 plugin surface。
- clipboard-history 作为 first-party plugin 使用上述能力实现完整剪贴板历史。
- 形成可执行迁移边界，避免实现 agent 把剪贴板产品语义写回 framework。

## 非目标

- 第一版不做 `run-command` 全局快捷键。
- 第一版不支持插件创建 host-level 多层页面栈。
- 第一版不要求插件必须使用 host UI primitives。
- 第一版不做敏感内容自动过滤、应用黑名单或规则引擎。
- 第一版不开放任意键盘模拟 API。
- 第一版不让普通插件直接 import Tauri clipboard、filesystem、global-shortcut 或窗口 API。
- 第一版不把 clipboard-history 做成系统 Settings 里的 host 内置功能。

## 核心原则

### Host 负责系统边界

host 负责：

- plugin registry、权限授权、权限运行时检查。
- background lifecycle 启停。
- tool shell、launcher shell、返回和关闭语义。
- 全局快捷键注册、冲突检测、注册状态展示和解绑。
- private storage 目录、配额、清理和卸载删除。
- 剪贴板 watcher、直接粘贴、系统权限失败提示。
- plugin UI 错误边界和崩溃隔离。

plugin 负责：

- 声明需要的权限和 UI surface。
- 渲染自己的 UI body。
- 实现产品逻辑、列表、预览、筛选、删除、清空、设置 body。
- 通过 host-gated API 请求剪贴板、存储、粘贴、消息、关闭等能力。

### UI 自定义但 shell 受控

插件可以完全自定义 React UI。host 只包外壳，不控制插件内部搜索框、列表、tab、预览或键盘导航。host 可提供可选 UI primitives，但不强制使用。

clipboard-history 使用 host primitives 作为 first-party 推荐范式；第三方插件可以不用。

### 快捷键绑定到 surface

快捷键不绑定到整个插件，也不绑定到插件内部 tab。第一版绑定粒度是：

```ts
type PluginOpenTarget = {
  pluginId: string
  surfaceId: string
}
```

只有插件显式声明的 host-openable surface 才能被绑定快捷键。

### Launcher 与全局快捷键只是不同来源

同一个 plugin surface 可以被 GlobalLauncher 打开，也可以被全局快捷键打开。host 根据来源决定返回行为：

- 从 GlobalLauncher 进入：`Esc` 或 host back 回到 launcher 列表。
- 从全局快捷键进入：`Esc` 或 host back 关闭 tool shell。
- terminal action 完成后关闭当前 shell，例如 clipboard-history 粘贴成功后关闭。

插件不管理来源栈。插件只请求 `close()` 或 `requestBack()`，最终行为由 host 决定。

## 插件包目录规范

现有目录插件规范继续有效：

```text
<plugin-id>/
  manifest.json
  index.js        production ESM entry
  index.ts        optional dev source entry
  README.md
  locales/
    en.json
    zh.json
  assets/
```

第一版起，带 UI、后台或私有存储的插件必须按职责拆目录。`index.*` 只能做声明和组装，不允许把复杂 UI、样式、业务逻辑、后台轮询或存储模型都写在一个 JS 文件里。

标准目录：

```text
<plugin-id>/
  manifest.json
  index.tsx
  README.md
  locales/
    en.json
    zh.json
  assets/
    icons/
    images/
  components/
    <SharedPluginComponent>.tsx
  settings/
    SettingsBody.tsx
    model.ts
  surfaces/
    MainSurface.tsx
    MainSurface.css
  background/
    index.ts
  storage/
    model.ts
    repository.ts
  styles/
    tokens.css
    plugin.css
  utils/
    <pure-helper>.ts
```

目录职责：

- `index.tsx`: 唯一职责是 import 本插件模块并 export `definePlugin(...)`。不得包含超过少量 glue code 的 JSX、状态机、复杂函数或内联大样式。
- `components/`: 只放插件内部可复用展示组件，不直接访问 host API；需要 host 能力时通过 props 传入。
- `settings/`: 插件设置 schema、默认值、迁移和 settings body。
- `surfaces/`: host-openable UI surface。每个 surface 一个入口文件，复杂子组件继续拆到 `components/`。
- `background/`: background lifecycle 和后台任务协调。
- `storage/`: 插件私有数据模型、repository、prune/dedupe 等纯业务持久化逻辑。
- `styles/`: 插件自有样式。样式只能依赖 SDK 暴露的 CSS tokens/class contract，不能依赖 host 内部 DOM 结构。
- `utils/`: 纯函数工具。不得 import React、host API 或 Tauri API。

硬性要求：

- 带 UI 的插件必须至少拆出 `surfaces/` 或 `settings/`。
- 带后台任务的插件必须拆出 `background/`。
- 带持久化业务数据的插件必须拆出 `storage/`。
- 大段 JSX、CSS string、HTML string、内联 style map 不得堆在 `index.*`。
- `index.*` 不得直接调用 host API；host API 只能在 contribution handler、surface props、settings props 或 background ctx 中使用。
- first-party 插件也必须遵守这些目录规则，不能因为在 repo 内就直接写 framework 组件。

first-party source 放在 `src/plugins/<plugin-id>/` 时也按同样结构组织。生产包发布到 `plugins/builtin/<plugin-id>/` 时，仍是目录插件包，不把 source 拆进 framework。

clipboard-history 目录建议：

```text
src/plugins/clipboard-history/
  manifest.json
  index.tsx
  README.md
  locales/
    en.json
    zh.json
  assets/
    icons/
  components/
    ClipboardHistoryItemRow.tsx
    ClipboardHistoryToolbar.tsx
  settings/
    ClipboardHistorySettingsBody.tsx
    model.ts
  surfaces/
    ClipboardHistorySurface.tsx
    ClipboardHistoryList.tsx
    ClipboardHistoryPreview.tsx
    ClipboardHistorySurface.css
  background/
    clipboardHistoryBackground.ts
  storage/
    clipboardHistoryStore.ts
    clipboardHistoryTypes.ts
    clipboardHistoryRepository.ts
  styles/
    plugin.css
```

禁止 clipboard-history 直接 import：

```text
../../store
../../workspace/workspaceStore
../../workspace/effectRunner
@tauri-apps/*
```

first-party 插件如需 host 能力，必须通过 `@hiven/plugin` SDK 和 host 注入 API。现存 first-party 插件中直接 import workspace 的历史债可以后续迁移，但 clipboard-history 不允许新增这种债。

## 插件导入边界

插件作者可用导入：

```ts
import { definePlugin, getPluginHostSdk } from '@hiven/plugin'
import {
  Button,
  IconButton,
  SurfaceList,
  SurfaceListItem,
} from '@hiven/plugin-ui'
import { something } from './utils/something'
```

允许：

- `@hiven/plugin`: 插件定义、类型、hooks、host capability API 类型。
- `@hiven/plugin-ui`: host 暴露给外部插件的 UI primitives、icons、CSS token helpers。
- 插件包内相对路径，例如 `./surfaces/MainSurface`。
- 被插件包显式打包或由插件平台白名单提供的纯前端依赖。

禁止：

```ts
import { useAppStore } from '../../store'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { applyEffects } from '../../workspace/effectRunner'
import { Button } from '../../components/ui/Button'
import { cn } from '../../utils/cn'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
```

规则：

- 插件不得引用 `src/` 下 host 深路径。
- 插件不得引用 `src/components`、`src/workspace`、`src/store`、`src/i18n`、`src/kits` 的相对路径。
- 插件不得直接 import `@tauri-apps/*`、浏览器外壳、全局快捷键或 filesystem API。
- 插件不得互相 import。
- 插件不得 bundle 自己的 React。React 必须来自 host SDK 约定。
- 插件不得依赖 host DOM class 或 DOM 层级；可依赖 SDK 文档化 class contract 和 CSS variables。
- 如果某个能力外部插件需要但 SDK 没暴露，必须先扩 SDK，再让插件使用；不能临时深 import。

这条规则专门避免“Claude UI 直接写进一个 JS 文件并引用 host 内部实现”的形态。复杂 UI 必须拆目录，host 能力必须通过 SDK，样式必须通过 SDK tokens 或插件自有 CSS。

## Manifest 扩展

`manifest.json` 继续承载包元数据。新增权限声明只描述安装包所需系统能力，不声明 React component。

```json
{
  "pluginId": "clipboard-history",
  "displayName": "Clipboard History",
  "displayNameI18n": {
    "zh": "剪贴板历史"
  },
  "version": "1.0.0",
  "capabilities": ["settings", "ui", "background"],
  "permissions": [
    "clipboard.read",
    "clipboard.write",
    "clipboard.watch",
    "clipboard.image",
    "clipboard.files",
    "storage.private",
    "storage.blob",
    "globalShortcut.register",
    "accessibility.paste"
  ]
}
```

规则：

- `capabilities` 用于插件列表展示能力类别。
- `permissions` 用于授权和运行时检查。
- 未授权权限的 host API 必须拒绝执行，并返回可展示错误。
- manifest 声明权限不等于默认授权。
- builtin 插件也必须走同一权限模型；first-party 不能绕过。

## PluginDefinition 扩展

新增 `ui` 和 `background`。保留旧 `settings`、`panels`、`launcher` 兼容。

```ts
type PluginDefinition<TSettings = unknown> = {
  tools?: PluginToolContribution<TSettings>[]
  launcher?: {
    items?: LauncherItemContribution<TSettings>[]
    dynamicItems?: LauncherDynamicItemProvider
  }
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
  toolbar?: ToolbarContribution[]
  settings?: PluginSettingsContribution<TSettings>
  ui?: {
    surfaces?: PluginUiSurfaceContribution<TSettings>[]
  }
  background?: PluginBackgroundContribution<TSettings>
}
```

### UI Surface Contribution

第一版只新增 `custom-view`，host 可把它放进 launcher shell 或 tool shell。不要把它命名成 `window`，因为窗口只是 host shell，不是插件能力本身。

```ts
type PluginUiSurfaceKind = 'custom-view'

type PluginUiSurfaceContribution<TSettings = unknown> = {
  id: string
  kind: PluginUiSurfaceKind
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  aliases?: string[]
  component: ComponentType<PluginSurfaceProps<TSettings>>
  entry?: {
    launcher?: boolean
    shortcutBindable?: boolean
    recommendedShortcut?: string
  }
  shell?: {
    defaultWidth?: number
    defaultHeight?: number
    minWidth?: number
    minHeight?: number
    closeOnBlur?: boolean
    resizable?: boolean
  }
}
```

默认值：

- `entry.launcher`: `true`
- `entry.shortcutBindable`: `true`
- `shell.closeOnBlur`: `true` for tool shell
- `shell.resizable`: `false`

规则：

- `id` 在插件内唯一。
- surface 不得声明自定义 launcher surface id。
- surface 默认进入 GlobalLauncher 搜索，除非 `entry.launcher === false`。
- GlobalLauncher 匹配 `title/titleI18n/aliases`，复用框架级拼音和模糊搜索。
- surface 不能直接声明 `run-command` 快捷键。
- surface 不支持 host-level 子页面栈。

### Surface Props

```ts
type PluginSurfaceProps<TSettings = unknown> = {
  pluginId: string
  surfaceId: string
  locale: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  settings: TSettings
  permissions: PluginPermissionSnapshot
  host: PluginSurfaceHostApi
}

type PluginSurfaceHostApi = {
  close(): void
  requestBack(): void
  openSettings(): void
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
}
```

插件可以在自己的 component 内维护 React state、搜索框、tab、预览和键盘行为。插件不应读取 launch origin 来改变 host 返回策略。host 可以为诊断注入只读 origin，但不是插件协议必需字段。

### Background Contribution

```ts
type PluginBackgroundContribution<TSettings = unknown> = {
  start(ctx: PluginBackgroundContext<TSettings>): Promise<PluginBackgroundStop | void> | PluginBackgroundStop | void
}

type PluginBackgroundStop = () => void | Promise<void>

type PluginBackgroundContext<TSettings = unknown> = {
  pluginId: string
  locale: Locale
  settings: TSettings
  permissions: PluginPermissionSnapshot
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}
```

启动规则：

- 插件 enabled 且 background 存在时，host 检查 manifest 权限和用户授权。
- 必需权限未授权时不启动 background，插件列表显示 blocked 状态。
- settings 变更时，host 调用 stop 后重新 start。
- 插件禁用、卸载、reload、权限撤销时必须 stop。
- start 抛错只影响该插件 background，不能影响其他插件和主应用。

## 权限模型

第一版权限枚举：

```ts
type PluginPermission =
  | 'clipboard.read'
  | 'clipboard.write'
  | 'clipboard.watch'
  | 'clipboard.image'
  | 'clipboard.files'
  | 'storage.private'
  | 'storage.blob'
  | 'globalShortcut.register'
  | 'accessibility.paste'
```

授权状态：

```ts
type PluginPermissionGrant = {
  granted: boolean
  grantedAt?: number
  deniedAt?: number
}

type PluginPermissionState = Record<string, Record<PluginPermission, PluginPermissionGrant>>
```

规则：

- 安装插件时不自动授权高风险权限。
- 启用插件或首次打开需要权限的 surface 时，host 展示授权确认。
- 权限描述来自 host，不来自插件任意文案。
- 权限撤销后，相关 background 必须停止，相关 API 立即拒绝。
- 权限状态按插件来源隔离：builtin、installed、dev 不共享授权。

## Private Storage API

host 提供插件私有存储，插件不得直接写任意磁盘路径。

```ts
type PluginPrivateStorageApi = {
  kv: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set<T = unknown>(key: string, value: T): Promise<void>
    delete(key: string): Promise<void>
    list(prefix?: string): Promise<Array<{ key: string; updatedAt: number }>>
  }
  blob: {
    put(input: { bytes: Uint8Array; contentType: string; extension?: string }): Promise<PluginBlobRef>
    get(blobId: string): Promise<Uint8Array | undefined>
    delete(blobId: string): Promise<void>
    url(blobId: string): Promise<string>
  }
  quota: {
    usage(): Promise<{ bytes: number; itemCount: number }>
    prune(policy: PluginStoragePrunePolicy): Promise<{ removedBytes: number; removedItems: number }>
  }
}
```

存储位置由 host 决定，概念上是：

```text
plugin-private/
  builtin/
    clipboard-history/
      kv/
      blobs/
  installed/
  dev/
```

规则：

- key 不能逃逸插件目录。
- blob id 由 host 生成。
- 卸载插件时清理 installed 插件私有数据，除非后续专门设计保留策略。
- 禁用插件不删除数据。
- builtin 插件升级不删除数据。

## Clipboard Host API

剪贴板 watcher 由 Rust host 提供。第一版内部可轮询实现，对插件暴露稳定事件协议。

```ts
type ClipboardChange =
  | {
      kind: 'text'
      text: string
      byteSize: number
      hash: string
      changedAt: number
    }
  | {
      kind: 'image'
      blobId: string
      previewBlobId: string
      contentType: string
      byteSize: number
      width?: number
      height?: number
      hash: string
      changedAt: number
    }
  | {
      kind: 'files'
      paths: string[]
      fileNames: string[]
      hash: string
      changedAt: number
    }

type PluginClipboardApi = {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  writeImage(blobId: string): Promise<void>
  writeFiles(paths: string[]): Promise<void>
  watch(options: ClipboardWatchOptions, onChange: (change: ClipboardChange) => void): Promise<() => void>
}

type ClipboardWatchOptions = {
  text?: boolean
  images?: boolean
  files?: boolean
  pollIntervalMs?: number
  maxTextBytes?: number
  maxImageBytes?: number
}
```

权限要求：

- `readText`: `clipboard.read`
- `writeText`: `clipboard.write`
- `writeImage`: `clipboard.write` + `clipboard.image`
- `writeFiles`: `clipboard.write` + `clipboard.files`
- `watch`: `clipboard.watch` plus selected type permissions

watcher 规则：

- host 负责去平台剪贴板读取和标准化。
- host 负责基础 hash 生成。
- host 不负责产品级去重和历史策略；这属于 clipboard-history plugin。
- watcher 错误通过 callback 或 rejected promise 返回给 plugin，不能 crash app。

## Paste Host API

只开放受控 paste 语义，不开放任意键盘模拟。

```ts
type PluginPasteApi = {
  pasteText(text: string): Promise<PluginPasteResult>
  pasteImage(blobId: string): Promise<PluginPasteResult>
  pasteFiles(paths: string[]): Promise<PluginPasteResult>
}

type PluginPasteResult =
  | { ok: true }
  | { ok: false; fallback: 'copied'; message: string }
  | { ok: false; fallback: 'none'; message: string }
```

host 行为：

- 写入系统剪贴板。
- 关闭当前 tool shell 或 launcher shell。
- 尝试恢复上一个前台应用。
- 模拟 paste 快捷键。
- 成功后不恢复旧剪贴板。
- 如果 Accessibility 或模拟粘贴失败，保留新剪贴板内容并提示“已复制，开启辅助功能权限后可直接粘贴”。

权限要求：

- 文本粘贴：`clipboard.write` + `accessibility.paste`
- 图片粘贴：`clipboard.write` + `clipboard.image` + `accessibility.paste`
- 文件粘贴：`clipboard.write` + `clipboard.files` + `accessibility.paste`

## Open Surface 快捷键

插件列表必须提供统一快捷键绑定界面。第一版只支持打开 surface。

持久化模型：

```ts
type PluginSurfaceShortcutKey = `${PluginSource}:${PluginId}:${SurfaceId}`

type PluginSurfaceShortcut = {
  accelerator: string
  enabled: boolean
  registrationStatus?: 'registered' | 'conflict' | 'failed' | 'disabled'
  registrationError?: string
  updatedAt: number
}
```

规则：

- 快捷键绑定目标是 `source + pluginId + surfaceId`。
- 一个插件多个 surface 可以绑定多个快捷键。
- `recommendedShortcut` 只作为 UI 建议，不自动注册。
- 用户在插件列表里绑定、编辑、清除快捷键。
- Settings 可以后续增加全局快捷键汇总页，但第一版插件列表必须可用。
- 冲突时不覆盖旧绑定，显示占用者。
- 插件禁用时快捷键停用但配置保留。
- 插件卸载时删除 installed 插件快捷键配置。
- dev 插件 reload 后，如果同 source/pluginId/surfaceId 仍存在，保留快捷键配置。

## GlobalLauncher 集成

可打开 surface 默认进入 GlobalLauncher 搜索。

host 为每个 surface 生成系统 launcher item：

```ts
{
  systemKey: `plugin-surface:${source}:${pluginId}:${surfaceId}`,
  kind: 'plugin-surface',
  display: {
    title,
    titleI18n,
    icon,
    aliases,
  },
  behavior: { type: 'perform' },
  pinnable: false,
  execute: () => openSurfaceInLauncherShell(source, pluginId, surfaceId)
}
```

规则：

- 复用 launcher ranking 和拼音/模糊匹配。
- surface launcher item 不等同 command，不记录 command usage。
- 进入 surface 后 host 建立 launcher frame。
- `Esc` 返回 launcher 列表。
- surface 内 terminal action 由 host 关闭整个 launcher。
- surface 不能向 host push 多层页面。

## Host UI Shell

第一版需要两个 shell：

### Launcher Shell

来源：用户在 GlobalLauncher 中选择 plugin surface。

行为：

- host 在 GlobalLauncher 中渲染 plugin surface body。
- host 提供返回到 launcher 列表。
- shell 尺寸沿用 GlobalLauncher 约束，但可读 `surface.shell.defaultWidth/defaultHeight`。
- surface 崩溃时显示 host error state，可返回 launcher。

### Tool Shell

来源：用户按插件 surface 绑定的全局快捷键。

行为：

- host 打开独立轻量窗口。
- 默认 close on blur。
- `Esc` 关闭。
- `requestBack()` 等价于关闭。
- terminal action 关闭。
- shell 外壳统一主题、圆角、阴影、焦点和错误边界。

插件不直接调用 Tauri window API，不直接隐藏 launcher window。

## 可选 UI Primitives

host SDK 可导出可选 primitives。第三方插件不强制使用，但 first-party 插件和官方示例应优先使用这些 primitives，作为推荐交互范式。primitives 只提供通用 UI 和交互结构，不提供 clipboard、diff、JSON、Markdown 等产品语义。

导入方式：

```ts
import {
  Button,
  IconButton,
  SearchField,
  SurfaceList,
  SurfaceListItem,
  SurfacePreview,
  SurfaceToolbar,
  SurfaceFooterHints,
} from '@hiven/plugin-ui'
```

禁止从 host 内部路径导入 UI：

```ts
// forbidden
import { Button } from '../../components/Button'
import { SearchInput } from '../../components/GlobalLauncher'
```

第一版 SDK 组件：

```ts
type PluginUiPrimitives = {
  Button: ComponentType<ButtonProps>
  IconButton: ComponentType<IconButtonProps>
  TextInput: ComponentType<TextInputProps>
  SearchField: ComponentType<SearchFieldProps>
  TextArea: ComponentType<TextAreaProps>
  Select: ComponentType<SelectProps>
  Checkbox: ComponentType<CheckboxProps>
  Toggle: ComponentType<ToggleProps>
  SegmentedControl: ComponentType<SegmentedControlProps>
  NumberField: ComponentType<NumberFieldProps>
  Slider: ComponentType<SliderProps>
  ToolbarButton: ComponentType<ToolbarButtonProps>
  SurfaceList: ComponentType<SurfaceListProps>
  SurfaceListItem: ComponentType<SurfaceListItemProps>
  SurfacePreview: ComponentType<SurfacePreviewProps>
  SurfaceEmptyState: ComponentType<SurfaceEmptyStateProps>
  SurfaceToolbar: ComponentType<SurfaceToolbarProps>
  SurfaceFooterHints: ComponentType<SurfaceFooterHintsProps>
  ConfirmDialog: ComponentType<ConfirmDialogProps>
}
```

规则：

- clipboard-history 使用这些 primitives 作为推荐样例。
- 不使用 primitives 的插件仍可通过审核，只要不违反权限和 shell 边界。
- primitives 不能暴露 host store、workspace object、Monaco instance、Tauri API 或 effect runner。
- primitives 的事件回调只返回 UI 意图，例如 `onSelect`、`onConfirm`、`onQueryChange`。
- primitives 不负责插件数据加载；数据由插件通过 host API 或自己的 state 提供。
- primitives 必须支持键盘可达、焦点状态、loading、empty、disabled、error 等基础状态。
- primitives 的样式必须基于公开 token，不依赖 host 私有 class。

### UI 使用规范

插件 surface 可以完全自定义 UI，但必须满足：

- 不直接操作 host shell DOM。
- 不假设自己在 launcher 或 tool window 中；返回和关闭只调用 `host.requestBack()` / `host.close()`。
- 文本必须在容器内截断或换行，不允许撑破 shell。
- 图片和预览必须设置 max width/height，不能让窗口尺寸被内容撑开。
- 可点击元素必须使用 button 或具有明确 role/keyboard handler。
- 危险动作例如清空历史必须二次确认。
- loading 和错误状态必须在插件 body 内可见，不允许静默失败。
- 不允许用大段 HTML string 或 innerHTML 渲染用户剪贴板内容。

clipboard-history 官方 UI 使用：

- `SurfaceToolbar`: 类型筛选、暂停/恢复、清空、打开设置。
- `SearchField`: 插件自管搜索输入。
- `SurfaceList`: 左侧历史列表和时间分组。
- `SurfaceListItem`: 文本、图片、文件路径三类历史项。
- `SurfacePreview`: 右侧预览。
- `SurfaceFooterHints`: Enter 粘贴、Cmd/Ctrl+C 复制、Delete 删除。
- `ConfirmDialog`: 清空全部历史。

### 样式与主题规范

外部插件样式只能依赖两类公开能力：

1. `@hiven/plugin-ui` 组件自带样式。
2. SDK 文档化 CSS tokens。

公开 CSS tokens 由 host 注入：

```css
:root {
  --hiven-color-bg-primary: var(--color-background-primary);
  --hiven-color-bg-secondary: var(--color-background-secondary);
  --hiven-color-bg-tertiary: var(--color-background-tertiary);
  --hiven-color-text-primary: var(--color-text-primary);
  --hiven-color-text-secondary: var(--color-text-secondary);
  --hiven-color-text-tertiary: var(--color-text-tertiary);
  --hiven-color-border: var(--color-border-secondary);
  --hiven-color-accent: var(--color-accent);
  --hiven-color-danger: var(--color-error);
  --hiven-radius-sm: 4px;
  --hiven-radius-md: 6px;
  --hiven-radius-lg: 8px;
  --hiven-font-ui: var(--font-sans);
  --hiven-font-mono: var(--font-mono);
  --hiven-space-1: 4px;
  --hiven-space-2: 8px;
  --hiven-space-3: 12px;
  --hiven-space-4: 16px;
}
```

插件自有 CSS 示例：

```css
.clipboard-history-layout {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(280px, 0.9fr);
  min-height: 0;
  color: var(--hiven-color-text-primary);
  background: var(--hiven-color-bg-primary);
}
```

样式规则：

- 插件 class 必须加 plugin 前缀，例如 `.clipboard-history-*`，避免污染其他插件。
- 不允许选择 host 内部 class，例如 `.global-launcher-panel .cmd-item`。
- 不允许覆盖 `body`、`:root`、`html`、全局 `button/input`。
- 不允许使用一组未文档化的 host CSS variables。
- 不允许把大量 style object 写在 JSX 内；稳定样式放 CSS 文件，动态值用 CSS variables 或 props。
- 插件 CSS 由插件包引入和作用域控制。第一版如果还没有 CSS loader，clipboard-history 必须通过 `@hiven/plugin-ui` primitives 和少量内联 layout style 过渡，并在实现计划中补 CSS loader，不得把完整视觉系统塞进 JS。

### Icons

外部插件不能直接依赖 host 内部 icon registry。第一版提供两种方式：

- contribution metadata 使用 icon string，由 host `resolveIcon` 处理。
- UI 内使用 `@hiven/plugin-ui/icons` 导出的稳定图标集合。

示例：

```ts
import { ClipboardIcon, ImageIcon, FileTextIcon } from '@hiven/plugin-ui/icons'
```

如果 SDK 没有需要的图标，插件可以用本包 `assets/icons/*.svg`，但不能引用 host `src/assets` 或 `lucide-react` 深路径。

## Clipboard History Plugin Design

### 产品目标

- 类似 Alfred/Raycast 的剪贴板历史工具。
- 支持文本、图片和文件路径。
- 支持独立快捷键直接唤起。
- 支持 GlobalLauncher 搜索“剪贴板历史”进入同一 UI。
- 默认动作是直接粘贴到上一个前台应用。
- 粘贴失败时复制到系统剪贴板并显示提示。
- 配置放插件设置页，不放系统 Settings。

### 设置默认值

```ts
type ClipboardHistorySettings = {
  enabled: boolean
  recordText: boolean
  recordImages: boolean
  recordFiles: boolean
  maxItems: number
  retentionDays: number
  maxTextBytes: number
  maxImageBytes: number
  maxTotalCacheBytes: number
  defaultAction: 'paste'
  pasteFailureFallback: 'copy-and-notify'
}

const DEFAULT_CLIPBOARD_HISTORY_SETTINGS: ClipboardHistorySettings = {
  enabled: false,
  recordText: true,
  recordImages: true,
  recordFiles: true,
  maxItems: 500,
  retentionDays: 30,
  maxTextBytes: 256 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalCacheBytes: 500 * 1024 * 1024,
  defaultAction: 'paste',
  pasteFailureFallback: 'copy-and-notify',
}
```

### 设置页

插件 settings body 提供：

- 总开关：启用剪贴板历史。
- 类型开关：文本、图片、文件路径。
- 最大条数。
- 保留天数。
- 文本单项大小。
- 图片单项大小。
- 总缓存容量。
- 清空全部历史。
- 打开系统 Accessibility 指引。
- 当前权限状态展示。

设置页只渲染 body。host 继续负责 settings dialog shell。

### 数据模型

```ts
type ClipboardHistoryItem =
  | ClipboardTextHistoryItem
  | ClipboardImageHistoryItem
  | ClipboardFilesHistoryItem

type ClipboardHistoryBase = {
  id: string
  kind: 'text' | 'image' | 'files'
  hash: string
  firstCopiedAt: number
  lastCopiedAt: number
  copyCount: number
  byteSize: number
}

type ClipboardTextHistoryItem = ClipboardHistoryBase & {
  kind: 'text'
  text: string
  preview: string
}

type ClipboardImageHistoryItem = ClipboardHistoryBase & {
  kind: 'image'
  blobId: string
  previewBlobId: string
  contentType: string
  width?: number
  height?: number
}

type ClipboardFilesHistoryItem = ClipboardHistoryBase & {
  kind: 'files'
  paths: string[]
  fileNames: string[]
  missingCount?: number
}
```

KV 存：

```text
history/items/<id>
history/index
history/settings-derived-state
```

Blob 存：

```text
image original blobs
image preview blobs
```

### 采集策略

- background 在 `settings.enabled === true` 且权限满足时启动。
- 调用 `ctx.clipboard.watch()`，按设置选择 text/images/files。
- 空内容不记录。
- 超过单项大小限制不记录。
- 图片保存原图 blob 和预览 blob。
- 文件只记录路径字符串和 metadata，不缓存文件内容。
- 相同 `hash` 只保留一条，重复复制时更新 `lastCopiedAt`、`copyCount` 并移动到顶部。
- 每次写入后执行 prune。

### 清理策略

prune 条件：

- 超过 `maxItems` 删除最旧项。
- 超过 `retentionDays` 删除过期项。
- 超过 `maxTotalCacheBytes` 删除最旧项直到低于限制。

删除 image item 时必须删除原图 blob 和预览 blob。删除 files item 不删除源文件。

### UI

surface：`clipboard-history.main`

布局：

- 左侧历史列表。
- 右侧预览。
- 窄宽度时降级为列表内摘要。

列表：

- 默认按时间倒序。
- 分组：今天、昨天、过去 7 天、更早。
- 顶部类型筛选：全部、文本、图片、文件。
- 插件自己渲染搜索框。
- 搜索范围：
  - text：全文和 preview。
  - image：类型、尺寸、时间。
  - files：文件名和路径。

预览：

- 文本：保留换行，长文本截断，提供复制全文。
- 图片：显示缩略图、尺寸、大小。
- 文件：显示文件名列表、路径、缺失状态。

操作：

- Enter：直接粘贴选中项。
- Cmd/Ctrl+C：复制选中项到系统剪贴板，不粘贴。
- Delete/Backspace：删除单条。
- Esc：由 host 处理，launcher 来源回 launcher，快捷键来源关闭。
- 清空全部：放在工具栏或设置页，执行前二次确认。
- 暂停/恢复记录：可放在工具栏。
- 打开设置：调用 `host.openSettings()`。

### Terminal Action

直接粘贴：

- 文本：`host.paste.pasteText(item.text)`
- 图片：`host.paste.pasteImage(item.blobId)`
- 文件：`host.paste.pasteFiles(item.paths)`

成功后 host 关闭当前 shell。不恢复旧剪贴板。

失败降级：

- 如果 paste API 返回 `{ fallback: 'copied' }`，显示“已复制到剪贴板，开启辅助功能权限后可直接粘贴”。
- host 关闭或保持窗口由 paste API 结果约定。第一版建议关闭，因为内容已复制。

### 不做的隐私过滤

第一版不做敏感内容自动过滤。文档和设置页必须明确：

- hiven 不自动识别密码、token、private key。
- 用户可暂停记录、清空历史、删除单条、关闭图片/文件记录。
- 后续可加入 regex skip rules、app blacklist、敏感内容启发式过滤。

## 迁移要求

### 从单文件 UI 插件迁移到目录插件

现有或后续出现的“UI 直接写进 `index.js`”形态必须迁移。典型问题包括：大量 JSX、CSS string、业务状态、host 深路径 import、Tauri API 调用和插件 definition 混在一个文件里。这类实现不可继续作为 clipboard-history 或 plugin UI surface 的参考。

迁移目标：

```text
index.tsx                    only definePlugin and imports
surfaces/<SurfaceName>.tsx   host-openable UI body
components/*.tsx             plugin-owned presentational components
settings/*.tsx               settings body
settings/model.ts            settings schema/defaults/migrate
background/*.ts              background lifecycle
storage/*.ts                 plugin private storage repository
styles/*.css                 plugin-scoped styles
```

迁移规则：

- 先拆文件，再改能力。不要一边重写产品逻辑一边迁移目录。
- `index.*` 中如果出现完整页面 JSX，必须移入 `surfaces/` 或 `settings/`。
- `index.*` 中如果出现 CSS string 或大段 inline style，必须移入 `styles/` 或改用 `@hiven/plugin-ui` primitives。
- 深路径 host imports 必须替换为 `@hiven/plugin`、`@hiven/plugin-ui` 或 host 注入 API。
- 如果 SDK 缺能力，新增 SDK API，再迁移插件；禁止临时保留深 import。
- UI 文案移入 `locales/`，不在组件里散落多语言字符串。
- 插件私有数据访问移入 `storage/` repository，UI 只调用 repository/hook。
- background 轮询或事件订阅移入 `background/`，不能由 surface mount/unmount 顺手启动后台采集。

迁移完成标准：

- 插件包可以通过目录边界检查。
- 禁止 import 清单无命中。
- `index.*` 只剩 contribution 组装。
- UI 可以从插件列表打开，也可以从 GlobalLauncher 打开。
- settings、surface、background、storage 各自职责清晰。

### 从现有 settings/panels 到 ui.surfaces

第一阶段不删除旧 API：

- `settings` 继续用于插件设置页。
- `panels` 继续用于 workspace 内 bottom/right/left panel。
- `launcher.items` 继续用于命令式 launcher flow。
- 新增 `ui.surfaces` 用于 host-openable 自定义 view。

实现要求：

- plugin registry 新增 surface registry，不能复用 panel registry 硬塞。
- GlobalLauncher 从 surface registry 生成 launcher items。
- 插件列表从 surface registry 展示“打开”和“绑定快捷键”。
- shortcuts store 使用 `source + pluginId + surfaceId`。
- 现有 web-open settings 不迁移为 surface。
- 现有 regex-tester panel 不强制迁移为 surface。

第二阶段可选迁移：

- 如果某个 panel 本质是独立工具入口，可新增 surface wrapper，但不删除 panel。
- 如果某个工具只需要 launcher 二级 flow，继续使用 launcher item，不迁移 surface。

### 架构检查新增项

`scripts/check-architecture.mjs` 后续应增加：

- `src/workspace` 不得 import `src/plugins`。
- 插件不得互相 import。
- 插件不得 import `src/components`、`src/store`、`src/workspace`、`src/i18n`、`src/kits` 深路径。
- 插件不得 import `@tauri-apps/*`。
- 插件不得在 `index.*` 中包含大段 JSX、HTML string 或 CSS string。检查可以先对 `src/plugins/*/index.*` 设置保守规则：禁止 `return (` 中出现复杂 JSX，禁止超过阈值的模板字符串样式。
- clipboard-history 不得 import `@tauri-apps/*`。
- clipboard-history 不得 import `src/store` 或 `src/workspace/*`，允许 `@hiven/plugin`。
- clipboard-history 必须存在 `surfaces/`、`settings/`、`background/`、`storage/` 目录。
- kits 不得依赖 plugin 或 workspace。
- workspace 不得出现 clipboard-history 产品文案或历史数据模型。
- 插件 CSS 不得选择 `.global-*`、`.command-palette-*`、`.workspace-*` 等 host 私有 class。

### SDK 更新

`@hiven/plugin` 需要导出：

- `definePlugin` 新类型。
- `PluginSurfaceProps`。
- background context 类型。
- permission/storage/clipboard/paste API 类型。
- `getPluginHostSdk()` 中的 stable hooks 和 host API 类型。

`@hiven/plugin-ui` 需要导出：

- 通用表单组件：`Button`、`IconButton`、`TextInput`、`SearchField`、`TextArea`、`Select`、`Checkbox`、`Toggle`、`SegmentedControl`、`NumberField`、`Slider`。
- surface primitives：`SurfaceToolbar`、`SurfaceList`、`SurfaceListItem`、`SurfacePreview`、`SurfaceEmptyState`、`SurfaceFooterHints`。
- overlay primitives：`ConfirmDialog`。
- 稳定图标集合：`@hiven/plugin-ui/icons`。
- CSS token contract 文档和类型辅助。

不得要求插件作者 import framework 深路径。

## 实施阶段

### Phase 0: SDK, UI Primitives, and Directory Guardrails

交付：

- `@hiven/plugin` 补齐 surface/background/permission/storage/clipboard/paste 类型导出。
- 新增或正式化 `@hiven/plugin-ui` 导出通用 UI primitives 和 icons。
- 定义公开 CSS token contract。
- 插件 package scaffold 按新目录生成文件。
- 架构检查阻止插件深 import host 目录。
- 架构检查阻止复杂 UI 继续堆在 `index.*`。

验收：

- 新建插件模板不引用 host 深路径。
- 模板中的 surface 使用 `@hiven/plugin-ui` primitives。
- 一个 demo plugin 可以只通过 SDK 渲染 settings body 和 custom-view surface。
- `src/plugins/*/index.*` 中无法新增大段 UI 而不触发检查。

### Phase 1: Platform Schema and Registry

交付：

- 扩展 `PluginManifest` 支持 `permissions`。
- 扩展 `PluginDefinition` 支持 `ui.surfaces` 和 `background`。
- 新增 surface registry。
- 新增权限状态 store。
- 新增 surface launcher item 适配。
- 新增插件列表 surface 展示。

验收：

- 一个 demo plugin 声明 surface 后，可在 GlobalLauncher 搜到并打开。
- 插件禁用后 surface 不出现在 GlobalLauncher。
- 未授权权限时 background 不启动。

### Phase 2: Tool Shell and Shortcut Binding

交付：

- tool shell 独立窗口。
- 插件列表 surface 级快捷键绑定 UI。
- 快捷键冲突检测和注册状态展示。
- 快捷键触发打开对应 surface。

验收：

- 一个插件多个 surface 可分别绑定快捷键。
- 冲突时不覆盖既有快捷键。
- 插件禁用后快捷键停用，重新启用后恢复注册。

### Phase 3: Host APIs

交付：

- private storage KV/blob/quota。
- Rust clipboard watcher API。
- paste API。
- permission-gated API wrapper。

验收：

- 未授权调用返回错误。
- 授权后 demo background 可 watch clipboard。
- blob 存储受插件目录隔离。
- paste 失败时能降级复制并提示。

### Phase 4: Clipboard History Plugin

交付：

- `src/plugins/clipboard-history` 插件包。
- settings body。
- background collector。
- list + preview surface。
- prune 和 dedupe。
- text/image/files 采集和恢复。
- plugin-scoped CSS 或 `@hiven/plugin-ui` primitives，不能把完整 UI 样式写在 `index.tsx`。

验收：

- 开启插件后复制文本、图片、文件路径会出现在历史中。
- 重复复制同一内容只更新到顶部。
- 超过条数、天数、容量会清理旧项。
- GlobalLauncher 可搜索打开剪贴板历史。
- 绑定快捷键可直接打开剪贴板历史。
- Enter 默认直接粘贴；失败时复制并提示。

## 验证要求

修改插件平台、launcher、workspace renderer 或 UI 后至少执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

涉及 tool shell、GlobalLauncher、插件列表快捷键和 clipboard-history UI 时，必须补浏览器或 Tauri 实机验证：

- GlobalLauncher 进入 surface 后 Esc 返回 launcher。
- 快捷键进入 surface 后 Esc 关闭。
- 插件崩溃不影响 host。
- 绑定快捷键冲突可见。
- 图片预览不撑破布局。
- 文本长内容不溢出。

如果全量 lint 或历史 UI 测试失败，最终结论必须区分历史失败和本次新增失败。

## 验收工作安排

这个任务必须把实现和验收分开。长任务执行时至少安排两个角色：

- 实现 agent：按阶段实现代码和测试，提交可审查 patch。
- 验收 agent：不参与实现，按本文档独立复核边界、行为、UI 和证据。

如果使用 subagent-driven development，每个 Phase 完成后都要由新的验收 agent 做阶段验收。主 agent 只做集成裁决，不直接采信实现 agent 的成功结论。

### 验收材料

每个 Phase 完成时，实现 agent 必须提供：

- 变更范围：改了哪些文件，为什么属于该 Phase。
- 自动化证据：命令、结果、失败原因。
- 手工证据：关键 UI/系统行为的截图或录屏说明。
- 边界证据：证明没有违反禁止项，例如没有深 import、没有把 UI 塞进 `index.*`。
- 风险和未完成项：必须明确哪些是本 Phase 非目标，哪些是阻塞。

验收 agent 必须输出：

- `PASS` / `FAIL` / `BLOCKED`。
- 阻塞问题列表，按严重程度排序。
- 可接受的已知风险。
- 是否允许进入下一 Phase。

### Phase 0 验收：SDK、UI primitives、目录 guardrails

自动化验收：

```bash
npm run check:architecture
git diff --check
npm run build
```

定向验收点：

- 新建插件模板生成标准目录：`components/`、`settings/`、`surfaces/`、`background/`、`storage/`、`styles/` 按能力出现。
- 模板 `index.*` 只做 `definePlugin` 组装，不包含完整页面 JSX。
- demo plugin 只通过 `@hiven/plugin` 和 `@hiven/plugin-ui` 渲染 settings body 和 custom-view surface。
- 故意在插件中 import `../../workspace/workspaceStore` 时，架构检查失败。
- 故意在插件中 import `@tauri-apps/plugin-clipboard-manager` 时，架构检查失败。
- 故意在 `src/plugins/demo/index.tsx` 放大段 UI 时，架构检查失败。
- `@hiven/plugin-ui` 不暴露 host store、workspace object、Monaco instance、Tauri API 或 effect runner。

验收失败条件：

- 外部插件必须深 import host 文件才能完成 UI。
- SDK 组件缺少 disabled、loading、error、empty 或键盘焦点状态。
- clipboard-history 需要的基础 UI 仍只能通过复制 host component 实现。

### Phase 1 验收：Schema、registry、launcher 集成

自动化验收：

```bash
npm run check:architecture
npm run test:launcher-registry
npm run test:launcher-controller
npm run test:launcher-plugin-contract
npm run build
```

定向验收点：

- demo plugin 声明 `ui.surfaces` 后，surface registry 能注册 `source + pluginId + surfaceId`。
- surface 默认出现在 GlobalLauncher，支持 title、titleI18n、aliases、拼音/模糊搜索。
- `entry.launcher === false` 的 surface 不出现在 GlobalLauncher。
- 插件禁用后 surface 从 GlobalLauncher 消失。
- surface launcher item 不是 command，不进入 command usage 旧链路。
- 从 GlobalLauncher 打开 surface 后，`Esc` 返回 launcher 列表，不直接关闭整个 app。
- surface component 抛错时 host 显示错误边界，可返回 launcher。
- 未授权 background 权限时，background 不启动并在插件列表显示 blocked 状态。

验收失败条件：

- workspace/framework 依赖具体插件。
- surface registry 复用 panel registry 硬塞导致 panel/surface 语义混淆。
- 插件可自己决定 launcher 来源返回策略。

### Phase 2 验收：Tool shell 和 surface 快捷键

自动化验收：

```bash
npm run check:architecture
npm run test:global-hotkey-settings
npm run test:global-pinned-launcher
npm run build
```

手工验收点：

- 插件列表中每个 bindable surface 都显示“打开”和“绑定快捷键”。
- 同一个插件多个 surface 可分别绑定不同快捷键。
- 快捷键冲突时不覆盖旧绑定，并明确显示占用者。
- 插件禁用后快捷键 unregister，但配置保留。
- 插件重新启用后快捷键恢复注册。
- dev 插件 reload 后，同一个 `source + pluginId + surfaceId` 的快捷键配置保留。
- 快捷键打开 tool shell 后，`Esc` 关闭。
- tool shell 失焦按配置 close on blur。
- tool shell 崩溃显示 host error state，不影响主窗口。

验收失败条件：

- 快捷键绑定到整个插件而不是具体 surface。
- 第一版出现 `run-command` 全局快捷键。
- 插件直接调用 Tauri window/global-shortcut API。

### Phase 3 验收：Host APIs

自动化验收：

```bash
npm run check:architecture
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

定向验收点：

- 未授权 `clipboard.read` 时，`ctx.clipboard.readText()` 返回权限错误。
- 未授权 `clipboard.watch` 时，background watch 不启动。
- 未授权 `storage.blob` 时，blob put 失败且错误可展示。
- private storage key 不能逃逸插件目录。
- 卸载 installed 插件会清理 private storage；禁用插件不删除数据。
- clipboard watcher 对 text/image/files 产出规范化事件。
- watcher 内部错误只影响当前插件，不影响其他插件。
- paste API 只提供 text/image/files 粘贴语义，不提供任意键盘模拟。
- Accessibility 不可用时，paste API 写入剪贴板并返回 fallback copied。

验收失败条件：

- 插件可拿到任意 filesystem 路径写权限来绕过 private storage。
- 插件可调用通用 key simulation。
- background stop 未执行，导致禁用/卸载后仍在轮询。

### Phase 4 验收：Clipboard History 插件

自动化验收：

```bash
npm run check:architecture
git diff --check
npm run build
```

定向脚本验收建议新增：

```bash
npm run test:clipboard-history-storage
npm run test:clipboard-history-boundary
npm run test:clipboard-history-settings
```

其中：

- `test:clipboard-history-storage` 覆盖 dedupe、retention、maxItems、maxTotalCacheBytes、blob 删除。
- `test:clipboard-history-boundary` 覆盖无 host 深 import、`index.*` 只组装、目录存在。
- `test:clipboard-history-settings` 覆盖默认关闭、开启后三类记录、设置变更重启 background。

手工验收矩阵：

```text
┌────────────┬──────────────────────────────┬──────────────────────────────┐
│ 场景       │ 操作                         │ 期望                         │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 默认状态   │ 安装/启动 clipboard-history   │ 默认不记录，设置页显示关闭   │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 文本记录   │ 开启后复制普通文本           │ 历史出现文本项，右侧可预览   │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 文本去重   │ 重复复制同一文本             │ 只保留一条，移动到顶部       │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 图片记录   │ 复制 10 MB 以下图片          │ 历史出现图片项和缩略图       │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 图片超限   │ 复制超过上限图片             │ 不记录，显示可理解提示       │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 文件路径   │ 复制文件                     │ 只记录路径，不缓存文件内容   │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 搜索       │ 搜文本/文件名                │ 列表过滤且预览同步           │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 类型筛选   │ 切换文本/图片/文件           │ 只显示对应类型               │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 删除单条   │ Delete 选中项                │ 删除记录和关联 blob          │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 清空全部   │ 点击清空                     │ 二次确认后清空记录和 blob    │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 直接粘贴   │ Enter 选中项                 │ 写剪贴板并尝试粘贴           │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 粘贴降级   │ 关闭 Accessibility 后 Enter  │ 已复制并提示开启辅助功能     │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ Launcher   │ 搜“剪贴板历史”进入           │ Esc 返回 launcher            │
├────────────┼──────────────────────────────┼──────────────────────────────┤
│ 快捷键     │ 绑定快捷键后触发             │ 打开 tool shell，Esc 关闭     │
└────────────┴──────────────────────────────┴──────────────────────────────┘
```

布局验收：

- 左列表 + 右预览在默认 tool shell 尺寸下不重叠。
- 长文本截断或滚动，不撑破窗口。
- 图片预览有最大尺寸，不改变 shell 尺寸。
- 文件路径长文本中间或末尾截断，仍可查看完整路径。
- 空态、loading、错误态可见。
- 所有按钮和列表项键盘可达。

验收失败条件：

- clipboard-history 代码写进 framework/workspace。
- clipboard-history 直接 import Tauri clipboard 或 host store。
- 图片 blob 删除不完整。
- 文件历史缓存了文件内容。
- 权限失败时无提示或 silently no-op。

### 最终集成验收

最终合入前，验收 agent 必须从干净工作区执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

并完成一次真实应用验收：

- 安装或启用 clipboard-history。
- 授权需要的权限。
- 绑定快捷键。
- 复制文本、图片、文件。
- 分别从 GlobalLauncher 和快捷键打开同一 surface。
- 执行直接粘贴和复制 fallback。
- 禁用插件，确认 background 和快捷键停止。
- 重新启用插件，确认设置和历史按设计恢复。

最终验收报告必须包含：

- 自动化命令结果。
- 手工验收矩阵结果。
- 未覆盖项和原因。
- 已知风险。
- 是否允许进入下一阶段或合入。

## 实现禁止项

- 禁止把 clipboard history 数据模型放进 `src/workspace`。
- 禁止把 clipboard-history UI 写成 framework component。
- 禁止把 clipboard-history 或其他复杂插件 UI 全写进 `index.js` / `index.tsx`。
- 禁止插件从 `src/components`、`src/store`、`src/workspace`、`src/i18n`、`src/kits` 深路径导入。
- 禁止插件直接复用 host 私有 CSS class 或 DOM 层级。
- 禁止插件通过未文档化 CSS variables 绑定 host 样式。
- 禁止插件 bundle 自己的 React。
- 禁止插件直接依赖 `lucide-react`、host icon registry 或 host assets；图标走 `@hiven/plugin-ui/icons` 或插件自带 assets。
- 禁止插件直接调用 `@tauri-apps/plugin-clipboard-manager`。
- 禁止开放任意键盘模拟 API。
- 禁止第一版实现 `run-command` 快捷键。
- 禁止把 surface 快捷键绑定到插件内部 tab/filter。
- 禁止让插件自己决定 launcher 来源时的返回策略。
- 禁止把图片文件副本当作文件历史缓存。文件历史只记录路径。
- 禁止在未授权权限时静默启动 background。
- 禁止为 clipboard-history 加敏感内容过滤后宣称安全；第一版明确不做。
