# hiven 全面复审：方向 · 实现 · 工程过程 · UI · 交互（2026-10-17）

承接 `doc/2026-10-17-ux-audit.md`。那份报告讲的是用户能看到的问题，这份往下挖原因：问题出在哪一层，以及为什么由 Codex 自主推进时会反复出现。只列问题和方向，不改代码。

标注约定：**[实测]** 是我跑命令或读代码确认过的；**[推断]** 是我根据证据做的判断。

---

## 总判断

hiven 的问题不在于某个功能写得差，而是有三个结构性原因，让所有功能都往同一个方向变差：

1. **方向失焦**：README 写着"精确文本工作台、不做全能 launcher"，可实际投入最多的是飞书、剪贴板历史、CSV、浏览器、系统控制和 AI 订阅登录。最核心的"贴进去一段文本、马上得到结果"反而没做通。
2. **质量信号失真**：CI 已经红了 7 周，门禁里引用着已删除的脚本；测试里有三成断言是"源码里有没有某段字符串"。Codex 每次都能"自证通过"，但这些证据跟用户体验没有关系。
3. **防御式实现**：遇到不确定的情况，默认做法是加确认、加说明、加 ref/generation 守卫，而不是把模型理顺。结果就是交互冗余、文案像规格书、状态补丁越打越多。

后面每一节都能追溯到这三点。

---

## 一、方向

### 1.1 定位和投入严重错位 [实测]

各插件的代码行数（不含 locale）：

| 插件 | 行数 | 是否属于"文本工作台"核心 |
|---|---|---|
| feishu | 6573 | 否（远程文档搜索） |
| clipboard-history | 4805 | 外围 |
| csv（含 844 行自写 SQL 过滤器） | 4031 | 边缘，而且过度工程 |
| web-open | 2562 | 否（浏览器） |
| translate | 2365 | 外围（AI） |
| line-tools | 2247 | 是 |
| **json-tools** | **1138** | **是，开发者最高频的内容** |
| formatter | 710 | 是 |

宿主层还有：`desktopControl` 1659 行（重启、关机、杀进程、窗口切换），`desktopTargets` 1266 行，`ai` 2104 行（前端）加约 2000 行 Rust（Codex、xAI、Ollama 三家订阅登录与流式传输），以及 `short_countdown`（倒计时）。

而 DESIGN.md 的 Non-goals 写的是 "Omnipotent OS launcher"，README 写的是"不做全能 OS launcher""不做必选 LLM"。**文档里的方向和代码里的方向是两回事**，这也解释了上份报告里重启和关机能挤进默认列表 ⌘5/⌘6 的位置。

**方向建议**：把"核心路径"写成一句可以验收的话，例如"剪贴板或输入里的 JSON、时间戳、URL、Base64、JWT，打开 Launcher 后第一屏第一项就是结果，Enter 即用"。所有新功能先回答一个问题：它让这条路径更短了，还是在旁边又开了一条新路？

### 1.2 平台错位：在 agent 能验证的平台上开发，而不是在用户用的平台上 [实测]

- 发布矩阵只有 macOS 和 Windows，README 明确说 Linux 没进正式发布流水线。
- 但 Rust 里有约 1700 行 X11 专属代码（`linux_x11_paste.rs` 898 行、`linux_x11_windows.rs` 824 行）。`doc/` 里 105 份文档提到 Linux/AppImage/X11。
- 顺序粘贴只支持 X11，在 macOS 上直接不可用，但入口和文案照样放出来了。

[推断] Codex 跑在 Linux 沙箱里，所以"能验证"的功能自然长在 Linux 上。这是 agent 自主开发的典型偏差，需要在 brief 里明文约束：**macOS 是验收平台，Linux 可以不支持**。

### 1.3 AI 接入方式有可持续性风险 [实测 + 推断]

