# CSV Tools Surface 设计

> 日期：2026-07-12  
> 状态：已确认（含 TableConvert 能力对标扩展）  
> 范围：first-party `csv` 插件 — surface 优先，删除独立转换命令  
> 参考：[tableconvert.com/csv-to-json](https://tableconvert.com/csv-to-json)

## 背景

仓库里已有 `src/plugins/csv` 半成品：

- 四个 Launcher 命令（`csv.toJson` / `csv.fromJson` / `csv.tsvToJson` / `csv.jsonToTsv`）
- `CsvSurface` 三栏预览骨架
- 解析为裸 `split`，不处理引号与单元格内换行
- tools 与 surface 逻辑重复；UI 文案 hardcode

产品判断：CSV 常有分隔符歧义、表头判断、预览核对，**适合窗口交互**；Launcher 一键转换场景少。

对标 TableConvert 后：其价值不在「30 种冷门导出」，而在 **中间表模型 + 多种 JSON 形态 + 少量表清理 + 实时预览/Copy**。hiven 作为桌面文本工作台，取高频子集，不复制成格式超市。

## 目标

1. CSV Tools 以 **Surface 窗口** 为唯一产品形态。
2. 解析/序列化达到 **RFC4180 实用稳健级**（引号、转义、单元格换行）。
3. 内部统一为 **中间 Table**，支持多输入 → 清理 → 多输出。
4. 产出路径以 **预览 + Copy** 为主。
5. 所有用户可见文案走插件 i18n（中/英）。
6. 删除四个独立转换命令，避免半死不活入口。

## 非目标（v1）

| 不做 | 原因 |
|------|------|
| 上传文件 / 网页抽表 / 浏览器扩展 | 桌面粘贴 + initialText 足够 |
| Excel / PDF / PNG / 代码语言模板 | 与产品边界不符 |
| 完整 spreadsheet 单元格编辑 + Undo | 工作量大，另成产品 |
| YAML / HTML / XML 导出 | 与 yaml/formatter 等职责重叠或可后置 |
| 列选择、类型猜测、正则替换 | YAGNI；line-tools / text-utils 更合适 |
| 大小写批量改写、随机化 | 低频 / 噱头 |
| CSV Diff | 另插件 |
| framework 级 table 概念 | 能力留在插件内 |

## 能力范围（v1 = P0 + 轻量 P1）

### 输入

| 能力 | 说明 |
|------|------|
| 粘贴 / 编辑 Source | 主输入 |
| `initialText` | Launcher / 剪贴板推荐带入 |
| **CSV / TSV 文本** | Papa Parse + delimiter 模式 |
| **JSON 对象数组** | 自动识别 `[{...},...]`，反解为中间表（替代已删 JSON→CSV 命令） |

### 解析参数

| 参数 | 选项 |
|------|------|
| Delimiter | `auto` / comma / tab / semicolon / pipe |
| Header | `auto` / first-row / no-header |

（输入判定为 JSON 时，delimiter 参数对源解析无效，UI 可 disabled 或忽略。）

### 表清理（作用在中间 Table，可叠用）

| 操作 | 说明 |
|------|------|
| 删除空行 | 全空单元格的行去掉 |
| 去重行 | 按整行序列化去重，保留首次出现 |
| 转置 | 行列互换；转置后 header 语义：首行仍作 header 展示（与 TableConvert 同类） |

清理是 **视图变换**，不回写 Source（避免源与预览缠死）；可选后续「Apply to source」不在 v1。

### 输出格式

| mode | 结果 |
|------|------|
| `objects` | JSON 对象数组 `[{col: val}, …]` |
| `array` | JSON 二维数组（含 header 行） |
| `columns` | JSON 列数组 `{ col: [v1, v2, …], … }` |
| `keyed` | JSON 键对象：首列值为 key，`{ key: {其余列…}, … }`；首列重名后者覆盖并记 warning |
| `ndjson` | JSON Lines，每行一个对象 |
| `csv` | 逗号分隔 |
| `tsv` | Tab 分隔 |
| `markdown` | GitHub 风格 Markdown 表 |
| `sql` | `INSERT INTO {table} (cols) VALUES (...), (...);` |

### JSON 样式（适用于 objects / array / columns / keyed）

| 选项 | 说明 |
|------|------|
| pretty / minify | 默认 pretty |
| indent | pretty 时 2 或 4 spaces（默认 2） |

### SQL 选项（仅 `sql` 输出时显示）

| 选项 | 说明 |
|------|------|
| Table name | 默认 `table`；用户可改；标识符简单校验（字母数字下划线，或自动加反引号） |
| 多行 / 单语句 | v1 固定：**一条 INSERT 多 VALUES**（便于粘贴执行） |
| 值转义 | 字符串单引号 `'` → `''`；`NULL` 空单元格输出 SQL `NULL`（可选：空串当 `''`，v1 空单元格 → `NULL`） |
| 数字 | 看起来像数字的单元格仍按**字符串**引用（避免 `001` 丢前导零）；不做类型猜测 |

`ndjson` 固定每行 compact 对象；`csv`/`tsv`/`markdown`/`sql` 不受 indent 影响。

### 产出与反馈

- Table preview（最多 50 行）+ Output preview  
- Header 统计：`{rows} × {cols}` + 当前生效 delimiter  
- **Copy** 主按钮；解析失败或空输出时禁用  
- Close  

## 产品边界（摘要）

| 做 | 不做 |
|----|------|
| Surface only | 独立转换 tools |
| 中间 Table + 清理三按钮 | 完整表格编辑器 |
| 上表输出格式 + JSON 样式 + SQL INSERT | 30+ 冷门导出 |
| 预览 + Copy | 主路径写回编辑器 |
| 剪贴板打开 surface 带入 | 网页抽表 |

### 入口

- Launcher 搜 “CSV Tools” / “表格转换” → 开插件窗口  
- 剪贴板像 CSV/TSV 时 → 推荐 `open-csv-tools-surface`，`initialText` 带入  
- 快捷键可绑定 surface（`shortcutPresentation: 'window'`）  

## 架构

```text
Source text
  → detectInputKind (csv | json)
  → parse → Table { headers, rows }
  → transforms (dropEmptyRows | dedupe | transpose)*
  → preview + toOutput(format, jsonStyle)
  → Copy
```

```text
papaparse
  ↑
src/plugins/csv/csvCore.ts     # parse / transform / toOutput（纯函数）
  ↑
src/plugins/csv/CsvSurface.tsx # UI
  ↑
src/plugins/csv/index.ts       # 只组装 surface，无 tools
```

依赖方向：

```text
plugins/csv → @hiven/plugin + papaparse
workspace/framework → 不依赖 csv
kits → 不新增（仅服务一个插件）
```

### 文件结构

```text
src/plugins/csv/
  index.ts
  CsvSurface.tsx
  csvCore.ts
  locales/en.json
  locales/zh.json
  manifest.json
```

### 依赖

- **不**引入 `papaparse`（插件会释放到 `~/.local/hiven/plugins/builtin`，外部 npm 包在磁盘动态 import 下不可解析，会导致打开闪退）
- 解析/序列化自研 RFC4180 实用子集（`csvCore.ts`）

## 核心 API（`csvCore.ts`）

纯函数，无 React / host 依赖。

```ts
type DelimiterMode = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe'
type HeaderMode = 'auto' | 'first-row' | 'no-header'
type OutputMode =
  | 'objects' | 'array' | 'columns' | 'keyed'
  | 'ndjson' | 'csv' | 'tsv' | 'markdown' | 'sql'
type JsonStyle = { minify: boolean; indent: 2 | 4 }
type SqlStyle = { tableName: string }

type Table = {
  headers: string[]
  rows: string[][]   // body only
}

type ParseOk = {
  ok: true
  kind: 'csv' | 'json'
  delimiter?: string   // csv only
  table: Table
}

type ParseErr = { ok: false; message: string }

function detectInputKind(text: string): 'json' | 'csv'
function parseSource(text: string, delimiterMode: DelimiterMode, headerMode: HeaderMode): ParseOk | ParseErr
function dropEmptyRows(table: Table): Table
function dedupeRows(table: Table): Table
function transposeTable(table: Table): Table
function toOutput(table: Table, mode: OutputMode, style: JsonStyle, sql?: SqlStyle): string
```

### 解析语义

- **库**：Papa Parse（`parse` / `unparse`）
- **JSON 输入**：`JSON.parse` 后要求「对象数组」；键并集为 headers；缺省字段 `""`
- **delimiter**
  - 显式：`,` / `\t` / `;` / `|`
  - `auto`：前若干行对候选分隔符计分
- **header**
  - `first-row`：首行 header
  - `no-header`：`column_1…n`
  - `auto`：≥2 行则首行 header，否则 `column_n`
- **字段**：RFC4180 引号、`""` 转义、引号内换行/分隔符
- **空输入**：成功空表
- **坏数据**：`ok: false` + 可读 message

### 输出细节

- **objects / ndjson**：每行 → 对象；空 header 回落 `column_n`
- **array**：`[headers, ...rows]`
- **columns**：按列聚合
- **keyed**：`headers[0]` 为 key 字段；值为该行其余列对象；重复 key 后者覆盖
- **markdown**：表头 + `|---|` 分隔 + 行；单元格内 `|` 转义为 `\|`
- **csv / tsv**：Papa `unparse`，含 header 行
- **sql**：
  ```sql
  INSERT INTO `table` (`col1`, `col2`) VALUES
    ('a', 'b'),
    ('c', NULL);
  ```
  - 标识符：非 `[A-Za-z_][A-Za-z0-9_]*` 时用反引号包裹，内部 `` ` `` → 加倍
  - 空表 / 无列：返回错误或空字符串 + surface 禁用 Copy

## Surface UI

### 布局

1. **Header**：标题 + `{rows}×{cols}` 统计 + Copy + Close  
2. **Params 行**  
   - Delimiter / Header（源为 JSON 时可禁用 delimiter）  
   - Output format  
   - JSON 为 pretty 类时：Minify 开关 + Indent（minify 时隐藏 indent）  
   - `sql` 时：Table name 输入框  
3. **Toolbar（表清理）**：删除空行 / 去重 / 转置（toggle 或一次性 apply 到 transform 状态）  
4. **Body**：Source | Table preview | Output preview  

Transform 状态建议：

```ts
transforms: { dropEmpty: boolean; dedupe: boolean; transpose: boolean }
```

勾选即生效（派生表），不改 Source。

### 行为

- `sourceText` 初始：`props.initialText ??` 示例 CSV  
- 改 source / 参数 / transforms → 即时重算  
- Table preview ≤ 50 行；全量参与 `toOutput`  
- Copy：`host.clipboard.writeText(outputText)`  
- Close：`host.close()`  

### i18n

- 标题、参数、option、按钮、空态、错误全部 `t(key)`  
- 删除旧 `command.*` tools 文案  
- 新增 surface / format / transform keys（中英）  

### 错误与空态

- 解析失败：Table/Output 显示错误，Copy 禁用  
- 空输入：友好空状态  
- keyed 无列：明确错误  

## 插件组装（`index.ts`）

```ts
export const csvPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'CSV Tools',
        titleI18n: { zh: 'CSV Tools' },
        icon: 'Table',
        aliases: ['csv', 'tsv', 'table convert', '表格转换', 'csv to json'],
        component: CsvSurface,
        entry: { launcher: true, shortcutBindable: true, shortcutPresentation: 'window' },
        shell: {
          defaultWidth: 960,
          defaultHeight: 680,
          minWidth: 720,
          minHeight: 520,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
})
```

- **删除** 全部 `tools`  
- `manifest` version bump（如 `1.1.0`）  
- 剪贴板 `open-csv-tools-surface` 保留  

## 测试与验证

### 契约 / 静态

- 更新 `scripts/test-step5-no-pin-and-csv-surface.mjs`：surface + window + preview + params  
- 可断言 **无** `csv.toJson` 等 tools  

### 核心逻辑（`scripts/test-csv-core.mjs` 或同类）

- 引号含逗号 / 单元格换行 / `""` 转义  
- auto delimiter 识别 TSV  
- header modes  
- JSON 对象数组输入  
- objects / array / columns / keyed / ndjson / csv / tsv / markdown / sql  
- sql 转义（`'` → `''`、空 → NULL、标识符反引号）  
- dropEmpty / dedupe / transpose  
- minify / indent  
- 坏引号 → error  

