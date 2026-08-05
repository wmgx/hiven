# 文本结果次要动作重设计（Global Launcher「带回」+ Pane 语境「插入」）

**日期:** 2026-07-20
**状态:** 已确认 · 可执行
**产品:** hiven
**读者:** 执行 AI / 评审 / 后续维护者（假定对代码库零了解；断言均附路径）
**关联:**

- Object Block 模型：`src/launcher/clipboard/objectBlock.ts`
- Pending block 桥接（已实现，直接复用）：`src/launcher/clipboard/pendingObjectBlock.ts`
- Object Block 消费 hook（已实现，直接复用）：`src/launcher/clipboard/useClipboardObjectBlock.ts`
- 先例设计文档（同类"带回 Launcher"机制的产品语义参考）：`doc/2026-07-19-clipboard-history-return-to-launcher-design.md`
- Quick Editor 命令面板 api 覆盖先例：`src/workspace/quickEditor/quickEditorActions.ts` `createQuickEditorLauncherApi`
- 边界约定：`CLAUDE.md`（本仓库根目录）

---

## 1. 背景

### 1.1 现状问题（已通过阅读代码 + 可执行复现脚本确认）

`src/workspace/launcher/output.ts` 的 `textResult()` / `replaceActiveTextResult()` 是所有 `PluginToolContribution` 共用的结果构造器，被 `toolAdapter.ts` 的 `makeOutput()` 按 `isGlobal` 二选一调用：

| 语境 | `isGlobal` | 使用的构造器 | 当前次要动作 |
|------|-----------|--------------|--------------|
| Global Launcher（悬浮任意前台 App，无绑定 pane） | true | `textResult` | `replace-active` + `insert`，各自调用 `api.replaceActiveText` / `api.insertText` |
| Pane 绑定语境（Quick Editor 命令面板等） | false | `replaceActiveTextResult` | 仅 `copy` |

**问题 1：** Global Launcher 语境下，`api.replaceActiveText` 和 `api.insertText` 的默认实现（`src/workspace/launcher/pluginApi.ts:192-197`）都是 `await createQuickEditorPane({ text })`——两个不同文案的按钮做同一件事（新开一个 Quick Editor 悬浮窗塞入文字），且与按钮语义（"替换"/"插入"）完全不符，因为 Global Launcher 压根没有"当前活动文本"可替换或插入。

**问题 2：** 该次要动作的 `run()` 不返回结构化结果（`await api.xxx(text)` 无 return），`controller.ts` 的 `runChoiceAction`（约 L783-800）把"无结构化返回"当作"终止动作 → 关闭 launcher"处理，于是用户点击后 Global Launcher 直接关闭，同时后台弹出一个用户可能没注意到的 Quick Editor 窗口。

**问题 3：** Pane 绑定语境反而缺了「插入」——`api.insertText` 在这个语境下有真实实现（`quickEditorActions.ts:137-142`，在光标 offset 处拼接），但 `replaceActiveTextResult` 从未把它暴露成按钮。

### 1.2 目标

统一两个语境的次要动作集合，遵循同一条原则：

> **每个语境提供的动作，必须对应一个在那个语境里真实存在、且与其它动作不重复的能力。**

成功标准（用户可感知）：

1. Global Launcher 里，文本结果只有一个次要动作「带回 Launcher」，点击后结果以 Object Block 形式出现在搜索行，launcher **不关闭**。
2. Pane 绑定语境里，文本结果有「复制」+「插入」两个次要动作，均为真实、不重复的行为。
3. 两处改动都通过悬停提示（已有的 `Tooltip` 组件）说明按钮含义。

### 1.3 非目标

- 不改变任何主操作（Enter）语义：Global Launcher 仍是复制，Pane 语境仍是整体替换。
- 不引入"粘贴到前台应用"能力（`hide_launcher_and_paste`）——已确认这不是用户想要的方向，弃用。
- 不做 Object Block 模型的大重构；只新增一个 `source` 枚举值和一个工厂函数，复用现有 `createGenericObjectBlock`。
- 不改动 `src/plugins/clipboard-history/**`（那是另一条已完成的"带回 Launcher"路径，本次只是复用其底层 pending-block 桥接，不改它的产品逻辑）。

---

## 2. 架构判断

