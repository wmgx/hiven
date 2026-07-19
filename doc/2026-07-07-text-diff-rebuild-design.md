# Text Diff 展示端重建（第四包）设计文档

> 日期：2026-07-07
> 状态：设计确认，待执行
> 前置依赖：第一包（`doc/2026-07-07-workbench-retirement-cleanup-design.md`）完成后执行；建议第三包（Escape 统一）先行，否则本包 Esc 行为按第三包模型预留。
> 背景：主工作台退役后 `openDiffPage` 的展示端断裂（第一包做了"暂不可用"止血提示）。本包重建展示端，**完成后移除该止血提示与 `TODO(diff-rebuild)` 注释**。
> 视觉参考：`doc/2026-07-07-text-diff-mockup.html`（含 launcher 内嵌 / 独立窗口两种形态，accent 用已拍板的 `#2563eb`）。

## 一、产品决策（已确认）

1. **进入流程不动**：保留现状的 launcher 分步源选择交互（compare 命令 → 依次选择两个来源）。唯一适配：来源列表中的"编辑器 pane"改为指 Quick Editor 的各 pane（含分栏），加上剪贴板与空白。
2. **展示端为 text-diff 插件自建 surface**，走标准 plugin surface 通道；host 不新增任何 diff 概念（AGENTS.md 边界）。
3. **两种宿主都支持**：默认在 launcher 内原地展开；工具栏提供"脱离"弹到独立插件窗口。
4. **产品气质**：文本工具，不是代码审查工具——无 +/- 符号、无 gutter 强调，柔和红/绿 tint。

## 二、交互规格

### 2.1 双栏视图

- 左右双栏、行对齐展示；行级 diff + 行内字符级高亮（沿用 text-diff 插件现有算法，本包不改算法）。
- 删除 = 柔和红 tint，新增 = 柔和绿 tint，修改行行内变更字符用深一档 tint；对侧无对应行时用极淡占位行保持对齐。
- **两栏默认可编辑（无"进入编辑态"概念），实时重算 diff**（防抖约 300ms）。这同时是"换源"的通用解——选错了直接全选重粘，不做专门换源 UI。
- **面包屑行与工具栏合一**（不另起工具栏行）：
  - 左侧：返回按钮 + 面包屑（launcher 形态）；独立窗口无面包屑。
  - 中部：对比模式 toggle（文本 | JSON 语义）；选中 JSON 语义时，按钮旁通过下拉菜单选择「数组有序 / 数组无序」，选完收起，按钮角标显示当前模式。
  - 右侧：⇄ 交换左右、脱离（独立窗口形态下为关闭，靠右对齐）。
- **底部状态栏**：差异导航（「上一处 | 1/3 | 下一处」），点击跳转到对应 diff 区块。
- launcher 形态下使用系统面包屑头（`rendersTitlebar: false`）；`closeOnBlur: false`（对照核对必然切走窗口）。

### 2.2 会话与 detach 模型（比 Quick Editor 简单）

- **一次性会话、全局单实例**：diff 内容不持久化，关闭即结束；无"回巢"概念。
- detach：点脱离 → 内容搬进独立插件窗口，launcher 收起。
- 独立窗口已存在时再次发起 compare：新 payload 替换进已有窗口并聚焦，不开第二个实例。
- launcher 内 surface 打开时再次发起 compare：替换当前内容。

### 2.3 键盘

- Esc 遵循第三包统一模型：launcher 形态回列表；detached 形态关窗；中文 IME 组合优先（若第三包未先行，按其设计文档第 3.2 节的 interceptor 协议实现，不自造第四种 Esc 机制）。
- 工具栏按钮均可 Tab 到达、Enter 触发；双栏之间可用 Tab 切换焦点。

## 三、技术接线要点

- 复用资产：`src/kits/ui/DualEditorView.tsx`（kit 双栏组件，第一包已保留）、`src/plugins/textDiff/` 内的算法与 `DiffPageView.tsx`（按新宿主改造或重写，以复用为先）。
- payload 通路：`openDiffPage(payload)` 从第一包的止血提示改为打开 text-diff 插件 surface 并注入 `{ original, modified }`；插件命令 `text-diff.compare` 不再调用 `showEditorWindow()`。
- 插件边界红线：text-diff 通过 host API / SDK 打开 surface 与读取源（剪贴板、Quick Editor pane 快照），不得深层 import host 内部；`npm run check:architecture` 必须全绿（workspace 内不得出现 diff 语义关键词，现有守卫会拦）。
- 所有新增文案走 i18n，中英文同步。

## 四、边界与演进预留（只写不做）

- **JSON 语义对比**：UI 层本期已包含「文本 / JSON 语义」模式切换与「数组有序 / 无序」下拉菜单；JSON parse + semantic diff 算法明确属于 `json-diff` 插件，text-diff 插件不做 JSON parse。选中 JSON 语义模式时若算法未就绪，显示"即将支持"提示或 fallback 到文本对比。
- 双栏布局若将来被 `json-diff` 复用，再把纯展示组件/纯算法抽到 `diff-kit`（kit 准入：不持 framework 对象、无运行时状态）；第一期只服务 text-diff，**留在插件内部**，不预先抽象。
- 插件间不运行时依赖：json-diff 届时不依赖 text-diff。

## 五、非目标（第一期不做）

unified/inline 视图切换、语法高亮语言选择、文件来源、忽略空白/大小写选项、diff 结果导出、窗口位置记忆。用起来觉得缺再立项。

## 六、验收

自动：仓库验证四件套全绿；第一包新增的可达性检查中 textDiff/DualEditorView 移出白名单（重新可达）。

真机路径：

1. launcher → compare → 选剪贴板 + 空白 → launcher 内出现双栏视图，左栏为剪贴板内容，默认可编辑。
2. 右栏粘贴文本 → diff 实时出现；编辑任一侧 → 底部导航「1/N」与高亮实时更新。
3. 点击底部「上一处 / 下一处」→ 视图滚动到对应 diff 区块。
4. 切到其它应用再回来 → 视图仍在（closeOnBlur:false）。
5. 点脱离 → 独立窗口带内容打开、launcher 收起；再次发起 compare → 内容替换进该窗口并聚焦。
6. 切换「JSON 语义」模式 → 下拉菜单出现「数组有序 / 数组无序」选项；选完收起，按钮角标更新。
7. Esc：launcher 形态回列表、detached 关窗；中文输入法组合中 Esc 不误触发。
8. 第一包的「暂不可用」提示已不存在。
