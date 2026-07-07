# Escape 退出链统一（第三包）设计文档

> 日期：2026-07-07
> 状态：设计确认，待执行
> 前置依赖：第一包（`doc/2026-07-07-workbench-retirement-cleanup-design.md`）执行完成后再做本包——第一包会删除部分涉事代码（如 Editor Command Bar 所在的死链），本包范围以第一包完成后的仓库为基线。
> 证据来源：`doc/archive/2026-07-07-ui-interaction-review.md`（"横向不一致"第 2 条、"1. 全局 Launcher" P1 条）、`doc/2026-07-02-quick-editor-host-surface-design.md`（Future Work：Escape 链迁移）。行号为 2026-07-07 快照，执行前以符号名重新定位。

## 一、背景：三套并行实现与语义分裂

当前 Escape 处理有三套独立实现，退出粒度互不一致：

1. **Global Launcher 主体**：window 级 capture 监听（`GlobalLauncherHostLifecycle.ts:182-186` 的 `useGlobalLauncherHostEscape`），默认链为「IME 检查 → interceptor → settings 弹窗 → plugin surface → host surface → permission → controller.back → 关窗」的 if/else 长链；非 IME、非 interceptor 场景总是 `preventDefault + stopPropagation`。
2. **`GlobalLauncherKeyboard.ts:78-179` 的 `handleGlobalLauncherKeyDown`**：重复实现了几乎相同的 Escape 分支（surfaceFrame / hostSurfaceTarget / permission / collect-input / param-input / result）。由于第 1 套在 capture 阶段拦截并 stopPropagation，这套逻辑对标准 Global Launcher 面板**永远执行不到**，只对 Quick Editor 命令 overlay 部分生效——是一份"看起来在工作"的重复代码。
3. **Quick Editor 命令 overlay**（`QuickEditorCommandOverlay.tsx:144-149`）：自己的 `onKeyDownCapture` 把 Escape 一律映射为"整体关闭 overlay"，同节点 bubble 阶段的第 2 套处理器因 `stopPropagation` 收不到事件。**后果（用户可感知的不一致）**：在 Global Launcher 里进入参数输入/结果列表后按 Esc 是"退一级"；在 Quick Editor 命令 overlay 里同样场景按 Esc 却是"整个面板直接关闭"，输入到一半的参数丢失。

另有两处相关缺口：

- `PluginSurfaceWindow.tsx:54-67`（独立插件窗口）的 Escape 监听**没有 IME 检查**，是全仓唯一"裸" Esc 监听——中文输入法组合中按 Esc 取消候选词会直接把窗口关掉。
- 7-02 设计文档已定义了收敛方向（`launcherEscapeInterceptor` 单槽协议）并在 `GlobalLauncherHostLifecycle.ts:127` 留了 `TODO(escape-migration)`，但只有 Quick Editor 一个页面接入。本包就是把这条 Future Work 做完。

## 二、产品语义：统一的 Escape 心智模型

**一句话规则：每按一次 Esc，向外退一层；输入法组合永远优先。**

从内到外的标准退出栈（所有宿主统一遵守）：

| 层 | 内容 | Esc 行为 |
|---|---|---|
| 0 | IME 组合中（候选词未上屏） | 交给输入法，绝不触发任何导航 |
| 1 | 页面内浮层：命令 overlay、Monaco find widget、轻提示、设置弹窗 | 关闭该浮层，停留在当前页面 |
| 2 | 多步流程帧：参数输入、collect-input、结果列表 | 回上一帧（等价于点"返回"） |
| 3 | 页面：host surface（quick-editor / system-settings / system-plugins）、plugin surface、权限确认页 | 回 launcher 列表（等价于面包屑「← hiven」） |
| 4 | launcher 列表 | 关闭 launcher 窗口 |

宿主特例（均为已有设计，本包保持）：

- **Quick Editor 编辑区**在第 3 层采用两段式 Esc（第一次出轻提示、窗口期内第二次才退出），防止误触丢失编辑焦点；`useQuickEditorEscape` 已实现，不动。
- **Detached Quick Editor / 独立插件窗口**没有第 4 层的"列表"，第 3 层的退出动作即为关闭窗口。
- **`closeOnBlur: true` 的 surface**（如剪贴板历史）不改变其 blur 行为，Esc 栈照常适用。

本包带来的**用户可见行为变化只有一处**：Quick Editor 命令 overlay 内处于参数/结果帧时按 Esc 从"整体关闭"改为"退一级"（与 Global Launcher 一致）。这是修正而非破坏——多步流程中途 Esc 全关且丢输入不符合任何一处已确认的设计。

## 三、技术方案

### 3.1 目标架构

保留并推广 7-02 已建立的 **interceptor 协议**（`src/components/launcher/launcherEscapeInterceptor.ts`，单注册槽、挂载注册/卸载注销、handler 返回 `true` 表示已接管）：

