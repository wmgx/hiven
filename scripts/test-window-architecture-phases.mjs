#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}


const globalLauncherFrameFiles = [
  'src/components/launcher/GlobalLauncherSearchFrame.tsx',
  'src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx',
  'src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx',
  'src/components/launcher/GlobalLauncherSettingsFrame.tsx',
  'src/components/launcher/GlobalLauncherResultFrame.tsx',
]
for (const framePath of globalLauncherFrameFiles) {
  assert.ok(read(framePath).length > 0, `${framePath} must exist as an extracted frame module`)
}

const files = {
  packageJson: read('package.json'),
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  workspaceStore: read('src/workspace/workspaceStore.ts'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  launcherSession: read('src/workspace/launcher/useLauncherSession.ts'),
  launcherView: read('src/components/launcher/LauncherView.tsx'),
  css: read('src/index.css'),
  launcherFooterHints: read('src/components/launcher/LauncherFooterHints.tsx'),
  launcherMixedList: read('src/components/launcher/LauncherMixedList.tsx'),
  launcherResultChoiceRow: read('src/components/launcher/LauncherResultChoiceRow.tsx'),
  globalLauncherFrames: read('src/components/launcher/GlobalLauncherFrames.tsx'),
  globalLauncherPanel: read('src/components/launcher/GlobalLauncherPanel.tsx'),
  globalLauncherSearchFrame: read('src/components/launcher/GlobalLauncherSearchFrame.tsx'),
  globalLauncherPluginSurfaceFrame: read('src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx'),
  globalLauncherSystemSurfaceFrame: read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx'),
  globalLauncherSettingsFrame: read('src/components/launcher/GlobalLauncherSettingsFrame.tsx'),
  globalLauncherResultFrame: read('src/components/launcher/GlobalLauncherResultFrame.tsx'),
  globalLauncherCollectInputFrame: read('src/components/launcher/GlobalLauncherCollectInputFrame.tsx'),
  launcherUsage: read('src/workspace/launcher/usage.ts'),
  launcherRegistry: read('src/workspace/launcher/registry.ts'),
  launcherController: read('src/workspace/launcher/controller.ts'),
  pluginRegistry: read('src/workspace/pluginRegistry.ts'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  globalLauncherHost: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  surfaceRegistry: read('src/surfaces/registry.ts'),
  surfaceActions: read('src/surfaces/actions.ts'),
  windowManagerEditor: read('src/workspace/windowManager/editorWindow.ts'),
  windowManagerPluginSurfaces: read('src/workspace/windowManager/pluginSurfaceWindows.ts'),
  windowManagerLauncher: read('src/workspace/windowManager/launcherWindow.ts'),
  globalLauncherSurfaceRegistry: read('src/components/launcher/GlobalLauncherSurfaceRegistry.ts'),
  globalLauncherSelectionController: read('src/components/launcher/useGlobalLauncherSelectionController.ts'),
  contextBroker: read('src/launcher/context/contextBroker.ts'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  windowLabels: read('src/workspace/windowManager/windowLabels.ts'),
  editorWindowApi: read('src/workspace/editorWindow.ts'),
  editorBridge: read('src/workspace/editorBridge.ts'),
  pluginSurfaceWindowComponent: read('src/components/PluginSurfaceWindow.tsx'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  registry: read('src/workspace/launcher/registry.ts'),
  pluginApi: read('src/workspace/launcher/pluginApi.ts'),
  pluginSettingsStore: read('src/workspace/pluginSettingsStore.ts'),
  pluginHostCore: read('src/pluginHostCore.ts'),
  workspaceTypes: read('src/workspace/types.ts'),
  effectRunner: read('src/workspace/effectRunner.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  tauriConfig: read('src-tauri/tauri.conf.json'),
  defaultCapability: read('src-tauri/capabilities/default.json'),
  tauriLib: read('src-tauri/src/lib.rs'),
  tauriHotkeys: read('src-tauri/src/hotkeys.rs'),
  globalPinnedLauncher: read('src/hotkeys/globalPinnedLauncher.ts'),
}


const testScriptsUsingRetiredViewNames = [
  'scripts/test-directory-plugin-convergence.mjs',
  'scripts/test-editor-topbar-plugin-detail.mjs',
  'scripts/test-plugin-surface-shortcuts.mjs',
  'scripts/test-global-hotkey-settings.mjs',
  'scripts/test-shortcut-recorder-component.mjs',
  'scripts/test-plugin-package-lifecycle.mjs',
  'scripts/test-clipboard-history-boundary.mjs',
]
for (const scriptPath of testScriptsUsingRetiredViewNames) {
  assert.doesNotMatch(
    read(scriptPath),
    /SettingsView|ScriptsView|PluginEditorView|settingsView|scriptsView|pluginEditorView/,
    `${scriptPath} must describe plugin/settings code as surfaces, not retired views`,
  )
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:window-architecture-phases'],
  'node scripts/test-window-architecture-phases.mjs',
  'package.json must expose test:window-architecture-phases',
)

assert.match(files.hostProvider, /getHostPaneControlItems/, 'Editor window launcher item must be wired into host provider')
assert.match(files.editorWindowApi, /showQuickEditorWindow\(\)/, 'editor window opener must delegate lifecycle to the native window manager')
assert.doesNotMatch(files.editorWindowApi, /new WebviewWindow/, 'editor window opener must not create editor windows from frontend JS')
assert.match(files.editorBridge, /EDITOR_BRIDGE_REQUEST_EVENT/, 'editor bridge must expose an explicit request event')
assert.match(files.editorBridge, /EDITOR_BRIDGE_RESPONSE_EVENT/, 'editor bridge must expose an explicit response event')
assert.match(files.editorBridge, /getEditorContext/, 'editor bridge must support launcher-to-editor context requests')
assert.match(files.editorBridge, /createEditorPane/, 'editor bridge must support launcher-to-editor pane creation')
assert.match(files.editorBridge, /replaceEditorSelection/, 'editor bridge must support launcher-to-editor selection replacement')
assert.match(files.editorBridge, /insertIntoEditor/, 'editor bridge must support launcher-to-editor insertion')
assert.match(files.editorBridge, /openEditorPanel/, 'editor bridge must support launcher-to-editor panel opening')
assert.match(files.editorBridge, /registerActiveEditorContext/, 'editor bridge must support editor-to-launcher active context registration')
assert.match(files.editorBridge, /updateActivePaneSnapshot/, 'editor bridge must support editor-to-launcher pane snapshot updates')

// Deleted symbols must NOT appear in src/ alive code
assert.doesNotMatch(files.editorWindowApi, /isEditorWindowRuntime/, 'editor window API must not reference the retired isEditorWindowRuntime')
assert.doesNotMatch(files.pluginApi, /isEditorWindowRuntime/, 'plugin API must not reference the retired isEditorWindowRuntime')
assert.doesNotMatch(files.effectRunner, /isEditorWindowRuntime/, 'effect runner must not reference the retired isEditorWindowRuntime')

assert.match(files.workspaceStore, /isEditorWindowWorkspaceSession/, 'workspace store must detect editor window sessions')
assert.match(files.workspaceStore, /createJSONStorage/, 'workspace store must explicitly choose storage per runtime window')
assert.match(files.workspaceStore, /sessionStorage/, 'editor window workspace state must use session storage instead of persisted app workspace storage')

for (const [label, source] of Object.entries({
  launcherController: files.launcherController,
  launcherRegistry: files.launcherRegistry,
  launcherTypes: files.launcherTypes,
  pluginRegistry: files.pluginRegistry,
})) {
  assert.doesNotMatch(source, /CommandPalette|command palette/, `${label} must not describe shared launcher behavior with retired CommandPalette naming`)
}
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
assert.doesNotMatch(files.css, /command-palette-results|--command-palette-list-max-height|--command-palette-panel-max-height|CommandPalette|command palette/, 'shared launcher CSS must not use retired command palette naming')
assert.match(files.css, /--launcher-list-max-height/, 'shared launcher CSS must expose launcher list height token')
assert.match(files.css, /--launcher-panel-max-height/, 'shared launcher CSS must expose launcher panel height token')
assert.match(files.launcherView, /data-launcher-host/, 'shared LauncherView must stamp the active host id')
assert.match(files.launcherFooterHints, /export function LauncherHintKey/, 'shared launcher UI must provide footer hint primitives')
assert.match(files.launcherFooterHints, /export function LauncherHintText/, 'shared launcher UI must provide text-only footer hints')
assert.match(files.launcherMixedList, /export function LauncherMixedList/, 'shared launcher UI must provide the mixed global list')
assert.match(files.launcherResultChoiceRow, /export function LauncherResultChoiceRow/, 'shared launcher UI must provide global result choice rows')
assert.match(files.globalLauncherSystemSurfaceFrame, /export function GlobalLauncherSystemSurfaceFrame/, 'global launcher system frame must live in its own module')
assert.match(files.globalLauncherSettingsFrame, /export function GlobalLauncherSettingsFrame/, 'global launcher settings frame must live in its own module')
assert.match(files.globalLauncherPluginSurfaceFrame, /export function GlobalLauncherPluginSurfaceFrame/, 'global launcher plugin surface frame must live in its own module')
assert.match(files.globalLauncherSearchFrame, /export function GlobalLauncherSearchFrame/, 'global launcher search frame must live in its own module')
assert.match(files.globalLauncherCollectInputFrame, /export function GlobalLauncherCollectInputFrame/, 'global launcher collect-input frame must live in its own module')
assert.match(files.globalLauncherResultFrame, /export function GlobalLauncherResultFrame/, 'global launcher result frame must live in its own module')
assert.match(files.globalLauncherFrames, /export function GlobalLauncherFrameSwitch/, 'global launcher frames must provide a frame switch to keep the host thin')
assert.match(files.globalLauncherSystemSurfaceFrame, /SystemSettingsSurface/, 'global launcher system frame must render the unified system settings surface')
// Retired orphan surfaces (B3/B4 cleanup): no render subscribers in launcher-only form factor.
assert.equal(existsSync('src/surfaces/PluginEditorSurface.tsx'), false, 'PluginEditorSurface must be deleted (orphan)')
assert.equal(existsSync('src/surfaces/SurfaceShell.tsx'), false, 'SurfaceShell must be deleted (orphan)')
assert.equal(existsSync('src/plugins/textDiff/DiffPageView.tsx'), false, 'DiffPageView must be deleted; TextDiffSurface is the path')
assert.equal(existsSync('src/surfaces/pluginEditorSurfaceBridge.ts'), false, 'plugin editor bridge must be deleted')
assert.match(files.surfaceActions, /surface\.kind === ['"]plugin-editor['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'plugin-editor focus redirects to system-plugins')
assert.match(files.surfaceActions, /requestOpenLauncherPluginSettingsSurface/, 'plugin-editor focus may open plugin settings')
assert.match(files.globalLauncher, /return <GlobalLauncherHost \/>/, 'GlobalLauncher must be a compatibility wrapper')
assert.doesNotMatch(files.pluginSettingsStore, /surfaceId\?:\s*['"]command-palette['"]|['"]command-palette['"]\s*\|\s*['"]global-launcher['"]/, 'plugin settings context must not model retired command-palette surface ids')
assert.match(files.pluginSettingsStore, /LauncherHostId/, 'plugin settings context must use launcher host ids')
assert.doesNotMatch(files.store, /PaletteParamModel|command-palette parameter/, 'shared launcher param model must not use retired command palette naming')
assert.match(files.store, /LauncherParamModel/, 'shared launcher param model must use launcher naming')
assert.match(files.store, /editorCommandBarOpen:\s*boolean/, 'app store must model the editor command bar as editorCommandBarOpen')
assert.doesNotMatch(files.store, /commandPaletteOpen|setCommandPaletteOpen/, 'app store must not expose retired command palette state names')
assert.match(files.globalLauncherHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]global-launcher['"]/, 'GlobalLauncherHost must use the shared launcher session')
assert.match(files.globalLauncherPanel, /export function GlobalLauncherPanel/, 'GlobalLauncher panel rendering must live outside the host')
assert.match(files.globalLauncherPanel, /<LauncherView[\s\S]*hostId=['"]global-launcher['"]/, 'GlobalLauncherPanel must render through the shared LauncherView')
assert.match(files.globalLauncherPanel, /<GlobalLauncherFrameSwitch/, 'GlobalLauncherPanel must delegate frame selection to the frame switch')
assert.doesNotMatch(files.globalLauncherHost, /<LauncherView|<GlobalLauncherFrameSwitch/, 'GlobalLauncherHost must delegate panel and frame rendering to GlobalLauncherPanel')
assert.match(files.globalLauncherSearchFrame, /<LauncherMixedList/, 'GlobalLauncher search frame must use the shared mixed list')
assert.match(files.globalLauncherResultFrame, /<LauncherResultChoiceRow/, 'GlobalLauncher result frame must use the shared result choice row')
assert.match(files.globalLauncherSearchFrame + files.globalLauncherResultFrame, /<LauncherHintKey/, 'GlobalLauncher frames must use shared footer key hints')
assert.match(files.globalLauncherResultFrame, /<LauncherHintText/, 'GlobalLauncher result frame must use shared footer text hints')
assert.match(files.globalLauncherFrames, /<GlobalLauncherSystemSurfaceFrame/, 'GlobalLauncherFrameSwitch must delegate system surfaces to a frame component')
assert.match(files.globalLauncherFrames, /<GlobalLauncherSettingsFrame/, 'GlobalLauncherFrameSwitch must delegate settings to a frame component')
assert.match(files.globalLauncherFrames, /<GlobalLauncherPluginSurfaceFrame/, 'GlobalLauncherFrameSwitch must delegate plugin surfaces to a frame component')
assert.match(files.globalLauncherFrames, /<GlobalLauncherSearchFrame/, 'GlobalLauncherFrameSwitch must delegate search rendering to a frame component')
assert.match(files.globalLauncherFrames, /<GlobalLauncherCollectInputFrame/, 'GlobalLauncherFrameSwitch must delegate collect-input rendering to a frame component')
assert.match(files.globalLauncherFrames, /<GlobalLauncherResultFrame/, 'GlobalLauncherFrameSwitch must delegate result rendering to a frame component')
assert.match(files.globalLauncherSelectionController, /export function useGlobalLauncherSelectionController/, 'GlobalLauncher item selection must live in a dedicated controller hook')
assert.match(files.globalLauncherSelectionController, /resolvePluginSurfaceTarget/, 'selection controller must own plugin surface interception')
assert.match(files.globalLauncherSelectionController, /grantGlobalLauncherItemPermissions/, 'selection controller must own permission grant continuation')
assert.match(files.globalLauncherHost, /useGlobalLauncherSelectionController/, 'GlobalLauncherHost must use the selection controller hook')
assert.doesNotMatch(files.globalLauncherHost, /const selectItem\s*=|function executeDomainItem|function grantItemPermissionsAndRun|function cancelItemPermissionPrompt|resolvePluginSurfaceTarget|grantGlobalLauncherItemPermissions/, 'GlobalLauncherHost must not inline item selection, permission continuation logic')
assert.doesNotMatch(files.globalLauncherHost, /function LauncherList|const LauncherListItem|function ResultChoiceRow|function HintKey|function HintText|function getLauncherItemKindLabel|function isLongResultText|function HostSurfaceView|<PluginSettingsContent|<PluginSurfaceRenderer|<LauncherMixedList|<LauncherResultChoiceRow|<LauncherHintKey|<LauncherHintText|<Search className=/, 'GlobalLauncherHost must not carry duplicate shared launcher UI primitives or extracted frames')
assert.match(files.surfaceRegistry, /export type SurfaceInstance/, 'Surface registry must model surface instances')
assert.match(files.surfaceRegistry, /upsertSurfaceInstance/, 'Surface registry must upsert surface instances')
assert.match(files.surfaceRegistry, /getSurfaceInstances/, 'Surface registry must expose current surfaces')
assert.match(files.surfaceRegistry, /SURFACE_REGISTRY_EVENT/, 'Surface registry must sync state across windows through Tauri events')
assert.match(files.surfaceRegistry, /broadcastSurfaceRegistryMutation/, 'Surface registry must broadcast local mutations')
assert.match(files.surfaceRegistry, /applyRemoteSurfaceRegistryMutation/, 'Surface registry must apply remote mutations')
assert.match(files.surfaceRegistry, /surface_registry_upsert/, 'Surface registry must persist mutations through the Rust side registry')
assert.match(files.surfaceRegistry, /surface_registry_snapshot/, 'Surface registry must hydrate from the Rust side registry')
assert.match(files.tauriLib, /struct\s+SurfaceRegistryState/, 'native runtime must own a Rust side SurfaceRegistry')
assert.match(files.tauriLib, /fn\s+surface_registry_upsert/, 'native runtime must expose a surface registry upsert command')
assert.match(files.tauriLib, /fn\s+surface_registry_snapshot/, 'native runtime must expose a surface registry snapshot command')
assert.match(files.tauriLib, /surface_registry_mark_state/, 'native runtime must expose a surface registry mark-state command')
assert.match(files.tauriLib, /surface_registry_remove/, 'native runtime must expose a surface registry remove command')
assert.match(files.surfaceActions, /focusSurfaceInstance/, 'Surface registry must provide a switch/focus operation')
assert.match(files.surfaceActions, /requestOpenLauncherHostSurface\(['"]system-settings['"]\)/, 'Surface focus must reopen Settings through the launcher host surface')
assert.match(files.surfaceActions, /requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'Surface focus must reopen Plugins through the launcher host surface')
assert.match(files.surfaceActions, /surface\.kind === ['"]plugin-editor['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'Surface focus must route PluginEditor instances back to the Plugins host surface')
assert.doesNotMatch(files.surfaceActions, /requestOpenPluginEditorSurface/, 'Surface focus must not use deleted plugin editor bridge')
assert.match(files.pluginSurfaceWindowComponent, /upsertSurfaceInstance\([\s\S]*kind:\s*['"]plugin-surface['"]/, 'Plugin surface window component must upsert its own registry record')
assert.match(files.pluginSurfaceWindowComponent, /markSurfaceInstanceState\([\s\S]*['"]hidden['"]/, 'Plugin surface window component must mark its surface hidden on teardown')
assert.match(files.windowManagerEditor, /function\s+showEditorWindow\(\)[\s\S]*requestOpenEditorWindow\(\)/, 'window manager must expose editor window open operations through a facade')
assert.match(files.windowManagerEditor, /function\s+closeEditorWindow\([\s\S]*requestCloseEditorWindow\(/, 'window manager must expose editor window close operations through a facade')
assert.match(files.windowManagerPluginSurfaces, /function\s+showPluginSurfaceWindow\(target:[\s\S]*requestOpenPluginSurfaceWindow\(target\)/, 'window manager must expose plugin surface window operations through a facade')
assert.match(files.windowManagerPluginSurfaces, /function\s+hidePluginSurfaceWindow\(target:[\s\S]*requestHidePluginSurfaceWindow\(target\)/, 'window manager must expose plugin surface window hide operations through a facade')
assert.match(files.windowManagerLauncher, /showLauncherWindow/, 'window manager must expose launcher window operations')
assert.match(files.windowLabels, /EDITOR_WINDOW_LABEL/, 'window manager must centralize window labels')
assert.match(files.windowLabels, /LAUNCHER_WINDOW_LABEL/, 'window manager must centralize launcher window labels')
assert.match(files.editorBridge, /emit\(EDITOR_BRIDGE_REQUEST_EVENT/, 'editor bridge must address the editor window through the centralized label')
assert.match(files.contextBroker, /EDITOR_WINDOW_LABEL/, 'context broker must use the centralized editor window label')
assert.match(files.defaultWorkflowProviders, /EDITOR_WINDOW_LABEL/, 'workflow providers must use the centralized editor window label')
assert.match(files.windowManagerLauncher, /LAUNCHER_WINDOW_LABEL/, 'launcher window manager must use the centralized launcher label')
assert.match(files.globalLauncherSurfaceRegistry, /LAUNCHER_WINDOW_LABEL/, 'global launcher surface registry must use the centralized launcher label')
assert.doesNotMatch(files.globalLauncherSurfaceRegistry, /windowLabel:\s*standaloneLauncher \? ['"]launcher['"] : ['"]main['"]|windowLabel:\s*['"]main['"]/, 'global launcher surface registry must not retain retired main-window labels')
assert.match(files.launcherUsage, /['"]editor-command-bar['"]:\s*\{\}/, 'launcher usage must have an editor-command-bar bucket')
assert.match(files.launcherRegistry, /normalizeLauncherSurfaceId\(candidate\) === normalizedSurfaceId/, 'launcher registry must match legacy command-palette items against editor-command-bar host')
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
assert.doesNotMatch(
  files.store,
  /\bpluginEditor\b|\bopenPluginEditor\b|\bclosePluginEditor\b/,
  'Plugin editor surface state must stay inside PluginsSurface instead of the shared app store',
)
assert.doesNotMatch(
  files.store,
  /\beditorText\b|\bsetEditorText\b|\beditorInstance\b|\bsetEditorInstance\b/,
  'App store must not mirror editor document text or Monaco runtime instances across windows',
)
assert.match(
  files.workspaceStore,
  /createWorkspaceSessionStorage[\s\S]*isEditorWindowWorkspaceSession\(\)[\s\S]*window\.sessionStorage[\s\S]*workspaceRuntimeStorage/,
  'workspace store persistence must be editor-window session scoped and memory-only outside editor windows',
)
assert.doesNotMatch(
  files.workspaceStore,
  /isEditorWindowWorkspaceSession\(\)\s*\?\s*window\.sessionStorage\s*:\s*window\.localStorage/,
  'launcher/background runtimes must not persist a shadow editor workspace in localStorage',
)
assert.match(files.globalLauncherHost, /launcherHostSurfaceTarget/, 'GlobalLauncherHost must read launcher-hosted surface target')
assert.match(files.globalLauncherFrames, /GlobalLauncherSystemSurfaceFrame/, 'GlobalLauncherFrameSwitch must render app surfaces through a frame')
assert.match(files.globalLauncherSystemSurfaceFrame, /SystemSettingsSurface/, 'GlobalLauncher system frame must render SystemSettingsSurface')
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
assert.match(files.tauriLib, /async fn show_quick_editor_window/, 'native runtime must expose show_quick_editor_window')
assert.match(files.tauriLib, /WebviewWindowBuilder::new\([\s\S]{0,180}QUICK_EDITOR_WINDOW_LABEL[\s\S]{0,260}index\.html\?window=quick-editor/, 'native runtime must create the editor window')
assert.match(files.tauriLib, /if let Some\(window\) = app\.get_webview_window\(QUICK_EDITOR_WINDOW_LABEL\)/, 'native editor window command must reuse an existing editor window')
assert.match(files.tauriLib, /fn show_quick_editor_window[\s\S]*?set_focus/, 'native editor window command must focus editor windows through the native helper')
assert.doesNotMatch(files.tauriHotkeys, /get_webview_window\("main"\)|ROUTE_GLOBAL_PINNED_LAUNCHER_SHORTCUT_EVENT/, 'native hotkeys must not branch through main window focus')
assert.doesNotMatch(files.globalPinnedLauncher, /shouldOpenCommandPaletteInMainWindow|setEditorCommandBarOpen\(true\)/, 'global pinned launcher shortcut must not route to the retired command palette path')
assert.match(files.globalPinnedLauncher, /routeGlobalPinnedLauncherShortcut\(\)[\s\S]{0,300}showLauncherWindow\(\)/, 'global pinned launcher shortcut must directly open the launcher window')
assert.doesNotMatch(files.globalLauncherHost, /emitTo\(['"]main['"]|hiven:\/\/run-pinned-action/, 'standalone launcher must not send pinned actions to a retired main window')
assert.doesNotMatch(files.hostActions, /host:view:editor|show-main-panel|core-pane\.show-main-panel/, 'global launcher must not expose the retired main panel action')
assert.doesNotMatch(files.workspaceTypes, /app\.showMainPanel/, 'workspace effects must not expose the retired main panel effect')
assert.doesNotMatch(files.effectRunner, /app\.showMainPanel|setActiveView\(['"]editor['"]\)/, 'effect runner must not route through the retired main-window ViewId model')
assert.doesNotMatch(files.pluginApi, /app\.showMainPanel|applyEffects\(\[\{ type: ['"]app\.showMainPanel['"]/, 'plugin launcher API must not route showMainPanel through the retired effect')
assert.match(files.launcherTypes, /showEditorWindow\(\): Promise</, 'plugin launcher API must expose showEditorWindow instead of only retired main panel naming')
assert.doesNotMatch(files.launcherTypes, /showMainPanel/, 'plugin launcher API must not expose the retired showMainPanel alias')
assert.match(files.pluginApi, /showEditorWindow: openEditorWindow/, 'plugin launcher API must wire showEditorWindow to the editor window facade')
assert.doesNotMatch(files.pluginApi, /showMainPanel/, 'plugin launcher API implementation must not keep the retired showMainPanel alias')
assert.doesNotMatch(files.pluginHostCore, /app\.showMainPanel/, 'plugin core SDK must not mint the retired main panel effect')

console.log('window architecture phase checks passed')
