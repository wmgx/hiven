# 技术架构探索笔记（02-tech）

> 基准：`~/workspace/hiven-explore/repo`（wmgx/hiven master 浅克隆，只读，未修改、未推送）
> 日期：2026-10-10　视角：技术架构
> 标注约定：= 亲手运行/亲眼读到的代码与输出；= 从代码结构推导、未亲手验证；= 源码无法确认，需运行时或外部信息验证。
> 两份子报告（插件系统审计、测试盘点）结论已合并，凡我亲手复核过的以我的复核为准。

---

## 1. 技术栈全貌与目录结构

### 1.1 栈

`package.json`：

- 运行时：Tauri v2（`@tauri-apps/api ^2.11` + 7 个官方插件：clipboard-manager、dialog、fs、global-shortcut、process、shell、updater）+ React 19 + TypeScript（`~6.0.2`，**非 strict**）+ Tailwind CSS v4 + Zustand 5 + Vite 8（rolldown 内核）+ Monaco 0.55 + cmdk。
- `packageManager: pnpm@10.33.2`，但 CI（`.github/workflows/quality.yml`）用的是 `npm ci`。
- 版本 0.2.57；更新走 Tauri updater，endpoint 含一个 github 代理域名。

### 1.2 目录与体量

行数统计（ts/tsx）：

| 目录 | 文件数 | 行数 | 职责（读代码确认） |
|---|---|---|---|
| `src/workspace/` | 145 | ~27,650 | host-runtime：插件 registry/runtime、launcher 域、surface/窗口、权限、存储、telemetry、AI provider、self-learning |
| `src/plugins/` | 96 | ~23,478 | 18 个 first-party 插件（feishu 6927 行 … crypto 94 行） |
| `src/components/` | — | ~9,031 | launcher/设置/插件宿主等 UI |
| `src/launcher/` | 13 | ~3,355 | launcher 旧/新入口相关 |
| `src/kits/` | — | ~1,852 | 4 个 kit：content / diff / editor / ui（纯算法，无框架状态） |
| `src/workflow/` | 12 | ~1,265 | workflow 对象模型与 launcher 适配 |
| `src-tauri/src/` | 9 | ~12,869 | Rust：lib.rs 8345 行单文件 + hotkeys/clipboard/桌面桥/AI 桥等 |
| `src/store.ts` 等 | 8 个 zustand store | — | workspaceStore、pluginStore、pluginSettingsStore、quickEditorStore… |

ARCHITECTURE.md 声称的 5 层中，**"providers" 层在代码里没有对应目录**（`src/providers/` 不存在）。provider 类代码散在 `src/workspace/appLauncher/`、`desktopControl/`、`desktopTargets/`、`webNativeBridge.ts` 和 `extensions/hiven-chromium-tabs/`（一个 Chrome 扩展的 manifest+background.js）。文档与代码有漂移。

"框架"（`src/workspace`）实际装了不少产品语义：`launcher/` 7910 行、`learning/`（自学习规则引擎）3651 行、`ai/`（AI provider runtime）1090 行、`desktopControl/` 1422 行、`experience/` 625 行。按 AGENTS.md 自己的口径（framework 只做 registry/renderer/lifecycle/workspace-pane 状态等），learning/ai/desktopControl 已越界——是"产品逻辑寄生在 host 层"。

### 1.3 模块依赖方向

亲手运行 `node scripts/check-architecture.mjs`：**通过**（0.6s）。另手工抽查：

- `src/kits` 无任何 `../workspace` / `../plugins` import；
- `src/workspace` 无 `plugins/` import；
- `src/plugins` 下 34 处 `from '@hiven/plugin'`、11 处 `@hiven/plugin-ui`，零越界相对路径 import；
- `@hiven/plugin(-ui/-diff)` 是 vite/tsconfig **alias**，指向仓库内 4 个文件（`src/plugin-sdk.ts`、`plugin-ui.tsx`、`pluginHostDiff.ts`、`plugin-ui-icons.ts`），另有历史别名 `@fluxtext/plugin`。

依赖方向是**真约束**（脚本在 CI 门禁里硬检查），但"包"是纸面概念——单体仓库内 alias 而非独立发包。隔离的真正边界是"不准越界 import"，这一点落实了。`@hiven/plugin-ui` 实际导出比 ARCHITECTURE.md 描述的更宽（含 TextEditor 等），属文档滞后。

### 1.4 窗口架构