- **host 默认链瘦身为四步**：`IME 检查 → interceptor → controller.back() → 关窗`。
- settings 弹窗、plugin surface、host surface、permission 各页面的 Escape 语义**下放给页面自己**：每个页面挂载时注册自己的 interceptor handler，在 handler 内实现自己的第 1-3 层退出逻辑。
- 页面内部再有多层（如 overlay、多步帧）时，由该页面的 handler 自行按第二节的栈顺序处理，不新增全局机制。

### 3.2 迁移清单

| # | 位置 | 现状 | 目标 |
|---|---|---|---|
| 1 | `GlobalLauncherHostLifecycle.ts` 默认链 | if/else 长链含 settings/surface/permission 分支 + `TODO(escape-migration)` | 瘦身为四步链，删除 TODO 注释 |
| 2 | system-settings / system-plugins 页面 | 靠默认链的 hostSurfaceTarget 分支退出 | 页面组件注册 interceptor：返回列表（`clearLauncherHostSurface()`）。行为等价迁移，无用户可见变化 |
| 3 | plugin surface（launcher 内嵌形态） | 靠默认链 surfaceFrame 分支 | surface frame 宿主组件注册 interceptor：关闭 surface 回列表。`rendersTitlebar: true` 的插件（如剪贴板历史）不变——Esc 仍由宿主处理，插件不自持 Esc |
| 4 | 权限确认页（permission frame） | 靠默认链 permission 分支 | 注册 interceptor：取消权限请求回上一帧 |
| 5 | settings 弹窗（`PluginSettingsDialog` 等） | 默认链最前分支 | 弹窗组件自注册 interceptor（第 1 层浮层语义） |
| 6 | `GlobalLauncherKeyboard.ts:78-179` Escape 分支 | 对标准面板不可达的重复实现 | 整段删除；`handleGlobalLauncherKeyDown` 只保留非 Escape 键处理 |
| 7 | `QuickEditorCommandOverlay.tsx:144-149` | capture 阶段一律整体关闭 | 删除 capture 特判；overlay 挂载期间接管 Quick Editor 已注册的 interceptor（覆盖式：overlay 在时 handler 先处理 overlay 层），按帧状态实现"退一级 → 空帧时关 overlay" |
| 8 | `PluginSurfaceWindow.tsx:54-67` | 裸 Esc 监听，双重绑定，无 IME 检查 | 补 IME 检查（复用 `shouldIgnoreImeKeyDown` 同源逻辑）；window/document 双重绑定收敛为一处 |
| 9 | `QuickEditorDetachedView` | 已用两段式 hook，独立 window capture | 不动（已符合模型），仅确认与 interceptor 无双触发 |

### 3.3 协议约束

- interceptor 保持**单槽**：同一时刻只有最内层活动页面持有注册。嵌套场景（页面 + 页面内浮层）由页面 handler 内部处理浮层优先，不引入多槽/栈式注册——除非执行中发现单槽确实无法表达某个既有场景，此时停下报告，不要擅自升级协议。
- handler 的返回语义、`preventDefault` 归属权维持 7-02 文档原定义不变。
- IME 检查永远在 interceptor 之前、在所有宿主生效（含独立窗口）。

## 四、非目标

- 不改 blur 关闭策略（closeOnBlur 语义已在第一包类型强制）。
- 不改两段式 Esc 的提示时长、文案。
- 不动 Cmd+K / 全局快捷键路由（`syncShortcutNow` 的 accelerator 注销机制是必要机制，见 7-02 文档）。
- 不为本包新增任何用户可见 UI；新增文案（如无）必须走 i18n。

## 五、验收

自动验证：仓库四件套（`git status --short --ignored` / `npm run check:architecture` / `git diff --check` / `npm run build`）+ 相关契约测试更新（涉及 `GlobalLauncherKeyboard` 断言的脚本同步修改）。

真机手动矩阵（中文 IME 各验一遍第 0 层）：

| 场景 | 按 Esc 期望 |
|---|---|
| launcher 列表 | 关窗 |
| launcher 参数输入帧 → 结果帧 | 逐级回退，最后回列表 |
| 系统设置页 | 回列表；再 Esc 关窗 |
| 系统设置页 + 插件设置弹窗打开 | 先关弹窗，再回列表 |
| plugin surface（launcher 内嵌，默认标题栏） | 回列表 |
| 权限确认页 | 取消回上一帧 |
| Quick Editor surface 编辑区 | 两段式：提示 → 回列表（find widget 打开时先关 widget） |
| Quick Editor 命令 overlay 列表态 | 关 overlay 回编辑器 |
| Quick Editor 命令 overlay 参数/结果帧 | **退一级**（本包唯一行为变化点，重点验证） |
| Detached Quick Editor | 两段式：提示 → 关窗 |
| 独立插件窗口 + 中文输入法组合中 | 取消候选词，窗口不关 |

## 六、风险

- 迁移是"行为等价搬家"为主，最大风险是搬家期间某页面出现 Esc 无响应（interceptor 注册时序问题）。要求执行侧按 3.2 清单逐条迁移、逐条真机验证，不要批量一次切换。
- 单槽协议在"页面 + 弹窗"并存时依赖注册/注销时序正确（弹窗卸载须恢复页面的 handler）。若发现 React 卸载顺序导致槽位丢失，优先修注册时序而不是改协议。