`textResult` / `replaceActiveTextResult`（`src/workspace/launcher/output.ts`）和 `createPluginLauncherApi`（`src/workspace/launcher/pluginApi.ts`）都在 `src/workspace/` 层——这是被 Global Launcher、Quick Editor 命令面板等**多个 host** 共用的框架层状态机代码。Object Block 是 Global Launcher 独有的产品概念（Quick Editor 命令面板没有、也不需要这个概念），把它的构造逻辑塞进 `src/workspace/**` 会让框架层认识一个只有单个 host 用得到的产品概念，违反本仓库 `CLAUDE.md` "framework 不应包含具体产品语义"的原则（这条原则原本是针对 diff/JSON 插件写的，但对"Global Launcher 专属概念不下沉到 workspace 层"同样适用）。

因此：

```text
src/workspace/launcher/types.ts     → PluginLauncherApi 新增方法签名 returnToLauncher(text): Promise<void>
                                       （纯类型声明，不引入产品语义，和 replaceActiveText/insertText 同级）
src/workspace/launcher/output.ts    → textResult() 的唯一次要动作调用 api.returnToLauncher(text)
src/workspace/launcher/pluginApi.ts → 默认实现是安全兜底（同现有 createQuickEditorPane 兜底），
                                       实际不会被触发（见下）
src/launcher/clipboard/objectBlock.ts        → 新增 ObjectBlockSource: 'tool-result' + 工厂函数
src/launcher/clipboard/globalLauncherApi.ts  → 新建。createGlobalLauncherPluginApi(baseApi)，
                                                 覆盖 returnToLauncher：建 Object Block →
                                                 setPendingObjectBlock（复用已实现的桥接）
src/launcher/hosts/GlobalLauncherHost.tsx    → useLauncherSession({ ..., makeApi: createGlobalLauncherPluginApi })
                                                 （和 QuickEditorCommandOverlay.tsx:48 的
                                                 makeApi: createQuickEditorLauncherApi 完全同构）
```

**为什么默认兜底"实际不会被触发"：** `toolAdapter.ts` 的 `makeOutput()` 只在 `isGlobal === true` 时调用 `textResult()`（`returnToLauncher` 唯一调用点），而 `isGlobal` 只在 Global Launcher 为真——Global Launcher 的 `useLauncherSession` 调用点届时总会带上 `makeApi: createGlobalLauncherPluginApi`，所以真正跑起来的永远是覆盖后的实现。`pluginApi.ts` 里的默认实现只是满足 TypeScript 接口完整性的安全兜底，理论可达但实际不可达。

**为什么不关闭 launcher 不需要改 `controller.ts`：** 次要动作的 `run()` 返回 `{ ok: true, keepOpen: true }` 时，`controller.ts` 的 `applyResult`（约 L822-850）已经有分支：当前帧是 `collect-input` 且 `item.suggest` 为空（计算器这类"legacy preview"工具正是如此）时，会走到"清空到根 list 帧但不关闭"的兜底分支（`frames = [root]`）——这条分支是通用的，早就存在，不用为本次改动新增或修改。

---

## 3. 设计细节

### 3.1 Global Launcher 语境

`textResult()`（`output.ts:32-59`）的 `secondaryActions` 从两项改为一项：

```ts
secondaryActions: [
  {
    id: 'return-to-launcher',
    title: palette(locale, 'returnToLauncher'),
    icon: 'CornerDownLeft',
    run: async () => {
      await api.returnToLauncher(text)
      return { ok: true, keepOpen: true }
    },
  },
],
```

`createGlobalLauncherPluginApi`（新建 `src/launcher/clipboard/globalLauncherApi.ts`）：

```ts
import { createToolResultObjectBlock } from './objectBlock'
import { setPendingObjectBlock } from './pendingObjectBlock'
import type { PluginLauncherApi } from '../../workspace/launcher/types'

export function createGlobalLauncherPluginApi(baseApi: PluginLauncherApi): PluginLauncherApi {
  return {
    ...baseApi,
    returnToLauncher: async (text: string) => {
      setPendingObjectBlock(createToolResultObjectBlock(text))
    },
  }
}
```

`setPendingObjectBlock` 已经有"已挂载 launcher 的实时订阅者"路径（`pendingObjectBlock.ts:44-50`，`useClipboardObjectBlock.ts:52-60` 已订阅），Global Launcher 此时必然处于打开状态（用户正在里面点按钮），所以块会立即生效，不需要等待下一次 open。

