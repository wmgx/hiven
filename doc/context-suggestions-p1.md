# “猜你想干”受限 P1（独立实验）

从已推送 `dot/ai-reliability` 基线 `0ee4804` 建立本地 `dot/context-suggestions`。不修改日常分支，不包含时间模式、剪贴板信号、正文分析、workflow 或 LLM 预测；本轮不推送、合并、发布。

## 产品边界

- 默认关闭；设置页独立显式开关和清除。下一次打开全局启动器生效。
- 仅真正空 query、空闲搜索根显示最多三条带解释建议。输入（含空格）、IME composition、浏览动作、材料/文件流程、忙碌、结果、设置/插件/权限页退出建议。
- 建议是同一 launcher 列表的普通动作，显式选择后使用原执行流程，不自动执行。原全文搜索排序未改变。
- 同一来源应用至少三个不同 session 的成功记录，才能解释为“在此应用中常用”。按真实时间序列的既有 2 天/45 天双尺度 frecency 排序；不足则按全局最近成功补位，解释“最近使用”。不迁移或伪造旧 usage 的应用历史。
- 仅静态协议 actionKey 白名单；不接受动态条目、文档/窗口/URL/路径/已保存 workflow key。候选复用安装、权限、可用性过滤；收藏不重复，已建议动作从普通最近列表去重。
- 打开时冻结来源及列表顺序。迟到候选/旧 foregroundApp 查询不插入本次建议；无建议时正常显示原来的最近列表。权限撤销或卸载可移除动作。
- 开启期间暂停自动读取/附加 launcher 剪贴板，避免迟到 hint/block 替换键盘默认目标；主动粘贴、文件选择和显式材料交接仍可用。设置中明确说明此影响。既有其他剪贴板功能不属于本功能的新采集。

## 数据与成功边界

独立本地键 `hiven-context-suggestions-v1`。成功记录仅包含 `actionKey / originAppId|null / at / session`；无正文、标题、URL、路径、正文哈希、PID。最多 1000 条成功事件、1000 条指标 session，90 天逻辑保留；启动、读取/写入和窗口恢复时清理过期数据，应用不运行时不声称后台物理删除。

controller 在异步准备前捕获来源/会话，成功 commit 才回调；参数输入、预览、失败、取消不增加成功记录。插件面板另在异步准备前捕获成功 observer。关闭/清除更新 epoch，旧回调不能回填；磁盘写入失败也以内存状态停止采集，显示保存错误并广播停止到其他窗口，统计失败不能打断原动作。

本地指标按实际展示 session 去重：N 展示、S 明确选择、E 该建议尝试确认成功。输入/Esc 为未命中，不作负反馈。60% 仅是用户目标，当前无个人真实使用样本，未宣称达到。

## 来源应用

原生 show 之前捕获并随 open event 传入，不使用打开后 200ms 的实时 appName。

- macOS：bundle ID，过滤本应用；未进行 macOS 实机验收。
- Linux：已确认 X11 session 下被动读取活动窗口 WM_CLASS 的 resource class，以 `x11-class:` 标识；不读取窗口标题/正文，不新增 OS 权限。
- Wayland、Windows、身份缺失或格式不可靠：null，诚实退回最近使用。未声称支持其应用推荐。

## 验证记录

- `npm run test:context-suggestions`：选择器、独立session门槛、去重、隐私白名单、保留上限、默认关闭、N/S/E、跨会话、清除/关闭及写入异常测试通过；真实 controller 成功/失败/取消/归属测试通过。
- `npm run check:typecheck`、`npm run check:architecture`、`npm run build`、`git diff --check` 通过。
- `npm run test:launcher-visible-items` 13 项通过。
- `test:ime-enter-confirmation` 在基线 `0ee4804` 与本分支同样失败：既有 ClipboardHistorySurface 静态契约；`test:launcher-plugin-lifetime` 同样在原基线缺 `../../historyDiffHandoff` stub。未将其算作本次通过，也不扩展本轮修复范围。
- 独立审查者复审排序、隐私、键盘和失败边界，当前无明确高优先级待修项。
- 官方 Rust + Debian 用户目录工具链的 Linux 原生编译通过。隔离 Xvfb/Openbox、官方 AppImage portable profile、tauri-driver/WebKitWebDriver 链已通。发现增量构建曾嵌入旧dist，因此强制清理本任务 hiven target 后重新嵌入，并以原生页面 script hash 核对。最终前端 entry 为 `index-B_iATRDw.js`；实际 `tauri://localhost` WebView script 与之精确匹配。

工具链/日志/原生截图位于独立 `/workspace/context-native/`，未读取真实用户 profile、账号或秘密。模拟元数据与真实外部 XTerm 来源的验收结果分别记录，不把 Linux 结果外推至其他平台。


