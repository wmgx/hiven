#!/usr/bin/env node

/**
 * Settings select layout contract
 *
 * App settings dropdowns should keep trigger/menu widths aligned and should not
 * be clipped by the settings card while the menu is open.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const settingsView = read('src/surfaces/SettingsContent.tsx')
const systemSettingsView = read('src/components/SystemSettingsSurface.tsx')
const css = read('src/index.css')
const systemSettingsCss = read('src/components/SystemSettingsSurface.css')

assert.match(
  css,
  /\.plugin-settings-dialog-panel \.schema-object-list-master-detail\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s,
  'plugin settings object lists should use the dialog as their single scroll container',
)

assert.equal(
  packageJson.scripts?.['test:settings-select-layout'],
  'node scripts/test-settings-select-layout.mjs',
  'package.json must expose test:settings-select-layout',
)

assert.match(
  settingsView,
  /import \{ Combobox, NumberField, Select, Switch \} from ['"]\.\.\/plugin-ui['"]/,
  'settings should reuse the shared Select primitive',
)

assert.match(
  settingsView,
  /function LocaleSelect[\s\S]{0,700}<Select/,
  'non-searchable settings selects should render the shared Select primitive',
)

assert.doesNotMatch(
  settingsView,
  /className=['"]relative min-w-\[112px\]['"]/, 
  'LocaleSelect should not rely on utility-only wrapper sizing for a stateful popover',
)

assert.match(
  css,
  /\.settings-select-wrap\s*\{[\s\S]{0,220}position:\s*relative;[\s\S]{0,220}width:\s*112px;/,
  'settings select wrapper should define a stable width for both trigger and menu',
)

assert.match(css, /\.hiven-ui-select-positioner\s*\{[\s\S]{0,900}z-index:\s*1300;/, 'shared Select should portal above settings surfaces')
assert.match(
  settingsView,
  /<Combobox[\s\S]{0,400}searchPlaceholder/,
  'long searchable settings fields such as the AI default model should reuse Combobox',
)
assert.match(
  css,
  /html\[data-window=['"]launcher['"]\]\s+\.hiven-ui-select-positioner\s*\{[\s\S]{0,180}-webkit-app-region:\s*no-drag/,
  'portaled settings menus must not start launcher window drag',
)

assert.match(css, /\.hiven-ui-select-trigger\s*\{[\s\S]{0,120}width:\s*100%;/, 'shared Select trigger should fill its wrapper')
assert.match(css, /\.hiven-ui-select-menu[\s\S]{0,80}\{\s*min-width:\s*var\(--anchor-width\);/, 'portaled menu should match its trigger width')
assert.match(css, /\.hiven-ui-select-option\[data-highlighted\]/, 'shared Select should style pointer and keyboard hover state')
assert.match(
  systemSettingsCss,
  /@media \(max-width: 720px\)[\s\S]*\.system-settings-surface\s*\{[^}]*flex-direction:\s*column;[\s\S]*\.system-settings-sidebar\s*\{[^}]*flex-direction:\s*row;[\s\S]*\.system-settings-tab\s*\{[^}]*flex:\s*0 0 auto;/,
  'narrow settings surfaces should move navigation above the content instead of squeezing rows',
)
assert.match(
  systemSettingsCss,
  /@media \(max-width: 560px\)[\s\S]*\.srow\s*\{[^}]*flex-wrap:\s*wrap;[\s\S]*\.srow \.s-ctl\s*\{[^}]*width:\s*100%;/,
  'settings controls should move below their labels when zoom leaves little horizontal space',
)
assert.match(systemSettingsView, /aria-label=\{tab\.label\}/, 'icon-only narrow settings tabs must retain an accessible name')
assert.match(systemSettingsCss, /\.system-settings-tab\.active \.system-settings-tab-label\s*\{[^}]*display:\s*inline;/, 'narrow settings tabs should keep the active section label visible')

console.log('settings select layout checks passed')
