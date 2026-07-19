# 桌面目标可扩展协议（Desktop Target Provider）设计

**日期:** 2026-07-19  
**状态:** 评审修订稿（v1.2）— 二刷问题已并入；可关评审开工  
**产品:** hiven（原 FluxText）  
**读者:** 实现 AI / 评审 / 后续维护者  
**关联:**

- `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（控制中枢总路线；包③–⑤ 已有窗口/进程骨架；**§6 量级表与本文 desktopAffinity 已核对一致**）
- `docs/superpowers/specs/2026-07-19-control-hub-intent-design.md`（已被路线图吸收）
- `doc/2026-07-19-launcher-interaction-redesign-demo.html`（交互 demo；§5.1 行样式应对齐）
- `doc/diff-plugin-boundary-decision.md`、`Agents.md`（host / plugin / kit 边界）
- 现状实现参考：`src/workspace/appLauncher/`、`src/workspace/desktopControl/`、`src/workspace/launcher/hostProvider.ts`、`src/workspace/launcher/registry.ts`（`onPartial`）、`src/workspace/launcher/types.ts`（`LauncherHostCapability`、`isEditorCommandBarItem`、`kindLabel`）、`src/components/launcher/LauncherMixedList.tsx`（kindLabel 渲染）、`scripts/check-architecture.mjs`（workspace 深 import 禁令）

**修订摘要：**

- **v1.1：** partial；usage/systemKey；close 路径；capability 连字符；关闭 §15；D2 现网 terminate 缺陷  
- **v1.2：** D1 完成定义改为可检验 delta；kindLabel i18n 落点；detections 仅性能短路；priority 量级定义；两层去重 key 对齐；surfaces 协议化；与 demo 交叉引用
---

## 1. 背景与问题

### 1.1 产品方向（已讨论结论）

Global Launcher 作为统一智能入口时，**桌面导航类目标**应与「开应用」同一心智：

| 目标类型 | 用户意图 | 入口形态 |
|----------|----------|----------|
| 应用 | 打开 / 激活 App | **一级混排** |
| 窗口 | 切到某个窗口 | **一级混排**（与 App 同框） |
| 浏览器/编辑器标签 | 切到某个 tab / 文档页 | **一级混排**（与 App/窗口同框） |
| 进程结束 | 危险操作 | **二级入口**（如输入 `kill` 后再列进程 + 资源信息） |

标签页（Chrome / Edge 等）若能进入同一混排，比「只有窗口」更贴近真实使用：用户记的是页面，不是浏览器窗口壳。

### 1.2 可扩展性痛点

若按「Chrome 一套、Edge 一套、VS Code 一套」各自写 list + UI + ranking：

- 每接入一个有「页/签」概念的软件 ≈ 重做一条管道  
- ranking、空搜策略、强文本 intent 让位、权限与失败降级都会分叉  

**目标：** 把「桌面目标」抽象成稳定协议；新软件只实现 **薄适配器（Provider）**，不再复制 Launcher 管道。

### 1.3 非目标（本设计）

- 不实现完整浏览器扩展与本机桥的每一行协议细节（可另开扩展专项设计）
- 不把任意第三方默认开放「读全部 tab」而不经权限
- 不做 Windows/Linux 与 macOS 同周对等（平台可降级）
- 不解决飞书 OAuth、LLM 意图、通用 RPA
- 不把 web-open 站点模板与「已打开 tab 列表」合并成同一产品概念

---

## 2. 设计目标与成功标准

### 2.1 目标

1. **统一模型：** App / 窗口 / 标签（及未来同类目标）均为 `DesktopTarget`，进入同一 Global Launcher 列表与 ranking。  
2. **可扩展：** 新增来源 = 实现 `DesktopTargetProvider` + 注册 + 权限/开关，**不**新开平行列表管道。  
3. **边界清晰：** 导航目标属 **host 桌面能力**；文本/站点业务工具仍属 **plugin**。  
4. **安全分层：** 聚焦类 L1 直接执行；结束进程 / 关窗口等 L2 必须确认；杀进程走二级入口。  
5. **失败可降级：** 某 provider 超时、扩展未装、API 不可用 → 静默无结果，不拖垮其它来源。

### 2.2 成功标准

| 标准 | 说明 |
|------|------|
| 扩展成本 | 新软件接入以「adapter 工作量」衡量，而非「重做 Launcher」 |
| Chromium 族 | Chrome / Edge（及同 API 的 Chromium 浏览器）共享一份 provider 实现，仅配置化差异 |
| 混排可理解 | 列表用 type 标签区分应用 / 窗口 / 标签；有 query 时名称匹配优先 |
| 危险隔离 | 空搜与普通 query **不**默认铺满进程；`kill` 等显式进入进程模式 |
| 架构检查 | 插件不直接 import host 私有 ranking；kit 无 framework 依赖 |

---

## 3. Host vs Plugin vs 扩展运行时

### 3.1 归属裁决

| 概念 | 归属 | 理由 |
|------|------|------|
| 统一混排、ranking 槽位、空搜条数、强文本 intent 让位 | **Host** | 控制中枢产品策略 |
| `DesktopTarget` / `DesktopTargetProvider` 协议与注册表 | **Host** | 所有来源共用 |
| 系统窗口 list/focus、进程 list/terminate | **Host + native** | 已有桌面控制骨架 |
| 浏览器 tab list/focus 的 **native 桥** | **Host + native** | 敏感、需本机通信 |
| Chromium **扩展包** | Host 配套运行时（一等能力） | 非业务插件市场项 |
| 设置中「启用浏览器标签 / 支持 Chrome·Edge」 | Host 设置或 first-party 开关模块 | 可关，但是桌面能力开关 |
| web-open 模板、`{query}`/`{clipboard}` | **Plugin** | 「打开/构造 URL」业务语义 |
| JWT/JSON/CSV 等文本动作 | **Plugin** | 内容智能，非桌面目标 |
| 第三方「再做一个平行 tab 列表 UI」 | **禁止** | 必须走 Provider 协议 |

### 3.2 依赖方向

```text
Global Launcher (host)
  → Desktop Target Registry (host)
       → providers: app | window | browser.chromium | vscode | …
            → native APIs / extension bridge

