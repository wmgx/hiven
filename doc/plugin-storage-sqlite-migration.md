# Plugin Private Storage SQLite Migration

## 背景

当前 plugin private storage 对外暴露的是 host-owned `PluginPrivateStorageApi`：

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

其中 KV 当前由 `src/workspace/pluginStorage.ts` 写入 `localStorage`，Blob 已经通过 Tauri host 命令写入 native 文件存储。随着 clipboard-history、app-launcher 等插件开始持久化更多业务数据，`localStorage` 不适合作为插件私有数据的长期后端。

本迁移把插件私有 KV 从 browser storage 切到 SQLite。插件 API 不变，插件代码不感知 SQLite。

## 决策

### 不迁历史数据

本次是硬切，不读取、不导入、不清洗历史 `localStorage` KV 数据。

旧数据包括：

```text
hiven-plugin-kv:<source>:<pluginId>:<key>
hiven-plugin-kv-meta:<source>:<pluginId>:<key>
```

上线后这些旧 key 不再作为数据来源。新数据只写 SQLite。

这样做的代价是用户已有插件缓存和插件业务数据会丢失；收益是迁移代码更小，不需要 migration marker、legacy scanner、失败回滚和旧 JSON 容错路径。

### 一个 DB，固定表，不做一个插件一个表

不采用“一个插件一个表”。

原因：

- 插件数量和来源是动态的，动态 DDL 会增加表名校验、迁移、清理和测试复杂度。
- 当前插件拿到的是 KV API，不是关系型 schema API；每插件独立表不会给插件提供新的能力。
- 现有查询模式固定：按 `source + pluginId + key` 读写、列 key、统计 quota、按策略 prune。
- 卸载插件时用 namespace 删除即可，不需要 drop table。

推荐结构是一个 SQLite DB，少量固定表，用 `source + plugin_id` 做逻辑隔离。

## 范围

### 目标

- `storage.kv.*` 在 Tauri desktop 环境走 SQLite。
- `storage.quota.usage()` 基于 SQLite KV 统计。
- `storage.quota.prune()` 基于 SQLite KV 删除旧数据。
- `clearPluginPrivateStorage(source, pluginId)` 清理 SQLite KV 和现有 Blob 文件。
- 插件 SDK 类型和插件 repository 不变。
- 非 Tauri dev preview 继续有 fallback，方便 Vite 浏览器预览和脚本级测试。

### 非目标

- 不迁移历史 `localStorage` 数据。
- 不迁移 app/workspace/settings/plugin settings 的 Zustand persist。
- 不把 Blob bytes 写入 SQLite。
- 不给插件开放 SQLite schema、SQL 查询或 migration 能力。
- 不引入插件间运行时依赖。
- 不改变 `storage.private` / `storage.blob` 权限语义。

## 数据模型

### SQLite 文件

建议放在现有 app config 目录下：

```text
<config_dir>/plugin-data/plugin-storage.sqlite
```

`config_dir()` 已经是 Tauri host 内部统一入口。SQLite 文件属于 host private implementation，不暴露给插件。

### `plugin_kv`

```sql
CREATE TABLE IF NOT EXISTS plugin_kv (
  source TEXT NOT NULL,
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source, plugin_id, key)
);
```

字段语义：

- `source`: `builtin`、`installed` 或 `dev`。
- `plugin_id`: 插件 id。
- `key`: 插件自定义 KV key。它不参与文件路径拼接，但仍应限制为空白和明显异常值。
- `value_json`: 前端 `JSON.stringify(value)` 后写入的字符串。
- `byte_size`: `value_json` 的 UTF-8 byte length，用于 quota 和 prune。
- `updated_at`: host 写入时生成的毫秒时间戳。

推荐索引：

```sql
CREATE INDEX IF NOT EXISTS idx_plugin_kv_namespace_updated
ON plugin_kv (source, plugin_id, updated_at);
```

### Blob

Blob 保持当前 native 文件存储：

```text
<config_dir>/plugin-data/<source>/<pluginId>/blobs/
```

本次不需要新增 `plugin_blob` 表。Blob metadata 当前已经有旁路 JSON 文件；如果后续需要统一 quota 或维护扫描，可以单独设计 Blob metadata SQLite 化。

## Host API

新增 Tauri commands：

