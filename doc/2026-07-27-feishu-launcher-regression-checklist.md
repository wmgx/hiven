# 飞书 Launcher 回归验收清单

> 分支：`feat/launcher-intelligence-package-1`
> 插件版本：`feishu@0.7.1`
> 用途：手工 / 半自动回归，覆盖 L1 混排、L2 工具、缓存、排序、头像与设置。

## 0. 前置

- [ ] 本机已安装 `lark-cli`，`lark-cli auth status` 已登录
- [ ] 系统默认打开 `Lark.app`（非 BOE 客户端抢 scheme）
- [ ] hiven 飞书插件设置：**启用** + 文档/会话/联系人混排开启
- [ ] （可选）升级 lark-cli 到团队推荐版本后再测

## 1. L1 Global Launcher 混排

| # | 场景 | 预期 |
|---|------|------|
| 1.1 | 空 query 打开 Global Launcher | **不**出现远程飞书文档；可出现 host persistable 最近推荐（若曾打开过） |
| 1.2 | 输入 ≥2 字文档关键词 | 出现飞书文档，kindLabel 为「飞书文档」；图标按 doc/sheet/wiki 等类型 |
| 1.3 | 输入会话名 | 出现飞书会话，kindLabel「飞书会话」；有群头像则显示 |
| 1.4 | 输入人名 | 仅出现**有聊天交集**的人；无交集不出现在 L1 |
| 1.5 | 同匹配档位下插件命令 vs 文档 | 插件命令优先于同档文档（docs `scoreBias` 降权，非 host 硬编码） |
| 1.6 | 连续快打字 | 无明显 CLI 堆积；旧请求被 abort；结果不闪回旧 query |
| 1.7 | 再次搜同一关键词 | 实体/前缀缓存命中，明显更快 |

## 2. 打开路径（官方 AppLink）

