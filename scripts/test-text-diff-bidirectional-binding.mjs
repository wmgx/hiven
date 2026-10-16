#!/usr/bin/env node
/** Diff ↔ pane bidirectional binding contracts. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')

const indexSrc = read('src/plugins/textDiff/index.tsx')
const surfaceSrc = read('src/plugins/textDiff/TextDiffSurface.tsx')
const pageSrc = read('src/plugins/textDiff/TextDiffSurface.tsx')
const hookSrc = read('src/plugins/textDiff/useDiffSourceText.ts')
const diffHandoffSrc = read('src/historyDiffHandoff.ts')
const hostSdkSrc = read('src/pluginHostDiff.ts')
const diffTypesSrc = read('src/workspace/diffTypes.ts')
const quickStoreSrc = read('src/workspace/quickEditor/quickEditorStore.ts')
const quickReqSrc = read('src/workspace/quickEditor/quickEditorRequests.ts')
const quickPanelSrc = read('src/components/quickEditor/QuickEditorPanel.tsx')
const paneWriteSrc = read('src/workspace/quickEditor/quickEditorPaneWriteHandoff.ts')

assert.match(diffTypesSrc, /origin\?:\s*'editor'\s*\|\s*'quick-editor'/, 'DiffSource must carry origin')
assert.match(indexSrc, /resolvePaneBinding/, 'text-diff must resolve real pane ids for write-back')
assert.match(indexSrc, /origin:\s*binding\.origin/, 'text-diff sources must include origin')
assert.match(diffHandoffSrc, /paneId:\s*side\.paneId/, 'openDiffPage payload must preserve paneId')
assert.match(diffHandoffSrc, /origin:\s*side\.origin/, 'openDiffPage payload must preserve origin')
assert.match(hostSdkSrc, /useBoundSourceText/, 'host must expose bound source read')
assert.match(hostSdkSrc, /setBoundSourceText/, 'host must expose bound source write')
assert.match(hostSdkSrc, /setQuickEditorPaneText/, 'host write-back must reach quick-editor')
assert.match(quickStoreSrc, /setPaneText:\s*\(paneId,\s*text\)/, 'quick-editor store must support setPaneText')
assert.match(quickReqSrc, /requestQuickEditorPaneWrite/, 'cross-window set-pane-text owner handoff required')
assert.match(quickReqSrc, /persist\.rehydrate\(\)/, 'inline owner must rehydrate before writing')
assert.match(quickPanelSrc, /listenForQuickEditorPaneWrites/, 'active quick-editor panel must register the pane-write owner')
assert.match(paneWriteSrc, /payload\.owner !== owner/, 'pane writes must bind to one receiver generation')
assert.match(paneWriteSrc, /receipts/, 'pane writes must retain idempotent receipts')
assert.match(hookSrc, /setBoundSourceText/, 'shared hook must write back')
assert.match(hookSrc, /AbortController/, 'bound writes must cancel superseded pre-delivery requests')
assert.match(hookSrc, /isCurrent:/, 'bound writes must carry a renderer generation guard')
assert.match(surfaceSrc, /useDiffSourceText/, 'TextDiffSurface must bind via shared hook')
assert.match(pageSrc, /useDiffSourceText/, 'TextDiffSurface must bind via shared hook')
assert.doesNotMatch(pageSrc, /function useDiffSourceText/, 'TextDiffSurface must not keep local-only binding helper')

console.log('text-diff bidirectional binding checks passed')
