#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readOptional(path) {
  try {
    return readFileSync(join(root, path), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

const files = {
  packageJson: read('package.json'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  corePlugin: readOptional('src/workspace/corePlugin.ts'),
  corePanePlugin: read('src/plugins/core-pane/index.ts'),
  corePaneManifest: read('src/plugins/core-pane/manifest.json'),
  builtinIndex: read('src/builtin-plugins/index.json'),
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

check('pinned-only mode builds launcher commands and pinned action items', () => {
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)\s*={0,2}\s*['"]pinned-only['"]|['"]pinned-only['"]\s*===\s*(?:mode|globalLauncherMode|launcherMode)/,
    'items construction should branch on pinned-only mode',
  )
  assertHas(
    files.globalLauncher,
    /['"]pinned-only['"]\s*===\s*(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,220}\.\.\.pinned[\s\S]{0,120}\.\.\.launcherCommands/,
    'pinned-only branch should include launcher system commands and pinned actions',
  )
  assertHas(
    files.globalLauncher,
    /pinnedActions\.map/,
    'pinned-only branch should still derive pinned action items from pinnedActions',
  )
  assertHas(
    files.globalLauncher,
    /(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,360}(?:recentActionNames|viewItems)|(?:recentActionNames|viewItems)[\s\S]{0,360}(?:mode|globalLauncherMode|launcherMode)/,
    'recent commands and workspace views should be gated by full mode',
  )
})

check('main panel launcher command is contributed by the external core-pane plugin', () => {
  assert.doesNotMatch(
    files.corePlugin,
    /core\.show-main-panel|show-main-panel[\s\S]{0,220}setActiveView/,
    'main panel command should not live in the internal core plugin',
  )
  assertHas(
    files.corePanePlugin,
    /id:\s*['"]core-pane\.show-main-panel['"][\s\S]{0,420}app\.showMainPanel/,
    'core-pane plugin should contribute the main panel command through a host effect',
  )
  assertHas(
    files.globalLauncher,
    /resolveCommand\(['"]core-pane\.show-main-panel['"]\)/,
    'global launcher should resolve the external core-pane command',
  )
  const manifest = JSON.parse(files.corePaneManifest)
  const builtinIndex = JSON.parse(files.builtinIndex)
  const corePaneEntry = builtinIndex.packages?.find((entry) => entry.pluginId === 'core-pane')
  assert.equal(manifest.version, '1.2.0', 'core-pane manifest version should be bumped for the new command')
  assert.equal(corePaneEntry?.version, '1.2.0', 'builtin plugin index should publish the bumped core-pane version')
})

check('pinned launcher command titles follow current locale', () => {
  assertHas(
    files.globalLauncher,
    /pinnedActions\.map[\s\S]{0,420}localized\([\s\S]{0,120}titleI18n[\s\S]{0,80}locale/,
    'pinned launcher items should localize command titles from titleI18n instead of rendering the persisted title verbatim',
  )
  assertHas(
    files.globalLauncher,
    /pluginRegistry\.resolveCommand\([\s\S]{0,160}item\.actionId/,
    'pinned launcher items should refresh command metadata from the plugin registry when available',
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
    /listen\([\s\S]{0,120}hiven:\/\/open-pinned-launcher|hiven:\/\/open-pinned-launcher[\s\S]{0,120}listen\(/,
    'App should listen for the hiven://open-pinned-launcher event',
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
  assert.equal(
    launcher.height,
    390,
    'launcher window should be tall enough to match the in-app command palette result area instead of clipping it',
  )
  assert.equal(launcher.visible, false, 'launcher window should not open at startup')
  assert.equal(launcher.decorations, false, 'launcher window should be undecorated')
  assert.equal(launcher.transparent, true, 'launcher window should be transparent around the opaque panel')
  assert.equal(launcher.shadow, false, 'launcher window should not draw a native rectangular shadow around transparent content')
})

check('launcher window has IPC capability access', () => {
  const capabilities = JSON.parse(files.tauriCapabilities)
  assert.ok(
    capabilities.windows?.includes('launcher'),
    'default capability should include the launcher window',
  )
})

check('launcher window has native window movement permissions', () => {
  const capabilities = JSON.parse(files.tauriCapabilities)
  assert.ok(
    capabilities.permissions?.includes('core:window:allow-start-dragging'),
    'launcher capability should allow startDragging so native drag regions can move the window',
  )
  assert.ok(
    capabilities.permissions?.includes('core:window:allow-set-position'),
    'launcher capability should allow restoring persisted window positions',
  )
  assert.ok(
    capabilities.permissions?.includes('core:window:allow-set-size'),
    'launcher capability should allow sizing the transparent launcher window to its panel',
  )
  assert.ok(
    capabilities.permissions?.includes('core:window:allow-center'),
    'launcher capability should allow centering the window when no persisted position exists',
  )
})

check('launcher route clears the document background outside the panel', () => {
  assertHas(
    files.main,
    /document\.documentElement\.dataset\.window\s*=\s*['"]launcher['"]/,
    'main.tsx should mark launcher windows on the document element',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\][\s\S]{0,180}background:\s*transparent/,
    'launcher window document background should be transparent outside the rounded panel',
  )
})

check('standalone launcher rehydrates persisted settings before opening', () => {
  assertHas(
    files.app,
    /useAppStore\.persist\.rehydrate\(\)/,
    'LauncherWindowApp should rehydrate persisted settings so theme changes from the main window are fresh',
  )
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*[^=]*=>\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
  assert.ok(launcherOpen, 'LauncherWindowApp should define an openLauncher handler')
  const rehydrateIndex = launcherOpen.indexOf('rehydrate')
  const openIndex = launcherOpen.indexOf('openGlobalLauncherOverlay')
  assert.ok(rehydrateIndex >= 0, 'openLauncher should rehydrate persisted settings')
  assert.ok(openIndex >= 0, 'openLauncher should open the launcher overlay')
  assert.ok(
    rehydrateIndex < openIndex,
    'openLauncher should rehydrate persisted settings before opening the launcher overlay',
  )
})

check('launcher panel height matches the in-app command palette list height', () => {
  assertHas(
    files.indexCss,
    /--command-palette-list-max-height:\s*300px/,
    'CSS should expose the in-app command palette list height as a shared token',
  )
  assertHas(
    files.indexCss,
    /\.command-palette-results[\s\S]{0,120}max-height:\s*var\(--command-palette-list-max-height\)/,
    'in-app CommandPalette should use the shared command palette list height',
  )
  assertHas(
    files.indexCss,
    /\.global-launcher-body[\s\S]{0,180}max-height:\s*var\(--command-palette-list-max-height\)/,
    'GlobalLauncher should use the same scrollable list height as CommandPalette',
  )
})

check('launcher panel drags the native launcher window and persists moved positions', () => {
  assertHas(
    files.store,
    /globalLauncherWindowPosition\??:\s*GlobalLauncherPosition/,
    'settings should persist the native global launcher window position',
  )
  assertHas(
    files.globalLauncher,
    /startDragging\(\)/,
    'GlobalLauncher should move the native launcher window instead of moving inside its own window',
  )
  assertHas(
    files.app,
    /onMoved\([\s\S]{0,760}updateSetting\(['"]globalLauncherWindowPosition['"]/,
    'LauncherWindowApp should persist native launcher movement from the Tauri window moved event',
  )
  assertHas(
    files.app,
    /setPosition\(new LogicalPosition\(position\.x,\s*position\.y\)\)/,
    'LauncherWindowApp should restore the persisted launcher window position before reuse',
  )
})

check('standalone launcher ignores in-app panel drag coordinates', () => {
  assertHas(
    files.globalLauncher,
    /const\s+currentPosition\s*=\s*standaloneLauncher\s*\?\s*undefined\s*:\s*\(dragPosition\s*\?\?\s*launcherPosition\)/,
    'standalone launcher should keep the panel fixed inside its transparent native window and move only the native window',
  )
})

check('standalone launcher sizes the transparent window to the panel', () => {
  assertHas(
    files.tauriLib,
    /set_size\(LogicalSize::new\(\s*LAUNCHER_COMPACT_WIDTH,\s*LAUNCHER_COMPACT_HEIGHT,\s*\)\)/,
    'native launcher show path should compact the transparent window before it is shown',
  )
  assertHas(
    files.globalLauncher,
    /new LogicalSize\(STANDALONE_LAUNCHER_WIDTH,\s*nextHeight\)/,
    'standalone launcher should resize the native window using the measured panel height',
  )
  assertHas(
    files.globalLauncher,
    /measureStandaloneLauncherPanelHeight\(panel\)[\s\S]{0,180}STANDALONE_LAUNCHER_VERTICAL_PADDING/,
    'standalone launcher should include only a small transparent margin around the measured panel content',
  )
  assertHas(
    files.globalLauncher,
    /body\.scrollHeight/,
    'standalone launcher should measure the intrinsic list height instead of the height clipped by the current compact window',
  )
  assertHas(
    files.globalLauncher,
    /\.global-launcher-header[\s\S]{0,180}\.global-launcher-body[\s\S]{0,180}\.global-launcher-footer/,
    'standalone launcher sizing should account for header, scrollable body, and footer separately',
  )
  assertHas(
    files.globalLauncher,
    /className=["'][^"']*global-launcher-footer/,
    'GlobalLauncher should expose a footer marker for standalone sizing',
  )
  assertHas(
    files.globalLauncher,
    /STANDALONE_LAUNCHER_MAX_HEIGHT\s*=\s*390/,
    'standalone launcher should keep the existing max height for long result lists',
  )
  assertHas(
    files.indexCss,
    /\.global-launcher-body[\s\S]{0,80}flex:\s*1/,
    'global launcher body should flex inside the bounded panel so the footer stays outside the scroll area',
  )
})

check('standalone launcher exposes the whole non-interactive panel as a drag surface', () => {
  assertHas(
    files.globalLauncher,
    /className="global-launcher-panel[\s\S]{0,220}onPointerDown=\{beginDrag\}/,
    'GlobalLauncher should bind drag handling to the panel so empty panel/header/body space can move the launcher',
  )
  assertHas(
    files.globalLauncher,
    /closest\(['"]input,\s*textarea,\s*select,\s*button,\s*a,\s*\[role="button"\],\s*\[data-no-drag\]['"]\)/,
    'GlobalLauncher drag handling should preserve interactive controls by excluding inputs, buttons, links, and explicit no-drag regions',
  )
  assertHas(
    files.globalLauncher,
    /import\s*\{[\s\S]{0,80}getCurrentWindow[\s\S]{0,80}\}\s*from\s*['"]@tauri-apps\/api\/window['"]/,
    'GlobalLauncher should import getCurrentWindow up front so native dragging starts during the pointerdown turn',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-panel[\s\S]{0,120}-webkit-app-region:\s*drag/,
    'standalone launcher should mark the panel as a native drag region as a fallback to JS dragging',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-panel\s+:is\(input,\s*textarea,\s*select,\s*button,\s*a,\s*\[role=['"]button['"]\],\s*\[data-no-drag\]\)[\s\S]{0,120}-webkit-app-region:\s*no-drag/,
    'standalone launcher should keep interactive controls out of the native drag region',
  )
})

check('standalone launcher suppresses trackpad text selection and context menu visual states', () => {
  assertHas(
    files.globalLauncher,
    /onContextMenu=\{\(event\)\s*=>\s*\{[\s\S]{0,220}event\.preventDefault\(\)/,
    'GlobalLauncher should suppress launcher-level context menus so two-finger press does not leave a selection highlight',
  )
  assertHas(
    files.indexCss,
    /\.global-launcher-panel[\s\S]{0,220}-webkit-user-select:\s*none[\s\S]{0,120}user-select:\s*none/,
    'GlobalLauncher panel should disable text selection to avoid trackpad press selection overlays',
  )
  assertHas(
    files.indexCss,
    /\.global-launcher-panel\s+input[\s\S]{0,180}-webkit-user-select:\s*text[\s\S]{0,120}user-select:\s*text/,
    'GlobalLauncher input should remain selectable/editable while the panel suppresses selection',
  )
})

check('standalone launcher locks webview document panning while preserving list scroll', () => {
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\],[\s\S]{0,180}html\[data-window=['"]launcher['"]\]\s+#root[\s\S]{0,220}overflow:\s*hidden[\s\S]{0,120}overscroll-behavior:\s*none[\s\S]{0,120}touch-action:\s*none/,
    'launcher document should lock viewport scrolling and overscroll rubber-banding',
  )
  assertHas(
    files.indexCss,
    /\.global-launcher-body[\s\S]{0,220}overscroll-behavior:\s*contain[\s\S]{0,120}touch-action:\s*pan-y/,
    'launcher result list should contain its own vertical scrolling without panning the WebView document',
  )
  assertHas(
    files.app,
    /addEventListener\(['"]wheel['"],\s*handleLauncherWheel[\s\S]{0,120}passive:\s*false[\s\S]{0,80}capture:\s*true/,
    'LauncherWindowApp should capture wheel events with passive:false so trackpad page panning can be prevented',
  )
  assertHas(
    files.app,
    /function\s+shouldAllowLauncherListWheel[\s\S]{0,900}deltaX[\s\S]{0,900}global-launcher-body[\s\S]{0,900}scrollTop/,
    'LauncherWindowApp should only allow wheel scrolling inside the launcher result list',
  )
})

check('native launcher opens centered only when there is no persisted window position', () => {
  assert.doesNotMatch(
    files.tauriLib,
    /window\.center\(\)/,
    'Rust launcher show path should not force-center and overwrite a persisted JS-restored position',
  )
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*[^=]*=>\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
  assert.ok(launcherOpen, 'LauncherWindowApp should define an openLauncher handler')
  const positionIndex = launcherOpen.indexOf('if (position')
  const restoreIndex = launcherOpen.indexOf('setPosition(new LogicalPosition(position.x, position.y))')
  const centerIndex = launcherOpen.indexOf('.center()')
  assert.ok(positionIndex >= 0, 'openLauncher should branch on the persisted launcher window position')
  assert.ok(restoreIndex >= 0, 'openLauncher should restore the persisted launcher position')
  assert.ok(centerIndex >= 0, 'openLauncher should center the launcher when no persisted position exists')
  assert.ok(
    positionIndex < restoreIndex && restoreIndex < centerIndex,
    'openLauncher should prefer the persisted position before falling back to center()',
  )
})

check('legacy launcher positions are not trusted unless they came from a user drag', () => {
  assertHas(
    files.store,
    /globalLauncherWindowPositionSource\??:\s*['"]user['"]/,
    'settings should mark whether a launcher window position was produced by a user drag',
  )
  assertHas(
    files.app,
    /globalLauncherWindowPositionSource\s*===\s*['"]user['"][\s\S]{0,160}globalLauncherWindowPosition/,
    'LauncherWindowApp should only restore persisted positions that came from a user drag',
  )
  assertHas(
    files.app,
    /updateSetting\(['"]globalLauncherWindowPosition['"][\s\S]{0,260}updateSetting\(['"]globalLauncherWindowPositionSource['"],\s*['"]user['"]\)/,
    'LauncherWindowApp should mark positions saved from native moved events as user positions',
  )
})

check('programmatic launcher positioning is not persisted as a user drag', () => {
  assertHas(
    files.app,
    /launcherProgrammaticMoveRef\s*=\s*useRef\(false\)/,
    'LauncherWindowApp should track programmatic launcher moves separately from user drags',
  )
  assertHas(
    files.app,
    /suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}setPosition\(new LogicalPosition\(position\.x,\s*position\.y\)\)/,
    'restoring a saved launcher position should suppress the resulting programmatic move event',
  )
  assertHas(
    files.app,
    /suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}\.center\(\)/,
    'centering the launcher should suppress the resulting programmatic move event',
  )
  assertHas(
    files.app,
    /onMoved\([\s\S]{0,520}launcherProgrammaticMoveRef\.current[\s\S]{0,420}return/,
    'launcher movement persistence should ignore programmatic positioning events',
  )
})

check('standalone drag path does not save a timed intermediate position', () => {
  assert.doesNotMatch(
    files.globalLauncher,
    /updateSetting\(['"]globalLauncherWindowPosition['"]/,
    'GlobalLauncher should not persist a timed intermediate drag position; onMoved owns native movement persistence',
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