协议（[打开聊天页面](https://open.feishu.cn/document/common-capabilities/applink-protocol/supported-protocol/open-a-chat-page)）：

```text
https://applink.feishu.cn/client/chat/open?openChatId=oc_…
https://applink.feishu.cn/client/chat/open?openId=ou_…
lark://applink.feishu.cn/client/chat/open?…   # 自定义 scheme，带 applink host
```

| # | 场景 | 预期 |
|---|------|------|
| 2.1 | 回车打开会话/联系人 | **仅**客户端 scheme：`lark://applink.feishu.cn/...`（`open -b com.electron.lark`）；有 shell 时**不**再开 https（避免 Edge 抢焦点导致不跳转） |
| 2.2 | 联系人 | 依次尝试 openChatId（p2p）与 openId 两条 AppLink（文档规定单链二选一，故分开发） |
| 2.2b | 无 shell 时 | 才回退 host `openUrl(https AppLink)`（PC 中间页行为） |
| 2.3 | 打开文档 | 浏览器或客户端打开文档链接 |
| 2.4 | macOS + preferWindowFocus | 文档等带 titleHint 时 best-effort 置前；会话打开默认不靠 title 匹配 |
| 2.5 | 打开失败 | launcher 应保留并显示错误，而非静默关闭 |

### 2.6 单次投递契约（0.7.0 新增）

> ⚠️ **前置条件**：`feishu.debug-open` 属于高级命令，默认设置下 launcher 里**搜不到**。
> 执行本节前先到 设置 → 飞书 勾选「显示全部飞书命令」，验证完可以关回去。
> （诊断工具不占日常命令位是有意为之，见 §6。）

| # | 场景 | 预期 |
|---|------|------|
| 2.6.1 | 打开任一会话后运行 `feishu.debug-open` | 日志中 `shell.run:try` **只出现一次**，紧跟一条 `shell.run:accepted` |
| 2.6.2 | 飞书客户端已开着时看日志 | 有 `resolveApp:hit`，`path` 为该运行中客户端的真实路径；首条候选 `reason` 为 `resolved-app` |
| 2.6.3 | 飞书完全没开 / 同时开着多个客户端时看日志 | 有 `resolveApp:defer-to-launch-services`（`reason` 为 `no-client-running` 或 `multiple-clients-running`），首条候选 `reason` 为 `launch-services`。**这是正常结果，不是失败** |
| 2.6.4 | 连续打开 10 个不同会话 | 10/10 跳转成功；若有失败，附 `debug-open` 日志复盘 |

> 背景一（单次投递）：0.7.0 之前候选 1 `open <url>` 成功后不返回、继续投递候选 2，同一 deep link 被投递两次，
> 客户端二次处理 URL 会把已跳转的窗口重置回默认页——这是此前「有时跳转有时不跳转」的根因。
>
> 背景二（不猜客户端）：同一台机器上的多个飞书安装可能共用同一个 `CFBundleIdentifier`
> （`com.electron.lark`）**和**同一个 `CFBundleName`（`Feishu`），因此「哪个安装才是用户要的那个」
> 在系统层面没有可靠信号。0.7.0 只在**恰好一个客户端正在运行**时用 `open -a <path>` 指名投递；
> 零个或多个时不猜，直接交给 LaunchServices 走用户的默认 handler。
> 曾经用文件名（`boe` / `main_end` 等关键字）给安装打分的做法已删除——那是猜测，不是判据。

## 3. Persistable 最近推荐

| # | 场景 | 预期 |
|---|------|------|
| 3.1 | 打开某人/会话/文档后关掉 launcher 再打开（空 query） | 最近项出现，kindLabel 为「最近联系人/会话/文档」 |
| 3.2 | 空 query 多项最近 | 高频优先，条数 ≤ 8 |
| 3.3 | 输入部分标题 | 过滤命中；与 live 同 systemKey 时 live 胜出 |
| 3.4 | 设置 → 清除最近推荐 | 列表清空；重启后不再出现旧项 |

## 4. 头像

| # | 场景 | 预期 |
|---|------|------|
| 4.1 | 未授权 contact.base | 显示 initials 占位；可能自动拉起授权 URL（一次） |
| 4.2 | 设置 →「授权显示头像」→ 完成登录 | 再搜人显示真实头像 |
| 4.3 | 授权后重启应用 | localStorage 头像缓存命中，不必全部重新 batch |

## 5. L2 工具

| # | 场景 | 预期 |
|---|------|------|
| 5.1 | 找人（默认） | 可含未聊过的人；已聊过排前 |
| 5.2 | 设置开启「仅已聊过」后再找人 | 仅交集联系人 |
| 5.3 | 搜群 / 最近会话 | 可打开；失败文案可读（非 raw JSON） |
| 5.4 | 创建文档（无选区） | 一键空白文档 |
| 5.5 | 创建文档（有选区） | 选区作正文，首行可作标题 |
| 5.6 | 创建表格 | 先选 spreadsheet / base |
| 5.7 | missing_scope | 友好提示 + 可打开授权；非 stderr 整段 JSON |
| 5.8 | 发消息 / 建日程 | L2 确认后才执行 |

## 6. 命令范围（0.7.0 新增）

| # | 场景 | 预期 |
|---|------|------|
| 6.1 | 默认设置下 launcher 搜 `feishu` | 只出现 8 个命令：状态、登录、搜文档、搜会话、找人、看日程、建文档、建表格 |
| 6.2 | 设置勾选「显示全部飞书命令」 | 19 个命令全部出现 |
| 6.3 | 取消勾选 | 恢复 8 个 |
| 6.4 | 切换到 English | 新开关文案为英文，无硬编码中文 |
| 6.5 | 选中一段文字后运行「建文档」 | L2 确认卡显示正文预览；确认后创建成功并自动打开，正文即选中内容 |
| 6.6 | 直接运行「建表格」不带输入 | L2 确认卡出现；确认后创建成功并自动打开 |

> 设计依据：保留标准是「能否不切换上下文完成」，不是「读 vs 写」。
> 搜文档与建文档都符合——敲一下就拿到链接；建文档还能把选区直接作为正文。
> 发消息不符合：发完必然要切到飞书看回复。搜妙记 / 我的任务等在飞书原生里体验更好，
> 保留代码但默认关闭。
>
> `feishu.debug-open` 同样默认隐藏：它是排查打开路径用的诊断工具，不该占日常命令位。
> 需要跑 §2.6 时先勾选「显示全部飞书命令」。

## 7. 交互细节

| # | 场景 | 预期 |
|---|------|------|
| 7.1 | 异步追加结果时键盘选中 | 选中项不因 partial 刷新跳走（systemKey 保留） |
| 7.2 | 鼠标悬停 | 仅真实 pointer 移动后才 hover 选中，打开后光标静止不偷选 |
| 7.3 | 中文 IME | composition 期间 Enter 不上屏触发确认 |
| 7.4 | 多步参数 | chip 显示参数 label，option description 中英本地化 |

## 8. 自动化（开发机）

```bash
node scripts/test-feishu-plugin.mjs
node scripts/test-feishu-cli-logic.mjs
node scripts/test-persistable-recents.mjs
node scripts/test-launcher-ranking.mjs
node scripts/test-selection-preserve.mjs  # 若存在
npm run check:architecture
git diff --check
npm run build
```

## 9. 已知非阻塞

- `src-tauri/*.dylib` 为本地动态库，**不提交**
- 窗口 focus 为 macOS best-effort，多显示器/多客户端时可能失败
- lark-cli 版本差异可能导致个别 subcommand flag 不同；以当前团队版本为准
