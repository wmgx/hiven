#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
const lifecycle = read('src/components/launcher/GlobalLauncherWindowLifecycle.ts')
const quickEditorPanel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const quickEditorOverlay = read('src/components/quickEditor/QuickEditorCommandOverlay.tsx')
const blurGuard = read('src/workspace/launcherBlurGuard.ts')
const globalLauncherHost = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const launcherTypes = read('src/workspace/launcher/types.ts')
const quickEditorActions = read('src/workspace/quickEditor/quickEditorActions.ts')
const app = read('src/App.tsx')
const store = read('src/store.ts')

assert.equal(
  packageJson.scripts?.['test:quick-editor-launcher-behavior'],
  'node scripts/test-quick-editor-launcher-behavior.mjs',
  'package.json must expose the Quick Editor launcher behavior contract',
)

assert.match(
  globalLauncherHost,
  /closeOnBlur:\s*mode\s*===\s*['"]quick-editor['"]\s*\?\s*true\s*:/,
  'Quick Editor mode should preserve the design-required blur-to-close behavior',
)

assert.match(
  lifecycle,
  /closeOnBlurRef\s*=\s*useRef\(closeOnBlur\)/,
  'standalone launcher focus listener should keep the latest closeOnBlur value in a ref',
)

assert.match(
  lifecycle,
  /closeOnBlurRef\.current\s*=\s*closeOnBlur/,
  'standalone launcher focus listener should refresh the closeOnBlur ref when mode changes',
)

assert.match(
  lifecycle,
  /!\s*focused\s*&&\s*closeOnBlurRef\.current\s*!==\s*false[\s\S]*closeLauncher\(\)/,
  'standalone launcher focus listener should read closeOnBlur from the ref inside the native callback',
)

assert.match(
  lifecycle,
  /shouldSuppressStandaloneLauncherBlur\(\)/,
  'standalone launcher blur close should support short-lived suppression for internal Quick Editor shortcuts',
)

assert.doesNotMatch(
  lifecycle,
  /onCurrentLauncherWindowFocusChanged\(\(focused\)\s*=>\s*\{[\s\S]*closeOnBlur\s*!==\s*false[\s\S]*\}\)/,
  'native focus listener must not close over a stale closeOnBlur value directly',
)

assert.match(
  quickEditorPanel,
  /onKeyDownCapture=\{handleKeyDownCapture\}/,
  'Quick Editor should capture shell shortcuts before Monaco or the browser can consume them',
)

assert.match(
  quickEditorPanel,
  /event\.key\.toLowerCase\(\)\s*!==\s*['"]k['"]/,
  'Quick Editor shell shortcut handler should target Cmd/Ctrl+K',
)

assert.match(
  quickEditorPanel,
  /event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)[\s\S]*openQuickEditorCommand\(\)/,
  'Cmd/Ctrl+K should be prevented and open the Quick Editor command overlay',
)

assert.match(
  quickEditorPanel,
  /suppressStandaloneLauncherBlur\(\)[\s\S]*openQuickEditorCommand\(\)/,
  'Cmd/Ctrl+K should suppress transient native blur before opening the command overlay',
)

assert.match(
  blurGuard,
  /suppressStandaloneLauncherBlur[\s\S]*shouldSuppressStandaloneLauncherBlur/,
  'Quick Editor should have an explicit transient blur suppression guard',
)

assert.match(
  store,
  /toggleQuickEditor:\s*\(\)\s*=>\s*\{[\s\S]*globalLauncherOpen\s*&&\s*globalLauncherMode\s*===\s*['"]quick-editor['"][\s\S]*setGlobalLauncherOpen\(false\)/,
  'toggling Quick Editor while it is already open should close the launcher instead of only switching mode',
)

assert.match(
  launcherTypes,
  /LauncherHostId\s*=\s*['"]global-launcher['"]\s*\|\s*['"]editor-command-bar['"]\s*\|\s*['"]quick-editor-command['"]/,
  'Quick Editor command overlay should have its own launcher host id',
)

assert.match(
  launcherTypes,
  /['"]quick-editor-command['"]:\s*\{[\s\S]*presentation:\s*['"]editor-overlay['"][\s\S]*text-input-actions[\s\S]*pane-actions[\s\S]*parameter-customization/,
  'Quick Editor command host should expose the editor command capability subset',
)

assert.match(
  quickEditorOverlay,
  /hostId:\s*['"]quick-editor-command['"]/,
  'Quick Editor command overlay should not reuse editor-command-bar as its host',
)

assert.match(
  quickEditorOverlay,
  /createQuickEditorLauncherApi/,
  'Quick Editor command overlay should inject a Quick Editor scoped launcher API',
)

assert.match(
  quickEditorActions,
  /applyEffectsToQuickEditor/,
  'Quick Editor should provide an effect router for command output',
)

assert.match(
  quickEditorActions,
  /case\s+['"]text\.replace['"][\s\S]*setText/,
  'Quick Editor effect router should apply text.replace to the persisted Quick Editor text',
)

assert.match(
  app,
  /hiven:\/\/quick-editor-open/,
  'App should listen for the native Quick Editor hotkey event',
)

assert.match(
  app,
  /toggleQuickEditor\(\)/,
  'native Quick Editor hotkey event should route through the Quick Editor toggle state machine',
)

console.log('Quick Editor launcher behavior checks passed')
