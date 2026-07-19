# CSV Tools Surface 实施计划

> **For agentic workers:** 按 task 顺序执行；每 task 可独立验证。设计见 `docs/plans/2026-07-12-csv-tools-surface-design.md`。

**Goal:** 将 `csv` 插件做成 Surface-only 表格工作台：稳健解析、中间表变换、多格式输出（含 SQL INSERT），主路径 Copy。

**Architecture:** `papaparse` 负责 CSV 解析/序列化；`csvCore.ts` 纯函数封装 parse / transform / toOutput；`CsvSurface.tsx` 只做 UI 状态与 i18n；`index.ts` 仅注册 surface，删除 tools。

**Tech Stack:** TypeScript, React, papaparse, `@hiven/plugin`, Node assert 静态/逻辑测试脚本

## Global Constraints

- 所有用户可见文案走插件 locale（zh/en），禁止 hardcode 最终 UI 文案
- Framework 不吸收 table/csv 产品语义
- 删除 `csv.toJson` 等 4 个 tools
- 验证：`npm run check:architecture`、`git diff --check`、`npm run build`、csv core 测试、step5 契约

---

### Task 1: 依赖 papaparse

**Files:**
- Modify: `package.json` / lockfile via npm

- [ ] **Step 1:** 安装

```bash
npm install papaparse
npm install -D @types/papaparse
```

Expected: `package.json` dependencies 含 `papaparse`，devDependencies 含 `@types/papaparse`。

---

### Task 2: csvCore 纯函数 + 测试

**Files:**
- Create: `src/plugins/csv/csvCore.ts`
- Create: `scripts/test-csv-core.mjs`
- Modify: `package.json`（scripts）

**Produces:**
```ts
export type DelimiterMode = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe'
export type HeaderMode = 'auto' | 'first-row' | 'no-header'
export type OutputMode =
  | 'objects' | 'array' | 'columns' | 'keyed'
  | 'ndjson' | 'csv' | 'tsv' | 'markdown' | 'sql'
export type JsonStyle = { minify: boolean; indent: 2 | 4 }
export type SqlStyle = { tableName: string }
export type Table = { headers: string[]; rows: string[][] }
export type ParseResult =
  | { ok: true; kind: 'csv' | 'json'; delimiter?: string; table: Table }
  | { ok: false; message: string }

export function detectInputKind(text: string): 'json' | 'csv'
export function parseSource(text: string, delimiterMode: DelimiterMode, headerMode: HeaderMode): ParseResult
export function dropEmptyRows(table: Table): Table
export function dedupeRows(table: Table): Table
export function transposeTable(table: Table): Table
export function applyTransforms(table: Table, t: { dropEmpty: boolean; dedupe: boolean; transpose: boolean }): Table
export function toOutput(table: Table, mode: OutputMode, style?: JsonStyle, sql?: SqlStyle): string
```

- [ ] **Step 1:** 实现 `csvCore.ts`（完整逻辑见设计文档 §核心 API / 输出细节）
- [ ] **Step 2:** 写 `scripts/test-csv-core.mjs`，用 typescript transpile + vm 或直接动态 import 测试导出（优先与仓库一致：若 papaparse 可 ESM import，用 `tsx`/`node --experimental-vm-modules`；推荐：把 core 测试写成纯逻辑断言，通过 `ts.transpileModule` + mock 不够时改用 vite-node / 直接对 `.ts` 用 `npx tsx`）

推荐跑法：

```bash
npx tsx scripts/test-csv-core.mts
```

测试用例最少覆盖：
1. 引号含逗号：`a,"b,c",d`
2. 引号内换行
3. `""` 转义
4. auto 识别 TSV
5. JSON 对象数组输入
6. objects / array / columns / keyed / ndjson / csv / tsv / markdown / sql
7. sql：`'` → `''`、空 → NULL
8. dropEmpty / dedupe / transpose
9. minify

- [ ] **Step 3:** `package.json` 增加 `"test:csv-core": "npx tsx scripts/test-csv-core.mts"`
- [ ] **Step 4:** 运行测试至 PASS

---

### Task 3: locales + CsvSurface

**Files:**
- Modify: `src/plugins/csv/locales/en.json`
- Modify: `src/plugins/csv/locales/zh.json`
- Modify: `src/plugins/csv/CsvSurface.tsx`

