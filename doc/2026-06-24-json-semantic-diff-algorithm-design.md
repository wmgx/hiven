# JSON 纯语义 Diff 算法设计

## 背景

当前 JSON 语义 diff 暴露了数组对比方式选择：按索引、标量无序、按对象 key。这个交互把算法细节交给用户判断，且默认按索引会在对象数组中间插入或重排时误报后续相同对象为差异。

本设计确认新的产品口径：JSON 模式就是纯语义对比，不再让用户选择数组策略。

## 目标

JSON 纯语义 diff 应忽略：

- JSON 文本格式差异，例如缩进、换行、空格。
- 对象 key 顺序差异。
- 数组纯顺序差异。

JSON 纯语义 diff 只展示：

- 字段或元素新增。
- 字段或元素删除。
- 类型变化。
- 值变化。
- 同一语义实体内部字段变化。

示例：

```json
{
  "plans": [
    { "code": "basic", "level": 1, "title": "Basic" },
    { "code": "pro", "level": 2, "title": "Pro" }
  ]
}
```

对比：

```json
{
  "plans": [
    { "code": "new", "level": 1, "title": "New" },
    { "code": "pro", "level": 2, "title": "Pro" },
    { "code": "basic", "level": 1, "title": "Basic" }
  ]
}
```

应只报：

```text
$.plans{code="new"} added
```

不应报 `basic` 和 `pro` 的位置变化。

## 非目标

- 不在 framework 引入 diff / compare / JSON 语义概念；该能力仍属于 diff 插件或 diff kit。
- 不展示 moved / reordered 作为语义差异。
- 不在 JSON 模式内继续暴露数组策略选择。
- 不把某个业务字段写死为唯一匹配规则。

如果用户需要观察顺序变化，应切回 Lines 模式。

## UI 口径

JSON diff 只保留模式切换：

```text
Lines | JSON
```

删除 JSON 模式下的数组策略选择：

```text
数组：按索引 / 标量无序 / 按键
```

建议状态文案：

```text
JSON 语义对比：已忽略格式、对象键顺序和数组顺序
```

无差异时：

```text
语义无差异
```

JSON 非法时：

```text
JSON 解析失败，已回退到文本对比
```

## 核心语义规则

### Primitive

- `null`、boolean、number、string 按 JSON 语义比较。
- `1` 和 `1.0` 语义相同。
- `1` 和 `"1"` 语义不同。
- `false`、`0`、`""`、`null` 互不相同。
- 类型不同一定是差异。

注意：第一版可接受 `JSON.parse` 的 JS number 行为；若后续需要精确保留大整数或 decimal，应引入 lossless number parser。

### Object

对象 key 顺序不构成差异。

```json
{ "a": 1, "b": 2 }
```

与：

```json
{ "b": 2, "a": 1 }
```

语义相同。

对象 diff 规则：

1. 左侧有、右侧没有：removed。
2. 左侧没有、右侧有：added。
3. 两边都有：递归 diff。
4. `null` 和缺失字段不同。

### Array

数组按语义多重集合处理，默认忽略纯顺序变化。

```json
["read", "write", "admin"]
```

与：

```json
["admin", "read", "write"]
```

语义相同。

重复数量保留语义：

```json
["a", "a", "b"]
```

对比：

```json
["a", "b", "b"]
```

应报一个 `"a"` removed 和一个 `"b"` added。

## 数组算法

统一入口：

```ts
diffArraySemantic(leftArray, rightArray, path)
```

### Step 1：精确语义元素抵消

先用 canonical signature 抵消完全语义相同的元素。

`canonicalSignature(value)` 规则：

- primitive 标准化。
- object key 排序。
- array 内部也按元素 canonical signature 排序，并保留重复数量。

例如以下对象语义相同：

```json
{ "code": "a", "enabled": true }
```

```json
{ "enabled": true, "code": "a" }
```

对象数组纯重排会在这一步全部抵消，无 diff。

### Step 2：对象数组身份字段匹配

对未抵消的 object 元素，尝试推断身份字段。

固定候选字段包括：

```text
id
uid
uuid
key
code
name
slug
value
type
identifier
```

动态候选字段来自对象自身字段，只要满足：

- 字段值是 primitive。
- 在多数对象中存在。
- 同侧唯一性高。
- 两侧值交集高。

评分建议：

```text
score = coverage_score
      + uniqueness_score
      + overlap_score
      + name_hint_score
      - duplicate_penalty
```

只有最高分超过阈值且不模糊时才采用该身份字段。

身份字段匹配后：

- 左右都有同一身份：递归 diff。
- 只有左侧：removed。
- 只有右侧：added。

路径使用语义身份：

```text
$.plans{code="basic"}.title
```

### Step 3：相似度匹配

