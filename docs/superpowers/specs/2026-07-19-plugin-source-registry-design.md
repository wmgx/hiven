# 插件源（Plugin Source）机制设计

日期：2026-07-19
状态：草案 v3（收回命名空间机制，按二轮评审修订，待批准）

> 术语：本设计中的"插件源"是**安装通道（install channel）**，与 TS 现有的贡献注册表 `pluginRegistry`（command/renderer/panel 注册）完全无关。代码命名一律用 `plugin_source` / `PluginSource*`，不用 `plugin_registry`。

## 背景与目标

hiven 计划公网发布，但部分内部工具插件不能走公网分发。当前插件安装通路（GitHub 目录 URL、zip URL、本地目录）没有"源"的概念：更新检查只支持 GitHub 来源，远端端点硬编码，内部系统无法接入。另外 `configInit.ts` 已有一条「builtin 远程文件树更新」通道（从主仓库 `src/builtin-plugins/index.json` 拉文件覆盖 `plugins/builtin/`），与新机制职责重叠，需要一并处理。

目标：

- 引入可配置插件源：每个源是静态托管的 `index.json`（清单 + 版本 + zip + sha256）。
- App 内浏览源内插件、一键安装（装后自动启用）、自动检查更新（手动确认安装）。
- 公网发布版预置官方源（GitHub 仓库托管）；内部工具经用户自行添加的内部源分发（内网 http/https 静态托管，无认证）。
- builtin（随包）插件可被官方源更高版本覆盖，可回退，配置不丢。

## 非目标

- 不做完整 marketplace（搜索、评分、截图、下载量）。
- 不支持需要认证的源；协议保持静态友好，认证留作将来扩展。
- 不做 index/zip 签名（信任模型见下文，协议预留扩展点）。
- **不做同 manifest id 多源共存**（无安装身份命名空间）：`pluginId` 单主键模型保持不变，同 id 冲突靠拒装 + 发布规范解决。
- 不改变 dev 插件、本地目录导入、既有 GitHub/zip 导入通路的行为。

## 已确认的关键决策

| 决策点 | 结论 |
|--------|------|
| 源形态 | 索引源：index.json + zip |
| 内部源托管 | 无认证 http/https 静态托管（允许明文 http，添加时提示风险） |
| 官方源 | 本期同时建设：公开 GitHub 仓库，预置进 app |
| 旧 builtin 远程更新通道 | **退役**：`checkBuiltinPluginsUpdate` 与 configInit 远程端点、Settings 入口全部移除，first-party 远程更新统一走官方源 |
| 插件身份 | **pluginId 单主键**，store/settings/权限/KV/目录名/API 句柄全部照旧 |
| builtin 覆盖 | 仅官方源同 id 高版本可覆盖，写入 `installed/<pluginId>`；覆盖记录沿用 builtin 设置域（零迁移零丢失） |
| 同 id 冲突 | 非官方源同 id（含与已装 local/zip/github 同 id）一律拒装（`id-conflict`）；内部 fork 由发布方改 id，pack 脚本文档写明组织前缀约定 |
| 过期覆盖丢弃 | 随包 builtin 版本**严格大于**覆盖版时启动自动丢弃（同版本保留，支持同号热修） |
| 装后启用 | 首次安装成功后自动启用；enable 失败不回滚安装，记录 `error` 态并提示重试 |
| 更新策略 | 自动检查（启动后 + 每 24h，Rust 节流单飞）+ 手动确认安装，插件页徽标提示 |
| 架构落点 | 源客户端全部下沉 Rust；前端只调命令与渲染状态 |

## 插件身份与冲突规则

- 全局仍然是 **manifest pluginId = 唯一身份**：磁盘目录 `installed/<pluginId>`、store 主键、settings/权限/private storage 域、enable/disable/uninstall API 句柄、贡献注册，全部沿用现状，无新键概念。
- `InstalledPlugin` 仅新增：`sourceId?: string`（registry 安装记录其来源）；`PluginPackageSource` 增加 `'registry'`。
- 冲突规则（`plugin_source_available` 聚合时标注，install 时强制）：

| 场景 | 行为 |
|------|------|
| 官方源同 id、版本 > builtin | 展示为"内置插件更新"，可安装为覆盖 |
| 官方源同 id、版本 ≤ builtin | 隐藏（无意义） |
| 非官方源同 id 与 builtin 冲突 | 显示"id 冲突，不可安装"，错误码 `id-conflict` |
| 任意源同 id 与已装 local/zip/github/registry 插件冲突 | 同上 `id-conflict`（已装同源 registry 的走升级通路） |
| dev 插件同 id | 现状规则不变，本设计不触碰 |

