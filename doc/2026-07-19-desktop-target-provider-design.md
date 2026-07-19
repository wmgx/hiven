# 桌面目标可扩展协议（Desktop Target Provider）设计

**日期:** 2026-07-19  
**状态:** 草案（待评审）  
**产品:** hiven（原 FluxText）  
**读者:** 实现 AI / 评审 / 后续维护者  
**关联:**

- `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（控制中枢总路线；包③–⑤ 已有窗口/进程骨架）
- `docs/superpowers/specs/2026-07-19-control-hub-intent-design.md`（已被路线图吸收）
- `doc/diff-plugin-boundary-decision.md`、`Agents.md`（host / plugin / kit 边界）
- 现状实现参考：`src/workspace/appLauncher/`、`src/workspace/desktopControl/`、`src/workspace/launcher/hostProvider.ts`

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

统一「可聚焦 / 可打开」的桌面目标（字段名实现时可微调，语义不变）：

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
  /** 全局稳定 id，跨刷新尽量稳定；格式建议 `${sourceId}:${nativeId}` */
  id: string
  sourceId: DesktopTargetSourceId
  kind: DesktopTargetKind

  /** 主标题（tab 标题 / 窗口标题 / App 名） */
  title: string
  /** 副标题（应用名、domain、路径等） */
  subtitle?: string
  /** 所属应用展示名，如 Chrome / Edge / Code */
  appName?: string

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
    // 进程二级列表专用，见 §7
    cpuPercent?: number
    memoryBytes?: number
  }

  /** 列表图标：host 图标 key / app icon ref / 扩展提供的 blob key */
  icon?: string

  /**
   * 安全级别提示（执行策略由 host 统一解释）
   * focus/open → L1；close window / terminate → L2
   */
  actionClass?: 'focus' | 'open' | 'close' | 'terminate'
}
```

### 4.2 DesktopTargetProvider

```ts
type DesktopTargetQueryContext = {
  query: string
  locale: Locale
  /** 已规范化；空表示空搜场景 */
  surfaceId: LauncherSurfaceId
  /** 可选：content detections，用于「强文本 intent 时导航目标让位」 */
  detections?: Array<{ kind: string; confidence: number }>
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
   */
  list(ctx: DesktopTargetQueryContext): Promise<DesktopTarget[]> | DesktopTarget[]

  /**
   * 执行主动作（聚焦/打开）。危险动作可走独立 API + L2 壳。
   * 若省略，host 可按 kind/source 分发到原生命令。
   */
  activate?(target: DesktopTarget, ctx: DesktopTargetQueryContext): Promise<void>

  /** 健康检查：扩展是否连接、权限是否足够；失败则本轮 list 跳过 */
  health?(): Promise<{ ok: boolean; reason?: string }>
}
```

### 4.3 Host 注册表职责

```text
registerDesktopTargetProvider(provider)
unregisterDesktopTargetProvider(id)

collectDesktopTargets(ctx):
  for each provider (enabled + health ok):
    run list with soft timeout + catch
    tag results with sourceId
  dedupe by policy (§5.3)
  map to LauncherItem
  return to ranking pipeline
```

**硬规则：**

1. 单 provider 超时/抛错 → 忽略该源，其它继续。  
2. 全局限条 + 每源限条，防止刷屏。  
3. 生产日志不打 tab URL/标题全文（或 debug 开关才打）。  
4. 禁止新来源绕过注册表直接改 `rankLauncherItems` 私有常量。

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
| 空 query | 少量最近 App + 少量最近窗口 + **更少**最近标签；不刷满顶 |
| 普通中文空搜 | 不乱推编解码；也不应被上百 tab 淹没 |

`desktopAffinity`（若做）建议 ≤ 200 量级，避免「永远打开着的 Chrome」压过精确命令匹配。

### 5.3 去重

| 冲突 | 策略 |
|------|------|
| 同一 `target.id` | 保留一条 |
| 同一浏览器窗口 vs 其下 tab | **都可保留**：窗口 = 整窗聚焦；tab = 精确页。展示上 kind 不同 |
| 同一 URL 多个 tab | 都保留或按「活跃 tab 优先」保留 N 条（实现可选，需可测） |
| App 项 vs 仅窗口 | 都可保留 |

### 5.4 与现有 App / 窗口实现的关系

