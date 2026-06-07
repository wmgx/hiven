# JS Filter 结构感知补全设计

## 目标

为内置 `js-filter` 插件的表达式输入栏增加结构感知补全。第一版覆盖当前 JSON 的字段路径提示和常用 JS 链式方法片段，不改变表达式执行语义。

## 范围

- 保留现有 pane-bottom 面板，将原生输入框替换为 compact Monaco editor。
- 从当前 active pane 文本解析 JSON，生成对象字段和数组元素结构。
- 输入 `.user.`、`[0].`、`.items[0].` 等路径时提示下一层字段。
- 同时提示常用方法 snippet，例如 `.map(x => x)`、`.filter(x => x)`、`.slice(0)`。
- 使用 Monaco suggest 和 snippet 能力支持键盘选择、补全应用、Tab 占位点跳转和补全后光标定位。

## 降级策略

- 当前 pane 不是合法 JSON 时，不展示字段路径候选，只保留通用方法片段。
- 路径解析失败时不报错，不影响用户继续输入或执行表达式。

## 非目标

- 不实现完整 JavaScript IntelliSense、类型检查或语法诊断。
- 不改变现有 `new Function` 表达式执行方式。