plugins (web-open, encode-decode, …)
  → workspace public API / kits
  ✗ 不直接注册平行 Launcher 管道冒充桌面目标
  ✗ 不默认获得「枚举全部浏览器 tab」能力
```

### 3.3 可选：first-party「像插件一样可关」

允许表面形态为可开关模块（版本、权限文案、设置页），但 **数据面必须走 host Provider 注册表**，禁止仅靠普通 `launcher.dynamicItems` 成为一级桌面目标的唯一路径（可与 dynamicItems 并存作补充，但混排权威在 Target Registry）。

---

## 4. 核心模型

### 4.1 DesktopTarget

统一「可聚焦 / 可打开」的**一级导航**桌面目标（字段名实现时可微调，语义不变）。

> **类型共享、注册表分离：**  
> `meta.cpuPercent` / `memoryBytes` 与 `actionClass: 'terminate' | 'close'` 可出现在类型定义中供二级进程模式、次级动作映射复用，但 **`terminate` 目标不得进入一级 `DesktopTargetRegistry.list` 输出**。进程走 §7 独立会话；关窗口走 §5.5 次级动作路径，不是一级混排的默认 list 结果。

```ts
/** 展示与排序用的目标类型 */
type DesktopTargetKind =
  | 'app'       // 已安装应用
  | 'window'    // 系统可见窗口
  | 'tab'       // 浏览器/编辑器等「页」
  | 'document'  // 可选：打开的文档/工作区项
  // 预留，勿滥用

type DesktopTargetSourceId = string
// 约定示例：
//   'host.app'
//   'host.window'
//   'browser.chromium'  // Chrome / Edge / Brave… 配置化
//   'editor.vscode'
//   …

type DesktopTarget = {
  /**
   * 运行时列表 id（可含易变原生 id）。
   * 格式建议 `${sourceId}:${kind}:${nativeId}`。
   * **不要求**跨会话稳定；usage 键见 §5.6。
   */
  id: string
  sourceId: DesktopTargetSourceId
  kind: DesktopTargetKind

  /** 主标题（tab 标题 / 窗口标题 / App 名） */
  title: string
  /** 副标题（应用名、domain、路径等） */
  subtitle?: string
  /** 所属应用展示名，如 Chrome / Edge / Code */
  appName?: string
  /**
   * 跨会话尽量稳定的应用身份（macOS bundle id / 可执行稳定名）。
   * usage 聚合优先用此字段，而非原生 window/tab id。
   */
  appStableKey?: string

  /** 搜索关键词（不要求全展示） */
  keywords?: string[]

  /** 可选结构化元数据（勿放剪贴板全文） */
  meta?: {
    url?: string
    path?: string
    pid?: number
    windowId?: string
    profileId?: string
    faviconKey?: string
    /** 仅进程二级列表使用；一级 Provider list 不得依赖这些字段做导航 */
    cpuPercent?: number
    memoryBytes?: number
  }

  /** 列表图标：host 图标 key / app icon ref / 扩展提供的 blob key */
  icon?: string

  /**
   * 主动作安全级别提示（执行策略由 host 统一解释）
   * 一级 list 默认只产出 focus | open。
   * close / terminate 见 §5.5 / §7，不得作为一级 list 的默认项。
   */
  actionClass?: 'focus' | 'open' | 'close' | 'terminate'

  /**
   * 该目标支持的次级动作（host 可据此生成额外 LauncherItem 或 result choices）。
   * 例：窗口 focus 目标可声明 secondaryActions: ['close']。
   */
  secondaryActions?: Array<'close'>
}
```

### 4.2 DesktopTargetProvider

```ts
type DesktopTargetQueryContext = {
  /** 用户当前输入；已 trim；空字符串表示空搜场景 */
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
  /**
   * 可选 content detections。
   * **用途仅限性能短路**（见 list() 约束）：例如强文本 intent 时 provider 可少列/不列，
   * 以省 I/O。**产品级「让位/抬分」不得在 provider 内分叉**——统一由 host ranking 做。
   */
  detections?: Array<{ kind: string; confidence: number }>
  /** 查询取消（query 变更 / 关闭 Launcher）；provider 应尊重 abort */
  signal?: AbortSignal
}

/** 选中后的激活上下文；不要复用 QueryContext（query/detections 对激活无意义） */
type DesktopTargetActivateContext = {
  locale: Locale
  surfaceId: LauncherSurfaceId
  signal?: AbortSignal
}

