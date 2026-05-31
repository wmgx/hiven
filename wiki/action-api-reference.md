# FluxText Action API 参考

## defineAction

所有脚本通过 `defineAction` 定义，导出为默认模块：

```typescript
import { defineAction } from 'fluxtext'

export default defineAction({
  // --- 元信息 ---
  name: string,            // 必填，唯一标识（kebab-case）
  title: string,           // 必填，显示标题
  titleI18n?: { zh: string },
  icon?: string,           // Lucide icon 名称
  aliases?: string[],      // Command Palette 搜索别名
  description?: string,    // 一行描述
  descriptionI18n?: { zh: string },
  tags?: string[],         // 分类标签

  // --- 参数 ---
  params?: ParamDef[],     // 参数定义，可为空数组

  // --- 执行 ---
  run(ctx: ActionContext): ActionResult | Promise<ActionResult>,
})
```

---

## ActionContext (ctx)

`run(ctx)` 接收的上下文对象：

| 属性 | 类型 | 说明 |
|------|------|------|
| `ctx.input.text` | `string` | 编辑器当前文本（若有选区则为选区文本） |
| `ctx.params` | `Record<string, any>` | 用户选择的参数值，按 `key` 索引 |
| `ctx.readClipboard()` | `() => Promise<string>` | 异步读取系统剪贴板 |
| `ctx.deps` | `Record<string, any>` | 通过 `@deps` 声明加载的外部依赖 |
| `ctx.loadCDN` | `(url: string) => Promise<any>` | 动态加载 CDN 模块 |

### ctx.input.text

- 若编辑器有选区 → 只传入选区文本
- 若无选区 → 传入整个编辑器内容
- 脚本不需要关心选区逻辑，统一操作 `ctx.input.text`

### ctx.params

- 参数值对应 `params` 中声明的 `key`
- 类型由 param 的 `type` 决定：
  - `text` → `string`
  - `textarea` → `string`
  - `number` → `number`
  - `boolean` → `boolean`
  - `single-select` → `string`（选中的 option value）
  - `multi-select` → `string[]`（选中的 option values）
- 若 `params: []`，则 `ctx.params` 为空对象 `{}`

### ctx.deps

通过脚本头部的 `@deps` 注释声明外部依赖，系统自动加载并注入：

```typescript
// @deps yaml https://esm.sh/js-yaml@4?bundle
// @deps sql-formatter https://esm.sh/sql-formatter@15?bundle

async run(ctx) {
  const jsYaml = ctx.deps.yaml
  const { format } = ctx.deps['sql-formatter']
}
```

---

## ActionResult

`run` 函数的返回值：

```typescript
interface ActionResult {
  text: string  // 输出文本，将替换编辑器内容或选区
}
```

- 返回 `{ text: "..." }` 即可
- 支持同步返回或 `async` 异步返回
- 输出的 `text` 将：
  - 若有选区 → 替换选区内容
  - 若无选区 → 替换整个编辑器内容

---

## ParamDef

参数定义结构：

```typescript
interface ParamDef {
  key: string              // 参数唯一键名
  label: string            // 显示标签
  labelI18n?: { zh: string }
  type: ParamType          // 参数类型
  default?: any            // 默认值
  required?: boolean       // 是否必填（仅 text/textarea）
  options?: ParamOption[]  // 选项（仅 single-select/multi-select）
  visibleWhen?: Record<string, any>  // 条件显示
}

type ParamType = 'text' | 'textarea' | 'number' | 'boolean' | 'single-select' | 'multi-select'

interface ParamOption {
  label: string
  value: string
  labelI18n?: { zh: string }
}
```

### 参数类型速查

| type | UI 组件 | 值类型 | 用途 |
|------|---------|--------|------|
| `text` | 单行输入框 | `string` | 分隔符、前后缀、正则 |
| `textarea` | 多行输入框 | `string` | 模板、大段替换文本 |
| `number` | 数字输入框 | `number` | 缩进大小、限制数量 |
| `boolean` | 开关 | `boolean` | 忽略大小写、启用选项 |
| `single-select` | 单选下拉 | `string` | 模式选择、方向选择 |
| `multi-select` | 多选下拉 | `string[]` | 组合功能选择 |

