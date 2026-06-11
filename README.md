# hiven

一款受 [Boop](https://boop.okat.best/) 启发的跨平台文本处理工具，在其基础上进行了能力扩展。

## 特性

- **26+ 内置文本处理脚本** — Base64、JSON 格式化、URL 编解码、JWT 解析、时间戳转换、SQL 格式化、Hash、CSV/XML/YAML 处理等
- **Monaco Editor** — 完整的代码编辑器体验，语法高亮、多光标编辑
- **Command Palette** — 快速搜索并执行任意操作
- **自定义脚本** — 支持用户编写 JavaScript 扩展
- **跨平台** — macOS (arm64 / x86_64)、Windows、Linux
- **自动更新** — 通过 GitHub Releases 分发更新
- **中英双语** — 完整的国际化支持

## 相比 Boop 的扩展

| 能力 | Boop | hiven |
|------|------|----------|
| 平台 | macOS only | macOS / Windows / Linux |
| 编辑器 | 自定义 | Monaco Editor |
| 自动更新 | Sparkle | GitHub Releases + Tauri Updater |
| 脚本调试 | 无 | 内置 Debugger 视图 |
| 命令面板 | 有 | 有 (cmdk) |

## 技术栈

- **前端**: React 19 + TypeScript + Tailwind CSS + Zustand
- **桌面框架**: Tauri v2
- **编辑器**: Monaco Editor
- **CI/CD**: GitHub Actions

## 开发

```bash
npm install
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

## 发布新版本

1. 修改 `src-tauri/tauri.conf.json` 中的 `version`
2. 提交并打 tag：
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. GitHub Actions 自动构建并发布到 Releases

## 致谢

- [Boop](https://boop.okat.best/) — 灵感来源
- [Tauri](https://tauri.app/) — 跨平台桌面框架
