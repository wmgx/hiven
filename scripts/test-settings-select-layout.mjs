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
const settingsView = read('src/views/SettingsView.tsx')
const css = read('src/index.css')

assert.equal(
  packageJson.scripts?.['test:settings-select-layout'],
  'node scripts/test-settings-select-layout.mjs',
  'package.json must expose test:settings-select-layout',
)

assert.match(
  settingsView,
  /className=\{`settings-select-wrap \$\{open \? 'is-open' : ''\}`\}/,
  'LocaleSelect should use a named open-state wrapper instead of anonymous utility-only layout',
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

assert.match(
  css,
  /\.settings-select-wrap\.is-open\s*\{[\s\S]{0,180}z-index:\s*\d+;/,
  'open settings select should create a stacking context above following rows',
)

assert.match(
  css,
  /\.scard:has\(\.settings-select-wrap\.is-open\)\s*\{[\s\S]{0,120}overflow:\s*visible;/,
  'settings card should stop clipping an open select menu',
)

assert.match(
  css,
  /\.sel-ctl\s*\{[\s\S]{0,260}width:\s*100%;[\s\S]{0,220}box-sizing:\s*border-box;/,
  'select trigger should fill the wrapper so it matches the menu width',
)

assert.match(
  css,
  /\.settings-select-menu\s*\{[\s\S]{0,260}width:\s*100%;[\s\S]{0,220}box-sizing:\s*border-box;/,
  'select menu should use the same width model as the trigger',
)

console.log('settings select layout checks passed')
