#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  refactorSuite: read('scripts/test-refactor-suite.mjs'),
  hostActions: read('src/workspace/launcher/hostActions.ts'),
  hostEditorActions: read('src/workspace/launcher/hostEditorActions.ts'),
  editorHost: read('src/launcher/hosts/EditorCommandBarHost.tsx'),
  outputRouter: read('src/workflow/outputRouter.ts'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:editor-command-bar-attach-surfaces'],
  'node scripts/test-editor-command-bar-attach-surfaces.mjs',
  'package.json must expose editor command bar attach-surface acceptance coverage',
)
assert.match(
  files.refactorSuite,
  /test:editor-command-bar-attach-surfaces/,
  'refactor suite must include editor command bar attach-surface coverage',
)
for (const [systemKey, title, pluginId] of [
  ['host:editor:attach-json-panel', 'Attach JSON Panel', 'json'],
]) {
  const start = files.hostEditorActions.indexOf(`systemKey: '${systemKey}'`)
  assert.notEqual(start, -1, `${title} must exist as an explicit editor-local command bar action`)
  const block = files.hostEditorActions.slice(start, files.hostEditorActions.indexOf('\n    {', start + 1))
  assert.match(block, new RegExp(`title:\\s*['"]${title}['"]`), `${title} must have a stable label`)
  assert.match(block, /surfaces:\s*\[['"]editor-command-bar['"]\]/, `${title} must be scoped to the editor command bar`)
  assert.match(block, new RegExp(`attachBuiltinPluginSurfacePanel\\(['"]${pluginId}['"]`), `${title} must attach ${pluginId}`)
}
for (const forbiddenKey of [
  'host:editor:attach-translate-panel',
  'host:editor:attach-clipboard-panel',
]) {
  assert.doesNotMatch(
    files.hostEditorActions,
    new RegExp(`systemKey:\\s*['"]${forbiddenKey}['"]`),
    `${forbiddenKey} must not be exposed in Editor Cmd+K`,
  )
}
assert.match(
  files.hostEditorActions,
  /PLUGIN_SURFACE_PANEL_ID/,
  'editor-local attach commands must use the shared plugin surface panel bridge',
)
assert.match(
  files.hostEditorActions,
  /openEditorPanel\(\{[\s\S]*panelId:\s*PLUGIN_SURFACE_PANEL_ID[\s\S]*placement:\s*['"]right['"][\s\S]*pluginId/,
  'attach commands must route through the explicit editor bridge instead of mutating workspace panels directly',
)
assert.doesNotMatch(
  files.hostEditorActions,
  /host:editor:attach-(?:translate|clipboard|json)-panel[\s\S]{0,500}useWorkspaceStore\.getState\(\)\.openPanelV2/,
  'editor-local attach commands must not bypass the editor bridge',
)
assert.match(
  read('src/workspace/launcher/types.ts'),
  /item\.systemKey\.startsWith\(['"]host:editor:['"]\)/,
  'Editor command bar filter must keep explicit editor-local surface actions',
)
assert.match(
  files.outputRouter,
  /attachEditorPanel:[\s\S]*showPluginSurfaceWindow\(\{/,
  'OutputRouter attach path must continue using the editor bridge',
)

console.log('editor command bar attach surface checks passed')