`src-tauri/tauri.conf.json` 只声明一个 `launcher` 窗口；`src/main.tsx` 按 URL 参数 `?window=` 做路由，动态 `import()` 三个根：launcher / plugin-surface / quick-editor（App 主入口走 `App.tsx`）。**Monaco 被刻意挡在 plugin-surface 窗口之外**（注释写明 editor.api chunk 数 MB，不让 surface 窗口付启动成本）。构建产物验证了这一点：`PluginSurfaceRenderer 2.3MB` vs `editor.api2 3.6MB` 独立 chunk，Monaco 各语言拆成 ~100 个小 chunk。

---

## 2. 插件系统设计评估

（以下 §2.1–2.4 主要引自插件审计子报告，我复核了关键代码行与脚本行为）

### 2.1 SDK 切分：真隔离

`src/plugin-sdk.ts`（177 行）是纯 re-export 门面，尾部注释明确 "Diff product types are NOT on the public SDK"；`check-architecture.mjs` 的 B3 段硬检查：`@hiven/plugin` 不得导出产品 `DiffSource`、`pluginHostSdk` 不得出现 `DualEditorView`/写路径、除 textDiff 外任何插件 import `@hiven/plugin-diff` 即失败。第一方插件同样被约束（无越界 import）。

### 2.2 目录协议与版本/热更新

`pluginRuntime.ts:203` 定义入口候选 `['index.tsx','index.ts','index.jsx','index.js','index.mjs']`；第三方插件目录在 `~/.local/hiven/plugins/{installed,dev,builtin}`；installed 插件经 `convertFileSrc` 转 asset URL 后 `import(/* @vite-ignore */ url)` 动态载入，default export 须为 `PluginDefinition`，加载前把 SDK 挂到 `window.HivenPlugin`。

更新只支持 GitHub 来源插件（`fetchGithubManifest` 拉远端 manifest，用自研 `comparePluginVersions` 比大小），流程 staging → 原子替换 → cache-bust re-import → enable，**热更新、无需重启**，但无自动更新、无签名/哈希校验（只校验 pluginId 一致）。

### 2.3 权限模型（route A）：君子协定

17 个权限枚举；`getPluginPermissionSnapshot` 实现 undeclared=deny（2026-08-09 冻结文档列为 P0 的"未声明默认 granted"问题**已修复**，`pluginPermissions.ts:121` 注释写明 never treat "not requested" as granted）；builtin 自动授权、denylist 仅 `shell.run`。

**风险面是实的**：

1. Rust 侧 `plugin_shell_run`（lib.rs:4863，支持自定义 shell_program/env/cwd 的完整任意命令执行）与 `plugin_http_request`（:4870）**没有任何调用方鉴权**——无 pluginId 参数、无 grant 查询。权限检查只活在 TS SDK 包装层（`requirePluginPermissions`）。
2. 第三方插件与 host **同一 JS realm**：可直接 `invoke('plugin_shell_run', …)` 绕过授权；可读 `localStorage` 里其他插件的 `hiven-plugin-kv:<id>:` 私有数据（含 feishu 这类集成插件的 token/配置）；可做 DOM 级按键监听；可篡改 `window.HivenPlugin` 污染所有插件。
3. Tauri capability（`src-tauri/capabilities/default.json`）是**按窗口**授权的，同一 webview 内任何 JS 都能调用被允许的命令；且 `"csp": null`。

团队对此是清醒的：ARCHITECTURE.md 原文 "Permission snapshot is an API convention (least privilege: undeclared = deny). Not a sandbox."——权限系统的真实定位是**防误用、促声明**，不是防恶意。第三方生态若以"不可信代码"为前提，当前模型撑不住。

### 2.4 小结

SDK 切分与目录协议是真功夫；权限模型诚实但天花板低；更新机制可用但信任链单薄（无签名、更新后新增 permission 的再授权闭环在代码中未见）。

---

## 3. 代码质量抽查

### 3.1 测试：广而不深，85% 游离于门禁之外

（子报告统计，我复核了 gate 脚本与部分数字）`scripts/test-*.mjs|mts` 共 **226 个**；package.json 有 **180 个** `test:*` 入口；**48 个**测试文件连 npm 入口都没有。`test-quality-gate.mjs` 实际跑 23 项（typecheck + architecture + reachability + 19 个测试 + build），门禁覆盖的测试仅约 10.6%。**154 个**测试不在任何门禁/复合套件里——包括 `test:launcher-ranking`（排序核心逻辑 14 组断言）、`test:telemetry`（埋点契约）这种关键项。

