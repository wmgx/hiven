# 架构冻结与收敛决策

**日期:** 2026-08-09  
**状态:** active — 产品/工程裁决  
**来源:** Codex 默认分支静态审查 + `doc/2026-08-09-system-capability-and-redesign-brief.md` + 本仓库现场核对  
**读者:** 执行 AI / 产品 / 维护者  

---

## 1. 裁决（一句话）

**产品方向成立；当前不扩飞书/桌面/新插件广度，先收敛协议、权限、门禁。**

差异化定位保持：

> 精确文本工作台级的内容理解与变换 + 边界清楚的插件 host，而不是另一个全能 Raycast。

---

## 2. 保留清单（禁止重写）

| 模块 | 原因 |
|------|------|
| `useLauncherSession` | progressive partial / debounce / Abort / telemetry 已扎实 |
| ranking 有界评分 + top-k | 非简单 fuzzy，值得保留 |
| `LauncherController` 状态机 | list → collect → params → result / live preview / Escape / journal |
| tools 形态（accepts + textMatch + output） | 已验证「内容即动作」 |
| 插件边界纪律（文档层） | 方向对，代码需追上 |

---

## 3. 现场核对（相对 Codex 结论）

| 断言 | 核对结果 | 证据 |
|------|----------|------|
| `PluginPackageSummary` 无 `permissions` 但 summary 返回带该字段 | **成立** | `pluginRuntime.ts` L45–54 vs L261；`tsc -p tsconfig.app.json` 报 excess property |
| `fetchGithubManifest` 缺 `permissions` | **成立** | L947–954 返回值缺必填字段 |
| 未声明权限默认 `granted: true` | **成立** | `pluginPermissions.ts` L117：`granted: !requestedPermissions.includes(permission)` |
| `runIntentMatchers` 无生产调用 | **成立** | 仅 `intentEngine.ts` 定义 + `test-intent-engine.mjs` |
| accepts 推荐忽略 match 结果 | **成立** | `acceptsRecommendation.ts` L87–92：调用 match 但不根据返回过滤 |
| static item 丢 `accepts` | **成立** | `registry.ts` `resolveStaticItemFromContribution` 未复制 `accepts` |
| dynamic item 丢 params 协议 | **成立** | `resolveDynamicItem` 有 accepts，无 params/defaultParams/executeWithParams |
| tools 字段最完整 | **成立** | `adaptToolToLauncherItem` |
| CI 仅 tag 发布、无 quality gate | **成立** | `.github/workflows/build.yml` on: tags v* / workflow_dispatch |
| CSP null | **成立** | `src-tauri/tauri.conf.json` `"csp": null` |
| 旧 Object Action 仍存活 | **成立** | `actionRecommendation.ts` / `pluginActionManifest` / export 仍在 |
| `tsc` 整体健康 | **不成立（更糟）** | 不仅两处 contract 错误；app 工程另有多处 TS2322/6133 等 |

**说明:** 审查未跑桌面运行时；上述为源码与类型合同核对。根目录 `tsc --noEmit` 可能因 project references 假绿；**以 `tsc -p tsconfig.app.json` 为准**。

---

## 4. 优先级与硬约束

### P0 — 立即（阻止不可验证代码继续堆积）

1. **权限默认语义**  
   - 未声明 → 拒绝（API 层不可用）  
   - 已声明未批准 → 拒绝 + 提示  
   - 已声明已批准 → 允许  
   - builtin 可信策略单独表驱动，不靠「未声明=放行」  
2. **类型合同**  
   - 修 `PluginPackageSummary` / `getPluginPackageSummary` / `fetchGithubManifest`  
   - 目标：`npx tsc -p tsconfig.app.json` 零错误（可分 PR：先修权限与 runtime 合同，再清其余 tsc 债）  
3. **Mandatory quality CI**（PR + main push）  
   ```text
   npm ci
   npx tsc -p tsconfig.app.json --noEmit
   npm run check:architecture
   npm run check:reachability
   npm run test:refactor-suite
   cargo check --manifest-path src-tauri/Cargo.toml
   npm run build
   ```  
   - PR fast gate 可裁 cargo test / 全量 suite 子集  
   - **tag release 不得弱于 PR gate**  
4. **漂移测试**  
   - 修或删仍断言 `isEditorWindowRuntime` 于已删除路径的 source-regex 测试  
5. **architecture checker**  
   - 修 `walkWithExtensions` 递归回退 `walk()` 的 bug（若仍存在）

### P0/P1 — Launcher 协议单轨

唯一数据流：

```text
Contribution → normalizeContribution() → ResolvedLauncherItem
  → eligibility (accepts → optional match)
  → ranking → param state machine → execute → LauncherOutput → router
```

