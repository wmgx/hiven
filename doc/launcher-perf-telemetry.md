# Launcher 埋点：性能 + 用户行为 + 时延

Always-on 诊断管线。Agent / 人在「卡 / 慢 / 行为不对」时**先读数据再改代码**。

## 落盘

| 路径 | 说明 |
|------|------|
| `~/.local/hiven/logs/launcher-perf.ndjson` | 主日志（frontend + native） |
| `~/.local/hiven/logs/launcher-perf.ndjson.1` | ~5MB 软轮转备份 |

### NDJSON schema

```json
{
  "ts": 1786247362159,
  "source": "frontend",
  "kind": "behavior",
  "label": "behavior:launcher.item_select",
  "durationMs": null,
  "slow": false,
  "jank": false,
  "openId": "o_xxx",
  "details": { "kind": "behavior", "systemKey": "host:app:…" }
}
```

| 字段 | 含义 |
|------|------|
| `kind` | `behavior` 用户行为 · `latency` 时延 · `perf` 内部诊断 |
| `label` | 稳定事件名（见 `TelemetryEvents`） |
| `openId` | 一次热键 open→close 会话 |
| `durationMs` | 时延（behavior 可为空） |

## 会话模型

1. `hiven://launcher-open` → `beginLauncherPerfOpenSession()` → **`openId`**
2. 期间所有 frontend 样本带同一 `openId`
3. 关闭 → `endLauncherPerfOpenSession()` → `open:session-end`

## 事件目录

实现：`src/workspace/telemetry/events.ts`

### Behavior（用户行为）

| label | 触发 |
|-------|------|
| `behavior:launcher.open` | 面板 open |
| `behavior:launcher.close` | 关闭（`reason`: esc-or-overlay / blur / after-action） |
| `behavior:launcher.query_change` | 输入（280ms debounce） |
| `behavior:launcher.sticky_restore` | sticky 草稿恢复 |
| `behavior:launcher.item_select` | 选中 list item |
| `behavior:launcher.submit_input` | collect-input 提交 |
| `behavior:launcher.choice_activate` | 结果 choice 激活 |
| `behavior:launcher.back` | Esc 回退一帧 |
| `behavior:launcher.enter_collect_input` | 进入手动输入 |
| `behavior:launcher.enter_param_input` | 进入参数帧 |
| `behavior:clipboard.block_attach` | Object Block 挂上 |
| `behavior:clipboard.block_remove` | 用户移除 block |
| `behavior:clipboard.hint_attach` | 从 hint 强制挂上 |
| `behavior:object_action.execute` | Object 推荐动作 |
| `behavior:surface.open` / `.window_open` | 插件 surface |
| `behavior:paste.text` | 粘贴 |

### Latency（时延）

| label | 含义 |
|-------|------|
| `latency:launcher.first_paint` | 事件→首帧 |
| `latency:launcher.item_execute` | 命令执行 |
| `latency:launcher.submit_input` | （via execute 路径） |
| `latency:launcher.choice_activate` | choice 动作 |
| `latency:object_action.execute` | Object 动作 |
| `latency:surface.open` | surface 打开 |
| `latency:paste` | 粘贴 |
| `clipboard-object-block:read` | 剪贴板读（legacy label） |
| `open:event-to-first-paint` | 首帧（legacy，仍写） |

### Perf（内部）

`session:rank-items`、`session:host-dynamic-*`、`native:*` 等。

## 写埋点 API

```ts
import {
  TelemetryEvents,
  trackBehavior,
  trackLatency,
  measureLatency,
  queryTelemetryProps,
  itemTelemetryProps,
} from '../workspace/telemetry'

trackBehavior(TelemetryEvents.launcherClose, { reason: 'blur' })
await measureLatency(TelemetryEvents.surfaceOpenLatency, () => openSurface(target), {
  pluginId: target.pluginId,
})
```

约束：

- **不要**把大段剪贴板/查询正文写入 details（用 `queryLength` / `queryPreview`≤32）。
- 高频信号用 `createDebouncedTracker`。
- 新事件先加 `TelemetryEvents` 常量，再埋点。

## CLI

```bash
npm run telemetry -- --last 5
npm run perf:launcher -- --last 5 --json   # 同义
npm run telemetry -- --tail 3000 --last 5
```

报告含：

- first-paint / rehydrate / native / execute
- **behavior trail**（open→…→close）
- **latencies** top
- cross-session **behavior counts**

## 代码入口

| 路径 | 职责 |
|------|------|
| `src/workspace/telemetry/*` | 产品埋点 API + 事件表 |
| `src/workspace/launcher/perf.ts` | 落盘 / ring / openId / native forward |
| `src/workspace/launcher/controller.ts` | select / execute / submit / back |
| `src/launcher/hosts/GlobalLauncherHost.tsx` | open/close/query/object/paste |
| `src/launcher/clipboard/useClipboardObjectBlock.ts` | clipboard block |
| `scripts/lib/launcher-perf-analyze.mjs` | 会话聚合 |
| `scripts/launcher-perf-report.mjs` | CLI |

## 契约测试

```bash
npm run test:telemetry
npm run test:launcher-perf-instrumentation
npm run test:launcher-perf-report
```
