# Plugin Settings and Web Quick Open Design

## 背景

hiven 需要支持一类“只影响插件自身产品体验”的配置能力。网页快开插件是首个目标场景：用户在全局启动器里选择一个可配置别名，例如 `bd`，进入二级输入态后输入关键词，插件拼接 URL 并打开网页。

这个能力不应把网页搜索、URL 模板或具体产品策略放进 framework。framework 只提供插件设置页挂载、插件私有配置持久化、全局启动器二级入口和外部打开 effect。

## 目标

- 插件可以可选提供设置页。
- 插件设置页只渲染弹窗 body，host 负责弹窗外壳。
- 插件配置由 host 按 `source + pluginId` 隔离持久化。
- 插件可从设置页、命令或 launcher entry provider 读取同一份 resolved settings。
- GlobalLauncher 支持插件贡献“只出现在全局启动器”的二级输入入口。
- 网页快开插件通过配置生成多个 launcher quick entry。

## 非目标

- 不实现插件全局唯一 alias 锁。
- 不把插件设置页作为 workspace renderer 或 panel。
- 不让插件直接读写全局 `settings` 或 `localStorage`。
- 不让插件通过 shell 字符串执行外部打开。
- URL 模板第一版不支持表达式、多个变量或脚本逻辑。

## 插件设置页能力

`PluginDefinition` 增加可选 `settings` contribution：

```ts
type PluginSettingsContribution<TSettings = unknown> = {
  title?: string
  titleI18n?: Partial<Record<Locale, string>>
  version?: number
  defaultValue: TSettings
  migrate?: (stored: unknown, fromVersion: number) => TSettings
  component: ComponentType<PluginSettingsBodyProps<TSettings>>
}

type PluginSettingsBodyProps<TSettings = unknown> = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  value: TSettings
  defaultValue: TSettings
  setValue: (next: TSettings) => void
  updateValue: (patch: Partial<TSettings>) => void
  resetValue: () => void
  openExternal: (url: string) => Promise<void>
}
```

host 负责：

- 全局 `PluginSettingsDialog`。
- 标题、关闭按钮、尺寸、滚动、加载态和错误边界。
- 从插件详情页打开设置弹窗。
- 未来从 GlobalLauncher deep-link 到同一个弹窗。
- 插件设置持久化、默认值解析和迁移调用。

插件负责：

- 渲染设置 body。
- 自己决定实时保存还是 draft + 保存按钮。
- 自己理解配置结构和迁移语义。

settings component 渲染崩溃只影响设置弹窗，不影响插件命令运行。`migrate` 抛错时不应清空旧配置；host 回退到 `defaultValue` 用于当前运行，并在设置弹窗中提示迁移失败。

## 设置持久化

持久化结构按来源隔离：

```ts
type PluginSettingsStore = {
  builtin: Record<string, PluginSettingsRecord>
  installed: Record<string, PluginSettingsRecord>
  dev: Record<string, PluginSettingsRecord>
}

type PluginSettingsRecord = {
  version: number
  value: unknown
}
```

`builtin:web-open`、`installed:web-open`、`dev:web-open` 是三份配置，不共享。builtin 插件源码只读，但用户设置可写。

命令和 launcher provider 执行时，host 注入 resolved settings：

```ts
type PluginCommandContext = {
  inputs: ResolvedInputs
  params: Record<string, unknown>
  settings?: unknown
}
```

## 外部打开能力

framework 提供 host-controlled external open：

```ts
type PluginHostEffects = {
  openExternal: (url: string) => { type: 'app.openExternal'; url: string }
}
```

settings body 同时通过 props 获得 `openExternal(url)`，用于测试按钮。

第一版不做 URL 协议白名单，允许用户配置 `http:`、`https:`、custom scheme 或其他 OS 支持的 URL。但实现必须走 Tauri/OS 安全打开 API，不允许拼 shell 字符串执行。

## GlobalLauncher Quick Entry

插件可贡献只出现在全局启动器的二级输入入口。该能力独立于普通 command list，避免用户配置大量 alias 后污染命令面板。

建议 contract：

```ts
type LauncherQuickEntry = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  icon?: string
  aliases: string[]
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  allowEmptyInput?: boolean
  emptyInputMessage?: string
  emptyInputMessageI18n?: Partial<Record<Locale, string>>
  run(input: string, ctx: LauncherQuickEntryContext): PluginCommandResult | Promise<PluginCommandResult>
}

type LauncherQuickEntryContext = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
  settings: unknown
}

type LauncherQuickEntryProvider = {
  getEntries(ctx: { settings: unknown; locale: Locale }): LauncherQuickEntry[]
}
```

`PluginDefinition` 增加：

