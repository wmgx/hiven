# Translate Plugin Design

## 目标

新增 `translate` 内置插件，作为一个通过全局 launcher 打开的浮层翻译小窗。它面向即时翻译，不绑定 workspace，不读写 pane，不保存翻译历史。

成功标准：

- 用户可以从 global launcher 搜索 `translate` / `翻译` 打开浮层。
- 用户在原文输入区输入或粘贴文本后，插件在输入停止 800ms 后自动调用翻译 API。
- 用户可以选择 API profile、源语种和目标语种。
- 译文以普通可选中文本展示；不提供复制按钮或粘贴到前台应用。
- 插件不保存原文和译文历史。
- 插件记录必要设置、默认 profile、语种偏好和月度字符用量。

## 非目标

第一版不做：

- workspace pane 读取、替换、追加或 editor toolbar 入口。
- 从剪贴板读取按钮或自动读取剪贴板。
- 手动“翻译”按钮。
- “复制译文”按钮。
- “粘贴到前台应用”。
- 翻译历史。
- background 常驻任务。
- LLM provider。

## 插件形态

`translate` 是 app plugin，不是 tool command。

它主要贡献一个 `custom-view` surface：

```ts
definePlugin({
  settings: translateSettings,
  ui: {
    surfaces: [{
      id: 'main',
      kind: 'custom-view',
      title: 'Translate',
      icon: 'Languages',
      aliases: ['translate', 'translation', '翻译', 'fanyi'],
      component: TranslateSurface,
      entry: {
        launcher: true,
        shortcutBindable: true,
        recommendedShortcut: 'CmdOrCtrl+Shift+T',
      },
      shell: {
        defaultWidth: 960,
        defaultHeight: 620,
        minWidth: 760,
        minHeight: 420,
        closeOnBlur: false,
        resizable: true,
      },
    }],
  },
})
```

全局快捷键可以绑定，但不强制默认占用。

## 交互设计

浮层结构：

```text
┌────────────────────────────────────────────────────┐
│ Translate                                  [设置] [×] │
│ [Profile ▼] [源: 自动 ▼] ⇄ [目标: 智能 ▼]             │
├─────────────────────────┬──────────────────────────┤
│ 原文                    │ 译文                     │
│ textarea，自动聚焦      │ 普通可选中文本            │
│ 输入/粘贴后自动翻译     │ 无复制按钮                │
├─────────────────────────┴──────────────────────────┤
│ translating / failed / idle · 428 chars · 本月额度   │
└────────────────────────────────────────────────────┘
```

打开 surface 后：

1. 原文输入区自动聚焦。
2. 原文默认为空，不读取 workspace，也不读取剪贴板。
3. 用户输入或粘贴文本。
4. 输入停止 800ms 后自动翻译。
5. 切换 profile、源语种或目标语种后，对当前原文重新进入 800ms 自动翻译流程。
6. 关闭浮层后丢弃当前原文和译文。

## 自动翻译策略

为避免频繁扣额度，自动调用需要保护：

- Debounce：800ms。
- 最小输入长度：建议 2 或 3 个有效字符。
- 请求序号：新输入到来后，旧请求结果不得覆盖新输入结果。
- 内存缓存：同一 `text + profileId + sourceLang + targetLang` 在当前 surface 生命周期内不重复请求。
- 月度软上限：达到 profile 的月度字符上限后停止自动请求。
- 错误状态：连续失败时在状态栏展示，不弹打扰型 toast。

状态建议：

```ts
type TranslateStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; dueAt: number }
  | { kind: 'translating'; requestId: number }
  | { kind: 'success'; translatedAt: number }
  | { kind: 'error'; message: string }
  | { kind: 'quota-exceeded'; usedChars: number; limitChars: number }
```

## 语种选择

源语种第一版默认 `auto`。

目标语种支持：

- `smart`：智能目标语种。
- 常用语种：中文、英文、日文、韩文、法文、德文、西班牙文等。

智能目标语种规则：

```text
如果原文中中文字符比例达到阈值，则目标语种为英文；否则目标语种为中文。
```

该规则在本地启发式完成，不调用额外检测 API。

不同 provider 的语言代码由 adapter 内部映射，surface 只使用插件统一语言标识。

## API profile

设置中维护多个 API profile，而不是在主界面暴露底层 provider 细节。

建议模型：

```ts
type TranslateSettings = {
  defaultProfileId: string
  defaultTargetLang: 'smart' | LanguageCode
  profiles: TranslateProfile[]
}

type TranslateProfile = {
  id: string
  name: string
  provider: 'baidu' | 'deepl'
  enabled: boolean
  monthlyLimitChars: number
  usedCharsMonth: string
  usedChars: number
  credentials: Record<string, string>
  endpoint?: string
  defaultSourceLang?: 'auto' | LanguageCode
  defaultTargetLang?: 'smart' | LanguageCode
}
```

第一版 provider 建议：

- 百度翻译：适合中文日常场景，免费额度对个人工具友好。
- DeepL：翻译质量较好，API 形态相对干净。

后续可新增腾讯、火山、Google 等 adapter。

## Provider adapter

插件内部统一 adapter 接口：

```ts
type TranslateRequest = {
  text: string
  sourceLang: 'auto' | LanguageCode
  targetLang: LanguageCode
}

type TranslateResult = {
  text: string
  billedChars: number
  providerRequestId?: string
}

type TranslateAdapter = {
  translate(req: TranslateRequest, profile: TranslateProfile): Promise<TranslateResult>
}
```

adapter 负责：

- 参数转换。
- 语言代码映射。
- 鉴权或签名。
- 解析 provider 返回。
- 归一化错误信息。

## 权限与安全

理想权限：

```text
storage.private：保存 settings、profile 和额度计数。
network.request：调用外部翻译 API。
```

当前风险：如果 host 尚未提供 `network.request` 或 secret storage，第一版可能只能用前端 `fetch` 和本地 settings 保存 key。该方案适合个人工具，但不适合作为长期安全模型。

长期建议：

- 增加通用 `network.request` 权限。
- 增加 secret/credential 存储能力，避免 API secret 作为普通设置展示和持久化。

## 验收标准

功能验收：

- global launcher 可以打开 Translate 浮层。
- 原文输入区打开后自动聚焦。
- 输入停止 800ms 后自动触发翻译。
- profile / 语种变化会重新自动翻译当前输入。
- 译文区文本可以被用户手动选中复制。
- 关闭浮层后再次打开不保留上次原文和译文。
- 月度字符计数会更新；达到上限后停止调用。

边界验收：

- 不读取剪贴板。
- 不读取 workspace pane。
- 不写 workspace pane。
- 不注册 background。
- 不保存翻译历史。
- 不提供复制译文按钮。
- 不提供粘贴到前台应用按钮。

验证命令建议：

```bash
git status --short --ignored
npm run check:architecture
git diff --check
npm run build
```

如果实现涉及 UI，补充真实浏览器/应用画面验证。
