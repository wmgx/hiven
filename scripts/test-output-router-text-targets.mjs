#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const outputTarget = read('src/workflow/outputTarget.ts')
const outputRouter = read('src/workflow/outputRouter.ts')
const defaultWorkflowProviders = read('src/workflow/defaultWorkflowProviders.ts')
const panelProvider = read('src/workspace/pluginSurfacePanelProvider.ts')
const shelfPanelProvider = read('src/workspace/workflowOutputShelfPanelProvider.ts')
const shelfPanel = read('src/components/workflow/WorkflowOutputShelfPanel.tsx')
const hostProvider = read('src/workspace/launcher/hostProvider.ts')
const pluginPanel = read('src/components/pluginSurface/PluginSurfacePanel.tsx')

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
  assert.match(outputTarget, new RegExp(`kind:\\s*['"]${kind}['"]`), `OutputTarget must model ${kind}`)
  assert.match(outputRouter, new RegExp(`case\\s+['"]${kind}['"]`), `OutputRouter must route ${kind}`)
}

assert.match(outputRouter, /copy:\s*\(text\) => launcherApi\.copyText\(text\)/, 'copy target must use host copy API')
assert.match(outputRouter, /pasteToForegroundApp:[\s\S]*createPluginPaste\(\)\.pasteText\(text\)/, 'paste target must use paste host API')
assert.match(outputRouter, /replaceEditorSelection:[\s\S]*replaceEditorSelection\(text/, 'replace selection target must route through editor bridge')
assert.match(outputRouter, /insertIntoEditor:[\s\S]*insertIntoEditor\(text/, 'insert target must route through editor bridge')
assert.match(outputRouter, /openInEditor:[\s\S]*createEditorPane\(\{[\s\S]*text,[\s\S]*title:[\s\S]*language:/, 'open-in-editor target must send text through editor bridge')
assert.match(outputRouter, /import \{ showPluginSurfaceWindow \} from ['"]\.\.\/workspace\/windowManager\/pluginSurfaceWindows['"]/, 'open-plugin-surface target must import the plugin surface window manager')
assert.match(outputRouter, /openPluginSurface:[\s\S]*showPluginSurfaceWindow\(\{[\s\S]*pluginId:[\s\S]*surfaceId:/, 'open-plugin-surface target must route through the plugin surface window manager')
assert.doesNotMatch(outputRouter, /openPluginSurfaceTool|openGlobalLauncherOverlay|useAppStore\.getState\(\)\.openPluginSurfaceTool/, 'OutputRouter must not mutate launcher store to open plugin surfaces')
assert.match(outputRouter, /attachEditorPanel:[\s\S]*openEditorPanel\(\{[\s\S]*panelId:[\s\S]*placement:[\s\S]*inputs:/, 'attach-editor-panel target must send panel attach requests through editor bridge')
assert.doesNotMatch(outputRouter, /useWorkspaceStore|getState\(\)\.createPane|getState\(\)\.openPanelV2/, 'OutputRouter must not mutate editor workspace state from the caller window')
assert.match(outputRouter, /saveToShelf:[\s\S]*openEditorPanel\(\{[\s\S]*panelId:\s*WORKFLOW_OUTPUT_SHELF_PANEL_ID[\s\S]*inputs:\s*\{ text \}/, 'save-to-shelf target must route through the editor bridge into the output shelf panel')
assert.doesNotMatch(outputRouter, /applyEffects|type:\s*['"]panel\.open['"]/, 'save-to-shelf must not mutate panels from the caller window')
assert.match(defaultWorkflowProviders, /paste-to-foreground-app/, 'default text actions must expose paste-to-foreground-app')
assert.match(defaultWorkflowProviders, /replace-editor-selection/, 'default text actions must expose replace-editor-selection')
assert.match(panelProvider, /id:\s*PLUGIN_SURFACE_PANEL_ID/, 'plugin surface panel bridge must use the stable panel id')
assert.match(panelProvider, /registerProductionPlugin[\s\S]*\[panel\]/, 'plugin surface panel bridge must be registered')
assert.match(shelfPanelProvider, /id:\s*WORKFLOW_OUTPUT_SHELF_PANEL_ID[\s\S]*registerProductionPlugin[\s\S]*\[panel\]/, 'output shelf panel must be registered as a V2 panel')
assert.match(shelfPanel, /WORKFLOW_OUTPUT_SHELF_PANEL_ID\s*=\s*['"]workflow-output-shelf['"]/, 'output shelf panel must define a stable panel id')
assert.match(hostProvider, /registerWorkflowOutputShelfPanelProvider\(\)/, 'host launcher bootstrap must register the output shelf panel provider')
assert.match(pluginPanel, /<PluginSurfaceRenderer[\s\S]*presentation=['"]editor-panel['"]/, 'attached plugin panel must reuse shared surface renderer')

console.log('output router text target checks passed')