```ts
launcherQuickEntries?: LauncherQuickEntryProvider
```

framework 负责：

- `aliases`、`title`、`subtitle` 的匹配。
- alias exact / prefix / fuzzy 排序。
- 中文 title 的拼音匹配。
- 重复 alias 的展示和选择行为。
- 二级输入态 UI。
- 执行成功后关闭全局启动器。
- 执行失败时在 launcher 内直接展示错误。

插件负责：

- 生成 entries。
- 根据二级输入返回 effects。

重复 alias 允许。完全匹配时展示所有匹配项，用户通过 title/subtitle 区分来源。

## 搜索与排序

匹配规则：

- alias exact 排第一。
- alias prefix/includes 次之。
- title/subtitle 普通文本匹配。
- title/subtitle 拼音匹配。

`placeholder` 只用于二级输入态展示，不参与一级搜索，避免搜索噪音。

当前 GlobalLauncher 已有 `pinyin-pro` 搜索基础，新的 launcher quick entry 应接入统一匹配层，而不是由网页快开插件自行实现拼音搜索。

fuzzy 匹配属于 framework 能力。实现时应复用或抽出现有 GlobalLauncher/CommandPalette 的匹配工具，统一处理普通文本、alias 和拼音匹配；插件只提供可搜索字段，不实现排序算法。

## 网页快开插件

默认配置：

```ts
type WebQuickOpenSettings = {
  entries: WebQuickOpenEntry[]
}

type WebQuickOpenEntry = {
  id: string
  title: string
  aliases: string[]
  placeholder: string
  urlTemplate: string
  encodeQuery: boolean
  emptyQueryBehavior: 'block' | 'open'
}
```

默认 entry：

```ts
{
  id: 'baidu',
  title: '百度搜索',
  aliases: ['bd', 'baidu'],
  placeholder: '输入搜索关键词',
  urlTemplate: 'https://www.baidu.com/s?wd={query}',
  encodeQuery: true,
  emptyQueryBehavior: 'block'
}
```

交互：

1. 用户打开全局启动器。
2. 输入 `bd`、`baidu`、`百度`、`bds` 等可匹配文本。
3. 选择 `百度搜索`。
4. 启动器进入二级输入态，展示该 entry 的 placeholder。
5. 用户输入关键词并按 Enter。
6. 插件用 URL 模板生成目标 URL。
7. 返回 `app.openExternal` effect。
8. 打开成功后 GlobalLauncher 关闭；失败时停留在二级输入态并展示错误。

URL 拼接规则：

- 第一版只支持 `{query}` 一个变量。
- `encodeQuery: true` 时用 `encodeURIComponent(input)` 替换。
- `encodeQuery: false` 时用原始输入替换。
- 模板没有 `{query}` 时按固定链接处理。
- 空输入且 `emptyQueryBehavior: 'block'` 时不打开，提示需要输入。
- 空输入且 `emptyQueryBehavior: 'open'` 时按空字符串替换或打开固定链接。

## 实现细节决策

### 持久化方案

第一版不引入 SQLite。插件设置跟随现有 `hiven-settings` zustand persist 体系持久化，减少 Tauri/Rust 侧依赖、迁移和测试成本。

持久化结构仍按 `source + pluginId` 隔离：

```ts
type PersistedPluginSettings = {
  pluginSettings: PluginSettingsStore
}
```

dev 插件的 settings 也持久化。dev 插件安装状态是 session-only，但设置数据是用户劳动成果，应保留；重新加载同名 dev 插件时可以复用同一份 `dev + pluginId` 设置。

### setValue 语义

`setValue` / `updateValue` 调用即立即持久化（write-through），无 draft 中间态。如果插件想要 draft + 保存模式，由插件自己用 local state 管理，保存时再调 `setValue`。

### 设置入口

在 ScriptsView 的 `PluginCard` 的 `actions` 区域增加齿轮图标按钮，仅对声明了 `settings` contribution 的插件显示。点击打开全局单例的 `PluginSettingsDialog`。

zustand store 使用完整目标对象，不只存 pluginId：

```ts
type PluginSettingsDialogState = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
} | null
```

原因是 dev / installed / builtin 的同名 pluginId 设置不共享。

### definePlugin 泛型

提供 type-safe helper，插件无需手动断言 settings 类型：

```ts
export function definePlugin<TSettings = unknown>(
  definition: PluginDefinition<TSettings>
): PluginDefinition<TSettings>
```

`PluginDefinition<TSettings>` 将 `settings.defaultValue`、`settings.component` props、`launcherQuickEntries.getEntries()` 的 `ctx.settings` 全部关联为 `TSettings`。

### entries 缓存策略

