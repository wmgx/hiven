# Light 主题「立体白」+ 设置/插件页重设计

> 状态：设计已拍板（2026-07-07，与用户逐项确认）。本文档面向执行 AI，假定执行者对代码库零了解。
> 效果图（浏览器打开，是本设计的视觉基准）：
> - `doc/2026-07-07-light-theme-tactile-white.html` —— 立体白视觉语言终版（灰域撤退+冷调净灰版；忽略其中 7 个 accent 候选切换，最终 accent 见 §2.3）
> - `doc/2026-07-07-detail-forms-alternatives.html` —— 第一章「方案 2 弹窗内主从」与第二章「方案 2 疏朗版行内」为拍板方案
> - `doc/2026-07-07-system-panel-mockup.html` —— 插件页/设置页整体布局参考（其配色是废案，只看布局与信息层级）

## 1. 背景、范围与已拍板决议

用户诉求：light 主题「朴素到丑」；设置页、插件页设计不好，插件页功能多但信息架构乱、没产品感、整体不协调。

盘点确认的技术根因（详见 §7 证据）：
- 两套互不知晓的 token 体系并存，设置/插件页同一元素挂两套 class，视觉靠 CSS 层叠碰运气；
- `--color-bg-hover`/`--color-bg-active` 被引用但从未定义，Tab 与面包屑按钮 hover 无反馈（light、dark 都坏）；
- light 主题被有意做平（无阴影、三级弱灰阶），与 dark 的质感投入不对等；
- 插件详情面板把描述/权限/快捷键/内嵌设置表单全部纵向堆叠，翻译插件详情实测约 1200–1500px（详情区仅约 700px）。

### 改动范围（严格遵守）

| 属于本次 | 不属于本次 |
|---|---|
| light 主题两套 token 体系的**色值**（结构/命名不动） | dark 主题任何色值（唯一例外见 §2.4 hover 修复） |
| 设置页、插件页、系统面板外壳的结构与样式重写 | Launcher 自身布局/交互（它吃到新 token 值属正常连带） |
| 插件设置弹窗统一与 schema 渲染器重排 | Quick Editor、Text Diff、托盘 |
| 两个 SDK 轻扩展：字段 `group`、`sensitive`（§5.4） | 其它 SDK/框架 API 变更 |
| 插件页死代码清理、3 处硬编码文案修复 | 与本设计无关的 lint/历史问题 |

### 用户逐项拍板记录

1. 视觉方向：**立体白（Tactile White）**——白色为主背景；克制但不扁平，立体感靠光影/材质不靠涂色；忌「灰底白卡+单色 accent」大众模板。
2. 灰阶：**冷调净灰**（禁发黄暖灰 greige），且**灰面积最小化**——大容器一律纯白，灰只留给小件。
3. accent：**保持现状**——`#2563eb` 及浅蓝 hover/选中 tint（`--accent-soft`/`#eef2ff` 一族）原样不动。禁令「不要蓝紫（AI 色）」针对的是引入新蓝紫配色，不针对既有品牌蓝。
4. 插件页：**平铺单列表**（不分组、不做分组逻辑），来源用行上小 tag；行内展开**疏朗版抽屉**（≤120px）；插件设置**统一弹窗**；弹窗内多条目配置用**主从布局**。
5. 设置页：双 Tab 外壳不变；内部重组（「行为」组并入「通用」，版本+更新做底部关于卡）。
6. dark 主题像素级不变；唯一例外是补两个缺失变量定义（修 bug，用户已同意）。

## 2. 视觉规范「立体白」

### 2.1 中性色（两套 token 体系的 light 值都要改）

系统 A（`src/index.css` `[data-theme='light']` 块，约 182–243 行）：

| Token | 现值 | 新值 |
|---|---|---|
| `--bg-page` | `#f3f3f3` | `#ffffff` |
| `--bg-surface` | `#ffffff` | `#ffffff`（不变） |
| `--bg-surface-2` | `#f3f3f3` | `#f7f8f8` |
| `--bg-surface-3` | `#e8e8e8` | `#ecedee` |
| `--text-primary` / `--color-text` | `#000000` / `#1e1e1e` | `#1a1c1e` |
| `--text-secondary` | `#6f6f6f` | `#686d71` |
| `--text-tertiary` | `#8a8a8a` | `#999fa4` |
| `--border` | `#e5e5e5` | `#e7e8e9` |
| `--border-subtle` | `#ededed` | `#f0f1f2` |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.05)` | `0 1px 1px rgba(0,0,0,.03), 0 2px 8px rgba(0,0,0,.04)` |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,.07)` | `0 8px 24px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04)` |
| `--shadow-panel` | `0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)` | `0 12px 40px rgba(0,0,0,.14), 0 0 0 1px rgba(0,0,0,.05)` |

