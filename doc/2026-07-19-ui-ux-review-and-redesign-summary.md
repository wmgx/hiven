# hiven UI/UX 审查总结与重设计方向

**日期:** 2026-07-19
**状态:** 审查完成 · 包一–三可直接实施；包四需另出正式交互稿后开工
**产品:** hiven
**读者:** 执行 AI / 评审 / 产品（包级规格见 §7；假定执行者零上下文）
**方法:** ui-ux-pro-max 规则库对照 + 源码审查（未运行界面，结论均附代码位置）；同日二轮补 emilkowalski/skills（emil-design-eng + apple-design）动效专项复审，产出 §5 M 系列
**范围:** Global Launcher 全帧、设置页、插件页、插件设置对话框与 Schema 渲染器；二轮加审动效/手感全链路
**视觉基线:** 「立体白」——白色主背景、发丝线 + 分层阴影、键帽质感、品牌蓝 `#2563eb` 仅作 accent（2026-07-07 拍板，见 `doc/2026-07-07-light-theme-tactile-white.html`）

**关联:**

- 交互 demo：`doc/2026-07-19-launcher-interaction-redesign-demo.html`
- 立体白基线：`doc/2026-07-07-light-theme-tactile-white.html`
- 前序打磨：`doc/2026-07-07-ui-experience-polish-design.md`
- 插件边界：`doc/diff-plugin-boundary-decision.md`、`Agents.md`
- M 系列规则：emilkowalski/skills（`~/.claude/skills/`：emil-design-eng、apple-design 等）

**文档完成度:**

- [x] 总评与「不要动」清单
- [x] §2 交互重设计方向（已拍板）
- [x] P1–P4 / V1–V11 / M1–M9 问题清单
- [x] 建议实施顺序（包一–四）
- [x] §7 包级实施规格（文件路径 + 规格 + 验收）
- [x] §8 非目标与依赖
- [x] 验证命令与交付约定

---

## 1. 总评

交互工程质量在同类 launcher 产品中属于高水准，以下能力已对齐最佳实践、**不需要动**：

- 键盘导航闭环：`↑↓` / `↵` / `esc` / 空格多选 / 空输入退格返回，footer 键位提示常驻
- IME composition 全局处理（含专项测试）
- `prefers-reduced-motion` 全局兜底（`index.css:8928`）
- 动效时长集中在 120–250ms 区间，列表 stagger 短促（6ms × 6）
- 搜索行 50px 行高、输入 16px 字号、匹配高亮 + 拼音标记
- 空状态区分"无结果 / 无插件"且全部走 i18n
- 设置页自建下拉具备完整 listbox 语义与键盘导航
- 插件页行级 Tab 聚焦 + Enter/空格展开 + `aria-expanded`
- 插件设置对话框有错误边界与设置版本迁移警告

二轮动效复审补充的"已对齐、不需要动"（Emil 框架里最重要的几道大题全部答对）：

- 全局 launcher 窗口原生瞬开瞬关、零动画（`show_launcher_window` 直接 show）——Raycast 准则：每天用上百次的键盘动作永远不 animate
- 帧切换（搜索 → 参数收集 → 执行）全部瞬时，键盘驱动导航不加过渡
- 按钮族按压反馈齐全：`.btn` scale(0.96)、`.scripts-btn` scale(0.97)、`.pinned-icon-btn` scale(0.93)，落在建议的 0.93–0.97 区间
- micro-transition 集中 100–160ms、全走 CSS 不占主线程、强曲线 `--ease-out-expo` 已入 token

问题集中在：破坏性操作确认、浮层焦点与动效、表单验证机制、i18n 硬编码、**立体白视觉语言只落地了一半**、以及二轮新发现的**动效系统大面积未接线**（设计了约 10 组入场动画，实际能触发的只有 1 组，且恰好装在最高频路径上，详见 §5 M 系列）。

---

## 2. 交互重设计方向（已过目拍板）

演示稿：`doc/2026-07-19-launcher-interaction-redesign-demo.html`（三阶段叙事，03 可交互）

| 阶段 | 方案 | 拍板状态 |
|---|---|---|
| 01 搜索 | 维持现状，仅精修键帽/阴影质感 | ✅ 认可 |
| 02 参数 | 命令塌缩为输入行首**蓝色标签**，不翻页；参数选择**保持下拉列表**形态（与搜索列表同构） | ✅ 认可；行内 chips 方案已否（"不如下拉列表好看，意思更明确"） |
| 03 执行 | 纯函数插件**输入即预览**（live preview），回车只决定去向；去向徽章常驻（`↵ 复制` / `⌘↵ 粘贴到前台` / `⇥ 切换`）；已选参数以**轻量灰值块**显示（沿用现状 collect-input 格式） | ✅ 认可；参数做键帽 token 已否（"不太好看"） |