## 最终原生验收（2026-10-11）

真实 Tauri AppImage + WebKitWebDriver（wry 0.55.1），Xvfb/Openbox，`DISPLAY=:91 XDG_SESSION_TYPE=x11`，官方 portable profile。全程未关闭 WebKit sandbox。页面入口、原生 IPC 与最终资源 hash 验证通过。

- **真实来源/成功**：产品设置显式开启之前无 feature 存储键。开启后，从外部 XTerm 打开 launcher，使用真实 Enter 执行“设置”，记录来源为 `x11-class:xterm`；前三个独立成功 session 后显示“在此应用中常用”。未把 PID、窗口标题或 query 存入新记录。证据：`/workspace/context-native/real-xterm-evidence.json`、`real-xterm-suggestion.png`。
- **键盘和指标**：聚焦 launcher 后，真实 Enter 与 Ctrl+1 均执行同一首条建议，S/E 均为 true；同一展示会话仅一条 N。输入后正常搜索成功仍记录历史，但不计为建议 S/E。证据：`real-keyboard-metrics.json`。
- **IME/空格**：在真实原生 WebView 派发 compositionstart/end（模拟输入法事件），composition 期间发送真实系统 Enter，未执行动作；空格和普通输入立即撤下建议。此项不是安装中文输入法的完整实机验收。
- **隔离合成数据**：仅在已显式开启的测试 profile 注入静态动作元数据，验证最多三条、同 key 去重、不把缺失 app 依据包装成应用推荐、未安装 key 排除、收藏不重复。打开后注入迟到元数据，行顺序与快捷键映射不变，N 不重计。证据：`synthetic-top3-frozen.json`、`synthetic-top3-frozen.png`。
- **关闭/清除**：使用产品 UI 关闭后再次实际执行“设置”，事件/指标均不增长；产品 UI 清除后只有该功能记录/计数归零，其他 localStorage key 保留。测试结束为关闭、空记录。英文及中文设置文案真实 DOM/截图确认。证据：`native-boundary-results.json`、`disabled-cleared.png`、`zh-ui-evidence.json`、`settings-zh.png`。
- **唤起成本**：真实 XTerm 验证时间窗内 12 个 `native:main-thread-open` 样本为 0–2ms（包含可见重开），仅限该环境，不外推性能承诺。

初轮验收限制：Openbox 下程序化 show/合成全局热键未稳定自动取得键盘焦点，初轮测试用标准窗口管理器显式聚焦 launcher 后发送键盘事件；当时仅验证键盘目标与执行映射。此焦点问题随后进行了下面的独立基线对照及修复，不把初轮手动聚焦当作自动焦点通过。真实中文 IME、macOS/Windows/Wayland 全链仍未验。实现缺失来源时回退最近使用；原生权限撤销/卸载完整交互未实测，复用了现有严格 availability 过滤及执行检查。

本地实现提交 `0c62554`，无远端新分支、无合并、无发布。环境断连提示后已实际复查，命令与文件持续可用；修改完整保存在独立本地分支。


## Linux 窗口焦点跟进（2026-10-11）

用户要求核实正常唤起是否需要额外点击，以及 Enter 是否可能落到原窗口；本次仅修复同一独立分支的 Linux 窗口聚焦，不扩大 P1 信号或采集。

**直接对照**：相同 Xvfb/Openbox、实际 XTest 热键和独立 AppImage profile。外部 XTerm 运行专用原始字节接收器，输入为合成字符串，不执行 shell 命令。未修 P1 6/6 暖打开持续不获焦；精确基线 `0ee4804` 首次冷打开成功，随后 5/5 暖打开失败；基线真实 Esc → 热键重开也失败。失败时 query 为空，全部字符及 Enter（字节 13）进入外部窗口。因此是该环境可复现的基线应用焦点缺陷，不是 P1 回归，也不能将其归咎为必须手动聚焦的验收条件。证据：`focus-p1.json`、`focus-baseline.json`、`focus-baseline-esc.json`。

