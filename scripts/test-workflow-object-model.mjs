#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  workObject: read('src/workflow/workObject.ts'),
  workAction: read('src/workflow/workAction.ts'),
  outputTarget: read('src/workflow/outputTarget.ts'),
  outputRouter: read('src/workflow/outputRouter.ts'),
  workflowRegistry: read('src/workflow/workflowRegistry.ts'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  workflowLauncherAdapter: read('src/workflow/workflowLauncherAdapter.ts'),
  workflowIndex: read('src/workflow/index.ts'),
  contextBroker: read('src/launcher/context/contextBroker.ts'),
  editorContextSnapshot: read('src/workspace/editorContextSnapshot.ts'),
  surfaceRegistry: read('src/surfaces/registry.ts'),
  surfaceActions: read('src/surfaces/actions.ts'),
  hostProvider: read('src/workspace/launcher/hostProvider.ts'),
  globalLauncherHost: read('src/launcher/hosts/GlobalLauncherHost.tsx'),
  globalLauncherKeyboard: read('src/components/launcher/GlobalLauncherKeyboard.ts'),
  pluginSurfacePanel: read('src/components/pluginSurface/PluginSurfacePanel.tsx'),
  pluginSurfacePanelProvider: read('src/workspace/pluginSurfacePanelProvider.ts'),
  workflowOutputShelfPanel: read('src/components/workflow/WorkflowOutputShelfPanel.tsx'),
  workflowOutputShelfPanelProvider: read('src/workspace/workflowOutputShelfPanelProvider.ts'),
  clipboardHistoryWorkflow: read('src/workflow/clipboardHistoryWorkflowProvider.ts'),
  clipboardHistoryPlugin: read('src/plugins/clipboard-history/index.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-object-model'],
  'node scripts/test-workflow-object-model.mjs',
  'package.json must expose test:workflow-object-model',
)

for (const objectType of ['text', 'clipboard', 'app', 'window', 'file', 'url', 'plugin-surface', 'editor-document']) {
  assert.match(files.workObject, new RegExp(`['"]${objectType}['"]`), `WorkObject must model ${objectType}`)
}

for (const targetKind of [
  'copy',
  'paste-to-foreground-app',
  'replace-editor-selection',
  'insert-into-editor',
  'open-in-editor',
  'open-plugin-surface',
  'attach-editor-panel',
  'save-to-shelf',
]) {
  assert.match(files.outputTarget, new RegExp(`kind:\\s*['"]${targetKind}['"]`), `OutputTarget must model ${targetKind}`)
}