统一语义：**⌫ 删除标签 = 返回上一步**（空输入时两段式：第一按预备态、第二按删除）。返回按钮取消。

设计原则：重设计不引入新范式，而是把已散落各处的正确直觉（ObjectBlockToken、即时预览雏形、quick run 声明）收敛为统一协议。键位分工：`←→`/`↑↓` 选择、`⇥` 专用于切去向、`⌫` 专用于返回，跨阶段不复用冲突。

---

## 3. 问题清单（按优先级）

### P1 — 硬伤（先修）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 1 | **卸载/移除插件零确认** | `PluginsContent.tsx:649-657, 678-681` | danger 菜单项点击即执行，无确认无撤销，唯一有数据损失风险的交互。建议两段式确认（与 ⌫ 删标签语义呼应） |
| 2 | **执行中反馈过弱** | `GlobalLauncherCollectInputFrame.tsx:64`；`LauncherParamStep.tsx:227` | busy 仅静态 `"..."` 文本 / 仅禁用输入无任何指示；网络插件（翻译）秒级耗时形同卡死。注：`anim-running-pulse` 动画已在 CSS 定义但全仓库无使用。长期解法是 03 的 live preview 协议，让纯函数场景根本没有等待段 |

### P2 — 结构性缺口

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| 3 | **插件设置对话框无焦点管理** | `PluginSettingsDialog.tsx` | 打开不移焦、无 focus trap（Tab 穿透到遮罩后）、关闭不还原、无 `role="dialog"` / `aria-modal`；内嵌二级 modal 同样 |
| 4 | **Schema 表单零验证反馈机制** | `PluginSettingsSchemaRenderer.tsx`（814 行无 error/validate） | text/number 字段无 inline 校验、无错误展示位；插件约束输入只能静默失败。建议 schema 协议增加 `validate` + 字段下错误行标准位 |
| 5 | **launcher 无结果是死胡同** | `GlobalLauncherSearchFrame.tsx:132` | 仅一行灰字；惯例（Raycast/Alfred）应提供 fallback 动作，现成的 web-open 插件可注入为"用 Web 搜索 {query}" |

### P3 — 体验打磨

| # | 问题 | 位置 |
|---|---|---|
| 6 | 浮层全部 0ms 瞬开：设置对话框、⋯ 下拉菜单均无入场动画（`anim-dropdown` 工具类已定义未使用）。**二轮频率框架裁决**：这不是与 launcher 瞬开对齐的一致性，而是频段用错——launcher 是"每天百次"频段（必须瞬开），设置对话框/菜单是"偶发"频段（应有 150ms ease-out 入场，menu 配 `transform-origin` 指向触发点），两者分开处理才是有原则的分工 | `PluginSettingsDialog.tsx`；`.plugins-dropdown-menu` |
| 7 | ⋯ 菜单键盘路径不通：Esc 关不掉、无方向键、无 `role="menu"` | `PluginsContent.tsx:686-702` |
| 8 | `plugins-row` 可聚焦但无 `:focus-visible` 焦点环（行内按钮反而有） | `index.css` plugins 段 |
| 9 | tertiary 文字对比度：light `#999fa4`/白 ≈ 2.7:1，dark `#6d6d75`/`#161618` ≈ 3.5:1；placeholder 与 more-hint 承载信息却用 text-3，建议升 text-2（#686d71 ≈ 5.2:1） | `index.css` token 段 |
| 10 | 全局 `:focus-visible` 覆盖薄：89 处 `cursor:pointer` 对 11 处焦点样式，16 处 `outline:none` 需逐一确认有替代 | `index.css` |
| 11 | 设置页字号步进器到边界（10/24）无 disabled 态，点击无反馈 | `SettingsContent.tsx:81-83` |
| 12 | 设置页 Toggle 无 accessible name（有 `aria-pressed` 但未与行名 label 关联） | `SettingsContent.tsx:134-143` |
| 13 | 原始错误直接上屏（`String(err)`），可能是长英文技术栈错误；建议截断 + 可复制详情 | `SettingsContent.tsx`；`PluginsContent.tsx:493` |
| 14 | 切语言全屏黑遮罩无 spinner + 整页 reload 闪断 | `SettingsContent.tsx:25-39, 50-52` |
| 15 | 参数 number 输入用原生 `type="number"`，`-webkit-inner-spin-button` 未隐藏，WebKit 会冒出原生步进箭头 | `LauncherParamStep.tsx:181` |
| 16 | 文本字形与 SVG 图标混用：`✓` `×` `‹` `▾` 与 lucide 并存 | 多处 |

