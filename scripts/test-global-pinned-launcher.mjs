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
  commandPalette: read('src/components/CommandPalette.tsx'),
  corePlugin: readOptional('src/workspace/corePlugin.ts'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  builtinIndex: read('src/builtin-plugins/index.json'),
  app: read('src/App.tsx'),
  globalPinnedLauncherHotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  main: read('src/main.tsx'),
  indexCss: read('src/index.css'),
  store: read('src/store.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
  tauriHotkeys: read('src-tauri/src/hotkeys.rs'),
  searchRanking: read('src/workspace/searchRanking.ts'),
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
    /['"]pinned-only['"]\s*===\s*(?:mode|globalLauncherMode|launcherMode)[\s\S]{0,160}return\s+pinned/,
    'pinned-only branch should keep pinned shortcuts local while domain launcher items are merged separately',
  )
  assertHas(
    files.globalLauncher,
    /pinnedActions\.map/,
    'pinned-only branch should still derive pinned action items from pinnedActions',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /viewItems/,
    'workspace views should come from host launcher actions, not local GlobalLauncher-only items',
  )
})

check('main panel launcher command is contributed by host launcher actions', () => {
  assert.doesNotMatch(
    files.corePlugin,
    /core\.show-main-panel|show-main-panel[\s\S]{0,220}setActiveView/,
    'main panel command should not live in the internal core plugin',
  )
  assertHas(
    files.hostActions,
    /systemKey:\s*['"]host:view:editor['"][\s\S]{0,520}showMainPanel\(\)/,
    'host launcher actions should contribute the main panel command through the launcher API',
  )
  assertHas(
    files.hostActions,
    /systemKey:\s*['"]host:view:editor['"][\s\S]{0,520}surfaces:\s*\[\s*['"]global-launcher['"]\s*\]/,
    'main panel launcher action should only appear in the global launcher',
  )
  assertHas(
    files.hostActions,
    /legacyUsageKeys:\s*\[[\s\S]*['"]show-main-panel['"][\s\S]*['"]core-pane\.show-main-panel['"][\s\S]*\]/,
    'host main panel item should preserve usage ranking from the retired core-pane action',
  )
  assertHas(
    files.app,
    /listen\(['"]hiven:\/\/show-main-panel['"][\s\S]{0,260}setActiveView\(['"]editor['"]\)/,
    'main window should handle show-main-panel requests from the standalone launcher',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /resolveCommand\(['"]core-pane\.show-main-panel['"]\)/,
    'global launcher should not hard-code the main panel command as a launcher item',
  )
  const builtinIndex = JSON.parse(files.builtinIndex)
  assert.equal(builtinIndex.packages?.some((entry) => entry.pluginId === 'core-pane'), false, 'core-pane should be retired from builtin plugins')
})

check('pinned launcher command titles follow current locale', () => {
  assertHas(
    files.globalLauncher,
    /pinnedActions\.map[\s\S]{0,260}localized\(item\.title,\s*item\.titleI18n,\s*locale\)/,
    'pinned launcher items should localize their persisted launcher shortcut title',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /pluginRegistry\.resolveCommand\([\s\S]{0,160}item\.actionId/,
    'pinned launcher items should not refresh launcher display by resolving old command ids',
  )
})

check('global launcher renders a single ranked list without category sections', () => {
  assert.doesNotMatch(
    files.globalLauncher,
    /function\s+LauncherSection|<LauncherSection/,
    'GlobalLauncher should not render category sections',
  )
  assertHas(
    files.globalLauncher,
    /<LauncherList[\s\S]{0,160}items=\{visibleFiltered\}/,
    'GlobalLauncher should render the ranked filtered list directly',
  )
})

check('global launcher keeps keyboard selection visible while navigating', () => {
  assertHas(
    files.globalLauncher,
    /function\s+LauncherList[\s\S]*selected[\s\S]*<LauncherListItem/,
    'LauncherList should render item rows through a component that can react when selected changes',
  )
  assertHas(
    files.globalLauncher,
    /function\s+LauncherListItem[\s\S]*useRef<HTMLButtonElement>[\s\S]*scrollIntoView\(\{\s*block:\s*['"]nearest['"]\s*\}\)/,
    'GlobalLauncher selected rows should scroll into view as keyboard navigation changes selection',
  )
})

check('main window supports Cmd or Ctrl K as an in-app global launcher shortcut', () => {
  assertHas(
    files.app,
    /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)[\s\S]{0,180}!e\.shiftKey[\s\S]{0,180}e\.key\.toLowerCase\(\)\s*===\s*['"]k['"][\s\S]{0,180}setCommandPaletteOpen\(true\)/,
    'MainApp should open the in-app launcher with Cmd/Ctrl+K when not recording shortcuts',
  )
  assert.doesNotMatch(
    files.app,
    /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)[\s\S]{0,180}!e\.shiftKey[\s\S]{0,180}e\.key\.toLowerCase\(\)\s*===\s*['"]k['"][\s\S]{0,180}openGlobalLauncher\(['"]full['"]\)/,
    'Cmd/Ctrl+K should not open the global launcher; it should open the in-app launcher',
  )
  assert.doesNotMatch(
    files.app,
    /\(e\.metaKey\s*\|\|\s*e\.ctrlKey\)\s*&&\s*e\.shiftKey\s*&&\s*e\.key\.toLowerCase\(\)\s*===\s*['"]k['"][\s\S]{0,180}openGlobalLauncher\(['"]full['"]\)/,
    'MainApp should not add a local Cmd/Ctrl+Shift+K launcher path; configured global hotkeys handle app-internal/app-external routing',
  )
})

check('launcher surfaces do not auto-discover legacy plugin commands', () => {
  assert.doesNotMatch(
    files.globalLauncher,
    /pluginRegistry\.getAllCommands\(\)/,
    'GlobalLauncher should not auto-discover plugin commands; commands must be exposed as launcher items or tools',
  )
  assert.doesNotMatch(
    files.commandPalette,
    /pluginRegistry\.getAllCommands\(\)/,
    'CommandPalette should not auto-discover plugin commands; commands must be exposed as launcher items or tools',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /hiven:\/\/run-plugin-command|runPluginCommandById/,
    'GlobalLauncher should not execute legacy plugin commands outside LauncherController',
  )
  assert.doesNotMatch(
    files.app,
    /hiven:\/\/run-plugin-command|runPluginCommandById/,
    'App should not keep a cross-window legacy plugin command execution protocol for launcher selections',
  )
})

check('global launcher reuses shared search ranking logic', () => {
  assertHas(
    files.globalLauncher,
    /scoreSearchableFields|searchableFieldsMatch/,
    'GlobalLauncher should use shared search ranking helpers instead of local ranking logic',
  )
  assertHas(
    files.searchRanking,
    /recentNames\.indexOf\(usageKey\)/,
    'shared search ranking should include recency',
  )
  assertHas(
    files.searchRanking,
    /Math\.log1p\(usageCounts\[usageKey\]/,
    'shared search ranking should include usage frequency',
  )
  assertHas(
    files.searchRanking,
    /tier\s*\*\s*1000\s*\+\s*baseScore/,
    'shared search ranking should combine match quality with recent usage',
  )
  assertHas(
    files.searchRanking,
    /aliases[\s\S]*pinyinMatch\(alias,\s*q\)[\s\S]*mixedAcronymMatch\(alias,\s*q\)/,
    'shared search ranking should apply pinyin and acronym matching to aliases',
  )
  assertHas(
    files.globalLauncher,
    /visibleFiltered\.length\s*===\s*1\s*\?\s*visibleFiltered\[0\]\s*:\s*visibleFiltered\[clampedSelectedIndex\]/,
    'GlobalLauncher should select the only result directly when a query narrows to one item',
  )
})

check('selecting a pinned item still opens the pinned action', () => {
  assertHas(
    files.globalLauncher,
    /item\.kind\s*===\s*['"]pinned['"][\s\S]{0,180}openPinnedAction\(item\.id\)|openPinnedAction\(item\.id\)[\s\S]{0,180}item\.kind\s*===\s*['"]pinned['"]/,
    'selecting a pinned launcher item should call openPinnedAction(item.id)',
  )
})

check('standalone domain launcher items stay on the launcher controller path', () => {
  assert.doesNotMatch(
    files.globalLauncher,
    /hiven:\/\/run-plugin-command[\s\S]{0,240}domainItem\.systemKey|domainItem\.systemKey[\s\S]{0,240}hiven:\/\/run-plugin-command/,
    'standalone domain launcher items must not emit systemKey to hiven://run-plugin-command',
  )
  assertHas(
    files.globalLauncher,
    /item\.kind\s*===\s*['"]domain['"][\s\S]*executeDomainItem\(item\.domainItem[\s\S]*function\s+executeDomainItem[\s\S]*controller\.selectItem\(item(?:,\s*\{[\s\S]{0,80}\})?\)/,
    'domain launcher items should execute through LauncherController so output keeps the launcher open',
  )
})

check('launcher UI business logic does not parse systemKey for legacy command ids', () => {
  assertHas(
    files.globalLauncher,
    /systemKey\.startsWith\(['"]plugin-surface:/,
    'GlobalLauncher may parse only explicit plugin-surface system keys for opening plugin UI surfaces',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /(?:legacyUsageKeys|commandId|run-plugin-command)[\s\S]{0,180}systemKey\.split\(/,
    'GlobalLauncher should not parse systemKey for legacy command ids',
  )
  assert.doesNotMatch(
    files.commandPalette,
    /systemKey\.split\(/,
    'CommandPalette should use explicit legacyUsageKeys instead of parsing systemKey',
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
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*[^=]*=>\s*\{[\s\S]*?useAppStore\.getState\(\)\.openGlobalLauncherOverlay\(['"]pinned-only['"]\)/)?.[0] ?? ''
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
    /setPosition\(new LogicalPosition\(saved\.x,\s*saved\.y\)\)/,
    'LauncherWindowApp should restore the persisted launcher window position before reuse',
  )
})

check('standalone launcher ignores in-app panel drag coordinates', () => {
  assertHas(
    files.globalLauncher,
    /standaloneLauncher[\s\S]{0,520}startDragging\(\)/,
    'standalone launcher should keep the panel fixed inside its transparent native window and move only the native window',
  )
})

check('standalone launcher sizes the transparent window to the panel', () => {
  assertHas(
    files.tauriLib,
    /if\s+!was_visible[\s\S]{0,260}set_size\(LogicalSize::new\(\s*LAUNCHER_COMPACT_WIDTH,\s*LAUNCHER_COMPACT_HEIGHT,\s*\)\)/,
    'native launcher show path should compact the transparent window only before first show',
  )
  assertHas(
    files.globalLauncher,
    /new LogicalSize\(nextWidth,\s*nextHeight\)/,
    'standalone launcher should resize the native window using the measured panel size',
  )
  assertHas(
    files.globalLauncher,
    /surfaceShell\?\.defaultHeight[\s\S]{0,160}measureStandaloneLauncherPanelHeight\(panel\)[\s\S]{0,260}STANDALONE_LAUNCHER_VERTICAL_PADDING/,
    'standalone launcher should use surface height when present and otherwise include only a small transparent margin around measured panel content',
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
    files.globalLauncher,
    /STANDALONE_SURFACE_MAX_HEIGHT\s*=\s*760/,
    'standalone tool-shell surfaces should not be capped by the compact launcher list height',
  )
  assertHas(
    files.globalLauncher,
    /surfaceShell\?\.defaultHeight[\s\S]{0,520}STANDALONE_SURFACE_MAX_HEIGHT/,
    'standalone sizing should use surface shell height when a plugin surface is open',
  )
  assertHas(
    files.globalLauncher,
    /surfaceShell\?\.defaultWidth[\s\S]{0,520}STANDALONE_SURFACE_MAX_WIDTH/,
    'standalone sizing should use surface shell width when a plugin surface is open',
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
    /closest\(['"]input,\s*textarea,\s*select,\s*button,\s*a,\s*\[role="button"\],\s*\[data-no-drag\],\s*\[data-launcher-scrollable\]['"]\)/,
    'GlobalLauncher drag handling should preserve interactive controls and scrollable regions',
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
  assertHas(
    files.app,
    /function\s+shouldAllowLauncherListWheel[\s\S]{0,900}data-launcher-scrollable[\s\S]{0,900}scrollTop/,
    'LauncherWindowApp should also allow wheel scrolling inside launcher-owned modal scroll bodies',
  )
  assertHas(
    files.globalLauncher,
    /closest\(['"][\s\S]{0,180}data-launcher-scrollable[\s\S]{0,180}\)/,
    'Global launcher dragging should not start from scrollable surface bodies or their scrollbars',
  )
})

check('native launcher opens centered only when there is no persisted window position', () => {
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*[^=]*=>\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
  assert.ok(launcherOpen, 'LauncherWindowApp should define an openLauncher handler')
  const restoreBranchIndex = launcherOpen.indexOf('if (!saved || !isLauncherPositionFresh(saved)) return')
  const restoreIndex = launcherOpen.indexOf('setPosition(new LogicalPosition(saved.x, saved.y))')
  const centerIndex = files.tauriLib.indexOf('center_launcher_window(&window)')
  assert.ok(restoreBranchIndex >= 0, 'openLauncher should branch on the persisted launcher window position')
  assert.ok(restoreIndex >= 0, 'openLauncher should restore the persisted launcher position')
  assert.ok(centerIndex >= 0, 'native launcher path should center the launcher when no persisted position exists')
  assert.ok(
    restoreBranchIndex < restoreIndex,
    'openLauncher should prefer a fresh persisted position over the native centered default',
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
    /updateSetting\(['"]globalLauncherWindowPosition['"][\s\S]*updateSetting\(['"]globalLauncherWindowPositionSource['"],\s*['"]user['"]\)/,
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
    /suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}setPosition\(new LogicalPosition\(saved\.x,\s*saved\.y\)\)/,
    'restoring a saved launcher position should suppress the resulting programmatic move event',
  )
  assertHas(
    files.app,
    /onMoved\([\s\S]{0,520}launcherProgrammaticMoveRef\.current[\s\S]{0,420}return/,
    'launcher movement persistence should ignore programmatic positioning events',
  )
  assertHas(
    files.app,
    /suppressProgrammaticMove\s*=\s*\(\)\s*=>\s*suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}addEventListener\(LAUNCHER_PROGRAMMATIC_MOVE_EVENT,\s*suppressProgrammaticMove\)/,
    'LauncherWindowApp should suppress native move persistence when another launcher component declares a programmatic resize or move',
  )
  assertHas(
    files.globalLauncher,
    /dispatchEvent\(new CustomEvent\(LAUNCHER_PROGRAMMATIC_MOVE_EVENT\)\)[\s\S]{0,220}\.setSize\(new LogicalSize\(nextWidth,\s*nextHeight\)\)/,
    'standalone launcher surface resizing should not persist the resulting native move as a user drag',
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
    /window\.addEventListener\(['"]keydown['"],\s*handleHostEscape,\s*true\)/,
    'Escape should be captured by the launcher host even when a plugin surface owns focus',
  )
  assertHas(
    files.globalLauncher,
    /function|const\s+handleHostEscape[\s\S]{0,700}controllerRef\.current\?\.back\(\)[\s\S]{0,260}closeLauncher\(\)/,
    'host Escape should go back from nested launcher frames before closing the launcher',
  )
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
  assertHas(
    files.globalLauncher,
    /const\s+resetLauncherSession[\s\S]{0,500}setSurfaceFrame\(null\)[\s\S]{0,500}controllerRef\.current\?\.reset\(\)/,
    'closing the launcher should reset plugin surface and controller state',
  )
  assertHas(
    files.globalLauncher,
    /if\s*\(open\)\s*return[\s\S]{0,220}setSurfaceFrame\(null\)/,
    'closed launcher state should not retain a plugin surface for the next open',
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

check('global shortcut routes to in-app command palette when the editor window is focused', () => {
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /routeGlobalPinnedLauncherShortcut/,
    'global shortcut callbacks should share a foreground-aware launcher route',
  )
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /getCurrentWindow\(\)\.isFocused\(\)/,
    'global shortcut route should inspect whether the main window is currently focused',
  )
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /activeView\s*!={1,2}\s*['"]editor['"][\s\S]{0,80}return\s+false/,
    'global shortcut route should reject in-app command palette routing outside the editor view',
  )
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /shouldOpenCommandPaletteInMainWindow\(\)[\s\S]{0,180}setCommandPaletteOpen\(true\)/,
    'when the focused app window is the editor, global shortcut should open the in-app command palette',
  )
  assertHas(
    files.globalPinnedLauncherHotkeys,
    /showLauncherWindow\(\)/,
    'non-editor or background shortcuts should still fall back to the standalone global launcher',
  )
  assertHas(
    files.app,
    /listen\([\s\S]{0,120}hiven:\/\/route-global-pinned-launcher-shortcut[\s\S]{0,220}routeGlobalPinnedLauncherShortcut\(\)/,
    'double-modifier native events should use the same foreground-aware route as accelerator shortcuts',
  )
})

check('native double-modifier opens standalone launcher directly when the main window is not focused', () => {
  const routePinnedLauncherFn = files.tauriHotkeys.match(/fn\s+route_pinned_launcher_hotkey[\s\S]*?\n}\n\n\/\/\/ Poke/)?.[0] ?? ''
  assert.ok(routePinnedLauncherFn, 'src-tauri/src/hotkeys.rs should route double-modifier triggers outside the event tap callback')
  assertHas(
    files.tauriHotkeys,
    /std::thread::spawn/,
    'native double-modifier callback should hand off routing work instead of doing window operations inside CGEventTap',
  )
  assertHas(
    routePinnedLauncherFn,
    /get_webview_window\("main"\)[\s\S]{0,180}is_focused\(\)/,
    'native double-modifier routing should inspect whether the main window is focused',
  )
  assertHas(
    routePinnedLauncherFn,
    /if\s+main_window_focused[\s\S]{0,180}emit\(ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT/,
    'native double-modifier routing should preserve the in-app command palette route when the main window is focused',
  )
  assertHas(
    routePinnedLauncherFn,
    /show_launcher_window_for_hotkey\(app\)/,
    'native double-modifier routing should open the standalone launcher directly while the app is in the background',
  )
})

check('native launcher show path preserves main window visibility state', () => {
  const launcherFn = files.tauriLib.match(/pub\(crate\)\s+fn\s+show_launcher_window_for_hotkey[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? ''
  assert.doesNotMatch(
    launcherFn,
    /window\.show\(\)/,
    'show_launcher_window_for_hotkey should not use Tauri window.show on the standalone launcher because it can activate the whole app',
  )
  assert.doesNotMatch(
    launcherFn,
    /window\.set_focus\(\)/,
    'show_launcher_window_for_hotkey should not use Tauri set_focus because it activates the whole app and flashes the main window',
  )
  assertHas(
    launcherFn,
    /show_launcher_window_without_app_activation\(&window\)/,
    'show_launcher_window_for_hotkey should use a macOS non-activating show/focus path for the standalone launcher',
  )
  assert.doesNotMatch(
    launcherFn,
    /hide_main_window_before_launcher|window\.hide\(\)/,
    'show_launcher_window_for_hotkey should not hide the main window; launcher close should preserve the previous foreground state',
  )
  assertHas(
    launcherFn,
    /was_visible[\s\S]*if\s+!was_visible[\s\S]*window\.emit\(['"]hiven:\/\/launcher-open['"]/,
    'show_launcher_window_for_hotkey should still reset launcher UI only for a newly shown launcher',
  )
})

check('native launcher close restores the previously foreground app instead of activating main', () => {
  const launcherFn = files.tauriLib.match(/pub\(crate\)\s+fn\s+show_launcher_window_for_hotkey[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? ''
  const hideFn = files.tauriLib.match(/async\s+fn\s+hide_launcher_window[\s\S]*?\n}\n\nfn\s+/)?.[0] ?? ''
  assertHas(
    files.tauriLib,
    /PREVIOUS_FOREGROUND_PROCESS_ID/,
    'native launcher should remember which app was foreground before standalone launcher focus',
  )
  assertHas(
    launcherFn,
    /remember_previous_foreground_app\(\)/,
    'showing a standalone launcher should capture the prior foreground app before focusing launcher',
  )
  assertHas(
    hideFn,
    /restore_previous_foreground_app\(\)/,
    'hiding a standalone launcher should restore focus to the app that was foreground before launcher opened',
  )
  const restoreIndex = hideFn.indexOf('restore_previous_foreground_app()')
  const hideIndex = hideFn.indexOf('window.hide()')
  assert.ok(restoreIndex >= 0 && hideIndex >= 0, 'hide_launcher_window should restore and hide')
  assert.ok(
    restoreIndex < hideIndex,
    'hide_launcher_window should restore the previous foreground app before hiding the launcher to avoid briefly activating main',
  )
  assertHas(
    files.tauriLib,
    /runningApplicationWithProcessIdentifier[\s\S]{0,260}activateWithOptions/,
    'macOS restore should activate the previous foreground process, not the Hiven main window',
  )
})

check('native launcher is configured as a non-activating macOS panel', () => {
  assertHas(
    files.tauriConfig,
    /"label":\s*"launcher"[\s\S]{0,520}"focus":\s*false/,
    'launcher window config should not ask Tauri to focus the standalone window during creation',
  )
  assertHas(
    files.tauriLib,
    /promote_window_to_nonactivating_panel/,
    'native launcher should promote the standalone window into a non-activating panel',
  )
  assertHas(
    files.tauriLib,
    /NSWindowStyleMaskNonactivatingPanel|1usize\s*<<\s*7/,
    'native launcher should apply the NSWindowStyleMaskNonactivatingPanel style bit',
  )
  assertHas(
    files.tauriLib,
    /orderFrontRegardless[\s\S]{0,220}makeKeyWindow|makeKeyWindow[\s\S]{0,220}orderFrontRegardless/,
    'native launcher should order and key the panel without app activation',
  )
  assertHas(
    files.tauriLib,
    /makeFirstResponder:\s*ns_view/,
    'native launcher should make the WebView first responder so the search input receives keyboard focus',
  )
})

check('double modifier detection allows a natural second tap after a short release', () => {
  assertHas(
    files.tauriHotkeys,
    /DEFAULT_DOUBLE_MODIFIER_THRESHOLD_MS:\s*u64\s*=\s*500/,
    'double modifier detector should use the same 500ms window as shortcut recording',
  )
  assertHas(
    files.tauriHotkeys,
    /last_modifier_up/,
    'double modifier detector should measure the second tap from the first short release',
  )
  assertHas(
    files.tauriHotkeys,
    /current_modifier_down[\s\S]{0,360}was_short_press/,
    'double modifier detector should discard a first press that was held too long',
  )
  assertHas(
    files.tauriHotkeys,
    /default_double_modifier_window_accepts_500ms/,
    'double modifier tests should cover the default 500ms recognition window',
  )
  assertHas(
    files.tauriHotkeys,
    /listener_recovers_when_key_up_is_lost_after_trigger/,
    'double modifier tests should cover recovery when the trigger steals the key-up event',
  )
  assertHas(
    files.tauriHotkeys,
    /long_modifier_hold_then_second_down_does_not_trigger/,
    'double modifier tests should cover long hold followed by another press',
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
