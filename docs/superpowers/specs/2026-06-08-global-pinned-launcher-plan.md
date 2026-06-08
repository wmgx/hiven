# 全局固定命令启动器实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 增加可配置的系统级 pinned-only 启动器快捷键，支持普通组合键和 macOS 当前系统下的 Double Cmd。
**架构:** 前端复用 `GlobalLauncher` 并增加 mode；设置持久化单一快捷键配置；普通组合键走 Tauri global-shortcut 插件；Double Cmd 走 Rust/macOS 系统事件监听；所有触发源统一打开 pinned-only launcher。
**技术栈:** React、Zustand persist、Tauri 2、Rust、macOS event tap、现有 Node verifier scripts。

---

## 职责边界

- 测试 agent：只新增或修改验证脚本、Rust 单测和测试期望，先确认失败原因是能力缺失。
- 实现 agent：只修改生产代码和依赖配置，使失败测试转绿；不得削弱测试断言。
- 主 agent / 验收 agent：复核实现是否符合设计，执行最终验证并总结风险。

当前平台未获得显式 sub-agent 授权时，不执行代码实现；如用户授权多 agent，再按上述职责拆分执行。

---

### Task 1: pinned-only launcher 前端测试

**Files:**
- Create: `scripts/test-global-pinned-launcher.mjs`
- Modify: `package.json`

**Step 1: 写失败的测试**
新增 verifier，断言：
- `package.json` 暴露 `test:global-pinned-launcher`。
- `src/components/GlobalLauncher.tsx` 支持 `GlobalLauncherMode` 或等价 mode。
- pinned-only 模式只构造 `pinnedActions`，不包含 `recentActionNames` 和 `viewItems`。
- 选择 pinned 项调用 `openPinnedAction`。
- `App.tsx` 存在系统事件监听入口，触发时打开 pinned-only mode。

**Step 2: 运行测试确认失败**
Run: `npm run test:global-pinned-launcher`
Expected: FAIL，原因是测试脚本或 mode 能力尚不存在。

**Step 3: 写最小实现**
暂不实现生产代码，本任务只建立失败测试。

**Step 4: 运行测试确认失败**
Run: `npm run test:global-pinned-launcher`
Expected: FAIL，失败点指向缺失的 pinned-only mode。

---

### Task 2: 实现 GlobalLauncher mode 和系统事件入口

**Files:**
- Modify: `src/store.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/GlobalLauncher.tsx`

**Step 1: 使用 Task 1 的失败测试**
Run: `npm run test:global-pinned-launcher`
Expected: FAIL

**Step 2: 写最小实现**
- 在 store 中把 launcher 状态从 boolean 扩展为 `{ open, mode }`，或保留 boolean 并新增 `globalLauncherMode`。
- `setGlobalLauncherOpen` 兼容现有调用；新增 `openGlobalLauncher(mode)`。
- `App.tsx` 的应用内 `Cmd/Ctrl+Shift+K` 继续打开 full mode。
- `App.tsx` 监听 Tauri emit 事件，例如 `fluxtext://open-pinned-launcher`，收到后打开 pinned-only mode。
- `GlobalLauncher` 根据 mode 过滤列表；pinned-only 不显示 recent/views。

**Step 3: 运行测试确认通过**
Run: `npm run test:global-pinned-launcher`
Expected: PASS

---

### Task 3: 快捷键配置模型和设置页测试

**Files:**
- Create: `scripts/test-global-hotkey-settings.mjs`
- Modify: `package.json`

**Step 1: 写失败的测试**
新增 verifier，断言：
- `settings` 包含单一 `globalPinnedLauncherShortcut` 配置。
- 配置支持 `accelerator`、`double-modifier`、`disabled`。
- `SettingsView` 展示 Hotkeys 卡片、录制/选择 Double Cmd/禁用入口、注册状态。
- i18n 包含中英文文案。

**Step 2: 运行测试确认失败**
Run: `npm run test:global-hotkey-settings`
Expected: FAIL，原因是配置和设置 UI 尚不存在。

---

### Task 4: 实现快捷键设置持久化和 UI

**Files:**
- Modify: `src/store.ts`
- Modify: `src/views/SettingsView.tsx`
- Modify: `src/i18n/locales/settings.ts`