### 3.2 Pane 绑定语境（Quick Editor 命令面板等）

`replaceActiveTextResult()`（`output.ts:67-85`）的 `secondaryActions` 从一项（copy）扩到两项：

```ts
secondaryActions: [
  {
    id: 'copy',
    title: palette(locale, 'copy'),
    icon: 'Copy',
    run: async () => { await api.copyText(text); api.showMessage(palette(locale, 'copied'), 'success') },
  },
  {
    id: 'insert',
    title: palette(locale, 'insert'),
    icon: 'TextCursorInput',
    run: async () => { await api.insertText(text) },
  },
],
```

`api.insertText` 在这个语境下已有真实实现（`quickEditorActions.ts:137-142`），不需要新增能力，只是把它暴露成按钮。`icon: 'TextCursorInput'` 与本次会话较早改动里 Global Launcher 曾经用过的插入图标保持同一视觉语汇。

插入后是否关闭 launcher：沿用现状——`run()` 不返回结构化结果，按现有 `runChoiceAction` 约定视为"终止动作 → 关闭"，与"复制"当前行为一致（两者都是"做完就走"），不额外引入 `keepOpen`。

### 3.3.1 第二个调用方：`pipelineLauncher.ts`（实施过程中发现，已并入设计）

`textResult`/`replaceActiveTextResult` 不是只有 `toolAdapter.ts` 一个调用方。`src/workflow/pipelineLauncher.ts:74` 的 `pipelineToLauncherItem(...).execute` 是一个 host-owned `LauncherItem`（`kind: 'host'`，不经过 `toolAdapter.ts`），**无条件**调用 `textResult(output, ctx.api, ctx.locale)`，不看 `ctx.surfaceId`——而它的 `surfaces` 字段是 `['global-launcher', 'editor-command-bar', 'quick-editor-command']`，三个语境都会用到同一份结果处理。

如果不管这个调用方，Task 4 改完之后，pipeline 结果在 Pane 绑定语境（Quick Editor 命令面板等）会退化：目前它们拿到的是 `textResult` 的两个次要动作（虽然文案是"替换/插入"，但在这些语境下 `api.replaceActiveText`/`api.insertText` 是真实实现，实际能用），改完后只剩"带回 Launcher"一个动作，在这些语境下回落到 Task 1 的安全兜底（`createQuickEditorPane`，从 Quick Editor 自己的命令面板里再开一个新 pane）——这是一个真实的行为倒退，不是本次设计想要的。

**修复：** 在 `output.ts` 新增一个共享的语境选择函数，两个调用方都改用它：

```ts
export function surfaceTextResult(
  text: string,
  api: PluginLauncherApi,
  locale: Locale,
  surfaceId: string,
): LauncherExecuteResult {
  return normalizeLauncherSurfaceId(surfaceId) === 'global-launcher'
    ? textResult(text, api, locale)
    : replaceActiveTextResult(text, api, locale)
}
```

`pipelineLauncher.ts` 把 `textResult(output, ctx.api, ctx.locale as Locale)` 改成 `surfaceTextResult(output, ctx.api, ctx.locale as Locale, ctx.surfaceId)`。`toolAdapter.ts` 的 `makeOutput()` 内部已经是同一段逻辑（`isGlobal ? textResult(...) : replaceActiveTextResult(...)`），本次不改它——它没有 bug，不属于本次要修的问题，不做无关重构。

### 3.3 Object Block 工厂

`src/launcher/clipboard/objectBlock.ts`：

```ts
// ObjectBlockSource 联合类型新增：
| 'tool-result'

// SOURCE_LABELS 新增（沿用该表现有的硬编码中文惯例——见 §4 决策记录）：
'tool-result': '计算结果',

// 新工厂，紧跟 createQueryObjectBlock 之后：
export function createToolResultObjectBlock(text: string): LauncherObjectBlock {
  const kind = normalizeSecretKind(detectClipboardType(text))
  return createGenericObjectBlock({
    source: 'tool-result',
    kind,
    title: getSourceLabel('tool-result'),
    subtitle: getKindLabel(kind),
    text,
    masked: isSecretKind(kind),
    removable: true,
    validity: kind === 'json' ? 'valid' : 'unknown',
  })
}
```

