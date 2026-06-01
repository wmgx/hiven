# Built-in Script 自适应增强专项

## 背景

FluxText 现有很多内置脚本通过参数让用户选择转换方向或模式，例如：

```text
Timestamp Convert: Timestamp -> Date / Date -> Timestamp / Now
Base64: Encode / Decode
URL: Encode / Decode
Query String: JSON -> Query / Query -> JSON
Number Base Convert: Dec / Hex / Bin
```

这些参数里有一部分其实可以从输入内容推断出来。对于能确定判断的场景，系统应该直接执行，不让用户先做选择。

本专项只处理一件事：

```text
扫描现有 built-in scripts，把可由输入判断的逻辑写进脚本，减少用户参数选择。
```

它和 Pinned Action / Live Runner 是两个独立专项。Pinned Action 可以受益于这些更聪明的脚本，但本专项不引入 pinned UI、不引入 panel、不改 Workspace 架构。

## 设计原则

### 能推断就不询问

```text
能从输入确定判断的，直接转换。
不能确定判断的，保留参数或返回明确提示。
不要为了“看起来智能”做低置信度猜测。
```

例如时间戳：

```text
10 位数字 -> 秒级 timestamp
13 位数字 -> 毫秒 timestamp
16 位数字 -> 微秒 timestamp
19 位数字 -> 纳秒 timestamp
ISO 日期字符串 -> 日期转 timestamp
常见日期字符串 -> 日期转 timestamp
```

用户不应该先选择“秒 / 毫秒 / 日期转时间戳”。脚本应该自己判断。

### Auto 是默认，显式模式是 override

每个增强脚本应新增或保留：

```text
mode = auto
mode = explicit option
```

`auto` 作为默认值。显式模式用于：

```text
auto 无法判断
用户想强制某个方向
用户不认可 auto 的选择
```

### 错误要可理解

错误输出不应只写 `Error`。需要告诉用户为什么不能判断，以及下一步怎么做。

推荐格式：

```text
Error: Cannot infer input type. Choose a mode explicitly.
Error: Invalid timestamp: expected 10/13/16/19 digit timestamp or parseable date.
Error: Invalid query string: expected key=value pairs.
```

## 候选脚本扫描

基于当前 `src/builtin-scripts/manifest.json` 和重点脚本初扫，优先处理：

```text
timestamp.ts
  当前需要 mode: to-date / to-ts / now。
  新增 auto mode，并把默认改成 auto。

base64.ts
  当前需要 mode: encode / decode。
  检测输入是否像合法 Base64，并默认自动 decode；否则 encode。

url.ts
  当前需要 mode: encode / decode。
  检测是否包含百分号编码或 URL query 特征，默认自动 decode；否则 encode 或提示显式模式。

querystring.ts
  当前需要 mode: json2qs / qs2json。
  检测输入是否 JSON object；否则检测 query string。

hex.ts
  当前需要 mode: dec2hex / hex2dec / dec2bin / bin2dec。
  检测 0x、0b、纯二进制、纯十进制、纯 hex，并输出多种常用表示。

json.ts
  当前需要 mode: pretty / compact。
  Pretty/compact 不是总能从输入唯一推断，但可以做保守策略：压缩 JSON 默认 pretty；已 pretty JSON 仍默认 pretty，compact 保留为显式模式。
```

暂不做自动推断，只保留参数：

```text
sort.ts / dedup.ts
  ignoreCase、direction 不能可靠从输入判断。

hash.ts
  algorithm 不能从输入判断。

case.ts
  目标大小写不能从输入判断。
```

这些脚本未来适合通过 Pinned Action 的 Controls Panel 改参数，但不属于本专项。

## 通用实现规则

每个增强脚本都应遵守：

```text
1. 增加 auto mode，默认使用 auto。
2. 保留原显式 mode，避免老用户失去控制。
3. auto mode 必须返回确定性结果。
4. 判断置信度不足时，返回错误或提示，不要猜。
5. 多行输入按行处理，除非脚本语义要求整体处理。
6. 错误输出必须包含原因和建议。
7. 不改变 Action API，不引入新 UI。
```

测试要求：

```text
每个 auto mode 至少覆盖：
  明显正向输入
  明显反向输入
  多行输入，若支持
  无法判断输入
  显式 mode 兼容
```

## 具体脚本设计

### Timestamp Convert

输入判断：

```text
空输入：
  输出当前时间：seconds、milliseconds、ISO。

纯数字：
  10 位 -> seconds to ISO
  13 位 -> milliseconds to ISO
  16 位 -> microseconds to ISO
  19 位 -> nanoseconds to ISO

包含日期分隔符或 T/Z：
  Date.parse 成功 -> 输出 seconds、milliseconds、ISO。

多行：
  每行独立转换。
```

失败规则：

```text
数字长度不是 10/13/16/19 且无法合理 parse：
  Error: Cannot infer timestamp unit.
```

验收样例：

```text
Input: 1700000000
Output: 2023-11-14T22:13:20.000Z

Input: 1700000000000
Output: 2023-11-14T22:13:20.000Z

Input: 2023-11-14T22:13:20.000Z
Output:
1700000000 (seconds)
1700000000000 (milliseconds)
2023-11-14T22:13:20.000Z
```

### Base64 Encode/Decode

输入判断：

```text
trim 后符合 Base64 字符集，长度为 4 的倍数，decode 后可得到有效 UTF-8：
  decode

否则：
  encode
```

