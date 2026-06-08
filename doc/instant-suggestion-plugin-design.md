# Instant Suggestion 插件机制设计

## 背景

FluxText 当前插件系统支持 `commands`、`renderers`、`panels`、`toolbar` 四类 contribution 类型。它们不是互斥的插件形式，而是同一个插件包可以组合声明的运行时能力。现有类型覆盖了显式命令、可视化渲染、面板和工具栏按钮，但还缺少一种“输入即识别”的快捷能力。

目标场景类似 Raycast 的 Calculator：用户在命令面板输入 `1+1`，命令面板顶部立即出现 `1+1 -> 2`，回车后复制结果。这个能力不应该写死在命令面板里，也不应该伪装成普通 command，因为它的触发方式不是“搜索命令再执行”，而是“当前输入被某个插件识别后生成候选项”。

## 目标

新增一种插件 contribution：`instantSuggestions`。

它允许插件声明自己可以参与命令面板的即时输入解析：

- Calculator 插件识别数学表达式。
- Color 插件识别 `#ff0000`、`rgb(...)`。
- UUID 插件识别 `uuid`。
- Encoder 插件识别 `base64 hello`、`url decode ...`。
- Date & Time Assistant 插件识别 `now`、`tomorrow 10am`、`2026-06-08 + 30 days` 和时间戳输入。

宿主负责把命令面板输入广播给这些 provider，并把命中的建议固定展示在搜索结果第一位。

## 非目标

第一版不做：

- 异步 provider。
- 网络请求类 provider，例如翻译、实时汇率。
- provider 主动产生副作用。
- 多个即时结果的复杂分组 UI。
- 让普通 command 参与每次输入解析。

第一版只支持同步、纯函数、本地确定性能力。第一期内置 provider 建议包含 Calculator 和 Date & Time Assistant，其中 Date & Time Assistant 覆盖常用时间表达式和时间戳读写。

## 核心模型

插件包可以同时声明多种 contribution 类型。一个插件包不是只能选择 command、renderer、panel、toolbar 中的一种，而是可以按产品体验需要组合多个 contribution。

```ts
export default definePlugin({
  commands: [],
  renderers: [],
  panels: [],
  toolbar: [],
  instantSuggestions: [],
})
```

因此需要避免“插件有几种形式”的说法。更准确的模型是：

```text
Plugin Package -> Contributions -> Registry -> Runtime Surfaces / Actions
```

插件包是安装、启用、禁用、更新和权限控制的单位。Contribution 是运行时能力单位。一个插件包可以贡献零到多个 command、panel、renderer、toolbar item 和 instant suggestion provider。

这比“一个插件一种类型”更合适，因为实际插件经常需要多入口组合。例如：

- `calculator` 插件：提供 `instantSuggestions`，也可以提供一个完整 calculator `panel`。
- `json-tools` 插件：提供 format/compact `commands`，JSON tree `renderer`，也可以提供 `json path` 即时查询。
- `color-tools` 插件：提供颜色转换即时建议，也可以提供 color picker `panel`。

`toolbar` 也不应该被理解成独立插件形态。它通常只是一个入口，可以指向某个 command，或者打开某个 panel。比如 `color-tools` 可以同时提供 color picker panel 和 editor toolbar button，toolbar button 点击后打开这个 panel。

## 类型设计

在 `src/workspace/pluginTypes.ts` 中新增：

```ts
export type InstantSuggestionContext = {
  query: string
  locale: Locale
}

export type InstantSuggestionAction =
  | { type: 'copy'; text: string }
  | { type: 'insert'; text: string }
  | { type: 'effects'; effects: FluxEffect[] }

export type InstantSuggestion = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  value: string
  icon?: string
  actionLabel?: string
  actionLabelI18n?: Partial<Record<Locale, string>>
  action: InstantSuggestionAction
}

export type InstantSuggestionProvider = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  priority?: number
  suggest(ctx: InstantSuggestionContext): InstantSuggestion | null
}
```

并扩展 `PluginDefinition`：

```ts
export type PluginDefinition = {
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
  toolbar?: ToolbarContribution[]
  instantSuggestions?: InstantSuggestionProvider[]
}
```

