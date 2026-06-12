# Source-Scoped Launcher Ranking Plan

## 背景

当前已修复：

- `web-open` 插件配置页已拆到 `src/plugins/web-open/settings/`，插件入口只通过 `@hiven/plugin` 使用公开 API。
- `PluginSettingsBodyProps` 已由 host 注入 `locale` 和插件作用域 `t`，避免插件自己跨目录读 store/i18n。
- `CommandPalette` 和 `GlobalLauncher` 已共用 `src/workspace/searchRanking.ts` 的匹配与评分逻辑。
- `GlobalLauncher` 已去掉分类 section，改为单一排序列表，并支持唯一结果时 Enter 直接选择该项。
- `textOutput` 已在命令执行层转换成 `text.replace`，修复 `line-tools.reverse` 等纯文本插件运行后不上屏的问题。
- native launcher 已修复重复唤起缩窗、双击 Command 长按误判问题。

还需要做的是：常用推荐不能只按 command id 统计全局频率。应用内命令面板、全局启动器、未来其他 surface 的使用习惯不同，评分时必须带“唤起来源”维度。

这里的“唤起来源”指用户在哪个启动器/面板里完成了选择，而不是底层执行函数从哪里被调用。也就是说，source 归属应该在 `CommandPalette.selectItem`、`GlobalLauncher.selectItem`、pinned runner 的用户交互入口处确定；`runPluginCommandById` 只是命令执行器，不应该默认替调用方决定推荐来源。

## 目标

- 同一个 command 在不同入口有独立的 recent 和 usage 分数。
- `CommandPalette` 使用 app/palette 作用域的 usage。
- `GlobalLauncher` 使用 global-launcher 作用域的 usage。
- 共享 `searchRanking.ts` 继续只负责通用评分公式，不直接依赖 React、store 或具体 UI。
- 保留旧数据兼容：已有 `recentActionNames` / `actionUsageCounts` 不丢失，至少作为 app/palette 默认来源的迁移输入。

## 非目标

- 不重新引入 GlobalLauncher 分类 section。
- 不为每个插件单独设计推荐策略。
- 不把网页快开、JSON、SQL 等产品语义写进 framework。
- 不迁移 `jsFilter` / `regex-tester` 的 renderer API 边界；那是单独的 renderer host API 设计问题。

## 数据模型

在 `src/store.ts` 里新增 source-scoped usage 结构：

```ts
export type ActionUsageSource =
  | 'command-palette'
  | 'global-launcher'
  | 'pinned-runner'

export type ActionUsageBucket = {
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}
```

建议 store 形态：

```ts
actionUsageBySource: Record<ActionUsageSource, ActionUsageBucket>
pushRecentAction: (name: string, source?: ActionUsageSource) => void
```

兼容策略：

- `source` 默认值为 `'command-palette'`，避免改漏调用点时改变既有 app 内行为。
- persist migration 中，如果旧 state 有 `recentActionNames` 或 `actionUsageCounts`，迁移到 `actionUsageBySource.command-palette`。
- 旧字段可以保留一版作为 computed/backward-compatible fallback，也可以在迁移后删除；如果删除，要同步更新所有测试和 partialize。

## 选择归属

`CommandPalette`：

- 读取 `actionUsageBySource.command-palette`。
- 在用户通过命令面板选择插件命令时调用 `pushRecentAction(command.id, 'command-palette')`。
- instant suggestion 是否记 usage 第一版保持不变，除非已有明确产品规则。

`GlobalLauncher`：

- 读取 `actionUsageBySource.global-launcher`。
- 通过全局启动器选择普通 command 时，记录到 `global-launcher`。
- standalone launcher 的实际执行会通过 Tauri event 转发到 main window，但推荐来源仍然应该在 standalone `GlobalLauncher.selectItem` 里确定，并随 event payload 一起传递。
- quick-command 进入二级 quick text session 时是否记录 usage，需要产品取舍：
  - 推荐：进入 quick text session 时先不记录；
  - 用户确认复制/执行输出时，再按 command id 记录 `global-launcher`；
  - 避免用户只是预览/误进二级态也污染推荐。