- **孤儿目录**：store 为唯一真相。启动扫描发现无 store 记录的 `installed/` 目录时，按包内 manifest pluginId 登记为 `source: 'local'`（现状行为），**绝不**从目录名解析任何来源信息。

## builtin 覆盖语义

- 覆盖判定：installed 记录与某 builtin 包同 pluginId 且 `source: 'registry'`、sourceId 为官方源 → 覆盖记录（isBuiltinOverlay）。
- **加载优先级**：同 pluginId，enabled 覆盖记录 > builtin；覆盖记录 disabled 时 builtin 恢复加载（禁用 = 临时回退，卸载 = 永久回退）。
- **设置域**：覆盖记录的 host 状态域（settings、权限授予、private storage）一律解析为 **builtin 域**（`pluginSettingsSourceForRecord` 对覆盖记录返回 `'builtin'`）。覆盖、禁用、卸载、自动丢弃全程同一域，零迁移零丢失。
- ⚠️ 卸载覆盖记录时只删目录与 store 记录，**不得**调用 host 状态清理（否则会清掉 builtin 域的用户配置）；普通 registry 插件卸载仍按现状清理 installed 域。
- **过期覆盖丢弃**：启动时随包 builtin 版本严格大于覆盖版 → 自动卸载覆盖记录回退 builtin。因设置域共享，无配置丢失；插件页事后提示"内置插件已随 App 更新到 vY"。

## 架构

### Rust 端（新模块 `src-tauri/src/plugin_source.rs`）

`lib.rs` 已超 4500 行，源机制一律放独立模块。职责：

- **源配置持久化**：config 目录下 `plugin-sources.json`，Rust 为单一事实来源。
- **index 拉取**：独立 HTTP 调用（超时、响应大小上限）；不复用现有无限制的 `fetch_url` 命令。下载走 Rust reqwest，不经 webview，不受 macOS ATS 明文 http 限制。
- **index 缓存**：内存 + 磁盘缓存，记录 `fetchedAt` 与上次成功时间；检查节流（min-interval）在 Rust 侧实现，多窗口重复调用天然幂等。
- **下载与安装**：zip 下载到临时目录 → sha256 校验 → 解压校验 → staging 原子释放到 `plugins/installed/<pluginId>`。目录语义与现状一致；**复用解压 / staging / 原子替换原语**（现有 GitHub 更新的 staging 思路），存在性检查与错误码按新命令语义实现，不直接照搬旧 `install_package_dir` 的"已存在即报错"整函数。
- **官方源 fallback**：官方源 raw URL 失败时回退 jsdelivr 端点。
- **版本比较**：与 TS `comparePluginVersions` 同规则（点分数字段比较，非严格 semver）在 Rust 实现；registry 通路的版本比较只发生在 Rust。结构断言脚本锁定两侧规则一致。

### 命令面

| 命令 | 作用 | 关键错误语义 |
|------|------|--------------|
| `plugin_source_list` | 列出已配置源 | — |
| `plugin_source_add` / `plugin_source_remove` | 增删源；官方源不可删、可禁用 | 删源返回受影响的已装插件数供 UI 确认 |
| `plugin_source_refresh` | 强制拉取并缓存指定源/全部源 index | 单源失败不阻塞其他源 |
| `plugin_source_available` | 返回聚合可安装列表（默认读缓存） | 标注已安装 / 内置更新 / `id-conflict` 状态 |
| `plugin_source_install` | 首次安装：同 id 已存在（builtin 覆盖场景除外）报 `id-conflict` / `already-installed` | sha256 不符 `checksum-mismatch`；manifest id 不符 `manifest-mismatch` |
| `plugin_source_update` | 同 id 升级（含覆盖版升级）：要求远端版本更高，staging 替换 | 失败保留原版本 |
| `plugin_source_check_updates` | 节流刷新各启用源，比对本地版本返回可更新列表 | 禁用源不参与 |

### 前端职责

- 源管理 UI、可安装列表、更新徽标；纯视图，不持源状态。
- 安装完成后走 `installLocalPlugin` 登记 store（`source: 'registry'`、`sourceId`），随后自动 enable；enable 需要的权限走现有授权流程，新增权限不静默授予。enable 失败（权限拒绝、加载错误）不回滚安装：记录 `error` 态，UI 显示"已安装但启用失败"与重试入口。
- 升级沿用 disable → staging 替换 → 恢复原 enable 状态的语义。
- 自动检查调度在 TS：仅 launcher 主 runtime 注册（启动后延迟数秒 + 每 24h 调 `plugin_source_check_updates`）；重复触发由 Rust 节流兜底。