| 作者输入 | 只能是语法糖，语义必须同一 |
|----------|----------------------------|
| `launcher.items` | 须保留 accepts / params |
| `tools` | 已最完整，作为归一参考 |
| `dynamicItems` | 须支持 params 协议；AbortSignal 可传 |

`match` 语义三选一写死：**过滤 / 补充 hit / 仅 score**，禁止混用。  
生产路径必须调用与设计一致的 match 调度（或删除死引擎，避免双真源）。

删除旧 Object Action catalog / manifest / executor；history paste/copy 若保留，改为 host item/provider 进同一 registry。

### P1 — 插件边界

- Diff 产品类型退出公共 SDK → text-diff 内部  
- 禁止公共暴露 `useWorkspaceStore` 写路径  
- SDK 拆：`plugin-core` / `plugin-ui` / trusted-native（可选）  
- **安全叙事：路线 A 可信插件**（当前阶段）  
  - 安装文案：与 Hiven 同级本机代码权限  
  - 不写「沙箱」「安全隔离」  
  - 远程插件固定 commit；默认关闭自动跟随 branch  

路线 B（真隔离）仅在明确做第三方生态时立项。

### P1 — Host 拆分

`GlobalLauncherHost` 只做 composition：

```text
lifecycle / session / object-block / surface / permission / output / panel
```

### P1 — 文档硬切

| 文件 | 动作 |
|------|------|
| `PRODUCT.md` | 边界与非目标 |
| 新建 `ARCHITECTURE.md` | **当前真实运行时** |
| `DESIGN.md` | 仅当前 surfaces + tokens；删 multi-pane/sidebar/pinned 残留 |
| `README.md` | launcher-only 用户体验 |
| 历史方案 | `doc/archive/` + `status: active/superseded/archive` |

### P2 — 平台声明

- 发布矩阵仅 macOS arm/x64 + Windows x64 → README 去掉 Linux 或标 experimental  
- 或补 Linux CI + 真实测试矩阵  

---

## 5. 目标分层架构（冻结期设计北极星）

```text
1. launcher-domain     item / context / content / eligibility / ranking / controller / output
2. host-runtime        window / surface / context broker / output router / permission / storage
3. providers           apps / windows / processes / browser tabs / remote docs
4. plugins             transforms / JSON / Diff / CSV / Feishu UI / clipboard-history UI
```

Host 只知道：候选动作、接受上下文、所需能力、结果形态、输出路由。  
Host 不知道：如何 format JSON / 解 JWT / 建 Diff 树 / 飞书排序 / CSV 业务状态。

卫星能力（桌面控制、飞书）= providers / plugins，**不是系统身份**。

---

## 6. 执行顺序（批次）

| 批次 | 内容 | 完成定义 |
|------|------|----------|
| **B1 门禁与安全语义** | 权限默认拒绝；pluginRuntime 合同；quality.yml；漂移测试；architecture walk | PR 红即挡；权限单测覆盖未声明=拒绝 |
| **B2 Launcher 单轨** | normalizeContribution；match 语义；删 Object Action 幽灵；dynamic AbortSignal | 三入口字段契约测试 + 手工 JSON/b64 零输入故事 |
| **B3 插件边界** | Diff 下沉；SDK 拆分；可信插件文案与 GitHub pin | architecture check 禁止 Diff 语义进 workspace/SDK 公共面 |
| **B4 文档与死代码** | README/DESIGN/ARCHITECTURE；删不可达 workbench 遗骸 | 无双源叙事；reachability 无大块 allowlist |
| **B5 再谈广度** | 仅在 B1–B4 验收后 | 新插件/飞书/桌面增强需单独立项 |

**冻结规则（B1–B4 期间）：**

- 禁止新 first-party 插件（bugfix 除外）  
- 禁止飞书/窗管/进程能力扩张  
- 禁止新 matcher / contribution 类型  
- 禁止「顺手加功能」PR 混进收敛批次  

---

## 7. 明确永不做（写入产品硬约束）

- 全能 OS launcher / 文件全局搜索主路径  
- 截图标注 / 窗管 Widgets / 听写主路径  
- 必选 LLM / Agent 主路径  
- Raycast 扩展兼容 / 云同步账号体系  
- 在路线 A 下宣传「安全沙箱」  

---

## 8. 成功度量（收敛期）

| 维度 | 标准 |
|------|------|
| 可信门禁 | PR 上 tsc(app) + architecture + reachability + refactor-suite 必绿 |
| 权限 | 未声明敏感能力调用失败；有单测；UI 文案诚实（可信插件） |
| 协议 | 一种 ResolvedLauncherItem；match 有唯一语义且生产路径一致 |
| 边界 | 公共 SDK 无 Diff 产品模型；无 Object Action 双轨 |
| 文档 | README 与运行时一致；DESIGN 无 workbench 残留 |

