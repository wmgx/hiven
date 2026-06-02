# Diff 能力的插件边界决策

## 结论

FluxText framework 不知道 diff。

Diff 不是 framework API，也不是 framework surface。Diff 是插件用 framework 提供的 workspace、pane、renderer、editor primitive 组合出来的产品能力。

可以沉淀共享工具包，例如 `diff-kit`，但它只能是纯函数算法库，不能持有 framework runtime，不能注册 command / renderer / panel，也不能包含某个格式的产品策略。

当前应收敛到三层：

```text
Framework:
  plugin host / registry / renderer lifecycle / workspace / pane / editor primitives

Kits:
  pure utility libraries, imported statically by plugins

Plugins:
  text-diff / json-diff / markdown-diff / future semantic diff products
```

## 背景

最近实现 JSON semantic diff 时，为了摆脱 Monaco DiffEditor 默认 UI，尝试让插件自己构建双栏编辑体验。这个方向可以接受：插件可以自建 UI。

真正的问题不是自建 UI，而是边界：

```text
不应把 JSON 语义比较、数组匹配策略、invalid JSON fallback、JSON 专属 toolbar
塞进 core.diff 或 workspace framework。
```

如果未来继续扩展 text diff、JSON diff、Markdown diff、AST/code semantic diff，复用关系也不应该变成“插件依赖插件”。横向插件依赖会引入加载顺序、版本锁定和运行时耦合。

因此需要一份明确规则：

```text
Framework does not know diff.
Plugins own diff products.
Kits only share pure code.
```

## 分层边界

### Framework

Framework 只负责宿主能力：

```text
plugin 注册、启用、禁用、卸载
command / renderer / panel contribution registry
renderer lifecycle: mount / unmount / dispose
workspace 和 pane 状态
pane 文本读写、聚焦、选择
editor primitive 和 Monaco instance lifecycle
decorations / widgets / view state 等基础 editor bridge
settings / context
effect runner 和 surface occupancy
```

Framework 不提供：

```text
diff API
compare API
DiffSurface
CompareRenderer
TextDiffRenderer
JSON diff fallback
dual-pane diff layout
line diff 算法
semantic diff 算法
JSON / Markdown / Code 语义理解
```

判断标准：

```text
如果概念里出现 diff、compare、JSON、Markdown、AST、code semantic，
默认不属于 framework。
```

### Kit

Kit 是静态导入的工具库，不是插件，也不是 framework extension point。

Kit 可以包含：

```text
diff-kit:
  LCS / Myers / hunk / range mapping / patch helpers

ast-kit:
  parse / walk / node path utilities

ui-kit:
  纯 React 组件，props in / JSX out，不读取 framework context
```

Kit 不可以包含：

```text
plugin registration
renderer lifecycle
workspace / pane 读写
framework context hook
全局状态
网络 / 文件 / 持久化副作用
某个插件专属产品策略
```

Kit 的准入三问：

```text
1. 这个函数或组件是否需要 framework 对象？
   是 -> 不进 kit。

2. 它是否持有运行时状态或副作用？
   是 -> 不进 kit。

3. 它是否只服务一个插件的一种产品策略？
   是 -> 不进 kit，留在插件内部。
```

### Plugin

插件拥有产品能力和产品体验。

Diff 相关插件可以包括：

```text
plugin-text-diff:
  文本 diff 命令、UI、布局、line diff 使用方式

plugin-json-diff:
  JSON parse 调用、semantic diff、array compare mode、key order 策略、
  invalid JSON fallback、JSON toolbar、展示文案

plugin-markdown-diff:
  Markdown block 策略、inline 策略、fallback 策略

plugin-code-semantic-diff:
  AST parse 选择、rename-aware 策略、语言特定展示
```

插件之间不运行时依赖。`plugin-json-diff` 不依赖 `plugin-text-diff`。如果二者有共享算法，算法下沉到 kit。

## 对 Claude 建议的取舍

可接受：

```text
framework 不提供 framework.diff.compute()
framework 不提供 ctx.diff.open()
插件之间不互相依赖
diff-kit 必须是纯函数
通过 lint / package 规则防止 kit 反向依赖 framework
text-diff / json-diff / markdown-diff 都作为 first-party plugins
```

需要打回：

```text
DualPaneLayout 不进 framework。
ast-kit 不提供 semanticDiff。
```

### 为什么 DualPaneLayout 不进 framework

双栏同步布局看起来是“纯 UI 原语”，但它已经包含一组产品体验取舍：

```text
是否双栏
是否同步滚动
如何处理 resize
如何处理折叠、行高、decorations 偏移
左右 slot 的语义
toolbar 和布局状态如何组合
```

这些不是宿主必须知道的能力。

如果多个插件需要复用，可以放在 `ui-kit` 或 `diff-ui-kit`；如果暂时只有一个插件需要，先留在插件内部。Framework 只暴露更原子的 editor primitive。

### 为什么 ast-kit 不提供 semanticDiff

`ast-kit` 可以 parse / walk / normalize node shape，但 `semanticDiff()` 是产品策略。

例如 JSON diff 的语义策略包括：

```text
object key order 是否忽略
展示时是否保留每侧原始 key 顺序
array 按 index / unordered scalar / object key 对比
invalid JSON 是否 fallback 到 text diff
fallback 后高亮和文案怎么处理
```

这些属于 `plugin-json-diff`，不属于 parser kit。

## 推荐目录

短期不要求立刻 monorepo 化，可以先在当前 `src/` 下按边界迁移：

