#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')


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

const packageJson = JSON.parse(read('package.json'))
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const capability = JSON.parse(read('src-tauri/capabilities/default.json'))

const files = {
  app: read('src/App.tsx'),
  main: read('src/main.tsx'),
  tauriLib: read('src-tauri/src/lib.rs'),
  globalHotkey: read('src/hotkeys/globalPinnedLauncher.ts'),
  pluginSurfaceHotkeys: read('src/hotkeys/pluginSurfaceShortcuts.ts'),
  editorWindow: read('src/components/EditorWindow.tsx'),
  editorView: read('src/views/EditorView.tsx'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  editorCommandBar: read('src/launcher/hosts/EditorCommandBarHost.tsx'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  globalLauncherHost: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  globalLauncherSurfaceRegistry: read('src/components/launcher/GlobalLauncherSurfaceRegistry.ts'),
  windowLabels: read('src/workspace/windowManager/windowLabels.ts'),
  launcherTypes: read('src/workspace/launcher/types.ts'),
  launcherRegistry: read('src/workspace/launcher/registry.ts'),
  launcherSession: read('src/workspace/launcher/useLauncherSession.ts'),
  launcherView: read('src/components/launcher/LauncherView.tsx'),
  launcherFrames: read('src/components/launcher/GlobalLauncherFrames.tsx'),
  globalLauncherSearchFrame: read('src/components/launcher/GlobalLauncherSearchFrame.tsx'),
  globalLauncherPluginSurfaceFrame: read('src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx'),
  globalLauncherSystemSurfaceFrame: read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx'),
  globalLauncherSettingsFrame: read('src/components/launcher/GlobalLauncherSettingsFrame.tsx'),
  globalLauncherResultFrame: read('src/components/launcher/GlobalLauncherResultFrame.tsx'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  editorBridge: read('src/workspace/editorBridge.ts'),
  editorWindowApi: read('src/workspace/editorWindow.ts'),
  pluginSurfaceLifecycle: read('src/workspace/pluginSurfaceWindows.ts'),
  pluginSurfaceWindowManager: read('src/workspace/windowManager/pluginSurfaceWindows.ts'),
  pluginSurfaceWindow: read('src/components/PluginSurfaceWindow.tsx'),
  pluginSurfaceRenderer: read('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  pluginSurfacePanel: read('src/components/pluginSurface/PluginSurfacePanel.tsx'),
  pluginSurfacePanelProvider: read('src/workspace/pluginSurfacePanelProvider.ts'),
  workflowOutputShelfPanel: read('src/components/workflow/WorkflowOutputShelfPanel.tsx'),
  workflowOutputShelfPanelProvider: read('src/workspace/workflowOutputShelfPanelProvider.ts'),
  surfaceRegistry: read('src/surfaces/registry.ts'),
  surfaceActions: read('src/surfaces/actions.ts'),
  settingsSurface: read('src/surfaces/SettingsSurface.tsx'),
  pluginsSurface: read('src/surfaces/PluginsSurface.tsx'),
  pluginEditorSurface: read('src/surfaces/PluginEditorSurface.tsx'),
  outputTarget: read('src/workflow/outputTarget.ts'),
  outputRouter: read('src/workflow/outputRouter.ts'),
  workflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  clipboardSurface: read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx'),
}

assert.equal(
  packageJson.scripts?.['test:refactor-final-acceptance'],
  'node scripts/test-refactor-final-acceptance.mjs',
  'package.json must expose the final refactor acceptance check',
)
assert.equal(
  packageJson.scripts?.['test:background-lifecycle'],
  'node scripts/test-background-lifecycle.mjs',
  'package.json must expose the background lifecycle acceptance check',
)

// Product/behavior acceptance: startup and global entry.
assert.ok(!tauriConfig.app.windows.some((window) => window.label === 'main'), 'startup must not declare a retired main window')
assert.ok(tauriConfig.app.windows.some((window) => window.label === 'launcher' && window.visible === false), 'startup must keep a hidden launcher/runtime window')
assert.ok(!capability.windows.includes('main'), 'native permissions must not target a retired main window')
assert.doesNotMatch(files.app, /function MainApp|<Sidebar\b|function ViewContent|ViewErrorBoundary|<CommandPalette\s*\/>/, 'App runtime must not mount the retired main navigation/editor shell')
assert.match(files.app, /function LauncherRuntimeApp/, 'default App must be launcher/background owned')
assert.match(files.app, /installGlobalPinnedLauncherHotkeys\(\)/, 'runtime must install the global launcher hotkey')
assert.match(files.globalHotkey, /routeGlobalPinnedLauncherShortcut\(\)[\s\S]{0,160}showLauncherWindow\(\)/, 'global hotkey must open the spotlight launcher through the window manager')
assert.doesNotMatch(files.tauriLib, /get_webview_window\("main"\)|show_and_focus_main_window|show_and_focus_window/, 'native runtime must not retain retired main-window focus paths')
assert.match(files.tauriLib, /show_launcher_window_for_hotkey/, 'native runtime must expose launcher hotkey entry')

// Shared launcher architecture.
assert.match(files.globalLauncher, /return <GlobalLauncherHost \/>/, 'GlobalLauncher must be a thin compatibility wrapper')
assert.match(files.commandPalette, /return <EditorCommandBar \/>/, 'CommandPalette must be a thin compatibility wrapper around EditorCommandBar')
assert.match(files.globalLauncherHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]global-launcher['"]/, 'Global launcher host must use the shared launcher session')
assert.match(files.editorCommandBar, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]editor-command-bar['"]/, 'Editor command bar must use the shared launcher session')
assert.match(files.launcherSession, /new LauncherController/, 'shared launcher session must own controller lifecycle')
assert.match(files.launcherView, /data-launcher-host/, 'shared LauncherView must stamp host identity')
assert.match(files.globalLauncherSearchFrame, /GlobalLauncherSearchFrame/, 'global launcher search UI must live in an extracted frame module')
assert.match(files.globalLauncherPluginSurfaceFrame, /GlobalLauncherPluginSurfaceFrame/, 'global launcher plugin surface UI must live in an extracted frame module')
assert.match(files.globalLauncherSystemSurfaceFrame, /GlobalLauncherSystemSurfaceFrame/, 'global launcher system surfaces must live in an extracted frame module')
assert.match(files.globalLauncherSettingsFrame, /GlobalLauncherSettingsFrame/, 'global launcher settings UI must live in an extracted frame module')
assert.match(files.globalLauncherResultFrame, /GlobalLauncherResultFrame/, 'global launcher result UI must live in an extracted frame module')
assert.match(files.launcherRegistry, /requiredCapabilities[\s\S]*launcherHostHasCapability/, 'launcher registry must enforce host capability filtering')

// Editor command bar is local, with an explicit bridge to global launcher.
assert.match(files.launcherTypes, /'editor-command-bar':\s*\{[\s\S]*presentation:\s*['"]editor-overlay['"]/, 'editor command bar must be modeled as editor overlay')
assert.doesNotMatch(files.launcherTypes.match(/'editor-command-bar':\s*\{[\s\S]*?capabilities:\s*\[([\s\S]*?)\]/)?.[1] ?? '', /app-search|system-power|settings|host-surfaces|plugin-surfaces/, 'editor command bar must exclude global navigation capabilities')
assert.match(files.editorCommandBar, /staticItemFilter:\s*filterEditorCommandBarItems/, 'editor command bar must filter to editor-local actions')
assert.match(files.hostActions, /systemKey:\s*['"]host:global:search-all-hiven['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*showLauncherWindow\(\)/, 'editor command bar must expose Search all Hiven as the explicit global bridge')
assert.match(files.hostActions, /systemKey:\s*['"]host:system:restart['"][\s\S]*surfaces:\s*\[['"]global-launcher['"]\]/, 'system power actions must be global-only')

// Editor is an independent system surface, not a main-window view.
assert.match(files.main, /windowType === ['"]editor['"][\s\S]*EditorWindow/, 'entrypoint must route ?window=editor to EditorWindow')
assert.match(files.editorWindowApi, /invoke\(['"]show_editor_window['"]\)/, 'editor window lifecycle must be native-managed')
assert.match(files.editorBridge, /showEditorWindow\(\)/, 'editor bridge must open editor windows through the window manager facade')
assert.doesNotMatch(files.editorBridge, /requestOpenEditorWindow/, 'editor bridge must not call the lower-level editor lifecycle API directly')
assert.match(files.tauriLib, /async fn show_editor_window/, 'native runtime must expose editor window creation')
assert.match(files.tauriLib, /WebviewWindowBuilder::new\([\s\S]{0,180}"editor"[\s\S]{0,260}index\.html\?window=editor/, 'native runtime must create an independent editor window')
assert.match(files.hostProvider, /getEditorWindowItems/, 'global launcher must provide an editor-opening item')
assert.match(files.editorWindow, /<EditorCommandBar \/>/, 'EditorWindow must host the local editor command bar directly')
assert.doesNotMatch(files.editorWindow, /CommandPalette/, 'EditorWindow runtime must not mount the retired CommandPalette compatibility wrapper')
assert.match(files.editorView, /<PanelHostV2 placement="left" \/>[\s\S]*<PanelHostV2 placement="bottom" \/>[\s\S]*<PanelHostV2 placement="right" \/>/, 'Editor must retain PanelHostV2 left/bottom/right')
assert.match(files.editorWindow, /upsertSurfaceInstance\([\s\S]*id:\s*EDITOR_WINDOW_LABEL/, 'EditorWindow must register itself as a surface using the centralized label')

// Cross-window editor bridge.
for (const action of ['getEditorContext', 'createEditorPane', 'replaceEditorSelection', 'insertIntoEditor', 'openEditorPanel']) {
  assert.match(files.editorBridge, new RegExp(action), `editor bridge must expose launcher-to-editor ${action}`)
}
for (const publisher of ['registerActiveEditorContext', 'updateActivePaneSnapshot']) {
  assert.match(files.editorBridge, new RegExp(publisher), `editor bridge must expose editor-to-launcher ${publisher}`)
  assert.match(files.editorWindow, new RegExp(publisher), `EditorWindow must publish ${publisher}`)
}
assert.doesNotMatch(files.outputRouter, /useWorkspaceStore|getState\(\)\.createPane|getState\(\)\.openPanelV2/, 'caller windows must not mutate editor workspace state directly')
assert.match(files.windowLabels, /EDITOR_WINDOW_LABEL/, 'window labels must centralize editor label constants')
assert.match(files.windowLabels, /LAUNCHER_WINDOW_LABEL/, 'window labels must centralize launcher label constants')
assert.match(files.editorBridge, /emitTo\(EDITOR_WINDOW_LABEL,/, 'editor bridge must use the centralized editor label')
assert.match(files.globalLauncherSurfaceRegistry, /LAUNCHER_WINDOW_LABEL/, 'global launcher surface registry must use the centralized launcher label')
assert.doesNotMatch(files.globalLauncherSurfaceRegistry, /windowLabel:\s*['"]main['"]|standaloneLauncher \? ['"]launcher['"] : ['"]main['"]/, 'surface registry must not publish retired main-window labels')

// Plugin surfaces are independent windows and can be attached to editor panels.
assert.match(files.main, /windowType === ['"]plugin-surface['"][\s\S]*PluginSurfaceWindow/, 'entrypoint must route ?window=plugin-surface to PluginSurfaceWindow')
assert.match(files.tauriLib, /async fn show_plugin_surface_window/, 'native runtime must expose plugin surface window creation')
assert.match(files.tauriLib, /async fn hide_plugin_surface_window/, 'native runtime must expose plugin surface window hiding')
assert.match(files.pluginSurfaceWindowManager, /function\s+showPluginSurfaceWindow\(target:[\s\S]*requestOpenPluginSurfaceWindow\(target\)/, 'window manager must expose plugin surface open lifecycle through a facade')
assert.match(files.pluginSurfaceWindowManager, /function\s+hidePluginSurfaceWindow\(target:[\s\S]*requestHidePluginSurfaceWindow\(target\)/, 'window manager must expose plugin surface hide lifecycle through a facade')
assert.match(files.pluginSurfaceHotkeys, /getPluginSurfaceShortcutPresentation\(target\) === ['"]window['"][\s\S]*showPluginSurfaceWindow\(target\)/, 'plugin surface shortcuts must route window surfaces to independent windows')
assert.match(files.pluginSurfaceWindow, /<PluginSurfaceRenderer[\s\S]*presentation=['"]plugin-surface-window['"]/, 'independent plugin surface windows must reuse shared renderer')
assert.match(files.pluginSurfacePanel, /PLUGIN_SURFACE_PANEL_ID/, 'attached plugin panel must define a stable panel id')
assert.match(files.pluginSurfacePanel, /<PluginSurfaceRenderer[\s\S]*presentation=['"]editor-panel['"]/, 'attached plugin panel must reuse shared surface renderer')
assert.match(files.pluginSurfacePanelProvider, /registerProductionPlugin[\s\S]*\[panel\]/, 'plugin surface panel bridge must be registered with PanelHostV2')
assert.match(files.workflowProviders, /workflow\.attach-plugin-surface-editor-panel/, 'workflow actions must expose attach-to-editor-panel for plugin surfaces')
assert.match(files.workflowProviders, /import \{ showPluginSurfaceWindow \} from ['"]\.\.\/workspace\/windowManager\/pluginSurfaceWindows['"]/, 'workflow plugin-surface window actions must use a static window manager import')
assert.doesNotMatch(files.workflowProviders, /import\(['"]\.\.\/workspace\/windowManager\/pluginSurfaceWindows['"]\)/, 'workflow plugin-surface window actions must not dynamically import an already-static window manager chunk')

// Surface registry is stable across windows.
assert.match(files.surfaceRegistry, /SURFACE_REGISTRY_EVENT/, 'surface registry must synchronize through Tauri events')
assert.match(files.surfaceRegistry, /surface_registry_snapshot/, 'surface registry must hydrate from Rust state')
assert.match(files.surfaceRegistry, /surface_registry_upsert/, 'surface registry must persist upserts to Rust state')
assert.match(files.tauriLib, /struct\s+SurfaceRegistryState/, 'native runtime must own Rust-side surface registry state')
assert.match(files.surfaceActions, /focusSurfaceInstance/, 'surface registry must expose focus/switch operation')

// Settings / Plugins / Plugin editor are first-class surfaces, not main-window views.
assert.match(files.globalLauncherSystemSurfaceFrame, /surfaces\/SettingsSurface/, 'launcher system frame must load SettingsSurface')
assert.match(files.globalLauncherSystemSurfaceFrame, /surfaces\/PluginsSurface/, 'launcher system frame must load PluginsSurface')
assert.match(files.settingsSurface, /<SurfaceShell[\s\S]*id=['"]settings['"]/, 'Settings must render through SurfaceShell')
assert.match(files.pluginsSurface, /<SurfaceShell[\s\S]*id=['"]plugins['"]/, 'Plugins must render through SurfaceShell')
assert.match(files.pluginEditorSurface, /<SurfaceShell[\s\S]*id=['"]plugin-editor['"]/, 'Plugin editor must render through SurfaceShell')

// Unified output routing supports short tasks and long-task handoff.
for (const kind of [
  'copy',
  'paste-to-foreground-app',
  'replace-editor-selection',
  'insert-into-editor',
  'open-in-editor',
  'open-plugin-surface',
  'attach-editor-panel',
  'save-to-shelf',
]) {
  assert.match(files.outputTarget, new RegExp(`kind:\\s*['"]${kind}['"]`), `OutputTarget must model ${kind}`)
  assert.match(files.outputRouter, new RegExp(`case\\s+['"]${kind}['"]`), `OutputRouter must route ${kind}`)
}
assert.match(files.outputRouter, /pasteToForegroundApp:[\s\S]*createPluginPaste\(\)\.pasteText\(text\)/, 'clipboard/text actions must be able to paste to the foreground app')
assert.match(files.outputRouter, /openInEditor:[\s\S]*createEditorPane\(\{[\s\S]*text/, 'complex text must be routable into Editor')
assert.match(files.outputRouter, /openPluginSurface:[\s\S]*showPluginSurfaceWindow\(\{/, 'plugin surface output targets must route through the plugin surface window manager')
assert.doesNotMatch(files.outputRouter, /openPluginSurfaceTool|openGlobalLauncherOverlay|useAppStore\.getState\(\)\.openPluginSurfaceTool/, 'output router must not mutate launcher store to open plugin surfaces')
assert.match(files.outputRouter, /attachEditorPanel:[\s\S]*openEditorPanel\(\{/, 'complex surfaces must be attachable into Editor panels')
assert.match(files.outputRouter, /saveToShelf:[\s\S]*openEditorPanel\(\{[\s\S]*WORKFLOW_OUTPUT_SHELF_PANEL_ID/, 'save-to-shelf output targets must route through the editor bridge')
assert.doesNotMatch(files.outputRouter, /applyEffects|type:\s*['"]panel\.open['"]/, 'output router must not directly mutate editor panels')
assert.match(files.workflowOutputShelfPanel, /WORKFLOW_OUTPUT_SHELF_PANEL_ID\s*=\s*['"]workflow-output-shelf['"]/, 'workflow output shelf must define a stable panel id')
assert.match(files.workflowOutputShelfPanelProvider, /registerProductionPlugin[\s\S]*\[panel\]/, 'workflow output shelf must be registered as a V2 panel')
assert.match(files.clipboardSurface, /pasteText|paste-to-foreground-app|copyText/, 'clipboard history surface must expose copy/paste behavior')
assert.match(files.tauriLib, /tauri::RunEvent::Reopen[\s\S]*show_launcher_window_for_hotkey/, 'closing visible windows must leave a background runtime that can reopen the launcher')
assert.doesNotMatch(files.tauriLib, /RunEvent::ExitRequested[\s\S]*app\.exit|process::exit|std::process::exit/, 'runtime must not explicitly exit when all visible windows are closed')

console.log('refactor final acceptance checks passed')