系统 B（`src/index.css` 第二个 `:root`，约 4081–4097 行；其值即 light 默认值）：

| Token | 现值 | 新值 |
|---|---|---|
| `--panel` | `#ffffff` | `#ffffff`（不变） |
| `--surface` | `#f5f5f6` | `#f7f8f8` |
| `--surface-2` | （现值以文件为准） | 对齐 `#ecedee` 档位 |
| `--border` | `#ececed` | `#e7e8e9` |
| `--text` | `#1c1c1e` | `#1a1c1e` |
| `--text-2` / `--text-3` | （现值以文件为准） | `#686d71` / `#999fa4` |

执行时以实际文件内容为准逐个变量核对；上表未列出的 light 灰阶变量按同一原则归位：**背景类 → #ffffff / #f7f8f8 / #ecedee 三档；文字类 → #1a1c1e / #686d71 / #999fa4 三档；边框类 → #e7e8e9 / #f0f1f2 两档**。凡发黄暖灰（R 通道明显大于 B 通道的灰）一律替换为上述冷调对应档。

### 2.2 灰面积使用规则（本次「不丑」的关键）

- **纯白容器**：面板、侧栏、面包屑头、卡片、弹窗、列表底一律 `#ffffff`；区域分隔用发丝线（1px `--border-subtle`）+ 细微阴影，禁止用灰色块铺大面积底。
- **灰只允许出现在小件上**：输入框/搜索框内凹底（`#f7f8f8`）、hover/按压态、键帽、开关关闭态轨道、禁用态。

### 2.3 accent（不动）

`--accent: #2563eb`、`--accent-hover: #1d56d8`、`--accent-tint/--accent-soft: #eef2ff` 一族全部保持现值。使用场景收敛为五类：选中态药丸淡底、主按钮、焦点环、开关开启态、链接；其余一律中性色。

### 2.4 交互反馈 token（修 bug，唯一动 dark 的点）

新增定义（当前被 `SystemSettingsSurface.css:40,44`、`SurfaceBreadcrumbHeader.css:29,71` 引用但从未定义）：

```css
[data-theme='light'] { --color-bg-hover: rgba(26,28,30,.05); --color-bg-active: rgba(26,28,30,.09); }
[data-theme='dark']  { --color-bg-hover: rgba(255,255,255,.06); --color-bg-active: rgba(255,255,255,.10); }
```

### 2.5 材质六件套（重写两页 CSS 时的构件规范）

1. **凸起控件**（按钮/步进器/开关开启态）：`background: linear-gradient(180deg, #ffffff, #f6f7f7)`；边框 `#e7e8e9` 且 `border-bottom-color: #dcdee0`；`box-shadow: inset 0 1px 0 rgba(255,255,255,.7)`。accent 主按钮同理做深色渐变（`linear-gradient(180deg, #3b76f0, #2563eb)` 一类）+ 顶部内高光。
2. **内凹输入**（搜索框/文本框/开关关轨道）：底 `#f7f8f8` + `inset 0 1px 2px rgba(0,0,0,.06)`。
3. **卡片**：1px `--border` + `--shadow-sm` 双保险，禁止只靠一条边框线。
4. **浮层**（菜单/弹窗）：菜单用 `--shadow-md`，弹窗/面板用 `--shadow-panel`。
5. **键帽**（快捷键展示）：白底、1px `#e7e8e9`、`border-bottom: 2px solid #dcdee0`、圆角 5px、等宽字体。
6. **滑钮/状态点**：`0 1px 3px rgba(0,0,0,.18)` 投影。

### 2.6 两页的 token 收敛口径

重写 `SettingsContent`/`PluginsContent`/外壳的 CSS 时：**新样式只引用系统 A 语义 token（`--color-*`/`--bg-*`/`--text-*`/`--border*`/`--shadow-*`）+ §2.4 两个交互 token**，不再给元素挂系统 B 的 `.a-list/.a-detail/.prow/.sgroup/.scard/.srow` 等 class（这些选择器与三段重复定义一并删除，见 §6）。系统 B token 本身保留（launcher 等仍在用），只改值不改结构。

## 3. 插件页设计

宿主不变：Launcher host surface（`SystemSettingsSurface` 外壳的「插件」Tab，920×760 面板）。文件：`src/surfaces/PluginsContent.tsx`（重写其渲染层）。

