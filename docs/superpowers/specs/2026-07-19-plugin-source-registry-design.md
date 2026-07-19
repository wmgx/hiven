# 插件源（Plugin Source）机制设计

日期：2026-07-19
状态：草案 v2（按评审意见修订，待批准）

> 术语：本设计中的"插件源"是**安装通道（install channel）**，与 TS 现有的贡献注册表 `pluginRegistry`（command/renderer/panel 注册）完全无关。为避免 registry 一词双义，代码命名一律用 `plugin_source` / `PluginSource*`，不用 `plugin_registry`。

## 背景与目标

hiven 计划公网发布，但部分内部工具插件不能走公网分发。当前插件安装通路（GitHub 目录 URL、zip URL、本地目录）没有"源"的概念：更新检查只支持 GitHub 来源，远端端点硬编码，内部系统无法接入。另外 `configInit.ts` 已有一条「builtin 远程文件树更新」通道（从主仓库 `src/builtin-plugins/index.json` 拉文件覆盖 `plugins/builtin/`），与新机制职责重叠，需要一并处理。

目标：

- 引入可配置插件源：每个源是静态托管的 `index.json`（清单 + 版本 + zip + sha256）。
- App 内浏览源内插件、一键安装（装后自动启用）、自动检查更新（手动确认安装）。
- 公网发布版预置官方源（GitHub registry 仓库）；内部工具经用户自行添加的内部源分发（内网 http/https 静态托管，无认证）。
- builtin（随包）插件可被官方源更高版本覆盖，可回滚。
- 不同源的同名插件通过**安装身份命名空间**共存，避免 id 冲突。

## 非目标

- 不做完整 marketplace（搜索、评分、截图、下载量）。
- 不支持需要认证的源；协议保持静态友好，认证留作将来扩展。
- 不做 index/zip 签名（本期信任模型见「信任模型」节，协议预留扩展点）。
- 不改变 dev 插件、本地目录导入、既有 GitHub/zip 导入通路的行为（它们保持裸 pluginId 身份）。

## 已确认的关键决策

| 决策点 | 结论 |
|--------|------|
| 源形态 | Registry 源：index.json + zip |
| 内部源托管 | 无认证 http/https 静态托管（允许明文 http，添加时提示风险） |
| 官方源 | 本期同时建设：公开 GitHub registry 仓库，预置进 app |
| 旧 builtin 远程更新通道 | **退役**：`checkBuiltinPluginsUpdate` 与 configInit 远程端点、Settings 入口全部移除，first-party 远程更新统一走官方源 |
| builtin 覆盖 | 官方源同 manifest id 高版本 = "内置插件更新"；启动时随包 builtin 版本 ≥ 覆盖版则自动丢弃过期覆盖 |
| 同 id 冲突 | **App 内命名空间机制**：registry 安装身份 = `<源 namespace>.<pluginId>`，同 manifest id 互斥启用 |
| 覆盖存放 | 复用 `plugins/installed/`；加载时 enabled installed 同 manifest id 优先于 builtin |
| 装后启用 | 首次安装成功后自动启用；权限走现有授权流程 |
| 更新策略 | 自动检查（启动后 + 每 24h，Rust 节流单飞）+ 手动确认安装，插件页徽标提示 |
| 架构落点 | 源客户端全部下沉 Rust；前端只调命令与渲染状态 |

## 安装身份命名空间

三个身份概念分开：

- **manifest pluginId**：包内 `manifest.json` 声明的 id（如 `json-tools`），发布方控制。
- **安装身份 installKey**：插件在本机的唯一安装记录键。
  - registry 安装：`<namespace>.<pluginId>`，`namespace` 为源配置的短 slug（如 `official`、`byted`）。
  - 既有通路（local/zip/github/dev/builtin）：installKey = 裸 pluginId，**完全不变**，旧记录迁移即 `installKey = pluginId`。
- **运行时身份**：贡献注册（command id、renderer id、i18n namespace）仍由插件代码按 manifest pluginId 声明。

约束与规则：

