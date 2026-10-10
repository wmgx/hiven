#!/usr/bin/env node
/** Real pure-module graph, fixed synthetic inputs, no clipboard/history/native I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowed = new Set([
  'src/kits/content/index.ts',
  'src/kits/content/detectContent.ts',
  'src/launcher/clipboard/clipboardSnapshot.ts',
  'src/launcher/clipboard/attachPolicy.ts',
  'src/launcher/clipboard/objectBlock.ts',
  'src/launcher/clipboard/fileTextMaterial.ts',
  'src/launcher/clipboard/currentMaterial.ts',
  'src/launcher/clipboard/currentTextDelivery.ts',
  'src/launcher/clipboard/actionExecutor.ts',
])
const cache = new Map()
function load(relative) {
  assert.ok(allowed.has(relative), `Unexpected dependency: ${relative}`)
  if (cache.has(relative)) return cache.get(relative)
  const filename = path.join(root, relative)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  cache.set(relative, module.exports)
  vm.runInNewContext(code, {
    exports: module.exports, module, Date, Buffer,
    require(specifier) {
      assert.ok(specifier.startsWith('.'), `External I/O dependency: ${specifier}`)
      return load(path.relative(root, path.resolve(path.dirname(filename), `${specifier}.ts`)))
    },
  }, { filename })
  return module.exports
}

const content = load('src/kits/content/index.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts')
const attach = load('src/launcher/clipboard/attachPolicy.ts')
const blocks = load('src/launcher/clipboard/objectBlock.ts')
const fileText = load('src/launcher/clipboard/fileTextMaterial.ts')
const delivery = load('src/launcher/clipboard/currentTextDelivery.ts')
const executor = load('src/launcher/clipboard/actionExecutor.ts')
const sensitiveText = '  password=synthetic-demo-not-a-secret\r\n'
const sensitiveJson = '  {"value":"password=synthetic-demo-not-a-secret"}\r\n'
const ordinaryJson = '  {"synthetic":true,"items":[1,2]}\r\n'

// Preserve the format classifier; sensitivity must survive a stronger format hit.
const detections = content.detectContent(sensitiveJson)
assert.equal(detections[0].kind, 'json')
assert.ok(detections.find((hit) => hit.kind === 'secret-like').confidence < detections[0].confidence)
assert.equal(snapshot.detectClipboardType(sensitiveJson), 'json')

function clipboard(text) {
  const now = Date.now()
  return blocks.createClipboardObjectBlock({
    text, hash: 'synthetic-hash', detectedType: snapshot.detectClipboardType(text),
    firstSeenAt: now, lastSeenAt: now, changedAt: now, ageConfidence: 'known',
  }, now)
}
const factories = [
  ['clipboard', clipboard],
  ['query', (text) => blocks.createQueryObjectBlock({ query: text })],
  ['explicit query kind', (text) => blocks.createQueryObjectBlock({ query: text, kind: 'json' })],
  ['tool result', (text) => blocks.createToolResultObjectBlock(text)],
  ['history item', (text) => blocks.createHistoryItemObjectBlock({ kind: 'text', text })],
  ['explicit history kind', (text) => blocks.createHistoryItemObjectBlock({ kind: 'text', text, detectedKind: 'json' })],
  ['editor selection', (text) => blocks.createEditorSelectionObjectBlock({ text, kind: 'json', lineCount: 2 })],
  ['editor document', (text) => blocks.createEditorDocumentObjectBlock({ text, kind: 'json', charCount: text.length })],
  ['editor pane', (text) => blocks.createEditorPaneObjectBlock({ text, kind: 'json', title: 'synthetic.json', paneId: 'synthetic-pane' })],
  ['snapshot', (text) => blocks.createSnapshotObjectBlock({ text, kind: 'json', title: 'synthetic.json', snapshotAt: 123 })],
  ['file contents', (text) => fileText.createFileTextMaterial('/synthetic/never-read.json', text)],
  ['generic explicit kind', (text) => blocks.createGenericObjectBlock({ source: 'query', kind: 'json', title: 'synthetic', text, masked: false })],
]
let cases = 0
for (const [name, create] of factories) {
  for (const text of [sensitiveText, sensitiveJson, ordinaryJson]) {
    const block = create(text)
    const sensitive = text !== ordinaryJson
    assert.ok(block, `${name}: material exists`)
    assert.equal(block.secretMasked, sensitive, `${name}: content signal controls masking`)
    assert.equal(block.preview, sensitive ? undefined : text, `${name}: preview boundary`)
    assert.equal(blocks.getObjectBlockRecommendationText(block), sensitive ? undefined : text, `${name}: recommendation body boundary`)
    assert.equal(block.payloadText, text, `${name}: exact payload survives masking`)
    assert.equal(delivery.getCurrentTextPayload(block), sensitive ? null : text, `${name}: existing delivery gate follows masking`)
    if (text !== sensitiveText) assert.equal(block.kind, 'json', `${name}: JSON format remains available`)
    cases++
  }
}
assert.equal(clipboard(sensitiveJson).state, 'fresh', 'masking preserves clipboard freshness state')
const snapshotBlock = factories.find(([name]) => name === 'snapshot')[1](sensitiveJson)
assert.equal(snapshotBlock.state, 'snapshot', 'masking preserves snapshot state')
assert.equal(snapshotBlock.meta.contentProvider, 'snapshot')

for (const text of [sensitiveText, sensitiveJson, 'https://example.test/?password=synthetic-demo-not-a-secret.json']) {
  const hits = attach.findStrongClipboardAttachHits(text)
  assert.ok(hits.length > 0)
  assert.ok(hits.every((hit) => hit.kind === 'secret' || hit.kind === 'secret-like'), 'sensitive attach signal precedes format and path spelling')
}
assert.equal(attach.findStrongClipboardAttachHits(ordinaryJson)[0].kind, 'json')

// Mainline path labels and attach confidence remain exactly as before.
for (const [text, kind] of [
  ['/synthetic/result.json', 'json'],
  ['result.json', 'json'],
  ['../synthetic/result.csv', 'csv'],
  ['file:///synthetic/result.csv', 'csv'],
  ['C:\\synthetic\\result.sql', 'sql'],
  ['https://example.test/input.json', 'json'],
]) {
  assert.equal(snapshot.detectClipboardType(text), kind)
  const hits = attach.findStrongClipboardAttachHits(text)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].kind, kind)
  assert.equal(hits[0].confidence, 0.95)
  const block = clipboard(text)
  assert.equal(block.kind, kind)
  assert.equal(block.secretMasked, false)
  assert.equal(blocks.getObjectBlockRecommendationText(block), text)
  assert.equal(block.payloadText, text)
}
for (const text of ['ordinary synthetic text', '42', '']) {
  assert.equal(attach.isStrongClipboardAttachEligible(text), false)
}

// Explicit local opening retains full payload; masking is not encryption or an execution ban.
const block = blocks.createToolResultObjectBlock(sensitiveJson)
const opened = []
for (const target of ['open-editor', 'open-plugin-surface']) {
  const result = await executor.executeRecommendedAction({
    block, action: { id: 'synthetic-open', titleZh: 'synthetic', pluginId: 'synthetic-local' }, target,
  }, {
    openInEditor: async (text) => opened.push(text),
    openPluginSurface: async (_id, options) => opened.push(options.initialText),
  })
  assert.equal(result.ok, true)
}
assert.deepEqual(opened, [sensitiveJson, sensitiveJson])
console.log(`Sensitive material mask passed: ${cases} constructor cases, recommendation isolation, exact payload/local opening, and mainline path behavior`)
