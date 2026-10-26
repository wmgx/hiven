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
import { objectBlockText, objectBlockTextModule } from './helpers/object-block-text.mjs'

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

const detect = transpileAndRun('src/kits/content/detectContent.ts')
const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts', { detectContent: detect.detectContent })
// Real attach policy, not a hand-written approximation of it — see the same note
// in test-clipboard-direction-adjustment.mjs.
const attachPolicy = transpileAndRun('src/launcher/clipboard/attachPolicy.ts', {
  detectContent: detect.detectContent,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
})
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  objectBlockText,
  detectContent: detect.detectContent,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardType: snapshot.detectClipboardType,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})

const expectedSources = [
  'clipboard',
  'editor-selection',
  'editor-document',
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
assert.ok(snapshotBlock.subtitle.includes('快照'))

const history = objectBlock.createHistoryItemObjectBlock({
  text: 'hello',
  kind: 'text',
  ageLabel: '3 小时前',
  sizeLabel: '5 B',
})
assert.equal(history.source, 'history-item')
// Deliberately attached content can be removed to return to ordinary search.
assert.equal(history.removable, true)
assert.ok(history.subtitle.includes('3 小时前'))

const inputText = '  first line\r\nsecond line\n'
const query = objectBlock.createQueryObjectBlock({ query: inputText })
assert.equal(query.source, 'query')
assert.equal(query.removable, true)
assert.equal(query.payloadText, inputText, 'attaching input must preserve whitespace and line endings')
assert.equal(query.meta.lineCount, 3)
assert.equal(query.meta.charCount, inputText.length)

const secret = objectBlock.createGenericObjectBlock({
  source: 'clipboard',
  kind: 'secret-like',
  title: '剪贴板',
  text: 'sk-secret0123456789abcdef',
  masked: true,
  validity: 'unknown',
})
assert.equal(secret.secretMasked, true)
assert.equal(secret.preview, undefined)
assert.equal(secret.state, 'secret-masked')

console.log('object block expanded model checks passed')