---

## 9. 相关文档

- 能力全景：`doc/2026-08-09-system-capability-and-redesign-brief.md`  
- 智能化路线：`doc/2026-07-19-launcher-intelligence-roadmap-design.md`  
- 跟手/竞品：`doc/plans/2026-08-01-launcher-follow-through-and-feature-steal.md`  
- 历史架构坑：`doc/archive/2026-07-07-architecture-review.md`  
- 边界：`AGENTS.md`、`doc/diff-plugin-boundary-decision.md`  

---

## 10. B1 落地记录（2026-08-09）

| 项 | 状态 | 说明 |
|----|------|------|
| 权限 least privilege | ✅ | `getPluginPermissionSnapshot`：未声明 deny；builtin 声明可 auto-grant；`shell.run` denylist |
| pluginRuntime 合同 | ✅ | `PluginPackageSummary.permissions`；`fetchGithubManifest` 补 permissions；Rust `PluginDirSummary` 同步 |
| architecture walk | ✅ | `walkWithExtensions` 递归保持 extension filter |
| 漂移测试（子集） | ✅ | monaco/surface/effect/first-party/launcher-plugin 对齐退休 `isEditorWindowRuntime` |
| quality CI | ✅ | `.github/workflows/quality.yml` + `npm run test:quality-gate`；release `build.yml` 同步跑 gate |
| 全量 tsc 硬门禁 | ⏳ | 仍约 ~140 历史错误；quality.yml 中 non-blocking warning，B1.5 转 hard fail |
| 全量 refactor-suite | ⏳ | 仍有多处引用已删模块的假绿/假红；不在 B1 hard gate |

本地验收：`npm run test:quality-gate` 通过。

## 10.1 B2 落地记录（2026-08-09）

| 项 | 状态 | 说明 |
|----|------|------|
| `normalizeContribution()` | ✅ | static + dynamic 共用字段协议（accepts/match/textMatch/params/executeWithParams） |
| tools 路径 | ✅ | 仍走 `adaptToolToLauncherItem`（已最完整）；与 normalize 字段集合对齐 |
| match 语义 | ✅ | **filter**：`isIntentEligible` = accepts → optional match 非空；ranking + acceptsRecommend 共用 |
| dynamic AbortSignal | ✅ | `LauncherDynamicContext.signal` 从 `collectDynamicItems` 传入 |
| Object Action 幽灵 | ✅ | 删除 `pluginActionManifest`；`actionRecommendation` 仅 host pin（历史/Quick Editor）；变换靠 ranking |
| 契约测试 | ✅ | `test:launcher-normalize-contribution` + intent 相关进 quality-gate |

## 10.2 B3 + B4 落地记录（2026-08-09）

| 项 | 状态 | 说明 |
|----|------|------|
| `@hiven/plugin-diff` | ✅ | DualEditorView + kits.diff + bound text；仅 text-diff 可 import |
| 公共 SDK 去 Diff | ✅ | 移除 DualEditorView / kits.diff / useWorkspaceActions / useBoundSourceText |
| DiffSourcePayload | ✅ | 传输形状在 `diffTypes.ts`；不再从 workspaceStore 导出产品 Diff |
| openDiffPage | ✅ | 仍打开 text-diff surface；类型用 DiffSourcePayload |
| README / DESIGN | ✅ | launcher-only 硬切；删除 multi-pane workbench 叙事 |
| ARCHITECTURE.md | ✅ | 当前真实运行时与 SDK 分层 |
| architecture + test:plugin-diff-boundary | ✅ | 进 quality-gate |

## 11. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-09 | 采纳 Codex 审查结论；现场核对 P0；写入冻结与 B1–B5 顺序 |
| 2026-08-09 | B1 落地：权限、runtime 合同、quality gate、边界测试收敛 |
| 2026-08-09 | B2 落地：Launcher 单轨协议、match filter、删 Object Action catalog |
| 2026-08-09 | B3/B4 落地：Diff SDK 边界 + README/DESIGN/ARCHITECTURE 硬切 |
| 2026-08-09 | 死代码删除 + `tsc -p tsconfig.app.json` 清零；quality-gate 升 typecheck hard fail |
| 2026-08-09 | 删除 plugin-editor 死桥；focus 改开 system-plugins + settings；精简 refactor-final 验收 |

| 2026-08-09 | refactor-suite 批量 slim：ENOENT/过时 VM 契约对齐 launcher-only；tauri smoke 端口占用 skip；quality-gate 仍绿 |
