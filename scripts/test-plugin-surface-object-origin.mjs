#!/usr/bin/env node
/** Real SDK-to-object conversion and classifiers; no renderer, server or external I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, module: { exports }, Date,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name} in ${path}`)
      return modules[name]
    },
  }, { filename: path })
  return exports
}
const content = load('src/kits/content/detectContent.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts', { '../../kits/content/index': content })
const attachPolicy = load('src/launcher/clipboard/attachPolicy.ts', {
  '../../kits/content/index': content, './clipboardSnapshot': snapshot,
})
const blocks = load('src/launcher/clipboard/objectBlock.ts', {
  './clipboardSnapshot': snapshot, './attachPolicy': attachPolicy,
})
const { createPluginSurfaceObjectBlock: convert } = load('src/components/pluginSurface/pluginSurfaceObjectBlock.ts', {
  '../../launcher/clipboard/objectBlock': blocks,
})
let passed = 0
function check(name, body) {
  try { body(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const source of [undefined, 'history-item']) {
  check(`text origin ${source ?? 'omitted'} retains history compatibility`, () => {
    const text = '  {"synthetic":true}\r\n\r\n'
    const block = convert({ kind: 'text', text, source, ageLabel: '2 minutes ago' })
    assert.equal(block.source, 'history-item')
    assert.equal(block.title, blocks.getSourceLabel('history-item'))
    assert.equal(block.payloadText, text)
    assert.equal(block.kind, 'json')
    assert.equal(block.validity, 'unknown')
    assert.equal(block.meta.age, '2 minutes ago')
  })
}

for (const [text, kind] of [
  ['  {"synthetic":true}\r\n\r\n', 'json'],
  ['https://example.com/result', 'url'],
  ['ordinary output', 'text'],
  ['', 'unknown'],
  ['  \r\n\r\n', 'unknown'],
  ['Authorization: synthetic-hidden-secret', 'secret-like'],
]) {
  check(`tool output is reclassified from exact ${kind} text`, () => {
    const block = convert({ kind: 'text', text, source: 'tool-result', ageLabel: 'not an output age' })
    assert.equal(block.source, 'tool-result')
    assert.equal(block.title, blocks.getSourceLabel('tool-result'))
    assert.equal(block.kind, kind)
    assert.equal(block.payloadText, text)
    assert.equal(block.validity, kind === 'json' ? 'valid' : 'unknown')
    assert.equal(block.ageLabel, undefined)
    assert.equal(block.meta, undefined)
    assert.equal(block.secretMasked, kind === 'secret-like')
    assert.equal(block.preview, kind === 'secret-like' ? undefined : text)
    assert.equal(blocks.getObjectBlockRecommendationText(block), kind === 'secret-like' ? undefined : text)
  })
}

check('history still masks secrets and ignores undeclared classification fields', () => {
  const text = 'Authorization: synthetic-hidden-secret'
  const block = convert({ kind: 'text', text, detectedKind: 'text', sizeLabel: 'ignored' })
  assert.equal(block.source, 'history-item')
  assert.equal(block.kind, 'secret-like')
  assert.equal(block.secretMasked, true)
  assert.equal(block.preview, undefined)
  assert.equal(block.meta.size, undefined)
})

for (const source of [undefined, 'tool-result']) {
  check(`image snapshot stays history even with undeclared origin ${source ?? 'omitted'}`, () => {
    const block = convert({ kind: 'image', blobId: 'synthetic-image', contentType: 'image/png', width: 2, height: 3, ageLabel: 'recent', source })
    assert.equal(block.source, 'history-item')
    assert.equal(block.kind, 'image')
    assert.equal(block.payloadImage.blobId, 'synthetic-image')
    assert.equal(block.payloadImage.contentType, 'image/png')
    assert.equal(block.payloadImage.width, 2)
    assert.equal(block.payloadImage.height, 3)
    assert.equal(block.ageLabel, 'recent')
    assert.equal(block.payloadText, undefined)
  })
  check(`file snapshot stays history even with undeclared origin ${source ?? 'omitted'}`, () => {
    const paths = ['/synthetic/never-opened.txt'], fileNames = ['never-opened.txt']
    const block = convert({ kind: 'files', paths, fileNames, ageLabel: 'recent', source })
    assert.equal(block.source, 'history-item')
    assert.equal(block.kind, 'files')
    assert.equal(block.payloadFiles.paths, paths)
    assert.equal(block.payloadFiles.fileNames, fileNames)
    assert.equal(block.ageLabel, 'recent')
    assert.equal(block.payloadText, undefined)
  })
}

console.log(`Plugin surface object origin passed: ${passed} construction cases`)
