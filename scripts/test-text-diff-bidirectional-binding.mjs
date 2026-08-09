#!/usr/bin/env node
/** Diff ↔ pane bidirectional binding contracts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

const indexSrc = read('src/plugins/textDiff/index.tsx')
const surfaceSrc = read('src/plugins/textDiff/TextDiffSurface.tsx')
const pageSrc = read('src/plugins/textDiff/TextDiffSurface.tsx')
const hookSrc = read('src/plugins/textDiff/useDiffSourceText.ts')
const pluginApiSrc = read('src/workspace/launcher/pluginApi.ts')
const hostSdkSrc = read('src/pluginHostSdk.ts')
const storeSrc = read('src/workspace/workspaceStore.ts')
const quickStoreSrc = read('src/workspace/quickEditor/quickEditorStore.ts')
const quickReqSrc = read('src/workspace/quickEditor/quickEditorRequests.ts')
const quickViewSrc = read('src/views/QuickEditorDetachedView.tsx')

assert.match(storeSrc, /origin\?:\s*'editor'\s*\|\s*'quick-editor'/, 'DiffSource must carry origin')
assert.match(indexSrc, /resolvePaneBinding/, 'text-diff must resolve real pane ids for write-back')
assert.match(indexSrc, /origin:\s*binding\.origin/, 'text-diff sources must include origin')
assert.match(pluginApiSrc, /paneId:\s*side\?\.paneId/, 'openDiffPage payload must preserve paneId')
assert.match(pluginApiSrc, /origin:\s*side\?\.origin/, 'openDiffPage payload must preserve origin')
assert.match(hostSdkSrc, /useBoundSourceText/, 'host must expose bound source read')
assert.match(hostSdkSrc, /setBoundSourceText/, 'host must expose bound source write')
assert.match(hostSdkSrc, /setQuickEditorPaneText/, 'host write-back must reach quick-editor')
assert.match(quickStoreSrc, /setPaneText:\s*\(paneId,\s*text\)/, 'quick-editor store must support setPaneText')
assert.match(quickReqSrc, /QUICK_EDITOR_SET_PANE_TEXT_EVENT/, 'cross-window set-pane-text event required')
assert.match(quickViewSrc, /QUICK_EDITOR_SET_PANE_TEXT_EVENT/, 'quick editor window must listen for set-pane-text')
assert.match(hookSrc, /setBoundSourceText/, 'shared hook must write back')
assert.match(surfaceSrc, /useDiffSourceText/, 'TextDiffSurface must bind via shared hook')
assert.match(pageSrc, /useDiffSourceText/, 'TextDiffSurface must bind via shared hook')
assert.doesNotMatch(pageSrc, /function useDiffSourceText/, 'TextDiffSurface must not keep local-only binding helper')

console.log('text-diff bidirectional binding checks passed')
