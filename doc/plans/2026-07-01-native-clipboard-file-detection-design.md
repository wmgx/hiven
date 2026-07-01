# 原生剪贴板文件检测

> 移除正则路径猜测，改用 macOS 原生 pasteboard 类型做确定性的内容识别。

## 动机

当前 `pluginClipboard.ts` 的文件识别靠 `extractFilePaths()` 正则匹配——把"长得像路径的文本"猜成文件。问题：

1. **假阳性**：日志里的 `/var/log/xxx.log` 被当成文件
2. **假阴性**：Finder 复制文件如果 OS 没附带纯文本路径，就识别不到
3. **语义混淆**："复制文件"和"复制路径文本"是两件事，不该混为一谈

## 设计决策

| 决策 | 结论 |
|------|------|
| 类型模型 | 保持 `text \| image \| files` 三种，不加 rich text / url |
| 优先级 | `files > image > text` |
| 路径文本 | fallback 到 text，不再特殊处理 |
| 富文本/HTML/URL | 全部 fallback 到 text（天然格式过滤） |
| 统一接口 | Rust 侧提供单一 command，一次调用返回类型+内容 |

## 架构

```
┌─────────────────────────────────────────────────┐
│  前端 watcher (pluginClipboard.ts)              │
│  轮询调用 read_clipboard_content                 │
└──────────────────────┬──────────────────────────┘
                       │ invoke
                       ▼
┌─────────────────────────────────────────────────┐
│  Rust: read_clipboard_content command           │
│                                                 │
│  1. 读 NSPasteboard availableTypes              │
│  2. 按优先级判断：                                │
│     has public.file-url  → files                │
│     has image (tiff/png) → image                │
│     otherwise            → text                 │
│  3. 返回 { kind, payload }                      │
└─────────────────────────────────────────────────┘
```

## Rust Command 设计

### 返回类型

```rust
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum ClipboardContent {
    Files { paths: Vec<String> },
    Image,  // 图片仍由前端通过 tauri-plugin-clipboard-manager 的 readImage 读取
    Text { text: String },
    Empty,
}
```

### 实现要点

```rust
#[tauri::command]
fn read_clipboard_content() -> ClipboardContent {
    // macOS: 通过 objc2 读 NSPasteboard
    let pb = NSPasteboard::generalPasteboard();
    let types = pb.types();  // 获取所有可用类型

    // 优先级 1: 文件
    if types.contains("public.file-url") {
        let urls = pb.readObjectsForClasses([NSURL], ...);
        let paths = urls.filter(|u| u.isFileURL()).map(|u| u.path());
        if !paths.is_empty() {
            return ClipboardContent::Files { paths };
        }
    }

    // 优先级 2: 图片
    if types.contains("public.tiff") || types.contains("public.png") {
        return ClipboardContent::Image;
    }

    // 优先级 3: 文本（兜底）
    if let Some(text) = pb.stringForType("public.utf8-plain-text") {
        return ClipboardContent::Text { text };
    }

    ClipboardContent::Empty
}
```

### 为什么 Image 不直接带数据？

图片二进制通过 Tauri command 返回要做 base64 编码，开销大。保持现有 `readImage()` 路径：Rust 告诉前端"是图片"，前端再通过 `@tauri-apps/plugin-clipboard-manager` 的 `readImage()` 拿 RGBA 数据。

## 前端改动

### pluginClipboard.ts

**删除：**
- `extractFilePaths()` 函数
- `fileNameForPath()` 函数（移到工具函数或内联到 files 分支）

**修改 watcher 轮询逻辑：**

```typescript
// Before: 分别 readText + readImage + 正则判断
// After:
const content = await invoke<ClipboardContent>('read_clipboard_content')

switch (content.kind) {
  case 'files':
    // 直接用 content.paths，不需要猜
    onChange({ kind: 'files', paths: content.paths, ... })
    break
  case 'image':
    // 走现有 readImage 逻辑拿图片数据
    const image = await readClipboardImageSnapshot()
    onChange({ kind: 'image', ... })
    break
  case 'text':
    // 直接用 content.text
    onChange({ kind: 'text', text: content.text, ... })
    break
  case 'empty':
    break
}
```

**变更检测：**

仍用 hash 对比检测变化。改为对 `read_clipboard_content` 的返回值整体做 hash：
- files: hash paths 拼接
- image: 保持现有 RGBA hash
- text: hash text

或者更简单——直接用 Rust 侧的 `changeCount`：先比较 changeCount 是否变化，变了再调 `read_clipboard_content` 读内容。这样大多数轮询周期只需一次轻量 IPC。

### writeFiles

现有 `writeFiles` 也需要改——当前只是把路径写成文本，应该写成 `public.file-url` 格式：

```rust
#[tauri::command]
fn write_clipboard_files(paths: Vec<String>) {
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    let urls: Vec<NSURL> = paths.iter()
        .map(|p| NSURL::fileURLWithPath(p))
        .collect();
    pb.writeObjects(&urls);
}
```

## 不变的部分

| 模块 | 说明 |
|------|------|
| `ClipboardChange` 类型 | kind 仍是 `text \| image \| files`，结构不变 |
| `clipboardHistoryTypes.ts` | 数据模型不变 |
| `clipboardHistoryBackground.ts` | 按 kind 分发逻辑不变 |
| `clipboardHistoryRepository.ts` | 存储逻辑不变 |
| 图片读取 | 仍通过 `readImage()` 获取 RGBA |
| 权限模型 | 不变 |

## 平台兼容

| 平台 | 文件检测方式 |
|------|-------------|
| macOS | `NSPasteboard` → `public.file-url` |
| Windows | 未来可扩展：`CF_HDROP` 格式 |
| Linux | 未来可扩展：`text/uri-list` |
| Web fallback | 不支持文件检测，全部当 text |

当前只实现 macOS。其他平台 `read_clipboard_content` 返回 text fallback。

## 优化：changeCount 前置

```
轮询 tick
  → invoke('read_clipboard_change_count')
  → 没变？跳过
  → 变了？invoke('read_clipboard_content') → 处理
```

这样 90%+ 的轮询只做一次轻量整数比较，不读剪贴板内容。

## 实施步骤

1. Rust: 实现 `read_clipboard_content` command（macOS，其他平台 fallback）
2. Rust: 实现 `write_clipboard_files` command
3. 前端: 重写 watcher 轮询逻辑，调用统一接口
4. 前端: 删除 `extractFilePaths` 和相关正则
5. 前端: `writeFiles` 改为调用原生 command
6. 验证: Finder 复制文件 → 正确识别为 files
7. 验证: 复制路径文本 → 识别为 text（不再猜成 files）