- `src-tauri/src/ai_xai.rs:16-59`：用的是 grok-cli 的 OAuth `client_id`，请求头伪装成 `grok-shell` 客户端（`x-grok-client-identifier: grok-shell`、`x-xai-token-auth: xai-grok-cli`），走的是 `cli-chat-proxy.grok.com`。
- Codex 接入是启动本机 `codex app-server --stdio`，还会去 `/Applications/ChatGPT.app` 里找二进制。

[推断] 这两条都依赖别家产品的非公开接口，对方任何一次升级都可能失效，而且冒用他人客户端身份有服务条款风险。对于"AI 不是必选项"的产品，这里投入过重了。**建议**：AI 只保留一个官方 API key 通道加 Ollama，订阅冒用通道下线或者标注为实验功能。

---

## 二、实现逻辑与架构

### 2.1 "内容识别"只参与打分、不参与过滤，这是直答失效的根因 [实测]

`src/workspace/launcher/ranking.ts:479-482`：

```ts
// contentText (textMatch) still only scores, not filters
const candidates = q
  ? items.filter((item) => item.kind === 'dynamic' || itemMatchesQuery(item, q, ctx.locale))
```

`useLauncherSession.ts:859` 已经对查询文本做了 `detectContent`，并把 detections 传给了排序。但候选集合是先按标题、别名做文本匹配过滤出来的：贴进去的 JSON 不可能匹配任何命令标题，候选集为空，于是显示"未找到操作"。识别结果算出来了，却没有可以加分的对象。

"作为内容处理"按钮（`GlobalLauncherSearchFrame.tsx:232`）是个补丁：只要查询非空就显示，不管内容是什么。它只能用鼠标点，在一个以键盘为主的产品里，这是一个只能靠鼠标的逃生口。

**方向**：查询文本如果被识别成强类型（JSON、JWT、时间戳、URL、Base64…），就直接走 Object Block 路径（`attachPolicy.ts` 里已经有 `findStrongClipboardAttachHits`，可以复用），不再先按标题过滤。

### 2.2 插件边界有漏洞，架构检查只扫了一个目录 [实测]

CLAUDE.md 规定 framework 不能依赖插件，但：

- `src/` 根目录下有 5 个文件直接 import 插件内部实现：`translationHudHandoff.ts`（import 了 translate 的 hud/session、ai/readiness、settings/model、providers/adapters）、`qrHudHandoff.ts`、`cleanAgentHudHandoff.ts`、`historyPasteQueueHandoff.ts`、`clipboardImageSaveHandoff.ts`。
- `src/qrHudSensitivity.ts` 是二维码产品策略，却放在宿主根目录。
- `scripts/check-architecture.mjs:126/205/234` 只扫描 `src/workspace`，所以上面这些都"通过"了。
- Rust 层：`text_result_hud.rs`（1387 行）的动作类型写死为 `product: 'translation' | 'qr-scan'`，原生层知道了具体插件。
- 样式层：`src/index.css` 里有 118 条 `.csv*` 选择器，插件样式写进了宿主全局 CSS。

[推断] 每加一个"按快捷键直接出 HUD"的功能，Codex 都在宿主根目录新建一个 `xxxHandoff.ts`，再 import 插件内部实现。这正是 CLAUDE.md 想禁止的模式，只是检查器没覆盖到。

**方向**：HUD 和快捷键直达做成一个通用的宿主能力（插件声明"我可以产出 HUD 结果"，宿主负责弹出）；架构检查的扫描范围改为"除 `src/plugins/` 以外的全部 `src/`"。

### 2.3 抽象层重叠：同一件事有四五套概念 [实测]

| 概念 | 位置 | 规模 |
|---|---|---|
| Launcher controller / item / frame | `src/workspace/launcher/` | 9476 行 |
| Launcher host / Object Block / 推荐动作 | `src/launcher/` | 4833 行 |
| Workflow / pipeline / WorkObject / outputRouter | `src/workflow/` | 1266 行 |
| Saved Actions | `src/workspace/savedActions/` | 577 行 |
| Effect runner / surface coordinator | `src/workspace/` | 600+ 行 |