### P4 — 合规清理与死代码

**i18n 硬编码（共 8 处，可打包一次清完）：**

| 位置 | 内容 |
|---|---|
| `GlobalLauncherFrames.tsx:139` | "Surface not found" |
| `ObjectBlockToken.tsx:41` | "内容已隐藏" |
| `ObjectBlockToken.tsx:52` | "再按 Backspace 删除" |
| `ObjectBlockToken.tsx:58` | `aria-label="Remove object block"` |
| `ObjectBlockToken.tsx:46,49` | badge "snapshot" / "invalid" |
| `OutputTargetExpansion.tsx:44,49` | "默认"、"↵ 确认 · esc 返回" |
| `PluginSettingsDialog.tsx:141` | "No settings available for this plugin." |
| `PluginSettingsSchemaRenderer.tsx:403` | `aria-label` 'Hide'/'Show' |

**死代码 / 过期物：**

- `RecommendedActionRow` / `OutputTargetExpansion`：推荐动作已禁用（`GlobalLauncherSearchFrame.tsx:60` 硬编码空数组），死 UI 路径，删除或补 i18n 后复活，勿留中间态
- `anim-running-pulse`（`index.css:1003`）：定义 + reduced-motion 豁免俱全，无任何使用处——正好用于 P1-2
- `index.css:5349/5354`：相邻重复的 `.l-suggest-row-secondary:focus-visible` 选择器
- `ObjectBlockToken.tsx:9` 注释写 "purple border"，实际已是品牌蓝
- **二轮补充（动效死线，组件层零引用）**：`view-enter*`（`index.css:649-670`）、`anim-card-in` / `anim-console-line` / `anim-dropdown` / `anim-bump` / `anim-badge-pop`（`index.css:991-1011`，其中 `anim-dropdown` 留给 P3-6 复活）、`.toast-container` 整套底部弹跳 toast（`index.css:1233-1248`，真实 toast 是 `ToastContainer.tsx` 右下角那套）、`object-target-push`（`index.css:7436`，随死组件 `OutputTargetExpansion`）、`.search-highlight`（`index.css:1251`，硬编码 amber，零引用，即 V11）
- **二轮补充（结构上永不触发）**：`.palette-panel` 入场过渡（`index.css:1024-1037`）——宿主挂载时已带 `.open`（`GlobalLauncherHost.tsx:411`），transition 无起始帧，永远瞬开。瞬开对命令面板恰是正确行为，但应删掉这段假入场，让它成为"决定"而不是"事故"

---

## 4. 视觉优化（UI 层）

核心判断：**立体白只落地了一半**。已落地：面板分层阴影、插件搜索框内凹井、冷灰族、accent 收敛。以下为未落地部分，均适合渲 HTML 供本人挑图后实施：

| # | 优化点 | 现状证据 | 方向 |
|---|---|---|---|
| V1 | **键帽升级**（收益/成本比最高） | `.kbd` 为 `background:#fff` 硬编码 + 1px 边的"贴纸"，扁平 | 微渐变（`#fff→#f7f8f8`）+ 底边加重 + `0 1px 0` 投影 + `inset 0 1px 0 #fff` 高光；kbd 是全产品出镜率最高的立体白标志物（footer 键位、快捷键徽章、参数值块），改一处全场生效。demo 中已渲染该版本 |
| V2 | **浮层材质规格统一** | 设置对话框阴影/圆角/描边内联硬编码不走 `--shadow-panel`；圆角散乱：对话框 14px、菜单 10px、行 6px | 定一份浮层规格（圆角档位、描边、三层影：1px 描边 + 近影 + 远影、150ms 入场），对话框/菜单/drawer 全部引用 |
| V3 | **插件图标色板去 AI 味** | `PluginsContent.tsx:95-102` 六色 hash 板含紫 `#7e22ce`、粉 `#be185d`；浅色底硬编码，dark 下成刺眼亮块 | 换品牌蓝 + 冷灰派生窄色板，或统一灰井底 + 彩色线条图标；补 dark 对应值 |
| V4 | **dark 主题定义"立体黑"** | 立体白手段（阴影、白面高光）黑底物理失效，现 dark 为普通深灰面板 + 亮蓝 accent，与 light 质感不同源 | 以"上边缘高光线 `inset 0 1px 0 rgba(255,255,255,.06)` + 面色分层"替代阴影，单独出稿挑选 |
| V5 | **空状态"空井"化** | launcher 无结果、插件空列表均为一行灰字 | 内凹灰井 + 线条图标 + 文案 + 动作按钮，与 03 预览井同材质（同时解 P2-5） |
| V6 | **选中态微材质**（可选，最克制） | `.l-row.sel` 纯平 accent-soft 铺色 | 尝试极淡 inset 上高光的"压入感"；须渲染稿过目后定夺，不预设结论 |

