# 网页快开：参数历史（Query History）设计

**日期:** 2026-07-15  
**状态:** 已确认  
**范围:** `web-open` 插件 + launcher collect-input 最小 host 扩展

## 目标

为网页快开入口提供**可配置的参数历史**：

1. 用户首次输入参数并成功打开链接后，记录该参数。
2. 下次进入同一入口的二级输入时，可浏览 / 过滤历史参数并用方向键或点击打开。
3. 无匹配历史或未高亮历史时，用当前输入打开新链接并写入历史。

## 非目标

- 不做跨入口共享历史、云同步、搜索全库历史。
- 不把「参数历史」做成 framework 通用产品能力（第一版仅 web-open 使用）。
- 不把历史写入 plugin settings（避免设置膨胀与导出混入运行时数据）。
- 不改变一级 launcher 排序 / usage 语义。

## 已确认产品决策

| 决策点 | 选择 |
|--------|------|
| 开关粒度 | **每个入口单独开关** |
| 二级交互 | **空输入展示全部历史；有输入时优先过滤历史**；↑↓ 高亮；Enter 优先高亮项，无高亮则用输入原文打开并记录 |
| 容量 | **每个入口各自配置上限**，默认 20 |
| 去重 | 相同参数去重，再次使用置顶并更新 `lastUsedAt` |
| 管理 | 列表可删单条 + 设置页可清空该入口历史 |
| 默认入口 | Google / GitHub / MDN 等默认**不**开历史 |
| Enter 规则 | **有高亮 → 开历史项；无高亮 → 用输入框原文**；默认**不**自动高亮第一条，避免误开近似历史 |

## §1 数据与配置

### Settings（入口字段）

```ts
type WebQuickOpenEntry = {
  // ...existing fields
  /** 是否记录并展示该入口的参数历史；默认 false */
  recordQueryHistory?: boolean
  /** 该入口最多保留条数；默认 20；仅在开启历史时有意义 */
  maxQueryHistory?: number
}
```

设置 UI（object-list 字段）：

- 开关：记录参数历史（i18n）
- 数字：历史条数上限（默认 20；开启历史时展示）
- 按钮：清空该入口历史（开启历史时展示）

### 运行时存储（plugin private kv，不进 settings）

```ts
// key: query-history/<entryId>
type QueryHistoryRecord = {
  queries: Array<{
    text: string
    lastUsedAt: number
  }>
}
```

### 写入规则

- 仅当 `recordQueryHistory === true` 时记录。
- **成功** `openUrl` 后写入。
- `text = trim(query)`；空字符串不记。
- 去重：同 `text` 提到最前并更新 `lastUsedAt`。
- 超过 `maxQueryHistory` 淘汰最旧。
- 覆盖路径：collect-input 提交、点选历史、matchPattern 一步打开、Object Block 直开（若走同一 execute 且成功）。
- 不覆盖：打开失败、插件 disabled、空 query。

## §2 交互与 host 改动

### 二级输入行为

1. 选中入口 → 进入 collect-input，输入为空，**无高亮**。
2. 若开启历史且 kv 有数据 → 下方展示最近参数（新→旧）；标题为参数原文，副标题可为拼好的 URL（可选）。
3. **输入变化** → 对历史做**包含过滤**（case-insensitive，匹配 `text`）；无匹配则列表为空，仍可 Enter 用原文打开。
4. **↑ / ↓** → 在当前过滤结果中移动高亮：
   - 无高亮 + ↓ → 高亮第一条。
   - 高亮在第一条 + ↑ → **移除高亮**（回到「用输入原文」；到顶不循环到底部）。
   - 高亮在最后一条 + ↓ → 停在最后一条（不循环、不强制清高亮）。
   - 中间项正常上下移动。
5. **Enter**：
   - 有高亮历史项 → 用该历史参数打开（并 upsert 置顶）。
   - **无高亮** → 用输入框当前文本打开；成功则写入历史。
   - 空输入 + 无高亮 + `emptyQueryBehavior: 'block'` → 仍拦截（与现网一致）。
   - 空输入 + 有高亮 → 允许打开该历史项（即使 empty 为 block）。
