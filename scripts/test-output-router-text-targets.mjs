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
assert.match(outputRouter, /openPluginSurface:[\s\S]*openPluginSurfaceTool/, 'open-plugin-surface target must route through surface presentation')
assert.match(outputRouter, /attachEditorPanel:[\s\S]*openEditorPanel\(\{[\s\S]*panelId:[\s\S]*placement:[\s\S]*inputs:/, 'attach-editor-panel target must send panel attach requests through editor bridge')
assert.doesNotMatch(outputRouter, /useWorkspaceStore|getState\(\)\.createPane|getState\(\)\.openPanelV2/, 'OutputRouter must not mutate editor workspace state from the caller window')
assert.match(outputRouter, /saveToShelf:[\s\S]*workflow-output-shelf/, 'save-to-shelf target must have a shelf route')
assert.match(defaultWorkflowProviders, /paste-to-foreground-app/, 'default text actions must expose paste-to-foreground-app')
assert.match(defaultWorkflowProviders, /replace-editor-selection/, 'default text actions must expose replace-editor-selection')
assert.match(panelProvider, /id:\s*PLUGIN_SURFACE_PANEL_ID/, 'plugin surface panel bridge must use the stable panel id')
assert.match(panelProvider, /registerProductionPlugin[\s\S]*\[panel\]/, 'plugin surface panel bridge must be registered')
assert.match(pluginPanel, /<PluginSurfaceRenderer[\s\S]*presentation=['"]editor-panel['"]/, 'attached plugin panel must reuse shared surface renderer')

console.log('output router text target checks passed')