**二轮补充（V7–V11，基建层）**：比 V1–V6 更"里子"——字体管线、token 体系、色系纯度。无需出稿挑图，可直接实施：

| # | 优化点 | 现状证据 | 方向 |
|---|---|---|---|
| V7 | **字体管线切系统栈**（质感+可靠性双收益） | `index.css:1` 从 Google Fonts CDN 拉 Inter + JetBrains Mono；launcher 块（`:4620`）另定义 `-apple-system, "SF Pro Text", "PingFang SC"` 系统栈——两套字体并存，旧页面与 launcher 字形不同源。桌面 Tauri 应用依赖 googleapis：离线/弱网/国内网络下首开字体回退闪变（FOUT），是目前唯一受网络环境影响的 UI 变量 | 全量切系统字体栈，删远程 `@import`。Apple 原则：默认平台字体（SF Pro 自带 optical sizing 和分级 tracking，切换后大字号负 tracking、分级 leading 基本白拿） |
| V8 | **清 indigo 残留**（红线级：违反禁蓝紫拍板，改动仅 3 个 token 值，全场性价比最高） | `--accent-soft: #eef2ff`（= indigo-50，blue-50 应为 `#eff6ff`）、`--accent-tint: #eef2ff`、`.l-foot .primary kbd` 边框 `#c7d2fe`（= indigo-200，blue-200 是 `#bfdbfe`）；`:199` 注释写"避免旧紫色 tint 残留"说明清理过但 soft 族没清干净。选中行背景（accent-soft）是全产品出镜率最高的色块，现带紫向偏色 | soft/tint 族改 `color-mix(in srgb, var(--accent) 8%, #fff)` 从品牌蓝派生，色系纯度不再依赖人肉对色 |
| V9 | **Token 四套并存打架**（V2 圆角散乱的根因） | `--color-*`（旧）、`--bg-surface-*`（tactile white 块）、`--panel/--surface/--text-N`（launcher redesign 块）、`--hiven-*`（插件 SDK 桥）。实锤冲突：`:18` `--radius-sm: 6px` 与 `:4608` 同 `:root` 级 `7px`——后者按文件顺序静默胜出，旧代码 6px 意图已被改写。另有 132 处硬编码色游离 token 外（含 toast `#fef2f2`/`#dc2626` dark 下成刺眼亮块、app-icon 选中环 `rgba(37,99,235,.4)` 等） | 定 launcher 系 token 为准，其余三套降级为别名（`--color-accent: var(--accent)`）；`--radius-sm` 冲突立即消掉；硬编码色不一次清完，立"新代码只准用 launcher 系 token"规矩后随包三顺手回收 |
| V10 | **发丝线无体系** | `0.5px` 边框 27 处、`1px` 86 处无规则混用（`.script-card` 0.5px、`.pinned-labeled-btn` 1px、`.kbd` 1px），同一界面粗细随机，深度层级读不出来 | 定 `--hairline` token（retina 0.5px、低倍屏回退 1px），立体白的"发丝线"笔触收敛到一处 |
| V11 | **`.search-highlight` 死样式** | `index.css:1251` 硬编码 amber `#fde68a`，全仓库零引用（launcher 实际用 `.launcher-match-highlight` accent 色） | 删除，归入包二死代码清单 |

---

## 5. 动效与手感审查（M 系列，二轮）

> 方法：emilkowalski/skills（emil-design-eng 动画决策框架 + apple-design 流体交互原则）对照源码
> 总判断：**架子对，细节漏**——高频路径正确地零动画，但真实用户感受到的动效和 CSS 里设计的动效系统是两套东西。问题不在"动画太多"，而在该动的地方失灵、不该动的地方每天动几百次