6. **点击**历史项 → 等同于高亮该项并执行打开。
7. 打字过程中若过滤结果变化，高亮策略：若当前高亮项仍在过滤结果中则保留；否则清除高亮（回到「无高亮 / 用原文」）。

### 删除

- 列表项 secondary action / 行内删除：从该入口 kv 移除，不打开链接；删除后刷新列表并校正高亮。
- 设置页「清空该入口历史」：`kv.delete('query-history/' + entryId)`。

### Host 最小扩展

现状要点：

- `previewInput` 仅对 `perform + inputPolicy` 生效，**collect-input（网页快开）当前不会走 preview**。
- `GlobalLauncherCollectInputFrame` 已能渲染 `previewOutput.choices`，但**无选中索引 / ↑↓**。
- 现有 `submitInput` 在存在 preview 时会优先执行 **第一条** choice —— 与本设计冲突，必须改为「仅高亮项优先，无高亮则 execute 原文」。

改动：

| 点 | 改动 |
|----|------|
| 进入 collect-input | 加载 suggestions（query 为空 = 全量历史）填入 `previewOutput`；`selectedSuggestionIndex = -1`（无高亮） |
| 输入变化 | 调用 suggest（带当前 inputText）刷新过滤列表；校正高亮索引 |
| Enter | **有高亮** → `activateChoice(高亮项)`；**无高亮** → `execute` 当前输入（成功后插件记历史） |
| 点击 | 打开对应历史项 |
| 键盘 ↑↓ | **必须**：在 collect-input + 有 suggestions 时移动高亮；**到顶再 ↑ 移除高亮**（index = -1），不循环 |
| 渲染 | 列表项反映 `selectedSuggestionIndex` 高亮样式 |

插件提供 suggestions 的方式（推荐）：

- collect-input item 增加可选 `suggest?: (ctx) => LauncherOutput | Promise<...>`（ctx 含当前 `inputText`）。
- controller 在进入 frame、以及 inputText 变化（可 debounce）时调用；web-open 读 kv 并按输入过滤后返回 choices。
- **不**把「历史」做成 framework 通用产品 API；host 只提供 collect-input suggestions + 高亮选择基础设施。

### Host `suggest` 契约（通用，非 history 产品 API）

| 角色 | 职责 |
|------|------|
| **Host** | 提供 `item.suggest` 钩子、`selectedSuggestionIndex`、↑↓ 高亮、Enter 分支（高亮 → `activateChoice`，无高亮 → `execute` 原文）、collect-input 建议列表壳（`l-suggest-*`）、`activateSecondary(choice, actionId)` 回调接线 |
| **Plugin** | 实现 `suggest`（读产品数据、过滤、返回 `LauncherOutput.choices`）；`primaryAction` / `secondaryActions` 的 id 与语义；成功打开后写历史；favicon 只吐 `plugin-blob:*` 或 lucide 名（如 `Globe`） |

**Secondary action 约定：**

- 插件在 choice 上声明 `secondaryActions: [{ id, title, run }]`。
- Host UI 渲染 compact 按钮，点击时调用 **host 回调** `onSecondaryAction(choice, actionId)` → controller `activateSecondary(choice, actionId)`。
- Host **不** hardcode 任何 action id（如 `delete`）；产品语义全在插件 `run` 里。
- `run` 返回 `{ ok: true, keepOpen: true }` 时：若当前为 collect-input 且 item 有 `suggest`，host **留在同一 frame** 并 `refreshSuggestions()`（通用刷新，非 history 专用）。

**Icon 约定：**

- Host `resolveIcon` 只认：lucide 名、`plugin-blob:…`、`app-icon:…`。
- 站点图标拉取/候选 URL/`/logo.png` 等策略 **只在插件** `faviconCache`；成功后存 blob，对外只给 `plugin-blob` 或 `Globe`。
- **预热时机（web-open）**：
  1. `hooks.startup` — 应用启动时对当前规则域名 warm
  2. `settings.onChange` — 设置 write-through 后 debounce warm（改 URL 模板即拉）
  3. launcher 路径上 cache miss 时后台 warm（兜底）
