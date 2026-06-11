# hiven 项目指令

本文件补充全局 AGENTS.md，适用于 `/Users/bytedance/flux_text`。

## 语言与产物

- 默认使用中文回复和写文档。
- 文档放在 `doc/`。
- 临时文件放在 `temp/`，任务结束后删除无保留价值的中间文件。

## 插件系统边界

hiven framework 是 plugin host，不是具体工具能力集合。

Framework 只负责：

```text
plugin registry / command / renderer / panel
renderer lifecycle
workspace / pane 状态
pane 文本读写、聚焦、选择
editor primitive、Monaco instance lifecycle、decorations bridge
settings / context
effect runner / surface occupancy
```

Framework 不应包含：

```text
diff API
compare API
DiffSurface
CompareRenderer
TextDiffRenderer
JSON / Markdown / AST / code semantic 逻辑
line diff / semantic diff 算法
dual-pane diff layout
具体插件的 toolbar、fallback、展示文案或产品策略
```

判断口径：

```text
如果一个概念带有 diff、compare、JSON、Markdown、AST、code semantic 等产品语义，
默认不属于 framework。
```

## Diff 能力原则

Diff 是插件产品，不是 framework 能力。

- `text-diff`、`json-diff`、`markdown-diff` 等都应作为 first-party plugins。
- `core.diff` 不应变成 JSON-aware 默认入口。
- JSON parse、semantic diff、array compare mode、key order 策略、invalid JSON fallback、JSON toolbar 和展示文案属于 `json-diff` 插件。
- 插件之间不运行时依赖；例如 `json-diff` 不依赖 `text-diff`。
- 多个插件共享的纯算法可以下沉到 kit，例如 `diff-kit`，但 kit 不是插件，也不是 framework API。

Kit 准入规则：

```text
1. 需要 framework 对象 -> 不进 kit。
2. 持有运行时状态或副作用 -> 不进 kit。
3. 只服务一个插件的一种产品策略 -> 不进 kit，留在插件内部。
```

允许的依赖方向：

```text
plugins -> workspace public API
plugins -> kits
workspace/framework -> 不依赖 plugins
kits -> 不依赖 workspace/framework，也不依赖 plugins
```

相关决策文档：

```text
doc/diff-plugin-boundary-decision.md
```

## hiven Diff/UI 历史偏好

- Diff 在产品上首先是文本工具，不是代码审查工具，也不是 code diff。
- 如果需要自建 UI，可以由插件自建；不要因此把双栏 diff 体验吸收到 framework。
- 不要把 Monaco/code editor 的实现细节泄漏成 `CodeDiff`、`CompareRenderer` 等框架概念。
- 如果视觉体验继续迭代，先明确插件边界，再改 UI。

## 验证要求

修改 diff、插件系统、workspace renderer 或 UI 后，至少执行：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

如果执行 `npm run lint`，需注意当前仓库可能存在历史 lint 问题或 ignored worktree 干扰；最终结论要区分历史问题和本次新增问题。

涉及可视化 diff/UI 的改动，尽量补浏览器验证，重点看真实 DOM/画面效果，而不是只看构建通过。