**Step 1: 使用 Task 3 的失败测试**
Run: `npm run test:global-hotkey-settings`
Expected: FAIL

**Step 2: 写最小实现**
- 增加 `GlobalPinnedLauncherShortcut` 类型和默认值。
- 设置页新增 Hotkeys 卡片。
- 实现普通组合键录制：忽略单独字母，保存包含修饰键的 accelerator。
- 实现 Double Cmd 选择和禁用。
- 展示当前注册状态和错误信息字段。

**Step 3: 运行测试确认通过**
Run: `npm run test:global-hotkey-settings`
Expected: PASS

---

### Task 5: Tauri 普通组合键注册

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Create: `src/hotkeys/globalPinnedLauncher.ts`

**Step 1: 写失败的测试**
扩展 `scripts/test-global-hotkey-settings.mjs`，断言：
- 依赖包含 `@tauri-apps/plugin-global-shortcut` 和 `tauri-plugin-global-shortcut`。
- Tauri app 注册 global shortcut 插件。
- capability 允许 global shortcut register/unregister。
- 前端存在快捷键注册协调模块。

**Step 2: 运行测试确认失败**
Run: `npm run test:global-hotkey-settings`
Expected: FAIL

**Step 3: 写最小实现**
- 安装 Tauri global shortcut 前后端依赖。
- 在 Rust app builder 注册插件。
- 在 capability 中加入最小权限。
- 前端模块监听 settings 变化：注销旧 accelerator，注册新 accelerator，命中后 focus 窗口并打开 pinned-only launcher。

**Step 4: 运行测试确认通过**
Run: `npm run test:global-hotkey-settings`
Expected: PASS

---

### Task 6: macOS Double Cmd 判定测试

**Files:**
- Create: `src-tauri/src/hotkeys.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: 写失败的 Rust 单测**
在 `hotkeys.rs` 中先定义或期望一个纯状态机，覆盖：
- 两次独立 Meta 点击在阈值内触发。
- 超过阈值不触发。
- 中途夹杂其他键不触发。
- Meta 与其他键组合不触发。

**Step 2: 运行测试确认失败**
Run: `cargo test --manifest-path src-tauri/Cargo.toml double_cmd -- --test-threads=1`
Expected: FAIL，原因是状态机尚未实现。

---

### Task 7: 实现 macOS Double Cmd 监听

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/hotkeys.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/hotkeys/globalPinnedLauncher.ts`

**Step 1: 使用 Task 6 的失败测试**
Run: `cargo test --manifest-path src-tauri/Cargo.toml double_cmd -- --test-threads=1`
Expected: FAIL

**Step 2: 写最小实现**
- 实现可单测的 `DoubleCmdDetector` 状态机。
- macOS 下启动 event tap 监听 Command 键事件。
- 命中后 emit `fluxtext://open-pinned-launcher`。
- 提供 Tauri commands：注册当前快捷键、注销监听、返回状态。
- 非 macOS 或监听失败返回明确错误，不吞错。

**Step 3: 运行测试确认通过**
Run: `cargo test --manifest-path src-tauri/Cargo.toml double_cmd -- --test-threads=1`
Expected: PASS

---

### Task 8: 集成验证和回归

**Files:**
- Modify as needed only if tests expose integration gaps.

**Step 1: 运行前端 verifier**
Run: `npm run test:global-pinned-launcher`
Expected: PASS

Run: `npm run test:global-hotkey-settings`
Expected: PASS

**Step 2: 运行既有相关 verifier**
Run: `npm run test:pinned-plugin-command`
Expected: PASS

Run: `npm run test:pinned-persistence-settings`
Expected: PASS

**Step 3: 运行构建检查**
Run: `npm run lint`
Expected: PASS

Run: `npm run build`
Expected: PASS

Run: `cargo test --manifest-path src-tauri/Cargo.toml double_cmd -- --test-threads=1`
Expected: PASS

**Step 4: 手工验收**
- 设置为 Double Cmd，应用失焦后双击 Cmd，窗口被唤起并显示 pinned-only launcher。
- 设置为普通组合键，应用失焦后组合键唤起 pinned-only launcher。
- 选择一个 pinned 命令，切换到对应 pinned runner。
- full mode launcher 仍显示 pinned/recent/views。