| # | Before | After | Why |
|---|---|---|---|
| M1 | Toast 用 `animate-slide-in-right`（`ToastContainer.tsx:29`）——该类**全仓库无定义**（Tailwind v4 无此默认 utility），且 `removeToast` 直接从 store 过滤移除 | 入场 `transition: transform 200ms var(--ease-out-expo), opacity 200ms`，从 `translateX(16px)` 进；退场加 exiting 态延迟 ~150ms 卸载，**同方向退回** | 现状进出全瞬变。Emil：元素无过渡地出现/消失 "feels broken"；toast 属"偶发"频段，正该有标准动画。Apple 空间一致性：从哪来回哪去。用 transition 而非 keyframes（Sonner 原则：快速堆叠的动态 UI 需可中断重定向） |
| M2 | `.l-row` 挂 `anim-palette-item`（`LauncherMixedList.tsx:113`）：每次按键过滤后**新出现的行**重放 120ms translateX(-4px) 入场 + stagger，留存的行不动 | 搜索驱动的列表更新去掉入场动画；最多保留首次打开时播一次 | 搜索是每天上百次的最高频路径，Emil 频率表判 "No animation. Ever."（Raycast 结果行零入场）。且同一次按键里一半行滑入、一半静止，运动不一致比没有动画更糟 |
| M3 | 动效词汇表 ~80% 死线或结构上永不触发（明细见 §3 P4 二轮补充） | 接线的接线（M4、P3-6），其余删除 | 设计的 motion 系统与实际体验脱节 |
| M4 | busy 仅静态 `"..."`（`GlobalLauncherCollectInputFrame.tsx:68`），`anim-running-pulse` 闲置 | 接上 `anim-running-pulse`，脉冲周期收紧到 ~0.8s | 即 P1-2 的动效侧修法。Emil 感知性能：快速脉冲让相同等待显得更短；静态省略号形同卡死。长期根治仍是 §2-03 live preview |
| M5 | `.global-launcher-panel` / `.global-launcher-body` 挂 `transition: height/max-height 70ms ease-out`（`index.css:1060,1214`），与原生窗口 resize（`GlobalLauncherWindowLifecycle.ts:105`，瞬时落地）并行 | 删掉这两处过渡，内容高度与窗口同步瞬变 | height/max-height 是 layout 属性，逐帧 reflow 整个 630px 面板；且 CSS 70ms 补间与异步 IPC 原生 resize 存在竞速（窗口先到露透明缝、后到内容被裁）。resize 由按键驱动 = 高频段，按框架应瞬变 |
| M6 | `.scripts-tab-indicator` 用 overshoot 曲线 `cubic-bezier(0.34,1.56,0.64,1)` 过渡 **left + width**（`index.css:1754`） | `transform: translateX() scaleX()` + 0.25s 强 ease-out，去掉回弹 | Apple：overshoot 只配给带动量的手势，点击切 tab 无动量，回弹显做作；且 left/width 触发 layout，违反只动 transform/opacity 的性能红线 |
| M7 | `transition: all` ×6：`.schema-object-list-add`、`.prow`、`.csv-tools-surface__ib`、`.csv-tools-surface__seg-item` 等（`index.css:2353,5654,5796,5885,8150,8269`） | 逐处改为具体属性（`background 0.12s, color 0.12s` 等） | `all` 会把未来任何属性变化都卷进过渡（含 layout 属性），Emil 检查表第一条 |
| M8 | `.l-search .back`、`.object-block-remove` 只有 hover 变底色，无 `:active` 反馈 | `:active` 加 `transform: scale(0.93)`（与 `.pinned-icon-btn` 同值） | 每个可按元素都要在 pointer-down 瞬间给反馈；这两个还都在返回/删除的关键路径上 |
| M9 | `.l-row` 声明 `will-change: background`（`index.css:4994`） | 删除 | background 不是合成器属性，此提示无效，纯噪音 |

体感收益最大的是 **M1 toast、M2 列表行、M4 busy** 三项——都是一次改动全场生效的杠杆点。全部为 CSS/局部组件层改动，不碰 §2 已拍板的 02/03 交互协议；M2、M5 删动画的方向与包四 token 输入行改造无冲突，先做不返工。

另：§2 已拍板的"⌫ 返回瞬时、无过渡"在 Apple 框架里同样成立——键盘导航要零延迟响应，空间感由蓝标签的出现/消失本身承担，不需要位移动画解释。

---

## 6. 建议实施顺序

