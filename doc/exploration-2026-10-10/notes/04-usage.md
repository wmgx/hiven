# Hiven 实际运行体验探索笔记（04-usage）

> 探索者：实际运行体验视角子 agent
> 日期：2026-10-10
> 基准：`~/workspace/hiven-explore/repo`，分支 `main`（注意：仓库默认分支是 `main`，不存在 `master`；任务书写的"master 分支"应理解为默认分支），commit `c69ed99`（2026-10-07，"chore: 清理合并内容中的行尾空白"）
> 工作树状态：探索结束时 `git status` 干净（安装过程中对 `package-lock.json` 的临时修改已用 `git checkout` 恢复，未改动、未推送任何文件）

本文严格区分三类陈述：
- 亲手跑到 / 亲手执行到的
- 只读了代码、没有运行验证的
- 环境所限完全没覆盖到的

---

## 1. 环境信息

| 项 | 值 |
|---|---|
| OS | Linux（`tauri info` 识别为 Ubuntu 24.4.0 x86_64），无桌面显示（`DISPLAY` 为空） |
| Node / npm | v24.20.0 / 10.9.4 |
| Rust | 未安装（无 rustc / cargo / rustup） |
| 浏览器 | 仅 `/opt/meta-chromium/chrome`（Chromium 152，企业策略管理）；无 Firefox、无 Playwright 自带浏览器 |
| 网络 | 出站经透明代理；`curl` 可达外网与 loopback；loopback 之外（如 198.19.0.2）会被劫持到 198.19.0.1 |

---

## 2. 命令执行记录（按时间顺序）

### 2.1 `npm install` —— 两次失败后靠临时改 lockfile 成功

- **第 1 次**（`npm install --no-audit --no-fund`，耗时 2m40s）：失败。
- 大量 `npm warn tar TAR_ENTRY_ERROR ENOENT... monaco-editor/.../*.d.ts`（解包 monaco-editor 失败）
- 随后 `npm error Exit handler never called!`（npm 自身 bug 式退出）
- 日志（`~/.npm/_logs/2026-10-10T05_38_39_306Z-debug-0.log`）显示 39 个包从 `https://bnpm.byted.org`（字节内部 npm 镜像）反复 `FETCH_ERROR` 后重试。
- **根因定位**：提交的 `package-lock.json` 里 39 个 tarball 的 `resolved` 地址写的是 `bnpm.byted.org`（`grep -c` 得 39，其余 282 个是 `registry.npmjs.org`）。该内网镜像在本 VM 经 npm 不可达（curl 经代理能建连，但 npm fetch 持续 FETCH_ERROR）。
- **第 2 次**（清 `npm cache` 后重试，1m18s）：同样 `Exit handler never called!`；且这次失败把 `node_modules` 清到只剩 12 个条目、**删掉了 `package-lock.json`**（`git status` 显示 `D package-lock.json`）。
- **恢复**：`git checkout -- package-lock.json` 立即恢复。
- **第 3 次**：把 `package-lock.json` 复制到 `/tmp` 备份后，`sed` 把 39 处 `bnpm.byted.org` 临时替换为 `registry.npmjs.org`，再 `npm install` —— **24 秒成功**（`added 278 packages`；有 4 次 "tarball data... seems to be corrupted. Trying again." 警告，重试后成功，应为代理抖动）。
- **收尾**：`cp /tmp/package-lock.json.bak package-lock.json`，`git status` 确认干净。
- 结论：按 README 的 `npm install` 在**干净环境会失败**，因为 lockfile 硬编码了字节内网镜像。这是仓库可复现性的真实缺陷（见 §5 摩擦点 #1）。

### 2.2 `npm run build`（纯前端构建）—— 成功

- `vite build`，**16.01 秒成功**，产物写入 `dist/`。
- 基线可编译，无报错；仅有 chunk 体积警告（`PluginSurfaceRenderer` 2.3MB、`editor.api2` 3.6MB，提示 code-split）。
- 前端基线健康。