`detectClipboardType` 已从 `./clipboardSnapshot` 导入到本文件（`createClipboardObjectBlock` 已在用），直接复用，不新增依赖。

`ObjectBlockToken.tsx`（L45-51）优先显示 `block.preview`（= 结果文本本身，如 "6"），只有 `preview` 为空时才回退到 `block.title`（= `getSourceLabel('tool-result')`）。计算器结果必有文本，所以这个硬编码中文标签实际几乎不会被用户看到——与既有 `SOURCE_LABELS` 的 7 个条目一致，不是本次新增的债务模式。

---

## 4. i18n

`src/i18n/locales/palette.ts` 新增 key（`palette` namespace，`textResult`/`replaceActiveTextResult` 通过 `translate(locale, 'palette', key)` 读取）：

| key | zh | en |
|-----|----|----|
| `returnToLauncher` | 带回 Launcher | Return to Launcher |

（`copy` / `insert` / `copied` 已存在，见当前 `output.ts` 用法，不需要新增。）

---

## 5. 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| Global Launcher 次要动作最终形态 | 带回 Launcher 变成 Object Block（非"粘贴到前台应用"） | 用户明确否决了粘贴方向；Object Block 是 launcher 已有的一等产品语义，且 pending-block 桥接已实现好，改动面最小 |
| Object Block 构造逻辑落点 | `src/launcher/clipboard/`，通过 `makeApi` 覆盖注入，不进 `src/workspace/` | 保持 workspace 层产品无关，和 Quick Editor 命令面板的 `makeApi` 覆盖模式同构 |
| `PluginLauncherApi` 新方法 vs 复用 `replaceActiveText`/`insertText` | 新增 `returnToLauncher` 专用方法名 | 语义清晰；`replace`/`insert` 在 Global Launcher 语境下本来就是错的名字，沿用只会延续混淆 |
| 关闭语义 | 复用 `controller.ts` 已有的 `keepOpen` + collect-input-without-suggest 分支 | 该分支本就是为这种"stay open, 清到根 list"场景设计的，不需要新逻辑 |
| Pane 语境是否新增「插入」 | 是 | 能力已真实存在（`quickEditorActions.ts`），只是没暴露；用户选择"统一语境重新设计"而非只修 Global Launcher 一侧 |
| `pipelineLauncher.ts` 是否改用共享的语境选择函数 | 是（新增 `surfaceTextResult`） | Task 1 的代码质量复核发现它是 `textResult` 的第二个调用方且无视 `surfaceId`；不修会让 pipeline 结果在 Pane 语境倒退成打开新 Quick Editor pane。`toolAdapter.ts` 内部同款逻辑保持不动，不做无关重构 |
| `tool-result` 的 `SOURCE_LABELS` 文案 | 沿用该表现有的硬编码中文惯例 | 该表 7 个既有条目全部如此，且这个字段在有 preview 时不会渲染给用户看；不在本次顺手做无关的 i18n 债务清理 |

---

## 6. 改动面索引

| 区域 | 文件 | 改动 |
|------|------|------|
| 类型 | `src/workspace/launcher/types.ts` | `PluginLauncherApi` 新增 `returnToLauncher(text: string): Promise<void>` |
| 默认实现（安全兜底，实际不可达） | `src/workspace/launcher/pluginApi.ts` | `createPluginLauncherApi()` 新增 `returnToLauncher`，兜底行为同现有 `insertText`（`createQuickEditorPane`） |
| 结果构造器 | `src/workspace/launcher/output.ts` | `textResult()` 次要动作改为唯一的 `return-to-launcher`；`replaceActiveTextResult()` 次要动作新增 `insert`；新增导出 `surfaceTextResult()` 语境选择函数（§3.3.1） |
| 第二调用方接线 | `src/workflow/pipelineLauncher.ts` | 改用 `surfaceTextResult`，不再无条件调用 `textResult`（§3.3.1） |
| Object Block 模型 | `src/launcher/clipboard/objectBlock.ts` | 新增 `ObjectBlockSource: 'tool-result'`、`SOURCE_LABELS` 条目、`createToolResultObjectBlock` 工厂 |
| Global Launcher api 覆盖 | **新建** `src/launcher/clipboard/globalLauncherApi.ts` | `createGlobalLauncherPluginApi(baseApi)`，覆盖 `returnToLauncher` |
| 接线 | `src/launcher/hosts/GlobalLauncherHost.tsx` | `useLauncherSession({ ..., makeApi: createGlobalLauncherPluginApi })` |
| i18n | `src/i18n/locales/palette.ts` | 新增 `returnToLauncher` 键（zh/en） |