1. **包一 · 红线修复**：P1-1 卸载确认、P1-2/M4 busy 反馈（启用 running-pulse）、P2-3 对话框焦点管理、**V8 清 indigo 残留**（红线级，3 个 token 值）、V9 中的 `--radius-sm` 6/7px 冲突消除
2. **包二 · 合规清理**：i18n 8 处 + 死代码（P4 原 4 项 + 二轮动效死线 + V11 `.search-highlight` 一并清，一次 PR 清完）
3. **包三 · 视觉质感与动效**：V1 键帽 + V2 浮层规格 + **V7 字体切系统栈** + V10 发丝线 token + P3-6 浮层动画（按 M 频率裁决：浮层加 150ms 入场、launcher 本体保持瞬开）+ M1 toast 进出场 + M2 列表行去动画 + M5–M9 顺手修（纯 CSS token 层，低风险；V3 色板随包出稿挑选）；V9 存量硬编码色随本包顺手回收，并自此立「新代码只准用 launcher 系 token」规矩
4. **包四 · 交互重设计**：§2 三屏方案（token 输入行 + live preview + 去向徽章），**实施前按流程出正式设计稿逐段确认**；V4 立体黑、V5 空井可并行出稿

包一 → 包二 → 包三 串行风险最低（包二不依赖包一视觉，但包一含 P1 应优先）。包三与包四无代码硬依赖，但包四会改输入行 DOM，键帽/token 样式宜在包三稳定后再动包四。

每包完成后执行 §9 验证四件套；涉及可视 UI 的包必须补浏览器真实 DOM 验证。

---

## 7. 包级实施规格（执行 AI 照做）

> 行号为 2026-07-19 审查快照，执行前以符号名 / 选择器重新定位。
> 全局约束：用户可见文案走 i18n；外科手术式修改；不顺手重构无关代码；不碰 §2 已否方案（行内 chips、参数键帽 token）。

### 包一 · 红线修复（建议单 PR）

#### 1.1 P1-1 卸载/移除插件两段式确认

| 项 | 内容 |
|----|------|
| 现状 | `PluginsContent.tsx` danger 菜单项点击即 `uninstallPlugin` / 移除，无确认无撤销 |
| 规格 | 第一次点击进入预备态（菜单项文案变为确认语义，如「再点一次确认卸载」）；第二次才执行；失焦/Esc/选其它项取消预备。或轻量 confirm 面板二选一，**推荐两段式**（与 ⌫ 删标签语义一致，无额外 modal）。文案 i18n 中英齐全 |
| 文件 | `src/surfaces/PluginsContent.tsx`；`src/locales` 或设置/插件相关 locale |
| 验收 | 点一次不卸载；点两次卸载；Esc/点外部取消预备；中英文正确 |

#### 1.2 P1-2 / M4 busy 反馈

| 项 | 内容 |
|----|------|
| 现状 | `GlobalLauncherCollectInputFrame` / `LauncherParamStep` busy 仅静态 `"..."` 或禁用输入；`anim-running-pulse` 已在 `index.css` 定义未用 |
| 规格 | busy 态挂 `anim-running-pulse`（或等价 class）；脉冲周期约 0.8s；`prefers-reduced-motion` 下无脉冲（沿用全局 reduced-motion 规则）。不在此包做 live preview |
| 文件 | 上述组件 + `src/index.css`（可微调 pulse 时长） |
| 验收 | 触发需等待的 collect-input（如翻译）可见脉冲；reduced-motion 下无动画 |

#### 1.3 P2-3 插件设置对话框焦点管理

| 项 | 内容 |
|----|------|
| 现状 | `PluginSettingsDialog.tsx` 无 focus trap、无打开移焦、无关闭还原、缺 `role="dialog"` / `aria-modal` |
| 规格 | 打开：焦点移入对话框内首个可聚焦控件；Tab 循环限制在对话框内；Esc 关闭（若尚未有）；关闭：焦点回到触发控件。补 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`（标题 id）。内嵌二级 modal 同样最小可用 |
| 文件 | `src/components/PluginSettingsDialog.tsx`（及相关 hook 若已有焦点工具则复用） |
| 验收 | 键盘 Tab 不穿透遮罩；Esc 关；关后焦点回到打开按钮 |

#### 1.4 V8 清 indigo 残留

| 项 | 内容 |
|----|------|
| 现状 | `--accent-tint: #eef2ff`（indigo-50 系）；多处边框 `#c7d2fe`（indigo-200）；`--accent-soft` 应用混用 |
| 规格 | soft/tint 从品牌蓝派生：`color-mix(in srgb, var(--accent) 8%, #fff)`（dark 用对应暗底 mix）；所有 `#c7d2fe` 边框改为 `color-mix` 或 blue-200 `#bfdbfe` 的 token 化写法。禁止残留 indigo 色板硬编码 |
| 文件 | `src/index.css` token 段及引用处 |
| 验收 | 选中行 / footer primary kbd 无肉眼可辨紫向；dark/light 各扫一眼 |

