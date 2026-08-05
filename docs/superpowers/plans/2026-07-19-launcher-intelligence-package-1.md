# Launcher 智能化 包① 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 content-kit + 两级混合匹配协议（accepts 粗筛 + 可选 match() 精筛）+ 剪贴板 content 推荐切片 + usage journal 只写，使时间戳 / base64 / CSV 在 Global Launcher 零输入时能被正确推荐。

**Architecture:** kit 纯函数识别内容类型；host 对插件 `accepts` 做零代码粗筛，命中后再调度可选 `match()`（超时/失败隔离）；剪贴板 Object Block 与推荐消费同一识别结果；pluginActionManifest 一次性收编为 accepts 求值；usage journal 并行写入 SQLite，不影响现有 usageScore。

**Tech Stack:** TypeScript、现有 `scripts/test-*.mjs`（ts.transpile + assert）、Tauri/rusqlite、first-party plugins。

**权威设计:** `doc/2026-07-19-launcher-intelligence-roadmap-design.md` §5–§7、§10（吸收原 Intent 设计）。  
**不在本包:** alias/apps 消费方、ranking intentScore 槽位、窗口/进程、修改 textMatch/usageScore 语义。

**TDD 职责隔离:** 每个 Task 的测试由 **测试 agent** 先写并确认红；实现由 **实现 agent** 转绿；主 agent 验收。禁止同一 agent 兼写测试与实现并宣布通过。

**分支:** `feat/launcher-intelligence-package-1`（worktree，禁止直接在 main 大改）。

---

## 文件地图

| 路径 | 职责 |
|------|------|
| `src/kits/content/types.ts` | ContentKind、ContentDetection |
| `src/kits/content/detectContent.ts` | 纯函数 detectContent |
| `src/kits/content/index.ts` | 导出 |
| `src/pluginHostSdk.ts` | 注入 `kits.content` |
| `src/workspace/launcher/intentTypes.ts` | IntentMatchContext、IntentHit、ContentAccepts、match 类型 |
| `src/workspace/launcher/intentEngine.ts` | accepts 求值、match 调度、限条数/超时/失败隔离 |
| `src/workspace/launcher/types.ts` | PluginToolContribution 增加 `accepts?` / `match?` |
| `src/workspace/launcher/toolAdapter.ts` | 透传 accepts/match 到 LauncherItem |
| `src/launcher/clipboard/clipboardSnapshot.ts` | detectClipboardType 委托 content-kit 主 kind |
| `src/launcher/clipboard/actionRecommendation.ts` | 推荐改走 accepts 求值（收编 pluginActionManifest） |
| `src/launcher/clipboard/pluginActionManifest.ts` | 保留兼容 API，内部映射到 ContentAccepts 或标 deprecated 迁移路径 |
| `src/plugins/{date-time-assistant,encode-decode,csv}/` | 声明 accepts.kinds；版本 bump |
| `src-tauri/src/lib.rs` | usage_journal 表 + append/prune |
| `src/workspace/usageJournal.ts` | 前端 append 封装 |
| `src/workspace/launcher/controller.ts` | selectItem 记录 journal |
| `scripts/test-content-kit.mjs` 等 | 单测/契约 |

---

### Task 1: content-kit 纯函数识别

**Files:**
- Create: `src/kits/content/types.ts`
- Create: `src/kits/content/detectContent.ts`
- Create: `src/kits/content/index.ts`
- Create: `scripts/test-content-kit.mjs`
- Modify: `src/pluginHostSdk.ts`（注入 kits.content）

**设计要点:**
- `ContentKind` 覆盖现有 `ClipboardDetectedType` 全集 + 显式补齐：`base64`、`url-encoded`、`color`、`tsv`（tsv 可映射 csv）、`json`/`yaml`/`url`/`jwt`/`timestamp`/`csv` 等。
- 现有 kind 全集（执行前核对 `clipboardSnapshot.ts`）：json, url, text, command, secret, unknown, sql, css, xml, csv, jwt, timestamp, secret-like, yaml, query-string, markdown。
- `detectContent(text): ContentDetection[]`，每项 `{ kind, confidence, normalized, captures? }`。
- 宁缺毋滥：普通中文句子不返回 base64/jwt。
- kit 禁止 import workspace/plugins。
- `detectClipboardType` 行为兼容：主 kind 与旧 detect 顺序对齐（secret → json → url → jwt → timestamp → …）。