## 运行机制

命令面板每次输入变化时：

1. 读取当前 `query`。
2. 从 `pluginRegistry.getAllInstantSuggestionProviders()` 取出所有 provider。
3. 按 provider `priority` 从高到低调用 `suggest({ query, locale })`。
4. provider 自己判断是否命中。
5. 命中返回 `InstantSuggestion`，不命中返回 `null`。
6. 宿主选择最高优先级的命中结果。
7. 将该结果固定插入命令面板第一位。
8. 用户回车后，宿主执行 suggestion 的 `action`。

伪代码：

```ts
const instantSuggestion = pluginRegistry
  .getAllInstantSuggestionProviders()
  .sort((a, b) => (b.contribution.priority ?? 0) - (a.contribution.priority ?? 0))
  .map((entry) => ({
    entry,
    suggestion: entry.contribution.suggest({ query, locale }),
  }))
  .find((item) => item.suggestion !== null)

const allItems = [
  ...(instantSuggestion ? [{ kind: 'instant', ...instantSuggestion }] : []),
  ...filteredPluginCommands,
]
```

执行时：

```ts
if (item.kind === 'instant') {
  const action = item.suggestion.action
  if (action.type === 'copy') {
    await navigator.clipboard.writeText(action.text)
  }
  if (action.type === 'insert') {
    applyEffects([{ type: 'text.replace', target: 'active-input', text: action.text }])
  }
  if (action.type === 'effects') {
    applyEffects(action.effects)
  }
  setOpen(false)
  return
}
```

## Command Palette 改造

当前 `PaletteItem` 只有 plugin command：

```ts
type PaletteItem = { kind: 'plugin'; entry: CommandEntry; isDev: boolean }
```

需要改成联合类型：

```ts
type PaletteItem =
  | {
      kind: 'instant'
      provider: InstantSuggestionProvider
      suggestion: InstantSuggestion
      isDev: boolean
    }
  | {
      kind: 'plugin'
      entry: CommandEntry
      isDev: boolean
    }
```

渲染逻辑按 `kind` 分支：

- `instant`：展示 `suggestion.title`、`suggestion.subtitle`、`suggestion.value`、`suggestion.actionLabel`。
- `plugin`：保持现有 command 渲染逻辑。

键盘执行逻辑也按 `kind` 分支：

- `instant`：执行 `suggestion.action`。
- `plugin`：沿用 `runPluginCommand()`。

## Registry 改造

在 `pluginRegistry.ts` 中新增 `ScopedInstantSuggestionRegistry`，结构和 command/renderer/panel registry 一致：

```ts
class ScopedInstantSuggestionRegistry {
  private providers = new Map<string, InstantSuggestionEntry>()

  register(contribution: InstantSuggestionProvider, pluginId: string, source: ContributionSource): void
  unregisterByPlugin(pluginId: string): void
  clear(): void
  getAll(): InstantSuggestionEntry[]
}
```

`PluginRegistryImpl` 的 production/dev scope 增加：

```ts
instantSuggestions: new ScopedInstantSuggestionRegistry()
```

注册插件时：

```ts
registerProductionPlugin(
  pluginId,
  commands,
  renderers,
  panels,
  toolbar,
  instantSuggestions = []
)
```

卸载插件时同步清理该插件拥有的 instant providers。

## Loader 改造

需要在以下加载链路中透传 `definition.instantSuggestions ?? []`：

- `src/workspace/pluginRuntime.ts`
- `src/workspace/bundledPluginLoader.ts`
- dev plugin 注册链路
- production plugin 注册链路

同时 `definePlugin()` 的合法 contribution 判断需要包含 `instantSuggestions`：

```ts
const hasContributions =
  Array.isArray(definition.commands) ||
  Array.isArray(definition.renderers) ||
  Array.isArray(definition.panels) ||
  Array.isArray(definition.toolbar) ||
  Array.isArray(definition.instantSuggestions)
```

## Calculator 示例