#### 1.5 V9 `--radius-sm` 冲突消除

| 项 | 内容 |
|----|------|
| 现状 | 同文件两处 `:root` 级 `--radius-sm`（6px vs 7px），后者静默胜出 |
| 规格 | 只保留一个定义（建议 6px 或 7px 与 launcher 块统一，**拍板：以 launcher redesign 块为准 7px**，删除早期 6px 重复定义）；不在本包清全部硬编码色 |
| 文件 | `src/index.css` |
| 验收 | 全文件仅一处 `--radius-sm` 赋值；构建通过 |

---

### 包二 · 合规清理（建议单 PR）

#### 2.1 i18n 八处硬编码

| 位置 | 处理 |
|------|------|
| `GlobalLauncherFrames.tsx` "Surface not found" | locale key |
| `ObjectBlockToken.tsx` 「内容已隐藏」/「再按 Backspace 删除」/`aria-label` / badge snapshot·invalid | locale keys（中英） |
| `OutputTargetExpansion.tsx` 「默认」「↵ 确认 · esc 返回」 | 若组件删除则随死代码去；若保留则 i18n |
| `PluginSettingsDialog.tsx` "No settings available…" | locale |
| `PluginSettingsSchemaRenderer.tsx` Hide/Show aria-label | locale |

#### 2.2 死代码与假入场

删除或接线（本包以**删除未使用**为主；接线留给包三的仅 `anim-dropdown` / `anim-running-pulse` 已在包一用 pulse）：

- `RecommendedActionRow` / `OutputTargetExpansion`：确认无引用后删除，或明确注释「禁用保留」二选一——**拍板：删除死 UI 路径**（推荐动作已走 ranking，见 `GlobalLauncherSearchFrame` 空数组）
- CSS：`view-enter*`、`anim-card-in`、`anim-console-line`、`anim-bump`、`anim-badge-pop`、未使用的 `.toast-container` 底弹套、`object-target-push`、`.search-highlight`（V11）
- `.palette-panel` 假入场 transition：删除 transition 声明，保留瞬开为显式决定
- `anim-dropdown`：**保留**给包三 P3-6 接线，不删
- `anim-running-pulse`：包一已用则保留
- 重复选择器 `.l-suggest-row-secondary:focus-visible`
- `ObjectBlockToken` 注释 "purple border" → 改为品牌蓝描述

#### 2.3 验收

- 全仓 grep 上述硬编码英文/中文 UI 串为零（测试 fixture 除外）
- 无新增用户可见 hardcode
- `npm run build` 通过；手动开 launcher / 设置 / 插件页无白屏

---

### 包三 · 视觉质感与动效（可拆 1–2 个 PR）

| ID | 规格摘要 | 主文件 |
|----|----------|--------|
| V1 键帽 | `.kbd` 微渐变 + 底边加重 + 1px 投影 + inset 高光；与 demo 一致 | `index.css` |
| V2 浮层规格 | 对话框/菜单统一：圆角档位、描边、三层影、引用 `--shadow-panel`；去掉设置对话框内联阴影魔法数 | `PluginSettingsDialog`、`index.css` |
| V7 字体 | 删除 Google Fonts `@import`；全局使用系统栈（与 launcher 块对齐的 `-apple-system, "SF Pro Text", "PingFang SC", …` mono 用系统 mono） | `index.css` |
| V10 发丝线 | 新增 `--hairline`；高频 0.5px/1px 混用处逐步替换（本包至少：卡片、按钮、kbd、launcher 边框主路径） | `index.css` |
| P3-6 | 设置对话框 / ⋯ 菜单 150ms ease-out 入场；`anim-dropdown` 接线；`transform-origin` 指向触发点（菜单）；launcher 本体保持瞬开 | 对话框、菜单、`index.css` |
| M1 | Toast 入场/退场 transition（非不存在的 `animate-slide-in-right`）；exiting 延迟卸载 | `ToastContainer.tsx` + css |
| M2 | 去掉搜索驱动列表行 `anim-palette-item` 入场（或仅首次打开播一次） | `LauncherMixedList.tsx` / css |
| M5 | 删 `.global-launcher-panel` / `.global-launcher-body` 的 height/max-height 70ms transition | `index.css` |
| M6 | tab indicator 改 transform，去 overshoot | `index.css` |
| M7 | 6 处 `transition: all` 改为具体属性 | `index.css` |
| M8 | `.l-search .back`、`.object-block-remove` 补 `:active scale(0.93)` | `index.css` |
| M9 | 删 `.l-row` 的 `will-change: background` | `index.css` |
| V3 | 插件图标六色板去紫粉；需出小稿或按「品牌蓝+冷灰」直接改 `PluginsContent.tsx` hash 色板 + dark 值 | `PluginsContent.tsx` |
| V9 规矩 | 本包改动处只用 launcher 系 token；不强制清全部 132 处硬编码 | 约定写入 PR 说明 |

