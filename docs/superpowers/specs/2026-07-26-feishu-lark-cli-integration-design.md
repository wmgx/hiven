# 飞书 / Lark 接入设计（包⑧ · 基于 lark-cli）

**日期:** 2026-07-26  
**状态:** 设计已确认（brainstorm 收口）  
**产品:** hiven  
**本轮范围:** 只出设计，不写实现代码  
**读者:** 实现 AI / 评审 / 后续维护者  

**关联文档:**

- `doc/2026-07-19-launcher-intelligence-roadmap-design.md`（包⑧ 飞书生态；此前 ⏸ 延期）
- `doc/2026-07-19-desktop-target-provider-design.md`（Desktop Target Provider 协议；浏览器 tab 先例）
- `docs/superpowers/specs/2026-07-19-control-hub-intent-design.md`（控制中枢 / L0–L3）
- `doc/diff-plugin-boundary-decision.md`、`Agents.md`（host / plugin / kit 边界）
- 外部：本机 `lark-cli`（Lark/Feishu CLI）及 `lark-cli skills read …` 域指南

**修订摘要：**

- v1：完整包⑧产品边界 + 基于 lark-cli 的插件架构；L1 文档混排 + L2 命令树；Raycast 对标全集、B0–B5 分期实现。

---

## 1. 背景与问题

### 1.1 路线图上下文

Launcher 智能路线图将「飞书生态」标为包⑧：日程 / 文档搜索 / 发消息等，需独立 OAuth、background 与合规设计，此前不进主分支。  
本机与 agent 侧已广泛使用 **lark-cli**（config / Device Flow OAuth / domain shortcuts / JSON 输出），重复在 hiven 内自建 OpenAPI 客户端与 token 生命周期成本高、风险大。

### 1.2 问题

- 用户希望在 Global Launcher 内完成「找飞书资源并打开 / 对飞书做事」，体验对标 Raycast 类飞书扩展。
- 若每域各自写 ranking、列表、鉴权，会分叉且违反 host/plugin 边界。
- 官方托管 App + 内嵌 OAuth 合规与运维成本高；用户粘贴 token 不适合正式产品。

### 1.3 已拍板决策

| # | 决策 | 选择 |
|---|------|------|
| D1 | 本轮产出 | **只设计，不实现** |
| D2 | 产品范围 | **包⑧ 完整生态**（文档 + 日程 + 消息等），实现分期 |
| D3 | 鉴权与 API | **委托 lark-cli**（不在 hiven 自管 token） |
| D4 | 调用形态 | **first-party 插件 + 受控 shell 调 CLI** |
| D5 | 能力目录 | **Raycast 对标全集** 一次定清，B0–B5 分批交付 |
| D6 | 打开 / 导航 | **Desktop Target 混排 + 系统 open URL**；完整能力仍走命令树 |

---

## 2. 目标与非目标

### 2.1 目标

1. **统一入口：** 在 Global Launcher（及 App 内命令入口语义一致处）使用飞书能力。  
2. **导航优先：** 文档等可打开目标进入 **一级 Desktop Target 混排**；回车以系统打开飞书 URL 为主。  
3. **做事完整：** 日程、会话、发消息、联系人等走 **命令二级**；写操作 L2 确认。  
4. **边界清晰：** 飞书产品语义在 first-party 插件内；host 只提供 Desktop Target / shell / launcher 通用协议。  
5. **失败可降级：** CLI 未装、未登录、超时、scope 不足 → 可读修复路径；不拖垮其它 provider。

### 2.2 非目标

- hiven 官方托管 App Secret / 预置官方应用（除非未来单独产品化）
- 在 hiven 内重做完整 OAuth 页面（仅编排 CLI login split-flow / 展示 verification_url）
- 通用 RPA、驱动飞书客户端 UI 自动化
- Windows/Linux 与 macOS 同周对等（CLI 可用即可；体验主攻 macOS）
- 将飞书文档/消息做成 framework 级 diff/renderer 能力
- 一期 Object Block 深度解析飞书链接（可列为后续增强）
- v1 多 profile 账号切换 UI（交给 `lark-cli profile`；hiven 只用当前 default）

