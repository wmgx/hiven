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
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  app: read('src/App.tsx'),
  main: read('src/main.tsx'),
  indexCss: read('src/index.css'),
  store: read('src/store.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
  tauriConfig: read('src-tauri/tauri.conf.json'),
  tauriCapabilities: read('src-tauri/capabilities/default.json'),
}

const failures = []

function check(name, fn) {
  try {
    fn()
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

check('package.json exposes the global pinned launcher verifier', () => {
  const packageJson = JSON.parse(files.packageJson)
  assert.equal(
    packageJson.scripts?.['test:global-pinned-launcher'],
    'node scripts/test-global-pinned-launcher.mjs',
    'package.json should expose test:global-pinned-launcher',
  )
})

check('GlobalLauncher models full and pinned-only modes', () => {
  assertHas(
    files.globalLauncher,
    /GlobalLauncherMode|globalLauncherMode|launcherMode|mode:\s*['"](?:full|pinned-only)['"]/,
    'GlobalLauncher should define or consume a launcher mode',
  )
  assertHas(
    files.globalLauncher,
    /['"]pinned-only['"]/,
    'GlobalLauncher should support a pinned-only mode literal',
  )
})

check('pinned-only mode only builds pinned action items', () => {
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)\s*={0,2}\s*['"]pinned-only['"]|['"]pinned-only['"]\s*===\s*(?:mode|globalLauncherMode|launcherMode)/,
    'items construction should branch on pinned-only mode',
  )
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,240}pinnedActions\.map|pinnedActions\.map[\s\S]{0,240}(?:mode|globalLauncherMode|launcherMode)/,
    'pinned-only branch should derive items from pinnedActions',
  )
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,360}(?:recentActionNames|viewItems)|(?:recentActionNames|viewItems)[\s\S]{0,360}(?:mode|globalLauncherMode|launcherMode)/,
    'recent commands and workspace views should be gated by full mode',
  )
})

check('pinned-only render path does not show Recent or Views sections', () => {
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,260}palette\.globalRecent|palette\.globalRecent[\s\S]{0,260}(?:mode|globalLauncherMode|launcherMode)/,
    'Recent section should be conditional on full mode',
  )
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,260}palette\.globalViews|palette\.globalViews[\s\S]{0,260}(?:mode|globalLauncherMode|launcherMode)/,
    'Views section should be conditional on full mode',
  )
})

check('selecting a pinned item still opens the pinned action', () => {
  assertHas(
    files.globalLauncher,
    /item\.kind\s*===\s*['"]pinned['"][\s\S]{0,180}openPinnedAction\(item\.id\)|openPinnedAction\(item\.id\)[\s\S]{0,180}item\.kind\s*===\s*['"]pinned['"]/,
    'selecting a pinned launcher item should call openPinnedAction(item.id)',
  )
})

check('App listens for the Tauri open-pinned-launcher event', () => {
  assertHas(
    files.app,
    /@tauri-apps\/api\/event|from\s+['"]@tauri-apps\/api\/event['"]/,
    'App should import the Tauri event listener API',
  )
  assertHas(
    files.app,
    /listen\([\s\S]{0,120}fluxtext:\/\/open-pinned-launcher|fluxtext:\/\/open-pinned-launcher[\s\S]{0,120}listen\(/,
    'App should listen for the fluxtext://open-pinned-launcher event',
  )
  assertHas(
    files.app,
    /show_launcher_window/,
    'Tauri event handler should open the standalone launcher window',
  )
})

check('Tauri config defines a standalone launcher window', () => {
  const config = JSON.parse(files.tauriConfig)
  const launcher = config.app?.windows?.find((window) => window.label === 'launcher')
  assert.ok(launcher, 'tauri.conf.json should define a launcher window')
  assert.equal(launcher.visible, false, 'launcher window should not open at startup')
  assert.equal(launcher.decorations, false, 'launcher window should be undecorated')
  assert.equal(launcher.transparent, true, 'launcher window should be transparent')
})

check('launcher window has IPC capability access', () => {
  const capabilities = JSON.parse(files.tauriCapabilities)
  assert.ok(
    capabilities.windows?.includes('launcher'),
    'default capability should include the launcher window',
  )
})

check('launcher route clears the document background', () => {
  assertHas(
    files.main,
    /document\.documentElement\.dataset\.window\s*=\s*['"]launcher['"]/,
    'main.tsx should mark launcher windows on the document element',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\][\s\S]{0,180}background:\s*transparent/,
    'launcher window document background should be transparent',
  )
})

check('standalone launcher closes on Escape without bubbling to the app', () => {
  assertHas(
    files.globalLauncher,
    /event\.key\s*===\s*['"]Escape['"][\s\S]{0,180}event\.preventDefault\(\)[\s\S]{0,180}event\.stopPropagation\(\)[\s\S]{0,180}closeLauncher\(\)/,
    'Escape should only close the global launcher and stop app-level key handlers',
  )
  assertHas(
    files.globalLauncher,
    /invoke\(\s*['"]hide_launcher_window['"]\s*\)/,
    'canceling the standalone launcher should only hide the launcher window',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /hideApp:\s*true/,
    'canceling the standalone launcher should not hide/unhide the whole app because that flashes and can restore the main window',
  )
})

check('standalone launcher closes when its window loses focus', () => {
  assertHas(
    files.globalLauncher,
    /onFocusChanged\([\s\S]{0,220}payload:\s*focused[\s\S]{0,160}if\s*\(!focused\)\s*closeLauncher\(\)/,
    'standalone launcher should hide itself when the launcher window loses focus',
  )
})

check('native launcher show path does not activate the full app window stack', () => {
  const launcherFn = files.tauriLib.match(/pub\(crate\)\s+fn\s+show_launcher_window_for_hotkey[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? ''
  assert.ok(launcherFn, 'src-tauri/src/lib.rs should expose show_launcher_window_for_hotkey')
  assert.doesNotMatch(
    launcherFn,
    /activate_app\s*\(/,
    'show_launcher_window_for_hotkey should not activate the whole app, which can bring the main window forward',
  )
})

check('native launcher show path hides the main window before focusing launcher', () => {
  const launcherFn = files.tauriLib.match(/pub\(crate\)\s+fn\s+show_launcher_window_for_hotkey[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? ''
  const hideMainIndex = launcherFn.indexOf('hide_main_window_before_launcher(&app_clone)')
  const focusIndex = launcherFn.indexOf('window.set_focus()')
  assert.ok(hideMainIndex >= 0, 'show_launcher_window_for_hotkey should hide main before showing launcher')
  assert.ok(focusIndex >= 0, 'show_launcher_window_for_hotkey should still focus launcher for keyboard input')
  assert.ok(
    hideMainIndex < focusIndex,
    'show_launcher_window_for_hotkey should hide main before focusing launcher, because set_focus activates the macOS app',
  )
})

check('store exposes an API for opening the launcher with a mode', () => {
  assertHas(
    files.store,
    /openGlobalLauncher\s*:\s*\([^)]*mode|setGlobalLauncherMode\s*:/,
    'store should expose a mode-aware global launcher API',
  )
})

if (failures.length > 0) {
  console.error(`global pinned launcher checks failed (${failures.length}):`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('global pinned launcher checks passed')
