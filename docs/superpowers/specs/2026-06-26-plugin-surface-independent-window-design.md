# Plugin Surface 独立窗口设计

> Phase 0：让通过全局快捷键打开的插件 surface 在独立窗口中渲染

## 背景问题

当前所有插件 surface 渲染在 GlobalLauncher 窗口内部，共享一个 `surfaceFrame` slot。
当用户在翻译插件页面工作时，按快捷键打开剪贴板历史会覆盖翻译 surface，丢失工作现场。

## 核心决策

| 决策点 | 结论 |
|--------|------|
| 打开方式决定展示位置 | launcher 打开 → launcher 内渲染；快捷键打开 → 独立窗口 |
| 窗口生命周期 | 失焦隐藏 + 超时销毁 + 激活重置计时器 |
| 文本回传方式 | 走系统剪贴板 + simulate_paste，不引入 active context 协议 |
| 窗口实例策略 | 插件可配（instancePolicy），Phase 0 先只支持 singleton |
| 窗口渲染技术 | 新 WebviewWindow + URL 参数识别 |
| 窗口外观 | 无标题栏、圆角、Spotlight 居中定位（视觉与 launcher 一致） |
| 窗口激活模式 | 普通激活窗口（非 NonActivating Panel），打开时成为前台 |
| 超时时间 | 插件可配（destroyTimeout），默认 2 分钟 |
| 快捷键行为 | 只激活，不 toggle。关闭用 Esc |
| launcher 内 surface | Phase 0 不改变其生命周期 |

## 类型扩展

### surface 级别（固有属性）

```ts
type PluginUiSurfaceContribution<TSettings> = {
  // ... 现有字段
  instancePolicy?: 'singleton' | 'multi'  // 默认 'singleton'
  shell?: {
    // ... 现有字段 (defaultWidth, defaultHeight, closeOnBlur, resizable)
    destroyTimeout?: number  // ms，失焦隐藏后多久销毁窗口，默认 120000
  }
}
```

### entry 级别（入口决定展示方式）

```ts
type SurfaceEntry = {
  launcher?: boolean
  shortcutBindable?: boolean
  recommendedShortcut?: string
  shortcutPresentation?: 'launcher' | 'window'  // 默认 'launcher'
}
```

### 使用示例

```ts
// clipboard-history 插件
entry: {
  launcher: true,
  shortcutBindable: true,
  recommendedShortcut: 'CmdOrCtrl+Shift+V',
  shortcutPresentation: 'window',
}
```

## 快捷键路径改造

```
用户按快捷键 → 读取 surface 声明
  ├─ shortcutPresentation === 'launcher'（或未设置）
  │    → 现有流程不变（requestOpenPluginSurfaceTool）
  │
  └─ shortcutPresentation === 'window'
       → requestOpenPluginSurfaceWindow(target)
         → 检查是否已有该 surface 的窗口（singleton）
         ├─ 有：show + focus 已有窗口，重置 destroyTimer
         └─ 无：创建新 WebviewWindow
              URL: index.html?window=plugin-surface&source={}&pluginId={}&surfaceId={}
              窗口配置：无标题栏、圆角、从 shell 读取尺寸
              定位：Spotlight 风格居中
```

## Rust 侧实现

### 新增 Command

```rust
#[tauri::command]
async fn show_plugin_surface_window(
    app: AppHandle,
    plugin_id: String,
    surface_id: String,
    source: String,
    width: f64,
    height: f64,
    close_on_blur: bool,
    destroy_timeout_ms: u64,
) -> Result<(), String>
```

### 窗口生命周期管理

- 窗口 label: `plugin-surface:{source}:{plugin_id}:{surface_id}`
- 已存在 → `show()` + `set_focus()` + 取消 destroyTimer
- 不存在 → 创建 WebviewWindow + 设置大小 + 居中
- 失焦（close_on_blur=true）→ `hide()` + 启动 destroyTimer
- destroyTimer 到期 → `window.destroy()`
- 快捷键只激活，不 toggle