### 与旧 GitHub 更新通路的分流

- 已装插件按 `record.source` 分流："检查更新"registry → `plugin_source_check_updates`，github → 现有 `checkInstalledPluginUpdate`，local/zip → 不支持（现状）。
- 两条通路结果都写同一个 `record.update`（`PluginPackageUpdateState`），UI 单一状态机；徽标数字合并计数。

## index.json 协议

```jsonc
{
  "registryVersion": 1,
  "name": "hiven internal tools",
  "plugins": [
    {
      "pluginId": "byted-tools",
      "displayName": "Byte Tools",            // 默认即英文文案，displayNameI18n 缺省时直接使用
      "displayNameI18n": { "zh": "字节工具" },
      "version": "1.2.0",
      "description": "…",
      "descriptionI18n": { "zh": "…" },
      "archive": "byted-tools-1.2.0.zip",
      "sha256": "hex…",
      "minAppVersion": "0.4.0"
    }
  ]
}
```

- `archive` 相对 index.json 所在路径解析；绝对 URL：`https://` 允许任意 host（信任源模型下可接受；如需收紧留"源级白名单"扩展，非本期），`http://` 仅允许与 index 同 host（防明文降级）。
- `sha256` 必填；不匹配即安装失败。
- `minAppVersion` 可选；Rust 用 `app.package_info().version`（与 tauri.conf 对齐）比较，低于要求则隐藏条目。
- `registryVersion` 不识别：该源标记错误态，UI 文案"此源需要更新版本的 hiven"（locale key），不影响其他源。

## 源配置格式（`plugin-sources.json`，Rust 持久化）

```jsonc
{
  "sources": [
    { "id": "official", "name": "hiven Official", "indexUrl": "https://raw.githubusercontent.com/…/index.json", "enabled": true, "preinstalled": true },
    { "id": "uuid…", "name": "内部工具源", "indexUrl": "http://inner.example/plugins/index.json", "enabled": true, "preinstalled": false }
  ]
}
```

- `preinstalled: true` 的官方源由 app 预置，不可删除，可禁用（字段不叫 `builtin`，避免与插件 `source: 'builtin'` 混淆）。
- 官方源 indexUrl 为 Rust 端一处集中常量，支持构建配置/环境变量覆盖（dev 指向测试源）；实施第 1 步即定占位仓库名。
- 内部源允许 `http://`；添加时 UI 提示明文传输风险，不硬性阻止。

## 信任模型与安全限制

- **信任模型 = 信任源 URL**：添加一个源等于信任该 URL 的运营者可向本机分发代码。`sha256` 只保证 zip 与 index 的一致性（下载完整性），**不防**能同时篡改 index 与 zip 的源级 MITM——http 源尤其如此，UI 风险提示写明这一点。协议预留 `signature` 字段扩展点（如 ed25519，非本期）。
- 硬限制（Rust 侧强制）：index 响应 ≤ 1MB；zip 下载 ≤ 50MB；解压后总大小 ≤ 200MB、条目数 ≤ 2000、拒绝越界路径与符号链接（zip bomb / zip slip 防护）；所有请求超时 30s。
- 解压后校验包内 `manifest.json` 的 pluginId 与 index 条目一致，不一致拒绝。
- 仅官方源（preinstalled）条目可映射为"内置插件更新"，非官方源无覆盖 builtin 能力（`id-conflict` 拒装）。

## 源删除 / 禁用与失败处理

- 删源：UI 确认框列出受影响已装插件数；删除后插件保留可用，更新检查停止，插件卡片显示"来源已移除"。
- 禁用源：不参与 check_updates 与 available 聚合；官方源被禁用则内置覆盖更新一并停止（显式行为，不做例外）。
- 单源拉取失败不阻塞其他源；源条目显示错误状态与上次成功时间。
- 安装/升级失败保留原版本（staging + 原子替换）。

## UI 与 i18n

