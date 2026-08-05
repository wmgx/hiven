# Launcher 智能化 包② 实施计划

> **For agentic workers:** Use subagent-driven-development. TDD：测试 agent 与实现 agent 分离。

**Goal:** 文本智能补全——别名短输入命中、content Intent 抬分进 ranking、前台应用 contextBoost + 权限；高频插件批量声明 accepts/aliases。

**Architecture:** 在包① intentEngine / content-kit 上扩展 ranking 槽位 `intentScore` + `contextBoost`；`accepts.aliases` 参与列表过滤与抬分；前台 app 名驱动轻量 contextBoost；不改 usageScore/textMatch 语义量级冲突时保持「名称精确匹配 > 强 Intent」。

**Tech Stack:** TypeScript、现有 ranking / intentEngine、contextBroker foreground。

**分支:** 继续 `feat/launcher-intelligence-package-1` worktree（包② 叠在包① 上）。

**权威:** `doc/2026-07-19-launcher-intelligence-roadmap-design.md` §6、§11 包②。

---

### Task 1: evaluateAccepts 通路改为「路径 OR」

**问题:** 同时声明 `kinds` + `aliases` 时 AND 导致「只输入 jwt、无剪贴板」无法命中。

**语义:**
- content 路径：若声明了 kinds 和/或 regex，这些维度 AND；未声明则路径 inactive
- alias 路径：若声明 aliases 则需 query 规范化命中
- apps 路径：若声明 apps 则需 foregroundApp 命中
- 最终：至少一个 **active 路径成功** → true；无任何路径声明 → false（空 accepts 对象除外：保持 vacuous true）

- [ ] 测试 agent：扩展 `scripts/test-intent-engine.mjs` — kinds+aliases 仅 query 命中、仅 content 命中、双失败
- [ ] 实现 agent：改 `evaluateAccepts`；旧单维度测试仍绿
- [ ] Commit `fix(intent): OR pathways for accepts kinds vs aliases vs apps`

---

### Task 2: ranking 增加 intentScore + contextBoost

**Files:** `src/workspace/launcher/ranking.ts`、`scripts/test-launcher-ranking.mjs` 或新建 `scripts/test-launcher-intent-ranking.mjs`

**RankContext 扩展:**
```ts
contentText?: string
detections?: Array<{ kind: string; confidence: number; normalized: string }>
foregroundApp?: string
```

**量级（集中常量）:**
```ts
INTENT_SCORE_STRONG = 2400  // conf>=0.85 content 或精确 alias
INTENT_SCORE_MEDIUM = 1600
CONTEXT_BOOST_MAX = 400
// 现有 TEXT_MATCH 800, DYNAMIC 900；精确名匹配 ~3000-6000 仍赢
```

**计算:**
- `intentScore(item, ctx)`：读 `item.accepts`；content 路径用 detections/contentText；alias 路径用 query；映射 confidence → 量级；无 accepts → 0
- `contextBoost(item, ctx)`：`accepts.apps` 命中 → ≤400；或 host 类别表（可选最小表：browser/ide/chat 关键词 → 按 item.systemKey 前缀/pluginId 轻抬，≤400）
- `scoreLauncherItem` = 现有 + intentScore + contextBoost
- **不过滤** intent-only（query 模式仍主要靠 name/alias 过滤）；但 `itemMatchesQuery` 应对 `accepts.aliases` 命中返回 true

- [ ] 测试：JWT content 空 query 时 jwt tool 分 > 无关 app；query=`jwt` 精确 alias 抬分；query 全名命令 > 弱 intent；apps 命中 contextBoost
- [ ] 实现
- [ ] Commit `feat(ranking): intentScore and contextBoost slots`

---

### Task 3: useLauncherSession 注入 detections + foreground

**Files:** `useLauncherSession.ts`、可选 `GlobalLauncherHost.tsx`

- open 时/ contentText 变时：`detectContent(contentText)` 同步
- foreground：session options 增加 `foregroundApp?: string`；Host 在 open 时读 contextBroker / `current_foreground_app_context` 传入
- rank 调用带上 detections + foregroundApp

- [ ] 契约测试或静态断言 session 传 RankContext 新字段
- [ ] 实现
- [ ] Commit `feat(launcher): pass detections and foreground into ranking`

---

### Task 4: 权限 `context.foreground-app`

**Files:** `pluginTypes.ts` PluginPermission、`pluginPermissions.ts` ALL + labels

- 新增 `'context.foreground-app'`
- i18n label en/zh
- 本期 host ranking 读 foreground **不强制** 插件 permission（host 自有）；权限为插件将来读取前台预留。可选：第三方插件声明 requiredPermissions 时才校验。

- [ ] 测试：ALL_PLUGIN_PERMISSIONS 含新项；describe 有中英文
- [ ] 实现
- [ ] Commit `feat(permissions): add context.foreground-app`

---

### Task 5: 高频插件 aliases + accepts 批量

**插件（按优先级）:**
1. encode-decode：`jwt`/`解jwt`/`decode jwt`/`b64`/`base64 解` 等 accepts.aliases；kinds 已有
2. json-tools：`fmt`/`格式化`/`pretty` + kinds `json`
3. yaml：`to yaml`/`转yaml` + kinds
4. date-time-assistant：时间戳别名
5. translate：`翻译`/`translate` + 可选 apps 浏览器/飞书
6. calculator / csv：补 aliases（次优先）

display.aliases 与 accepts.aliases 对齐（搜索过滤 + intent）。
manifest version bump。

- [ ] `scripts/test-plugin-alias-accepts.mjs` 核心别名表
- [ ] 实现
- [ ] Commit `feat(plugins): intent aliases for encode-decode json translate…`

---

### Task 6: 包② 验收

```bash
node scripts/test-intent-engine.mjs
node scripts/test-launcher-intent-ranking.mjs  # 或扩展 ranking 测试
node scripts/test-plugin-alias-accepts.mjs
node scripts/test-content-kit.mjs
npm run check:architecture
git diff --check
npm run build
```

质量门槛：标准 JWT content → 相关 tool intentScore 进入高分；`fmt` 短查询能进候选列表。

---

### 禁止
- 不改 usageScore 公式核心
- 不引入 LLM
- 不实现窗口/进程（包④⑤）
- 不 hardcode 用户可见新文案（permission label 走 describe 表）
