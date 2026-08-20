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
const quickEditorEscape = read('src/components/quickEditor/useQuickEditorEscape.ts')
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

// 68b6bb1 ("migrate to launcher host surface, drop globalLauncherMode") replaced
// the mode-based ternary with a declarative per-surface shell config. Quick editor
// (like settings/plugins) now declares closeOnBlur: false on purpose — see
// hostSurfaceShell.ts and the STANDALONE_SURFACE_BACKGROUND_IDLE_MS fallback below:
// losing focus no longer closes it instantly (that punished a quick alt-tab mid-edit),
// it only closes after sitting in the background past the idle timeout.
assert.match(
  globalLauncherHost,
  /closeOnBlur:\s*getHostSurfaceShell\(launcherHostSurfaceTarget\)\?\.closeOnBlur\s*\n\s*\?\?\s*activeSurfaceFrame\?\.surface\.shell\?\.closeOnBlur/,
  'Quick Editor closeOnBlur should be resolved from the declarative host-surface shell config',
)
assert.match(
  read('src/components/launcher/hostSurfaceShell.ts'),
  /['"]quick-editor['"]:\s*\{\s*closeOnBlur:\s*false\s*\}/,
  'quick editor host surface should intentionally opt out of instant blur-close',
)
assert.match(
  globalLauncherHost,
  /Surfaces with closeOnBlur:false can stay open after app switch[\s\S]{0,300}useAutoCloseStandaloneLauncherOnBackgroundIdle/,
  'surfaces that opt out of blur-close must still fall back to idle-timeout close',
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

// The condition became early returns rather than one combined boolean, and grew a
// "smart blur" step in between: focus can move to clipboard history or another
// hiven window without closing the launcher, checked async via
// shouldKeepLauncherOpenOnBlur before closeLauncher() runs.
assert.match(
  lifecycle,
  /if \(focused\) return[\s\S]{0,200}if \(closeOnBlurRef\.current === false\) return[\s\S]{0,400}closeLauncher\(\)/,
  'standalone launcher focus listener should read closeOnBlur from the ref inside the native callback',
)

// shouldSuppressStandaloneLauncherBlur (short-lived suppression for internal Quick
// Editor shortcuts) is no longer called directly from the lifecycle listener — it
// was absorbed into shouldKeepLauncherOpenOnBlur, which checks it as one of several
// reasons to keep the launcher open (see launcherBlurGuard.ts).
assert.match(
  lifecycle,
  /shouldKeepLauncherOpenOnBlur\(\)/,
  'standalone launcher blur close should route through the combined keep-open check',
)
assert.match(
  read('src/workspace/launcherBlurGuard.ts'),
  /shouldKeepLauncherOpenOnBlur[\s\S]{0,300}shouldSuppressStandaloneLauncherBlur\(\)\s*\)\s*return true/,
  'the combined keep-open check must still honor short-lived suppression for internal Quick Editor shortcuts',
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

// store.ts no longer owns a toggleQuickEditor action — 68b6bb1 moved the decision
// out of the store and into the global-hotkey router (globalPinnedLauncher.ts). The
// behavior also changed on purpose: pressing the global shortcut again while quick
// editor already owns the launcher no longer closes the launcher, it opens quick
// editor's own internal command overlay (App 内命令入口), matching the product rule
// that a foregrounded editor surface should get its own command entry rather than
// having the global launcher toggle shut under it.
assert.doesNotMatch(store, /toggleQuickEditor:/, 'store should not own a toggleQuickEditor action anymore')
assert.match(
  globalPinnedHotkeys,
  /async function routeGlobalPinnedLauncherShortcut\(\)[\s\S]*state\.globalLauncherOpen\s*&&\s*state\.launcherHostSurfaceTarget\s*===\s*['"]quick-editor['"][\s\S]*state\.openQuickEditorCommand\(\)[\s\S]*return/,
  'the global shortcut should route into quick editor\'s own command overlay while quick editor already owns the launcher',
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
  /state\.globalLauncherOpen\s*&&\s*state\.launcherHostSurfaceTarget\s*===\s*['"]quick-editor['"][\s\S]*openQuickEditorCommand\(\)[\s\S]*return[\s\S]*showLauncherWindow\(\)/,
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

// prepareLauncherInputSource (src/workspace/windowManager/launcherWindow.ts) has
// zero call sites left anywhere in src/ — the effect this guarded no longer runs
// for ANY mode, so the mode-gate itself is moot. Not removing prepareLauncherInputSource
// here since that's dead-code cleanup, not test repair; flagging it instead of
// asserting around code that no longer exists.
assert.doesNotMatch(globalLauncherHost, /prepareLauncherInputSource/, 'GlobalLauncherHost should not call the retired input-source preparation effect')

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

// This moved out of the overlay and into the shared GlobalLauncherFrameSwitch,
// which the overlay already renders — the frame switch, not the overlay itself,
// now decides that a param-input top frame renders LauncherParamStep (which owns
// its own Enter/Escape internally, see test-command-optional-params.mjs).
assert.match(
  read('src/components/launcher/GlobalLauncherFrames.tsx'),
  /topFrame\?\.kind === ['"]param-input['"][\s\S]{0,80}<LauncherParamStep/,
  'the shared frame switch should let parameter frames own Enter and Escape',
)

// This moved out of hostLifecycle entirely as part of the Escape Chain Unification
// (6e69f0f): the host no longer special-cases quick editor at all (see
// test-quick-editor-host-surface.mjs's boundary checks). Instead useQuickEditorEscape
// registers as a generic launcher escape interceptor, and its own handleEscape gates
// on quickEditorCommandOpen to hand off to the overlay's handler before running its
// own two-stage hint/exit logic.
assert.match(
  quickEditorEscape,
  /if \(useAppStore\.getState\(\)\.quickEditorCommandOpen\)[\s\S]{0,80}return quickEditorImperative\.handleOverlayEscape\(event\)/,
  'Quick Editor escape interceptor should leave Escape to the command overlay while it is open',
)

console.log('Quick Editor launcher behavior checks passed')