**P3 其它（7–16）**：本包有余力可顺手做 7（菜单键盘）、8（plugins-row focus-visible）、9（tertiary 对比度升 text-2）、11–15；做不完可记 follow-up，**不阻塞包三合并**。P3-10 全局 focus-visible 审计可单开 PR。

**验收：** light/dark 下 launcher + 设置 + 插件页截图或手测；toast 进出可见；搜索打字列表无左右滑入；字体离线可开无 FOUT；四件套通过。

---

### 包四 · 交互重设计（独立设计稿门禁）

**本审查文档不替代包四正式设计。** 开工前必须另文（建议 `doc/YYYY-MM-DD-launcher-token-input-live-preview-design.md`）分段确认，并对照 demo `doc/2026-07-19-launcher-interaction-redesign-demo.html`。

已拍板摘要（防止执行漂移）：

| 阶段 | 必须 | 禁止 |
|------|------|------|
| 01 搜索 | 维持交互；可享用包三键帽 | 改信息架构 |
| 02 参数 | 命令塌缩为行首**蓝色标签**；参数**下拉列表**同构搜索列表；⌫ 两段式删标签返回 | 行内 chips；返回按钮；参数键帽 token |
| 03 执行 | 纯函数 **live preview**；回车只定去向；去向徽章 `↵ 复制` / `⌘↵ 粘贴到前台` / `⇥ 切换`；已选参数轻量灰值块 | 为键盘导航加帧过渡动画 |

并行出稿（不阻塞 02/03 代码，但建议同里程碑）：V4 立体黑、V5 空井（兼解 P2-5 fallback）。

**验收：** 以包四正式设计文档的验收表为准；另加 architecture / build / 真机 DOM。

---

## 8. 非目标与依赖

### 8.1 非目标（本文不覆盖）

- 剪贴板历史 ⌘Enter 带回 Launcher（见 `doc/2026-07-19-clipboard-history-return-to-launcher-design.md`）
- Launcher 智能化 / Desktop Target（见同日路线与 desktop 设计）
- 重做整套组件库或引入第三方 UI kit
- 为「看起来一致」给 Global Launcher 窗口本身加 show/hide 动画（明确禁止）
- 包四未确认前的 live preview / token 输入行实现

### 8.2 依赖

| 依赖 | 说明 |
|------|------|
| 包一 → 无 | 可直接开工 |
| 包二 → 无硬依赖 | 建议包一之后，避免与焦点/对话框同 PR 冲突 |
| 包三 → 包一 V8/radius 更干净 | 可合并前 rebase |
| 包四 → §2 正式稿 + 建议包三键帽/token 稳定 | 硬门禁：无正式稿不写包四代码 |

### 8.3 与现网推荐动作架构的关系

`GlobalLauncherSearchFrame` 中 `RecommendedActionRow` 已禁用，推荐走 ranking + `objectBlockText`。包二删除死 UI 时**不要**误删 ranking / `textMatch` 路径。包四 live preview 是命令执行帧协议，与 Object Block 推荐是不同层。

---

## 9. 验证与交付

每包完成后：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

涉及可视 UI：至少手测 Global Launcher、设置页、插件页、插件设置对话框；包三加 toast 与 dark 主题。

PR 说明须列出：本包关闭的问题编号（P/V/M）、未做的 follow-up、截图或手测步骤。

---

## 附：相关文件与规则来源

- 交互 demo：`doc/2026-07-19-launcher-interaction-redesign-demo.html`
- 立体白基线：`doc/2026-07-07-light-theme-tactile-white.html`
- 前序打磨：`doc/2026-07-07-ui-experience-polish-design.md`
- 插件边界：`doc/diff-plugin-boundary-decision.md`
- M 系列：emilkowalski/skills（emil-design-eng、apple-design；更严可跑 `/review-animations`）

**结论：审查文档完成。包一–三可交执行 AI 按 §7 开工；包四先出正式交互设计再实现。**