- [ ] **Step 1（测试 agent）:** 写 `scripts/test-content-kit.mjs`，覆盖：
  - Unix 秒/毫秒时间戳 → kind `timestamp` confidence ≥ 0.9
  - 标准 JWT 三段 → `jwt`
  - base64 合法串 → `base64`（且不误报普通英文词）
  - CSV 两行逗号表 → `csv`
  - pretty JSON → `json`
  - 普通中文「你好世界」→ 不得出现 jwt/base64/timestamp 高置信
  - 空串 → `unknown` 或空列表（与实现约定一致，测试写死）
  Run: `node scripts/test-content-kit.mjs` → Expected: FAIL（模块不存在）

- [ ] **Step 2（实现 agent）:** 实现 kit + 导出；`PluginHostKits` 增加：
  ```ts
  content: { detectContent: typeof detectContent }
  ```
  不改插件业务逻辑。

- [ ] **Step 3:** `node scripts/test-content-kit.mjs` → PASS；`npm run check:architecture` → PASS。

- [ ] **Step 4:** Commit `feat(content-kit): detectContent pure kit for launcher intelligence`

---

### Task 2: clipboardSnapshot 消费 content-kit（行为兼容）

**Files:**
- Modify: `src/launcher/clipboard/clipboardSnapshot.ts`
- Modify or extend: `scripts/test-clipboard-object-block.mjs` / 新增回归用例

**要点:**
- `detectClipboardType` 内部调用 `detectContent`，取最高置信且映射到 `ClipboardDetectedType` 的主 kind。
- base64 / url-encoded / color 若暂不在 `ClipboardDetectedType` 中：映射为 `text` 或扩展类型（优先扩展 union 并更新 KIND_LABELS，避免静默丢失）。
- 文件路径检测逻辑保留在 clipboardSnapshot（非 content 语义）。
- 不得破坏 `shouldAutoAttachClipboard` 与现有 object block 测试。

- [ ] **Step 1（测试 agent）:** 补充时间戳/jwt/csv 经 `detectClipboardType` 的契约断言；确认现有 object-block 测试仍为基线。
- [ ] **Step 2（实现 agent）:** 委托 content-kit，保持路径/secret 优先级。
- [ ] **Step 3:** 跑 `node scripts/test-clipboard-object-block.mjs`、`node scripts/test-object-block-expanded-model.mjs`、`node scripts/test-content-kit.mjs` → PASS。
- [ ] **Step 4:** Commit `refactor(clipboard): detect types via content-kit`

---

### Task 3: Intent 协议类型 + intentEngine（accepts 粗筛 + match 调度）

**Files:**
- Create: `src/workspace/launcher/intentTypes.ts`
- Create: `src/workspace/launcher/intentEngine.ts`
- Create: `scripts/test-intent-engine.mjs`
- Modify: `src/workspace/launcher/types.ts` — `PluginToolContribution` 增加：
  ```ts
  accepts?: {
    kinds?: string[]  // ContentKind
    regex?: string
    aliases?: string[]
    apps?: string[]
  }
  match?(ctx: IntentMatchContext): IntentHit[] | null
  ```
- Modify: `src/workspace/launcher/toolAdapter.ts` — 透传 accepts；match 不进序列化危险区，挂在 item 上时注意仅运行时函数字段。

**Host 规则（必须有测试）:**
1. accepts 纯数据求值，测试可证明 match 未被调用当 accepts 未命中。
2. match 仅对 accepts 命中者调用。
3. match 抛错 → 忽略该 matcher，其它继续。
4. 软超时：同步 match 用 budget（如 8ms）墙钟；超时丢弃（实现可用 performance.now；测试可 mock 长循环或注入 clock）。
5. 每插件/全局限条数（如每插件 3、全局 12）。
6. 未声明 accepts 的项不参与 Intent 推荐。
7. 包① 不消费 aliases/apps 也可：求值函数实现完整字段，apps/aliases 未提供 context 时跳过该维度或当空匹配。

- [ ] **Step 1（测试 agent）:** 契约测试：命中/未命中、失败隔离、限条数、超时丢弃。
- [ ] **Step 2（实现 agent）:** 实现 engine + 类型扩展 + toolAdapter 透传。
- [ ] **Step 3:** 测试 PASS；architecture PASS。
- [ ] **Step 4:** Commit `feat(launcher): two-level intent accepts+match engine`

---

### Task 4: 推荐路径收编 pluginActionManifest → accepts 求值

**Files:**
- Modify: `src/launcher/clipboard/actionRecommendation.ts`
- Modify: `src/launcher/clipboard/pluginActionManifest.ts`（兼容层：`discoverActionsForBlock` 可改为读工具 accepts 注册表，或保留 registry 但从同一 ContentAccepts 源填充）
- Modify: Global Launcher 宿主若 `objectActions = []`，恢复从推荐管线取 content 动作（查 `GlobalLauncherHost.tsx` / object-action mode）
- Create: `scripts/test-intent-content-recommend.mjs`（或扩展现有 clipboard recommendation 测试）