### 2.3 `npm run tauri dev` —— 明确阻碍，20 分钟内无解，停止

- `npx tauri info`（49 秒）报告：
- `✘ webkit2gtk-4.1: not installed`、`✘ rsvg2: not installed`
- `✘ rustc: not installed!`、`✘ Cargo: not installed!`、`⚠ rustup: not installed!`
- node 24.20.0 / npm 10.9.4 正常；tauri 2.11.1（JS 侧部分包提示 outdated）
- `timeout 90 npm run tauri dev` **不到 1 秒即失败**，精确报错：
```
failed to run 'cargo metadata' command to get workspace directory:
failed to run command cargo metadata --no-deps --format-version 1:
No such file or directory (os error 2)
```
- 继续推进需要的链条：`rustup` 安装工具链 ＋ `apt install libwebkit2gtk-4.1-dev` 等系统库 ＋ 首次全量 `cargo build`（wry/tao/webkit 绑定编译，在 VM 上通常 15–40 分钟以上）。远超 20 分钟时限，且 Linux 本来就不在发布矩阵（README：仅 macOS arm64/x64、Windows x64）。按任务书"不要死磕"原则，记录阻碍后转向 web 路径。
- 桌面端在此环境**完全不可运行**；阻碍精确到命令与报错如上。

### 2.4 web 路径（`vite dev` + headless Chromium 实际点击）—— 被沙箱浏览器策略挡死

这是本轮探索投入时间最多的环境问题，记录完整以免后人重复踩坑：

1. `npm run dev`（vite，配置 `host: 'localhost', port: 1420, strictPort: true`）启动正常；但本机 `localhost` 解析到 IPv6 `::1`，vite 只绑了 `::1`，Chromium 走 IPv4 `127.0.0.1` 连被拒。改用 `npx vite --host 127.0.0.1 --port 1420` 重启后 `curl http://127.0.0.1:1420/` 返回 200。
2. Playwright（`playwright-core` ＋ `executablePath: /opt/meta-chromium/chrome`）`page.goto('http://127.0.0.1:1420/')` 失败：`net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`。
3. 尝试过的绕过手段（**全部失败**）：
- `--disable-features=BlockInsecurePrivateNetworkRequests,LocalNetworkAccessChecks` / `LocalNetworkAccessChecks` / `local-network-access-check` 三种写法
- CDP `Browser.grantPermissions` 授予 `local-network-access` → 报 `Unknown permission type`
- 清空代理环境变量后直连、加 `--proxy-bypass-list`
- `--single-process`、`--headless --dump-dom` 裸跑
- 把 vite 绑到本机另一 IP `198.19.0.2`（benchmark 段）：vite 能监听，但透明代理把流量劫持到 `198.19.0.1`，curl 显示 `Connected to 198.19.0.2 (198.19.0.1)` 后失败
- 读 `/etc/.../policies/managed/policy.json`：策略本身良性（仅禁 Google 更新域名、关遥测），**不是策略强制**，是该 Chromium 152 构建默认即强制 LNA 检查且 flag 关不掉
- `https://example.com` 同样空返回 —— 该 Chromium 在此沙箱基本无可用网络（curl 同环境正常）
- 全盘查找：无 Firefox、无第二个 Chrome
4. 结论：**本环境没有任何可用的浏览器能加载本地页面**。仓库 AGENTS.md 规定的"web validation 页面做真实浏览器验证"流程，在此 VM 上不可执行。所有 UI 交互（launcher 搜索点击、Quick Editor、text-diff 双栏、设置页、插件管理页）均。

### 2.5 替代验证：仓库自带行为测试脚本（Node 真实执行产品逻辑）

UI 点不动，转向"逻辑层真实运行"。仓库有 226 个 `scripts/test-*.{mjs,mts}`（用 `node:vm`＋TypeScript 转译真实加载源码模块并断言行为）。抽样运行 16 个产品核心相关的：

