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
- Enter 后关闭全局启动器。
- 失败时用 toast 或 last command status 提示。

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
8. GlobalLauncher 关闭。

URL 拼接规则：

- 第一版只支持 `{query}` 一个变量。
- `encodeQuery: true` 时用 `encodeURIComponent(input)` 替换。
- `encodeQuery: false` 时用原始输入替换。
- 模板没有 `{query}` 时按固定链接处理。
- 空输入且 `emptyQueryBehavior: 'block'` 时不打开，提示需要输入。
- 空输入且 `emptyQueryBehavior: 'open'` 时按空字符串替换或打开固定链接。

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
- 二级输入 Enter 后触发 external open，并关闭 launcher。
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

