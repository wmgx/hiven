#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const files = {
  packageJson: read('package.json'),
  store: read('src/store.ts'),
  app: read('src/App.tsx'),
  globalPinnedHotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  surfaceHotkeys: read('src/hotkeys/pluginSurfaceShortcuts.ts'),
  surfaceShortcutStore: read('src/workspace/pluginSurfaceShortcuts.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  clipboardHistory: read('src/plugins/clipboard-history/index.tsx'),
  surfaceOpenRequest: read('src/workspace/pluginSurfaceOpenRequest.ts'),
  launcherWindowManager: read('src/workspace/windowManager/launcherWindow.ts'),
  globalLauncher: read('src/launcher/hosts/GlobalLauncherHost.tsx') + '\n' + read('src/components/launcher/GlobalLauncherSurfaceFrame.ts'),
  globalLauncherFrames: read('src/components/launcher/GlobalLauncherFrames.tsx'),
  globalLauncherPluginSurfaceFrame: read('src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx'),
  globalLauncherLayout: read('src/components/launcher/GlobalLauncherLayout.ts'),
  pluginSurfaceWindow: read('src/components/PluginSurfaceWindow.tsx'),
  pluginSurfaceRenderer: read('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  scriptsView: read('src/views/ScriptsView.tsx') + '\n' + read('src/surfaces/PluginsManagerSurfaceContent.tsx'),
  scriptsI18n: read('src/i18n/locales/scripts.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:plugin-surface-shortcuts'],
  'node scripts/test-plugin-surface-shortcuts.mjs',
  'package.json must expose test:plugin-surface-shortcuts',
)

assert.match(files.store, /PluginSurfaceOpenTarget/, 'store must model a plugin surface open target')
assert.match(files.store, /pluginSurfaceToolTarget/, 'store must keep the active tool-shell surface target')

assert.match(files.surfaceShortcutStore, /pluginSurfaceShortcutKey\(target/, 'surface shortcut store must key by source/pluginId/surfaceId')
assert.match(files.store, /source: 'builtin' \| 'installed' \| 'dev'/, 'surface shortcut target must preserve plugin source')
assert.match(files.surfaceShortcutStore, /registrationStatus/, 'surface shortcut store must persist registration status')
assert.match(files.surfaceShortcutStore, /clearPluginShortcuts/, 'surface shortcut store must clear all shortcuts for an uninstalled plugin')

assert.match(files.surfaceOpenRequest, /showLauncherWindow\(\)/, 'surface open request must show the launcher/tool shell window through the window manager')
assert.match(files.surfaceOpenRequest, /resizeCurrentLauncherWindow\(\{/, 'surface open request must pre-size launcher through the window manager')
assert.doesNotMatch(files.surfaceOpenRequest, /getCurrentWindow\(\)\.setSize|new LogicalSize/, 'surface open request must not resize the Tauri window directly')
assert.match(files.launcherWindowManager, /show_launcher_window/, 'launcher window manager must call the native show launcher command')
assert.match(files.launcherWindowManager, /resizeCurrentLauncherWindow[\s\S]*setSize\(new LogicalSize/, 'launcher window manager must own launcher window resizing')
assert.match(files.surfaceOpenRequest, /hiven:\/\/open-plugin-surface/, 'surface open request must emit the open surface event')
assert.match(files.surfaceOpenRequest, /localStorage\.setItem/, 'surface open request must persist a pending target for newly created launcher windows')

assert.match(files.app, /installPluginSurfaceShortcutHotkeys/, 'app must import plugin surface shortcut hotkeys')
assert.match(
  files.app,
  /function LauncherRuntimeApp[\s\S]*installPluginSurfaceShortcutHotkeys\(\)/,
  'launcher runtime must install plugin surface shortcut hotkeys because launcher is the default runtime window',
)
assert.match(files.app, /consumePendingPluginSurfaceOpenTarget/, 'launcher window must consume pending surface open targets')
assert.match(files.app, /hiven:\/\/open-plugin-surface/, 'launcher window must listen for plugin surface open events')
assert.match(files.app, /function LauncherRuntimeApp[\s\S]*<PluginSettingsDialog \/>/, 'launcher runtime must render plugin settings dialogs opened from a surface')
assert.match(
  files.tauriLib,
  /show_and_focus_plugin_surface_window\(&app,\s*&window\)/,
  'plugin surface window command must show and focus the window',
)
assert.match(
  files.tauriLib,
  /fn show_and_focus_plugin_surface_window[\s\S]*demote_launcher_level[\s\S]*window\.show\(\)[\s\S]*set_focus\(\)/,
  'plugin surface window helper must demote launcher level then show and focus',
)
assert.match(
  files.tauriLib,
  /fn restore_launcher_level[\s\S]*STATUS_WINDOW_LEVEL/,
  'launcher level must be restored after plugin surface window closes',
)
assert.doesNotMatch(
  files.tauriLib.match(/async fn show_plugin_surface_window[\s\S]*?\n}\n\nfn plugin_surface_window_label/)?.[0] ?? '',
  /always_on_top|setLevel|orderFrontRegardless|promote_plugin_surface/,
  'plugin surface window command must not force window level — let macOS focus-based ordering handle it',
)
assert.doesNotMatch(
  files.tauriLib.match(/async fn show_plugin_surface_window[\s\S]*?\n}\n\nfn plugin_surface_window_label/)?.[0] ?? '',
  /get_webview_window\("launcher"\)[\s\S]*\.hide\(\)/,
  'plugin surface window command must not hide the launcher because it may host another active surface',
)
const surfaceShellType =
  files.pluginTypes.match(/export type PluginSurfaceShell = \{[\s\S]*?\n\}/)?.[0] ?? ''
assert.match(
  surfaceShellType,
  /rendersTitlebar\?:\s*boolean/,
  'plugin surface shell protocol must allow plugins to declare that they render their own titlebar',
)
assert.match(
  files.clipboardHistory,
  /id:\s*'main'[\s\S]*?shell:\s*\{[\s\S]*?rendersTitlebar:\s*true/,
  'clipboard history main surface should declare that it renders its own titlebar',
)
assert.match(
  files.pluginSurfaceWindow,
  /usePluginSurfaceRendersTitlebar\(target\)/,
  'plugin surface window should read shell.rendersTitlebar for host chrome decisions',
)
const hostTitlebarBranch =
  files.pluginSurfaceWindow.match(/!\s*usesPluginTitlebar\s*&&\s*\(([\s\S]*?)\n\s*\)\}/)?.[1] ?? ''
assert.match(
  hostTitlebarBranch,
  /plugin-surface-window-titlebar/,
  'host titlebar should remain available when the plugin does not render its own titlebar',
)
assert.match(
  hostTitlebarBranch,
  /plugin-surface-window-close/,
  'host titlebar and close button should render only when the plugin does not render its own titlebar',
)
assert.match(
  files.pluginSurfaceWindow,
  /document\.addEventListener\(['"]keydown['"],\s*onKeyDown,\s*true\)/,
  'plugin surface window should capture Escape at document level so focused inputs cannot block close',
)
assert.match(files.pluginSurfaceWindow, /<PluginSurfaceRenderer/, 'plugin surface window must delegate plugin rendering to the shared renderer')
assert.match(files.globalLauncherFrames, /<GlobalLauncherPluginSurfaceFrame/, 'global launcher frame switch must delegate plugin surface rendering to a frame')
assert.match(files.globalLauncherPluginSurfaceFrame, /<PluginSurfaceRenderer/, 'global launcher surface frame must delegate plugin rendering to the shared renderer')
assert.match(files.pluginSurfaceRenderer, /ensurePluginRuntimeReady/, 'shared plugin surface renderer must bootstrap plugin runtime')
assert.match(files.pluginSurfaceRenderer, /missingPluginPermissions/, 'shared plugin surface renderer must gate missing permissions')
assert.match(files.pluginSurfaceRenderer, /beforeOpen/, 'shared plugin surface renderer must run beforeOpen before rendering')
assert.match(files.pluginSurfaceRenderer, /createPluginPrivateStorage/, 'shared plugin surface renderer must provide plugin storage host API')
assert.match(files.pluginSurfaceRenderer, /createPluginClipboard/, 'shared plugin surface renderer must provide clipboard host API')
assert.match(files.pluginSurfaceRenderer, /createPluginNetwork/, 'shared plugin surface renderer must provide network host API')

assert.doesNotMatch(files.globalPinnedHotkeys, /unregisterAll\(/, 'global pinned hotkey sync must not unregister plugin surface shortcuts')
assert.match(files.surfaceHotkeys, /isRegistered\(accelerator\)/, 'surface hotkey installer must detect conflicts')
assert.match(files.surfaceHotkeys, /missingShortcutPermissions/, 'surface hotkey installer must enforce globalShortcut.register permission')
assert.match(files.surfaceHotkeys, /requestOpenPluginSurfaceTool/, 'surface hotkey installer must open the target surface')
assert.match(files.surfaceHotkeys, /pluginRegistry\.subscribe/, 'surface hotkey installer must resync when plugins enable, disable, or reload')
assert.match(files.surfaceHotkeys, /usePluginPermissionStore\.subscribe/, 'surface hotkey installer must resync on permission changes')

const registerShortcutFunction = files.surfaceHotkeys.match(/async function registerShortcut[\s\S]*?\n}\n\nasync function unregisterRemovedOrChanged/)?.[0] ?? ''
const cachedAcceleratorBranch = registerShortcutFunction.match(/if\s*\(\s*current\s*===\s*accelerator\s*\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
assert.doesNotMatch(cachedAcceleratorBranch, /return/, 'surface hotkey resync must not skip rebinding a cached accelerator because its callback channel may be stale')
assert.match(cachedAcceleratorBranch, /unregisterAccelerator\(accelerator\)/, 'surface hotkey resync must clear cached native registrations before rebinding')
assert.match(cachedAcceleratorBranch, /currentAccelerators\.delete\(key\)/, 'surface hotkey resync must drop stale cached accelerators after native service reload')
assert.match(registerShortcutFunction, /isGlobalPinnedLauncherAccelerator\(accelerator\)[\s\S]{0,260}registrationStatus:\s*'conflict'/, 'surface hotkey resync must preserve conflicts with the global pinned launcher shortcut')
assert.match(registerShortcutFunction, /await unregisterAccelerator\(accelerator\)[\s\S]{0,220}await register\(accelerator/, 'surface hotkey resync must reclaim stale native plugin registrations before binding a fresh callback')
assert.match(files.surfaceHotkeys, /settings\.globalPinnedLauncherShortcut/, 'surface hotkey conflict detection must inspect the global pinned launcher shortcut')
assert.match(files.surfaceHotkeys, /shortcutSyncSignature\(state\.shortcuts\)\s*!==\s*shortcutSyncSignature\(previous\.shortcuts\)/, 'surface hotkey installer must ignore registration status writes when deciding whether to resync')

assert.match(files.globalLauncher, /pluginSurfaceToolTarget/, 'GlobalLauncher must read tool-shell target')
assert.match(files.globalLauncher, /samePluginSurfaceTarget/, 'GlobalLauncher must distinguish tool-shell surfaces from launcher-list surfaces')
assert.match(files.globalLauncher, /leaveSurface/, 'GlobalLauncher must route Esc/back by surface origin')
assert.match(files.globalLauncherLayout, /surfaceShell\?\.defaultHeight[\s\S]*STANDALONE_SURFACE_MAX_HEIGHT/, 'tool-shell surfaces must resize taller than the compact launcher list')
assert.match(files.globalLauncherLayout, /surfaceShell\?\.defaultWidth[\s\S]*STANDALONE_SURFACE_MAX_WIDTH/, 'tool-shell surfaces must resize wider than the compact launcher list')
assert.doesNotMatch(files.globalLauncher, /aria-label=["']Settings["'][\s\S]{0,160}<Settings/, 'surface host header must not duplicate the plugin settings action')

assert.match(files.scriptsView, /plugin-surface-shortcut-row/, 'ScriptsView must render surface-level shortcut rows')
assert.match(files.scriptsView, /requestOpenPluginSurfaceTool/, 'ScriptsView must open a surface directly')
assert.match(files.scriptsView, /setPluginSurfaceShortcut/, 'ScriptsView must bind a surface shortcut')
assert.match(files.scriptsView, /clearPluginSurfaceShortcut/, 'ScriptsView must clear a surface shortcut')
assert.match(files.scriptsView, /globalShortcut\.register/, 'ScriptsView must grant only the global shortcut permission when binding')

const runtime = read('src/workspace/pluginRuntime.ts')
assert.match(runtime, /clearPluginHostState/, 'plugin runtime must centralize host-state cleanup')
assert.match(runtime, /clearPluginPrivateStorage/, 'installed plugin uninstall must clear private storage')
assert.match(runtime, /clearPluginShortcuts/, 'plugin uninstall/remove must clear surface shortcuts')
assert.match(files.scriptsView, /status\.blocked/, 'ScriptsView must display blocked plugin status when permissions are missing')

for (const key of [
  'surfaceOpen',
  'surfaceBindShortcut',
  'surfaceClearShortcut',
  'surfaceShortcutRegistered',
  'surfaceShortcutConflict',
  'status.blocked',
]) {
  assert.match(files.scriptsI18n, new RegExp(`['"]${key}['"]`), `scripts i18n must include ${key}`)
}

console.log('plugin surface shortcut checks passed')
