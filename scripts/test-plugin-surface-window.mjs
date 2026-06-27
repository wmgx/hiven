#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures = []

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readOptional(path) {
  const fullPath = join(root, path)
  if (!existsSync(fullPath)) return null
  return read(path)
}

const files = {
  packageJson: read('package.json'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  surfaceHotkeys:
    readOptional('src/hotkeys/pluginSurfaceShortcuts.ts')
    ?? readOptional('src/workspace/pluginSurfaceShortcuts.ts')
    ?? '',
  clipboardHistory: read('src/plugins/clipboard-history/index.tsx'),
  pluginSurfaceWindows: readOptional('src/workspace/windowManager/pluginSurfaceWindows.ts'),
}

const packageJson = JSON.parse(files.packageJson)

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

check('package script', () => {
  assert.equal(
    packageJson.scripts?.['test:plugin-surface-window'],
    'node scripts/test-plugin-surface-window.mjs',
    'package.json must expose test:plugin-surface-window',
  )
})

check('plugin surface type fields', () => {
  assert.match(
    files.pluginTypes,
    /instancePolicy\??:\s*['"]singleton['"]\s*\|\s*['"]multi['"]/,
    'PluginUiSurfaceContribution must support instancePolicy',
  )
  assert.match(
    files.pluginTypes,
    /shortcutPresentation\??:\s*['"]launcher['"]\s*\|\s*['"]window['"]/,
    'PluginUiSurfaceContribution.entry must support shortcutPresentation',
  )
  assert.match(
    files.pluginTypes,
    /destroyTimeout\??:\s*number/,
    'PluginUiSurfaceContribution.shell must support destroyTimeout',
  )
  assert.match(
    files.pluginTypes,
    /closeOnBlur\??:\s*boolean/,
    'PluginUiSurfaceContribution.shell must support closeOnBlur',
  )
})

check('plugin surface window manager', () => {
  assert.ok(
    files.pluginSurfaceWindows,
    'src/workspace/windowManager/pluginSurfaceWindows.ts must exist',
  )
  assert.match(
    files.pluginSurfaceWindows,
    /getPluginSurfaceWindowLabel|buildPluginSurfaceWindowLabel|pluginSurfaceWindowLabel/,
    'plugin surface window manager must expose a label builder',
  )
  assert.match(
    files.pluginSurfaceWindows,
    /plugin-surface:\$\{source\}:\$\{pluginId\}:\$\{surfaceId\}/,
    'plugin surface window labels must be plugin-surface:{source}:{pluginId}:{surfaceId}',
  )
})

check('shortcut window routing', () => {
  assert.match(
    files.surfaceHotkeys,
    /shortcutPresentation/,
    'plugin surface shortcut handler must inspect entry.shortcutPresentation',
  )
  assert.match(
    files.surfaceHotkeys,
    /shortcutPresentation\s*={2,3}\s*['"]window['"][\s\S]{0,700}(showPluginSurfaceWindow|openPluginSurfaceWindow)/,
    'shortcutPresentation=window must route shortcuts to the independent plugin surface window path',
  )
  assert.doesNotMatch(
    files.surfaceHotkeys,
    /event\.state !== ['"]Pressed['"][\s\S]{0,500}requestOpenPluginSurfaceTool\(shortcut\.target\)/,
    'shortcut callbacks must not unconditionally open the GlobalLauncher surfaceFrame path',
  )
})

check('clipboard-history window presentation', () => {
  assert.match(
    files.clipboardHistory,
    /shortcutPresentation:\s*['"]window['"]/,
    'clipboard-history must declare shortcutPresentation: window',
  )
})

if (failures.length > 0) {
  console.error('plugin surface window contract checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('plugin surface window contract checks passed')