### 3.1 页面骨架

```
[🔍 搜索插件…(内凹输入)]                 [＋ 添加插件 ▾]
──────────────────────────────────────────────
◈ 翻译        多引擎划词翻译   [内置]  ⚠1 ⌘T  ⚙ ⋯
◈ 剪贴板历史   剪贴板记录与搜索 [内置]     ⌘⇧V  ⚙ ⋯
◈ 网页快开     关键词直达网址   [内置]          ⚙ ⋯
◈ JSON 工具   （停用，整行降透明度）[已安装] [○]   ⋯
◈ 我的测试插件 （监听中●）      [DEV]            ⋯
（启停开关仅「已安装」插件渲染，内置/DEV 无停用能力，与现状一致）
```

- **平铺单列表，无分组、无分组逻辑**；三个旧 Tab（内置/已安装/开发中）删除，来源改为行上小 tag：「内置」「已安装」中性淡底、「DEV」虚线描边样式。搜索为全局实时过滤（匹配名称/描述/pluginId）。
- 「＋ 添加插件」保留现有三来源下拉：导入 GitHub（弹窗输入 URL）/ 导入 .zip / 导入本地文件夹。
- 排序：内置 → 已安装 → 开发中，同组内按标题；纯展示顺序，不渲染组头。

### 3.2 列表行（56px）

- 图标 32px 圆角：首方插件用现有 `src/plugin-ui-icons.ts` 映射的图标；每个插件配固定极淡彩底（低饱和淡青/淡橙/淡绿/淡玫等，按 pluginId 确定性哈希从 6 色板取色）；无图标的第三方插件用「标题首字符 + 同样哈希取色淡底」兜底。禁止所有行共用同一个 Package 图标（现状问题）。
- 中部：名称（13px/600）+ 单行截断描述（12px 次要色）+ 来源 tag。
- 右侧从左到右：待授权徽标（amber `#b45309`/`#fef3c7`，有缺失权限才显示）→ 快捷键键帽（有绑定才显示）→ 启停开关（builtin 不可停用则不渲染开关，与现状能力一致）→ ⚙（仅有 schema 设置的插件显示，点击开设置弹窗）→ ⋯ 菜单。
- ⋯ 菜单按来源组装（能力沿用现有 `renderPluginDetailActions` 的动作集，`PluginsContent.tsx:950-1076`）：打开面板 / 打开编辑器 / 重新加载 / 检查更新·执行更新（GitHub 来源）/ 在文件管理器中打开（dev）/ 开始·停止监听（dev）/ 分隔线 / 卸载·移除（红字 `#b0402f` 档）。
- hover 整行 `--color-bg-hover` 圆角药丸化（对齐 launcher 已拍板的药丸语言，替换 `.plugin-master-row.is-selected` 的左侧色条 inset box-shadow，`index.css:1834-1836` 一族删除）。

### 3.3 行内展开抽屉（疏朗版，拍板方案）

点行主体展开/收起，同一时刻只展开一行；展开行整体升级为带 `--shadow-sm` 的卡片。抽屉内容**只有三行等高摘要行**（行距 12px，左缩进对齐图标右缘，总高 ≤120px）：

1. `权限 ｜ 剪贴板读取 · 高敏感 〔授权〕 ｜ 已授权 2 项` —— 每条缺失权限一个〔授权〕小按钮 + 头部可放〔全部授权〕；权限含义/影响说明**不平铺**，收进每条权限旁的 ⓘ 图标 hover tooltip（tooltip 内容沿用现有文案：权限含义说明 + 具体影响说明 + 敏感度）。
2. `快捷键 ｜ 翻译面板 ⌘T 〔重录〕〔打开〕` —— 每个可绑定 surface 一段；键帽样式按 §2.5-5；〔重录〕唤起现有 `ShortcutRecorder`，注册状态/冲突文案显示在该行下方 12px 小字。
3. `关于 ｜ v1 · 内置 · ●已加载 · ~/plugins/translate` —— 版本、来源、状态点、路径（dev 插件路径可点击在文件管理器打开）；能力 chip（command/instant-suggestion 等）附在行尾；错误信息（若有）以红字替换本行。

被删除的旧详情面板职责去向：描述 → 列表行本身；内嵌设置表单 → 设置弹窗（§5）；主操作「打开」→ 快捷键行的〔打开〕+ ⋯ 菜单。

### 3.4 空态与错误