`LauncherQuickEntryProvider.getEntries()` 是纯转换函数，不依赖外部动态状态。Framework 在 settings 变更时重新调用并缓存结果，GlobalLauncher 打开时直接使用缓存，不重复调用。

实现为 derived state：`entries = useMemo(() => getEntries({ settings, locale }), [settings, locale])`。

### 二级输入态

新建独立状态 `activeQuickEntry`，与现有 `quickTextSession` 并列互斥。原因：quick entry 的交互是"输入→执行"，成功后关闭，失败时直接在 launcher 内展示错误；与 quickTextSession 的"输入→看输出→复制"行为差异大。

Quick entry 与 quick-command 合并在同一个 `LauncherSection`（"Quick Text"区）展示，不新建独立分区。

### 二级输入态退出行为

- Escape → 退回一级搜索列表，清空 query（与现有 `quickTextSession` 行为一致）。
- 输入为空时 Backspace → 也退回一级（增强行为，现有 quickTextSession 无此能力）。

### 错误展示

错误在 launcher 内部展示，不使用 toast（因 launcher 可作为独立窗口运行，toast 渲染在主窗口用户看不到）。

分层策略：

- `allowEmptyInput === false`（空输入拦截）→ 输入框抖动 + 使用 `emptyInputMessage` 或通用文案提示。Framework 层拦截，不调用 `run()`。
- `run()` 执行失败 → 二级输入态下方一行红色错误文本，保持二级态不关闭，用户可修改后重试。

`emptyQueryBehavior` 是网页快开插件自己的产品配置，不进入 framework contract。网页快开插件在生成 launcher quick entry 时，把 `emptyQueryBehavior: 'block'` 映射为 `allowEmptyInput: false`。

### openExternal 实现

使用 host 侧 `openExternal(url)` wrapper 调用 Tauri shell plugin 的 open 能力，不拼 shell 字符串。插件、settings body 和 effect runner 都只接触 host wrapper / effect API，不直接 import Tauri shell API。

当前 Rust 侧已有 `tauri-plugin-shell`，capability 中已有 `shell:allow-open`。实现 wrapper 时补齐前端 `@tauri-apps/plugin-shell` npm 依赖，或在 Tauri command 中封装打开逻辑；首选补前端依赖并集中封装在 workspace/effects 层，避免插件代码和 UI 组件分散依赖 Tauri API。

扩展 `AppEffect` union：

```ts
export type AppEffect =
  | { type: 'app.showMainPanel' }
  | { type: 'app.openExternal'; url: string }
```

### 迁移边界规则

- **降级**（stored version > current plugin version）：不调 `migrate`，回退到 `defaultValue`。旧数据保留在 persisted settings 中不删除。设置弹窗提示"配置版本高于当前插件，已恢复默认"。
- **migrate 返回 null/undefined**：视为迁移失败，回退 `defaultValue` + 提示迁移失败。
- **多版本跳跃**：只调一次 `migrate(stored, fromVersion)`，由插件自己负责处理跨版本跳跃逻辑。

### entry id 生成

`WebQuickOpenEntry.id` 在用户新增时由插件自动生成（`crypto.randomUUID()`），用户不可见不可编辑。用途：React list key、内部索引、未来 recent 追踪。

### 网页快开设置页 UI

- 可展开列表形式：默认折叠显示 title + aliases 摘要，点击展开编辑所有字段，底部"添加"按钮。
- aliases 输入使用逗号分隔文本框。
- host 提供 `openExternal(url)` 给 settings body 使用；网页快开插件第一版可以暂不提供测试按钮。

## 验收标准

- 插件卡片中只有声明了 `settings` 的插件显示设置入口。
- 设置弹窗可打开、关闭，并由 host 控制弹窗外壳。
- settings body 修改后能写入对应 `source + pluginId` 的持久化记录。
- builtin 插件设置可写。
- dev / installed / builtin 同名 pluginId 配置互不影响。
- settings component 抛错不影响插件命令或 launcher entry 运行。
- GlobalLauncher 能展示插件贡献的 quick entries。
- 输入 alias、title、拼音或拼音首字母可匹配 entry。
- 选择 entry 后进入二级输入态，并使用 entry placeholder。
- 二级输入 Enter 后触发 external open；成功关闭 launcher，失败在 launcher 内展示错误。
- 网页快开 URL 只替换 `{query}`，编码开关生效。

## 建议验证

修改插件系统、GlobalLauncher 和 UI 后至少执行：

```bash
npm run check:architecture
git diff --check
npm run build
```

建议补充 focused 测试：

- plugin settings persistence test。
- plugin settings source isolation test。
- launcher quick entry matching and pinyin test。
- web quick open URL template test。
- settings dialog render error boundary test。
