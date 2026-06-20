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
assert.match(hostActionsSource, /showPluginsPage\(\)/, 'plugins shortcut should navigate through the launcher API')
assert.match(hostActionsSource, /showSettingsPage\(\)/, 'settings shortcut should navigate through the launcher API')
assert.match(hostActionsSource, /aliases:\s*\[[\s\S]*['"]plugins['"][\s\S]*['"]插件['"]/, 'plugins shortcut should be searchable by English and Chinese terms')
assert.match(hostActionsSource, /aliases:\s*\[[\s\S]*['"]settings['"][\s\S]*['"]设置['"]/, 'settings shortcut should be searchable by English and Chinese terms')

const appSource = read('src/App.tsx')
const pluginApiSource = read('src/workspace/launcher/pluginApi.ts')
assert.match(pluginApiSource, /hiven:\/\/show-plugins-page/, 'plugin launcher API should route standalone plugins page requests to the main window')
assert.match(pluginApiSource, /hiven:\/\/show-settings-page/, 'plugin launcher API should route standalone settings page requests to the main window')
assert.match(appSource, /listen\(['"]hiven:\/\/show-plugins-page['"][\s\S]{0,260}setActiveView\(['"]scripts['"]\)/, 'main window should handle plugins page requests from the standalone launcher')
assert.match(appSource, /listen\(['"]hiven:\/\/show-settings-page['"][\s\S]{0,260}setActiveView\(['"]settings['"]\)/, 'main window should handle settings page requests from the standalone launcher')

console.log('command palette system page shortcut checks passed')