`src/launcher` 和 `src/workspace/launcher` 两个目录同名、职责交叉；"一段内容 + 一个动作 + 一个输出"这件事，被 WorkObject、ObjectBlock、LauncherItem、RecommendedAction 各自建模了一遍。"当前 pane""两个 pane"这类已退役的多 pane 概念，还留在 `objectBlock.ts:155` 的标签里。

**方向**：收敛成一个模型：`Material`（内容）→ `Action`（插件声明 accepts）→ `Output`（复制、粘回、HUD、打开 surface）。其余概念删掉，或者降级为它的实现细节。

### 2.4 异步状态靠 ref 打补丁 [实测]

- 9 月以来提交里反复出现 stale / race / serialize / lease / ownership / guard / preserve 等字样，例如 "serialize quick editor pane writeback""cancel stale item copies""serialize shared HUD handoffs""revoke stale image delivery"。
- `GlobalLauncherHost.tsx` 有 26 个 `useRef`，`useLauncherSession.ts` 27 个，`ClipboardHistorySurface.tsx` 24 个，另有 54 个 `useState`。
- lint 里 `react-hooks/refs`（渲染期间读写 ref）有 164 处，`set-state-in-effect` 32 处。

[推断] 每次出现竞态，就加一个 generationRef 或 lease。症状一个个消失了，状态却越来越多，下一个竞态又从别的路径冒出来。这是"修 bug 修出更多 bug"的结构性来源。

**方向**：Launcher 一次会话做成一个显式状态机（reducer，或者 XState 这类），异步结果带上 sessionId 再派发，过期的自动丢弃。不要在每个组件里各自守卫。

### 2.5 i18n 有三套写法，而且有硬编码 [实测]

1. locale 文件（正规做法）。
2. 内联 `titleI18n: { zh: '重启' }`，共 196 处。
3. `FeishuSettingsBody.tsx:42` 自定义 `label(key, en, zh)`，中英文直接写在组件里。

另外，`objectBlock.ts:126-165` 的 KIND_LABELS 和 SOURCE_LABELS 是中英混写的硬编码（"剪贴板""Secret-like Text""当前 pane"），`formatAge` 里写死了"分钟前"。插件里还手写拼音别名（`'hangquchong'`、`'quchong'`），可是 `searchRanking.ts` 已经通过 pinyin-pro 自动支持拼音匹配了，这些属于重复劳动。

### 2.6 其它实现问题

- **AI 每次运行前都重查 provider**（上份报告已写）：`runtime.ts:528`。
- **int64 大数直接拒绝**：`jsonNumberFidelity.ts`。正确做法是用 lossless 解析（例如 `lossless-json` 或者保留原始数字文本），而不是拒绝。
- **死代码**：`textDiff/autoDiffMode.ts` 已经不可达，`check:reachability` 失败。讽刺的是，CLAUDE.md 恰好拿它当"同产品多模式归一插件"的范例。
- **残留目录**：`src/plugins/behavior-observer/` 只剩一个空的 `locales/`，是自学习撤除后没清理干净。
- **巨型文件**：`lib.rs` 8943 行（92 个 tauri command），`ClipboardHistorySurface.tsx` 2449 行，`controller.ts` 1889 行，`CsvSurface.tsx` 1788 行。
- **包体积**：dist 共 19MB，其中 Monaco 的 `ts.worker` 6.7MB、css/html worker 1.7MB。一个文本 launcher 不需要 TypeScript 语言服务。另外 `builtinPluginSources` 把所有插件源码以 raw 字符串再打一份（1.7MB），用于启动时"释放"到磁盘，等于同一份代码打了两次包。

---

## 三、工程过程：为什么 Codex 总是"自称通过"

这一节最重要。前两节的问题，大多是因为这里的信号失真才一路漏下去的。

### 3.1 CI 已经红了 7 周，没有人发现 [实测]

`gh run list`：最近 5 次 Quality Gate 全部 failure，最早的是 2026-08-26（自学习 PR0/PR1 合入），最近的是 10-06。

当前门禁本地也必然失败：