```text
src/workspace/
  framework 宿主能力：
    pluginRegistry.ts
    effectRunner.ts
    workspaceStore.ts
    runtimeRegistry.ts
    pluginTypes.ts
    monacoBridge.ts

src/kits/diff/
  lcs.ts
  hunk.ts
  rangeMapping.ts

src/kits/ast/
  jsonParse.ts
  jsonWalk.ts

src/plugins/textDiff/
  index.ts
  TextDiffRenderer.tsx
  lineDiffEngine.ts

src/plugins/jsonDiff/
  index.ts
  JsonDiffRenderer.tsx
  jsonSemanticDiff.ts
  arrayCompare.ts
  fallback.ts
```

如果后续拆包，再映射为：

```text
packages/framework
packages/kit/diff-kit
packages/kit/ast-kit
packages/kit/ui-kit
plugins/plugin-text-diff
plugins/plugin-json-diff
```

## 当前落地结构

已完成的架构收敛：

```text
core.diff 已移除，不再作为 JSON-aware 默认入口。
text-diff 是独立 first-party plugin。
json-diff 是独立 first-party plugin。
JSON 语义逻辑已从 workspace 移到 plugins/jsonDiff/。
line diff 纯算法已从 workspace 移到 kits/diff/。
双栏 editor 组件已移到 kits/ui/，且不 import workspace/plugins。
registerCompareRenderer / CompareRendererDef 已从 workspace public API 移除。
```

当前目录：

```text
src/plugins/textDiff/
  index.ts
  TextDiffRenderer.tsx

src/plugins/jsonDiff/
  index.ts
  JsonDiffRenderer.tsx
  jsonSemanticDiff.ts

src/kits/diff/
  lineDiff.ts

src/kits/ui/
  DualEditorView.tsx
```

后续如继续拆包，可把 `src/kits/*` 映射到 `packages/kit/*`，把 `src/plugins/*` 映射到独立 plugin package；拆包不是当前架构边界成立的前置条件。

## 未来扩展的数据流

Text diff：

```text
plugin-text-diff command
  -> resolve pane inputs via framework
  -> plugin engine calls diff-kit line/hunk helpers
  -> plugin renderer decides layout and decorations
```

JSON diff：

```text
plugin-json-diff command
  -> resolve pane inputs via framework
  -> plugin parses JSON, chooses semantic strategy
  -> plugin may call diff-kit for fallback / line alignment
  -> plugin renderer owns toolbar, array mode, invalid JSON messaging
```

Markdown diff：

```text
plugin-markdown-diff command
  -> parse Markdown blocks through ast-kit parser helpers
  -> plugin owns block diff strategy
  -> plugin may call diff-kit for inline text hunks
```

Code semantic diff：

```text
plugin-code-semantic-diff command
  -> plugin chooses parser / language support
  -> plugin owns AST semantic rules
  -> plugin renderer owns code-specific UI
```

Framework 只参与：

```text
输入解析
pane text access
renderer mount
editor instance / decorations primitives
cleanup lifecycle
```

## 护栏

### Import 规则

```text
src/kits/** 不允许 import src/workspace/**
src/plugins/*/** 不允许 import src/plugins/other-plugin/**
src/workspace/** 不允许 import src/plugins/**
```

允许方向：

```text
plugins -> workspace public API
plugins -> kits
workspace -> no plugins, no kits with product semantics
kits -> no workspace, no plugins
```

当前项目已提供自动检查：

```bash
npm run check:architecture
```

该命令会检查：

```text
workspace 不保留 diff/json/compare 专属源文件或 public API
source 不回退到 core.diff / core.json-diff / jd-* 命名
kits 不 import workspace 或 plugins
workspace 不 import plugins
plugins 不横向 import 其他 plugins
```

### 命名规则

Framework 层避免出现：

```text
Diff
Compare
Json
Markdown
CodeDiff
SemanticDiff
```

例外：

```text
历史兼容 adapter 或 deprecation note 可以短期保留，但必须标注迁移目标。
```

### Kit 规则

Kit 导出应尽量是：

```text
(input) => output
```

或：

```text
React component: props -> JSX
```

不能出现：

```text
useWorkspace()
usePluginContext()
registerCommand()
openRenderer()
updatePaneText()
```

## 验收标准

重构完成后满足：

```text
1. src/workspace 不包含 JSON semantic diff、line diff、hunk 计算、dual-pane diff UI。

2. core.diff 不再自动识别 JSON，也不包含 JSON 专属文案或 toolbar。

3. json-diff 是独立 first-party plugin，JSON 策略都在 plugin 内。

4. text-diff 和 json-diff 不互相 import。

5. kits 不 import workspace 或 plugins。

6. 新增 markdown diff 时，不需要修改 framework。

7. framework grep "semanticDiff|jsonDiff|lineDiff|CompareRenderer|DiffSurface" 无业务命中。

8. `npm run check:architecture` 通过。

9. 构建通过；若 lint 受历史问题影响，至少新增/迁移文件无新增 lint 错误。
```

## 和既有文档的关系

`doc/workspace-extension-architecture.md` 与 `doc/multi-pane-diff-and-selection-plan.md` 中关于 `CompareRenderer`、`Diff renderer`、`monaco-diff` 作为可扩展 framework 能力的表述，视为早期方案背景。

后续实现以本文为准：

```text
Diff 相关能力进入 first-party plugins。
Framework 只保留无业务语义的宿主和 editor primitives。
```