| 现状 | 迁移方向 |
|------|----------|
| `hostAppLauncher` 动态项 | 适配为 `sourceId: 'host.app'` 的 Provider（或内部先 map 到 DesktopTarget 再转 LauncherItem） |
| `desktopControl/windows.ts` | 适配为 `sourceId: 'host.window'` |
| `desktopControl/processes.ts` | **不**进入一级 DesktopTarget 混排；见 §7 二级进程模式 |
| `hostProvider` 并行 Promise.all 拼数组 | 逐步收到 `collectDesktopTargets` 单一聚合点 |

一期允许「逻辑等价、结构渐进」：先引入类型与注册表，再把 app/window 迁入，避免大爆炸重构。

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
- **无痕/敏感：** 默认策略建议「不索引无痕」或可设置（评审可裁）  
- **性能：** 缓存 + TTL（建议 1–3s 级）；list 侧按 query 预过滤；限制返回条数  

### 6.4 与 web-open 插件的分工

| 能力 | 归属 |
|------|------|
| 枚举已打开 tab 并聚焦 | Desktop Target / host |
| 用模板打开搜索/内部平台 URL | plugin `web-open` |
| 剪贴板是 URL 时「打开链接」 | 已有 content/dynamic 路径，保持插件或 host URL 项，**不是** tab provider 的职责 |

---

## 7. 进程：二级入口（与一级混排隔离）

进程结束是 L2 危险操作，**不应**与 App/窗口/标签一级混排。

### 7.1 交互

```text
1. 用户输入 kill / 杀 / 结束（可配置同义词）
2. 进入「进程模式」子列表（同 Launcher 框内模式条，或等价 UX）
3. 展示进程行：名称、pid、CPU、内存等（采样刷新）
4. 可继续键入过滤名称
5. 回车 → 确认框（名 + pid + 可选资源）→ SIGTERM（默认）
6. Esc → 退出进程模式，回到普通搜索
```

### 7.2 规则

- 普通空搜、普通 query：**不**列进程  
- 仅输入 `kill` 而无过滤词：可列有限集合（建议按 CPU 降序，上限 N）  
- deny 表（kernel_task、launchd、WindowServer…）不可选或不可确认通过  
- 强杀非默认；审计只记动作类型与目标摘要  

### 7.3 实现位置

可保留在 host `desktopControl/processes`，但语义上是 **Process Session Mode**，不是 `DesktopTargetProvider` 的默认 list 源。  
若要用 Provider 抽象，应使用单独 registry 或 `mode: 'process-manager'`，避免污染一级导航。

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

### 9.2 Capability / Permission（建议）

| Key | 用途 |
|-----|------|
| `desktop.windows` | 窗口枚举与聚焦 |
| `desktop.processes` | 进程模式 |
| `desktop.browser-tabs` | 浏览器标签枚举与聚焦（扩展桥） |
| 未来 `desktop.editor-tabs` | 编辑器页（可合并为更粗的 `desktop.tabs` + source 细分，评审二选一） |

第三方若未来允许实现 Provider：默认 **不**授予 `desktop.browser-tabs`；需显式授权。

### 9.3 隐私

- Tab 标题/URL 仅本机使用，默认不上传  
- 审计（L2）只记动作类型与目标摘要（名/pid），不记剪贴板正文  
- 设置中说明扩展能读到的数据范围  

---

## 10. 架构落点（建议路径，实现可微调）

```text
src/workspace/desktopTargets/
  types.ts           # DesktopTarget, Provider, QueryContext
  registry.ts        # register / collect / timeout / limits
  toLauncherItem.ts  # Target → LauncherItem 映射
  providers/
    app.ts           # 包装现有 app launcher
    window.ts        # 包装现有 windows
    chromiumTabs.ts  # 扩展桥（后续）
  processMode.ts     # kill 二级模式（不进一级 collect）

src-tauri/…          # list/focus tabs 桥；窗口/进程已有则复用

src/workspace/launcher/
  hostProvider.ts    # 改为 collectDesktopTargets + processMode 分支
  ranking.ts         # 导航让位、可选 desktopAffinity
```

插件目录 **不** 出现「只为混排服务的 chrome-tabs 业务插件」作为唯一实现；扩展与桥在 host/native。

---

## 11. 分期

| 期 | 交付 | 完成定义 |
|----|------|----------|
| **D0 协议** | types + registry + 超时/限条/失败隔离；app/window 迁入或适配 | 假 provider 可出现在列表；坏 provider 不影响其它 |
| **D1 窗口混排产品化** | 窗口与 App 同框体验对齐（搜索自然、type 标签、空搜克制、强文本让位） | 搜应用名可同时见 App+窗口；无需记「切到」前缀也能用（前缀可保留作 boost） |
| **D2 进程二级模式** | `kill` 进入进程列表；CPU/内存采样；L2 确认 | 空搜无进程；仅 kill 模式可见；确认前不杀 |
| **D3 Chromium 标签** | 扩展 + 本机桥 + `browser.chromium` provider | 安装扩展后 tab 进混排；未安装无报错刷屏 |
| **D4 更多来源** | VS Code 等按接入清单添加 | 仅新增 adapter，不改 registry 核心 |