### 条件显示

参数可以依赖另一参数的值来决定是否显示：

```typescript
{
  key: 'regexPattern',
  label: 'Regex Pattern',
  type: 'text',
  visibleWhen: { regex: true }  // 仅当 regex 参数为 true 时显示
}
```

### 参数持久化

系统自动持久化 `boolean`、`single-select`、`multi-select` 类型的参数值。用户再次打开同一 Action 时恢复上次选择。

---

## 外部依赖 (@deps)

### 声明语法

在文件头部注释中声明：

```typescript
// @deps <name> <url>
```

- `name`: 注入到 `ctx.deps` 的键名
- `url`: ESM 模块 URL（推荐使用 esm.sh）

### 示例

```typescript
// @deps yaml https://esm.sh/js-yaml@4?bundle
// @deps sql-formatter https://esm.sh/sql-formatter@15?bundle

export default defineAction({
  // ...
  async run(ctx) {
    const jsYaml = ctx.deps.yaml
    return { text: jsYaml.dump(JSON.parse(ctx.input.text)) }
  },
})
```

### 注意事项

- 使用 `@deps` 时 `run` 应声明为 `async`
- 依赖会被缓存，不会每次重新下载
- 推荐使用 `?bundle` 参数确保单文件加载

---

## 完整示例

### 零参数脚本

```typescript
import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'reverse',
  title: 'Reverse Lines',
  titleI18n: { zh: '反转行' },
  icon: 'ArrowDownUp',
  aliases: ['flip-lines'],
  description: 'Reverse the order of lines',
  descriptionI18n: { zh: '反转行顺序' },
  tags: ['text'],
  params: [],

  run(ctx) {
    return { text: ctx.input.text.split('\n').reverse().join('\n') }
  },
})
```

### 带参数脚本

```typescript
import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'wrap',
  title: 'Wrap Lines',
  titleI18n: { zh: '包裹每行' },
  icon: 'WrapText',
  aliases: ['wrap-lines', 'surround'],
  description: 'Wrap each line with prefix and suffix',
  descriptionI18n: { zh: '在每行两端添加指定文本' },
  tags: ['text', 'lines'],

  params: [
    { key: 'left', label: 'Left', labelI18n: { zh: '左侧' }, type: 'text', default: '"' },
    { key: 'right', label: 'Right', labelI18n: { zh: '右侧' }, type: 'text', default: '"' },
  ],

  run(ctx) {
    const left = ctx.params.left ?? '"'
    const right = ctx.params.right ?? '"'
    return { text: ctx.input.text.split('\n').map(l => left + l + right).join('\n') }
  },
})
```

### 异步 + 外部依赖脚本

```typescript
import { defineAction } from 'fluxtext'
// @deps sql-formatter https://esm.sh/sql-formatter@15?bundle

export default defineAction({
  name: 'sql',
  title: 'SQL Formatter',
  titleI18n: { zh: 'SQL 格式化' },
  icon: 'Database',
  aliases: ['sql-format'],
  description: 'Format or minify SQL',
  descriptionI18n: { zh: '美化或压缩 SQL' },
  tags: ['sql', 'format'],

  params: [
    {
      key: 'mode',
      label: 'Mode',
      labelI18n: { zh: '模式' },
      type: 'single-select',
      options: [
        { label: 'Pretty', value: 'pretty', labelI18n: { zh: '美化' } },
        { label: 'Compact', value: 'compact', labelI18n: { zh: '压缩' } },
      ],
      default: 'pretty',
    },
  ],

  async run(ctx) {
    if (ctx.params.mode === 'compact') {
      return { text: ctx.input.text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim() }
    }
    const { format } = ctx.deps['sql-formatter']
    return { text: format(ctx.input.text) }
  },
})
```