---

## 6.1 附带发现：`npx tsc --noEmit` 在这个仓库里是空检查

Task 4 实施时发现：根目录 `tsconfig.json` 是 `"files": []` + `references`（指向 `tsconfig.app.json`/`tsconfig.node.json`）的 solution 式配置。不带 `-b`/`--build` 直接跑 `tsc --noEmit`，TypeScript 只看根配置自己的 `files`（空），不会自动构建被引用的项目——于是永远无输出、exit 0，看起来像"通过"，实际上什么都没检查。

真正会检查 `src/**` 的是 `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json`。用这条命令跑，能看到 **246 条历史遗留错误**（`git show 748a9d9:...` 可确认这些错误在本次会话开工前就已经存在，和本设计文档的任何改动都无关）。本计划自己新引入过一条（`surfaceTextResult` 的 `surfaceId` 参数类型太松），已在 Task 4 里修掉；修完之后本计划触碰到的文件里只剩一条历史遗留错误（`pluginApi.ts` 的 `showEditorWindow` 字段类型不匹配，同样是既有债务，不属于本次改动）。

这不是本次设计要解决的问题（历史基线债务，范围外），只是记录下来，避免以后又被"tsc 显示通过"这个假象误导。项目自己 `CLAUDE.md` 里要求的验证清单（`check:architecture` / `git diff --check` / `npm run build`）本来就没有依赖 `tsc` 作为门禁——`npm run build` 用的是 `vite build`，Vite 的 esbuild 转译不做类型检查，所以类型错误不会让构建失败，这也是这 246 条错误能长期存在而没人发现的原因。

## 7. 验收标准

1. Global Launcher 里对"求和"结果的次要按钮悬停，只看到一个图标，tooltip 显示"带回 Launcher"。
2. 点击后：launcher 保持打开，回到主搜索行；搜索行出现一个 Object Block token，内容是计算结果文本；原有输入框查询被这个块替代（与剪贴板自动挂块时的视觉一致）。
3. 该 token 可以正常 `⌫` 删除（`removable: true`），删除后恢复普通搜索输入。
4. 在 Quick Editor 命令面板里对同一个计算结果，悬停能看到两个次要按钮：复制、插入，tooltip 文案分别正确；点击"插入"后文本出现在当前光标位置，不覆盖其余内容；点击"复制"后剪贴板内容正确、原文本不变。
5. `tsc --noEmit`、`npm run check:architecture`、`npm run build`、`git diff --check` 全部通过。
6. 新增/修改的可执行回归脚本（`scripts/test-*.mjs`）覆盖：`textResult()` 只产出一个 `return-to-launcher` 次要动作且调用 `api.returnToLauncher`；`replaceActiveTextResult()` 产出 `copy` + `insert` 两个次要动作；`createGlobalLauncherPluginApi` 调用后 `setPendingObjectBlock` 收到正确 source/kind/text 的块；`surfaceTextResult()` 对 `global-launcher` 走 `textResult`、对其余 surfaceId 走 `replaceActiveTextResult`。
7. 从 Quick Editor 命令面板跑一个 pipeline（`workflow`/`管道`），结果的次要动作仍是"复制 + 插入"（不是"带回 Launcher"，不应回落成打开新 Quick Editor pane）——验证 §3.3.1 的修复生效，pipeline 结果在 Pane 语境没有倒退。

---

## 8. 明确禁止

1. 不要把 Object Block 相关 import 加进 `src/workspace/**`。
2. 不要改变 Enter（主操作）的复制 / 替换语义。
3. 不要实现"粘贴到前台应用"能力——已被否决。
4. 不要顺手重构 `SOURCE_LABELS` 的既有 i18n 债务。
5. 不要修改 `src/plugins/clipboard-history/**` 的产品逻辑。

---

## 9. 文档状态

- [x] 背景 / 目标 / 非目标
- [x] 架构判断与证据（附行号）
- [x] 两个语境的设计细节
- [x] i18n
- [x] 决策记录
- [x] 改动面索引
- [x] 验收标准
- [x] 明确禁止

**结论：设计完成，可交执行 AI 按 §6 改动面开工。**
