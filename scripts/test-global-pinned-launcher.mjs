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
  globalLauncher: [
    read('src/components/GlobalLauncher.tsx'),
    read('src/launcher/hosts/GlobalLauncherHost.tsx'),
    read('src/components/launcher/GlobalLauncherPanel.tsx'),
    read('src/components/launcher/GlobalLauncherFrames.tsx'),
    read('src/components/launcher/GlobalLauncherKeyboard.ts'),
    read('src/components/launcher/GlobalLauncherLayout.ts'),
    read('src/components/launcher/GlobalLauncherGeometry.ts'),
    read('src/components/launcher/GlobalLauncherClose.ts'),
    read('src/components/launcher/GlobalLauncherSelection.ts'),
    read('src/components/launcher/GlobalLauncherSurfaceRegistry.ts'),
    read('src/components/launcher/GlobalLauncherWindowLifecycle.ts'),
    read('src/workspace/windowManager/launcherWindow.ts'),
    read('src/components/launcher/GlobalLauncherSurfaceFrame.ts'),
    read('src/components/launcher/useGlobalLauncherSelectionController.ts'),
    read('src/components/launcher/GlobalLauncherResults.ts'),
    read('src/components/launcher/GlobalLauncherItems.ts'),
    read('src/components/launcher/LauncherMixedList.tsx'),
    read('src/components/launcher/GlobalLauncherSearchFrame.tsx'),
    read('src/components/launcher/GlobalLauncherHostLifecycle.ts'),
  ].join('\n'),

  corePlugin: readOptional('src/workspace/corePlugin.ts'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  builtinIndex: read('src/builtin-plugins/index.json'),
  app: read('src/App.tsx'),
  launcherList: read('src/components/launcher/LauncherMixedList.tsx'),
  globalPinnedLauncherHotkeys: read('src/hotkeys/globalPinnedLauncher.ts'),
  launcherWindowManager: read('src/workspace/windowManager/launcherWindow.ts'),
  main: read('src/main.tsx'),
  indexCss: read('src/index.css'),
  store: read('src/store.ts'),
  tauriLib: read('src-tauri/src/lib.rs'),
  tauriHotkeys: read('src-tauri/src/hotkeys.rs'),
  searchRanking: read('src/workspace/searchRanking.ts'),
  launcherRanking: read('src/workspace/launcher/ranking.ts'),
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
    /globalLauncherOpen|globalLauncherOverlay|openGlobalLauncherOverlay/,
    'GlobalLauncher should define or consume a launcher mode',
  )
  assertHas(
    files.globalLauncher,
    /globalLauncherOverlay|openGlobalLauncherOverlay/,
    'GlobalLauncher should support a pinned-only mode literal',
  )
})

check('pinned-only mode builds launcher commands and pinned action items', () => {
  assertHas(
    files.globalLauncher,
    /buildGlobalLauncherItems|rankedLauncherItems/,
    'items construction should branch on pinned-only mode',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /viewItems/,
    'workspace views should come from host launcher actions, not local GlobalLauncher-only items',
  )
})

check('buildGlobalLauncherItems preserves distinct actions with the same title and subtitle', () => {
  const items = read('src/components/launcher/GlobalLauncherItems.ts')
  assert.doesNotMatch(
    items,
    /seenRows|rowKey/,
    'display text is not action identity; browser tab/history and other distinct actions may share it',
  )
})

check('main panel launcher command is contributed by host launcher actions', () => {
  assert.doesNotMatch(
    files.corePlugin,
    /core\.show-main-panel|show-main-panel[\s\S]{0,220}setActiveView/,
    'main panel command should not live in the internal core plugin',
  )
  assert.doesNotMatch(
    files.hostActions,
    /systemKey:\s*['"]host:pane:new['"]|systemKey:\s*['"]host:pane:split-right['"]|systemKey:\s*['"]host:pane:split-down['"]/,
    'global host actions must not register pane new/split commands',
  )
  assert.doesNotMatch(
    files.hostActions,
    /core-pane\.show-main-panel|show-main-panel/,
    'retired main-panel usage keys should not be carried into editor-pane actions',
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
    /resolveDisplayTitle|locale/,
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
    /items=\{visibleFiltered\}/,
    'GlobalLauncher should render the ranked filtered list directly',
  )
})