- `namespace` 仅允许 `[a-z0-9-]`，不含 `.`；安装目录名 = installKey（`installed/official.json-tools/`）。
- **互斥启用**：同 manifest pluginId 在任意时刻最多一个 enabled 的 installed 记录。enable 第二个时拒绝并提示"需先停用 X"。
- **加载优先级**：同 manifest pluginId，enabled installed > builtin。builtin 保持现状不可禁用；被接管时仅不加载。
- 官方源（preinstalled）同 manifest id 高版本 → UI 呈现为"内置插件更新"（用户视角是升级）。
- 非官方源同 manifest id → 呈现为普通可安装项，安装/启用时显著标识"启用后将接管内置插件 json-tools" + 二次确认。
- **过期覆盖丢弃**：启动时若某官方源安装身份与 builtin 同 manifest id 且随包 builtin 版本 ≥ 该安装版本，自动卸载该覆盖记录回退 builtin（App 发版超车场景）。非官方接管不自动丢弃，仅在插件页提示"内置版本已更新到 vY"。

`InstalledPlugin` 类型新增字段：`installKey`（store 主键）、`namespace?`、`sourceId?`；`PluginPackageSource` 增加 `'registry'`。启动扫描 `installed/` 时以持久化 store 记录为准；目录存在但无记录的按现状 fallback（裸 id、`source: 'local'`），带 `.` 的孤儿目录按 installKey 规则解析归位。

## 架构

### Rust 端（新模块 `src-tauri/src/plugin_source.rs`）

`lib.rs` 已超 4500 行，源机制一律放独立模块。职责：

- **源配置持久化**：config 目录下 `plugin-sources.json`，Rust 为单一事实来源。
- **index 拉取**：独立 HTTP 调用（超时、响应大小上限）；不复用现有无限制的 `fetch_url` 命令。下载走 Rust reqwest，不经 webview，因此不受 macOS ATS 明文 http 限制。
- **index 缓存**：内存 + 磁盘缓存，记录 `fetchedAt` 与上次成功时间；检查节流（min-interval）在 Rust 侧实现，多窗口重复调用天然幂等。
- **下载与安装**：zip 下载到临时目录 → sha256 校验 → 解压校验 → staging 原子释放到 `plugins/installed/<installKey>`（复用现有解压与目录释放逻辑）。
- **官方源 fallback**：官方源 raw URL 失败时回退 jsdelivr 端点。
- **版本比较**：与 TS `comparePluginVersions` 同规则（点分数字段比较，非严格 semver）在 Rust 实现；registry 通路的版本比较只发生在 Rust，避免双实现分叉。结构断言脚本锁定两侧规则一致。

### 命令面

| 命令 | 作用 | 关键错误语义 |
|------|------|--------------|
| `plugin_source_list` | 列出已配置源 | — |
| `plugin_source_add` / `plugin_source_remove` | 增删源；官方源不可删、可禁用 | 删源返回受影响的已装插件数供 UI 确认 |
| `plugin_source_refresh` | 强制拉取并缓存指定源/全部源 index | 单源失败不阻塞其他源 |
| `plugin_source_available` | 返回聚合可安装列表（默认读缓存） | 标注已安装/冲突/接管状态 |
| `plugin_source_install` | 首次安装：目标 installKey 已存在则报错 `already-installed` | sha256 不符 `checksum-mismatch`；manifest id 不符 `manifest-mismatch` |
| `plugin_source_update` | 同 installKey 升级：要求已装且远端版本更高，disable→staging 替换→恢复原 enable 状态 | 失败保留原版本 |
| `plugin_source_check_updates` | 节流刷新各启用源，比对本地版本返回可更新列表 | 禁用源不参与 |

### 前端职责

- 源管理 UI、可安装列表、更新徽标；纯视图，不持源状态。
- 安装完成后走 `installLocalPlugin` 登记 store（`source: 'registry'`、installKey、sourceId、namespace），随后自动 enable（权限按现有授权流程，新增权限不静默授予）。
- 自动检查调度在 TS：仅 launcher 主 runtime 注册（启动后延迟数秒 + 每 24h 调 `plugin_source_check_updates`）；重复触发由 Rust 节流兜底。

### 与旧 GitHub 更新通路的分流

