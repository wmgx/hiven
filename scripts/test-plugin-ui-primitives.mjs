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
  vite: read('vite.config.ts'),
  tsconfig: read('tsconfig.app.json'),
  pluginUi: read('src/plugin-ui.tsx'),
  pluginUiIcons: read('src/plugin-ui-icons.ts'),
  css: read('src/index.css'),
  clipboardStyle: read('src/plugins/clipboard-history/style.css'),
  clipboardSurface: read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:plugin-ui-primitives'],
  'node scripts/test-plugin-ui-primitives.mjs',
  'package.json must expose test:plugin-ui-primitives',
)

for (const source of [files.vite, files.tsconfig]) {
  assert.match(source, /@hiven\/plugin-ui/, 'Vite and TS config must expose @hiven/plugin-ui')
  assert.match(source, /@hiven\/plugin-ui\/icons/, 'Vite and TS config must expose @hiven/plugin-ui/icons')
}

for (const exported of [
  'Button',
  'IconButton',
  'TextInput',
  'SearchField',
  'TextArea',
  'Select',
  'Checkbox',
  'Toggle',
  'SegmentedControl',
  'NumberField',
  'Slider',
  'ToolbarButton',
  'SurfaceList',
  'SurfaceListItem',
  'SurfacePreview',
  'SurfaceEmptyState',
  'SurfaceToolbar',
  'SurfaceFooterHints',
  'ConfirmDialog',
]) {
  assert.match(files.pluginUi, new RegExp(`export (?:const|function) ${exported}\\b`), `plugin-ui must export ${exported}`)
}

assert.doesNotMatch(files.pluginUi, /useAppStore|pluginRegistry|@tauri-apps|workspaceStore|Monaco/, 'plugin-ui primitives must not expose host internals')
assert.match(files.pluginUiIcons, /ClipboardIcon/, 'plugin-ui icons must expose stable clipboard icon names')

for (const token of [
  '--hiven-color-bg-primary',
  '--hiven-color-text-primary',
  '--hiven-color-border',
  '--hiven-color-accent',
  '--hiven-radius-md',
  '--hiven-font-ui',
]) {
  assert.match(files.css, new RegExp(token), `CSS must expose public token ${token}`)
}

assert.match(files.css, /\.hiven-ui-button/, 'CSS must style plugin-ui buttons')
assert.match(files.css, /\.hiven-ui-select/, 'CSS must style plugin-ui select wrappers')
assert.match(files.css, /appearance:\s*none/, 'plugin-ui select must hide native browser appearance')
assert.match(files.css, /\.hiven-ui-surface-toolbar/, 'CSS must style plugin-ui surface toolbar')
assert.match(files.css, /\.hiven-ui-surface-empty/, 'CSS must style plugin-ui empty state')

assert.match(files.clipboardSurface, /from ['"]@hiven\/plugin-ui['"]/, 'clipboard-history surface should use plugin-ui primitives')
assert.match(files.pluginUiIcons, /BackIcon/, 'plugin-ui icons must expose a stable back icon name')
assert.match(files.clipboardSurface, /<SearchField|<SegmentedControl|<SurfaceList|<SurfacePreview|<SurfaceEmptyState/, 'clipboard-history should render plugin-ui primitives')
assert.match(files.clipboardSurface, /clipboard-history-list-toolbar[\s\S]{0,600}<SegmentedControl/, 'clipboard-history type filter should sit above the left list')
assert.match(files.clipboardSurface, /<SegmentedControl[\s\S]{0,600}filter\.all[\s\S]{0,600}filter\.files/, 'clipboard-history type filter should use a styled segmented control instead of a native select menu')
assert.match(files.clipboardSurface, /filter\.frequent/, 'clipboard-history should expose the frequent filter from the UX design')
assert.match(files.clipboardSurface, /clipboard-history-copy-count/, 'clipboard-history list rows should render copy-count chips')
assert.match(files.clipboardSurface, /ClipboardImageThumbnail/, 'clipboard-history should render image thumbnails in the list')
assert.match(files.clipboardSurface, /clipboard-history-item-delete/, 'clipboard-history should render per-item delete controls')
assert.match(files.clipboardStyle, /\.clipboard-history-main::after[\s\S]{0,260}left:\s*262px[\s\S]{0,180}width:\s*1px/, 'clipboard-history left and right panes should match the UX divider position')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row:hover[\s\S]{0,220}background/, 'clipboard-history items should keep a visible hover highlight')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row\.is-selected[\s\S]{0,260}background-color:\s*var\(--color-accent-bg\)/, 'clipboard-history selected item should keep a visible theme-aware fill')
assert.match(files.clipboardStyle, /\.clipboard-history-item-row\.is-selected \.clipboard-history-item[\s\S]{0,180}background:\s*transparent !important/, 'clipboard-history selected item should override generic plugin-ui selected backgrounds')
assert.match(files.clipboardStyle, /\.clipboard-history-item-thumb/, 'clipboard-history should style image thumbnails')
assert.match(files.clipboardStyle, /\.clipboard-history-filter \.hiven-ui-segmented-item\.is-active[\s\S]{0,180}!important/, 'clipboard-history type filter should override generic plugin-ui active styles')

console.log('plugin-ui primitive checks passed')