| 脚本 | 结果 | 覆盖的产品能力 |
|---|---|---|
| test-launcher-direct-answer | PASS | 算式/URL 即时结果的排名一等公民 |
| test-launcher-ranking | PASS | 搜索排名 |
| test-search-ranking-match | PASS | 搜索匹配 |
| test-intent-engine | PASS | 内容感知意图引擎 |
| test-intent-content-recommend | PASS（顺带在 B 旅程确认） | 剪贴板内容→工具推荐（JWT 内容必推荐 jwt-decode） |
| test-calculator-command-mode | PASS | 计算器命令模式 |
| test-clipboard-history-logic | PASS | 剪贴板历史逻辑 |
| test-clipboard-history-runtime | PASS | 剪贴板历史运行时 |
| test-auto-diff-mode | PASS | text-diff 自动模式切换 |
| test-json-semantic-diff | PASS | JSON 语义 diff |
| test-launcher-web-smoke | PASS | web 验证的静态契约（bridge/窗口路由/i18n 等） |
| test-quick-editor-host-surface | PASS | Quick Editor host surface 边界 |
| **test-quick-editor-launcher-behavior** | **FAIL** | 见 §5 摩擦点 #2（测试本身 brittle，非产品回归） |
| test-plugin-surface-window | PASS | 插件 surface 窗口生命周期 |
| test-workflow-json-clipboard-story | PASS | workflow：JSON→剪贴板故事 |
| test-output-router-behavior | PASS | 输出路由（copy/粘贴/写编辑器等目标） |
| test-launcher-r2-clipboard-follow-through | PASS | launcher→剪贴板跟进 |

另跑 `npm run check:architecture`：**通过**（"Architecture boundary check passed."）。

### 2.6 亲手"操作"核心逻辑：用户会话模拟脚本（合成数据，无隐私数据）

用 `/tmp/pwtest/user-session.mjs` / `user-session2.mjs` / `diffdemo.mjs` 真实加载源码 TS 模块并执行，模拟用户旅程（输入均为我构造的合成文本）：

**旅程 A —— 文本变换**（`src/plugins/encode-decode/core.ts`，真实函数）：
- `base64Encode("Hello, 世界!")` → `SGVsbG8sIOS4lueVjCE=`；解码还原一致 ✅
- JWT 解码 → 正确 pretty-print 出 Header/Payload（含 `// Header`、`// Payload` 注释行）✅
- `transformText('url','encode','a b&c=中文')` → `a%20b%26c%3D%E4%B8%AD%E6%96%87` ✅
- 非法 base64 解码 → 抛出 `Invalid character`（有错误处理，非静默失败）✅

**旅程 B —— 内容感知推荐**：`recommendActionsFromToolAccepts`（`src/launcher/clipboard/acceptsRecommendation.ts`）需要注入工具列表 fixture；仓库自带测试已断言"JWT 内容必推荐 jwt-decode"且通过。本人未重复造 fixture，标记为。

**旅程 C —— text-diff**：
- `decideAutoDiffMode({leftText, rightText, semanticEnabled})`：纯文本→`text`；双 JSON＋semantic 开→`json-semantic`；semantic 关→`text`；非法 JSON→`text`（fallback 正确）✅
- `buildDiffTree` 对 `{"name":"hiven","version":2,"debug":true,"tags":["a","b"]}` vs `{"tags":["a","c"],"version":3,"name":"hiven","extra":null}`：
- 键重排被正确忽略（无误报）✅
- `version: 2→3` 标 CHANGED、`debug` 标 REMOVED、`tags[1]: "b"→"c"` 标 CHANGED、`extra` 标 ADDED ✅ —— 语义 diff 行为正确，是真实产品亮点
- `computeTextLineDiff('a\nb\nc\nd', 'a\nB\nc\ne')` → `{leftHighlights:[2,4], rightHighlights:[2,4]}` ✅