- 搜索无结果 / 无插件：居中图标 + 一行说明（i18n），沿用现有分来源空文案语义。
- 列表加载/安装/导入错误：页面顶部一条错误横幅（amber/red 档 + 图标），不打断列表。

## 4. 设置页与外壳设计

### 4.1 外壳 `SystemSettingsSurface`（结构不动，视觉重做）

- 左侧栏 176px：纯白底，「设置 / 插件」两 Tab 选中态改**圆角药丸**（`--accent-soft` 淡底或中性 `#f2f3f4` + 加重文字，与 launcher 药丸语言一致）；hover 用 `--color-bg-hover`（§2.4 修复后自然生效）。侧栏与内容区之间用发丝线分隔，禁止灰底块。
- 面包屑头 40px：白底 + 底部发丝线；返回/关闭按钮 hover 修复随 §2.4 生效；`SurfaceBreadcrumbHeader.tsx:22` 的硬编码「hiven」文案迁入 i18n。
- 面板外壳（`GlobalLauncherLayout.ts` 中 `buildGlobalLauncherPanelStyle` 的内联样式）吃到新 `--shadow-panel` 值即可，不改结构。

### 4.2 设置页内部（`SettingsContent.tsx` 重组）

分组从「通用/快捷键/编辑器/行为/更新」5 组重组为 3 组 + 1 卡：

1. **通用**：语言（LocaleSelect 下拉，保留切换后提示遮罩+reload 逻辑）/ 暗色主题开关 / **保留调试参数开关（自「行为」组并入）**。
2. **快捷键**：全局启动器快捷键（ShortcutRecorder + 注册状态与无障碍权限提示文案，显示在行下方小字）。
3. **编辑器**：字号步进器（10–24）/ 自动换行 / 行号。
4. **关于卡（底部，横向布局，与设置卡视觉区分）**：左侧「hiven」+ `v{appVersion}` + 更新状态小字；右侧「检查更新」次按钮。完整保留现有 `UpdateChecker` 状态机（检查/下载/安装/重启 + 内置插件更新检测），状态文案在卡内展开。

控件统一按 §2.5 材质规范重做：分组标题 12px/500 三级文字色；卡片=白底+边框+`--shadow-sm`；行 44px，行间 `--border-subtle` 分隔；行左图标 28px（沿用现有 lucide 图标）。

## 5. 插件设置弹窗与 Schema 渲染器

### 5.1 设置路径统一

- 删除插件页详情内嵌设置（`PluginSettingsInline` 在 `PluginsContent.tsx:1140-1144` 的挂载）；插件页 ⚙ 与插件 surface 内设置入口一律走 `PluginSettingsDialog`（已支持 schema，`PluginSettingsDialog.tsx:314-324`）。
- `PluginSettingsInline.tsx` 若因此无引用则删除（取值/迁移/权限包裹逻辑若被 Dialog 复用则保留该部分）。
- legacy 非 schema 路径：当前无插件使用（全仓 3 个 settings 贡献者均带 schema），Dialog 内兼容分支保留不动，不新增投入。

### 5.2 弹窗规格

约 640×640（随面板 `min()` 收缩），白底、`--shadow-panel`、遮罩点击/Esc/× 关闭（Esc 接入现有 escape 链，遵守 `doc/2026-07-07-escape-chain-unification-design.md`）。头部：插件图标 + 名称 + 「设置」副标题 + ×。

### 5.3 多条目配置=弹窗内主从（拍板方案，替换 object-list 手风琴）

`PluginSettingsSchemaRenderer.tsx` 的 `object-list` 渲染改为：

- 左列 150px：条目列表（行=条目标题 + 启用态小点，选中态药丸），底部「＋ 添加」；条目删除放右侧表单区头部（条目名 + 删除图标按钮）。
- 右侧固定表单区：渲染选中条目的子字段；**表单区位置和高度稳定**，切换条目不跳动；子字段仍用现有 `renderObjectListItemField` 的控件集（switch/select/string-list chip/textarea/text）。
- 空列表态：左列只有「＋ 添加」，右区放一行三级文字提示。
- 普通字段形态规则：开关/数字/下拉=行式（标签左控件右，44px）；文本/多行/标签组=块式（标签上输入下）；同形态连排共卡。数字字段展示友好单位（字节类显示 MB，读写时换算）。

### 5.4 SDK 轻扩展（两项，用户已认）

在 schema 字段模型（插件 SDK 公开类型）中新增可选属性，渲染器实现，两者都向后兼容：