- 已装插件按 `record.source` 分流："检查更新"按钮 registry → `plugin_source_check_updates`，github → 现有 `checkInstalledPluginUpdate`，local/zip → 不支持（现状）。
- 两条通路都把结果写入同一个 `record.update`（`PluginPackageUpdateState`），UI 单一状态机；徽标数字为两条通路合并计数。

## index.json 协议

```jsonc
{
  "registryVersion": 1,
  "name": "hiven internal tools",
  "plugins": [
    {
      "pluginId": "bytedance-tools",
      "displayName": "Byte Tools",            // 默认即英文文案，displayNameI18n 缺省时直接使用
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

- `archive` 相对 index.json 所在路径解析；绝对 URL：`https://` 允许任意 host，`http://` 仅允许与 index 同 host（防明文降级与随意跳转）。
- `sha256` 必填；不匹配即安装失败。
- `minAppVersion` 可选；Rust 用 `app.package_info().version`（与 tauri.conf 对齐）比较，低于要求则隐藏条目。
- `registryVersion` 不识别：该源标记错误态，UI 文案提示"此源需要更新版本的 hiven"（locale key），不影响其他源。

## 源配置格式（`plugin-sources.json`，Rust 持久化）

```jsonc
{
  "sources": [
    { "id": "official", "namespace": "official", "name": "hiven Official", "indexUrl": "https://raw.githubusercontent.com/…/index.json", "enabled": true, "preinstalled": true },
    { "id": "uuid…", "namespace": "byted", "name": "内部工具源", "indexUrl": "http://inner.example/plugins/index.json", "enabled": true, "preinstalled": false }
  ]
}
```

- `preinstalled: true` 的官方源由 app 预置，不可删除，可禁用（字段不叫 `builtin`，避免与插件 `source: 'builtin'` 混淆）。
- 官方源 indexUrl 作为 Rust 端一处集中常量，支持构建配置/环境变量覆盖（dev 指向测试源）；实施第 1 步即定占位仓库名。
- `namespace` 添加源时用户填写或从 URL 自动生成，源内唯一性由 add 命令校验。
- 内部源允许 `http://`；添加时 UI 提示明文传输风险，不硬性阻止。

## 信任模型与安全限制

- **信任模型 = 信任源 URL**：添加一个源等于信任该 URL 的运营者可向本机分发代码。`sha256` 只保证 zip 与 index 的一致性（下载完整性），**不防**能同时篡改 index 与 zip 的源级 MITM——http 源尤其如此，UI 风险提示要写明这一点。协议预留后续 `signature` 字段扩展点（如 ed25519，非本期）。
- 硬限制（Rust 侧强制）：index 响应 ≤ 1MB；zip 下载 ≤ 50MB；解压后总大小 ≤ 200MB、条目数 ≤ 2000、拒绝越界路径与符号链接（zip bomb / zip slip 防护）；所有请求超时 30s。
- 解压后校验包内 `manifest.json` 的 pluginId 与 index 条目一致，不一致拒绝。

## 安装、更新与回退流程

### 首次安装

1. `plugin_source_install(sourceId, pluginId)` → 下载、校验、staging 原子释放到 `installed/<installKey>`。
2. 前端登记 store 后自动 enable；enable 需要的权限走现有授权流程。
3. 非官方源接管 builtin 同 manifest id 时：安装前二次确认，启用时如 builtin 同 id 已在运行则提示接管后果。

### 升级

- `plugin_source_update(installKey)`：要求远端版本更高；disable → staging 替换 → 恢复原 enable 状态（沿用 GitHub 更新路径语义）。降级不提供。
- 新版本声明的新增权限不静默授予，重新 enable 时按现有流程请求。

### 官方源覆盖 builtin 与设置迁移

- 安装官方源覆盖版时，将 builtin 域（settings source `builtin`）的 settings / 权限授予 / private storage **复制**到新安装身份的 installed 域；卸载覆盖版回退 builtin 时原 builtin 域数据仍在（复制非移动，回退零成本）。
- 非官方接管不迁移设置（视为独立插件）。

### 源删除 / 禁用