- **拉取通道**：必须用 `network.request({ responseType: 'binary' })`（Tauri reqwest，无 CORS）。禁止 webview `fetch` 读跨域图片（CORS 会失败；text 模式会损坏 PNG）。
- 权限：`storage.private` + `storage.blob` + `network.request`
- 静态 `launcher.items` 用 getter，每次 collect 时从 memory 读 `plugin-blob`，warm 完成后重新打开启动器即可看到站点图。

### 边界

- 一级列表排序 / usage 不动。
- 历史不做跨入口共享、云同步。
- 过滤规则第一版：子串包含、大小写不敏感；不做拼音/模糊（若以后要做，仍留在插件 suggest 内）。
- Host CSS/i18n 使用中性名（`l-suggest-*`、`collectInputSuggestHint`），不出现 history 产品词。

## §3 存储健壮性、i18n、测试与验收

### 存储健壮性

- 读失败 / 解析失败 → 当空历史，不挡打开。
- 写失败 → 仍打开 URL，历史静默失败（可 dev 日志，不弹 toast）。
- 入口删除后旧 kv 懒清理即可；第一版不强制 GC。
- `maxQueryHistory` 调小后：下次写入时截断。

### i18n

所有用户可见文案走 locale（中英）：

- 设置：记录历史开关、上限、清空按钮与确认/成功文案。
- 二级：footer 可提示「↑↓ 选择历史 · Enter 打开」（有历史时）。
- 删除 action 文案。

### 测试

| 层 | 内容 |
|----|------|
| 纯函数 | upsert 去重置顶、截断、空串不写、max 变更截断；过滤匹配 |
| 插件 | 开关关时不写不展示；开时 execute 后 kv 有值；suggest 按输入过滤 |
| controller（若动 host） | 进入加载 suggest；输入变化刷新；默认无高亮；↑↓ 高亮；Enter 有高亮开历史 / 无高亮开原文；空 Enter + block 拦截 |
| 手工 | 开历史 → 输入打开 → 再进见历史 → 过滤 → ↑↓ 选中打开 → 无高亮 Enter 开新词 → 删一条 → 设置清空 |

### 验收标准

1. 未开历史的入口：行为与现网完全一致。
2. 开启后首次成功打开 → 再进该入口空输入可见该参数。
3. 输入时可过滤历史；↑↓ 高亮；有高亮 Enter 开历史项。
4. 无高亮时 Enter 用当前输入打开新链接并记录（无匹配历史时亦然）。
5. 默认不自动高亮第一条；从无高亮 ↓ 才进入第一条；第一条再 ↑ 移除高亮。
6. 重复参数只保留一条并置顶。
7. 超上限淘汰最旧。
8. 单条删除与设置清空生效。
9. 中英文无 hardcode UI 文案。
10. `npm run check:architecture` / build 通过；历史逻辑不进入 framework 的 diff/compare 语义。

## 实现任务拆分（供后续 plan）

1. **model + settings schema + migrate + locales**  
   - `recordQueryHistory` / `maxQueryHistory`  
   - settings version bump + migrate 默认值  
2. **`queryHistory.ts`**  
   - load / upsert / remove / clear / filter；纯函数可单测  
3. **host：collect-input suggestions + 高亮**  
   - item `suggest(ctx)` 钩子（带 inputText）  
   - 进入 / 输入变化时加载过滤列表  
   - `selectedSuggestionIndex`（-1 = 无高亮）  
   - ↑↓ 导航；Enter 按高亮 / 原文分支  
4. **web-open 接线**  
   - suggest 读历史并过滤 → choices（打开 + 删除）  
   - execute / 一步打开成功后 upsert  
5. **设置清空**  
   - 入口级清空按钮（settings body / schema action）  
6. **验证**  
   - 单测 + `check:architecture` + build + 手工路径  

## 架构原则对齐

- 历史是 **web-open 插件产品策略**，存在 plugin private storage。  
- host 只补 collect-input **suggestions + 高亮选择** 最小能力。  
- 符合 Agents.md：插件通过 host API / storage 使用能力，不把产品语义塞进 framework 核心。

## 相关文档

- `doc/2026-06-12-plugin-settings-and-web-quick-open-design.md`（原始网页快开设计；entry.id 已预留 recent 追踪）  
- `docs/plans/2026-07-01-web-open-dynamic-item-design.md`（动态直开 / matchPattern / favicon）  
- `src/plugins/web-open/` 当前实现  