### 2.3 成功标准（可检验）

| # | 标准 |
|---|------|
| S1 | 已安装且已登录时，文档关键词在 L1 top 结果中出现并可打开飞书页 |
| S2 | 未安装 / 未登录：L1 静默无飞书结果；命令/设置有明确修复路径 |
| S3 | 单次搜索超时或 CLI 失败不拖垮 App/窗口/浏览器 tab 混排 |
| S4 | 任意写操作必须经过 L2 确认；无确认则无写 CLI |
| S5 | 插件无 workspace 深 import；`npm run check:architecture` 通过 |
| S6 | 用户可见文案中英 i18n，无硬编码 |
| S7 | 本文覆盖 Raycast 对标全集 + B0–B5 分期；可按批开工实现 |

---

## 3. 总体架构

### 3.1 依赖方向

```text
Global Launcher / App 命令入口
  → feishu first-party plugin
       → commands / settings / DesktopTargetProvider
       → 受控 shell：lark-cli <domain> +shortcut ... --json
            → 本机 lark-cli config + user/bot token（keychain）
  ✗ 插件不直连 OpenAPI、不自管 refresh
  ✗ host/framework 不出现 docs/calendar/im 产品 API
  ✗ 插件不深 import workspace ranking / desktopTargets 内部实现
```

### 3.2 两层入口

| 层 | 用户路径 | 放什么 | 不放什么 |
|----|----------|--------|----------|
| **L1 混排** | Global Launcher 直接输入关键词 | 文档 / Wiki 等带 URL 的导航目标 | 发消息、删文件、建日程等写操作 |
| **L2 命令** | `飞书` / `lark` / `feishu` 及域别名 | Raycast 对标完整能力树 | — |

原则：**L1 只做「找得到并打开」；L2 才做「对飞书做事」。**

### 3.3 与现有能力衔接

| 能力 | 关系 |
|------|------|
| Desktop Target | 与 `browser-tabs` 同一协议；`sourceId` 独立（如 `feishu.docs`） |
| L0–L3 安全 | 打开文档 ≈ L1；发消息 / 建日程 ≈ L2 必确认 |
| contextBoost | 前台为飞书 App 时，可对 feishu 命令/文档抬分（B1+ 可选） |
| journal / usage | 走现有执行记录，不单开分析后台 |
| script-command | 不替代 first-party 插件；高级用户仍可自写 shell |

---

## 4. 产品命令目录（Raycast 对标全集）

入口根命令建议：`飞书` / `lark` / `feishu`（标题 i18n；别名可搜）。

| 域 | 用户可见能力 | lark-cli 主路径（示意） | 风险 | 入口 |
|----|--------------|-------------------------|------|------|
| **连接** | 状态 / 登录 / 登出 / 当前身份 | `doctor` / `auth login\|logout\|status` / `whoami` | 读；登录为引导流 | L2 |
| **文档** | 搜索 · 打开 · 抓取内容 · 创建 | `docs +search` / open URL / `docs +fetch` / `docs +create` | 读；创建=写 | L1+L2 |
| **知识库** | 搜 Wiki / 打开节点 | `docs +search`（wiki）/ `wiki` | 读 | L1+L2 |
| **云盘** | 搜文件 · 打开链接 | `drive` 搜索/元数据 | 读为主 | L2（有稳定 URL 时可升 L1） |
| **日程** | 今日议程 · 搜日程 · 建日程 · RSVP | `calendar +agenda` / `+search-event` / `+create` / `+rsvp` | 读；写需确认 | L2 |
| **消息** | 搜会话 · 最近会话 · 发消息 · 搜消息 | `im +chat-search` / `+chat-list` / `+messages-send` / `+messages-search` | 发消息=写 | L2 |
| **联系人** | 按姓名找人 · 打开名片/会话 | `contact` | 读 | L2 |
| **任务** | 我的待办 · 创建任务（可选） | `task` | 读优先 | L2 |
| **妙记** | 搜/打开妙记（可选） | `minutes` | 读 | L2 |