type DesktopTargetProvider = {
  id: DesktopTargetSourceId
  /** 展示名（设置页 / 调试） */
  title: string
  titleI18n?: Partial<Record<Locale, string>>

  /**
   * 源级轻量加分（可选）。语义 **已钉死**（见下），禁止「说不清的 tie-break」。
   * 缺省 = 0。
   */
  priority?: number

  /**
   * 同步或异步列出候选。Host 负责超时与失败隔离。
   * 应在 provider 内做粗过滤；host 再统一 rank。
   * 一级 registry 的 list **只应**返回 actionClass 为 focus/open（或默认 focus）的导航目标。
   *
   * **detections 用途限制：** 仅允许作 **性能短路**（例如强文本 intent 时本源少列/空列，
   * 少打原生/扩展 I/O）。**禁止** 在 provider 内各自发明「让位/抬分」产品策略——
   * 强文本 intent 让位由 **host ranking 统一**执行（§3.1、§5.2）。若 provider 因短路
   * 返回空数组，不得被解释为「该源永久禁用」。
   */
  list(ctx: DesktopTargetQueryContext): Promise<DesktopTarget[]> | DesktopTarget[]

  /**
   * 执行主动作（聚焦/打开）。
   * 危险动作（close/terminate）不走此默认路径，见 §5.5 / §7。
   */
  activate?(target: DesktopTarget, ctx: DesktopTargetActivateContext): Promise<void>

  /** 健康检查：扩展是否连接、权限是否足够；失败则本轮 list 跳过 */
  health?(): Promise<{ ok: boolean; reason?: string }>
}
```

#### `priority` 语义（已钉死）

| 项 | 规定 |
|----|------|
| 含义 | 该 provider 产出的 **每一条** 一级导航 item 在 ranking 中增加同一常数 `providerPriorityBoost` |
| 映射 | `providerPriorityBoost = clamp(provider.priority ?? 0, 0, PROVIDER_PRIORITY_CAP)` |
| 量级 | **`PROVIDER_PRIORITY_CAP = 50`**（≤ usage 上沿量级，远小于 contextBoost 400 / 精确匹配 3000+） |
| 不用作 | 不单独做 sort comparator 的 tie-break 字段；不参与 provider 调度顺序的「必须」语义（调度可仍按注册序 + 并行） |
| 缺省 | `undefined` / 0 → 不加分 |
| 删除条件 | 若全仓 priority 皆 0，允许删字段；在有值前必须按本表实现，禁止「神秘 tie-break」 |

### 4.3 Host 注册表职责（含渐进渲染）

**不得**退化现有 `collectDynamicItems` 的 progressive 体验。现状证据：`src/workspace/launcher/registry.ts` 的 `onPartial`（约 L298–318）支持快源先画、慢源后到，并传递 `AbortSignal`。

```text
registerDesktopTargetProvider(provider)
unregisterDesktopTargetProvider(id)

// 契约：支持 partial；批式 API 仅作测试便利封装
collectDesktopTargets(ctx, options?: {
  signal?: AbortSignal
  onPartial?: (update: {
    sourceId: DesktopTargetSourceId
    targets: DesktopTarget[]
    /** 该源是否已终态（完成/失败/超时） */
    done: boolean
  }) => void
}): Promise<DesktopTarget[]>

实现要点：
  for each provider (enabled + health ok) in parallel:
    run list(ctx with signal) with soft timeout + catch
    on resolve/reject/timeout:
      onPartial({ sourceId, targets or [], done: true })
  任意时刻 session 可将「已到达源的并集」经 dedupe → map → rank 后渲染
  全部 done 后 resolve 最终并集（供测试与非 UI 调用方）
```

**Partial 下去重与重排规则：**

| 规则 | 说明 |
|------|------|
| 并集 | 后到源的新 `target.id` **追加**进候选池，不清空已渲染源的结果 |
| 同 id | 后到结果若与已有 `target.id` 冲突，**后写覆盖**元数据（标题可能刷新），不双份 |
| 重排 | 每来一个 partial（或 debounce 一帧）对**当前并集**重新 `rankLauncherItems`；允许名次变化（快源暂居前列、慢源 tab 到达后插入是预期） |
| 取消 | `signal` abort 后停止调度未开始的 provider；已 in-flight 的结果可丢弃 |
| 限条 | 每源上限 + 全局上限在 **每次 partial 合并后**裁剪（先 per-source，再 global），避免慢源把列表撑爆 |

**硬规则：**

1. 单 provider 超时/抛错 → 该源 `targets: []` + `done: true`，其它继续。  
2. 全局限条 + 每源限条，防止刷屏。  
3. 生产日志不打 tab URL/标题全文（或 debug 开关才打）。  
4. 禁止新来源绕过注册表直接改 `rankLauncherItems` 私有常量。  
5. **D0 必须实现 partial 契约**；禁止先批式落地、D3 再返工。  
6. 注册表 API **不**导出到插件 SDK（一期仅 first-party 注册）。  
7. **表面隔离（协议要求，非巧合）：** 桌面导航 target 映射的 `LauncherItem.surfaces` **必须** 仅含 `global-launcher`（除非未来显式设计编辑器内桌面目标）。  
   - 现状：`windows.ts` / `processes.ts` 已写 `surfaces: ['global-launcher']`，且 `isEditorCommandBarItem` 对 host key 白名单天然排除 `host:window:*`。  
   - D0 `toLauncherItem` **必须** 强制该 surfaces 约束并加契约测试，防止回归漏进编辑器 Cmd+K。---

## 5. 混排与列表融合

### 5.1 展示形态

```text
[图标] Google Chrome              应用
[图标] Chrome · 工作台            窗口
[图标] 设计稿 - Figma             标签    Chrome
[图标] 飞书文档 · 需求评审         标签    Edge
[图标] JWT 解码                   命令    来自剪贴板
```

- 主标题优先「用户记得住的名字」：tab 标题 > 窗口标题 > App 名  
- 行样式与 **`doc/2026-07-19-launcher-interaction-redesign-demo.html`** 对齐（type 标签 pill + 主副标题层级）；实现时以设计文档 + demo 共同为准，冲突先改文档/demo 再改代码  

#### kindLabel 与 i18n（D1 必做）

**现状缺口：** `LauncherItemDisplay.kindLabel?: string` 为裸字符串，**无** `kindLabelI18n`（同类型的 `title`/`subtitle` 已有 I18n 变体）。`LauncherMixedList.tsx` 直接渲染 `kindLabel`。

**裁决（二选一实现，D1 完成定义绑定）：**

| 方案 | 做法 | 推荐 |
|------|------|------|
| **A. 扩展类型（推荐）** | `LauncherItemDisplay` 增加 `kindLabelI18n?: Partial<Record<Locale, string>>`；列表渲染走与 title 相同的 `resolveDisplay*` 管线 | ✅ |
| **B. Host 派生** | `toLauncherItem` **禁止**写死中文/英文 kindLabel 字符串；只写稳定 `kind` 枚举，由 host/UI 按 `locale` 查表生成标签 | 可接受 |

无论 A/B：

- 标签文案 key 建议：`desktop.kind.app` / `.window` / `.tab` / `.document`（中英：应用/窗口/标签/文档）  
- **禁止** 在 provider 内 hardcode 用户可见 kind 文案  
- 契约测试：locale=zh 与 en 下 kind 标签不同且非空  

**说明：** type 标签 **不是新造 UI 组件**——现有 `display.kindLabel` + `LauncherMixedList` 已承载；D1 增量是 **i18n 正确性与桌面 kind 全覆盖**，不是重做列表。

### 5.2 排序原则（与路线图 §6 一致，桌面侧补充）

```text
score =
  matchScore          // 标题/keywords/aliases
  + intentScore       // 文本 content/alias intent（导航目标通常为 0）
  + contextBoost      // 前台 app 等
  + usageScore
  + textMatchBoost    // 文本工具
  + dynamicBoost
  + hostStatic / installFreshness
  + desktopAffinity   // 可选：已打开窗口/标签轻量加分（上限要控）
