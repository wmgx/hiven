# Launcher 视觉 · V4 立体黑 + V5 空井 设计稿

> **状态:** 并行出稿（不阻塞包四 02/03 代码，建议同里程碑落地）  
> **来源:** `doc/2026-07-19-ui-ux-review-and-redesign-summary.md` V4 / V5（及可选 V6）  
> **依赖 token:** `--hairline`、launcher 系 `--panel / --surface / --text*`、包三键帽

---

## 1. 问题

| 编号 | 现象 | 根因 |
|------|------|------|
| V4 | dark 主题是普通深灰面板 + 亮蓝 accent，与 light「立体白」不同源 | 阴影 / 白面高光在黑底物理失效，却仍套 light 手法 |
| V5 | 无结果 / 插件空列表只有一行灰字 | 缺少与 preview 井同材质的「空」容器，也弱化了可行动作 |
| V6（可选） | `.l-row.sel` 纯平 accent-soft | 缺极淡压入感；**须过目渲染后再定，本文只给试验规格** |

---

## 2. V4 · 立体黑（Dark）

### 2.1 原则

- **不**用大投影装深度；用**面色分层 + 上边缘发丝高光**。
- Accent 保持品牌蓝，但 soft/tint 从 `color-mix(accent, surface)` 派生，避免 indigo 残留。
- 与 light 共用结构 class；仅在 `.dark` / `[data-theme=dark]` token 分叉。

### 2.2 Token 提案

```css
/* dark only — names map onto existing launcher tokens */
--panel: #242427;           /* 主面板 */
--surface: #2e2e32;         /* 抬起一层（输入井、卡片） */
--surface-2: #3a3a3f;       /* 再抬 / hover */
--border: #36363b;
--border-2: #43434a;
--text: #f2f2f4;
--text-2: #a0a0a8;
--text-3: #6d6d75;
--accent: #3b82f6;
--elev-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.06);
--elev-panel: var(--elev-highlight), 0 0 0 var(--hairline) rgba(0, 0, 0, 0.35);
--well-bg: color-mix(in srgb, #000 22%, var(--panel));
--well-inset: inset 0 1px 0 rgba(0, 0, 0, 0.35), inset 0 -1px 0 rgba(255, 255, 255, 0.03);
```

### 2.3 组件映射

| 表面 | 处理 |
|------|------|
| `.global-launcher-panel` / `.palette-panel` | `background: var(--panel); box-shadow: var(--elev-panel)` |
| 搜索输入行 | `background: var(--surface); box-shadow: var(--well-inset)`（内凹井） |
| 列表行 hover | `background: var(--surface)`；选中用 accent-soft mix，**不要**亮白描边 |
| 键帽 kbd | 深底 + 上沿高光 1px；border `var(--hairline)` |
| Toast error | 已用 `color-mix(error, surface)`，禁止 `#fef2f2` 亮粉底 |

### 2.4 验收

- [ ] dark 下主面板可见上沿高光，非「一块死灰」
- [ ] 输入井比面板更凹，列表行比面板略浮
- [ ] accent-soft 选中无紫向 indigo
- [ ] light 主题零回归

### 2.5 出图挑选（实现前可选）

渲 3 张 HTML 对照（同布局）：

1. 现状 dark  
2. 仅加 `elev-highlight`  
3. 完整 well + elev  

选 2 或 3 后冻结 token 值。

---

## 3. V5 · 空井（Empty Well）

### 3.1 原则

空状态不是「一行灰字」，而是**内凹井 + 线条图标 + 主文案 + 次要动作**，与 03 live preview 井同材质。

### 3.2 结构

```
┌─ empty well ──────────────────────────────────┐
│              [ 24px line icon ]                │
│           未找到「xxx」相关操作                  │
│        试试更短关键词，或从剪贴板继续            │
│              [ 次要按钮可选 ]                    │
└───────────────────────────────────────────────┘
```

| 元素 | 规格 |
|------|------|
| 容器 | `background: var(--well)` / dark `--well-bg`；`box-shadow: var(--well-inset)`；`border-radius: var(--radius-md)`；内边距 28–36px |
| 图标 | Lucide 线条，24px，`var(--text-3)`；禁止 emoji 作唯一图标 |
| 主文案 | 13–14px，`var(--text-2)` |
| 次文案 | 12px，`var(--text-3)` |
| 动作 | 可选 text button；**不**强绑 web search（曾回滚） |

### 3.3 出现场景

| 场景 | 主文案 key | 动作 |
|------|------------|------|
| Launcher 无搜索结果 | `palette.noResults` | 无强制动作；可显示「清空输入」若 query 长 |
| 插件列表空 | 插件 locale | 打开安装 / 刷新（插件自定） |
| Live preview 空 | `palette.livePreviewEmpty` | 无 |
| 参数列表空过滤 | `palette.collectInputEmptyFilterHint` | 无 |

### 3.4 与 P2-5

历史「空状态 web search 快捷」已否决。V5 **只**解决材质与层次；fallback 动作须产品单独拍板，默认不加。

### 3.5 验收

- [ ] 无结果时可见内凹井，而非单行居中灰字
- [ ] light / dark 井材质与输入井同源
- [ ] 全部文案 i18n
- [ ] 不恢复 web search 硬入口

---

## 4. V6 · 选中态微材质（可选）

```css
.l-row.sel {
  background: var(--accent-soft);
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 40%, transparent);
}
/* dark */
.dark .l-row.sel {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

- 若过目觉得「脏」或「吵」→ **整项砍掉**，不迭代第三版。
- 不与 V4/V5 绑死同一 PR。

---

## 5. 实施顺序

1. 冻结 V4 dark token（可先出 3 张 HTML）  
2. 面板 + 输入井 + kbd 套用  
3. Empty well 组件（launcher 先，插件列表复用 class）  
4. Preview well 与 empty well 共用 class 前缀（如 `.hiven-well`）  
5. （可选）V6 试验  

验证：`npm run check:architecture`、`npm run build`、light/dark 真机 DOM。

---

## 6. 非目标

- 不重做整套组件库  
- 不给 Global Launcher 窗口加 show/hide 动画  
- 不在 V5 塞搜索引擎入口  
- 不把 diff / Monaco 拉进 empty/preview 井  

---

**结论:** V4/V5 可与包四代码并行；preview 井实现时优先挂 V5 材质，避免包四合并后再铲样式。
