# hiven

跨平台 **launcher-only 精确文本工作台**：全局唤起 → 识别当前文本 → 推荐并执行动作 → 结果继续处理或回到前台。

灵感来自 [Boop](https://boop.okat.best/)，交互参考 Raycast / Alfred 一类全局入口，但**不做全能 OS launcher**。

## 产品形态

```text
系统托盘（唯一常驻入口）
  → 全局热键 / 托盘 打开 Global Launcher
  → 搜索 / 参数 / 结果（同一 launcher 会话）
  → host surface 原地展开：快捷编辑器 · 设置 · 插件管理
  → 插件独立 surface 窗口（Diff、剪贴板历史、翻译…）
  → 快捷编辑器可 detach 为独立窗口
```

没有持久主工作台窗口，也没有多 pane IDE 工作区。

## 主要能力

- **文本变换插件** — 编解码、格式化、JSON/CSV/YAML、行工具、Hash 等
- **内容感知** — Object Block + accepts/intent ranking（少搜命令全名）
- **Global Launcher** — 算式/时间/URL 即时结果、App/窗口/进程（macOS）、飞书（可选）
- **Quick Editor** — Monaco 快捷编辑，可与 launcher 协作
- **剪贴板历史** — 历史项可回到 launcher 继续处理
- **text-diff 插件** — 双栏文本/JSON semantic 对比（产品在插件内，不在 framework）
- **中英 i18n** · **Tauri v2** · 插件目录扩展

## 明确不做

- 全能桌面 launcher / 文件全局搜索主路径  
- 截图标注、窗管 Widgets、必选 LLM  
- Raycast 扩展商店兼容 / 云同步账号  
- 把 host 做成 code-review IDE  

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Tailwind + Zustand |
| 桌面 | Tauri v2 |
| 编辑 | Monaco（Quick Editor） |
| 发布 | GitHub Actions + Tauri Updater |

**发布矩阵：** macOS arm64 / x64、Windows x64。Linux 未进正式发布流水线。

## 开发

```bash
npm install
npm run tauri dev
```

质量门禁（PR / main）：

```bash
npm run test:quality-gate
```

## 构建

```bash
npm run tauri build
```

## 文档

- 产品：`PRODUCT.md`
- 设计 token / surfaces：`DESIGN.md`
- 架构冻结与收敛：`doc/2026-08-09-architecture-freeze-and-convergence.md`
- 能力全景：`doc/2026-08-09-system-capability-and-redesign-brief.md`

## 致谢

- [Boop](https://boop.okat.best/) — 文本工作台灵感  
- [Tauri](https://tauri.app/) — 跨平台桌面框架  