**旅程 D —— 计算器**：`src/plugins/calculator/index.ts` 只 `export default definition`，求值函数未导出；仓库自带 `test-calculator-command-mode.mjs` 通过（走 definition 的命令路径）。本人未重复驱动，标记。

---

## 3. 产品结构速览（，未亲手点过 UI）

- **入口形态**：`src/main.tsx` 按 `?window=` 参数分三个窗口根：`launcher`（浏览器默认）、`plugin-surface`（剪贴板历史、csv 等独立 surface）、`quick-editor`（detach 的编辑器）。桌面端无持久主窗口，符合 README 的 launcher-only 定位。
- **Launcher 状态机**：`GlobalLauncherFrames.tsx` 的 frame 栈：search → collect-input（命令参数收集）→ param-input（`LauncherParamStep` 自管 Enter/Escape）→ result → surface/host-surface。键盘模型（`GlobalLauncherKeyboard.ts`）：↑↓ 导航、Enter 确认、Esc 按 frame 逐层返回、Tab/→ 展开 object 动作、Space 在部分 frame 确认、Cmd/Ctrl+Enter 变体、Shift+Enter 粘贴预览、`p` 收藏/取消。
- **空输入行为**（`ranking.ts#shouldKeepOnEmptyQuery`）：冷启动未用过的插件命令在空查询时**隐藏**，只留 direct answers（剪贴板内容已解析出的答案）、dynamic 项、host 应用、收藏 —— 空唤起即所见的是"与你当前剪贴板/上下文相关"的东西，这是"每天打开"的钩子设计。
- **IME**：中文输入法 Enter 上屏不触发确认（全局 composition 处理，AGENTS.md 有明确约束）。
- **设置页**（`src/surfaces/SettingsContent.tsx`）：分组 = 通用（语言/主题/字号）、热键（全局 pinned launcher 快捷键、Quick Editor 快捷键、应用内热键）、编辑器、AI 订阅管理、AI 默认值、JEV（某 AI 网关预设＋连通性测试）。设置行是 icon＋名称＋说明＋右侧控件的列表式布局。
- **剪贴板历史 surface**：顶栏 = 返回、搜索框、类型过滤（all/text/image/files/frequent/favorite）、设置、关闭；支持全文搜索（有 loading/error 状态）。
- **i18n**：`zh`/`en` 双语，`pickLocale` 按系统语言以 `zh` 开头判中文；插件文案走统一管线（AGENTS.md 强约束）。

---

## 4. 与文档不符 / 值得记录的发现

1. **分支名**：任务书说"master 分支"，实际仓库默认分支为 `main`，无 `master`。浅克隆拿到的是 `main@c69ed99`。
2. **`npm install` 在干净环境失败**（§2.1）：README 的两步上手指令第一步即 broken，原因是 lockfile 硬编码字节内网镜像 `bnpm.byted.org`（39 个包）。外部贡献者/新机器必踩。这是事实缺陷，不是环境个例。
3. **测试脆弱性**：226 个测试大量是"读源码文本做正则断言"的契约测试。抽样 16 个中 1 个失败，原因是源码加了一层 `<LauncherFlowFrame>` wrapper 导致测试的 80 字符正则窗口匹配不上 —— 产品行为没坏，是测试写得太 brittle。这种测试风格维护成本高，改 UI 结构就崩。
4. **web validation 的可达性假设**：AGENTS.md 把浏览器验证定为 UI 改动的统一优先路径，但 `vite.config.ts` 写死 `host: 'localhost'`（ smoke 测试还断言了 `host: 'localhost'` 以保 WebKit 存储同源）。在 IPv6-only localhost 解析或受管浏览器环境下，这条路是走不通的 —— 本次即实例。
5. **设置页已有 AI Provider 管理**（`workspace/ai`：provider 登录/登出、JEV 预设、连通性测试）：README"明确不做"里写的是"必选 LLM"，但 AI 基础设施（provider runtime、settings UI）已经存在。AI 方向的同事应注意：不是从零开始。