**根因与修复**：当前 Tao 0.35.2 Linux `set_visible` 排队显示，`set_focus` 却同步检查 GTK 可见性；隐藏窗口执行原来的 `show → unminimize → set_focus` 会跳过焦点请求。已显示后再单次调用既有 focus IPC 则可获焦（仅诊断，未计入验收）。改为在现有主线程闭包，通过 [Tauri 的公开 GTK handle](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html#method.gtk_window) 同步 `show_all → deiconify → present`；[GTK present](https://docs.gtk.org/gtk3/method.Window.present.html) 将焦点请求交给窗口管理器。无延迟重试、直接 XSetInputFocus、键盘抓取、输入重放、权限扩展或安全禁用。macOS/Windows 路径未改。独立审查确认四个调用点均在主线程，既有粘贴恢复的有效性检查保留。

**修复后的真实原生结果**：测试不调用手动 launcher 聚焦、DOM focus 或诊断 focus IPC。只在唤起之前正常激活外部窗口。

- IPC / 配置热键交替 6/6 自动获焦，完整字符串和 Enter 均进入 launcher，外部收到 0 字节。暖打开最早约 60ms 采样已获焦；首次冷打开 48ms 仍未获焦、144ms 样本已获焦，不能外推为通用启动时延保证。证据：`focus-fixed.json`。
- 真实 Esc → 全局热键 → 等待 100ms → 输入/Enter，6/6 正确且外部 0 字节；另一次直接键入 `settings`，首项为 Settings，真实 Enter 打开设置页面，外部 0 字节。证据：`focus-fixed-100ms.json`、`focus-fixed-settings-before.json`、`focus-fixed-settings-after.json`、`focus-fixed-settings.png`。
- 主动切回外部窗口后连续观察约 1.7 秒，无迟到回抢；最小化后热键恢复获焦。证据：`focus-fixed-followup.json`。
- **剩余交接风险**：热键释放后零等待连续注入字符，3 轮中 2 轮最前两个字符赶在 WM 焦点交接前进入外部窗口，余下字符和 Enter 进入 launcher。此原始结果完整保留在 `focus-fixed-followup.json`，不以延迟后的通过覆盖，不宣称“任意时刻立即输入都不会落错窗口”。本轮修复持续不获焦的缺陷；极短间隔输入仍有正常异步窗口交接边界，不引入全局键盘抓取或重放来掩盖。

焦点跟进使用全新隔离 profile，功能始终关闭，设置页 N/S/E 为 0，feature storage key 仍为 null；未增加真实或模拟推荐记录，未改真实设置。包内与实际 WebView 均为 `index-B_iATRDw.js`。修复 AppImage SHA256：`bd8fafd05e62e61c9e59ba17f311b0d1a600e3330faeeb90c58bfdf75cb5ce7b`；文件 `/workspace/context-native/candidates/focus-fixed.AppImage`；构建证据 `candidates/focus-fixed-build-evidence.json`。上述相对证据均位于 `/workspace/context-native/`。

`cargo check`、锁定依赖原生构建、官方 AppImage 打包、架构检查及 diff 检查通过。只有既有 GTK 0.18 增为 Linux 显式依赖，无依赖升级。焦点跟进仅在 Linux X11/Openbox 实测，其他窗口管理器及平台未验。仍无推送、合并或发布。

## 日常分支集成（2026-10-11）

将公开 `dot/context-suggestions` 的 `1772415` 合入 `dot/ai-reliability`，保留 `a31adde` 的手动保存工具显式更新与旧自学习撤除。controller 冲突同时保留输入草稿清理和预测成功回执观察，不恢复旧 journal、指纹、挖掘或设置。

集成验收发现首次冻结列表会漏掉异步到达的普通应用。修正为只在冻结列表末尾追加新普通项，原有顺序与数字快捷键不变；预测项继续复核当前可用性。

在独立 Linux X11/Xfwm4 profile 中实际加载集成 AppImage，确认原生 WebView 入口与本次前端产物一致。真实 UI 验证：默认关闭且无功能存储记录、显式开启、仅合成静态元数据的 top 3、迟到元数据不改变 Ctrl+1 指向、晚到普通应用保留、输入后建议退出、模拟 composition 期间真实 Enter 不执行、自动剪贴板不附加而主动粘贴全文正常。手动 JSON 工具保存别名、重放与原工具显式更新继续可用，动态 SavedAction 标识不进入预测记录；旧学习搜索与设置入口不存在。产品 UI 关闭并清除后再成功执行动作，记录及计数保持为空，测试结束关闭且清空该功能，删除合成保存项。

跨窗口关闭/清除与迟到回执不回填由专项逻辑检查验证；未在原生 UI 中成功制造可控的迟到原生回执，不将其标作真实 UI 已覆盖。真实中文输入法及 macOS、Windows、Wayland 未验。保留前述 Linux 零等待输入可能早于窗口焦点交接的风险，不声称完全解决。独立、默认关闭的 Observation 本地记录实验不连接旧学习链；本轮未开启或读取其记录，其保留范围已向父任务报告。

类型、架构、Web 与原生构建，以及预测/手动更新/旧学习移除关键逻辑检查通过。无真实模型调用、无真实历史或用户密钥访问，无 main 合并、发布或部署。
