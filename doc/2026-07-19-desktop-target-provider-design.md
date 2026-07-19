# 桌面目标可扩展协议（Desktop Target Provider）设计

**日期:** 2026-07-19  
**状态:** 评审修订稿（v1.1）— 已吸收外部评审实质意见，§15 开放问题已关闭  
**产品:** hiven（原 FluxText）  
**读者:** 实现 AI / 评审 / 后续维护者  
**关联:**

- `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（控制中枢总路线；包③–⑤ 已有窗口/进程骨架）
- `docs/superpowers/specs/2026-07-19-control-hub-intent-design.md`（已被路线图吸收）
- `doc/diff-plugin-boundary-decision.md`、`Agents.md`（host / plugin / kit 边界）
- 现状实现参考：`src/workspace/appLauncher/`、`src/workspace/desktopControl/`、`src/workspace/launcher/hostProvider.ts`、`src/workspace/launcher/registry.ts`（`onPartial`）、`src/workspace/launcher/types.ts`（`LauncherHostCapability`）

**修订摘要（v1.1）：** 聚合契约补 partial；usage/systemKey 规范；关窗口产出路径；权限 key 与现有连字符对齐；关闭 §15；写明 D2 修复「任意 query 混出 terminate」的现网缺陷。

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
  /** 可选：content detections，用于「强文本 intent 时导航目标让位」 */
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

  /** 默认优先级：同 query 下 provider 间微调（最终仍以 item score 为准） */
  priority?: number

  /**
   * 同步或异步列出候选。Host 负责超时与失败隔离。
   * 应在 provider 内做粗过滤；host 再统一 rank。
   * 一级 registry 的 list **只应**返回 actionClass 为 focus/open（或默认 focus）的导航目标。
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
---

## 5. 混排与列表融合

### 5.1 展示形态

```text
[图标] Google Chrome              应用
[图标] Chrome · 工作台            窗口
[图标] 设计稿 - Figma             标签    Chrome
[图标] 飞书文档 · 需求评审         标签    Edge
[图标] JWT 解码                   命令    来自剪贴板
```

- type / kindLabel 必须可 i18n（应用 / 窗口 / 标签 / 命令…）  
- 主标题优先「用户记得住的名字」：tab 标题 > 窗口标题 > App 名  

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

`desktopAffinity`（若做）建议 ≤ 200 量级，避免「永远打开着的 Chrome」压过精确命令匹配。

#### 「最近」数据来源（D1 前必须落地其一）

现状窗口列表多为原生返回顺序，**没有 MRU**。空搜「最近窗口」不得假装有历史。

| 策略 | 说明 | 采用 |
|------|------|------|
| A. z-order 近似 | 原生 list 顺序常近似前后台叠放，取前 N | **D1 默认**：文档与实现均称为「可见窗口（靠前）」而非「最近使用」 |
| B. host 聚焦历史 | 每次成功 focus/open 写入本地 ring（appStableKey + 粗粒度 target 类型），空搜按历史排 | **D1+ 增强**（推荐很快补上，usage 也可复用） |
| C. 系统正式 MRU API | 若平台后续提供 | 可选替换 |

文案：空搜窗口副标题/注释避免写死「最近」除非已实现 B。

### 5.3 去重

| 冲突 | 策略 |
|------|------|
| 同一 `target.id` | 保留一条（partial 场景后写覆盖，见 §4.3） |
| 同一浏览器窗口 vs 其下 tab | **都可保留**：窗口 = 整窗聚焦；tab = 精确页。展示上 kind 不同 |
| 同一 URL 多个 tab | 都保留或按「活跃 tab 优先」保留 N 条（实现可选，需可测） |
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

| kind / 动作 | `recordUsage` | `systemKey`（usage 维度） | 说明 |
|-------------|---------------|---------------------------|------|
| `app` + open | **true** | 现有 `host:app-launcher:app:${appId}` | appId 已相对稳定 |
| `window` + focus | **true** | `host:window:focus:app:${appStableKey}` | **按应用聚合**，不按瞬时 window id |
| `window` + close | **false** | `host:window:close:ephemeral:${windowId}` | 危险/低频；不记 usage，或仅 journal 不参与 score |
| `tab` + focus | **true** | `host:tab:focus:app:${appStableKey}` 或 `…:origin:${origin}`（若有 URL） | 优先 app；有稳定 origin 时可更细，仍避免 tabId |
| `terminate` 进程 | **false** | 任意仅作列表身份 | **禁止** `recordUsage: true`；pid 不可作 usage key |
| 文本 pipeline 等 | 按现有 host 策略 | 稳定 pipeline id | 不变 |

**列表渲染 id** 仍可用含原生 id 的 `DesktopTarget.id` / LauncherItem 运行时 key，与 **usage systemKey** 分离：

- `LauncherItem.systemKey` = 上表 usage 维度（可重复出现多个「Chrome 窗口」行，但 usage 记到同一 app 桶——可接受；若需区分窗口实例，**仍不写 usage**）。  
- 可选：`legacyUsageKeys` 不用于桌面瞬时 id。

D0 引入 `toLauncherItem` 时一并修正 window focus；D2 修正 process `recordUsage: false` 并移出一级列表。

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
| **D0 协议** | types + registry（**含 onPartial + signal**）+ 超时/限条/失败隔离；`toLauncherItem` usage 规范；app/window 适配迁入 | 假 provider partial 可先于慢源渲染；坏 provider 不影响其它；window focus usage 不再按瞬时 window id |
| **D1 窗口混排产品化** | 与 App 同框；type 标签；空搜窗口上限 8（z-order 近似，文案诚实）；强文本让位；**close 前缀路径 + L2**（§5.5） | 搜应用名可见 App+窗口；关窗口仍可用且必确认；「切到」前缀可保留作 boost |
| **D2 进程二级模式** | 显式 kill 模式；CPU 降序 + 过滤；L2 确认；**移出一级列表**；`recordUsage: false` | **任意普通 query 不再出现 terminate**（修 §7.0）；仅 kill 模式可见进程 |
| **D3 Chromium 标签** | 扩展 + 本机桥 + `browser.chromium`；capability `desktop-browser-tabs`；空搜 tab=0 | 有扩展则 tab 进混排且 partial 不堵 App；无扩展静默 |
| **D4 更多来源** | VS Code 等按接入清单 | 仅 adapter；registry 核心不动 |

与路线图包③–⑤：现有是 **骨架**；本设计是 **可扩展收口 + 产品形态修正 + 缺陷修复**（D2 含现网危险混排）。
---

## 12. 测试策略

| 层 | 覆盖 |
|----|------|
| 单测 | registry 超时隔离；**partial 顺序**（快源先 onPartial）；限条；去重后写覆盖；Target→LauncherItem **usage key** |
| 契约 | 未启用/health 失败源无输出；**普通 query 一级 collect 无 terminate**；close 前缀产出 L2 |
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

## 16. 评审关注清单（v1.1 自检）

- [x] 与 `Agents.md` host/plugin 边界一致  
- [x] 不把 Chrome 产品语义塞进 framework 核心（chromium 为 host 子系统 / provider）  
- [x] partial + 超时/限条写入 §4.3 契约  
- [x] 进程二级与 Target 一级分离（§4.1 / §7 / D2 缺陷）  
- [x] Chromium 共享实现写清  
- [x] 渐进迁移 + 不丢 onPartial  
- [x] L1/L2/L3、close 路径、usage 规范闭环  
- [x] §15 已关闭  

若二次评审仅需抽查：**§4.3 partial、§5.5 close、§5.6 usage、§7.0 缺陷、§9.2 连字符 capability**。

---

## 17. 下一步

1. ~~关闭 §15~~（v1.1 已关闭）。  
2. 拆实施计划（D0→D1→D2→D3），任务含：partial 契约测试、usage key 修正、process 一级混出回归测试、close 前缀 L2。  
3. 扩展通信协议另文：`doc/…-browser-extension-bridge-design.md`（D3 前）。  
4. 实现落在独立分支/worktree，避免直接在 main 大改。

---

## 18. 修订历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初稿草案 |
| v1.1 | 吸收评审：partial 聚合、usage/systemKey、close 路径、capability 连字符、注释/ActivateContext/类型共享说明、无痕默认、最近数据源、关闭 §15、D2 现网缺陷论据 |
