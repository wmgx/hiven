#!/usr/bin/env node
/**
 * Object Block expanded model contract — Step 5 §2.
 *
 * Verifies Object Block can represent all sources/types required by the design
 * language instead of only clipboard + editor selection/document.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function transpileAndRun(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, Date, JSON, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts')
const detect = transpileAndRun('src/kits/content/detectContent.ts')
// Real attach policy, not a hand-written approximation of it — see the same note
// in test-clipboard-direction-adjustment.mjs.
const attachPolicy = transpileAndRun('src/launcher/clipboard/attachPolicy.ts', {
  detectContent: detect.detectContent,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
})
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isStrongClipboardAttachEligible: attachPolicy.isStrongClipboardAttachEligible,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardType: snapshot.detectClipboardType,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})

const expectedSources = [
  'clipboard',
  'editor-selection',
  'editor-pane',
  'editor-document',
  'multi-pane',
  'history-item',
  'query',
  'snapshot',
]
for (const source of expectedSources) {
  assert.equal(typeof objectBlock.getSourceLabel(source), 'string', `source ${source} should have a visible label`)
}

const expectedKinds = ['json', 'text', 'sql', 'css', 'xml', 'csv', 'jwt', 'timestamp', 'url', 'secret-like', 'unknown']
for (const kind of expectedKinds) {
  assert.equal(typeof objectBlock.getKindLabel(kind), 'string', `kind ${kind} should have a visible label`)
}

const pane = objectBlock.createEditorPaneObjectBlock({
  text: 'select * from users',
  kind: 'sql',
  title: 'query.sql',
  paneId: 'pane-1',
  lineCount: 1,
})
assert.equal(pane.source, 'editor-pane')
assert.equal(pane.kind, 'sql')
assert.equal(pane.validity, 'unknown')
assert.equal(pane.removable, true)
assert.ok(pane.subtitle.includes('query.sql'))
assert.equal(pane.meta?.lineCount, 1)

const multi = objectBlock.createMultiPaneObjectBlock({
  left: { paneId: 'old', title: 'old.json', kind: 'json' },
  right: { paneId: 'new', title: 'new.json', kind: 'json' },
})
assert.equal(multi.source, 'multi-pane')
assert.equal(multi.kind, 'json')
assert.equal(multi.state, 'multi-object')
assert.match(multi.subtitle, /JSON \+ JSON/)

const snapshotBlock = objectBlock.createSnapshotObjectBlock({
  editorWindowId: 'editor-2',
  paneId: 'pane-2',
  title: 'config.new.json',
  text: '{"x":1}',
  kind: 'json',
  snapshotAt: 123456,
})
assert.equal(snapshotBlock.source, 'snapshot')
assert.equal(snapshotBlock.state, 'snapshot')
assert.equal(snapshotBlock.meta?.contentProvider, 'snapshot')
assert.ok(snapshotBlock.subtitle.includes('snapshot'))

const history = objectBlock.createHistoryItemObjectBlock({
  text: 'hello',
  kind: 'text',
  ageLabel: '3 小时前',
  sizeLabel: '5 B',
})
assert.equal(history.source, 'history-item')
// A history pick is a deliberate user choice, so ⌫ must be able to undo it and
// return to typing. Only the query block is non-removable — removing that one
// would mean removing the query itself.
assert.equal(history.removable, true)
assert.ok(history.subtitle.includes('3 小时前'))

const query = objectBlock.createQueryObjectBlock({ query: '1,280 * 0.15', kind: 'timestamp' })
assert.equal(query.source, 'query')
assert.equal(query.removable, false)
assert.equal(query.preview, '1,280 * 0.15')

const secret = objectBlock.createGenericObjectBlock({
  source: 'clipboard',
  kind: 'secret-like',
  title: '剪贴板',
  text: 'sk-secret',
  masked: true,
  validity: 'unknown',
})
assert.equal(secret.secretMasked, true)
assert.equal(secret.preview, undefined)
assert.equal(secret.state, 'secret-masked')

const typeSrc = readFileSync('src/launcher/clipboard/objectBlock.ts', 'utf8')
assert.match(typeSrc, /validity:/, 'ObjectBlock should expose validity')
assert.match(typeSrc, /state\?:/, 'ObjectBlock should expose state')
assert.match(typeSrc, /meta\?:/, 'ObjectBlock should expose meta fields')
assert.match(typeSrc, /createSnapshotObjectBlock/, 'snapshot source factory required for cross-editor diff')
assert.match(typeSrc, /createMultiPaneObjectBlock/, 'multi-pane source factory required for diff')

console.log('object block expanded model checks passed')
