# Launcher 智能化 包③–⑧ 实施计划（收官）

**分支:** `feat/launcher-intelligence-package-1`  
**目标:** 一晚内完成控制中枢一期剩余包；⑥⑦ 最小可交付；⑧ 骨架/ defer 文档。

## 包③ App + URL
- 空 query：App 动态项最多 5 条（按 usage 不在 dynamic 层时按名字截断+ranking 后由 host 限流）
- 强 content intent（detections conf≥0.85 且 kind 为 jwt/json/base64/csv/timestamp 等文本类）：host app 项 intent 让位（app score 惩罚或 cap）
- web-open：query/content 为 URL 时 dynamic 打开项；tools accepts kinds:url；`{query}`/`{clipboard}` 模板已有则保留

## 包④ 窗口
- Rust macOS: list_visible_windows, focus_window, close_window
- 前端 host dynamicItems + 缓存 2s
- 别名 切到/窗口/focus
- close → L2 确认 UI

## 包⑤ 进程
- Rust: list_processes(query), terminate_process(pid, force=false)
- 空 query 不列
- 关键进程 deny 表
- kill → L2 确认 + 审计日志（无 content）
- PluginPermission: process.list / process.terminate（或 desktop.process）

## 包⑥ 线性工作流 MVP
- `src/workflow/pipeline.ts`：PipelineDefinition { id, steps: commandIds[] }
- 注册 1–2 示例 pipeline 为 launcher item
- 执行：逐步 text 输出作下一步 input

## 包⑦ 脚本脚手架
- pluginScaffold 增加 template: 'script-command'
- PluginPermission `shell.run`（L3，默认不授权）
- 模板插件声明 requiredPermissions

## 包⑧
- 文档 defer：OAuth/飞书需独立设计；可选 empty plugin stub `feishu-placeholder` **不做**（避免空壳污染）
- 在 roadmap 勾选 defer 说明即可
