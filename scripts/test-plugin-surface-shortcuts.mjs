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
  surfaceOpenRequest: read('src/workspace/pluginSurfaceOpenRequest.ts'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  scriptsView: read('src/views/ScriptsView.tsx'),
  scriptsI18n: read('src/i18n/locales/scripts.ts'),
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

assert.match(files.surfaceOpenRequest, /show_launcher_window/, 'surface open request must show the launcher/tool shell window')
assert.match(files.surfaceOpenRequest, /hiven:\/\/open-plugin-surface/, 'surface open request must emit the open surface event')
assert.match(files.surfaceOpenRequest, /localStorage\.setItem/, 'surface open request must persist a pending target for newly created launcher windows')

assert.match(files.app, /installPluginSurfaceShortcutHotkeys/, 'main app must install plugin surface shortcut hotkeys')
assert.match(files.app, /consumePendingPluginSurfaceOpenTarget/, 'launcher window must consume pending surface open targets')
assert.match(files.app, /hiven:\/\/open-plugin-surface/, 'launcher window must listen for plugin surface open events')
assert.match(files.app, /function LauncherWindowApp[\s\S]*<PluginSettingsDialog \/>/, 'launcher window must render plugin settings dialogs opened from a surface')

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
assert.match(files.globalLauncher, /surfaceShell\?\.defaultHeight[\s\S]*STANDALONE_SURFACE_MAX_HEIGHT/, 'tool-shell surfaces must resize taller than the compact launcher list')
assert.match(files.globalLauncher, /surfaceShell\?\.defaultWidth[\s\S]*STANDALONE_SURFACE_MAX_WIDTH/, 'tool-shell surfaces must resize wider than the compact launcher list')
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