**L1 Desktop Target 只映射：** 文档 / Wiki（及明确带可 open URL 的导航结果）。其余一律 L2。

### 4.1 交互约定（全集统一）

- **读：** 可 quick-run 或直接出 dynamic 列表（视是否有必填参数）。  
- **写：** 禁止静默执行；Launcher choices 展示目标摘要（会话名 / 标题 / 时间）→ 确认后执行。  
- **身份：** 个人资源默认 `--as user`；bot 仅用于明确「以应用身份」的命令并在 UI 标注。  
- **文案：** 全部走系统 i18n（中英）；禁止 hardcode 最终 UI 文案。  
- **性能：** 搜索 debounce + per-call timeout；单域失败 isolation。

### 4.2 设置页最小集

1. 启用飞书插件 / 启用 L1 文档混排  
2. `lark-cli` 可执行路径（默认 PATH 探测）  
3. 当前身份摘要（whoami 只读）  
4. 「重新登录 / 检查环境」：调 doctor / auth 引导  

---

## 5. 分期交付（B0–B5）

| 批次 | 交付 | 验收直觉 |
|------|------|----------|
| **B0 底座** | CLI 探测、`runCli`、JSON/错误映射、设置页、状态 + 登录引导 | 未装/未登录有清晰文案，不崩 |
| **B1 文档导航** | `docs +search` → L1 混排 + 命令列表；open URL | 输文档名 top 结果可打开飞书 |
| **B2 日程只读** | `+agenda`、搜日程；open/复制会议信息 | `日程` / `agenda` 看到今天安排 |
| **B3 会话与联系人** | 搜群/人；打开会话链接或复制 open_id | 找人/找群可用 |
| **B4 受控写** | 发消息、建日程、建文档；L2 choices 确认 | 误触不直接发出 |
| **B5 增强** | fetch 进编辑器、消息搜索、任务/妙记、窗口 focus 增强 | 按需，不挡主路径 |

实现时每批单独可验收；**产品目录以本文全集为准，不因分期删掉设计条目。**

---

## 6. Desktop Target（L1）

### 6.1 Provider 形态

对齐 `src/plugins/browser-tabs` 先例：

```text
feishu plugin
  → settings: 启用混排 / 启用命令 / binary 路径
  → register DesktopTargetProvider id ≈ feishu.docs
  → list(ctx): 有 query 时 lark-cli docs +search --json
  → activate: 系统 open 文档 URL
```

### 6.2 约束

- 建议仅在 `global-launcher` surface 贡献结果（与 browser-tabs 策略对齐，实现时可再核对）  
- **空 query 不刷飞书文档**（避免冷启动全量拉取）  
- provider 超时 / CLI 未装 / 未登录 → **静默 `[]`**，不拖垮其它来源  
- 插件只走 host SDK 的 `desktopTargets.register`（或现行等价公共 API）  
- `kind`: 优先 `document`；subtitle 可带空间/类型；`meta.url` 必填才进入可激活列表  
- `priority`: 落在现有 PROVIDER_PRIORITY 量级内，避免压过强文本 intent  

### 6.3 打开语义

1. 搜索结果带稳定 `url`（来自 CLI search）  
2. 主动作 = 系统 open URL（飞书客户端 / 浏览器）  
3. **后期可选（B5）：** 窗口标题模糊匹配尝试 focus 已开飞书窗口；非 B1 阻塞项  

---

## 7. 技术设计

### 7.1 建议包结构

