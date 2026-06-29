#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pluginRuntime = readFileSync('src/workspace/pluginRuntime.ts', 'utf8')
const editorBridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
const editorWindow = readFileSync('src/components/EditorWindow.tsx', 'utf8')
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-runtime-editor-cleanup-boundary'],
  'node scripts/test-plugin-runtime-editor-cleanup-boundary.mjs',
  'package.json must expose plugin runtime/editor cleanup boundary coverage',
)
assert.match(
  refactorSuite,
  /test:plugin-runtime-editor-cleanup-boundary/,
  'refactor suite must include plugin runtime/editor cleanup boundary coverage',
)

assert.match(
  editorBridge,
  /cleanupEditorPluginContributions/,
  'EditorBridge must expose an explicit cleanup action for plugin editor contributions',
)
assert.match(
  editorWindow,
  /cleanupEditorPluginContributions:\s*\(input\)\s*=>\s*applyCleanupEditorPluginContributions\(input\)/,
  'EditorWindow must handle plugin cleanup bridge requests inside the editor runtime',
)
assert.match(
  editorWindow,
  /function applyCleanupEditorPluginContributions[\s\S]*clearPaneRenderersForPlugin\(input\.pluginId\)[\s\S]*closePanelV2\(panelId\)/,
  'EditorWindow cleanup handler must clear pane renderers and panels in the real editor workspace',
)

assert.match(
  pluginRuntime,
  /cleanupEditorPluginContributions\(\{ pluginId, panelIds \}\)/,
  'plugin runtime must route non-editor cleanup through EditorBridge',
)
assert.match(
  pluginRuntime,
  /if \(isEditorWindowRuntime\(\)\)[\s\S]*cleanupLocalEditorPluginContributions\(pluginId, panelIds\)/,
  'plugin runtime may only clean workspace state directly when running in the editor window',
)
for (const fn of ['disablePlugin', 'reloadDevPlugin', 'removeDevPlugin']) {
  assert.match(
    pluginRuntime,
    new RegExp(`export (?:async )?function ${fn}\\(pluginId: string\\)[\\s\\S]*cleanupPluginEditorContributions\\(pluginId, panelIds\\)`),
    `${fn} must use the cross-window editor cleanup helper`,
  )
}

const directWorkspaceCleanupMatches = [...pluginRuntime.matchAll(/useWorkspaceStore\.getState\(\)[\s\S]{0,240}closePanelV2\(panelId\)/g)]
assert.equal(
  directWorkspaceCleanupMatches.length,
  1,
  'plugin runtime must keep direct editor workspace cleanup isolated to the editor-only local cleanup helper',
)
assert.match(
  directWorkspaceCleanupMatches[0]?.[0] ?? '',
  /clearPaneRenderersForPlugin\(pluginId\)[\s\S]*closePanelV2\(panelId\)/,
  'the only direct workspace cleanup block must clear the plugin contributions locally',
)

console.log('plugin runtime editor cleanup boundary checks passed')