```text
plugin_kv_get
plugin_kv_set
plugin_kv_delete
plugin_kv_list
plugin_kv_usage
plugin_kv_prune
plugin_kv_clear
```

建议命名使用 `plugin_kv_*`，与现有 `save_plugin_blob`、`read_plugin_blob`、`delete_plugin_blob`、`get_plugin_blob_path`、`clear_plugin_blobs` 同属于 plugin private storage host commands。

### 参数与返回值

`plugin_kv_get`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  key: string
}
```

返回：

```ts
string | null
```

`plugin_kv_set`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  key: string
  valueJson: string
}
```

返回：

```ts
void
```

`plugin_kv_list`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  prefix?: string
}
```

返回：

```ts
Array<{ key: string; updatedAt: number }>
```

`plugin_kv_usage`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
}
```

返回：

```ts
{ bytes: number; itemCount: number }
```

`plugin_kv_prune`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  maxItems?: number
  maxBytes?: number
  maxAgeDays?: number
}
```

返回：

```ts
{ removedBytes: number; removedItems: number }
```

`plugin_kv_clear`：

```ts
{
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
}
```

返回：

```ts
void
```

## 前端实现

修改 `src/workspace/pluginStorage.ts`。

### Desktop 路径

在 `isTauri()` 为 true 时：

- `kv.get` 调 `plugin_kv_get`，拿到 `valueJson` 后 `JSON.parse`。
- `kv.set` 先 `JSON.stringify(value)`，再调 `plugin_kv_set`。
- `kv.delete` 调 `plugin_kv_delete`。
- `kv.list` 调 `plugin_kv_list`。
- `quota.usage` 调 `plugin_kv_usage`。
- `quota.prune` 调 `plugin_kv_prune`。
- `clearPluginPrivateStorage` 调 `plugin_kv_clear` 和现有 `clear_plugin_blobs`。

权限检查仍然留在前端 API 层：

```ts
const requireKv = () => {
  if (permissions) requirePluginPermissions(permissions, ['storage.private'])
}
```

Host command 仍要做 source/plugin_id/key 基础校验，不能只依赖前端。

### Browser preview fallback

非 Tauri 环境继续使用 local fallback，原因：

- Vite browser preview 不具备 Tauri invoke。
- 现有脚本测试大量是静态/轻量 runtime 检查。
- 保留 fallback 不影响 desktop 真实存储语义。

fallback 可以继续用 `localStorage`，但需要明确注释它只服务 non-Tauri preview。desktop 环境不得再写新的 `hiven-plugin-kv:*` key。

## Prune 语义

`PluginStoragePrunePolicy` 当前支持：

```ts
type PluginStoragePrunePolicy = {
  maxItems?: number
  maxBytes?: number
  maxAgeDays?: number
}
```

建议 SQLite prune 分两段执行：

1. 如果有 `maxAgeDays`，先删除 `updated_at < cutoff` 的项。
2. 如果有 `maxItems` 或 `maxBytes`，按 `updated_at DESC` 保留最新项，删除最旧项直到满足限制。

返回值统计实际删除的 `byte_size` 和 item 数。

## 文件影响

预计修改：

- `src/workspace/pluginStorage.ts`
  - KV desktop 路径改为 `plugin_kv_*` invoke。
  - non-Tauri fallback 明确为 preview fallback。
  - `clearPluginPrivateStorage` 增加 `plugin_kv_clear`。

- `src-tauri/Cargo.toml`
  - 增加 SQLite 依赖，建议 `rusqlite` with `bundled` feature。

- `src-tauri/Cargo.lock`
  - 由 Cargo 更新。

- `src-tauri/src/lib.rs`
  - 增加 SQLite 初始化、表创建和 KV commands。
  - 把 commands 注册进 `tauri::generate_handler!`。
  - 增加 Rust 单测覆盖 key validation、upsert、list prefix、usage、prune、clear。

- `scripts/test-clipboard-history-runtime.mjs`
  - 更新断言：KV desktop 路径不再要求 `localStorage` 是主存储。
  - 保留对 `PluginPrivateStorageApi`、权限、Blob native path 的检查。

- `scripts/test-app-launcher-contract.mjs`
  - 增加 app-launcher cache 不应依赖 localStorage KV 的 contract 检查。

不应修改：

- `src/plugins/clipboard-history/storage/*`
- `src/plugins/app-launcher/storage/*`
- `src/workspace/pluginTypes.ts` 的 public API
- `src/plugin-sdk.ts` 的 public export shape

## 实施任务

### Task 1: 增加 SQLite host storage

**目标：** Tauri host 能打开并初始化插件 KV SQLite DB。

**文件：**

- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

**验收：**

- DB 文件路径在 config dir 下。
- 表和索引通过 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 初始化。
- 初始化函数不暴露到插件 API。

### Task 2: 实现 `plugin_kv_*` commands

**目标：** host 提供完整 KV command set。

**文件：**

- Modify: `src-tauri/src/lib.rs`

**验收：**

- `plugin_kv_set` 使用 upsert。
- `plugin_kv_get` missing key 返回 `null`。
- `plugin_kv_list` 支持 prefix。
- `plugin_kv_usage` 返回当前 namespace 的 bytes 和 itemCount。
- `plugin_kv_prune` 支持 `maxItems`、`maxBytes`、`maxAgeDays`。
- `plugin_kv_clear` 只删除指定 `source + plugin_id` 的 KV。
- source 只能是 `builtin`、`installed`、`dev`。

### Task 3: 切换前端 KV 实现

**目标：** desktop 插件 KV 不再写 browser storage。

**文件：**

- Modify: `src/workspace/pluginStorage.ts`

**验收：**

- Tauri 环境下 `kv.*` 和 `quota.*` 都走 `plugin_kv_*`。
- `clearPluginPrivateStorage` 同时清 `plugin_kv_clear` 和 `clear_plugin_blobs`。
- non-Tauri fallback 仍可在 browser preview 使用。
- `PluginPrivateStorageApi` 类型不变。

### Task 4: 更新测试与 contract

**目标：** 测试口径从 localStorage KV 切到 SQLite KV。

**文件：**

- Modify: `scripts/test-clipboard-history-runtime.mjs`
- Modify: `scripts/test-app-launcher-contract.mjs`
- Add or modify: Rust tests in `src-tauri/src/lib.rs`

**验收：**

- 静态测试不再要求 KV 主路径使用 `localStorage`。
- contract 明确 desktop KV 通过 Tauri host command 持久化。
- Rust tests 覆盖 SQLite KV command 的核心行为。

### Task 5: 验证

运行：

```bash
npm run check:architecture
npm run test:clipboard-history-storage
npm run test:clipboard-history-runtime
npm run test:app-launcher-contract
cargo test --manifest-path src-tauri/Cargo.toml plugin_kv -- --test-threads=1
git diff --check
npm run build
```

如果 `npm run lint` 也执行，结论必须区分历史 lint 问题和本次新增问题。

## 验收标准

- desktop 环境新写入的插件 KV 数据存在 SQLite 中。
- desktop 环境新写入不产生新的 `hiven-plugin-kv:*` / `hiven-plugin-kv-meta:*` localStorage key。
- clipboard-history 能新增、读取、删除、清空记录。
- app-launcher cache 能写入、读取并在重启后保留。
- 卸载 installed 插件时，插件 KV 和 Blob 都被清理。
- 插件代码没有直接 import Tauri API，也没有绕过 `PluginPrivateStorageApi`。
- framework 仍只提供 host-owned storage primitive，不承载 clipboard-history 或 app-launcher 产品语义。

## 风险

- 旧 `localStorage` KV 数据会被放弃，这是本设计的明确选择。
- `rusqlite` bundled 会改变 Rust dependency graph，需要确认打包体积和各平台编译情况。
- SQLite 初始化如果放在每次 command 中，需要避免重复建表带来的噪音；如果做全局连接，需要注意线程和锁。
- Browser preview fallback 不能被误认为 desktop 真实路径，测试断言要覆盖这一点。

## 后续扩展

如果未来要给插件真正开放关系型能力，应另开能力设计，例如 `storage.sqlite`。

那会是新的插件权限和 SDK surface，插件需要声明 schema/migrations。届时更合适的隔离方式可能是每插件一个 SQLite database 文件，而不是在当前 private KV migration 中做每插件一个表。

当前迁移只替换 host-owned KV 后端，不改变插件的数据模型能力。