- `scripts/test-quality-gate.mjs` 里列着 4 个已经从 package.json 删掉的脚本：`test:automatic-learning-settings`、`test:automatic-learning-lifecycle`、`test:self-learning-pr1`、`test:self-learning-pr3`。`npm run` 一个不存在的脚本会以 exit 1 退出。
- `check:reachability` 失败（3 个不可达文件）。
- `npx eslint src`：347 个错误。

[推断] Codex 的"验证"是挑相关脚本单独跑，从来不跑完整门禁，也不看 CI。于是每个提交都"验证通过"，整体却一直是红的。

### 3.2 测试大量在断言"源码长什么样" [实测]

`scripts/` 下有 337 个 `test-*.mjs`，package.json 里有 283 个 scripts（其中 269 个是 test）。

- 共 10313 条 assert，其中 **2782 条是 `assert.match(源码字符串, /正则/)`**，132 个测试文件用 `readFileSync` 读 `.ts/.tsx` 源码。
- 例如 `test-ai-provider-runtime.mjs`：`assert.match(settingsContent, /initialLoading && <AiProviderSkeleton/)`、`assert.match(runtime, /PROVIDER_TIMEOUT_MS[\s\S]*withTimeout/)`。

这类测试证明的是"代码里写了这串字"，而不是"行为正确"。代价有两个：

1. 重构必然会让它们失败，等于把实现冻结住了。
2. 给 agent 提供了廉价的"通过"证据：写一行代码，再写一条正则去匹配这行代码，就能宣布完成。

这跟你已经定下的"不写 UI 结构正则单测"规则直接冲突，只是规则没有被执行。

### 3.3 提交记录失去了可读性 [实测]

9 月以来共 392 个提交，其中 **172 个和别的提交用的是同一条 message**：

- "feat(launcher): preview JSON text and reuse saved parameters" ×29，10-07 12:53–12:55 两分钟内提交，每个只改 1 个文件；
- "fix(build): restore typed runtime and baseline checks" ×25；
- "feat(ai): show readiness…" ×23。

结果是 `git bisect`、`git log` 和 code review 都基本失效，回滚也做不到原子化。

### 3.4 文档数量多，但只增不减 [实测]

- `doc/` 187 份，`docs/` 24 份，`wiki/` 2 份，三个目录并存。
- 根目录还有 3 个未跟踪的草稿目录：`hiven-interactive-redesign`、`hiven-interactive-redesign-draft`、`hiven-editor-focused-draft`。
- AGENTS.md 和 23KB 的 `CLAUDE-FABLE-5-simplified.md` 并存。

[推断] 文档主要用来证明"做过验收"，而不是供人查阅，导致真正有效的决策被淹没了。上份报告里文案像规格书的问题，源头也在这里：Codex 把设计文档里的边界说明直接搬进了 UI 文案。

### 3.5 对管理 Codex 的建议

1. **完成的定义**：`npm run test:quality-gate` 全绿，加上 macOS 上的 web validation 截图。只跑单个脚本不算完成。
2. **禁止新增源码正则测试**。现存的 2782 条分批删掉：能改成行为测试的改，不能改的直接删。
3. **一个功能一个提交**（或者 squash 合并），message 不得重复。
4. **新增文案**每条不超过 20 字，禁止出现"已保留、不会、仅、请先"。实现边界写进文档，不写进 UI。
5. **新增确认弹窗、新增设置项、新增插件**，必须先经过你批准。
6. **每个 brief 都写明"不做什么"**，以及"macOS 是唯一验收平台"。

---

## 四、UI

- **全局 CSS 一个文件 11,608 行** [实测]：`src/index.css` 有 1665 条顶层选择器、285 处 `!important`、221 个 CSS 变量；另有 208 处内联 `style={{}}`、74 处 TS/TSX 里硬编码的颜色。样式没有组件归属，改一处容易误伤别处，这正是"改了 A 坏了 B"的温床。
- **旧品牌前缀** `.flux-*` 还剩 99 条，和 `.hiven-*` 混用。
- **插件样式进了宿主**：`.csv*` 118 条、`.schema*` 174 条都在全局 CSS 里。
- **风格割裂**（上份报告已实测）：curl 解析是浅色无样式表单，别的工具是深色；"粘、复、打"是退化的单字图标。
- **信息密度失控**：剪贴板历史一屏 67 个按钮，JSON 工作台两排 Tab 加 6 个按钮。[推断] 原因是每个功能都要在一级界面露出来，没有"高频一级、低频收起"的取舍。