assert.match(files.workAction, /accepts:\s*WorkObjectType\[\]/, 'WorkAction must declare accepted object types')
assert.match(files.workAction, /defaultOutputTarget\?:\s*OutputTarget\['kind'\]/, 'WorkAction must declare default output target kind')
assert.match(files.workAction, /run\(input:\s*WorkObject,\s*ctx:\s*WorkContext\)/, 'WorkAction must run against a WorkObject and WorkContext')
assert.match(files.workflowRegistry, /registerWorkObjectProvider/, 'Workflow must have a WorkObject provider registry')
assert.match(files.workflowRegistry, /registerWorkActionProvider/, 'Workflow must have a WorkAction provider registry')
assert.match(files.workflowRegistry, /collectWorkObjects/, 'Workflow must collect objects from registered providers')
assert.match(files.workflowRegistry, /getWorkActions/, 'Workflow must collect actions from registered providers')
assert.match(files.workflowRegistry, /filterActionsForObjectType/, 'Workflow action registry must centrally filter actions by accepted object type')
assert.match(files.workflowRegistry, /action\.accepts\.includes\(input\.type\)/, 'Workflow action registry must enforce WorkAction.accepts against the current WorkObject.type')
assert.match(files.workflowRegistry, /filterActionsForContextRequirements/, 'Workflow action registry must centrally filter actions by required context')
assert.match(files.workflowRegistry, /action\.requiresContext\.every\(\(requirement\) => contextRequirementSatisfied\(requirement,\s*ctx\)\)/, 'Workflow action registry must enforce WorkAction.requiresContext against the current WorkContext')
assert.match(files.workflowRegistry, /case\s+['"]selected-text['"][\s\S]*selectedText|externalSelection/, 'Context requirement filtering must support selected text')
assert.match(files.workflowRegistry, /case\s+['"]clipboard['"][\s\S]*ctx\.snapshot\.clipboard/, 'Context requirement filtering must support clipboard context')
assert.match(files.workflowRegistry, /case\s+['"]editor-pane['"][\s\S]*ctx\.snapshot\.editor/, 'Context requirement filtering must support editor pane context')
assert.match(files.workflowRegistry, /case\s+['"]foreground-app['"][\s\S]*ctx\.snapshot\.foreground/, 'Context requirement filtering must support foreground app context')
assert.match(files.defaultWorkflowProviders, /currentContextObjectProvider/, 'Workflow must expose current-context object provider')
assert.match(files.defaultWorkflowProviders, /hostAppObjectProvider/, 'Workflow must expose app WorkObject provider')
assert.match(files.defaultWorkflowProviders, /surfaceObjectProvider/, 'Workflow must expose surface WorkObject provider')
assert.match(files.defaultWorkflowProviders, /defaultTextActionProvider/, 'Workflow must expose default text actions')
assert.match(files.defaultWorkflowProviders, /defaultAppActionProvider/, 'Workflow must expose default app actions')
assert.match(files.defaultWorkflowProviders, /defaultSurfaceActionProvider/, 'Workflow must expose default surface actions')
assert.match(files.defaultWorkflowProviders, /focusSurfaceInstance/, 'Surface actions must be able to focus existing surface objects')
assert.match(files.defaultWorkflowProviders, /Attach to Editor Panel/, 'Plugin surface objects must expose an editor attach action')
assert.match(files.defaultWorkflowProviders, /PLUGIN_SURFACE_PANEL_ID/, 'Plugin surface attach action must route through the shared editor panel bridge')
assert.match(files.defaultWorkflowProviders, /routeTextOutput\(text,\s*\{\s*kind:\s*['"]paste-to-foreground-app['"]/, 'Default text actions must support paste to foreground app')
assert.match(files.defaultWorkflowProviders, /routeTextOutput\(text,\s*\{\s*kind:\s*['"]open-in-editor['"]/, 'Default text actions must support open in editor')
assert.match(files.defaultWorkflowProviders, /textAction\([\s\S]*defaultOutputTarget:\s*OutputTarget\['kind'\]/, 'Text action helper must require explicit default output target metadata')
assert.match(files.defaultWorkflowProviders, /workflow\.save-shelf[\s\S]*['"]save-to-shelf['"]/, 'Save to Shelf action must declare save-to-shelf as its default output target')
assert.match(files.defaultWorkflowProviders, /workflow\.paste[\s\S]*requiresContext:\s*\[\{ kind:\s*['"]foreground-app['"] \}\]/, 'Paste action must require a foreground app context')
assert.match(files.defaultWorkflowProviders, /workflow\.draft-polite-reply[\s\S]*requiresContext:\s*\[\{ kind:\s*['"]foreground-app['"] \}\]/, 'Reply paste action must require a foreground app context')
assert.match(files.defaultWorkflowProviders, /workflow\.replace-selection[\s\S]*requiresContext:\s*\[\{ kind:\s*['"]editor-pane['"] \}\]/, 'Replace selection action must require an editor pane context')
assert.match(files.defaultWorkflowProviders, /workflow\.insert-editor[\s\S]*requiresContext:\s*\[\{ kind:\s*['"]editor-pane['"] \}\]/, 'Insert into editor action must require an editor pane context')
assert.match(files.clipboardHistoryWorkflow, /workflow\.paste-clipboard-history-item[\s\S]*requiresContext:\s*\[\{ kind:\s*['"]foreground-app['"] \}\]/, 'Clipboard history paste action must require a foreground app context')
assert.match(files.workflowLauncherAdapter, /getWorkflowObjectLauncherItems/, 'Workflow objects must adapt into launcher items')
assert.match(files.workflowLauncherAdapter, /workflow:object:/, 'Workflow object launcher items must have stable workflow object keys')
assert.match(files.workflowLauncherAdapter, /metadata:\s*\{[\s\S]*kind:\s*['"]workflow-object['"][\s\S]*objectId:\s*object\.id/, 'Workflow object launcher items must retain object identity metadata')
assert.match(files.workflowLauncherAdapter, /subtitle:\s*object\.subtitle/, 'Workflow object launcher rows must show an explicit action-expansion hint')
assert.match(files.workflowLauncherAdapter, /function\s+aliasesForObject\(object:\s*WorkObject\)/, 'Workflow object subtitles must teach the user to press Tab for actions')
assert.match(files.workflowLauncherAdapter, /getWorkActions\(object,\s*ctx\)/, 'Selecting a workflow object must expand to its actions')
assert.match(files.workflowLauncherAdapter, /kind:\s*['"]workflow-action['"]/, 'Workflow object action choices must be explicitly typed for stable object-action UX')
assert.match(files.workflowLauncherAdapter, /objectId:\s*object\.id[\s\S]*actionId:\s*action\.id/, 'Workflow object action choices must retain object/action identity')
assert.match(files.workflowLauncherAdapter, /outputTarget:\s*action\.defaultOutputTarget/, 'Workflow action choices must retain their default OutputTarget identity')
assert.match(files.workflowLauncherAdapter, /subtitle:\s*actionChoiceSubtitle\(action,\s*object\)/, 'Workflow action choices must show the output target in their subtitle')
assert.match(files.workflowLauncherAdapter, /function\s+actionChoiceSubtitle\(action:\s*WorkAction,\s*object:\s*WorkObject\):\s*string[\s\S]*Output:[\s\S]*action\.defaultOutputTarget/, 'Workflow action choice subtitles must describe the default output target')
assert.match(files.hostProvider, /registerDefaultWorkflowProviders\(\)/, 'Host launcher provider must register default workflow providers')
assert.match(files.hostProvider, /getWorkflowObjectLauncherItems/, 'Global launcher dynamic items must include workflow objects')
assert.match(files.surfaceRegistry, /SurfaceInstance/, 'Surface registry must define surface instances for workflow objects')
assert.match(files.surfaceRegistry, /getSurfaceInstances/, 'Surface registry must provide surface instances to workflow object providers')
assert.match(files.surfaceActions, /focusSurfaceInstance/, 'Surface registry must expose a focus/switch action')
assert.match(files.surfaceActions, /showEditorWindow/, 'Surface focus must route editor surfaces through the window manager')
assert.match(files.surfaceActions, /showPluginSurfaceWindow/, 'Surface focus must route plugin surfaces through the window manager')
assert.match(files.surfaceActions, /surface\.kind === ['"]settings['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-settings['"]\)/, 'Surface focus must route Settings surfaces through the launcher host surface')
assert.match(files.surfaceActions, /surface\.kind === ['"]plugins['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/, 'Surface focus must route Plugins surfaces through the launcher host surface')
assert.match(files.surfaceActions, /requestOpenLauncherPluginSettingsSurface\([\s\S]*sourceFromSettingsSurfaceInstanceId\(surface\.id\)[\s\S]*surface\.pluginId/, 'Surface focus must reopen plugin settings surfaces inside the global launcher')
assert.match(files.defaultWorkflowProviders, /import \{ showEditorWindow \} from ['"]\.\.\/workspace\/windowManager\/editorWindow['"]/, 'workflow object editor actions must statically import the editor window manager route')
assert.doesNotMatch(files.defaultWorkflowProviders, /requestOpenEditorWindow/, 'workflow object editor actions must not call the lower-level lifecycle API directly')
assert.match(files.defaultWorkflowProviders, /import \{ showPluginSurfaceWindow \} from ['"]\.\.\/workspace\/windowManager\/pluginSurfaceWindows['"]/, 'workflow object plugin-surface window actions must statically import the window manager route')
assert.doesNotMatch(files.defaultWorkflowProviders, /import\(['"]\.\.\/workspace\/windowManager\/pluginSurfaceWindows['"]\)/, 'workflow object plugin-surface actions must not dynamically import an already-static window manager chunk')
assert.doesNotMatch(files.defaultWorkflowProviders, /requestOpenPluginSurfaceWindow/, 'workflow object plugin-surface actions must not call the lower-level lifecycle API directly')
assert.match(files.pluginSurfacePanel, /PLUGIN_SURFACE_PANEL_ID/, 'Editor attach bridge must define a stable plugin surface panel id')
assert.match(files.pluginSurfacePanel, /<PluginSurfaceRenderer[\s\S]*presentation=['"]editor-panel['"]/, 'Editor attach bridge must render plugin surfaces through the shared renderer')
assert.match(files.pluginSurfacePanelProvider, /id:\s*PLUGIN_SURFACE_PANEL_ID[\s\S]*registerProductionPlugin[\s\S]*\[panel\]/, 'Host runtime must register the plugin surface panel bridge as a V2 panel')
assert.match(files.hostProvider, /registerPluginSurfacePanelProvider\(\)/, 'Host launcher bootstrap must register the plugin surface panel provider')
assert.match(files.workflowOutputShelfPanel, /WORKFLOW_OUTPUT_SHELF_PANEL_ID\s*=\s*['"]workflow-output-shelf['"]/, 'Workflow output shelf must define a stable V2 panel id')
assert.match(files.workflowOutputShelfPanelProvider, /id:\s*WORKFLOW_OUTPUT_SHELF_PANEL_ID[\s\S]*registerProductionPlugin[\s\S]*\[panel\]/, 'Host runtime must register the workflow output shelf as a V2 panel')
assert.match(files.hostProvider, /registerWorkflowOutputShelfPanelProvider\(\)/, 'Host launcher bootstrap must register the workflow output shelf panel provider')
assert.match(files.clipboardHistoryWorkflow, /registerWorkObjectProvider/, 'Clipboard history plugin must register its own WorkObject provider')
assert.match(files.clipboardHistoryWorkflow, /createClipboardHistoryRepository/, 'Clipboard history WorkObject provider must read real plugin history storage')
assert.match(files.defaultWorkflowProviders, /registerClipboardHistoryWorkflowProvider\(\)/, 'Default workflow registration must activate clipboard history WorkObjects')
assert.match(files.globalLauncherKeyboard, /event\.key === ['"]Tab['"][\s\S]*isWorkflowObjectLauncherItem/, 'Global launcher must support Tab expansion for workflow objects')
assert.match(files.outputRouter, /routeTextOutput/, 'OutputRouter must provide a text routing entry point')
assert.match(files.outputRouter, /createDefaultOutputRouterContext/, 'OutputRouter must provide a default host-backed routing context')
for (const targetKind of [
  'replace-editor-selection',
  'insert-into-editor',
  'open-plugin-surface',
  'attach-editor-panel',
  'save-to-shelf',
]) {
  assert.match(files.outputRouter, new RegExp(`case\\s+['"]${targetKind}['"]`), `OutputRouter must route ${targetKind}`)
}
assert.match(files.contextBroker, /WorkContextSnapshot/, 'Context broker must define WorkContextSnapshot')
assert.match(files.contextBroker, /foreground\?:/, 'Context snapshot must include foreground app info')
assert.match(files.contextBroker, /editor\?:\s*EditorContextSnapshot/, 'Context snapshot must include editor context')
assert.match(files.contextBroker, /clipboard\?:\s*ClipboardContextSnapshot/, 'Context snapshot must include clipboard context')
assert.match(files.contextBroker, /createWorkContextSnapshot/, 'Context broker must expose snapshot composition')
assert.match(files.contextBroker, /editorContextProvider/, 'Context broker must expose a real editor context provider')
assert.match(files.contextBroker, /clipboardContextProvider/, 'Context broker must expose a real clipboard context provider')
assert.match(files.contextBroker, /createDefaultWorkContextSnapshot/, 'Context broker must compose default context providers')
assert.doesNotMatch(files.contextBroker, /useWorkspaceStore|runtimeRegistry/, 'Context broker must not directly read another window runtime state')
assert.match(files.editorContextSnapshot, /if \(!isEditorWindowRuntime\(\)\) return undefined[\s\S]*runtimeRegistry\.getCodeEditor/, 'Editor context snapshot module must guard live editor runtime reads to the editor window')
assert.match(files.workflowIndex, /routeTextOutput/, 'workflow index must re-export router entry points')
assert.match(files.workflowIndex, /createDefaultOutputRouterContext/, 'workflow index must re-export default output router context')
assert.match(files.workflowIndex, /createDefaultWorkContextSnapshot/, 'workflow index must re-export default context snapshot')
assert.match(files.workflowIndex, /registerWorkObjectProvider/, 'workflow index must re-export workflow registries')

console.log('workflow object model checks passed')