check('global launcher keeps keyboard selection visible while navigating', () => {
  assertHas(
    files.launcherList,
    /function\s+LauncherMixedList[\s\S]*selected[\s\S]*<LauncherMixedListItem/,
    'LauncherList should render item rows through a component that can react when selected changes',
  )
  assertHas(
    files.launcherList,
    /isKeyboardNavRef[\s\S]*scrollIntoView\(\{\s*block:\s*['"]nearest['"]\s*\}\)/,
    'GlobalLauncher selected rows should scrollIntoView only during keyboard navigation (not hover)',
  )
})

check('main window supports Cmd or Ctrl K as an in-app global launcher shortcut', () => {
  assert.doesNotMatch(
    files.app,
    /e\.key\.toLowerCase\(\)\s*===\s*['"]k['"][\s\S]{0,180}setEditorCommandBarOpen\(true\)/,
    'retired main window should not own a local Cmd/Ctrl+K command palette path',
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
  // Text-match quality and usage signal were split apart: searchRanking.ts scores
  // how well a query matches an item's fields, launcher/ranking.ts owns frecency
  // and every other signal. The launcher must consume both rather than re-deriving
  // either one locally.
  assertHas(
    files.launcherRanking,
    /scoreSearchableFields|searchableFieldsMatch/,
    'launcher ranking should use shared search ranking helpers instead of local match logic',
  )
  assertHas(
    files.globalLauncher,
    /rankLauncherItems|rankedLauncherItems/,
    'GlobalLauncher should rank through the shared launcher ranker',
  )
  assertHas(
    files.launcherRanking,
    /Math\.log1p\(record\.count\)\s*\*\s*USAGE_FREQ_WEIGHT/,
    'launcher ranking should include usage frequency',
  )
  assertHas(
    files.launcherRanking,
    /export function frecencyScore/,
    'launcher ranking should include recency through frecency',
  )
  assertHas(
    files.searchRanking,
    /return searchableFieldsMatchTier\(fields, query, locale\) \* 1000/,
    'shared search ranking should score pure match quality, leaving usage to the launcher ranker',
  )
  assertHas(
    files.searchRanking,
    /for \(const alias of fields\.aliases[\s\S]*fieldTextMatchTier\(alias,\s*query/,
    'shared search ranking should match aliases via the shared field matcher',
  )
  assertHas(
    files.searchRanking,
    /tokenPrefixMatch|SUBSTRING_MIN_QUERY_LENGTH/,
    'shared search ranking should tighten short queries to token prefixes',
  )
  assertHas(
    files.globalLauncher,
    /visibleFiltered\.length\s*===\s*1\s*\?\s*visibleFiltered\[0\]\s*:\s*visibleFiltered\[clampedSelectedIndex\]/,
    'GlobalLauncher should select the only result directly when a query narrows to one item',
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
    /item\.kind\s*===\s*['"]domain['"][\s\S]*executeDomainItem\(item\.domainItem/,
    'domain launcher selection should route domain items to executeDomainItem',
  )
  assertHas(
    files.globalLauncher,
    /executeGlobalLauncherDomainItem[\s\S]*controller\.selectItem\(item(?:,\s*\{[\s\S]{0,80}\})?\)/,
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
})

check('App listens for the Tauri open-pinned-launcher event', () => {
  assertHas(
    files.app,
    /@tauri-apps\/api\/event|from\s+['"]@tauri-apps\/api\/event['"]/,
    'App should import the Tauri event listener API',
  )
  assertHas(
    files.app,
    /listen\([\s\S]{0,120}hiven:\/\/launcher-open|hiven:\/\/launcher-open[\s\S]{0,120}listen\(/,
    'App should listen for the hiven://launcher-open event',
  )
  assertHas(
    files.app,
    /openGlobalLauncherOverlay\(\)/,
    'launcher-open event handler should open the standalone launcher runtime overlay',
  )
})

check('Tauri config defines a standalone launcher window', () => {
  const config = JSON.parse(files.tauriConfig)
  const launcher = config.app?.windows?.find((window) => window.label === 'launcher')
  assert.ok(launcher, 'tauri.conf.json should define a launcher window')
  assert.equal(
    launcher.height,
    360,
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

check('standalone launcher opens synchronously and rehydrates after', () => {
  // This check used to require rehydrate-then-open. That ordering is now a known
  // regression: awaiting rehydrate first left the panel visible with no mounted
  // search input, so the native first responder had no caret to land on and the
  // user had to click before typing. Open is synchronous; rehydrate trails it.
  assertHas(
    files.app,
    /rehydratePersistedAppState\(\)/,
    'LauncherWindowApp should rehydrate persisted settings so theme changes from the main window are fresh',
  )
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*\(\)\s*=>\s*\{[\s\S]*?rehydratePersistedAppState/)?.[0] ?? ''
  assert.ok(launcherOpen, 'LauncherWindowApp should define an openLauncher handler')
  const openIndex = launcherOpen.indexOf('openGlobalLauncherOverlay')
  const rehydrateIndex = launcherOpen.indexOf('rehydratePersistedAppState')
  assert.ok(openIndex >= 0, 'openLauncher should open the launcher overlay')
  assert.ok(rehydrateIndex >= 0, 'openLauncher should still rehydrate persisted settings')
  assert.ok(
    openIndex < rehydrateIndex,
    'openLauncher must open the overlay before rehydrating, or first paint lands without a mounted input',
  )
  assertHas(
    files.app,
    /const rehydrateAfterOpen[\s\S]{0,1200}await rehydratePersistedAppState\(\)[\s\S]{0,1200}runAfterLauncherFirstPaint\(\(\) => void rehydrateAfterOpen\(\)\)/,
    'rehydrate must run after first paint so it cannot block the open path',
  )
  assertHas(
    files.app,
    /function runAfterLauncherFirstPaint[\s\S]{0,240}requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => window\.setTimeout\(run, 0\)\)\)/,
    'after-paint helper must defer through two animation frames and a task',
  )
})

check('launcher panel height matches the shared launcher list height', () => {
  assertHas(
    files.indexCss,
    /--launcher-list-max-height:/,
    'CSS should expose the shared launcher list height token',
  )
  assertHas(
    files.indexCss,
    /max-height:\s*var\(--launcher-body-max-height,\s*var\(--launcher-list-max-height\)\)/,
    'shared launcher result lists should use the shared launcher list height',
  )
  assertHas(
    files.indexCss,
    /max-height:\s*var\(--launcher-body-max-height,\s*var\(--launcher-list-max-height\)\)/,
    'GlobalLauncher should use the same scrollable list height as shared launcher lists',
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
    /startCurrentLauncherWindowDrag|startDragging\(\)/,
    'GlobalLauncher should move the native launcher window instead of moving inside its own window',
  )
  assertHas(
    files.app,
    /onCurrentLauncherWindowMoved\([\s\S]{0,760}updateSetting\(['"]globalLauncherWindowPosition['"]/,
    'LauncherWindowApp should persist native launcher movement from the Tauri window moved event',
  )
  assertHas(
    files.app,
    /setCurrentLauncherWindowPosition\(\{\s*x:\s*saved\.x,\s*y:\s*saved\.y\s*\}\)/,
    'LauncherWindowApp should restore the persisted launcher window position through the window manager before reuse',
  )
  assertHas(
    files.launcherWindowManager,
    /setCurrentLauncherWindowPosition[\s\S]*setPosition\(new LogicalPosition/,
    'launcher window manager should own native launcher position restoration',
  )
  assertHas(
    files.launcherWindowManager,
    /onCurrentLauncherWindowMoved[\s\S]*onMoved/,
    'launcher window manager should own native launcher movement subscriptions',
  )
})

check('standalone launcher ignores in-app panel drag coordinates', () => {
  assertHas(
    files.globalLauncher,
    /standaloneLauncher[\s\S]{0,520}startCurrentLauncherWindowDrag\(\)/,
    'standalone launcher should keep the panel fixed inside its transparent native window and move only the native window',
  )
})

check('standalone launcher sizes the transparent window to the panel', () => {
  assertHas(
    files.tauriLib,
    /if\s+!was_visible[\s\S]{0,360}set_size\(LogicalSize::new\(\s*compact_width,\s*compact_height/,
    'native launcher show path should compact the transparent window only before first show',
  )
  assertHas(
    files.globalLauncher,
    /resizeCurrentLauncherWindow\(\{[\s\S]{0,80}width:[\s\S]{0,80}height:/,
    'standalone launcher should resize the native window using the measured panel size',
  )
  assertHas(
    files.globalLauncher,
    /surfaceShell\?\.defaultHeight[\s\S]{0,260}measured\.panelHeight[\s\S]{0,260}STANDALONE_LAUNCHER_VERTICAL_PADDING/,
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
    /STANDALONE_LAUNCHER_MAX_HEIGHT\s*=\s*560/,
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
    'GlobalLauncher should bind drag handling to the panel so header/footer chrome can move the launcher',
  )
  // The guard list became a joined array, so assert membership instead of one
  // brittle mega-regex over its serialized form.
  const dragGuardList = files.globalLauncher.match(/event\.target\.closest\(\s*\[([\s\S]*?)\]\.join/)?.[1] ?? ''
  assert.ok(dragGuardList, 'GlobalLauncher drag handling should exclude a list of non-draggable selectors')
  for (const selector of [
    '[data-launcher-scrollable]',
    '[data-no-drag]',
    'input',
    'textarea',
    'select',
    'button',
    '.monaco-editor',
    '.global-launcher-body',
    '.launcher-empty-well',
  ]) {
    assert.ok(
      dragGuardList.includes(`'${selector}'`),
      `GlobalLauncher drag handling should preserve ${selector} instead of stealing the gesture`,
    )
  }
  assertHas(
    files.globalLauncher,
    /\[role="grid"\]|\.rdg|csv-tools-surface/,
    'GlobalLauncher drag handling should preserve data grids and plugin surfaces from window drag',
  )
  assertHas(
    files.globalLauncher,
    /startCurrentLauncherWindowDrag\(\)/,
    'GlobalLauncher should delegate native dragging through the launcher window manager during the pointerdown turn',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-panel[\s\S]{0,120}-webkit-app-region:\s*drag/,
    'standalone launcher should mark the panel as a native drag region as a fallback to JS dragging',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-panel\s+:is\([\s\S]{0,400}\.monaco-editor[\s\S]{0,200}-webkit-app-region:\s*no-drag/,
    'standalone launcher should keep interactive controls out of the native drag region',
  )
  assertHas(
    files.indexCss,
    /global-launcher-body--surface[\s\S]{0,160}-webkit-app-region:\s*no-drag/,
    'plugin surface body inside launcher must opt out of window drag for table scrolling',
  )
  assertHas(
    files.indexCss,
    /html\[data-window=['"]launcher['"]\]\s+\.global-launcher-body[\s\S]{0,160}-webkit-app-region:\s*no-drag/,
    'search/result list body must opt out of native window drag so rows stay clickable and the list can scroll',
  )
})

check('search list body is a scroll surface, not a window-drag handle', () => {
  const searchFrame = read('src/components/launcher/GlobalLauncherSearchFrame.tsx')
  assertHas(
    searchFrame,
    /className="global-launcher-body l-list"[\s\S]{0,120}data-no-drag[\s\S]{0,80}data-launcher-scrollable/,
    'search result list must opt out of window drag and into wheel scrolling',
  )
  assertHas(
    searchFrame,
    /items\.length === 0 && query \?[\s\S]{0,80}<LauncherEmptyWell[\s\S]{0,200}<LauncherMixedList/,
    'empty-well and mixed list must stay mutually exclusive so a no-results well cannot cover live rows',
  )
  assertHas(
    searchFrame,
    /<button[\s\S]{0,80}className="l-foot-primary grp"[\s\S]{0,240}onSelectItem\(selectedItem\)/,
    'footer 执行 capsule must be a real button that runs the highlighted row',
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
    /\.global-launcher-panel[\s\S]{0,400}-webkit-user-select:\s*none[\s\S]{0,120}user-select:\s*none/,
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
    /function\s+shouldAllowLauncherListWheel[\s\S]{0,900}deltaX[\s\S]{0,900}global-launcher-body[\s\S]{0,1400}scrollTop/,
    'LauncherWindowApp should only allow wheel scrolling inside the launcher result list',
  )
  assertHas(
    files.app,
    /function\s+shouldAllowLauncherListWheel[\s\S]{0,900}data-launcher-scrollable[\s\S]{0,400}role="grid"|function\s+shouldAllowLauncherListWheel[\s\S]{0,1200}data-launcher-scrollable/,
    'LauncherWindowApp should also allow wheel scrolling inside launcher-owned modal scroll bodies and data grids',
  )
  assertHas(
    files.app,
    /shouldAllowLauncherListWheel[\s\S]{0,800}hiven-ui-select-positioner/,
    'Launcher wheel capture must not swallow portaled Select/Combobox menus',
  )
  assertHas(
    files.app,
    /findLauncherWheelScroller[\s\S]{0,900}hiven-ui-menu-scroll-viewport/,
    'Launcher wheel helper must treat menu viewports as real overflow containers even when they portal outside .global-launcher-body',
  )
  assertHas(
    files.app,
    /canScrollLauncherElement[\s\S]{0,400}scrollWidth|scrollLeft/,
    'Launcher wheel helper should support horizontal scroll for tables',
  )
  assertHas(
    files.app,
    /function\s+findLauncherWheelScroller[\s\S]{0,900}closest\(['"]\.global-launcher-body['"]\)[\s\S]{0,900}while\s*\(candidate\)[\s\S]{0,900}data-launcher-scrollable[\s\S]{0,900}parentElement/,
    'LauncherWindowApp should climb past nested non-scrolling surface elements to find the actual scroll container',
  )
  assertHas(
    files.globalLauncher,
    /event\.target\.closest\(\s*\[[\s\S]{0,80}'\[data-launcher-scrollable\]'/,
    'Global launcher dragging should not start from scrollable surface bodies or their scrollbars',
  )
})

check('native launcher opens centered only when there is no persisted window position', () => {
  const launcherOpen = files.app.match(/const\s+openLauncher\s*=\s*[^=]*=>\s*\{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
  assert.ok(launcherOpen, 'LauncherWindowApp should define an openLauncher handler')
  const restoreBranchIndex = launcherOpen.indexOf('if (!saved || !isLauncherPositionFresh(saved)) return')
  const restoreIndex = launcherOpen.indexOf('setCurrentLauncherWindowPosition({ x: saved.x, y: saved.y })')
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
    /suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}setCurrentLauncherWindowPosition\(\{\s*x:\s*saved\.x,\s*y:\s*saved\.y\s*\}\)/,
    'restoring a saved launcher position should suppress the resulting programmatic move event',
  )
  assertHas(
    files.app,
    /onCurrentLauncherWindowMoved\([\s\S]{0,520}launcherProgrammaticMoveRef\.current[\s\S]{0,420}return/,
    'launcher movement persistence should ignore programmatic positioning events',
  )
  assertHas(
    files.app,
    /suppressProgrammaticMove\s*=\s*\(\)\s*=>\s*suppressNextLauncherMovePersistence\(\)[\s\S]{0,220}addEventListener\(LAUNCHER_PROGRAMMATIC_MOVE_EVENT,\s*suppressProgrammaticMove\)/,
    'LauncherWindowApp should suppress native move persistence when another launcher component declares a programmatic resize or move',
  )
  assertHas(
    files.globalLauncher,
    /dispatchEvent\(new CustomEvent\(LAUNCHER_PROGRAMMATIC_MOVE_EVENT\)\)[\s\S]{0,220}resizeCurrentLauncherWindow\(\{[\s\S]{0,80}width:[\s\S]{0,80}height:/,
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
  // Escape now runs through a layer-interceptor chain (settings / plugin surface /
  // permission / quick editor) before the launcher may claim the key, so assert the
  // ordering of the handler body rather than raw character distance between calls.
  {
    const body = files.globalLauncher.match(/const handleHostEscape = useCallback\(\(event: KeyboardEvent\) => \{[\s\S]*?\n  \}, \[/)?.[0] ?? ''
    assert.ok(body, 'handleHostEscape should exist as the host-level Escape handler')
    const at = (needle) => body.indexOf(needle)
    assert.ok(at("if (event.key !== 'Escape') return") === 0 || at("if (event.key !== 'Escape') return") > 0, 'handleHostEscape should ignore non-Escape keys first')
    assert.ok(
      at("closest('[role=\"dialog\"][data-open]')") > 0 && at("closest('[role=\"dialog\"][data-open]')") < at('runLauncherEscapeInterceptor(event)'),
      'an open modal dialog must own Escape before launcher surfaces or controller frames',
    )
    assert.ok(
      at('runLauncherEscapeInterceptor(event)') > 0 && at('runLauncherEscapeInterceptor(event)') < at('event.preventDefault()'),
      'layer interceptors must get first refusal before the launcher claims Escape',
    )
    assert.ok(
      at('event.preventDefault()') > 0 && at('event.stopPropagation()') > at('event.preventDefault()'),
      'Escape should stop app-level key handlers once the launcher claims it',
    )
    assert.ok(
      at('controllerRef.current?.back?.()') > at('event.stopPropagation()') && at('closeLauncher()') > at('controllerRef.current?.back?.()'),
      'Escape should pop the controller frame stack before closing the launcher',
    )
  }
  assertHas(
    files.globalLauncher,
    /await hideLauncherWindow\(\{\s*restoreForeground\s*\}\)/,
    'canceling the standalone launcher should only hide the launcher window, carrying the host foreground-restore policy',
  )
  assertHas(
    files.globalLauncher,
    /restoreCurrentLauncherOverlayWindow\(\{\s*hide:\s*hideOverlayWindow\s*\}\)/,
    'overlay launcher close should restore and optionally hide through the window manager',
  )
  assert.doesNotMatch(
    read('src/components/launcher/GlobalLauncherClose.ts'),
    /setDecorations\(|getCurrentWindow\(\)[\s\S]{0,120}hide\(\)/,
    'GlobalLauncher close helpers should not directly manipulate Tauri window chrome',
  )
  assertHas(
    files.launcherWindowManager,
    /restoreCurrentLauncherOverlayWindow[\s\S]*setDecorations\(true\)[\s\S]*options\.hide[\s\S]*win\.hide\(\)/,
    'launcher window manager should own overlay chrome restoration and hiding',
  )
  assert.doesNotMatch(
    files.globalLauncher,
    /hideApp:\s*true/,
    'canceling the standalone launcher should not hide/unhide the whole app because that flashes and can restore the main window',
  )
})

check('standalone launcher closes when its window loses focus', () => {
  // Blur-dismiss got smarter: it still closes on blur, but not when a surface
  // opted out (closeOnBlur: false) and not when focus merely moved to a sibling
  // hiven window such as clipboard history.
  {
    const blurHandler = files.globalLauncher.match(/onCurrentLauncherWindowFocusChanged\(\(focused\) => \{[\s\S]*?\n    \}\)/)?.[0] ?? ''
    assert.ok(blurHandler, 'standalone launcher should listen for launcher window focus changes')
    assert.match(blurHandler, /if \(focused\) return/, 'gaining focus must not close the launcher')
    assert.match(blurHandler, /closeLauncherRef\.current\(\)/, 'standalone launcher should hide itself when the launcher window loses focus')
    assert.match(blurHandler, /shouldKeepLauncherOpenOnBlur\(\)/, 'blur-dismiss must let focus move to sibling hiven windows without closing')
    assert.match(blurHandler, /closeOnBlurRef\.current === false/, 'surfaces that opt out of blur-close must be honored')
    assert.match(
      blurHandler,
      /generation !== blurGeneration/,
      'a stale blur check must not close a launcher that was refocused while the check was in flight',
    )
  }
  {
    // DevTools opens as its own native panel (invisible to isHivenCompanionWindowActive),
    // so opening it must suppress blur-dismiss for the rest of *this* launcher open —
    // not just clear on the first regained-focus tick, which would race with clicking
    // back into the search input to keep typing (devtools can re-steal focus for a
    // beat right after, and that follow-up blur would no longer be suppressed).
    const effectBody = files.globalLauncher.match(
      /useLayoutEffect\(\(\) => \{\n\s*if \(!open \|\| !standaloneLauncher\) return[\s\S]*?\n  \}, \[/,
    )?.[0] ?? ''
    assert.ok(effectBody, 'standalone launcher blur-listener effect must exist')
    const resetIdx = effectBody.indexOf('clearStandaloneLauncherBlurDevtoolsSuppress()')
    const listenIdx = effectBody.indexOf('onCurrentLauncherWindowFocusChanged(')
    assert.ok(resetIdx >= 0, 'a fresh launcher open must reset any leftover devtools blur-suppress')
    assert.ok(listenIdx >= 0, 'must still register the native focus-changed listener')
    assert.ok(
      resetIdx < listenIdx,
      'devtools blur-suppress must reset once per fresh open, before the listener attaches — not inside the focus callback on every regained-focus tick',
    )
    assert.doesNotMatch(
      effectBody,
      /if \(focused\) \{[\s\S]{0,400}clearStandaloneLauncherBlurDevtoolsSuppress/,
      'must not clear the devtools blur-suppress from inside the focus-regained branch (races with typing right after)',
    )
    assert.match(
      read('src/components/launcher/GlobalLauncherWindowLifecycle.ts'),
      /\}, \[open, standaloneLauncher\]\)/,
      'blur listener and devtools reset must run once per launcher open, not on every query-driven callback change',
    )
    assert.match(
      files.hostActions,
      /catch \(error\) \{[\s\S]{0,180}clearStandaloneLauncherBlurDevtoolsSuppress\(\)/,
      'failed open_devtools calls must not leave blur suppression active',
    )
  }
  {
    // resetLauncherSession grew sticky-query handling between the two calls, so
    // bound the match by the callback body rather than a character budget.
    const reset = files.globalLauncher.match(/const resetLauncherSession = useCallback\([\s\S]*?\n  \}, \[/)?.[0] ?? ''
    assert.ok(reset, 'closing the launcher should go through resetLauncherSession')
    for (const call of ['clearPluginSurfaceTool()', 'setSurfaceFrame(null)', 'controllerRef.current?.reset()']) {
      assert.ok(reset.includes(call), `resetLauncherSession should reset plugin surface and controller state (${call})`)
    }
  }
  assertHas(
    files.globalLauncher,
    /if\s*\(open\)\s*return[\s\S]{0,320}controllerReset\(\)/,
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
  assert.doesNotMatch(
    files.globalPinnedLauncherHotkeys,
    /getCurrentWindow\(\)\.isFocused\(\)|activeView|setEditorCommandBarOpen\(true\)/,
    'global shortcut routing should no longer depend on the retired main/editor view shell',
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
  assert.doesNotMatch(
    routePinnedLauncherFn,
    /get_webview_window\("main"\)[\s\S]{0,180}is_focused\(\)|main_window_focused/,
    'native double-modifier routing should no longer depend on the retired main window focus state',
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
    /was_visible[\s\S]*if\s+!was_visible[\s\S]*window\.emit\(open_event/,
    'show_launcher_window_for_hotkey should still reset launcher UI only for a newly shown launcher',
  )
})

check('native launcher close restores the previously foreground app instead of activating main', () => {
  const launcherFn = files.tauriLib.match(/pub\(crate\)\s+fn\s+show_launcher_window_for_hotkey[\s\S]*?\n}\n\n#\[tauri::command\]/)?.[0] ?? ''
  const hideFn = files.tauriLib.match(/async\s+fn\s+hide_launcher_window[\s\S]*?\n}\n\n/)?.[0] ?? ''
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
    /apply_restore_foreground_mode|restore_previous_foreground_app|RestoreForegroundMode/,
    'hiding a standalone launcher should apply an explicit restore-foreground policy',
  )
  assertHas(
    files.tauriLib,
    /parse_restore_foreground_mode|restore_foreground/,
    'hide_launcher_window should accept restore_foreground mode (auto|never|force)',
  )
  assertHas(
    files.tauriLib,
    /RestoreForegroundMode::Never|\"never\"/,
    'hide path must support never-restore for blur-dismiss',
  )
  const hideIndex = hideFn.indexOf('window.hide()')
  assert.ok(hideIndex >= 0, 'hide_launcher_window should hide the launcher window')
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
  // Keying was extracted into rekey_launcher_window so it can run twice: once here
  // for early key routing, once from the frontend after the search input mounts.
  {
    const showFn = files.tauriLib.match(/fn show_launcher_window_without_app_activation_macos\([\s\S]*?\n\}/)?.[0] ?? ''
    assert.ok(showFn, 'src-tauri/src/lib.rs should expose the non-activating show path')
    assert.match(showFn, /promote_window_to_nonactivating_panel\(ns_window\)/, 'the show path should promote the window to a non-activating panel')
    assert.match(showFn, /orderFrontRegardless/, 'the show path should order the panel front without activating the app')
    assert.match(showFn, /rekey_launcher_window\(window\)/, 'the show path should key the panel through the shared rekey helper')
    assertHas(
      files.tauriLib,
      /fn rekey_launcher_window[\s\S]{0,900}makeKeyWindow/,
      'native launcher should key the panel with makeKeyWindow, which does not activate the app',
    )
    assert.doesNotMatch(
      files.tauriLib,
      /msg_send!\[ns_window, makeKeyAndOrderFront/,
      'makeKeyAndOrderFront would activate the app — the panel must stay non-activating',
    )
  }
  // Passing the raw ns_view here is the bug, not the contract: the responder must
  // land on WebKit's WKContentView, because one stuck on wry's WryWebViewParent
  // leaves the page inactive — focus without a caret, keys never reaching the DOM.
  assertHas(
    files.tauriLib,
    /makeFirstResponder:\s*responder_target/,
    'native launcher should make the WebView first responder so the search input receives keyboard focus',
  )
  assertHas(
    files.tauriLib,
    /fn launcher_first_responder_target/,
    'first-responder targeting should resolve WebKit content view rather than wry container',
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
    /openGlobalLauncherOverlay\s*:\s*\(\)|setGlobalLauncherOpen\s*:/,
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