```text
src/plugins/feishu/                 # 插件 id 实现时以目录约定为准，建议 feishu
  index.ts                          # 注册 commands / settings / provider
  package.json | manifest           # 版本、权限
  cli/
    detect.ts                       # which、版本、doctor 摘要
    run.ts                          # 受控 spawn、timeout、AbortSignal
    parse.ts                        # --json、_notice、错误体
    errors.ts                       # 映射可读错误 + 可动作 hint
  domains/
    docs.ts / calendar.ts / im.ts / contact.ts / auth.ts
  provider/
    docsTargetProvider.ts           # DesktopTargetProvider（B1）
  commands/                         # 各命令 run + params + choices
  settings/
    model.ts + SettingsBody
  # locale keys：走系统 i18n 管线
```

v1 **不**抽独立 kit；若后续多插件复用再下沉（Kit 准入：无 framework 对象、无运行时副作用、非单一产品策略）。

### 7.2 `runLarkCli` 契约

```text
runLarkCli({
  args: string[],            // e.g. ['docs','+search','--query', q, '--as','user','--json']
  timeoutMs: number,         // 默认 8–12s；搜索 5–8s；doctor 可更长
  signal?: AbortSignal,      // 与 launcher 取消联动
  risk?: 'read' | 'write' | 'high-risk-write'
}) → { ok, data, stderr, code, cliNotice? }
```

规则：

- 一律请求 JSON 输出（CLI 支持时带 `--json`）；解析失败当协议错误  
- **写 / high-risk-write：** 插件先 L2 确认，再调 CLI；CLI 若要求 `--yes`，仅在确认后由适配层附加  
- 不把用户敏感路径默认塞进 cwd；继承 PATH，设置可覆盖 binary  
- **禁止**在日志/错误 UI 输出 token、app secret、authorization 头  

### 7.3 权限与安全

| 层 | 机制 |
|----|------|
| PluginPermission | 需要 shell 执行能力（现有 `shell.run` 或后续更窄 `shell.lark-cli`）；未授权则隐藏/禁用 |
| Desktop Target | 受「启用 L1 混排」开关；关闭则 unregister |
| 写操作 | Launcher L2 choices 摘要确认 |
| 身份 | 默认 user；settings 展示 identity；bot 命令显式标注 |
| 合规 | 不把 token 上传 hiven 服务；数据面 = 本机 CLI ↔ 飞书开放平台 |

### 7.4 错误与降级

| 场景 | 行为 |
|------|------|
| CLI 未安装 | 设置/命令空态：安装指引；L1 list → `[]` |
| 未登录 / token 过期 | 命令提示登录；`auth login --no-wait --json` split-flow 或展示 verification_url |
| scope 不足 | 展示缺失 scope + 引导 `auth login --scope` / 控制台链接（优先用 CLI 错误体字段） |
| 超时 / 非 0 | 单次失败提示；不影响其它 provider/命令 |
| CLI `_notice`（升级） | 设置页非阻塞提示，不阻断主路径 |

### 7.5 Host / Plugin 边界清单

| 允许 | 禁止 |
|------|------|
| 插件 → host 公共 SDK：desktopTargets 注册、commands、settings、clipboard、open URL、已授权 shell | 插件 import host 私有 ranking / registry 实现 |
| host 保持通用 DesktopTarget 协议 | host 出现 `feishu` / `lark` 产品 API 面 |
| 命令输出走现有 output 管线（编辑器 / 剪贴板 / launcher） | 为飞书新造平行 launcher 管道 |
| 全量 i18n | UI 硬编码中英 |

### 7.6 v1 默认取舍（开放问题收口）

| 问题 | v1 决定 |
|------|---------|
| binary 名 | 只认 `lark-cli`（设置可填绝对路径） |
| 多账号 | 只用 CLI 当前 default profile |
| 打开会话无稳定 URL | 降级：复制 ID / 展示 CLI 返回的可用链接；不强行 focus |

---

## 8. 数据流时序

### 8.1 L1 文档混排（B1）

```text
用户输入 query
  → Host collectDesktopTargets(query)
  → feishu.docs provider.list
       → enabled && query 非空？
       → runLarkCli(['docs','+search', ..., '--as','user','--json'])
       → map → DesktopTarget[]（id/title/subtitle/url/sourceId/kind:document）
  → Host 混排 ranking
用户回车
  → activate → 系统 open(meta.url)
```

