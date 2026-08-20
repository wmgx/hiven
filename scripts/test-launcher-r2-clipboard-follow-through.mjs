#!/usr/bin/env node
/**
 * R2 clipboard follow-through contracts:
 *  - return-to-launcher bridge
 *  - history text paste/copy recommendations
 *  - frequent/favorite storage
 *  - paste-to-front via hide_launcher_and_paste
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const memoryStorage = (() => {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
})()

function loadTs(path, stubs = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Boolean,
    Error,
    localStorage: memoryStorage,
    ...stubs,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const snapshot = loadTs('src/launcher/clipboard/clipboardSnapshot.ts')
const objectBlock = loadTs('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  detectClipboardType: snapshot.detectClipboardType,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const recommendation = loadTs('src/launcher/clipboard/actionRecommendation.ts', {
  discoverActionsForBlock: () => [],
})
const executor = loadTs('src/launcher/clipboard/actionExecutor.ts', {
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
})
const pending = loadTs('src/launcher/clipboard/pendingObjectBlock.ts')

// Pending bridge: set → consume once
const block = objectBlock.createHistoryItemObjectBlock({
  kind: 'text',
  text: '{"a":1}',
  ageLabel: '10s',
})
assert.equal(block.source, 'history-item')
assert.ok(block.payloadText === '{"a":1}')
pending.setPendingObjectBlock(block)
const consumed = pending.consumePendingObjectBlock()
assert.equal(consumed?.payloadText, '{"a":1}')
assert.equal(pending.consumePendingObjectBlock(), null, 'pending is consume-once')

// History text recommendations: paste first, then copy
const textActions = recommendation.recommendActionsForBlock(block)
assert.ok(textActions.length >= 1)
assert.equal(textActions[0].id, 'paste-history-text', 'primary history text action is paste to front')
assert.ok(textActions.some((a) => a.id === 'copy-history-text'))

// Image / files still special-cased
const imageBlock = objectBlock.createHistoryItemObjectBlock({
  kind: 'image',
  blobId: 'blob-1',
  contentType: 'image/png',
})
const imageActions = recommendation.recommendActionsForBlock(imageBlock)
assert.equal(imageActions[0].id, 'paste-history-image')

// Executor paste-history-text
let pasted = ''
const pasteResult = await executor.executeRecommendedAction(
  {
    block,
    action: textActions[0],
    target: 'copy',
  },
  {
    copyText: async () => {},
    openInEditor: async () => {},
    openPluginSurface: async () => {},
    pasteText: async (text) => {
      pasted = text
    },
  },
)
assert.equal(pasteResult.ok, true)
assert.equal(pasted, '{"a":1}')

// Host paste path uses native hide_launcher_and_paste
const pasteSrc = readFileSync('src/workspace/pluginPaste.ts', 'utf8')
assert.match(pasteSrc, /hide_launcher_and_paste/, 'paste must restore previous foreground via native command')

// Surface + host wiring (source-level)
const surface = readFileSync('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'utf8')
assert.match(surface, /returnToLauncherWithObject/)
assert.match(surface, /recordPaste/)
assert.match(surface, /frequent/)
assert.match(surface, /favorite/)

const host = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
// The host used to branch on `source !== 'history-item'`; it now branches positively
// in two places — history keeps its own paste/copy/open action set, and it carries a
// distinct row label so the user can tell a history pick from a live clipboard grab.
assert.match(host, /if \(block\.source === 'history-item'\)/, 'history blocks must keep their own action set')
assert.match(host, /block\.source === 'history-item'[\s\S]{0,80}zh: '历史'/, 'history blocks must be labeled distinctly from the live clipboard')
assert.match(host, /paste-history-text|pasteText/)

const renderer = readFileSync('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'utf8')
assert.match(renderer, /createHistoryItemObjectBlock/)
assert.match(renderer, /setPendingObjectBlock/)

console.log('✓ test-launcher-r2-clipboard-follow-through passed')