**要点:**
- 不新造第四套匹配语言。
- 从已加载插件 tools 收集 `accepts`，结合 block.kind / content-kit detections 推荐。
- 硬编码 `CLIPBOARD_ACTIONS_BY_KIND` 可保留作 fallback，但首批插件（date-time / encode-decode / csv）应以 accepts 为主。
- Intent 指向 command：**抬分不复制**（若列表侧已有同 systemKey，推荐层也不双份）。

- [ ] **Step 1（测试 agent）:** 场景：timestamp block → convert-timestamp / date-time 动作；base64 → decode；csv → csv 工具；坏 match 不影响其它。
- [ ] **Step 2（实现 agent）:** 接线推荐 + 宿主。
- [ ] **Step 3:** 相关测试 PASS。
- [ ] **Step 4:** Commit `feat(launcher): content recommend via accepts evaluation`

---

### Task 5: 首批插件声明 accepts + 版本 bump

**Files:**
- Modify: `src/plugins/date-time-assistant/index.ts` + `manifest.json` version
- Modify: `src/plugins/encode-decode/index.ts` + `manifest.json` version
- Modify: `src/plugins/csv/index.ts` + `manifest.json` version
- 对应 locales 若有新文案则补齐（本包尽量不新加 hardcode 文案）

**声明示例:**
```ts
// date-time-assistant timestamp tool
accepts: { kinds: ['timestamp'] }

// encode-decode base64 decode
accepts: { kinds: ['base64'] }

// encode-decode jwt decode  
accepts: { kinds: ['jwt'] }

// csv open/surface
accepts: { kinds: ['csv'] }
```

textMatch 一期保留不动。

- [ ] **Step 1（测试 agent）:** 静态/集成断言 plugins 导出 tools 含 accepts.kinds。
- [ ] **Step 2（实现 agent）:** 声明 + version bump（semver patch/minor）。
- [ ] **Step 3:** `node scripts/test-date-time-assistant.mjs` 等既有插件测试仍绿 + 新断言 PASS。
- [ ] **Step 4:** Commit `feat(plugins): declare accepts for date-time, encode-decode, csv`

---

### Task 6: usage journal（只写不读）

**Files:**
- Modify: `src-tauri/src/lib.rs` — 表 `usage_journal`，命令 `usage_journal_append` / `usage_journal_prune`
- Create: `src/workspace/usageJournal.ts`
- Modify: `src/workspace/launcher/controller.ts` — 在 `shouldRecord` 为 true 的路径旁 fire-and-forget append
- Create: `scripts/test-usage-journal-contract.mjs`（前端契约：调用签名/不传 content 正文；Rust 单测可加）

**表字段:** `id, command_id, surface_id, executed_at, prev_command_id, object_kind`  
**约束:** 不记剪贴板全文；prune 90 天或 5 万条先到者；失败不阻塞执行。

- [ ] **Step 1（测试 agent）:** 契约：append payload 无 text 字段；controller 路径调用 journal（可 mock invoke）。
- [ ] **Step 2（实现 agent）:** Rust + TS 接线。
- [ ] **Step 3:** 测试 PASS。
- [ ] **Step 4:** Commit `feat(usage-journal): append-only SQLite journal on launcher select`

---

### Task 7: 包① 验收与架构门禁

- [ ] `npm run check:architecture`
- [ ] `git diff --check`
- [ ] `npm run build`
- [ ] 相关 `scripts/test-*.mjs` 全绿（content-kit、intent-engine、clipboard object block、date-time、本包新增）
- [ ] 手测清单（若本环境无 GUI，在 PR 描述写明待真机）：
  1. 复制时间戳 → 置顶转日期
  2. 复制 base64 → 置顶解码
  3. 复制 CSV → 置顶 CSV 工具
- [ ] 文档：在 `doc/2026-07-19-launcher-intelligence-roadmap-design.md` 包①验收勾选可另开 commit 或 PR 说明

---

## 禁止事项（包①）

- 禁止改 ranking 的 usageScore / textMatch 行为
- 禁止硬编码用户可见新文案（用 i18n）
- 禁止 JWT/CSV 等产品语义进 framework（识别进 kit，动作进插件）
- 禁止无超时调用 match()
- 禁止引用已删除的 instantSuggestions
- 禁止插件直接 import `src/kits/*` 源码（经 SDK）

## Spec 覆盖自检

| 设计 § | Task |
|--------|------|
| §7.1 content-kit | T1–T2 |
| §5 两级混合 | T3 |
| §5.4 pluginActionManifest 迁移 | T4 |
| §10.2 首批插件 | T5 |
| §7.3 journal | T6 |
| §10.4 验收 | T7 |