测试无框架：`node:assert/strict` + 源码文本 grep 为主；少数转译执行测试用 `typescript.transpileModule` + `node:vm` 沙箱，import 靠**正则替换源码字符串打桩**。这种打桩与真实模块图漂移时会"代码已坏、测试全绿"。

"只为重要逻辑写单测，不为 UI 写"的口径**部分被违反**：`test-clipboard-object-block-ui` 断言 tsx 内 `data-testid`、`test-settings-select-layout` grep CSS 声明——都是 UI 表现细节的静态契约检查。

### 3.2 类型与 lint：门禁在，但守得松

`tsconfig.app.json` **没有 `"strict": true`**；eslint 只有 4 个 recommended 配置、无自定义规则，`lint` 不在 quality-gate 里。`any` 36 处、`@ts-ignore` 2 处——非 strict 下的"干净"是虚的。

### 3.3 Telemetry：性能诊断强，错误可观测性弱

`src/workspace/telemetry/events.ts` 45 个事件；launcher open→query→select→execute→close 核心漏斗全覆盖（含 first-paint、event-gap 等诊断指标），与 AGENTS.md 事件目录一致。**缺失**：无任何 `*.error`/`*.failed` 类事件（执行失败、插件崩溃、异常恢复全无埋点），设置页零埋点，约 1/3 事件是 `perf:learning.*`。API 仅 `trackBehavior/trackLatency/measureLatency`。

---

## 4. 构建验证（亲手运行）

### 4.1 环境阻碍（记录精确）



1. `npm install` / `npm ci` 在 Node v24.20.0 + npm 10.9.4 下**收尾崩溃**：`npm error Exit handler never called!`，`node_modules/.bin` 为空（bin 链接阶段没跑完）。磁盘充足（99G 可用），排除空间问题；monaco-editor 解包时大量 `TAR_ENTRY_ERROR ENOENT` 警告。
2. 改用仓库声明的 `pnpm@10.33.2`（`npm install -g pnpm@10.33.2`）可安装，但与并行 agent 的 `rm -rf node_modules && npm ci` 在同一目录冲突（`rm: cannot remove 'node_modules/eslint/lib/rules': Directory not empty`）。最终由并行 agent 的 `npm ci` 建好可用树（vite/tsc bin 存在），我未再重装。
3. 结论：**仓库声明 pnpm，CI 用 npm ci，本地 Node 24 + npm 10.9.4 有崩溃 bug**——三者不一致是环境摩擦根源。建议统一到 pnpm（或 CI 固定 npm 版本）。

### 4.2 构建与门禁结果



- `npm run build`：**通过**，两次实测 26s / 14s（增量缓存差异）；产物 dist 18MB；有 chunk >500KB 警告（editor.api2 3.6MB、PluginSurfaceRenderer 2.3MB）。
- `npm run test:quality-gate`：后台实测总耗时 **1m6s**，**失败 3/23**，master 当前是红的：
1. `check:typecheck`（exit 2）：**20 个 TS 错误 / 12 个文件**——`PluginSettingsDialog.tsx` host.t 类型不匹配 ×4、`ObservationSettings.tsx` ×3、`web-open/browserProvider.ts` ×2、`calculator/index.ts` ×2 等；
2. `check:reachability`（exit 1）：`src/plugins/web-open/learnedRules.ts`（115 行）成孤儿文件（web-open 合并 browser-tabs 后的残留）；
3. `test:self-learning-pr2`（exit 1）：测试自研 VM loader 没给 `./routes` 打 stub，`textToolRoutes.map` 抛 TypeError——**测试脚手架 bug**，非产品代码问题。
- CI 的 `quality.yml` 在 PR 上跑同一门禁，且注释写 "tsc debt cleared 2026-08-09"——与当前 20 个报错矛盾，债务在 08-09 之后重新累积，门禁红了无人修。

---

## 5. 技术债清单（按 影响 × 修复成本 排序）