```ts
const { definePlugin } = globalThis.FluxTextPlugin

export default definePlugin({
  instantSuggestions: [
    {
      id: 'calculator.inline',
      title: 'Calculator',
      titleI18n: { zh: '计算器' },
      priority: 100,
      suggest(ctx) {
        const expr = ctx.query.trim()
        const result = safeCalculate(expr)
        if (result == null) return null

        return {
          id: `calculator:${expr}`,
          title: `${expr} -> ${result}`,
          subtitle: 'Calculator',
          subtitleI18n: { zh: '计算器' },
          value: String(result),
          icon: 'Calculator',
          actionLabel: 'Copy Answer',
          actionLabelI18n: { zh: '复制答案' },
          action: { type: 'copy', text: String(result) },
        }
      },
    },
  ],
})
```

`safeCalculate()` 必须使用安全 parser，不允许使用 `eval` 或 `new Function`。

第一版建议支持：

- 数字。
- 小数。
- 括号。
- `+`、`-`、`*`、`/`。
- 百分号。
- 一元正负号。

不支持时直接返回 `null`，不要展示错误项。

## Date & Time Assistant 示例

时间相关能力建议命名为 `Date & Time Assistant`，中文名为 `时间助手`。不要命名成“时间戳转换”，因为第一期能力不只是 timestamp converter，还包括当前时间、自然语言时间、日期偏移和时间戳解释。

这个 provider 的定位是：在命令面板输入时间表达式时，快速给出一个可复制的标准时间结果。

第一期支持范围：

- `now`：输出当前本地时间，并附带 Unix timestamp。
- `tomorrow 10am`：输出明天上午 10 点的本地时间。
- `2026-06-08 + 30 days`：输出日期加减后的结果。
- `timestamp`、`unix time`、`now timestamp`：输出当前 Unix timestamp。
- `1717819200`：识别 10 位秒级 timestamp，输出对应本地时间。
- `1717819200000`：识别 13 位毫秒级 timestamp，输出对应本地时间。
- `timestamp 1717819200`：显式按 timestamp 解析，降低和普通数字输入冲突的风险。

展示建议：

```text
now -> 2026-06-08 14:32:10
Copy Date & Time

tomorrow 10am -> 2026-06-09 10:00:00
Copy Date & Time

2026-06-08 + 30 days -> 2026-07-08
Copy Date

1717819200 -> 2024-06-08 12:00:00
Copy Date & Time

now timestamp -> 1780919530
Copy Timestamp
```

示例插件：

```ts
const { definePlugin } = globalThis.FluxTextPlugin

export default definePlugin({
  instantSuggestions: [
    {
      id: 'date-time.assistant',
      title: 'Date & Time Assistant',
      titleI18n: { zh: '时间助手' },
      priority: 95,
      suggest(ctx) {
        const parsed = parseDateTimeQuery(ctx.query, new Date())
        if (parsed == null) return null

        return {
          id: `date-time:${parsed.kind}:${ctx.query.trim()}`,
          title: `${ctx.query.trim()} -> ${parsed.display}`,
          subtitle: 'Date & Time Assistant',
          subtitleI18n: { zh: '时间助手' },
          value: parsed.value,
          icon: 'Clock',
          actionLabel: parsed.actionLabel,
          actionLabelI18n: parsed.actionLabelI18n,
          action: { type: 'copy', text: parsed.value },
        }
      },
    },
  ],
})
```

解析策略：

- `now`、`timestamp`、`unix time` 这类关键词可以直接高置信度命中。
- `tomorrow 10am` 只支持明确的英文短语，第一版不做完整自然语言解析。
- `YYYY-MM-DD +/- N days` 使用正则解析，不引入重型日期库。
- 纯数字 timestamp 只识别 10 位或 13 位，避免和 Calculator 的普通数字输入冲突。
- 纯数字 timestamp 的 provider 优先级应低于 Calculator；显式 `timestamp 1717819200` 可以高置信度命中。

格式策略：

- 默认使用本地时区。
- 日期时间输出格式固定为 `YYYY-MM-DD HH:mm:ss`。
- 纯日期偏移输出 `YYYY-MM-DD`。
- timestamp 默认复制秒级 Unix timestamp；如果输入是 13 位毫秒级 timestamp，展示对应时间但复制格式仍由 suggestion 的 `value` 决定。
- 后续如需 UTC、ISO 8601，可扩展输入：`now utc`、`now iso`、`1717819200 utc`。

