# Built-in Script 编写规范

## 概述

本文档定义了 FluxText 内置脚本（built-in scripts）的编写推荐规范，供新增或修改脚本时参考。

## 脚本结构

```typescript
import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'script-name',           // 唯一标识，kebab-case
  title: 'Display Title',        // 英文标题
  titleI18n: { zh: '中文标题' },
  icon: 'IconName',              // Lucide icon 名称
  aliases: ['alias1', 'alias2'], // Command Palette 搜索别名
  description: 'One-line description',
  descriptionI18n: { zh: '一行描述' },
  tags: ['tag1', 'tag2'],

  params: [],                    // 参数定义，见下文

  run(ctx) {
    // ctx.input.text - 输入文本
    // ctx.params.xxx - 参数值
    return { text: 'output' }
  },
})
```

## 参数设计原则

### 能推断就不要参数

如果脚本的行为可以从输入内容确定性地推断，**不要设置参数让用户选择**。

适合自动推断的场景：
- 编解码方向（Base64、URL）：检测输入特征判断 encode/decode
- 格式互转方向（JSON↔QS）：检测输入是 JSON 还是 query string
- 时间戳方向：数字→日期，日期字符串→时间戳

不适合自动推断的场景：
- 目标格式不唯一（大小写转换的 upper/lower/camel/snake）
- 算法选择（hash 的 SHA-256/SHA-1）
- 用户偏好（排序方向 asc/desc）

### 判断规则

```
能从输入 100% 确定 → 直接执行，不要参数
能从输入高概率确定但可能误判 → 加 auto + 保留显式模式
完全无法从输入确定 → 保留参数
```

### 什么时候保留显式模式

当 auto 存在误判风险时，保留显式选项作为 override：

```typescript
params: [
  {
    key: 'mode',
    options: [
      { label: 'Auto', value: 'auto' },    // 默认
      { label: 'Encode', value: 'encode' }, // override
      { label: 'Decode', value: 'decode' }, // override
    ],
    default: 'auto',
  },
],
```

### 什么时候完全去掉参数

当推断逻辑足够可靠、不需要用户 override 时，直接去掉 params：

```typescript
params: [],  // 零参数，纯自动

run(ctx) {
  const input = ctx.input.text.trim()
  // 直接从 input 推断并执行
}
```

**零参数的好处**：用户触发 action 后立刻得到结果，无需任何交互。

### 特殊文本触发

对于"空输入有特殊含义"的场景，用输入文本本身作为触发：

```typescript
// 空输入或 "now" → 输出当前时间
if (!input || input.toLowerCase() === 'now') {
  return { text: formatNow() }
}
```

## 错误处理规范

### 错误格式

```
Error: [原因]. [建议].
```

示例：
```
Error: Cannot infer timestamp unit for "12345". Expected 10/13/16/19 digit timestamp or parseable date.
Error: Cannot infer URL operation. Input looks like a plain URL with no encoded segments. Choose encode or decode explicitly.
Error: Invalid JSON - Unexpected token at position 5.
```

### 规则

1. 不要只写 `Error` 或 `Error: failed`
2. 说明**为什么**不能处理
3. 告诉用户**下一步怎么做**（选择显式模式、修正输入等）
4. 不要把错误伪装成成功的转换结果

## 多行处理

### 默认按行独立处理

大多数脚本应该支持多行输入，每行独立转换：

```typescript
const lines = input.split('\n')
const results = lines.map(line => convert(line.trim()))
return { text: results.join('\n') }
```

### 例外：整体处理

以下场景需要整体处理输入，不按行拆分：
- JSON 格式化（输入是完整 JSON）
- CSV 转换（输入是完整表格）
- SQL 格式化（输入是完整语句）

## 格式化类脚本约定

对于 pretty/compact 类的格式化脚本（JSON、SQL、CSS、XML）：

- 默认 `pretty`（用户更常需要可读格式）
- `compact` 作为显式选项保留
- 不需要 auto（pretty 作为默认不会造成惊讶）

## description 编写

- 英文 description 简短一行，说明脚本**做什么**
- 如果有自动推断能力，在描述中体现
- 中英文 description 含义一致

好的描述：
```
'Auto-convert between timestamp and date (supports seconds/ms/μs/ns)'
'自动互转时间戳与日期（支持秒/毫秒/微秒/纳秒）'
```

不好的描述：
```
'Timestamp utility'  // 太模糊
'Convert timestamp to date or date to timestamp supporting multiple formats'  // 太长
```

## Checklist

新增或修改脚本前过一遍：

- [ ] 是否能从输入推断行为？能则去掉对应参数
- [ ] 推断有误判风险？保留显式 mode 作为 override
- [ ] 错误信息是否包含原因和建议？
- [ ] 多行输入是否正确处理？
- [ ] description 是否准确反映当前行为？
- [ ] titleI18n / descriptionI18n 是否同步更新？