- [ ] **Step 1:** locale keys（示例，可微调命名但需中英齐全）

```json
{
  "surface.title": "CSV Tools",
  "surface.subtitle": "Table convert",
  "action.copy": "Copy",
  "action.close": "Close",
  "param.delimiter": "Delimiter",
  "param.header": "Header",
  "param.output": "Output",
  "param.minify": "Minify",
  "param.indent": "Indent",
  "param.tableName": "Table name",
  "delimiter.auto": "Auto",
  "delimiter.comma": "Comma",
  "delimiter.tab": "Tab",
  "delimiter.semicolon": "Semicolon",
  "delimiter.pipe": "Pipe",
  "header.auto": "Auto",
  "header.firstRow": "First row",
  "header.none": "No header",
  "output.objects": "JSON objects",
  "output.array": "2D array",
  "output.columns": "Column arrays",
  "output.keyed": "Keyed object",
  "output.ndjson": "JSON Lines",
  "output.csv": "CSV",
  "output.tsv": "TSV",
  "output.markdown": "Markdown",
  "output.sql": "SQL INSERT",
  "transform.dropEmpty": "Drop empty rows",
  "transform.dedupe": "Deduplicate",
  "transform.transpose": "Transpose",
  "pane.source": "Source",
  "pane.table": "Table preview",
  "pane.output": "Output preview",
  "empty.source": "Paste CSV, TSV, or a JSON array of objects",
  "meta.size": "{rows} × {cols}",
  "error.generic": "Parse error: {message}"
}
```

中文对照写在 `zh.json`。

- [ ] **Step 2:** 重写 `CsvSurface`：
  - 使用 `props.t` + fallback helper
  - state: sourceText, delimiter, header, output, minify, indent, tableName, transforms
  - useMemo: parse → applyTransforms → toOutput
  - 布局：header / params / transform toggles / 三栏
  - Copy / Close；失败或空禁用 Copy
  - 保留 className `csv-tools-surface*` 与测试断言字符串：`Table preview`、`Output preview`、`Delimiter` 等可用 aria-label 或 locale fallback 英文保持契约

契约 `test-step5` 要求源码匹配：
- `Table preview`
- `Output preview`
- `Delimiter` … `Header` … `Output`

实现时 pane title 可用 `t(..., 'Table preview')` fallback 保证字符串字面量仍在文件中，或更新测试同时认 i18n key — **优先保留英文 fallback 字面量以满足现有契约**。

---

### Task 4: 插件组装

**Files:**
- Modify: `src/plugins/csv/index.ts` — 删除 tools 与本地 parse 函数，只 export surface plugin
- Modify: `src/plugins/csv/manifest.json` — version `1.1.0`

- [ ] **Step 1:** `index.ts` 仅：

```ts
import { definePlugin } from '@hiven/plugin'
import { CsvSurface } from './CsvSurface'

export const csvPlugin = definePlugin({
  ui: {
    surfaces: [/* main surface as design */],
  },
})
export default csvPlugin
```

- [ ] **Step 2:** 确认无 `tools:`、无 `csv.toJson`

---

### Task 5: 契约与验证

**Files:**
- Modify: `scripts/test-step5-no-pin-and-csv-surface.mjs`（如需：断言无 tools）
- Modify: `package.json` scripts 如需要

- [ ] **Step 1:** 可选增强 step5：

```js
assert.doesNotMatch(csvIndex, /csv\.toJson/, 'CSV should not expose toJson tool')
assert.doesNotMatch(csvIndex, /tools:\s*\[/, 'CSV plugin should not declare tools array')
```

- [ ] **Step 2:** 跑：

```bash
npm run test:csv-core
node scripts/test-step5-no-pin-and-csv-surface.mjs
npm run check:architecture
git diff --check
npm run build
```

Expected: 全部通过。

---

## Spec coverage checklist

| 设计要求 | Task |
|----------|------|
| Surface only / 删 tools | 4 |
| Papa Parse | 1–2 |
| 中间 Table + 3 transforms | 2–3 |
| 9 输出含 SQL | 2–3 |
| JSON pretty/minify/indent | 2–3 |
| i18n | 3 |
| Copy 主路径 | 3 |
| 测试 + architecture/build | 5 |
