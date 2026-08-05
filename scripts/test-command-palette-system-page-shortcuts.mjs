#!/usr/bin/env node

/**
 * System page launcher shortcuts
 *
 * Command palette and global launcher expose system page shortcuts through
 * host-owned launcher actions. The launcher registry should only collect
 * providers; it should not hard-code concrete app pages.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const registrySource = read('src/workspace/launcher/registry.ts')
assert.doesNotMatch(
  registrySource,
  /HOST_VIEW_SHORTCUTS|collectDefaultHostItems|host:view:|setActiveView/,
  'launcher registry should not hard-code concrete Plugins or Settings page shortcuts',
)

const hostProviderSource = read('src/workspace/launcher/hostProvider.ts')
const hostActionsSource = read('src/workspace/launcher/hostActions.ts')
assert.match(hostProviderSource, /getHostPaneControlItems\(\)/, 'host provider should include system page and pane controls')
assert.match(hostActionsSource, /systemKey:\s*['"]host:view:plugins['"]/, 'host actions should contribute plugins page shortcut')
assert.match(hostActionsSource, /systemKey:\s*['"]host:view:settings['"]/, 'host actions should contribute settings page shortcut')
assert.match(hostActionsSource, /systemKey:\s*['"]host:view:devtools['"]/, 'host actions should contribute open DevTools shortcut')
assert.match(hostActionsSource, /打开控制台|Open DevTools/, 'devtools command should be searchable in zh/en')
assert.match(
  read('src-tauri/src/lib.rs'),
  /fn open_devtools|open_devtools,/,
  'native open_devtools command must be registered',
)
assert.match(hostActionsSource, /requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'plugins shortcut should navigate through the launcher API')
assert.match(hostActionsSource, /requestOpenLauncherHostSurface\(['"]system-settings['"]\)/, 'settings shortcut should navigate through the launcher API')
assert.match(hostActionsSource, /aliases:\s*\[[\s\S]*['"]plugins['"][\s\S]*['"]插件['"]/, 'plugins shortcut should be searchable by English and Chinese terms')
assert.match(hostActionsSource, /aliases:\s*\[[\s\S]*['"]settings['"][\s\S]*['"]设置['"]/, 'settings shortcut should be searchable by English and Chinese terms')

const pluginApiSource = read('src/workspace/launcher/pluginApi.ts')
const globalLauncherSource = read('src/components/GlobalLauncher.tsx')
const globalLauncherHostSource = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const globalLauncherFramesSource = read('src/components/launcher/GlobalLauncherFrames.tsx')
const globalLauncherSystemFrameSource = read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx')
const appSource = read('src/App.tsx')
assert.match(pluginApiSource, /requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'plugin launcher API should open Plugins as a launcher-hosted surface')
assert.match(pluginApiSource, /requestOpenLauncherHostSurface\(['"]system-settings['"]\)/, 'plugin launcher API should open Settings as a launcher-hosted surface')
assert.match(globalLauncherSource, /GlobalLauncherHost/, 'GlobalLauncher should remain a thin host wrapper')
assert.match(globalLauncherHostSource, /launcherHostSurfaceTarget/, 'GlobalLauncherHost should read launcher-hosted app surface state')
assert.match(globalLauncherFramesSource, /GlobalLauncherSystemSurfaceFrame/, 'GlobalLauncher frames should render launcher-hosted app surfaces')
assert.match(globalLauncherSystemFrameSource, /SettingsSurface/, 'GlobalLauncher system frame should render SettingsSurface')
assert.match(globalLauncherSystemFrameSource, /PluginsSurface/, 'GlobalLauncher system frame should render PluginsSurface')
assert.doesNotMatch(pluginApiSource, /hiven:\/\/show-plugins-page|hiven:\/\/show-settings-page|show_and_focus_window/, 'plugin launcher API must not route settings/plugins through the main window')
assert.doesNotMatch(appSource, /hiven:\/\/show-plugins-page|hiven:\/\/show-settings-page/, 'main window must not be the settings/plugins bridge')

console.log('command palette system page shortcut checks passed')