## 多 Contribution 插件示例

插件可以自己定义要贡献哪些能力，本质是声明多个 contribution：

```ts
export default definePlugin({
  instantSuggestions: [
    {
      id: 'color.convert-inline',
      title: 'Color Convert',
      priority: 90,
      suggest(ctx) {
        return matchColor(ctx.query)
      },
    },
  ],

  commands: [
    {
      id: 'color.convert-selection',
      title: 'Convert Selected Color',
      inputs: [{ key: 'input', label: 'Input', kind: 'text', required: true }],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        return { effects: [] }
      },
    },
  ],

  panels: [
    {
      id: 'color.picker',
      title: 'Color Picker',
      component: ColorPickerPanel,
    },
  ],
})
```

这样同一个插件可以同时提供：

- 命令面板即时建议。
- 对选中文本执行的 command。
- 完整 UI panel。
- 编辑器 toolbar 入口。

宿主不关心插件“是什么类型”，只关心它贡献了哪些 contribution。插件作者可以把多个 contribution 组合成一个完整体验，宿主只负责分别注册、展示、执行和清理这些 contribution。

## 安全和性能约束

`suggest()` 第一版必须满足：

- 同步返回。
- 不产生副作用。
- 不访问网络。
- 不读写文件。
- 不修改 workspace。
- 不弹窗。
- 不抛错到宿主。

宿主调用 provider 时需要 `try/catch`，单个 provider 报错只影响该 provider，并记录到插件状态或开发日志，不影响命令面板。

建议限制：

- query 为空时不调用 provider，或 provider 必须返回 `null`。
- query 超过一定长度时跳过 instant suggestions，例如 500 字符。
- 每次输入只展示一个最高优先级结果。

## 优先级建议

不同 provider 使用 `priority` 控制冲突：

```text
calculator: 100
date-time-assistant: 95
color: 90
uuid: 80
encoding: 70
```

例如 `#123456` 同时可能被普通搜索命中，也可能被 color provider 命中。只要 color provider 返回 suggestion，它固定排在命令面板第一位；普通 command 继续显示在后面。

时间助手和计算器存在一个特殊冲突：纯数字既可能是普通输入，也可能是 timestamp。第一期建议：

- `1+1`、`123 * 456` 由 Calculator 命中。
- `1717819200` 这类 10 位数字可以由 Date & Time Assistant 命中。
- `12345` 不作为 timestamp 命中。
- `timestamp 12345` 显式 timestamp 查询可以由 Date & Time Assistant 命中，但如果长度不合理，应返回提示型结果还是返回 `null` 需要实现时再定；MVP 建议返回 `null`。

## 渐进实施顺序

1. 增加 `InstantSuggestionProvider` 类型和 `PluginDefinition.instantSuggestions`。
2. 扩展 `definePlugin()` 合法 contribution 判断。
3. 扩展 `pluginRegistry`，支持 production/dev instant provider 注册和清理。
4. 扩展 plugin runtime 和 bundled loader，注册 `instantSuggestions`。
5. 扩展 Command Palette 的 `PaletteItem` 联合类型。
6. 在 Command Palette 中计算最高优先级 instant suggestion 并置顶。
7. 实现 `copy` action。
8. 增加内置 `calculator` provider，使用安全数学 parser。
9. 增加内置 `date-time-assistant` provider，支持 `now`、`tomorrow 10am`、`YYYY-MM-DD +/- N days`、当前 timestamp 和 10/13 位 timestamp 解析。
10. 补充最小验证脚本，覆盖命中、未命中、置顶、复制动作、Calculator 和 Date & Time Assistant 的优先级冲突。

## 推荐结论

Instant Suggestion 应该作为插件系统的第五类 contribution，而不是 Calculator 的特例。

同时，插件应允许自己声明多种 contribution。插件包是安装单位，contribution 是能力单位。这样既能支持 `1+1 -> 2` 这种轻量快捷能力，也能支持同一插件同时提供 command、panel、renderer、toolbar 等完整体验。
