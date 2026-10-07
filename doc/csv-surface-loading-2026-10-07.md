# CSV 表格界面按需加载

基线：`66d5b68`。本次只改 CSV 插件加载入口：注册插件、匹配表格文本和执行九条转换路由时，不再静态载入表格界面。实际打开任一 CSV surface 后，通过 React.lazy / Suspense 加载同一 `CsvSurface`；该异步块承载表格网格及 CSV、SQL 处理实现。

matcher、操作路由、初始材料、surfaceId、host/API、设置、外观、权限与 locale 均保持原有传递方式。新增中英文加载提示，并在等待期间提供返回。CSS 仍按原插件资产流程加载。本次没有调整其他插件、框架 API 或 CSV 转换逻辑。

## 构建证据

使用同一 checkout 基线、依赖及构建选项，修改前后分别执行 `npm run build -- --outDir <各自独立的 scratch 目录> --emptyOutDir`，保留两份产物。用 `scripts/measure-startup-graph.mjs` 解析实际生成 JS 的静态 import/export 图；候选附加 `--check-csv`。测量摘要、入口/文件集合、CSV 异步边及产品源码 SHA-256 在 [JSON 记录](csv-surface-loading-2026-10-07.json)。

单位为字节；gzip 为图中每个唯一文件以 level 9 分别压缩后的大小之和。

| 静态图 | 修改前 JS | 修改后 JS | 修改前 gzip | 修改后 gzip |
| --- | ---: | ---: | ---: | ---: |
| HTML 入口 | 196,372 | 196,368 | 63,375 | 63,387 |
| Launcher / App | 2,918,778 | 2,830,740 | 919,998 | 892,307 |
| 插件独立窗口 | 2,179,403 | 2,091,373 | 724,467 | 696,771 |
| Quick Editor 根 | 6,636,346 | 6,548,300 | 1,857,318 | 1,829,629 |
| Quick Editor 含 Monaco 根 | 6,636,430 | 6,548,384 | 1,857,407 | 1,829,718 |

候选生成 `CsvSurface-e_Oml52S.js`，88,773 字节，gzip 27,731 字节。该文件由启动图中的动态 import 引用，但所有上述静态图都不可达。共享依赖已在启动图的部分不重复算作延后载荷。Launcher 静态 JS 减少 88,038 字节，gzip 减少 27,691 字节；这是载荷差异，不是启动耗时结果。CSS、其他动态 import、worker 和依赖运行环境的 NLS 不计入该表；HTML 入口小幅 gzip 波动来自生成引用/压缩变化。

原始插件源码胶囊保持延后加载，171/171 个当前源码文件都有精确文字匹配。胶囊仍包含 CSV 的 `index.ts`、`CsvSurface.tsx`、`csvCore.ts`、`csvSqlFilter.ts`、CSS、manifest 和双语 locale。CSV manifest 升至 `1.9.3`，builtin index 同步升至 82。

## 验证与边界

- `check:typecheck`、`check:architecture`、`git diff --check` 通过；修改前后生产构建均通过。
- `test:csv-entry` 执行真实插件入口，验证轻量注册、CSV/TSV/文件路径 matcher、九条操作路由、初始材料与完整 context/host 引用透传。通过捕获 React.lazy 工厂确认导入仅在需求触发时发生；实际产物边界另由构建图验证。该检查不挂载或断言 UI。
- `node scripts/test-csv-core.mts` 通过，使用现有 Node v24 的 TypeScript stripping。原 npm 命令依赖未安装的 `tsx`，其 npx 获取又因默认 npm 缓存目录不可写失败；未新增依赖或修改算法测试。
- `test:builtin-plugin-release` 的 12 项通过，171 个释放文件逐字节核对通过。构建图 `--check --check-csv` 同时确认源码胶囊和 CSV surface 均不进入启动静态图。
- 尝试真实浏览器验证但受执行环境阻断：Chromium 无法创建 socket（Operation not permitted），支持的云端浏览器打开本地验证地址也返回 `ERR_BLOCKED_BY_CLIENT`。本轮没有完成真实 DOM、画面、慢加载或加载失败交互验证。

加载失败继续由既有 host 的双语 surface 错误边界显示稳定提示和返回按钮，错误细节留在控制台。模块级 React.lazy 会缓存 rejection；返回后重新打开不会自动重试。恢复条件后需要刷新页面或重启应用，再发起加载。本次未新增重试机制。

源码胶囊完整性、释放决策和 builtin 编译入口的加载边界已验证；外置原始 TypeScript 目录仍受既有运行时加载能力限制。本次未验证真实安装目录的动态导入执行，不把源码释放测试当作已安装插件运行成功的证据。
