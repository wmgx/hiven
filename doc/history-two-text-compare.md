# History 两条全文对比

在 History 的「选择文本」中，跨搜索按顺序选两条，点击「对比两条」。复用现有 Diff；左侧为选择顺序 1，右侧为 2，标题注明历史来源。返回保留查询、选择和顺序，可移除一条再选、再次对比。拼接入口继续保留。

点击时重新读取两份完整文本，并核验条目 ID、内容 hash 和最新索引；不使用列表摘要或拼接预览，不修改历史、剪贴板或原文。空文本、空白和换行不做归一化。两条合计最多 1 MiB UTF-8，超限明确报错，不截断。失败保留选择，允许重试或换选。

宿主的可选 `compareHistoryTexts` 只注入给当前实际注册的 bundled History 定义，目标也验证 bundled Diff 的定义身份。没有新增权限，没有任意插件路由或 pane 写回。共享原 `openDiffPage` 的双侧序列化。History 在对比期间仍挂载，但收起原选择对话框；对比返回回执绑定页面 owner、AbortSignal 和单次会话，旧回执不能结束新会话。隐藏、替换、卸载及权限/注册变化会撤销当前交接。

## 验证

2026-10-11，在 hiven 云环境的 Chromium/Playwright 真实浏览器中完成：

- 两次不同搜索选齐；检查实际 Monaco models 的左右全文和画面。
- 返回保留搜索与两条顺序，换第二条再对比；核对新全文。
- 显式点击 Diff 右侧复制，在独立页面 textarea 通过 Ctrl+V 粘贴，逐字核对全文。
- 对比前后历史存储及剪贴板哨兵均未变化；删除全文后失败保留选择，恢复合成条目后重试成功；超限显示错误且不丢选择。
- 浏览器无页面异常；隔离临时 profile，仅合成文本，禁用各类自动记录，结束关闭临时 profile；没有调用真实 API 或读取密钥。

复现（先启动 `npm run dev`）：

```bash
HIVEN_PLAYWRIGHT_MODULE=/path/to/playwright-core node scripts/validate-history-diff-browser.cjs
node --experimental-strip-types scripts/test-history-diff-handoff.mts
```

`HIVEN_CHROMIUM` 可指定浏览器路径，默认 `/usr/bin/chromium`。验收截图仅写入忽略目录 `temp/`。脚本仅允许访问本地 Vite，不连接桌面数据桥接。

逻辑验证覆盖完整快照、删除/变化、迟到读取、UTF-8 边界、受限来源、owner 撤销和迟到返回回执。架构检查、TypeScript 检查、Vite 构建及内置插件释放逻辑通过；History 版本提升为 1.4.8。

范围限制：此环境没有 Rust 工具链或运行中的桌面 bridge；未构建/启动 Tauri 桌面程序，未验证桌面窗口生命周期与 OS 外部应用粘贴。上述外部粘贴目标为独立浏览器页面，使用真实浏览器剪贴板路径。未部署或发布应用。
