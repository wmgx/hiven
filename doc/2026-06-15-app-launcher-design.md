# App Launcher Design

## 背景

hiven 的 GlobalLauncher 已经支持 host action、plugin launcher item、plugin dynamic item 和统一的搜索排序。下一步希望让启动器可以启动本机应用，但这个能力涉及系统应用扫描、图标提取、系统唤起和权限控制，不应让普通插件直接遍历系统目录或执行 shell。

本设计把应用启动器做成 first-party privileged plugin：插件拥有产品逻辑和缓存数据，host 提供受控系统能力。

## 目标

- 支持跨平台应用启动器。
- 只索引已安装应用，不索引脚本、文件夹、网页、URL scheme 或任意命令。
- 只出现在 GlobalLauncher，不进入 CommandPalette。
- 应用结果与现有 launcher 条目混排。
- 复用现有 GlobalLauncher matching、ranking 和 usage，不新增应用专属搜索排序。
- 展示真实应用图标；图标读取失败时使用默认 app 图标。
- 通过系统原生逻辑唤起应用，不管理进程生命周期。
- 权限模型对齐 clipboard-history。
- 查询路径只读缓存，不触发磁盘扫描。

## 非目标

- 不做隐藏应用。
- 不做用户别名。
- 不做置顶。
- 不做后台监听。
- 不做定时扫描。
- 不做启动时自动扫描。
- 不做空列表兜底扫描。
- 不做设置页。
- 不做 custom surface。
- 不开放任意路径执行、shell command、launch args 或通用 automation 能力。

## 架构边界

`app-launcher` 插件负责：

- 声明 GlobalLauncher 条目。
- 提供“刷新应用索引”入口。
- 调用 host-gated app discovery API。
- 持有 AppIndex 展示缓存、图标缓存和刷新元数据。
- 把缓存中的应用转换为 GlobalLauncher dynamic item。
- 调用 host-gated app launch API。

host 负责：

- 权限展示和运行时权限检查。
- 跨平台应用扫描实现。
- 应用图标提取。
- 系统应用唤起。
- 插件 private storage 和 blob storage enforcement。
- launcher shell、执行生命周期、错误展示和统一搜索排序。

插件可以保存展示路径 `displayPath`，用于 subtitle 区分同名应用；但插件不能通过路径启动应用。启动只能传 `appId`。

## 插件目录

第一版插件放在：

```text
src/plugins/app-launcher/
  manifest.json
  index.ts
  locales/
    en.json
    zh.json
  storage/
    model.ts
    repository.ts
```

不需要 `settings/`、`surfaces/` 或 `background/`。

manifest 声明权限：

```json
{
  "pluginId": "app-launcher",
  "displayName": "App Launcher",
  "capabilities": ["launcher"],
  "permissions": ["app.discover", "app.launch"]
}
```

## Host API

API 挂在 launcher execution context 的受控能力下：

```ts
type PluginAppsApi = {
  discoverApps(): Promise<DiscoveredApp[]>
  launchApp(appId: string): Promise<void>
}

type PluginLauncherApi = {
  apps: PluginAppsApi
}
```

权限语义：

- `app.discover`: 允许扫描系统已安装应用并提取展示 metadata。
- `app.launch`: 允许通过 `appId` 请求系统唤起应用。

没有权限时，host API 返回权限错误。插件不自己判断系统权限。

## Discovered App

host 扫描 API 返回归一化展示字段：

```ts
type DiscoveredApp = {
  appId: string
  name: string
  platform: 'macos' | 'windows' | 'linux'
  source: 'applications' | 'start-menu' | 'app-paths' | 'desktop-entry'
  displayPath?: string
  icon?: {
    bytes: Uint8Array
    contentType: 'image/png'
    hash: string
  }
}
```

规则：

- `appId` 由 host 生成，插件只透传。
- `displayPath` 只用于展示和同名区分，不用于启动。
- 不返回 shell command、launch args 或可执行 target。
- 图标统一返回 PNG 数据；提取失败不影响应用入库。

## AppId

`appId` 必须稳定，但不把真实启动路径暴露为公开 contract。

策略：

```text
macOS
- 优先 CFBundleIdentifier
- 没有 bundle id 时，用 canonical .app path hash

Windows
- 优先 AppUserModelID / Start Menu shortcut target identity
- 缺失时，用 shortcut path + target path hash

Linux
- 优先 desktop file id
- 缺失时，用 canonical .desktop path hash
```

host 负责维护 `appId -> launch target` 的内部映射。插件不读取这个映射。

## 扫描范围

第一版只扫描系统约定应用入口，不递归扫全盘。

```text
macOS
- /Applications
- ~/Applications
- /System/Applications

Windows
- 当前用户 Start Menu
- 全局 Start Menu
- App Paths 注册表作为补充

Linux
- /usr/share/applications
- /usr/local/share/applications
- ~/.local/share/applications
```

## 去重

扫描结果需要去重，减少重复噪音。

去重 key：

```text
macOS: bundle id 优先，其次 canonical .app path
Windows: AppUserModelID 优先，其次 resolved target path，其次 shortcut path
Linux: desktop id 优先，其次 Exec + desktop file path
```

冲突策略：