- 全部落在现有 Plugins surface（`src/surfaces/PluginsContent.tsx` 体系）：
  - "插件源"分区：源列表（名称、URL、状态、上次刷新）、添加 URL、刷新、启用/禁用、删除（官方源除外）。
  - "可安装"列表按源分组；条目状态：可安装 / 已安装 / 内置更新 / id 冲突（禁用态 + 说明文案）。
  - **同 id 单行合并**：builtin 被覆盖时插件列表只显示一行，以当前生效版本为主体：
    - 覆盖版 enabled → 主体为覆盖版，标注"已覆盖内置 vX"，操作含"禁用（临时回退内置）""卸载并回退内置版本"。
    - 覆盖版 disabled → 主体为 builtin 生效版，行内提示"有未启用的覆盖版 vX（启用 / 卸载）"。
  - 已装插件卡片：来源标注（源名）、"更新到 vX"按钮、"来源已移除"态、"已安装但启用失败"态与重试。
  - 插件页入口徽标 = registry + github 两条通路可更新数合并。
- Settings 页原「检查内置插件更新」入口随旧通道退役移除。
- 所有文案（错误、风险提示、冲突说明、按钮、空状态）一律 locale key，中英齐备，不 hardcode。

## 官方源仓库与发布约定

- **发布工具**：本仓库新增 `scripts/pack-plugin-source.mjs`——输入若干插件目录，产出 `dist/plugin-source/`（`index.json` + zip + sha256）。脚本文档写明：内部/第三方插件 id 必须避开官方插件 id，建议加组织前缀（如 `byted-`）。
- **官方源**：新建公开 GitHub 仓库存放产物，**本仓库（app repo）为 source of truth**：
  - App 发版流程中由 CI 运行 pack 脚本并推送官方源仓库，保证随包 builtin 与官方源版本同步 bump。
  - 发版间隙的 first-party 热修可单独推官方源（版本号高于随包），即覆盖机制的正常用法。
  - first-party 插件依赖新 host API 时必须标 `minAppVersion`，旧 App 不可见该版本。
  - App 预置官方源 raw URL（集中常量，可覆盖），jsdelivr 为 Rust 侧 fallback。
- **内部源**：同一 pack 脚本产物上传到任意内网静态托管即完成发布，无需服务端。

## 成功标准（验收场景）

1. 添加内网 http 源 → 浏览 → 安装内部插件 → 自动启用可用；断网刷新该源显示错误但其他源正常。
2. 官方源发布 builtin 插件高版本 → 徽标提示 → 确认更新 → 生效为覆盖版；禁用覆盖版临时回退内置；卸载覆盖版永久回退，设置全程不丢。
3. App 升级使随包 builtin 严格大于覆盖版 → 启动自动丢弃过期覆盖并提示，无重复行、配置保留；随包与覆盖同版本时覆盖保留。
4. 内部源发布与 builtin 同 id 插件 → 列表显示"id 冲突，不可安装"；发布方改 id 后可正常安装。
5. sha256 篡改 / manifest id 不符 → 安装失败且不影响已装版本。
6. 删除源后其插件显示"来源已移除"，不再出现在更新检查；安装成功但启用失败的插件显示错误态可重试。

## 验证

- 结构断言脚本 `scripts/test-plugin-source-*.mjs`：命令注册、store 字段、覆盖设置域解析（覆盖记录 → builtin 域）、卸载覆盖不清 builtin 域状态、旧通道退役（configInit 远程端点与 Settings 入口删除）、i18n key 齐备、TS/Rust 版本比较规则一致。
- Rust 单元测试：index 解析、sha256、archive URL 规则（http 同 host）、zip 限制与路径安全、版本比较、节流、`id-conflict` 判定。
- `npm run check:architecture`、`git diff --check`、`npm run build`。
- 真机全流程至少走一遍验收场景 1、2、4（复杂安装/原子替换不能只靠结构断言）。

## 实施拆分建议（供写计划参考）

1. Rust `plugin_source.rs`：源配置 CRUD + index 拉取缓存 + 官方源常量（占位仓库名）+ 命令注册。
2. Rust 安装/升级通路：下载 + 校验 + 限制 + staging 原子释放 + 冲突错误码。
3. TS 类型与 store：`'registry'` 来源与 `sourceId` 字段、覆盖记录设置域解析、加载优先级（enabled 覆盖 > builtin）、过期覆盖丢弃、卸载覆盖不清 builtin 域。
4. 旧通道退役：configInit 远程更新与 Settings 入口移除。
5. 更新检查调度 + 分流合并徽标。
6. Plugins surface UI + i18n（源管理、聚合列表、单行合并、冲突态）。
7. `pack-plugin-source.mjs` + 官方源仓库初始化 + CI 发布约定落地。
