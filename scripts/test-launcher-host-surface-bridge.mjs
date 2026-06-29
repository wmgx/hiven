#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')
const bridge = readFileSync('src/workspace/launcherHostSurfaceBridge.ts', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
const launcherPluginApi = readFileSync('src/workspace/launcher/pluginApi.ts', 'utf8')
const surfaceActions = readFileSync('src/surfaces/actions.ts', 'utf8')
const pluginsManagerSurface = readFileSync('src/surfaces/PluginsManagerSurfaceContent.tsx', 'utf8')
const launcherRegistry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')

assert.equal(
  packageJson.scripts?.['test:launcher-host-surface-bridge'],
  'node scripts/test-launcher-host-surface-bridge.mjs',
  'package.json must expose launcher host surface bridge coverage',
)
assert.match(
  refactorSuite,
  /test:launcher-host-surface-bridge/,
  'refactor suite must include launcher host surface bridge coverage',
)

assert.match(
  bridge,
  /LAUNCHER_HOST_SURFACE_OPEN_EVENT\s*=\s*['"]hiven:\/\/launcher-host-surface-open['"]/,
  'launcher host surface bridge must define an explicit cross-window event',
)
assert.match(
  bridge,
  /PENDING_LAUNCHER_HOST_SURFACE_KEY/,
  'launcher host surface bridge must persist pending opens for launcher startup',
)
assert.match(
  bridge,
  /requestOpenLauncherHostSurfaceRequest[\s\S]*writePendingLauncherHostSurfaceOpen\(request\)[\s\S]*showLauncherWindow\(\)[\s\S]*emitTo\(LAUNCHER_WINDOW_LABEL, LAUNCHER_HOST_SURFACE_OPEN_EVENT, request\)/,
  'non-launcher callers must route host surface opens through the launcher window',
)
assert.match(
  bridge,
  /openLauncherHostSurfaceRequestLocally[\s\S]*request\.kind === ['"]host-surface['"][\s\S]*useAppStore\.getState\(\)\.openLauncherHostSurface\(request\.target\)/,
  'direct AppStore mutation must be isolated to the launcher-local host surface bridge handler',
)
assert.match(
  bridge,
  /consumePendingLauncherHostSurfaceOpen[\s\S]*localStorage\.getItem\(PENDING_LAUNCHER_HOST_SURFACE_KEY\)[\s\S]*isLauncherHostSurfaceOpenRequest\(parsed\.request\)/,
  'launcher startup must consume and validate persisted host surface/plugin settings open requests',
)


assert.match(
  bridge,
  /requestOpenLauncherPluginSettingsSurface[\s\S]*requestOpenLauncherHostSurfaceRequest\(\{ kind: ['"]plugin-settings['"], source, pluginId \}\)/,
  'plugin settings surfaces must use the same launcher host bridge instead of caller-local settings dialog state',
)
assert.match(
  bridge,
  /openLauncherHostSurfaceRequestLocally[\s\S]*request\.kind === ['"]plugin-settings['"][\s\S]*usePluginSettingsStore\.getState\(\)\.openSettingsDialog\([\s\S]*presentation: ['"]global-launcher['"]/,
  'plugin settings dialog mutation must be isolated to the launcher-local bridge handler',
)


assert.match(
  bridge,
  /openLauncherHostSurfaceRequestLocally[\s\S]*clearPendingLauncherHostSurfaceOpen\(\)[\s\S]*request\.kind === ['"]host-surface['"]/,
  'launcher-local host surface delivery must clear persisted pending requests to avoid replaying stale opens',
)

assert.match(
  app,
  /consumePendingLauncherHostSurfaceOpen\(\)[\s\S]*if \(pendingHostSurfaceTarget\) \{[\s\S]*openLauncherHostSurfaceRequestLocally\(pendingHostSurfaceTarget\)[\s\S]*\} else \{[\s\S]*consumePendingPluginSurfaceOpenTarget\(\)/,
  'launcher startup must not consume plugin surface requests until host surface requests are absent',
)

assert.match(
  app,
  /listen\(LAUNCHER_HOST_SURFACE_OPEN_EVENT[\s\S]*isLauncherHostSurfaceOpenRequest\(event\.payload\)[\s\S]*openLauncherHostSurfaceRequestLocally\(event\.payload\)/,
  'launcher runtime must handle host surface/plugin settings bridge events locally',
)

assert.match(
  launcherRegistry,
  /resolvePluginSettingsItem[\s\S]*requestOpenLauncherPluginSettingsSurface\(settingsSource, pluginId\)[\s\S]*keepOpen: ctx\.surfaceId === ['"]global-launcher['"]/,
  'plugin settings launcher items must route through the launcher host surface bridge',
)
assert.doesNotMatch(
  launcherRegistry,
  /resolvePluginSettingsItem[\s\S]*usePluginSettingsStore|getState\(\)\.openSettingsDialog/,
  'plugin settings launcher items must not mutate settings dialog state in the caller webview',
)

assert.match(
  launcherPluginApi,
  /showPluginsPage[\s\S]*requestOpenLauncherHostSurface\(['"]plugins['"]\)/,
  'plugin launcher API showPluginsPage must use the launcher host surface bridge',
)
assert.match(
  launcherPluginApi,
  /showSettingsPage[\s\S]*requestOpenLauncherHostSurface\(['"]settings['"]\)/,
  'plugin launcher API showSettingsPage must use the launcher host surface bridge',
)
assert.doesNotMatch(
  launcherPluginApi,
  /show(?:Plugins|Settings)Page[\s\S]{0,140}openLauncherHostSurface\(/,
  'plugin launcher API must not mutate a shadow AppStore to open host surfaces',
)
assert.match(
  surfaceActions,
  /requestOpenLauncherHostSurface\(['"]settings['"]\)/,
  'surface focus for settings must use the launcher host surface bridge',
)
assert.match(
  surfaceActions,
  /requestOpenLauncherHostSurface\(['"]plugins['"]\)/,
  'surface focus for plugins/plugin-editor must use the launcher host surface bridge',
)

assert.match(
  pluginsManagerSurface,
  /function openPluginsSurfaceSettings\(pluginId: string, source: PluginSettingsSource\)[\s\S]*presentation: ['"]global-launcher['"][\s\S]*context: \{ surfaceId: ['"]global-launcher['"] \}/,
  'PluginsSurface settings buttons must open plugin settings as launcher-hosted settings surfaces',
)
assert.doesNotMatch(
  pluginsManagerSurface,
  /onClick=\{\(\) => usePluginSettingsStore\.getState\(\)\.openSettingsDialog/,
  'PluginsSurface must not scatter raw plugin settings dialog mutations across action buttons',
)

assert.doesNotMatch(
  surfaceActions,
  /useAppStore|usePluginSettingsStore|getState\(\)\.openLauncherHostSurface|openSettingsDialog/,
  'surface focus must not mutate launcher host/settings state in the caller webview',
)

console.log('launcher host surface bridge checks passed')
