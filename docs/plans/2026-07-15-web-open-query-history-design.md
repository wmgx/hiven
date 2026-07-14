# 网页快开：参数历史（Query History）设计

**日期:** 2026-07-15  
**状态:** 已确认  
**范围:** `web-open` 插件 + launcher collect-input 最小 host 扩展

## 目标

为网页快开入口提供**可配置的参数历史**：

1. 用户首次输入参数并成功打开链接后，记录该参数。
2. 下次进入同一入口的二级输入时，可在空输入态选择历史参数直接打开。
3. 也可继续输入新参数打开；新参数写入历史。

## 非目标

- 不做跨入口共享历史、云同步、搜索全库历史。
- 不把「参数历史」做成 framework 通用产品能力（第一版仅 web-open 使用）。
- 不把历史写入 plugin settings（避免设置膨胀与导出混入运行时数据）。
- 不改变一级 launcher 排序 / usage 语义。

## 已确认产品决策

| 决策点 | 选择 |
|--------|------|
| 开关粒度 | **每个入口单独开关** |
| 二级交互 | **空输入时下列表，点选历史直接打开**；有输入时隐藏列表，可敲新参数 |
| 容量 | **每个入口各自配置上限**，默认 20 |
| 去重 | 相同参数去重，再次使用置顶并更新 `lastUsedAt` |
| 管理 | 列表可删单条 + 设置页可清空该入口历史 |
| 默认入口 | Google / GitHub / MDN 等默认**不**开历史 |

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

1. 选中入口 → 进入 collect-input，输入为空。
2. 若开启历史且 kv 有数据 → 下方展示最近参数（新→旧）；标题为参数原文，副标题可为拼好的 URL（可选）。
3. **点选历史项** → 拼 URL 并 `openUrl`；成功后关闭 launcher，并刷新该条 `lastUsedAt`。
4. **输入非空** → 隐藏历史列表；Enter 用当前输入打开，成功后写入历史。
5. **清空输入** → 历史列表重新出现。
6. 空输入 + `emptyQueryBehavior: 'block'` 时 Enter 仍拦截（与现网一致）。

### 删除

- 列表项 secondary action / 行内删除：从该入口 kv 移除，不打开链接。
- 设置页「清空该入口历史」：`kv.delete('query-history/' + entryId)`。

### Host 最小扩展

现状要点：

- `previewInput` 仅对 `perform + inputPolicy` 生效，**collect-input（网页快开）当前不会走 preview**。
- `GlobalLauncherCollectInputFrame` 已能渲染 `previewOutput.choices`。
- `submitInput` 在存在 preview 时会优先执行 **第一条** choice —— 空输入有历史时必须避免误开第一条。

改动：

| 点 | 改动 |
|----|------|
| 进入 collect-input | 可选加载 suggestions 填入 `previewOutput` |
| 空输入 suggest | 对声明了 suggest 钩子的 collect-input：**空输入也加载**；有输入则清空 suggestions |
| Enter | 空输入 + 仅有历史 suggestions 时，**不**自动执行 first preview choice；仍走空输入校验或要求点选 |
| 点击 | `activateChoice` 打开对应历史项 |
| 键盘 ↑↓ | 第一版可选；非必须（点选即可） |

插件提供 suggestions 的方式（推荐）：

- collect-input item 增加可选 `suggest?: (ctx) => LauncherOutput | Promise<...>`（或等价 host 回调）。
- 仅在输入为空时由 controller 调用；web-open 读 kv 并返回 choices。
- **不**把「历史」做成 framework 通用产品 API；host 只提供空态 suggestions 基础设施。

### 边界

- 一级列表排序 / usage 不动。
- 历史不做跨入口共享、云同步。

## §3 存储健壮性、i18n、测试与验收

### 存储健壮性

- 读失败 / 解析失败 → 当空历史，不挡打开。
- 写失败 → 仍打开 URL，历史静默失败（可 dev 日志，不弹 toast）。
- 入口删除后旧 kv 懒清理即可；第一版不强制 GC。
- `maxQueryHistory` 调小后：下次写入时截断。

### i18n

所有用户可见文案走 locale（中英）：

- 设置：记录历史开关、上限、清空按钮与确认/成功文案。
- 二级：footer 提示「选择历史或输入新参数」（可选）。
- 删除 action 文案。

### 测试

| 层 | 内容 |
|----|------|
| 纯函数 | upsert 去重置顶、截断、空串不写、max 变更截断 |
| 插件 | 开关关时不写不展示；开时 execute 后 kv 有值 |
| controller（若动 host） | 空输入加载 suggest；有输入清空；空 Enter 不误开第一条；点击 choice 打开 |
| 手工 | 开历史 → 输入打开 → 再进见历史 → 点选 → 删一条 → 设置清空 |

### 验收标准

1. 未开历史的入口：行为与现网完全一致。
2. 开启后首次成功打开 → 再进该入口空输入可见该参数。
3. 可点历史直接打开；可输入新参数打开并置顶历史。
4. 重复参数只保留一条并置顶。
5. 超上限淘汰最旧。
6. 单条删除与设置清空生效。
7. 中英文无 hardcode UI 文案。
8. `npm run check:architecture` / build 通过；历史逻辑不进入 framework 的 diff/compare 语义。

## 实现任务拆分（供后续 plan）

1. **model + settings schema + migrate + locales**  
   - `recordQueryHistory` / `maxQueryHistory`  
   - settings version bump + migrate 默认值  
2. **`queryHistory.ts`**  
   - load / upsert / remove / clear；纯函数可单测  
3. **host：collect-input empty suggest**  
   - item `suggest` 钩子  
   - 进入 / 输入变空时加载；有输入清空  
   - 空 Enter 不误触第一条历史  
4. **web-open 接线**  
   - suggest 读历史 → choices（打开 + 删除）  
   - execute / 一步打开成功后 upsert  
5. **设置清空**  
   - 入口级清空按钮（settings body / schema action）  
6. **验证**  
   - 单测 + `check:architecture` + build + 手工路径  

## 架构原则对齐

- 历史是 **web-open 插件产品策略**，存在 plugin private storage。  
- host 只补 collect-input **空态 suggestions** 最小能力。  
- 符合 Agents.md：插件通过 host API / storage 使用能力，不把产品语义塞进 framework 核心。

## 相关文档

- `doc/2026-06-12-plugin-settings-and-web-quick-open-design.md`（原始网页快开设计；entry.id 已预留 recent 追踪）  
- `docs/plans/2026-07-01-web-open-dynamic-item-design.md`（动态直开 / matchPattern / favicon）  
- `src/plugins/web-open/` 当前实现  
