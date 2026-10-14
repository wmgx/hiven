# JSON 样例生成 TypeScript 类型

JSON 工作台新增「TypeScript 类型」，Launcher 可搜索 `json to typescript`。输出固定为 `export type Root`，嵌套结构内联，沿用原结果区、复制、返回和交付反馈；不扫描文件、不访问网络、不增加权限。输出是已观察样例的结构，不是 API 契约，也不推断日期、枚举或字段之间的判别关联。

- 遍历全部数组元素，合并对象字段；仅部分对象出现的字段标为可选，显式 null 保留。
- 全空数组使用 `unknown[]`；有实际元素时按元素推断。原始值宽化为 string/number/boolean；空对象使用 `Record<string, never>`。
- 属性名统一安全引号；重复的解码后键（如 `a` 与 `\u0061`）拒绝，避免静默丢失。
- 数字按 JSON 词法识别，不转换数值、不改写输入；大整数和溢出指数仍推断 number。
- 上限：128 KiB UTF-8 输入、64 层嵌套、20,000 个节点、512 KiB UTF-8 输出。超限整体拒绝，无抽样或截断。
- 输入变化立即更新结果，错误清除旧输出；空白和错误输入禁用交付。TypeScript 输出禁用「用作输入」。

## 验证

`node scripts/test-json-type-inference.mjs` 覆盖合并、特殊键、非法 JSON、重复键、资源边界，并用项目 TypeScript 编译器在 strict 模式验证生成语法及样例可赋值。独立审查已核对嵌套 optional/null/unknown 的合并语义。全量类型检查、架构检查和构建通过。

真实 Linux 桌面仅使用隔离 profile 和合成样例，历史记录关闭。从隔离外部文本窗口复制 JSON 后粘贴进工作台，核对结果；验证重复键/非法输入、空白禁交付、纠错与旧结果清除、返回后取消保留，再通过原复制按钮复制到外部窗口核对全文。未使用真实 API 或用户数据。macOS 未验证。
