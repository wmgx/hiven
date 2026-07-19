# 剪贴板历史：常用与收藏

**日期:** 2026-07-12  
**状态:** 已确认  
**范围:** `src/plugins/clipboard-history` only（first-party plugin；不进入 framework）

## 背景

剪贴板历史已支持全量列表、类型筛选、搜索、粘贴上屏与 prune 策略。用户需要：

1. **常用**：按真实「粘贴上屏」次数筛选与排序，快速找到反复使用的片段。  
2. **收藏**：手动钉住重要条目，可写自定义标题；清理策略不得误删收藏。

现有 `copyCount` 表示「重复拷入系统剪贴板」次数，**不能**代替粘贴次数。

## 目标

- 筛选 Tab 增加「常用」「收藏」。
- 成功粘贴后累计 `pasteCount`；常用按次数排序，并支持可配置门槛。
- 收藏可写/改标题；收藏豁免 prune。
- 中英文 i18n 完整；插件边界内实现。

## 非目标

- 独立收藏库 / 云同步。
- 常用与类型交叉筛选（如「常用 ∩ 文本」）。
- 强制收藏标题、智能敏感过滤。
- framework 级 pin / favorite 通用能力。

## 已确认决策

| 决策 | 选择 |
|------|------|
| 入口形态 | 筛选 Tab：`全部 \| 文本 \| 图片 \| 文件 \| 常用 \| 收藏` |
| 常用集合 | `pasteCount >= frequentPasteThreshold` |
| 门槛 | 设置项，默认 `3`，建议范围 2–20 |
| 常用排序 | `pasteCount` 降序，同分 `lastPastedAt` 降序 |
| 收藏清理 | 收藏豁免 prune；取消收藏后恢复正常清理 |
| 收藏标题 | 收藏时弹轻量输入（可留空）；预览区可再改 |
| 粘贴后 | 记次 + 清空搜索 + 关窗（沿用现有关窗行为） |

## 数据模型

在 `ClipboardHistoryItem` / `ClipboardHistoryIndexEntry` 上增量字段：

```ts
pasteCount?: number        // 成功上屏次数；缺省视为 0
lastPastedAt?: number      // 最近成功粘贴时间
isFavorite?: boolean       // 是否收藏
favoriteTitle?: string     // 用户标题；空则列表用 preview
favoritedAt?: number       // 收藏时间；收藏 Tab 默认按此倒序
```

兼容：读写侧 `?? 0` / `?? false`；旧 index 无字段时列表仍可用。

与 `copyCount` 职责分离：

- `copyCount`：同 hash 再次进入剪贴板时累加（已有）。
- `pasteCount`：用户从历史成功粘贴上屏时累加。

## Repository API（插件内）

```ts
recordPaste(id: string): Promise<ClipboardHistoryItem | undefined>
setFavorite(id: string, favorite: boolean, title?: string): Promise<ClipboardHistoryItem | undefined>
updateFavoriteTitle(id: string, title: string): Promise<ClipboardHistoryItem | undefined>
```

- `recordPaste`：`pasteCount += 1`，`lastPastedAt = now`；同步 index。  
- `setFavorite(true, title?)`：`isFavorite=true`，`favoritedAt=now`，可选 `favoriteTitle`。  
- `setFavorite(false)`：清 `isFavorite` / `favoriteTitle` / `favoritedAt`。  
- `prune`：候选删除集排除 `isFavorite === true` 的 entry。  
- `indexToListItems` / `getListItemsSync` 带上新字段，避免列表再 IPC。

## UI / 交互

### 筛选

`FilterKind = 'all' | 'text' | 'image' | 'files' | 'frequent' | 'favorite'`

- 常用 / 收藏与类型筛选互斥。  
- 搜索在当前 Tab 内生效；收藏 Tab 同时匹配 `favoriteTitle` 与 preview。  
- 常用 / 收藏 **不按日分组**，扁平列表。  
- 空态文案：常用「暂无达到门槛」；收藏「还没有收藏」。

### 列表行

- 有 `favoriteTitle` 时主标题优先标题；可副行显示 preview。  
- 收藏：星标高亮。  
- `pasteCount > 0` 时可淡化显示次数（如 `×5`）。  
- 行操作：保留粘贴 / 删除；增加收藏/取消星标。

### 收藏写标题

1. 未收藏点星 → 对话框输入标题（placeholder 用 preview 截断，可留空）→ 确认收藏。  
2. 已收藏点星 → 取消收藏。  
3. 预览区对收藏项提供「编辑标题」。

### 设置

- `frequentPasteThreshold: number`，默认 `3`。

### 粘贴路径

`handlePaste` 成功路径：`recordPaste` → `setQuery('')` → `host.close()`。失败不记次、不清搜索。

## 设置模型

```ts
// ClipboardHistorySettings 增量
frequentPasteThreshold: number // default 3
```

settings schema 增加 number 字段（min/max 与 UI 一致，如 2–20）。

## i18n

所有用户可见文案走 plugin locale（`en.json` / `zh.json`），包括：

- `filter.frequent` / `filter.favorite`（`filter.frequent` 已有）  
- 空态、收藏对话框标题/确认/取消、编辑标题、paste 次数展示、设置门槛 label  

禁止 hardcode 中英文。

## 文件清单

| 路径 | 变更 |
|------|------|
| `storage/clipboardHistoryTypes.ts` | 字段 |
| `storage/clipboardHistoryRepository.ts` | API、prune 豁免、index 映射 |
| `settings/model.ts` | threshold 默认 |
| `index.tsx` | settings schema |
| `surfaces/ClipboardHistorySurface.tsx` | Tab、排序、星标、对话框、记次 |
| `style.css` | 星标 / 对话框 / 次数样式（如需） |
| `locales/en.json` / `zh.json` | 文案 |

## 测试

脚本级（与现有 `scripts/test-clipboard-history-*` 风格一致）：

1. **repository**：`recordPaste` 累加；收藏豁免 prune；门槛筛选与排序。  
2. **surface**：paste 成功后清搜索 + 调用记次；filter 含 frequent/favorite。  
3. **settings**：schema 含 threshold。  
4. 回归现有 clipboard-history 集成 / paste story / storage 测试。

## 实现顺序建议

1. Types + repository + 单测式脚本  
2. Settings threshold  
3. Surface filter / 排序 / paste 记次  
4. 收藏 UI（对话框 + 编辑标题）  
5. i18n + 样式 polish + 全量相关脚本  

## 成功标准

- 粘贴 ≥ threshold 的条目出现在「常用」，且按次数降序。  
- 收藏后出现在「收藏」Tab，可显示自定义标题；prune 不删收藏。  
- 热开窗口不残留搜索词（已有行为保持）。  
- `npm`/scripts 相关断言通过；无 framework 泄漏。