### 构建

```bash
npm run check:architecture
git diff --check
npm run build
npm run test:step5-no-pin-and-csv-surface   # 若已挂 package script
# 新 csv core 测试 script
```

浏览器：粘贴含引号样例 → 预览 → 切换输出 → Copy。

## 实现步骤（概要）

1. 添加 `papaparse` 依赖  
2. 实现 `csvCore.ts` + 单测  
3. 重写 `CsvSurface.tsx`（参数 / 清理 / 输出 / i18n / Copy）  
4. 精简 `index.ts` + locales + manifest  
5. 更新契约测试  
6. architecture / build / 目标测试  

## 成功标准

- [ ] Launcher 可打开 CSV Tools；无 CSV 转换命令条目  
- [ ] 引号/换行 CSV 与 JSON 数组输入均可正确成表  
- [ ] 9 种输出（含 SQL INSERT）+ pretty/minify 正确  
- [ ] 删空行 / 去重 / 转置生效且不污染 Source  
- [ ] Copy 与失败禁用  
- [ ] 中英文文案完整  
- [ ] architecture、相关测试、build 通过  

## 与 TableConvert 对照

| TableConvert | hiven v1 |
|--------------|----------|
| 粘贴 / 上传 / 网页抽表 | 粘贴 + initialText |
| 完整表格编辑器 | 预览 + 3 个 transform |
| objects / 2D / columns / keyed | 同左 |
| Minify / indent | 同左 |
| 30+ 导出 | csv / tsv / md / json 族 / ndjson / **SQL INSERT** |
| Excel / YAML / HTML… | 不做 |
| 大小写 / 替换 / 随机 | 不做 |

## 决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| 产品形态 | Surface only | 需预览与参数 |
| 旧 tools | 直接删除 | 避免死入口 |
| 解析 | Papa Parse | RFC4180 稳健 |
| 能力对标 | TableConvert 高频子集 | 不做格式超市 |
| 中间模型 | Table + transforms | 多入多出共用 |
| 产出 | 预览 + Copy | 主路径简单 |
| SQL INSERT | v1 做 | 开发者粘贴进库高频；单语句多 VALUES |
| YAML/HTML 等 | v1 不做 | 边界与 YAGNI |
| kit | 不抽 | 仅 csv 使用 |

## 后续可选项（非 v1）

- Apply transforms 写回 Source  
- 次要「写回编辑器」  
- YAML / HTML table 导出  
- 列选择 / 排序  
