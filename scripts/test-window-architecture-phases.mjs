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
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  workspaceStore: read('src/workspace/workspaceStore.ts'),
  editorWindow: read('src/components/EditorWindow.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  editorCommandBarHost: read('src/launcher/hosts/EditorCommandBarHost.tsx'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  launcherSession: read('src/workspace/launcher/useLauncherSession.ts'),
  launcherView: read('src/components/launcher/LauncherView.tsx'),
  launcherUsage: read('src/workspace/launcher/usage.ts'),
  launcherRegistry: read('src/workspace/launcher/registry.ts'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  globalLauncherHost: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  surfaceRegistry: read('src/surfaces/registry.ts'),
  surfaceActions: read('src/surfaces/actions.ts'),
  windowManagerEditor: read('src/workspace/windowManager/editorWindow.ts'),
  windowManagerPluginSurfaces: read('src/workspace/windowManager/pluginSurfaceWindows.ts'),
  windowManagerLauncher: read('src/workspace/windowManager/launcherWindow.ts'),
  windowLabels: read('src/workspace/windowManager/windowLabels.ts'),
  editorWindowApi: read('src/workspace/editorWindow.ts'),
  pluginSurfaceWindowComponent: read('src/components/PluginSurfaceWindow.tsx'),
  editorWindowComponent: read('src/components/EditorWindow.tsx'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  registry: read('src/workspace/launcher/registry.ts'),
  pluginApi: read('src/workspace/launcher/pluginApi.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  tauriConfig: read('src-tauri/tauri.conf.json'),
  defaultCapability: read('src-tauri/capabilities/default.json'),
  tauriLib: read('src-tauri/src/lib.rs'),
  tauriHotkeys: read('src-tauri/src/hotkeys.rs'),
  globalPinnedLauncher: read('src/hotkeys/globalPinnedLauncher.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:window-architecture-phases'],
  'node scripts/test-window-architecture-phases.mjs',
  'package.json must expose test:window-architecture-phases',
)

assert.match(files.hostProvider, /getEditorWindowItems/, 'Editor window launcher item must be wired into host provider')
assert.match(files.editorWindowApi, /invoke\(['"]show_editor_window['"]\)/, 'editor window opener must delegate lifecycle to the native window manager')
assert.doesNotMatch(files.editorWindowApi, /new WebviewWindow|WebviewWindow\.getByLabel/, 'editor window opener must not create editor windows from frontend JS')

assert.match(files.workspaceStore, /isEditorWindowWorkspaceSession/, 'workspace store must detect editor window sessions')
assert.match(files.workspaceStore, /createJSONStorage/, 'workspace store must explicitly choose storage per runtime window')
assert.match(files.workspaceStore, /sessionStorage/, 'editor window workspace state must use session storage instead of persisted app workspace storage')
assert.doesNotMatch(
  files.editorWindow,
  /registerHostLauncherProviders\(\)|registerBundledPluginPackages\(\)|loadInstalledPluginsFromStore\(\)/,
  'EditorWindow must bootstrap plugin runtime through the shared idempotent runtime bootstrap helper',
)
assert.match(files.editorWindow, /ensurePluginRuntimeReady/, 'EditorWindow must use ensurePluginRuntimeReady')

assert.match(files.launcherTypes, /export type LauncherHostId = ['"]global-launcher['"] \| ['"]editor-command-bar['"]/, 'launcher domain must model explicit host ids')
assert.match(files.launcherTypes, /export type LauncherHostCapability/, 'launcher domain must model host capabilities')
assert.match(files.launcherTypes, /export type LauncherHostConfig/, 'launcher domain must model launcher host config')
assert.match(files.launcherTypes, /launcherHostHasCapability/, 'launcher domain must expose host capability checks')
assert.match(files.launcherTypes, /getLauncherHostConfig/, 'launcher domain must expose host config lookup')
assert.match(files.launcherTypes, /normalizeLauncherSurfaceId/, 'launcher domain must normalize legacy command-palette to editor-command-bar')
assert.match(files.launcherRegistry, /requiredCapabilities[\s\S]*launcherHostHasCapability/, 'launcher registry must filter items by host capabilities')
assert.match(files.launcherSession, /export function useLauncherSession/, 'launcher hosts must share a session hook')
assert.match(files.launcherSession, /new LauncherController/, 'shared launcher session must own controller initialization')
assert.match(files.launcherSession, /collectDynamicItems/, 'shared launcher session must own dynamic item collection')
assert.match(files.launcherSession, /rankLauncherItems/, 'shared launcher session must own launcher ranking')
assert.match(files.launcherView, /data-launcher-host/, 'shared LauncherView must stamp the active host id')
assert.match(files.commandPalette, /return <EditorCommandBarHost \/>/, 'CommandPalette must be a compatibility wrapper')
assert.match(files.globalLauncher, /return <GlobalLauncherHost \/>/, 'GlobalLauncher must be a compatibility wrapper')
assert.match(files.editorCommandBarHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]editor-command-bar['"][\s\S]*staticItemFilter:\s*filterEditorCommandBarItems/, 'EditorCommandBarHost must use the shared session and filter to editor-local actions')
assert.match(files.globalLauncherHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]global-launcher['"]/, 'GlobalLauncherHost must use the shared launcher session')
assert.match(files.editorCommandBarHost, /<LauncherView[\s\S]*hostId=['"]editor-command-bar['"]/, 'EditorCommandBarHost must render through the shared LauncherView')
assert.match(files.globalLauncherHost, /<LauncherView[\s\S]*hostId=['"]global-launcher['"]/, 'GlobalLauncherHost must render through the shared LauncherView')
assert.match(files.surfaceRegistry, /export type SurfaceInstance/, 'Surface registry must model surface instances')
assert.match(files.surfaceRegistry, /upsertSurfaceInstance/, 'Surface registry must upsert surface instances')
assert.match(files.surfaceRegistry, /getSurfaceInstances/, 'Surface registry must expose current surfaces')
assert.match(files.surfaceActions, /focusSurfaceInstance/, 'Surface registry must provide a switch/focus operation')
assert.match(files.pluginSurfaceWindowComponent, /markSurfaceInstanceState\([\s\S]*['"]visible['"]/, 'Plugin surface window component must mark its surface visible')
assert.match(files.pluginSurfaceWindowComponent, /markSurfaceInstanceState\([\s\S]*['"]hidden['"]/, 'Plugin surface window component must mark its surface hidden on teardown')
assert.match(files.editorWindowComponent, /upsertSurfaceInstance\([\s\S]*id:\s*['"]editor['"]/, 'Editor window component must register itself as a surface')
assert.match(files.editorWindowComponent, /markSurfaceInstanceState\(['"]editor['"],\s*['"]hidden['"]\)/, 'Editor window component must mark itself hidden on teardown')
assert.match(files.windowManagerEditor, /showEditorWindow/, 'window manager must expose editor window operations')
assert.match(files.windowManagerPluginSurfaces, /showPluginSurfaceWindow/, 'window manager must expose plugin surface window operations')
assert.match(files.windowManagerLauncher, /showLauncherWindow/, 'window manager must expose launcher window operations')
assert.match(files.windowLabels, /EDITOR_WINDOW_LABEL/, 'window manager must centralize window labels')
assert.match(files.launcherUsage, /['"]editor-command-bar['"]:\s*\{\}/, 'launcher usage must have an editor-command-bar bucket')
assert.match(files.launcherRegistry, /normalizeLauncherSurfaceId\(candidate\) === normalizedSurfaceId/, 'launcher registry must match legacy command-palette items against editor-command-bar host')
assert.doesNotMatch(
  files.editorCommandBarHost.match(/new LauncherController\([\s\S]*?\}\)/)?.[0] ?? '',
  /surfaceId:\s*['"]command-palette['"]/,
  'CommandPalette runtime must identify itself as editor-command-bar, not the legacy command-palette host',
)
assert.doesNotMatch(
  files.hostActions.match(/systemKey:\s*['"]host:view:plugins['"][\s\S]*?execute:/)?.[0] ?? '',
  /['"]command-palette['"]/,
  'Plugins page must not be a command-palette app-level action',
)
assert.doesNotMatch(
  files.hostActions.match(/systemKey:\s*['"]host:view:settings['"][\s\S]*?execute:/)?.[0] ?? '',
  /['"]command-palette['"]/,
  'Settings page must not be a command-palette app-level action',
)
assert.match(
  files.hostActions.match(/systemKey:\s*['"]host:view:plugins['"][\s\S]*?execute:\s*async[\s\S]*?\n\s*}\s*,/)?.[0] ?? '',
  /keepOpen:\s*true/,
  'Plugins launcher-hosted surface action must keep the launcher open',
)
assert.match(
  files.hostActions.match(/systemKey:\s*['"]host:view:settings['"][\s\S]*?execute:\s*async[\s\S]*?\n\s*}\s*,/)?.[0] ?? '',
  /keepOpen:\s*true/,
  'Settings launcher-hosted surface action must keep the launcher open',
)
assert.doesNotMatch(
  files.registry.match(/systemKey:\s*`plugin-settings:[\s\S]*?execute:/)?.[0] ?? '',
  /['"]command-palette['"]/,
  'Plugin settings launcher items must not appear in the editor command bar',
)

assert.match(files.store, /LauncherHostSurfaceTarget/, 'app store must model launcher-hosted app surfaces')
assert.match(files.store, /openLauncherHostSurface/, 'app store must expose launcher-hosted surface opener')
assert.match(files.globalLauncherHost, /launcherHostSurfaceTarget/, 'GlobalLauncherHost must read launcher-hosted surface target')
assert.match(files.globalLauncherHost, /SettingsSurfaceView/, 'GlobalLauncherHost must render Settings as a launcher-hosted surface')
assert.match(files.globalLauncherHost, /ScriptsSurfaceView/, 'GlobalLauncherHost must render Plugins as a launcher-hosted surface')
assert.doesNotMatch(files.pluginApi, /emitTo\(['"]main['"]/, 'launcher API must not route settings/plugins through the main window')
assert.doesNotMatch(files.pluginApi, /show_and_focus_window/, 'launcher API must not focus the main window for settings/plugins')
assert.doesNotMatch(files.app, /hiven:\/\/show-plugins-page|hiven:\/\/show-settings-page/, 'main window should not be the settings/plugins bridge')

const tauriConfig = JSON.parse(files.tauriConfig)
assert.ok(
  !tauriConfig.app?.windows?.some((window) => window.label === 'main'),
  'Tauri config must not declare the retired main window',
)
const defaultCapability = JSON.parse(files.defaultCapability)
assert.ok(!defaultCapability.windows?.includes('main'), 'default capability must not grant access to a retired main window')
assert.ok(
  !defaultCapability.permissions?.includes('core:window:allow-create') &&
    !defaultCapability.permissions?.includes('core:webview:allow-create-webview-window'),
  'default capability must not expose frontend window creation now that native window manager owns editor/plugin windows',
)
assert.ok(
  defaultCapability.permissions?.includes('core:window:allow-close'),
  'default capability must allow editor windows to close themselves',
)
assert.doesNotMatch(files.app, /function MainApp|<Sidebar\b|function ViewContent|ViewErrorBoundary/, 'App runtime must not mount the retired main navigation shell')
assert.match(files.app, /function LauncherRuntimeApp/, 'App runtime must be launcher/background owned')
assert.match(files.app, /loadInstalledPluginsFromStore\(\)/, 'launcher runtime must load installed plugins')
assert.match(files.app, /runPluginStartupHooks\(\)/, 'launcher runtime must run plugin startup hooks')
assert.match(files.app, /initializePluginBackgrounds\(\)/, 'launcher runtime must initialize plugin backgrounds')
assert.match(files.app, /setupBackgroundSettingsWatcher\(\)/, 'launcher runtime must watch background settings')
assert.match(files.app, /setupBackgroundPermissionWatcher\(\)/, 'launcher runtime must watch background permissions')
assert.match(files.app, /stopAllPluginBackgrounds\(\)/, 'launcher runtime must stop plugin backgrounds on cleanup')
assert.doesNotMatch(files.tauriLib, /show_and_focus_window|show_and_focus_main_window|get_webview_window\("main"\)/, 'native runtime must not retain main window focus commands')
assert.match(files.tauriLib, /async fn show_editor_window/, 'native runtime must expose show_editor_window')
assert.match(files.tauriLib, /WebviewWindowBuilder::new\([\s\S]{0,180}"editor"[\s\S]{0,260}index\.html\?window=editor/, 'native runtime must create the editor window')
assert.match(files.tauriLib, /if let Some\(window\) = app\.get_webview_window\("editor"\)/, 'native editor window command must reuse an existing editor window')
assert.match(files.tauriLib, /fn show_and_focus_editor_window[\s\S]*?set_focus/, 'native editor window command must focus editor windows through the native helper')
assert.doesNotMatch(files.tauriHotkeys, /get_webview_window\("main"\)|ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT/, 'native hotkeys must not branch through main window focus')
assert.doesNotMatch(files.globalPinnedLauncher, /shouldOpenCommandPaletteInMainWindow|setCommandPaletteOpen\(true\)/, 'global pinned launcher shortcut must not route to the retired command palette path')
assert.match(files.globalPinnedLauncher, /routeGlobalPinnedLauncherShortcut\(\)[\s\S]{0,120}showLauncherWindow\(\)/, 'global pinned launcher shortcut must directly open the launcher window')
assert.doesNotMatch(files.globalLauncherHost, /emitTo\(['"]main['"]|hiven:\/\/run-pinned-action/, 'standalone launcher must not send pinned actions to a retired main window')
assert.doesNotMatch(files.hostActions, /host:view:editor|show-main-panel|core-pane\.show-main-panel/, 'global launcher must not expose the retired main panel action')

console.log('window architecture phase checks passed')
