#!/usr/bin/env node
/** Real recommendation/executor contract; synthetic structured paths, no file or clipboard reads. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.window = {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { search: '' }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.sessionStorage = globalThis.window.sessionStorage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const forbidden = () => { throw new Error('Unexpected file, clipboard, or delivery access') }

try {
  const { recommendActionsForBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/actionRecommendation.ts')
  const { executeRecommendedAction } = await vite.ssrLoadModule('/src/launcher/clipboard/actionExecutor.ts')
  const paths = ['/synthetic/第一 个.txt', '/synthetic/第二个 #.png', '/synthetic/trailing space ']
  const block = { source: 'history-item', kind: 'files', payloadFiles: { paths, fileNames: ['第一 个.txt', '第二个 #.png', 'trailing space '] } }
  const action = recommendActionsForBlock(block).find((candidate) => candidate.id === 'convert-history-file-paths')
  assert.deepEqual(action, {
    id: 'convert-history-file-paths', title: 'Convert File Paths', titleZh: '转换文件路径',
    pluginId: 'file-paths', defaultOutput: 'open-plugin-surface',
  })
  const opened = []
  const result = await executeRecommendedAction({ block, action, target: action.defaultOutput }, {
    copyText: forbidden, openInEditor: forbidden, readLocalFileText: forbidden,
    openPluginSurface: async (pluginId, options) => opened.push({ pluginId, options }),
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(opened, [{ pluginId: 'file-paths', options: { initialText: paths.join('\n') } }])

  const ambiguous = { ...block, payloadFiles: { ...block.payloadFiles, paths: ['/synthetic/ok', '/synthetic/line\nbreak'] } }
  const rejected = await executeRecommendedAction({ block: ambiguous, action, target: action.defaultOutput }, {
    copyText: forbidden, openInEditor: forbidden, openPluginSurface: forbidden,
  })
  assert.deepEqual(rejected, { ok: false, error: 'FilePathLineBreakError' })
  console.log('File Object Block conversion action preserves the complete ordered list and rejects ambiguous newline paths.')
} finally {
  await vite.close()
}