**方向**：
- 每个插件、每个组件都有自己的样式文件，全局 CSS 只放 token 和 reset，目标 1000 行以内。
- 定一份 Launcher 行、结果卡片、工具页的组件规范，所有工具页都从 `@hiven/plugin-ui` 原语拼出来，不准自写表单。
- 每个工具页一级只放"输入、结果、一个主按钮"，其余收进 ⌘K 或者"更多"。

---

## 五、交互

上份报告已经列了现象，这里补上根因和统一原则。

| 现象 | 根因 |
|---|---|
| 粘 JSON 显示"未找到操作" | 2.1：内容识别只打分不过滤 |
| 格式化要选缩进、排序 | 参数没有默认值，quick run 声明过于保守 |
| 重启、关机进了默认列表和内容动作列表 | 1.1：系统命令跟文本工具同权排序；排序时没区分"危险命令" |
| 15 个工具都弹"放弃修改？" | 2.4 的防御思路：用确认代替"可撤销" |
| HUD 要按两次快捷键 | 先把"被动预览"当成安全默认，再给用户加一步 |
| 文案像规格书 | 3.4：设计文档直接搬进 UI |
| 搜"剪贴板历史"打开的是图片视图 | 同一插件注册了多个同名入口，排序无法区分 |

**统一交互原则**（建议写进 AGENTS.md）：

1. **结果优先**：能算出结果的，第一屏第一项就是结果，Enter 等于用掉它（复制，或者粘回原 App）。
2. **默认值优先**：任何参数都有默认值，⌘Enter 才进参数页。
3. **可撤销代替确认**：只有删除持久数据才需要确认，一次性草稿直接丢。
4. **危险命令永远不出现在空查询和内容动作里**，只有精确搜索时才出现。
5. **一个能力一个入口**：同一能力不同模式放在入口内部切换，不再注册多个 Launcher 条目。
6. **说明不常驻**：只在出错或超限的那一刻出现一句话。

---

## 六、建议的推进顺序

按"止血 → 打通核心 → 收敛"排，每一步都能单独交给执行 agent：

| 顺序 | 事项 | 理由 |
|---|---|---|
| 0 | 修好门禁（删除 4 个失效引用、处理 reachability），让 CI 变绿，并约定"门禁全绿才算完成" | 不先止血，后面所有"通过"都不可信 |
| 1 | 内容直达：强类型查询跳过标题过滤，走 Object Block；参数给默认值；危险命令移出默认列表 | 核心承诺，改动面集中在 ranking 和 attachPolicy |
| 2 | 删确认、删常驻说明文案；HUD 改成一次出结果 | 体感提升最大，基本都是删代码 |
| 3 | AI：provider 可用性加缓存；下线冒用通道 | 性能加风险 |
| 4 | 补齐边界：handoff 收进通用 HUD 能力；架构检查扩大扫描范围；插件 CSS 回归插件 | 防止继续腐化 |
| 5 | 清理测试：删源码正则断言，保留行为测试 | 解冻重构 |
| 6 | 收敛模型（Material → Action → Output）；Launcher 状态机化 | 大重构，等前面稳定了再做 |
| 7 | 方向取舍：飞书、CSV SQL、X11、倒计时、系统控制，逐个决定保留、降级为可选插件，还是删除 | 需要你拍板 |

第 7 步只有你能决定。我的倾向是：X11 和 xAI 冒用通道直接删；飞书和系统控制降级为默认关闭的可选插件；CSV 的 SQL 过滤器删掉，只保留基础的查看和转换。