1. **质量门禁在 master 上红了 3 项**（§4.2）。影响：高（CI 信任崩塌，"门禁"名存实亡）；修复成本：低（删孤儿文件、给 pr2 测试补 stub、修 20 个类型错多为机械活）。**最痛，建议立即修。**
2. **权限模型是君子协定**（§2.3）。影响：中高（第三方插件生态的信任天花板；恶意插件可绕过一切授权直调 shell/网络、可读别家插件 secrets）；修复成本：**彻底修极高**（见 §6 场景 B），但有低成本止血项（§6）。若产品不打算做不可信第三方生态，可接受现状并明确文档化。
3. **tsconfig 非 strict + 类型债务复发**。影响：中（重构安全网弱）；成本：低起步（先清 20 个报错，再逐模块开 strict）。性价比最高的类型投资。
4. **154 个测试游离于门禁之外 + 脆弱的测试加载机制**。影响：中（核心逻辑测试静默腐烂；正则打桩漂移导致假绿）；成本：中（把 ~20 个核心测试并入 gate/套件；新测试用 `node --experimental-strip-types` 直接 import 真实模块，已有 pr0/pr2/pr3 先例）。
5. **单体巨文件**：`src-tauri/lib.rs` 8345 行 40+ commands；`src/workspace` 27.6k 行混入 learning/ai/desktopControl 等产品逻辑。影响：中（导航与修改成本）；成本：中低（纯拆分文件、零行为变更，可渐进）。

未进 Top5 但值得记：`csp: null`；updater 走第三方代理域名；`@hiven/plugin-ui` 文档滞后；reachability 白名单有扩张趋势（3 个 barrel）。

---

## 6. 迁移成本评估（核心产出）

### 场景 A：launcher-only → 常驻工作台

要动：`main.tsx` 窗口路由 + `tauri.conf.json` 窗口声明 + `windowManager` + 多 pane UI（2026-07-07"工作台退役"时**已删除**，需重建；但 `workspaceStore` 的 pane 数据模型还在）+ 插件 surface 宿主模型。量级：恢复一个基础常驻工作台约 **2–4 人周**。

"用户需要常驻编辑面"的真实需求强度——这正是产品探索要回答的，技术上无硬障碍。

**结论：证伪（现阶段不做）。** 退役是三个月前深思熟虑的转向（有完整设计文档与清理分支），逆转等于自我否定；且 pane 数据模型保留意味着将来真要回摆，数据层不用重写。收益未经证实 < 确定的迁移成本 + 定位摇摆成本。

### 场景 B：插件模型重构 → 真沙箱

要动：`pluginRuntime`（动态 import → 每插件独立 WebviewWindow）+ 全部 4 个 SDK 文件（同步调用 → 异步 RPC；`@hiven/plugin-ui` 的 React 组件需整体 remoting，如 VS Code webview 式消息桥——这是最难的部分）+ 18 个第一方插件（`import.meta.glob` eager 打包 → 异步加载；UI 全部走消息通道）+ Rust 侧命令加调用方鉴权 + 存储/网络/shell 的权限执行点下沉到 Rust。量级：**6–12 人周起**，且 18 个插件全部要回归。

**结论：证伪（现阶段不做），但有一个高 ROI 的折中。** 插件生态的真实外部采用率未知（），为假想中的不可信第三方付 2–3 个月的重构税不划算。折中方案（约 0.5–1 人周）：给 `plugin_shell_run` / `plugin_http_request` 等 Rust 命令加 **pluginId + 授权查询**（host 在 invoke 前签发一次性 token，或把 snapshot 校验搬进 Rust），堵住"直调 invoke 绕过"的最大口子；文档里把 route A 的信任边界写死（只接受可信来源插件 + 未来加签名校验）。花小钱买 80% 的风险收敛。

### 场景 C：换渲染方案（Tauri → Electron / 纯 Web）

Tauri 耦合度中等：12 个文件 import `@tauri-apps/api`、41 个 distinct `invoke` 命令、12.9k 行 Rust（全局热键、剪贴板监听、桌面桥、AI CLI 子进程桥、托盘、updater）。Web 侧已有 `webNativeBridge`（浏览器验证模式），移植性好。

**结论：证伪。** Tauri 已经是轻量方案（dist 18MB），换 Electron 只会更臃肿；纯 Web 则丢掉全局热键/托盘/剪贴板监听这些 launcher 立身之本。**没有可论证的收益**，迁移成本却是一个 native 层重写。

### 总判

三个"质疑定位式"重构当前**收益都无法覆盖成本**。真正的技术杠杆在便宜处：修红的门禁（§5.1）、Rust 命令加鉴权（§6-B 折中）、开 strict（§5.3）。架构本身是健康的——边界脚本全绿、窗口级 code-splitting 有心、pane 模型为未来留了后路。