取消输入：`AbortSignal` 中止进行中的 CLI；超时视为空结果。

### 8.2 L2 只读命令（例：今日议程）

```text
用户选「飞书 · 今日议程」
  → command.run
  → runLarkCli(['calendar','+agenda', ..., '--json'])
  → launcher 列表或文本结果
  → 可选：打开链接 / 复制摘要
```

### 8.3 L2 写操作（例：发消息，B4）

```text
用户选「发消息」→ 填会话/正文
  → 确认卡：会话名 + 正文摘要
  → 用户确认
  → runLarkCli(['im','+messages-send', ...])  // 仅确认后；按需 --yes
  → 成功简短结果 / 失败可读错误
```

未确认：**零次** CLI 写调用。

### 8.4 登录引导（B0）

```text
doctor / whoami → 未登录
  → UI「登录飞书」
  → auth login --no-wait --json → verification_url（+ 可选 qrcode）
  → 用户授权后确认
  → auth login --device-code …
  → 刷新状态
```

hiven **不**自建 OAuth 页面，只编排 CLI。

---

## 9. 测试策略

| 层 | 覆盖 |
|----|------|
| 单测 | JSON parse 成功/失败；错误映射；空 query provider → `[]`；写操作未确认不调用 CLI |
| 契约 | mock `runCli`：search → DesktopTarget 字段稳定 |
| 架构 | `npm run check:architecture`；插件无 workspace 深 import |
| 手工 | 真机：已登录搜文档混排打开；未登录引导；发消息确认流；IME 下别名不误触发 |

验证命令（实现阶段，与仓库惯例一致）：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

---

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| CLI 版本差异 / shortcut 变更 | 集中 `domains/*`；探测版本；错误提示升级 CLI |
| 搜索延迟拖慢输入 | debounce、timeout、AbortSignal、L1 失败静默 |
| 写操作误发 | 强制 L2 choices；确认前不加 `--yes` |
| scope 迷宫 | 错误体透出 scope + 一键登录域/scope 引导 |
| 插件 shell 权限过宽 | 权限声明最小化；设置可关；后续可收窄到 allowlist binary |
| 合规 / 企业管控 | 用户自有 CLI 应用与授权；hiven 不托管 secret |

---

## 11. 决策记录

| # | 决策 | 来源 |
|---|------|------|
| 1 | 本轮只设计不实现 | brainstorm |
| 2 | 包⑧ 完整生态一次定清 | brainstorm |
| 3 | 鉴权/API 基于 lark-cli | 用户明确 |
| 4 | first-party 插件 + shell 调 CLI | brainstorm（推荐采纳） |
| 5 | Raycast 对标全集 + B0–B5 分期 | brainstorm |
| 6 | L1 = Desktop Target 混排 + open URL；L2 = 完整命令树 | brainstorm |
| 7 | 写操作 L2 必确认；默认 `--as user` | 设计收口 |
| 8 | v1 单 binary 名、单 default profile | 设计收口 |

---

## 12. 实现入口（后续）

设计确认后，实现前建议：

1. `writing-plans`：按 B0→B1→… 拆可执行任务与测试 agent / 实现 agent 边界（TDD 隔离）  
2. 新分支（勿在 main 直接开工）；可选 git worktree  
3. 实现时同步：插件版本号、builtin 释放目录、locale keys、架构检查  

**本文不包含实施计划正文；计划另文：`docs/superpowers/plans/YYYY-MM-DD-feishu-lark-cli-integration-plan.md`（待写）。**

---

## 13. 路线图状态更新建议

将 `doc/2026-07-19-launcher-intelligence-roadmap-design.md` §15.1 中包⑧ 从「⏸ 延期」更新为「📐 设计已就绪（基于 lark-cli）」并链接本文——**可在实现开工或文档同步 PR 中修改，本设计文件已自包含。**