1. `group?: string`（含 i18n 变体 `groupI18n`）：object-list 条目内子字段按 group 聚簇，渲染 12px 小节标题（如「基本/凭据/行为」）。未声明 group 的字段归入无标题首簇。
2. `sensitive?: boolean`：text 字段掩码显示（●●●● + 眼睛切换明文）；仅展示层掩码，存储不变。

随后更新两个插件的 schema 声明（注意 §7 插件版本号约束）：

- **翻译 `src/plugins/translate/index.tsx`**：profiles 子字段分组——基本（name, provider, enabled；id 保留但归入「基本」末尾）/ 凭据（endpoint, appId, secret, authKey，全部 `sensitive: true`）/ 行为（defaultTargetLang, monthlyLimitChars）。
- **网页快开 `src/plugins/web-open/index.tsx`**：entries 子字段分组——基本（title, aliases）/ 打开行为（urlTemplate, matchPattern, encodeQuery, emptyQueryBehavior）。
- 剪贴板历史：结构不动，仅字节字段单位友好化。

### 5.5 P2 记录（本次不实施）

- `defaultProfileId` 由手填 text 改为引用 profiles 的动态下拉（渲染器需支持 options 引用兄弟列表字段）。
- provider 条件显隐（百度只见 appId+secret，DeepL 只见 authKey；需字段级 `visibleWhen`）。
- 网页快开 schema 内「启用插件」开关与插件级启停语义重叠，评估合并。

## 6. 清理与修复清单（都在重写范围内）

1. 死代码：`PluginsContent.tsx` 中从未被调用的旧卡片实现 `renderInstalled`（522–609）/`renderDev`（611–681）/`renderBuiltin`（683–730）/`PluginCard`（1357–1416）删除；对应死样式 `.script-card`（`index.css:833-866`、`1738-1753`）删除。
2. `index.css` 中插件页三段重复定义（约 1799–2010、5121–5306、5764–6252 里属于设置/插件页的部分）随两页 CSS 重写收敛为单一来源；行号会漂移，以选择器名定位。
3. 硬编码文案修 i18n：`PluginsContent.tsx:1233`（"GitHub URL"）、`PluginsContent.tsx:1328`（导入 placeholder）、`PluginSurfaceWindow.tsx:87,95`（兜底标题）、`SurfaceBreadcrumbHeader.tsx:22`（"hiven"）。
4. CSS class 命名沿用 `scripts-*` 旧前缀的，重写时改为 `plugins-*`；**i18n key 命名空间 `scripts.*` 保持不动**（避免 key 迁移风险），仅新增 key 时用合理命名。

## 7. 约束、验收与验证

### 硬约束

- 所有新增/改动用户可见文案必须走 i18n 管线，中英同步；禁止硬编码（含临时调试文案）。
- 插件（translate/web-open/clipboard-history）只能通过 host API/SDK 使用能力；SDK 扩展走公共类型定义，禁止插件 import workspace/framework 内部实现。
- 插件行为/schema 变更后必须同步递增插件版本号并确认释放目录加载到新版（项目 CLAUDE.md 约定）。
- dark 主题除 §2.4 两个新增变量外零改动；可用截图对比验证。
- framework/plugin 边界（项目 CLAUDE.md）不动：本设计不新增任何带产品语义的 framework 概念。

### 验收标准

1. light 下设置页/插件页/弹窗与 `doc/2026-07-07-light-theme-tactile-white.html` 的材质语言一致：白容器+发丝线分层、凸起/内凹/键帽材质、无发黄暖灰、无大面积灰底。
2. 插件页为平铺单列表；行展开抽屉 ≤120px 且只含三行摘要；权限说明在 ⓘ tooltip 中可见；同一时刻仅一行展开。
3. 翻译设置弹窗：API 配置为左右主从；DeepL 表单呈「基本/凭据/行为」三小节；凭据字段掩码可切换明文；切换条目表单区不跳动。
4. 设置页为 3 组 + 底部关于卡；「行为」组不复存在；更新状态机全功能保留。
5. Tab、面包屑按钮 hover 在 light/dark 下均有背景反馈（bug 修复验证）。
6. 中英两个 locale 下所有新页面文案正常显示，无 key 泄漏、无硬编码。
7. 旧 Tab 分段控件、左列表右详情、内嵌设置表单、死代码卡片实现全部不复存在。

### 验证命令（项目规定）

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

UI 改动必须补浏览器实测（真实 DOM/画面），dark 主题回归截图对比；`npm run lint` 若执行需区分历史问题与新增问题。
