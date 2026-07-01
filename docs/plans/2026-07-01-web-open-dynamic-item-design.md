# Web-Open 增强：动态直开 + 正则匹配 + Favicon 缓存

## 目标

让 web-open 插件在 launcher 中支持"一步打开"体验：
1. 输入是 URL → 直接打开
2. 输入匹配 entry 的正则 → 跳过 collect-input，一步打开
3. dy item 自动展示对应域名的 favicon（带缓存）

## 数据模型变更

### WebQuickOpenEntry 新增字段

```typescript
type WebQuickOpenEntry = {
  // ...现有字段
  matchPattern?: string  // 可选正则，匹配时跳过 collect-input 直接打开
}
```

- `matchPattern` 为空或未配置 → 保持现有 collect-input 流程
- `matchPattern` 配置了有效正则且输入匹配 → 产出 perform 类型 dy item

## Dynamic Item 逻辑

### A. 正则匹配 → 一步打开

在 `buildDynamicLauncherItems` 中新增逻辑：
1. 遍历所有 entry，找到有 `matchPattern` 的
2. 用 `new RegExp(entry.matchPattern)` 测试 `ctx.query`
3. 匹配 → 生成 `behavior: { type: 'perform' }` 的 dy item
4. execute 时整个 query 作为 `{query}` 拼 URL → `openUrl`

### B. URL 直接打开（兜底）

不依赖 entry，纯判断输入：
1. `/^https?:\/\//i` 测试 ctx.query
2. 匹配 → 生成"直接打开链接" dy item（perform 类型）
3. execute 时 `openUrl(query.trim())`

### 优先级

正则匹配的 entry > URL 直接打开（兜底）

## Favicon 缓存

### 拉取

- 从 URL/urlTemplate 提取域名
- 拉取 `https://www.google.com/s2/favicons?domain=${domain}&sz=32`

### 缓存

- 使用 plugin blob storage
- blob key 格式自动生成，kv 中记录 `favicon-map/<domain>` → `{ blobId, fetchedAt }`
- 过期策略：30 天后重新拉取
- 拉取失败 fallback 到 Lucide icon `Globe`

### 展示

- dy item 的 `display.icon` 设为 `plugin-blob:builtin:web-open:{blobId}`
- 框架 resolveIcon 自动渲染为 `<img>`

## Settings UI 变更

在 entry 的 object-list fields 中新增：

```typescript
{
  kind: 'text',
  key: 'matchPattern',
  label: 'Quick match pattern',
  labelI18n: { zh: '快捷匹配正则' },
  description: 'When input matches this regex, open directly without secondary input.',
  descriptionI18n: { zh: '输入匹配该正则时，跳过二次输入直接打开。' },
  placeholder: '^\\d{9}$',
  placeholderI18n: { zh: '^\\d{9}$' },
  mono: true,
}
```

## Manifest 变更

permissions 新增 `storage.blob`（用于缓存 favicon）。

## 实施任务

1. model.ts — 类型 + 默认值 + migration
2. index.tsx — dynamic item 逻辑（正则匹配 + URL 直开）
3. favicon 缓存模块 — 拉取 + blob 存储 + 过期判断
4. settings schema — 新增 matchPattern 字段
5. locales — 补 i18n
6. manifest — 补 permission