## 前端渲染

### 入口路由

```ts
const params = new URLSearchParams(window.location.search)
if (params.get('window') === 'plugin-surface') {
  root.render(<PluginSurfaceWindow />)
} else if (params.get('window') === 'launcher') {
  root.render(<GlobalLauncher />)
} else {
  root.render(<App />)
}
```

### PluginSurfaceWindow 组件

职责：
1. 从 URL 解析 source、pluginId、surfaceId
2. 从 pluginRegistry 获取 pluginDefinition 和 surface
3. 创建 storage/clipboard/paste/network API 实例
4. 调用 surface.beforeOpen
5. 渲染 surface component（包裹 ErrorBoundary + PermissionGate）
6. Esc → 调用 Rust 侧 hide
7. 窗口拖拽区域

## 附带修复：launcher closeOnBlur 尊重

当前 GlobalLauncher.tsx 行 404-405 无条件失焦关闭。修复为：

```ts
if (!focused) {
  const currentSurfaceCloseOnBlur = activeSurfaceFrame?.surface.shell?.closeOnBlur
  if (currentSurfaceCloseOnBlur !== false) {
    closeLauncher()
  }
}
```

## 交互行为总结

| 行为 | 说明 |
|------|------|
| 快捷键打开 | 创建/显示独立窗口，窗口激活为前台 |
| 快捷键重复按 | 窗口已显示 → 无操作；已隐藏 → show + 取消 timer |
| Esc | hide 窗口（不销毁），启动 destroyTimer |
| 失焦（closeOnBlur=true）| hide 窗口，启动 destroyTimer |
| 失焦（closeOnBlur=false）| 无操作，窗口保持显示 |
| destroyTimer 到期 | Rust 侧 destroy 窗口 |
| 剪贴板历史选中 | 写入系统剪贴板 + simulate_paste 到前台应用 |

## 文件改动清单

### 新增

| 文件 | 职责 |
|------|------|
| `src/workspace/pluginSurfaceWindows.ts` | 独立窗口管理逻辑 |
| `src/components/PluginSurfaceWindow.tsx` | 独立窗口 React 渲染组件 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/workspace/pluginTypes.ts` | 新增 instancePolicy、destroyTimeout、shortcutPresentation |
| `src/workspace/pluginSurfaceShortcuts.ts` | 分叉逻辑 |
| `src/components/GlobalLauncher.tsx` | 修复 closeOnBlur 尊重 |
| `src-tauri/src/lib.rs` | 新增 show_plugin_surface_window command |
| `src/main.tsx` | 新增 ?window=plugin-surface 路由 |
| `src/plugins/clipboard-history/index.tsx` | 添加 shortcutPresentation: 'window' |

## 实现顺序

1. 类型扩展（pluginTypes.ts）
2. Rust command（lib.rs）
3. 前端窗口管理模块（pluginSurfaceWindows.ts）
4. 快捷键分叉（pluginSurfaceShortcuts.ts）
5. 窗口渲染组件（PluginSurfaceWindow.tsx）
6. 入口路由（main.tsx）
7. launcher closeOnBlur 修复
8. clipboard-history 插件声明更新
9. 集成验证

## 范围限定（Phase 0 不做）

- active context / receiveText 协议
- Window Manager 独立模块
- Surface stack（launcher 内多 surface 共存）
- instancePolicy: 'multi' 实现
- 插件之间 host 编排合作
- 编辑器作为 first-party plugin surface

## 长期演进方向

```
Phase 0: 独立窗口（解决冲突问题）← 本文档
Phase 1: active context + receiveText 协议（智能文本回传）
Phase 2: 从 GlobalLauncher 抽出 SurfaceHost 组件
Phase 3: Window Manager 独立模块 + multi-instance
Phase 4: Launcher Kernel 独立（search/ranking 解耦 UI）
Phase 5: 编辑器作为 first-party plugin surface
```