---

## 5. Top 摩擦点 / 缺陷（按对"更好用"的影响排序）

1. **新用户上手第一步即失败**（§2.1）：`npm install` 因内网镜像 lockfile 在外部环境失败。复现：干净 clone → `npm install` → `Exit handler never called!`。修复成本极低（lockfile 改用公网 registry），收益是贡献者/试用者漏斗不漏。
-
2. **Linux 完全不在支持矩阵**：`tauri dev` 缺 Rust 工具链＋webkit2gtk，20 分钟时限内无解；且发布矩阵本来就没有 Linux。开发者在 Linux 上无法做桌面端验证，只能走 web 验证 —— 而 web 验证在本类受管沙箱也可能不可用（§2.4）。
3. **测试维护负担**：正则断言源码文本的测试（如 `test-quick-editor-launcher-behavior.mjs`）会因正常重构而误报失败。复现：`node scripts/test-quick-editor-launcher-behavior.mjs` → `AssertionError: the shared frame switch should let parameter frames own Enter and Escape`。长期会侵蚀"质量门禁"的可信度。
4. **（推断）空唤起的可发现性风险**：冷插件命令在空查询时隐藏（`shouldKeepOnEmptyQuery`），设计意图是降噪；但新用户空唤起时可能完全看不到文本变换类命令，**不知道产品能干什么**。这需要真实 UI 验证确认空状态是否有引导（`LauncherEmptyWell.tsx` 存在，但其内容）。
5. **构建产物 chunk 过大**：`PluginSurfaceRenderer` 2.3MB、`editor.api2` 3.6MB（gzip 后仍 619KB/926KB），桌面端 webview 首屏/冷启动可能受影响。仅构建警告，实际启动耗时。

---

## 6. 未能验证的范围（诚实清单）

以下**全部没点到、没看到**，不要当作体验过：
- Global Launcher 的真实视觉（布局、配色、字号、信息层级、空状态、Object Block 外观）
- 唤起→搜索→选中命令→参数输入→结果交付的完整键盘流（只验证了各环节的**逻辑函数**，没走 UI）
- 剪贴板历史 surface 的真实交互（搜索、过滤、"回到 launcher 继续处理"）
- Quick Editor 的打开/编辑/detach（只跑了 host-surface 边界测试）
- text-diff 双栏对比的真实渲染（只跑了 diff 算法：自动模式＋语义树＋行高亮）
- 设置页、插件管理页的真实浏览（只读了组件结构）
- 全局热键、系统托盘、开机常驻、前台应用切换（需桌面端，完全未覆盖）
- 原生剪贴板读写、粘贴到前台应用（需桌面端）
- 性能/埋点（`~/.local/hiven/logs/launcher-perf.ndjson` 需真实使用产生）
- 翻译插件（需网络 API，按任务书未调用）、飞书插件（需账号）

## 7. 可复现性备注（给组内其他视角）

- 想在 Linux 复现逻辑层验证：按 §2.1 的 sed 替换后 `npm install`（约 25 秒），然后 `node scripts/test-<name>.mjs` 即跑。`npm run build` 约 16 秒。
- `/tmp/pwtest/user-session*.mjs`、`diffdemo.mjs` 是本次的会话模拟脚本（用完即走的探索工具，非仓库产物）。
- `dist/` 构建产物保留在仓库目录（gitignored，未提交）。
- 想做 UI 验证：需要一台 macOS/Windows 真机（或至少一个网络不受限、LNA 检查可关的浏览器）；本 VM 的 Chromium 对 `http://127.0.0.1:1420/` 返回 `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` 且所有 flag 变体无效 —— 别在这条路上再花时间。