```

**保证：**

| 场景 | 行为 |
|------|------|
| 明确输入 App/命令名 | 名称匹配赢 |
| 搜「chrome」 | App + 相关窗口 + 相关标签可共存混排 |
| 强文本 content（JWT/JSON… conf 高） | **导航类 target 让位**（App/窗口/标签同类降权），文本动作优先 |
| 空 query | 少量最近 App + 窗口上限维持 **8**（见下「最近」数据源）；**标签空搜默认 0 条**（D3 后再放开 2–3） |
| 普通中文空搜 | 不乱推编解码；也不应被上百 tab 淹没 |

`desktopAffinity`（若做）建议 ≤ 200 量级，落在路线图 §6 的 usage(≤~100) 与 contextBoost(≤400) 之间，避免压过精确命令匹配（~3000+）。  
`provider.priority` 加分见 §4.2（cap 50），与 affinity **分开**，两者之和仍应 ≪ 精确匹配。

**强文本 intent 让位：** 仅在 **host `ranking.ts`**（或等价单一模块）实现；providers 不得复制让位表。`detections` 下发仅用于 §4.2 性能短路。

#### 「最近」数据来源（D1 前必须落地其一）

现状窗口列表多为原生返回顺序，**没有 MRU**。空搜「最近窗口」不得假装有历史。

| 策略 | 说明 | 采用 |
|------|------|------|
| A. z-order 近似 | 原生 list 顺序常近似前后台叠放，取前 N | **D1 默认**：文档与实现均称为「可见窗口（靠前）」而非「最近使用」 |
| B. host 聚焦历史 | 每次成功 focus/open 写入本地 ring（appStableKey + 粗粒度 target 类型），空搜按历史排 | **D1+ 增强**（推荐很快补上，usage 也可复用） |
| C. 系统正式 MRU API | 若平台后续提供 | 可选替换 |

文案：空搜窗口副标题/注释避免写死「最近」除非已实现 B。

### 5.3 去重（两层 key 必须对齐）

Launcher 最终列表去重以 **`LauncherItem.systemKey`** 为准（现有 ranking/列表路径）。  
Registry 层按 **`target.id`** 去重。两层必须一致，否则 registry 去重完、ranking 再按另一套 key 合并会漏去重或误伤。

**硬约束（`toLauncherItem.ts`）：**

```text
// 列表身份（去重 + React key + 选中）
listSystemKey = target.id
// 必须：LauncherItem.systemKey 对于「列表行身份」=== target.id
// 例外见 §5.6：usage 聚合 key 可与 list 身份分离
```

| 概念 | 字段 | 规则 |
|------|------|------|
| **列表去重 key** | `target.id` → `item.systemKey` | **必须相等**（确定性派生：identity，或 `target.id` 本身） |
| **usage 聚合 key** | §5.6 的 usage 维度 | 可与 list key **不同**；通过 `legacyUsageKeys` **或** 单独 `usageKey` 字段写入 usage，**不得**为了 usage 去改 list 的 systemKey 导致窗口实例被错误合并成一行 |
| 推荐实现 | `systemKey = target.id`；`usageRecordKeys = [stableUsageKey]`（若 API 尚无独立字段，用 `legacyUsageKeys` 只读 usage、选中仍用 systemKey） | D0 定稿一种并写测试 |

若现有 `legacyUsageKeys` 语义是「额外 usage 查找键」而非「替代 systemKey」，则：

- `systemKey = target.id`（每行唯一，列表不去重掉多个 Chrome 窗口）  
- usage 写入/读取使用 `appStableKey` 派生的稳定键（§5.6）  

**冲突策略（在 list key 对齐前提下）：**

| 冲突 | 策略 |
|------|------|
| 同一 `target.id` | 保留一条（partial 后写覆盖，见 §4.3） |
| 同一浏览器窗口 vs 其下 tab | **都可保留**（id 不同） |
| 同一 URL 多个 tab | 都保留或按活跃 tab 限 N |
| App 项 vs 仅窗口 | 都可保留 |

### 5.4 与现有 App / 窗口实现的关系

| 现状 | 迁移方向 |
|------|----------|
| `hostAppLauncher` 动态项 | 适配为 `sourceId: 'host.app'` 的 Provider（或内部先 map 到 DesktopTarget 再转 LauncherItem） |
| `desktopControl/windows.ts` | 适配为 `sourceId: 'host.window'`；close 路径见 §5.5 |
| `desktopControl/processes.ts` | **不**进入一级 DesktopTarget 混排；见 §7。**D2 必修**现网缺陷：任意非空 query 都会混出 terminate 项（不要求 kill 前缀） |
| `hostProvider` 并行 Promise.all 拼数组 | 收到 `collectDesktopTargets`（**保留 onPartial**，对齐 `registry.collectDynamicItems`） |

一期允许「逻辑等价、结构渐进」：先引入类型与注册表，再把 app/window 迁入，避免大爆炸重构。**禁止**为迁入而丢掉 progressive 渲染。

### 5.5 关窗口（close）产出路径（评审已定）

现状 `CLOSE_PREFIXES`（`windows.ts`）会产出 L2 关窗口项；新协议一级 `list()` 默认只返回 **focus** 目标。close 不得丢失，路径定为：

| 触发 | 行为 |
|------|------|
| **主路径（保留前缀）** | query 匹配 `关闭` / `关掉` / `close`（及后续 i18n 同义词）时，window provider 的 **list 变体**或 host 包装层将匹配窗口映射为 `actionClass: 'close'` 的 **独立 LauncherItem**（`systemKey` 见 §5.6），execute → L2 确认 choices → 再 close |
| **次级动作（可选增强）** | focus 目标可带 `secondaryActions: ['close']`；UI 在选中后提供次要操作（若 Global Launcher 尚无稳定 secondary UX，则 **D1 可不做**，仅前缀路径） |
| **禁止** | 把 close 项与 focus 项共用同一 `systemKey`；禁止 close 因高 conf 跳过 L2 |

D1 完成定义必须包含：前缀触发的关窗口仍可用，且必经 L2。

### 5.6 Usage 记录与 `systemKey` 规范（D0/D2 必修现存坑）

**问题：** 窗口 id、tab id、pid **跨会话不稳定**。现状 `host:window:focus:${win.id}`、`host:process:terminate:${pid}` 且 `recordUsage: true`，会污染 `launcherUsageBySurface`。

**映射规范（`toLauncherItem` 必须遵守）：**

| kind / 动作 | `recordUsage` | **列表** `systemKey`（= target.id） | **usage 写入键**（可 ≠ systemKey） |
|-------------|---------------|-------------------------------------|-------------------------------------|
| `app` + open | **true** | 现有 appId 键（稳定，可与 usage 相同） | 同左 |
| `window` + focus | **true** | 含原生 window id 的唯一 id | `host:window:focus:app:${appStableKey}` |
| `window` + close | **false** | 唯一 close id（≠ focus id） | 不写 usage |
| `tab` + focus | **true** | 含 tab id 的唯一 id | `host:tab:focus:app:${appStableKey}`（或 + origin） |
| `terminate` 进程 | **false** | 任意列表身份 | 禁止写 usage |
| 文本 pipeline 等 | 按现有策略 | 稳定 pipeline id | 同左 |

**列表身份 vs usage（与 §5.3 对齐，修正 v1.1 歧义）：**

| 字段 | 窗口 focus 示例 | 说明 |
|------|-----------------|------|
| `target.id` / `item.systemKey` | `host.window:focus:native:0x12ab` | **每行唯一**；列表去重用此 key |
| usage 写入 key | `host:window:focus:app:com.google.Chrome` | 稳定聚合；**多个窗口行可写同一 usage 桶** |
| 实现手段 | `systemKey = target.id`；usage API 使用稳定键（`legacyUsageKeys` 或显式 `usageKeys`） | 禁止把 systemKey 直接改成 app 聚合键（会把多窗口合成一行） |

D0 引入 `toLauncherItem` 时一并修正 window focus 的 `recordUsage` + 稳定 usage 键；D2 修正 process `recordUsage: false` 并移出一级列表。

---

## 6. 浏览器标签（Chrome / Edge）

### 6.1 为什么需要扩展

系统窗口 API **不能** 稳定枚举标签页。可选路径：

| 方案 | 结论 |
|------|------|
| Chromium 扩展 + 本机桥 | **主路径** |
| 读 Session 文件 | 不实时、格式易变、隐私差 → 不做主路径 |
| 辅助功能扒 UI | 脆、慢 → 仅实验，不进默认 |

### 6.2 共享实现（降低扩展成本）

Chrome / Edge / 其它 Chromium：

- **一份** `browser.chromium` provider 实现  
- 差异仅：扩展分发渠道、浏览器显示名、可选 icon  
- 扩展使用标准 `tabs` / `windows` API；host 侧 `list_browser_tabs` / `focus_browser_tab`  

新增「又一个 Chromium 壳浏览器」→ 理想情况 **配置项**，而非新 provider 类。

### 6.3 行为

- **激活 tab：** L1，直接执行（聚焦浏览器窗口 + 选中 tab）  
- **扩展未连接：** health 失败 → 本源无结果；UI 可在设置页说明，Launcher 不报错刷屏  
- **无痕：** Chromium 扩展 **默认拿不到** 无痕窗口 tab（需用户在扩展详情页显式开启「在无痕模式下启用」）。平台默认即「不索引无痕」，**无需评审另裁**；设置页可一句话说明此平台行为  
- **空搜：** D3 上线时标签空搜默认 **0 条**；验证稳定后再放开 2–3（需聚焦历史或等价 MRU，见 §5.2）  
- **性能：** 缓存 + TTL（建议 1–3s 级）；list 侧按 query 预过滤；限制返回条数；慢源依赖 §4.3 partial，不得阻塞快源 App/窗口  

### 6.4 与 web-open 插件的分工

| 能力 | 归属 |
|------|------|
| 枚举已打开 tab 并聚焦 | Desktop Target / host |
| 用模板打开搜索/内部平台 URL | plugin `web-open` |
| 剪贴板是 URL 时「打开链接」 | 已有 content/dynamic 路径，保持插件或 host URL 项，**不是** tab provider 的职责 |

---

## 7. 进程：二级入口（与一级混排隔离）

进程结束是 L2 危险操作，**不应**与 App/窗口/标签一级混排。

### 7.0 现网缺陷（D2 优先级论据）

现状 `getHostProcessLauncherDynamicItems`（`processes.ts`）：**任意非空 query**（在 strip 前缀后非空）都会去 list 进程并生成 terminate 项，**不要求**用户先输入 `kill` / `杀`。

后果：普通搜 App/文件名时可能混出「结束进程」危险项——这是 **已上线产品缺陷**，不是锦上添花的形态修正。  
**D2 必须修复：** 仅进程模式（显式 kill 意图）才调用 process list；一级 `collectDesktopTargets` 永不包含 terminate。

### 7.1 交互

```text
1. 用户输入 kill / 杀 / 结束（可配置同义词）→ 进入进程模式
2. 展示进程行：名称、pid、CPU、内存等（采样刷新）；默认按 CPU 降序
3. 可继续键入过滤名称
4. 回车 → 确认框（名 + pid + 可选资源）→ SIGTERM（默认）
5. Esc → 退出进程模式，回到普通搜索
```

### 7.2 规则

- 普通空搜、普通 query：**不**列进程（修复 §7.0）  
- 仅输入 `kill` 而无过滤词：可列有限集合，**默认 CPU 降序** + 上限 N；可继续键入过滤  
- deny 表（kernel_task、launchd、WindowServer…）不可选或不可确认通过  
- 强杀非默认；审计只记动作类型与目标摘要  
- **`recordUsage: false`**（§5.6）  

### 7.3 实现位置

可保留在 host `desktopControl/processes`，语义是 **Process Session Mode**。  

- **类型**可与 `DesktopTarget` 共享字段（如 meta.cpuPercent），但  
- **注册表必须分离**：不进一级 `DesktopTargetRegistry.list`；可用 `processMode.ts` 或 `mode: 'process-manager'` 专用收集路径。  
- 防止实现者把 terminate 目标塞进一级 registry（与 §4.1 警告一致）。
---

## 8. 新软件接入成本模型

### 8.1 接入清单（固定）

新来源必须交付：

1. `DesktopTargetProvider` 实现（list + activate/health）  
2. 传输层说明：扩展 / socket / 系统 API / 官方 API  
3. 权限 key 与中英文文案  
4. 设置开关（若可选）  
5. 契约测试：超时隔离、断连降级、id 稳定、条数上限  
6. **禁止** 新增平行 Launcher 列表管道  

### 8.2 工作量预期

| 类型 | 预期 |
|------|------|
| 又一个 Chromium 浏览器 | 配置 / 分发，复用 `browser.chromium` |
| 新浏览器族（Safari/Firefox） | 新扩展 + 同一 Provider 接口 |
| VS Code / Cursor 编辑器页 | 新 provider + 编辑器扩展或 socket |
| 仅有窗口的 App | **零额外开发**（window provider 已覆盖） |
| 完全私有协议的 App | 新 adapter；Launcher 管道仍复用 |

### 8.3 准入门禁（评审用）

- [ ] 是否只实现 Provider，未复制 ranking？  
- [ ] 失败是否静默降级？  
- [ ] 是否声明 actionClass 与安全级别？  
- [ ] 是否有条数/超时预算？  
- [ ] 敏感字段是否避免进生产日志？  

---

## 9. 安全与权限

### 9.1 分级（沿用路线图）

| 级别 | 例 | 策略 |
|------|-----|------|
| L0 | 搜索、预览列表 | 默认可 |
| L1 | 开 App、聚焦窗口/标签、开 URL | 直接执行 |
| L2 | 关窗口、结束进程 | **必须确认** |
| L3 | 任意 shell、强杀关键系统进程 | 非默认入口 |

高 confidence **不**跳过 L2。

### 9.2 Capability / Permission（与现码对齐）

**裁决：沿用现有连字符风格**，与 `LauncherHostCapability`（`types.ts`）一致，**禁止**再引入点分隔的平行命名。

| Key | 用途 | 现状 |
|-----|------|------|
| `desktop-windows` | 窗口枚举与聚焦 | **已有** `LauncherHostCapability` |
| `desktop-processes` | 进程模式 | **已有** |
| `desktop-browser-tabs` | 浏览器标签枚举与聚焦（扩展桥） | **D3 新增**（同风格） |

- **YAGNI：** 不发明统一的 `desktop-tabs` / `desktop.tabs`，直到出现第二个 tab 源（如 VS Code）再评估合并。  
- PluginPermission 文案层若需字符串，与 capability **同形**（连字符），避免 `desktop.windows` vs `desktop-windows` 双轨。  
- 一期仅 first-party：注册表不进插件 SDK ⇒ 第三方自然无法注册 Provider。
### 9.3 隐私

- Tab 标题/URL 仅本机使用，默认不上传  
- 审计（L2）只记动作类型与目标摘要（名/pid），不记剪贴板正文  
- 设置中说明扩展能读到的数据范围  

---

## 10. 架构落点（建议路径，实现可微调）

```text
src/workspace/desktopTargets/
  types.ts           # DesktopTarget, Provider, QueryContext, ActivateContext
  registry.ts        # register / collectDesktopTargets(onPartial, signal) / timeout / limits
  toLauncherItem.ts  # Target → LauncherItem（含 §5.6 usage/systemKey 规范）
  providers/
    app.ts           # 包装现有 app launcher
    window.ts        # focus list + close 前缀路径（§5.5）
    chromiumTabs.ts  # 扩展桥（D3）
  processMode.ts     # kill 二级模式（独立收集，不进一级 registry）
  focusHistory.ts    # 可选：聚焦历史 ring（空搜「最近」增强）

