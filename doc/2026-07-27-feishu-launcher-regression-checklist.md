# 飞书 Launcher 回归验收清单

> 分支：`feat/launcher-intelligence-package-1`  
> 插件版本：`feishu@0.6.16`  
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

## 2. 打开路径

| # | 场景 | 预期 |
|---|------|------|
| 2.1 | 回车打开会话 | 直接进 `Lark.app` 对应会话（`lark://applink.feishu.cn/...`），不经浏览器中转 |
| 2.2 | 打开联系人 | 打开 p2p / openId 会话 |
| 2.3 | 打开文档 | 浏览器或客户端打开文档链接 |
| 2.4 | macOS + preferWindowFocus | 打开后尽量把匹配标题的飞书窗口置前（best-effort） |

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

## 6. 交互细节

| # | 场景 | 预期 |
|---|------|------|
| 6.1 | 异步追加结果时键盘选中 | 选中项不因 partial 刷新跳走（systemKey 保留） |
| 6.2 | 鼠标悬停 | 仅真实 pointer 移动后才 hover 选中，打开后光标静止不偷选 |
| 6.3 | 中文 IME | composition 期间 Enter 不上屏触发确认 |
| 6.4 | 多步参数 | chip 显示参数 label，option description 中英本地化 |

## 7. 自动化（开发机）

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

## 8. 已知非阻塞

- `src-tauri/*.dylib` 为本地动态库，**不提交**
- 窗口 focus 为 macOS best-effort，多显示器/多客户端时可能失败
- lark-cli 版本差异可能导致个别 subcommand flag 不同；以当前团队版本为准