若没有可靠身份字段，对剩余 object 尝试相似度匹配。

相似度依据：

- key 集合重合度。
- primitive 字段相等数量。
- nested object / array 的语义相似度。
- 类型一致性。
- 字符串轻微变化可加弱分，但不应主导。

匹配策略：

- 小规模剩余集合可构造相似度矩阵，选择最大权重匹配。
- 大规模集合先 bucket，再 greedy。
- 分数低于阈值不匹配。
- 若多个候选分数接近，视为模糊，不匹配。

保守原则：宁可输出 removed + added，也不要把两个不同实体误合并成 changed。

### Step 4：剩余元素 added / removed

经过精确抵消、身份匹配、相似度匹配后：

- 左侧剩余元素：removed。
- 右侧剩余元素：added。
- matched pair：递归 diff。

## 身份字段变化

示例：

```json
[{ "code": "a", "title": "A" }]
```

对比：

```json
[{ "code": "a2", "title": "A" }]
```

如果 `code` 被判定为身份字段，第一版应保守输出：

```text
$.items{code="a"} removed
$.items{code="a2"} added
```

不默认输出 `code changed`，因为身份变化通常代表实体变化。

未来可增加更友好的 `identity-changed`，但不作为第一版目标。

## 混合数组

混合数组支持 primitive、object、array、null：

```json
[
  "basic",
  { "code": "pro" },
  1,
  null
]
```

规则：

- primitive 与 primitive 按多重集合比较。
- object 与 object 走对象匹配。
- array 与 array 递归走数组语义匹配。
- 类型不同不互相匹配，除非最终作为 removed / added 展示。

## 性能策略

数组语义 diff 不能无条件 O(n²)。

建议分层：

1. canonical signature 精确抵消，接近 O(n)。
2. 身份字段匹配，使用 Map，接近 O(n)。
3. 只有剩余少量元素才跑相似度矩阵。
4. 剩余对象超过阈值，例如 500，使用 bucket + greedy。
5. 超过更大阈值，例如 5000，只做 exact + identity，不做全局相似度，避免阻塞 UI。

## 输出模型

建议语义 diff 输出类型：

```ts
type SemanticJsonChange =
  | { kind: 'added'; path: string; newValue: JsonValue }
  | { kind: 'removed'; path: string; oldValue: JsonValue }
  | { kind: 'changed'; path: string; oldValue: JsonValue; newValue: JsonValue; oldType: string; newType: string }
```

不再输出 `moved-or-reordered`。

路径优先使用语义身份：

```text
$.plans{code="basic"}.title
$.groups{code="vip"}.features{key="image"}.enabled
```

无身份字段时可退化为稳定 hash 或保守路径：

```text
$.items{#hash="abc123"}
$.items[*]
```

## 建议实现拆分

在 `src/kits/diff/jsonSemanticDiff.ts` 内拆出纯函数：

```ts
semanticEqual(a, b): boolean
canonicalSignature(value): string
diffSemanticJson(a, b): SemanticJsonChange[]
diffObjectSemantic(a, b, path): SemanticJsonChange[]
diffArraySemantic(a, b, path): SemanticJsonChange[]
inferArrayIdentityKey(leftItems, rightItems): IdentityKey | null
matchArrayItems(leftItems, rightItems): ArrayMatchResult
```

匹配结果：

```ts
type ArrayMatchResult = {
  matched: Array<{ leftIndex: number; rightIndex: number; reason: MatchReason }>
  added: number[]
  removed: number[]
}

type MatchReason = 'exact' | 'identity-key' | 'similarity'
```

## 验收用例

使用虚拟数据，不使用真实业务数据。

至少覆盖：

1. 对象 key 重排无 diff。
2. scalar 数组重排无 diff。
3. scalar 数组重复数量变化能 diff。
4. 对象数组纯重排无 diff。
5. 对象数组中间插入新对象，只报新增。
6. 对象数组删除对象，只报删除。
7. 对象数组同身份字段值变化，报字段 changed。
8. 嵌套对象数组重排无 diff。
9. 身份字段重复时不错误匹配。
10. 找不到身份字段时，完全相同对象仍能抵消。
11. 找不到身份字段但相似度高时，能识别 changed。
12. 相似度模糊时，保守输出 removed + added。
13. 混合数组支持 primitive / object / array / null。
14. null 和缺失字段不同。
15. `1` 和 `1.0` 相同，`1` 和 `"1"` 不同。
16. 大数组性能不爆炸。

## 最终产品定义

JSON Semantic Diff：

```text
忽略 JSON 格式、对象 key 顺序、数组顺序；自动识别对象数组中的同一实体，只展示新增、删除、字段修改和类型变化。
```

JSON 模式是唯一语义模式；Lines 模式用于观察文本和顺序变化。
