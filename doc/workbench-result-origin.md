# 工作台返回材料的来源

插件通过 `host.returnToLauncherWithObject` 将快照交给 Global Launcher。`PluginObjectBlockInput` 的文本分支支持可选的 `source`：

```ts
// 处理后的输出：Host 按结果文本重新识别类型并应用既有敏感内容遮罩。
host.returnToLauncherWithObject({ kind: 'text', text: output, source: 'tool-result' })

// 历史记录：不传 source 继续使用原有 history-item 行为，也可显式声明。
host.returnToLauncherWithObject({ kind: 'text', text: record.text, ageLabel })
```

- `source` 只描述来源，不承诺撤销、保存输入或跨窗口恢复。Host 不根据插件 ID、内容类型或当前页面猜测来源。
- 文本省略 `source` 或声明 `history-item` 均保持兼容。图片和文件输入不接受来源声明，继续按历史快照处理。
- `tool-result` 使用已有结果工厂，保留完整文本（包括空白、换行和空字符串），重新识别结果类型并遮罩敏感预览；历史 `ageLabel` 不适用于结果。
- Formatter、Encode / Decode、Text Tools 的行处理和命名转换这四处“继续处理”动作声明 `tool-result`。剪贴板历史 Ctrl/⌘+Enter 的来源和动作保持不变。
- 本协议支持空结果，但这次不改变各工作台已有的空结果按钮禁用规则。

## 恢复范围

从 Launcher 普通列表进入工作台时，已有材料仍在同一次打开的会话内。处理结果替换该材料后，现有“恢复上一步材料”可以恢复完整原对象一次，没有重做或多步历史。结果不会再因错误来源出现历史专用动作。

以下情况不新增恢复能力：原材料已被 `markBlockConsumed` 消费（包括旧的 object-action / open-plugin-surface 分支）、Launcher 已关闭、结果来自另一个窗口且接收方没有原材料，或新会话没有原材料。pending bridge 仍只传递当前对象，不传递上一份材料；来源声明不会绕过这些边界。

普通返回仍按既有 Host 流程清搜索 query 并回到搜索。用户随后恢复材料时，恢复动作不改当时的 query / browse 状态。此来源声明本身不新增 LastRun 记录、剪贴板写入、粘贴、历史写入或存储机制。

## 回归验证

- `npm run test:plugin-surface-object-origin`：实际构造 helper 和内容识别，覆盖默认文本、明确来源、图片、文件、精确输出、空输出、敏感内容遮罩。
- `npm run test:launcher-current-material`：纯材料状态流转，覆盖单步恢复、重复投递、已消费、关闭及新会话边界。
- 交互验收使用临时受控 fixture，调用实际工作台处理动作、Renderer、pending bridge、Host 和材料 hook，并用剪贴板历史 Ctrl+Enter 作兼容对照；不将组件测试加入永久单测。

这些是重要逻辑回归，不启动 server、不调用系统剪贴板，也不替代真实浏览器或桌面交互验收。