- 同一去重 key 只保留一个条目。
- 优先系统级稳定来源，其次用户级来源，其次名称更清晰的条目。
- 第一版不做用户别名合并。

## 缓存

AppIndex cache 属于 `app-launcher` 插件数据，使用现有 plugin private storage 语义，并按 `source + pluginId` 隔离。

cache schema：

```ts
type AppLauncherCache = {
  version: 1
  refreshedAt: number
  apps: CachedAppEntry[]
}

type CachedAppEntry = {
  appId: string
  name: string
  platform: 'macos' | 'windows' | 'linux'
  source: 'applications' | 'start-menu' | 'app-paths' | 'desktop-entry'
  displayPath?: string
  iconBlobId?: string
  iconHash?: string
}
```

写入规则：

- 刷新成功后整体替换缓存。
- 刷新失败不覆盖旧缓存。
- 图标提取失败不影响应用 metadata 入库。
- 启动旧缓存中已不存在的应用失败后，不自动移除该项。
- 用户可再次执行“刷新应用索引”更新缓存。

## 图标

图标缓存归 `app-launcher` 插件所有，存入 plugin private blob storage。

规则：

- host 扫描时负责提取图标。
- 插件将图标 PNG 写入 private blob storage。
- launcher `display.icon` 支持 plugin blob icon ref。
- blob 失效或读取失败时显示默认 app 图标。
- 刷新入口使用刷新图标；应用项使用真实 app 图标。

## Launcher 行为

`app-launcher` 提供两类 GlobalLauncher 条目：

1. 应用动态结果项。
2. “刷新应用索引”入口。

应用结果：

- 只出现在 `global-launcher`。
- 与现有 host action 和 plugin launcher item 混排。
- 复用现有 launcher matching、ranking 和 usage。
- 选中后调用 `ctx.api.apps.launchApp(appId)`。
- 系统接受唤起请求后关闭 launcher。
- 启动失败时在 launcher 中显示错误。
- 启动成功不输出成功文案。

刷新入口：

- 标题：`刷新应用索引` / `Refresh Applications Index`。
- 图标：刷新图标。
- aliases:

```text
app
apps
application
refresh apps
scan apps
应用
刷新应用
扫描应用
```

执行语义：

- 调用 `ctx.api.apps.discoverApps()` 执行真实系统扫描。
- 成功后整体替换插件缓存。
- 返回 launcher success 文本：

```text
已刷新应用索引：N 个应用
Refreshed application index: N apps
```

- 权限不足时返回：

```text
无法刷新应用索引：缺少应用发现权限
Cannot refresh application index: missing application discovery permission
```

- 权限不足或扫描失败时不清空旧缓存。

## 搜索字段

应用结果的可搜索字段：

- `name`
- `displayPath` 的 basename / 文件名部分

不把完整路径加入 aliases，避免 `/Applications`、`Program Files` 等目录词污染 launcher 搜索。

## Subtitle

第一版只做精确同名冲突判断：

```text
normalize(name) = trim + lowercase
如果同一个 normalize(name) 出现 2 个及以上 app：
  subtitle = displayPath || source label
否则：
  subtitle = Application / 应用
```

不做近似同名、后缀清洗或品牌规则。

## 权限失败

- `app.discover` 未授权时，刷新入口返回权限错误，不清空旧缓存。
- `app.launch` 未授权时，应用项可展示，但执行时返回权限错误。
- 如果用户撤销权限，旧缓存仍保留在 plugin private storage，但不可刷新或启动，直到重新授权或插件数据被清理。
- 第一版不自动打开插件权限设置页。

## 平台验收

macOS 当前开发环境必须真实验证：

- 扫描真实 `/Applications`。
- 刷新入口能写入缓存。
- GlobalLauncher 能搜到一个真实应用。
- 启动真实应用走系统唤起。

Windows / Linux 第一版用 adapter 代码和 fixture 测试验证：

- Windows Start Menu / App Paths parser fixture。
- Linux `.desktop` parser fixture。
- 不要求当前机器真实平台验证。

## 测试计划

单元或脚本测试：

- `appId` 生成。
- 三平台扫描 parser fixture。
- 去重。
- cache 成功整体替换。
- cache 失败保留旧值。
- 同名冲突 subtitle。
- aliases 不包含完整路径。
- 应用结果只出现在 `global-launcher`。
- 刷新入口 aliases。
- 权限 denied 不清空旧缓存。
- 图标失败不影响应用入库。

集成和本机验证：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

涉及 launcher UI 和图标渲染时，补充浏览器验证真实 DOM/画面效果。

## 已确认决策

- 只做应用，不做脚本、文件夹、URL scheme 或网页。
- 只进 GlobalLauncher，不进 CommandPalette。
- 应用和现有条目混排。
- 复用现有 launcher 搜索排序。
- 不做隐藏、别名、置顶。
- 不做启动时扫描、定时扫描、后台监听或空列表兜底扫描。
- 只通过“刷新应用索引”显式扫描。
- app index 和图标缓存归 `app-launcher` 插件。
- host 负责系统扫描、图标提取、启动和权限检查。
- 插件可以展示 `displayPath`，但不能用路径启动。
- 启动只做系统唤起，不做生命周期管理。