- 删源：UI 确认框列出受影响已装插件数；删除后这些插件保留可用，但更新检查停止，插件卡片显示"来源已移除"。
- 禁用源：不参与 check_updates 与 available 聚合；官方源被禁用则内置覆盖更新一并停止（显式行为，不做例外）。

### 失败处理

- 单源拉取失败不阻塞其他源；源条目显示错误状态与上次成功时间。
- 安装/升级失败保留原版本（staging + 原子替换）。

## UI 与 i18n

- 全部落在现有 Plugins surface（`src/surfaces/PluginsContent.tsx` 体系）：
  - "插件源"分区：源列表（名称、namespace、URL、状态、上次刷新）、添加 URL、刷新、启用/禁用、删除（官方源除外）。
  - "可安装"列表按源分组；条目状态：可安装 / 已安装 / 同 id 接管（带警示样式）。
  - **同 manifest id 单行合并**：builtin 被官方覆盖或被接管时，插件列表只显示一行——以当前生效版本为主体，行内标注"已覆盖内置 vX"或"接管了内置插件"，操作含"卸载并回退内置版本"；builtin 原行不再单独出现。
  - 已装插件卡片：来源标注（源名 + namespace）、"更新到 vX"按钮、"来源已移除"态。
  - 插件页入口徽标 = registry + github 两条通路可更新数合并。
- Settings 页原「检查内置插件更新」入口随旧通道退役移除。
- 所有文案（错误、风险提示、接管确认、按钮、空状态）一律 locale key，中英齐备，不 hardcode。

## 官方源仓库与发布工具

- **发布工具**：本仓库新增 `scripts/pack-plugin-registry.mjs`——输入若干插件目录，产出 `dist/registry/`（`index.json` + zip + sha256）。脚本文档写明发布约定：内部/第三方插件 id 建议加组织前缀，避免与官方插件同名。
- **官方源**：新建公开 GitHub 仓库存放产物；CI 或手动脚本推送。App 预置 raw URL（集中常量，可覆盖），jsdelivr 为 Rust 侧 fallback。
- **内部源**：同一脚本产物上传到任意内网静态托管即完成发布，无需服务端。

## 成功标准（验收场景）

1. 添加内网 http 源 → 浏览 → 安装内部插件 → 自动启用可用；断网刷新该源显示错误但其他源正常。
2. 官方源发布 builtin 插件高版本 → 徽标提示 → 确认更新 → 生效为覆盖版；卸载覆盖版回退随包版本，设置不丢。
3. App 升级使随包 builtin ≥ 覆盖版 → 启动自动丢弃过期覆盖，无重复行、无旧版本残留。
4. 内部源发布与 builtin 同 manifest id 插件 → 可安装（带接管警示）→ 启用后接管内置；builtin 行合并展示。
5. sha256 篡改 / manifest id 不符 → 安装失败且不影响已装版本。
6. 删除源后其插件显示"来源已移除"，不再出现在更新检查。

## 验证

- 结构断言脚本 `scripts/test-plugin-source-*.mjs`：命令注册、store 字段与迁移、加载互斥规则、旧通道退役（configInit 远程端点与 Settings 入口删除）、i18n key 齐备、TS/Rust 版本比较规则一致。
- Rust 单元测试：index 解析、sha256、archive URL 规则（http 同 host）、zip 限制与路径安全、版本比较、节流。
- `npm run check:architecture`、`git diff --check`、`npm run build`。
- 真机全流程至少走一遍验收场景 1、2、4（复杂安装/原子替换不能只靠结构断言）。

## 实施拆分建议（供写计划参考）

1. Rust `plugin_source.rs`：源配置 CRUD + index 拉取缓存 + 官方源常量（占位仓库名）+ 命令注册。
2. Rust 安装/升级通路：下载 + 校验 + 限制 + staging 原子释放。
3. TS 类型与 store：installKey 主键迁移、`'registry'` 来源、加载互斥（enabled installed > builtin）、过期覆盖丢弃。
4. 旧通道退役：configInit 远程更新与 Settings 入口移除。
5. 更新检查调度 + 分流合并徽标。
6. Plugins surface UI + i18n（源管理、聚合列表、单行合并、接管确认）。
7. `pack-plugin-registry.mjs` + 官方源仓库初始化。