- quick-entry（例如网页快开）不是普通 command。建议使用稳定 usage key：`launcher-entry:${pluginId}:${entry.id}`，记录到 `global-launcher`。
- pinned item 建议按其 `actionId` 作为排序 key；但打开 pinned item 是否增加 usage 要保持和当前 pinned runner 语义一致。第一版可以只对从 launcher 直接运行的 command / quick-entry 计数，避免把“打开固定面板”误当作“运行插件命令”。

`runPluginCommandById`：

- 不应无条件写入某个固定 usage source。
- 它可以接受一个可选参数用于少数调用方透传，但默认必须不记录。
- 更推荐的实现是：选择层先写 usage，再调用 executor；executor 不参与推荐统计。
- 如果确实需要 executor 帮调用方透传，参数也必须显式：

```ts
usageSource?: ActionUsageSource | false
```

- `false` 表示不记录 usage。
- 调用方明确传 source；缺省不记录，避免后台/程序化执行污染推荐。

当前实际链路参考：

```ts
// CommandPalette: 用户选择后直接 runPluginCommand(...)
function selectItem(item) {
  runPluginCommand(item.entry, item.isDev, customizeParams)
}

// GlobalLauncher: overlay/in-app 直接 runPluginCommandById(...)
if (item.kind === 'command') {
  void runPluginCommandById(item.id, { isDev: item.isDev })
}

// GlobalLauncher: standalone 先 emit 到 main，再由 App 调 runPluginCommandById(...)
await emitTo('main', 'hiven://run-plugin-command', { id: item.id, isDev })
```

所以 `global-launcher` 的 usage 归属不能靠 `runPluginCommandById` 猜，必须由 `GlobalLauncher.selectItem` 在 emit 或直接调用前确定。

## 搜索评分

`src/workspace/searchRanking.ts` 保持当前 API：

```ts
scoreSearchableFields(fields, q, locale, recentNames, usageCounts)
```

不要让它直接接触 source；source 的选择发生在 UI/store 适配层：

```ts
const usage = actionUsageBySource['global-launcher']
scoreSearchableFields(fields, q, locale, usage.recentActionNames, usage.actionUsageCounts)
```

这样可以保证评分公式复用，但数据来源按 surface 隔离。

## 验收标准

- 在 CommandPalette 里频繁使用 `json.format` 不会让它在 GlobalLauncher 默认推荐中获得同等加权。
- 在 GlobalLauncher 里频繁使用 `sqlin` 或其他命令，只影响 GlobalLauncher 的默认排序和搜索同分排序。
- 搜索匹配层级仍高于使用频率：精确命中/前缀命中不能被高频无关项压过。
- 旧用户的 app 内最近命令和使用次数不会清空。
- `GlobalLauncher` 仍不显示分类标题。

## 建议测试

- 新增或扩展 store migration 脚本测试：旧 `recentActionNames/actionUsageCounts` 迁移到 `command-palette` bucket。
- 扩展 `scripts/test-global-pinned-launcher.mjs`：断言 GlobalLauncher 读取 `global-launcher` bucket，不读取 command-palette bucket。
- 新增 command palette ranking 脚本：断言 CommandPalette 读取 `command-palette` bucket。
- 扩展 `scripts/test-plugin-text-output-contract.mjs` 或新增 command executor 测试：断言 `runPluginCommandById(..., { usageSource: false })` 不记录 usage。

## 风险

- 如果 `runPluginCommandById` 默认继续记录 usage，standalone launcher、事件桥、后台恢复命令可能污染 command-palette 统计。
- 如果保留旧字段和新字段双写太久，后续排序会出现“看起来随机”的重复来源问题。建议迁移后明确单一读路径。
- 如果 pinned item 用 `pinned.id` 计分而不是 `actionId`，同一个插件命令被重新 pin 后会丢失历史推荐。第一版建议用 `actionId` 作为 usage key。