误判控制：

```text
纯英文短词可能误判为 Base64。
为避免误 decode，decode 后需要满足：
  - 可打印字符比例高
  - 或包含常见结构字符，如 { [ < : / 空格 换行
否则按 encode 处理。
```

验收样例：

```text
Input: SGVsbG8=
Output: Hello

Input: Hello
Output: SGVsbG8=
```

### URL Encode/Decode

输入判断：

```text
包含 %XX 且 decodeURIComponent 成功：
  decode

包含明显未编码空格、中文、特殊符号：
  encode

已是普通 URL 且没有编码片段：
  不直接 encode 整个 URL，避免破坏 URL 结构。
  返回提示，让用户选择显式模式。
```

验收样例：

```text
Input: hello%20world
Output: hello world

Input: 你好 world
Output: %E4%BD%A0%E5%A5%BD%20world

Input: https://example.com/a?b=c
Output: Error: Cannot infer URL operation. Choose encode or decode explicitly.
```

### JSON -> Query String / Query String -> JSON

输入判断：

```text
trim 后以 { 开头并能 JSON.parse 成 object：
  JSON -> Query String

以 ? 开头，或包含 a=b / & 分隔：
  Query String -> JSON

其他：
  Error: Cannot infer JSON or query string.
```

验收样例：

```text
Input: {"a":1,"b":"x"}
Output: a=1&b=x

Input: ?a=1&b=x
Output:
{
  "a": "1",
  "b": "x"
}
```

### Number Base Convert

输入判断：

```text
0x 前缀 -> hex input
0b 前缀 -> binary input
只含 0/1 且长度 > 1 -> binary input
只含 0-9 -> decimal input
只含 0-9a-fA-F 且包含 a-fA-F -> hex input
```

auto 输出不应该只输出一种方向。建议输出多表示：

```text
dec: 255
hex: FF
bin: 11111111
oct: 377
```

验收样例：

```text
Input: 255
Output:
dec: 255
hex: FF
bin: 11111111
oct: 377

Input: 0xFF
Output:
dec: 255
hex: FF
bin: 11111111
oct: 377
```

### JSON Formatter

保守策略：

```text
auto 默认 pretty。
compact 保留为显式 mode。
parse 失败时不改变原文，返回 JSON parse 错误。
```

不建议在本专项中自动 compact。原因：

```text
用户输入 pretty JSON 时，继续 pretty 不会造成惊讶。
自动 compact 可能破坏可读性，和“友好交互”目标相反。
```

## Milestone 拆解

### Milestone 1：Auto Mode 基础与测试夹具

目标：

```text
建立内置脚本 auto mode 的测试口径和通用判断习惯。
```

范围：

```text
确认内置脚本如何测试。
为 timestamp/base64/url/querystring/hex/json 准备输入输出用例。
不改 UI。
```

验收：

```text
每个候选脚本都有明确 auto 输入输出样例。
显式 mode 兼容用例存在。
```

### Milestone 2：Timestamp Auto

目标：

```text
时间戳转换默认自适应秒、毫秒、微秒、纳秒和日期字符串。
```

范围：

```text
修改 src/builtin-scripts/timestamp.ts
mode 增加 auto 并设为默认
保留 to-date / to-ts / now
```

验收：

```text
10/13/16/19 位数字自动转 ISO。
日期字符串自动转 seconds/milliseconds/ISO。
空输入输出当前时间。
无法判断时返回明确错误。
```

### Milestone 3：Base64 与 URL Auto

目标：

```text
编码类脚本减少 encode/decode 手选。
```

范围：

```text
修改 src/builtin-scripts/base64.ts
修改 src/builtin-scripts/url.ts
mode 增加 auto 并设为默认
保留 encode / decode
```

验收：

```text
合法 Base64 自动 decode。
普通文本自动 encode。
百分号编码自动 decode。
中文/空格文本自动 URL encode。
普通完整 URL 不被静默整体 encode。
```

### Milestone 4：Query String 与 Number Base Auto

目标：

```text
结构转换和进制转换支持输入自识别。
```

范围：

```text
修改 src/builtin-scripts/querystring.ts
修改 src/builtin-scripts/hex.ts
mode 增加 auto 并设为默认
保留显式模式
```

验收：

```text
JSON object 自动转 query string。
query string 自动转 JSON。
decimal/hex/binary 自动输出多表示。
无法判断时返回明确错误。
```

### Milestone 5：JSON Formatter Auto 保守优化

目标：

```text
JSON formatter 默认使用更少惊讶的 auto 行为。
```

范围：

```text
修改 src/builtin-scripts/json.ts
mode 增加 auto 并设为默认
auto 行为等同 pretty
compact 保留显式模式
```

验收：

```text
压缩 JSON 自动 pretty。
pretty JSON 继续 pretty。
compact 显式模式仍可用。
parse 失败返回明确错误。
```

## 执行注意事项

```text
不要删除原显式参数模式。
不要把低置信度判断伪装成智能。
不要改 Command Palette 或 Pinned Action UI。
不要引入 panel。
不要改变 Action API。
不要让错误输出覆盖成看似成功的转换结果。
```

每个 Milestone 交付说明必须包含：

```text
修改了哪些脚本
新增了哪些 auto 判断
保留了哪些显式 mode
验证用例和结果
已知误判风险
```
