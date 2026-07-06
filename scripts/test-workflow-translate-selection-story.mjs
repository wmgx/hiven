#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  store: read('src/store.ts'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  pluginSurfaceRenderer: read('src/components/pluginSurface/PluginSurfaceRenderer.tsx'),
  pluginSurfacePanel: read('src/components/pluginSurface/PluginSurfacePanel.tsx'),
  defaultWorkflowProviders: read('src/workflow/defaultWorkflowProviders.ts'),
  translateSurface: read('src/plugins/translate/surfaces/TranslateSurface.tsx'),
}

const packageJson = JSON.parse(files.packageJson)
assert.equal(
  packageJson.scripts?.['test:workflow-translate-selection-story'],
  'node scripts/test-workflow-translate-selection-story.mjs',
  'package.json must expose test:workflow-translate-selection-story',
)
assert.match(
  files.store,
  /PluginSurfaceOpenTarget[\s\S]*initialText\?:\s*string/,
  'plugin surface open targets must be able to carry initial text from workflow objects',
)
assert.match(
  files.pluginTypes,
  /PluginSurfaceProps[\s\S]*initialText\?:\s*string/,
  'plugin surface props must expose initialText to surface components',
)
assert.match(
  files.pluginSurfaceRenderer,
  /initialText=\{target\.initialText\}/,
  'shared plugin surface renderer must pass target.initialText to all surface presentations',
)
assert.match(
  files.pluginSurfacePanel,
  /initialText:\s*inputs\?\.text/,
  'editor attached plugin surface panel must preserve initial text when normalizing panel inputs',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.translate-in-surface['"],\s*['"]Translate in Surface['"]/,
  'text workflow actions must expose Translate in Surface for selected/current text',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.translate-in-surface['"][\s\S]*routeTextOutput\(text,[\s\S]*kind:\s*['"]open-plugin-surface['"][\s\S]*pluginId:\s*['"]translate['"][\s\S]*surfaceId:\s*['"]main['"]/,
  'Translate in Surface must route selected text through the output router to the translate surface',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.attach-translate-panel['"][\s\S]*pluginSurfaceTarget:\s*\{[\s\S]*pluginId:\s*['"]translate['"][\s\S]*surfaceId:\s*['"]main['"][\s\S]*initialText:\s*text/,
  'text workflow actions must support attaching Translate to the editor panel with initial text',
)
assert.match(
  files.defaultWorkflowProviders,
  /textAction\(['"]workflow\.open-editor-with-translate-panel['"],[\s\S]*createQuickEditorPane\(\{[\s\S]*text,[\s\S]*showPluginSurfaceWindow\(\{[\s\S]*pluginId:\s*['"]translate['"][\s\S]*initialText:\s*text/,
  'selected/current text must support opening Editor and attaching Translate panel in one workflow action',
)
assert.match(
  files.translateSurface,
  /const\s+initialText\s*=\s*props\.initialText\?\.trim\(\)/,
  'TranslateSurface must read initial text from plugin surface props',
)
assert.match(
  files.translateSurface,
  /useState\(initialText\s*\?\?\s*['"]['"]\)/,
  'TranslateSurface must seed its input textarea from initialText',
)

console.log('workflow translate selection story checks passed')
