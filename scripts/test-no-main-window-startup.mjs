#!/usr/bin/env node
/**
 * Phase 3 no-main-window startup contract.
 *
 * Static checks only. This script verifies the app can boot into the hidden
 * launcher/background-safe path without a visible/default legacy main window.
 */
import { readFileSync } from 'node:fs'

const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function readJson(path) {
  return JSON.parse(read(path))
}

function objectBlockAround(source, marker) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return ''

  const start = source.lastIndexOf('{', markerIndex)
  if (start < 0) return ''

  let depth = 0
  let inString = false
  let quote = ''
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === quote) {
        inString = false
        quote = ''
      }
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = true
      quote = char
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }

  return ''
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start)
  if (end < 0) return ''
  return source.slice(start, end)
}

function checkGlobalLauncherAction(source, marker, label) {
  const block = objectBlockAround(source, marker)
  check(block.length > 0, `${label} 必须存在 launcher action/surface 入口`)
  check(/surfaces:\s*\[[^\]]*['"]global-launcher['"][^\]]*\]/.test(block), `${label} 必须暴露到 global-launcher surface`)
  check(!/setActiveView\s*\(/.test(block), `${label} launcher 入口不能直接依赖 ViewId/setActiveView 主导航`)
  check(!/Sidebar/.test(block), `${label} launcher 入口不能依赖 Sidebar`)
}

const packageJson = readJson('package.json')
const tauriConfig = readJson('src-tauri/tauri.conf.json')
const appSource = read('src/App.tsx')
const storeSource = read('src/store.ts')
const sidebarSource = read('src/components/Sidebar.tsx')
const hostActionsSource = read('src/workspace/launcher/hostActions.ts')
const registrySource = read('src/workspace/launcher/registry.ts')
const launcherWindowAppSource = sliceBetween(appSource, 'function LauncherWindowApp', '\nfunction shouldAllowLauncherListWheel')
const openLauncherSource = sliceBetween(launcherWindowAppSource, 'const openLauncher', '\n    openLauncher()')
const openPluginSurfaceSource = sliceBetween(launcherWindowAppSource, "listen('hiven://open-plugin-surface'", '\n      }))')
const rustSources = [
  read('src-tauri/src/main.rs'),
  read('src-tauri/src/lib.rs'),
].join('\n')

check(
  packageJson.scripts?.['test:no-main-window-startup'] === 'node scripts/test-no-main-window-startup.mjs',
  'package.json 必须暴露 test:no-main-window-startup 脚本',
)

// 1. Native startup must not create a visible/default legacy main window.
const windows = tauriConfig.app?.windows ?? []
const mainWindow = windows.find((window) => window.label === 'main')
check(
  !mainWindow || mainWindow.visible === false || /\?window=(?:editor|launcher|background)/.test(String(mainWindow.url ?? '')),
  'tauri.conf.json 不能包含 visible/default 的 main 初始窗口；main 必须移除、延迟创建，或显式不可见',
)
check(
  !mainWindow || mainWindow.visible === false,
  '如果 tauri.conf.json 仍声明 main 窗口，必须显式 visible:false，避免启动时显示 legacy MainApp',
)

// 2. Hidden launcher window must remain the boot-time resident window.
const launcherWindow = windows.find((window) => window.label === 'launcher')
check(Boolean(launcherWindow), 'tauri.conf.json 必须保留 launcher window')
check(launcherWindow?.visible === false, 'launcher window 必须保持 visible:false')
check(String(launcherWindow?.url ?? '') === 'index.html?window=launcher', 'launcher window 必须使用 index.html?window=launcher 路由')
check(launcherWindow?.skipTaskbar === true, 'launcher window 必须保持 skipTaskbar:true')
check(launcherWindow?.focus === false, 'launcher window 必须保持 focus:false，避免启动抢焦点')

// 3. No-query app route must not fall back to legacy MainApp.
check(!/return\s+<MainApp\s*\/>/.test(appSource), 'App 路由不能在无 ?window= 时默认进入 legacy MainApp')
check(
  /new\s+URLSearchParams\(window\.location\.search\)\.get\(['"]window['"]\)/.test(appSource),
  'App 路由必须继续显式解析 ?window=，避免隐式主窗口入口',
)
check(
  /function\s+LauncherWindowApp\s*\(/.test(appSource),
  'App 必须保留 launcher/background-safe 渲染路径',
)
check(
  launcherWindowAppSource.length > 0,
  '必须能静态定位 LauncherWindowApp resident 启动路径',
)
check(
  openLauncherSource.length > 0,
  'LauncherWindowApp 必须定义 hiven://launcher-open/openLauncher 处理器',
)
check(
  /openGlobalLauncherOverlay\(/.test(openLauncherSource),
  '普通 launcher-open/show_launcher_window 路径必须打开 GlobalLauncher',
)
check(
  !/openGlobalLauncherOverlay\(\s*['"]pinned-only['"]\s*\)/.test(openLauncherSource),
  '普通 launcher-open/show_launcher_window 路径不能固定为 pinned-only；插件 surface 请求才可以使用 pinned-only',
)
check(
  /openGlobalLauncherOverlay\(\s*['"]pinned-only['"]\s*\)/.test(openPluginSurfaceSource),
  'hiven://open-plugin-surface 路径可以继续使用 pinned-only 打开插件 surface tool-shell',
)
check(
  /installGlobalPinnedLauncherHotkeys\s*\(\s*\)/.test(launcherWindowAppSource),
  'LauncherWindowApp resident 启动路径必须安装 global pinned launcher hotkeys',
)
check(
  /installPluginSurfaceShortcutHotkeys\s*\(\s*\)/.test(launcherWindowAppSource),
  'LauncherWindowApp resident 启动路径必须安装 plugin surface shortcut hotkeys',
)

// 4. Settings / Plugins / Plugin editor must be reachable through launcher items.
checkGlobalLauncherAction(hostActionsSource, "systemKey: 'host:view:settings'", 'Settings')
checkGlobalLauncherAction(hostActionsSource, "systemKey: 'host:view:plugins'", 'Plugins')
checkGlobalLauncherAction(
  hostActionsSource + '\n' + registrySource,
  "systemKey: 'host:view:plugin-editor'",
  'Plugin editor',
)
check(
  /plugin-settings:[^`'"]*\$\{settingsSource\}[^`'"]*\$\{pluginId\}|plugin-settings:\$\{settingsSource\}:\$\{pluginId\}/.test(registrySource),
  '插件设置必须有 global-launcher settings item 入口',
)
check(
  /presentation:\s*['"]global-launcher['"]/.test(registrySource),
  '插件设置入口必须支持 global-launcher presentation',
)

// 5. Sidebar/ViewContent/ViewId must not be runtime entry dependencies.
check(
  !mainWindow || mainWindow.visible === false,
  '运行时启动配置不能依赖 visible/default 的 label=main 入口窗口',
)
check(
  !/get_webview_window\(["']main["']\)/.test(rustSources),
  'Rust 运行时不能依赖 get_webview_window("main") 作为主入口',
)
check(
  !/return\s+<MainApp\s*\/>/.test(appSource) || !/function\s+ViewContent\s*\(/.test(appSource),
  'ViewContent/ViewId 不能通过默认 MainApp fallback 成为运行时主入口',
)
check(
  !/const\s+navItems:\s*\{\s*id:\s*ViewId/.test(sidebarSource) || !/return\s+<MainApp\s*\/>/.test(appSource),
  'Sidebar/ViewId 主导航不能挂在无 ?window= 默认启动路径上',
)
check(
  !/export\s+type\s+ViewId\s*=/.test(storeSource) || !/return\s+<MainApp\s*\/>/.test(appSource),
  'ViewId 可以保留为内部状态，但不能是无 ?window= 启动入口依赖',
)

// 6. Closing all windows must not exit the app; launcher/background resident
// process should survive until an explicit quit path.
const preventsExit = [
  /RunEvent::ExitRequested[\s\S]{0,240}prevent_exit\s*\(/,
  /api\.prevent_exit\s*\(/,
  /WindowEvent::CloseRequested[\s\S]{0,240}prevent_close\s*\(/,
  /on_window_event[\s\S]{0,360}CloseRequested[\s\S]{0,240}(?:hide|prevent_close)/,
].some((pattern) => pattern.test(rustSources))
check(
  preventsExit,
  'Rust/配置必须静态体现关闭所有窗口不退出 app：需要 prevent_exit 或 close handling',
)

if (failures.length > 0) {
  console.error('✗ no-main-window startup contract failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('✓ test-no-main-window-startup passed')
