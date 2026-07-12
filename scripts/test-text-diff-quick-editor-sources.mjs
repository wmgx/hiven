#!/usr/bin/env node
/** Text Diff should surface quick-editor panes and appear in quick-editor launcher. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const textDiffSrc = readFileSync('src/plugins/textDiff/index.tsx', 'utf8')
const pluginApiSrc = readFileSync('src/workspace/launcher/pluginApi.ts', 'utf8')
const quickApiSrc = readFileSync('src/workspace/quickEditor/quickEditorActions.ts', 'utf8')
const snapshotHelperSrc = readFileSync('src/workspace/quickEditor/quickEditorPaneSnapshot.ts', 'utf8')
const typesSrc = readFileSync('src/workspace/launcher/types.ts', 'utf8')

assert.match(
  textDiffSrc,
  /surfaces:\s*\[[\s\S]*?['"]quick-editor-command['"][\s\S]*?\]/,
  'text-diff.compare must appear on quick-editor-command',
)
assert.match(textDiffSrc, /choice\.quickEditorPane/, 'text-diff must label quick-editor sources')
assert.match(textDiffSrc, /text:\s*pane\?\.text/, 'text-diff must capture pane text')

assert.match(typesSrc, /origin\?:\s*'editor'\s*\|\s*'quick-editor'/, 'getPaneSnapshot panes must expose origin')
assert.match(typesSrc, /text\?:\s*string/, 'getPaneSnapshot panes must expose text')

assert.match(pluginApiSrc, /readQuickEditorPaneSnapshot/, 'host getPaneSnapshot must merge quick-editor panes')
assert.match(pluginApiSrc, /origin:\s*'quick-editor'/, 'merged snapshot must mark quick-editor origin')
assert.match(pluginApiSrc, /origin:\s*'editor'/, 'merged snapshot must mark editor origin')

assert.match(quickApiSrc, /getPaneSnapshot/, 'quick-editor launcher API must provide getPaneSnapshot')
assert.match(snapshotHelperSrc, /hiven-quick-editor/, 'quick-editor snapshot helper must read persisted store')

console.log('text-diff quick-editor source checks passed')