src-tauri/…          # list/focus tabs 桥；窗口/进程已有则复用

src/workspace/launcher/
  hostProvider.ts    # collectDesktopTargets(partial) + processMode 分支
  registry.ts        # 保持与 dynamicItems onPartial 模式一致
  ranking.ts         # 导航让位、可选 desktopAffinity
  types.ts           # capability 仅连字符：desktop-windows | desktop-processes | desktop-browser-tabs
```

插件目录 **不** 出现「只为混排服务的 chrome-tabs 业务插件」作为唯一实现；扩展与桥在 host/native。

---

## 11. 分期

顺序固定：**D0 → D1 → D2 → D3 → D4**（不得为赶标签跳过 D0 partial / D2 缺陷修复）。

| 期 | 交付 | 完成定义 |
|----|------|----------|
| **D0 协议** | types + registry（**含 onPartial + signal**）+ 超时/限条；`toLauncherItem`（**systemKey≡target.id**、usage 键分离、**surfaces 仅 global-launcher**）；app/window 适配迁入；priority cap 实现 | 假 provider partial 先于慢源；坏 provider 隔离；契约：editor-command-bar **无** host:window；usage 不按瞬时 window id 污染 |
| **D1 窗口混排产品化** | 见下方 **D1 可检验 delta**（**不可**用「已能搜到窗口」冒充完成） | 下列验收项 **全部** 通过 |
| **D2 进程二级模式** | 显式 kill 模式；CPU 降序 + 过滤；L2 确认；**移出一级列表**；`recordUsage: false` | **任意普通 query 不再出现 terminate**（修 §7.0）；仅 kill 模式可见进程 |
| **D3 Chromium 标签** | 扩展 + 本机桥 + `browser.chromium`；capability `desktop-browser-tabs`；空搜 tab=0 | ✅ 已交付：本机桥 + **first-party 插件 `browser-tabs`**（设置内安装引导）经 `desktopTargets.registerProvider` 注册；无扩展静默 |
| **D4 更多来源** | VS Code 等按接入清单 | ✅ 已交付：`editor.vscode` + `extensions/hiven-vscode-bridge`；registry 核心不动 |

#### D1 可检验 delta（相对 **今日骨架**，二刷指出的验收失效问题）

> **背景：** 现状 `windows.ts` 在普通 search 模式（无「切到」前缀）已返回窗口 focus 项，空搜最多 8 条。  
> 因此「搜应用名能看到窗口 / 不必记前缀」**今天即可零改动满足**，**不得**再作为 D1 完成定义。

D1 **真实增量**（验收必须覆盖）：

| # | Delta | 验收方式 |
|---|--------|----------|
| D1.1 | **kindLabel i18n** | §5.1 A 或 B 落地；zh/en 标签不同；窗口/App 均有 kind pill |
| D1.2 | **强文本 intent 让位覆盖窗口（不仅 App）** | jwt/json 等高 conf detections 下，**窗口与 App** 分数均低于对应文本工具（扩展现有 `STRONG_TEXT_INTENT_APP_PENALTY` 或统一 `desktop navigation penalty`） |
| D1.3 | **ranking 常量集中对齐路线图 §6** | `desktopAffinity`（若启用）≤200；`PROVIDER_PRIORITY_CAP=50`；与 INTENT/CONTEXT 同表可测 |
| D1.4 | **空搜策略诚实化** | 窗口仍 ≤8；文案/注释不称「最近」除非已有聚焦历史；可选收紧与 App 的配比（文档化数字） |
| D1.5 | **close 前缀 + L2**（§5.5） | `关闭 xxx` 仍可用；确认前不关；与 focus 不同 systemKey |
| D1.6 | **与 demo 行样式一致** | 对照 `launcher-interaction-redesign-demo.html` 的 type 标签层级（允许视觉 token 微调，信息架构一致） |

**非 D1 范围（已存在或属其他期）：** 无前缀搜出窗口（已有）；进程二级（D2）；tab（D3）。

与路线图包③–⑤：现有是 **骨架**；本设计是 **可扩展收口 + 产品形态修正 + 缺陷修复**（D2 含现网危险混排）。
---

## 12. 测试策略

| 层 | 覆盖 |
|----|------|
| 单测 | registry 超时隔离；**partial 顺序**；限条；去重后写覆盖；`systemKey === target.id`；usage 稳定键；**priority 加分 ≤50** |
| 契约 | 未启用/health 失败源无输出；**普通 query 一级 collect 无 terminate**；close 前缀产出 L2；**editor-command-bar 无 desktop target**；kindLabel zh≠en |

| 排序 | 强 jwt detection 下导航 target 分低于文本工具；精确 App 名仍可赢 |
| 集成/手工 | macOS：混排搜 Chrome；kill 模式 CPU 序；扩展断连降级；关窗口确认 |
| 架构 | `check:architecture`；注册表不进插件 SDK |

---

## 13. 风险

| 风险 | 缓解 |
|------|------|
| 扩展安装率低 | 未安装时窗口仍可用；设置引导 |
| Tab 数量大拖慢输入 | TTL、限条、query 预过滤；**partial 契约强制**，禁止批式退化 |
| D0 批式返工 | §4.3 完成定义绑定 partial |
| Provider 各自为政再分裂 | 准入清单 + 代码评审门禁 |
| usage 污染 | §5.6；D0/D2 必修 |
| 隐私顾虑 | 权限说明、平台默认无痕不可见、日志脱敏 |
| 与 web-open 概念混淆 | 文档与 UI 文案区分「已打开标签」vs「打开链接」 |
| 普通 query 混出杀进程 | D2 必修 §7.0 |

---

## 14. 决策记录

| # | 决策 | 状态 |
|---|------|------|
| 1 | 窗口与 App **一级混排**，心智对齐「开应用」 | 已确认 |
| 2 | 浏览器/同类标签进入 **同一混排**，不单独「标签模式」 | 已确认 |
| 3 | 新来源通过 **DesktopTargetProvider** 扩展，禁止平行管道 | 已确认 |
| 4 | Chromium 族 **共享** provider，配置化多浏览器 | 已确认 |
| 5 | Tab 主路径 = **扩展 + host 桥**，非读 Session 文件 | 已确认 |
| 6 | 导航目标属 **host**；文本/站点模板属 **plugin** | 已确认 |
| 7 | 杀进程 = **二级模式** + 资源信息 + L2 确认 | 已确认 |
| 8 | 关窗口等 L2 不因高 conf 跳过确认 | 已确认 |
| 9 | 聚合契约 **必须 partial**（对齐现有 dynamicItems），禁止 D0 批式退化 | v1.1 评审补入 |
| 10 | usage：窗口/tab **按 appStableKey 聚合**；进程/关窗默认不记 usage | v1.1 评审补入 |
| 11 | 关窗口：一级 list 默认 focus；**前缀触发 close 项 + L2**（§5.5） | v1.1 评审补入 |
| 12 | Capability **连字符**：`desktop-windows` / `desktop-processes` / `desktop-browser-tabs` | v1.1 评审补入 |
| 13 | 一期仅 first-party（注册表不进插件 SDK） | v1.1 关闭 §15 |
| 14 | 空搜标签 0；窗口上限 8；D0→D1→D2 先于 D3 | v1.1 关闭 §15 |
| 15 | D1 完成定义 = 可检验 delta（i18n kind、导航让位、常量、close、demo），非「能搜到窗口」 | v1.2 二刷 |
| 16 | detections 仅性能短路；让位只在 host ranking | v1.2 |
| 17 | `priority` = 源级 ≤50 统一加分，非神秘 tie-break | v1.2 |
| 18 | 列表 `systemKey ≡ target.id`；usage 键可分离 | v1.2 |
| 19 | `surfaces: ['global-launcher']` 为协议强制 + 测试 | v1.2 |

---

## 15. 原开放问题 — 已关闭

| # | 问题 | 裁决 |
|---|------|------|
| 1 | 空搜最近标签条数 | **0 条起步**；D3 验证后再考虑 2–3。窗口空搜上限 **维持 8**（z-order 近似，不称 MRU 除非有聚焦历史） |
| 2 | 权限粒度 | 独立 **`desktop-browser-tabs`（连字符）**；不做 `desktop-tabs` 合并（YAGNI） |
| 3 | 第三方 Provider | **一期仅 first-party**；注册表 API 不导出插件 SDK |
| 4 | 进程排序 | **CPU 降序 + 键入过滤** |
| 5 | 关闭标签 | **一期只 focus**；关 tab 不做 |
| 6 | 分期顺序 | **D0→D1→D2→D3**；D2 含修现网「任意 query 混出 terminate」缺陷，优先级硬 |

---

## 16. 评审关注清单（v1.2 自检）

### 一轮（维持）

- [x] host/plugin 边界；partial；close；usage；capability 连字符；§15 关闭；D2 缺陷  

### 二刷新增

- [x] D1 完成定义改为可检验 delta（非现状已满足项）  
- [x] kindLabel i18n 落点（扩类型或 host 派生）  
- [x] detections 仅短路 vs ranking 让位  
- [x] priority 量级与计分方式  
- [x] target.id ↔ systemKey 去重对齐  
- [x] surfaces 协议化 + 与 `isEditorCommandBarItem` 关系写明  
- [x] 与路线图 §6 / architecture 脚本 / demo 交叉核对  

**开工前抽查：** §4.2 priority+detections、§4.3 surfaces、§5.1 kindLabel、§5.3 双层 key、§11 D1 delta 表。

---

## 17. 下一步

1. ~~§15 开放问题~~ / ~~二刷实质问题~~ 已并入 v1.2。  
2. **可拆实施计划并开工**（D0→D1→D2→D3）。  
3. D0 任务必须含：partial 契约、systemKey≡id、usage 键分离、surfaces 仅 global-launcher、process 不得进一级（可先 gate 再 D2 完整模式）。  
4. D1 任务必须含：kindLabel i18n、窗口纳入强文本让位、close L2、demo 对齐。  
5. 扩展桥另文（D3 前）。  
6. 独立分支/worktree 实现。

---

## 18. 修订历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初稿草案 |
| v1.1 | partial、usage/close、capability 连字符、§15 关闭、D2 现网缺陷 |
| v1.2 | D1 delta 重写；kindLabel i18n；detections 短路；priority≤50；双层去重 key；surfaces 协议；demo/架构交叉引用 |