与路线图包③–⑤ 的关系：现有实现是 **骨架**；本设计是 **可扩展收口与产品形态修正**（尤其窗口一级化、进程二级化、标签协议化）。

---

## 12. 测试策略

| 层 | 覆盖 |
|----|------|
| 单测 | registry 超时隔离；限条；去重；Target→LauncherItem 映射 |
| 契约 | 未启用/health 失败源无输出；进程不出现在一级 collect |
| 排序 | 强 jwt detection 下导航 target 分低于文本工具；精确 App 名仍可赢 |
| 集成/手工 | macOS：混排搜 Chrome；kill 模式资源列；扩展断连降级 |
| 架构 | `check:architecture`；插件不 import desktopTargets 私有实现（若仅 public API 导出则走 public） |

---

## 13. 风险

| 风险 | 缓解 |
|------|------|
| 扩展安装率低 | 未安装时窗口仍可用；设置引导 |
| Tab 数量大拖慢输入 | TTL、限条、query 预过滤、异步 partial |
| Provider 各自为政再分裂 | 准入清单 + 代码评审门禁 |
| 隐私顾虑 | 权限说明、无痕策略、日志脱敏 |
| 与 web-open 概念混淆 | 文档与 UI 文案区分「已打开标签」vs「打开链接」 |

---

## 14. 决策记录（供评审确认）

| # | 决策 | 状态 |
|---|------|------|
| 1 | 窗口与 App **一级混排**，心智对齐「开应用」 | 已讨论同意 |
| 2 | 浏览器/同类标签进入 **同一混排**，不单独「标签模式」 | 已讨论同意 |
| 3 | 新来源通过 **DesktopTargetProvider** 扩展，禁止平行管道 | 本设计提出 |
| 4 | Chromium 族 **共享** provider，配置化多浏览器 | 本设计提出 |
| 5 | Tab 主路径 = **扩展 + host 桥**，非读 Session 文件 | 本设计提出 |
| 6 | 导航目标属 **host**；文本/站点模板属 **plugin** | 已讨论同意 |
| 7 | 杀进程 = **二级模式** + 资源信息 + L2 确认 | 已讨论同意 |
| 8 | 关窗口等 L2 不因高 conf 跳过确认 | 沿用路线图 |

---

## 15. 开放问题（请评审拍板）

1. **空搜最近标签条数：** 建议 0–3，与最近 App/窗口如何配比？  
2. **权限粒度：** `desktop.browser-tabs` 独立，还是统一 `desktop.tabs` + sourceId？  
3. **第三方 Provider：** 一期是否 **完全禁止**，仅 first-party？  
4. **进程模式排序默认：** CPU 降序 vs 名称 vs 「仅用户进程」？建议 CPU 降序 + 可键入过滤。  
5. **关闭标签：** 是否一期只做 focus，关闭 tab 留作 L2 二期？建议一期只 focus。  
6. **D0/D1 是否先于 D3：** 建议先 D0+D1+D2 修正现有骨架体验，再上扩展（D3）。

---

## 16. 评审关注清单（给 Claude / 人类）

- [ ] 与 `Agents.md` host/plugin 边界是否一致？  
- [ ] 是否会诱导 framework 膨胀进「Chrome 产品语义」？  
- [ ] Provider 超时/限条是否足以保护输入流畅？  
- [ ] 进程二级与 Target 一级分离是否足够硬（避免以后又混回去）？  
- [ ] Chromium 共享实现是否写清，避免 Edge 再 fork 一套？  
- [ ] 与现有 `desktopControl/*`、`hostAppLauncher` 迁移路径是否可渐进？  
- [ ] 安全 L1/L2/L3 与审计是否闭环？  
- [ ] 开放问题 §15 是否需在开工前全部关闭？  

---

## 17. 下一步

1. 评审本草案，关闭 §15 开放问题。  
2. 通过后拆实施计划（建议按 D0→D1→D2→D3）。  
3. 扩展通信协议（消息 schema、鉴权、端口）可另文：`doc/…-browser-extension-bridge-design.md`。  
4. 实现落在独立分支/worktree，避免直接在 main 大改。
