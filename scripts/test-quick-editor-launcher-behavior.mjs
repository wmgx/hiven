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
const hostLifecycle = read('src/components/launcher/GlobalLauncherHostLifecycle.ts')
const quickEditorPanel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const quickEditorOverlay = read('src/components/quickEditor/QuickEditorCommandOverlay.tsx')
const blurGuard = read('src/workspace/launcherBlurGuard.ts')
const globalLauncherHost = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const launcherTypes = read('src/workspace/launcher/types.ts')
const quickEditorActions = read('src/workspace/quickEditor/quickEditorActions.ts')
const app = read('src/App.tsx')
const store = read('src/store.ts')
const tauriLib = read('src-tauri/src/lib.rs')
const globalPinnedHotkeys = read('src/hotkeys/globalPinnedLauncher.ts')

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

assert.doesNotMatch(
  quickEditorPanel,
  /show_quick_editor_launcher_window|hiven:\/\/quick-editor-open|toggleQuickEditor\(\)/,
  'Quick Editor internal Cmd/Ctrl+K must not route through the global launcher open/toggle path',
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

assert.doesNotMatch(
  app,
  /hiven:\/\/quick-editor-open|toggleQuickEditor\(\)/,
  'App should not install a native/global Quick Editor toggle listener for Cmd/Ctrl+K',
)

assert.doesNotMatch(
  tauriLib,
  /show_quick_editor_launcher_window|hiven:\/\/quick-editor-open/,
  'native layer should not expose a global Quick Editor hotkey path',
)

assert.match(
  globalPinnedHotkeys,
  /globalLauncherOpen\s*&&\s*state\.globalLauncherMode\s*===\s*['"]quick-editor['"][\s\S]*openQuickEditorCommand\(\)[\s\S]*return[\s\S]*showLauncherWindow\(\)/,
  'global Cmd/Ctrl+K routing should become the Quick Editor internal command overlay while Quick Editor is already open',
)

assert.match(
  globalPinnedHotkeys,
  /quickEditorActive\s*!==\s*previousQuickEditorActive[\s\S]*syncShortcut\(next\)/,
  'global Cmd/Ctrl+K accelerator should be re-synced when Quick Editor opens or closes',
)

assert.match(
  globalPinnedHotkeys,
  /isQuickEditorCommandAccelerator\(shortcut\.accelerator\)[\s\S]*Handled by Quick Editor[\s\S]*return/,
  'global Cmd/Ctrl+K accelerator should be unregistered while Quick Editor owns Cmd/Ctrl+K',
)

assert.match(
  globalPinnedHotkeys,
  /suppressStandaloneLauncherBlur\(\)[\s\S]*openQuickEditorCommand\(\)/,
  'global Cmd/Ctrl+K routing into Quick Editor should suppress transient standalone blur before opening the overlay',
)

assert.match(
  tauriLib,
  /show_launcher_window_for_hotkey[\s\S]*show_launcher_window_for_hotkey_with_event\(app,\s*['"]hiven:\/\/launcher-open['"]\)/,
  'normal launcher open path should keep preparing the search input source',
)

assert.match(
  globalLauncherHost,
  /if\s*\(\s*mode\s*===\s*['"]quick-editor['"]\s*\)\s*return[\s\S]*prepareLauncherInputSource\(\)/,
  'Quick Editor mode should not invoke the launcher search input-source preparation effect',
)

assert.match(
  quickEditorOverlay,
  /controllerRef\.current\?\.back\?\.\(\)[\s\S]*requestAnimationFrame\(\(\)\s*=>\s*inputRef\.current\?\.focus\(\)\)[\s\S]*closeCommand\(\)/,
  'Quick Editor command overlay Escape should go back one controller frame before closing the overlay',
)

assert.match(
  quickEditorOverlay,
  /GlobalLauncherFrameSwitch/,
  'Quick Editor command overlay should render launcher controller frames so Escape can return to previous command steps',
)

assert.match(
  quickEditorOverlay,
  /topFrame\?\.kind\s*===\s*['"]param-input['"][\s\S]*return/,
  'Quick Editor overlay root Enter handler should let parameter frames own Enter and Escape',
)

assert.match(
  hostLifecycle,
  /mode\s*===\s*['"]quick-editor['"][\s\S]*quickEditorCommandOpen[\s\S]*return[\s\S]*closeLauncher\(\)/,
  'Quick Editor host Escape should leave Escape to the command overlay while it is open',
)

console.log('Quick Editor launcher behavior checks passed')
