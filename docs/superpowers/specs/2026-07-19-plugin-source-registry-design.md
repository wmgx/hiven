# 插件源（Plugin Source Registry）机制设计

日期：2026-07-19
状态：已与用户逐段确认

## 背景与目标

hiven 计划公网发布，但部分内部工具插件不能走公网分发。当前插件安装通路（GitHub 目录 URL、zip URL、本地目录）没有"源"的概念：更新检查只支持 GitHub 来源，远端端点硬编码为 `raw.githubusercontent.com` / `jsdelivr`，内部系统无法接入。

目标：引入可配置的插件源（registry）机制——

- 每个源是一个静态托管的 `index.json`（插件清单 + 版本 + zip 下载地址）。
- App 内可浏览源中插件、一键安装、自动检查更新（手动确认安装）。
- 公网发布版预置官方源（GitHub registry 仓库）；内部工具通过用户自行添加的内部源分发（任意内网 http/https 静态托管，无认证）。
- builtin（随包）插件可被官方源的更高版本覆盖更新，可回滚。

## 非目标

- 不做完整 marketplace（搜索、评分、截图、下载量）。
- 不支持需要认证的源（token/SSO）；协议保持静态友好，认证留作将来扩展。
- 不改变 dev 插件、本地目录导入、既有 GitHub 目录导入通路（保留现状）。

## 已确认的关键决策

| 决策点 | 结论 |
|--------|------|
| 源形态 | Registry 源：index.json + zip |
| 内部源托管 | 无认证的 http/https 静态托管（允许明文 http，添加时提示风险） |
| 官方源 | 本期同时建设：公开 GitHub registry 仓库，预置进 app |
| builtin 关系 | builtin 可被官方源更高版本覆盖更新 |
| 覆盖存放与回滚 | 复用 `plugins/installed/`；加载时 installed 同 id 优先于 builtin；卸载覆盖版即回退随包版本 |
| 更新策略 | 自动检查（启动后 + 每 24h）+ 手动确认安装，插件页徽标提示 |
| 架构落点 | registry 客户端全部下沉 Rust；前端只调命令与渲染状态 |

## 架构

### Rust 端（新模块 `src-tauri/src/plugin_registry.rs`）

`lib.rs` 已超 4500 行，registry 一律放独立模块。职责：

- **源配置持久化**：config 目录下 `plugin-sources.json`，Rust 为单一事实来源。
- **index 拉取**：自带 HTTP 客户端调用（超时、响应大小上限）；不复用现有无限制的 `fetch_url` 命令。
- **index 缓存**：内存 + 磁盘缓存，记录 `fetchedAt` 与上次成功时间。
- **下载与安装**：zip 下载到临时目录 → sha256 校验 → 解压校验 → 原子释放到 `plugins/installed/<pluginId>`（复用现有 zip 解压与目录释放逻辑）。
- **官方源 fallback**：官方源的 raw URL 失败时在 Rust 侧回退 jsdelivr 端点。

### 命令面

| 命令 | 作用 |
|------|------|
| `plugin_source_list` | 列出已配置源（含预置官方源） |
| `plugin_source_add` / `plugin_source_remove` | 增删源；官方源不可删、可禁用 |
| `plugin_source_refresh` | 拉取并缓存指定源/全部源的 index |
| `plugin_source_available` | 返回聚合后的可安装插件列表（含版本、来源、已安装状态） |
| `plugin_source_install` | 按 pluginId + sourceId 下载、校验、解压安装 |
| `plugin_source_check_updates` | 比对本地已装（installed + builtin）版本，返回可更新列表 |

### 前端职责

- 源管理 UI、可安装列表、更新徽标；纯视图，不持源状态。
- 安装完成后走现有 `installLocalPlugin` 登记 plugin store：`PluginPackageSource` 增加 `'registry'`，记录 `sourceId` 与源 URL。
- 自动检查调度在 TS（启动后延迟数秒 + 每 24h 调 `plugin_source_check_updates`），便于调整策略。

## index.json 协议

```jsonc
{
  "registryVersion": 1,
  "name": "hiven internal tools",
  "plugins": [
    {
      "pluginId": "bytedance-tools",
      "displayName": "Byte Tools",
      "displayNameI18n": { "zh": "字节工具" },
      "version": "1.2.0",
      "description": "…",
      "descriptionI18n": { "zh": "…" },
      "archive": "bytedance-tools-1.2.0.zip",
      "sha256": "hex…",
      "minAppVersion": "0.4.0"
    }
  ]
}
```

- `archive` 相对 index.json 所在路径解析，也允许绝对 URL。
- `sha256` 必填；不匹配即安装失败。
- `minAppVersion` 可选；当前 app 版本低于它时隐藏该条目。
- `registryVersion` 不识别时该源标记错误状态，不影响其他源。

## 源配置格式（`plugin-sources.json`，Rust 持久化）

```jsonc
{
  "sources": [
    { "id": "official", "name": "hiven Official", "indexUrl": "https://raw.githubusercontent.com/…/index.json", "enabled": true, "builtin": true },
    { "id": "uuid…", "name": "内部工具源", "indexUrl": "http://inner.example/plugins/index.json", "enabled": true, "builtin": false }
  ]
}
```

- `builtin: true` 的官方源由 app 预置，不可删除，可禁用。
- 内部源允许 `http://`（内网常无 TLS）；添加时 UI 提示明文传输风险，不硬性阻止。

## 安装、覆盖与更新流程

### 普通安装

1. `plugin_source_install(sourceId, pluginId)`。
2. 下载 zip 到临时目录；sha256 不匹配 → 失败并清理。
3. 解压后校验包内 `manifest.json` 的 `pluginId` 与 index 条目一致，不一致拒绝。
4. 原子释放到 `plugins/installed/<pluginId>`（staging 后替换，失败保留原状）。
5. 前端 `installLocalPlugin` 登记，`source: 'registry'`。

### builtin 覆盖

- 源中出现与 builtin 同 id 且版本更高 → 更新列表展示为"内置插件有更新"。
- 安装即普通安装进 `installed/`；启动扫描加载去重规则改为：installed 同 id 优先于 builtin。
- 回滚 = 卸载覆盖版，自动回到随包版本，无额外回滚逻辑。

### 多源冲突

- 已安装插件的更新只认安装时记录的 `sourceId`。
- 未安装插件同 id 出现在多个源：聚合列表都展示并标注来源，先装哪个算哪个；已装后其他源同 id 条目显示"已安装"。
- 源内插件与 builtin 之外的已装插件（local/zip/github 来源）同 id：条目显示"已安装"，不提供跨来源接管。

### 更新检查

- 触发：前端启动后延迟数秒 + 每 24h；用户也可在源管理里手动刷新。
- 流程：刷新各启用源 index → 比对 installed（含覆盖版）与 builtin 版本 → 返回可更新列表 → 插件页入口徽标显示数量。
- 远端版本低于本地时不提示降级。

### 失败处理

- 单源拉取失败不阻塞其他源；源条目显示错误状态与上次成功时间。
- 安装/更新失败保留原版本（staging + 原子替换）。

## UI 与 i18n

- 全部落在现有 Plugins surface（`src/surfaces/PluginsContent.tsx` 体系）：
  - 新增"插件源"分区：源列表（名称、URL、状态、上次刷新）、添加 URL、刷新、启用/禁用、删除（官方源除外）。
  - "可安装"列表按源分组；条目展示名称/描述/版本，一键安装。
  - 已装插件卡片：来源标注（registry 源名）、"更新到 vX"按钮；覆盖 builtin 的显示覆盖标识与"卸载后回退内置版本"说明。
  - 插件页入口徽标显示可更新数量。
- 所有文案（含错误提示、风险提示、按钮、空状态）一律走 locale key，中英齐备；遵守项目 i18n 红线，不 hardcode。

## 官方源仓库与发布工具

- **发布工具**：本仓库新增 `scripts/pack-plugin-registry.mjs`——输入若干插件目录，产出 `dist/registry/`（`index.json` + 各插件 zip + sha256）。
- **官方源**：新建公开 GitHub registry 仓库存放产物；CI 或手动脚本推送更新。App 预置其 raw URL，jsdelivr 为 Rust 侧 fallback。仓库名在实施第 6 步创建时确定，预置 URL 作为一处集中常量写入 Rust 端（不散落多处）。
- **内部源**：同一脚本产物上传到任意内网静态托管即完成发布——这就是"用内部系统发布"的全部要求，无需专门服务端。

## 验证

- 结构断言脚本：`scripts/test-plugin-source-*.mjs`（命令注册、store 字段、加载去重规则、i18n key 齐备）。
- `npm run check:architecture`、`git diff --check`、`npm run build`。
- Rust 单元测试：index 解析、sha256 校验、archive 相对路径解析与路径安全（拒绝越界路径）、版本比较。
- UI 改动做浏览器实测（源添加/刷新/安装/更新徽标真实流程）。

## 实施拆分建议（供写计划参考）

1. Rust `plugin_registry.rs`：源配置 CRUD + index 拉取缓存 + 命令注册。
2. Rust 安装通路：下载 + sha256 + pluginId 校验 + 原子释放。
3. TS 类型与 store：`'registry'` 来源、`sourceId` 字段、加载去重（installed > builtin）。
4. 更新检查调度 + 徽标。
5. Plugins surface UI + i18n。
6. `pack-plugin-registry.mjs` + 官方源仓库初始化。
