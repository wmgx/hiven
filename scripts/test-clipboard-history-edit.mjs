#!/usr/bin/env node
// Production repository, synthetic in-memory storage; no user history or native clipboard.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const dir = 'src/plugins/clipboard-history/storage/'
const compiled = new Map()
function moduleUrl(name) {
  if (compiled.has(name)) return compiled.get(name)
  let source = ts.transpileModule(readFileSync(`${dir}${name}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText
  source = source.replace(/from ['"]\.\/(\w+)['"]/g, (_, dependency) => `from '${moduleUrl(dependency)}'`)
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  compiled.set(name, url)
  return url
}
const { createClipboardHistoryRepository } = await import(moduleUrl('clipboardHistoryRepository'))
const data = new Map()
let failIndexOnce = false
const storage = {
  kv: {
    get: async (key) => structuredClone(data.get(key)),
    set: async (key, value) => {
      if (key === 'history/index' && failIndexOnce) { failIndexOnce = false; throw new Error('disk') }
      data.set(key, structuredClone(value))
    },
    delete: async (key) => { data.delete(key) },
  },
  blob: { delete: async () => {} },
}
const repo = createClipboardHistoryRepository(storage)
const background = createClipboardHistoryRepository(storage)
const original = await repo.addItem({ kind: 'text', text: 'original\n全文', hash: 'initial', byteSize: 16 })
await repo.setFavorite(original.id, true, 'Kept title')
const revised = 'edited\n' + '全文😀'.repeat(200)
const edited = await repo.updateText(original.id, original.text, revised, 5000)
assert.equal(edited.text, revised)
assert.equal(edited.byteSize, new TextEncoder().encode(revised).byteLength)
assert.equal(edited.favoriteTitle, 'Kept title')
assert.equal(edited.isFavorite, true)
assert.equal(edited.firstCopiedAt, original.firstCopiedAt)
const entry = (await repo.getFreshListItems())[0]
assert.equal(entry.hash, edited.hash)
assert.equal(entry.preview, edited.preview)
assert.equal(entry.byteSize, edited.byteSize)
assert.equal((await repo.addItem({ kind: 'text', text: revised, hash: edited.hash, byteSize: edited.byteSize })).id, original.id)
await assert.rejects(repo.updateText(original.id, original.text, 'stale', 5000), /changed/)
await assert.rejects(repo.updateText(original.id, revised, '😀', 3), /tooLarge/)
await assert.rejects(repo.updateText(original.id, revised, 'late', 5000, () => false), /cancelled/)
assert.equal((await repo.getItem(original.id)).text, revised)
failIndexOnce = true
await assert.rejects(repo.updateText(original.id, revised, 'retry me', 5000), /disk/)
assert.equal((await repo.getItem(original.id)).text, revised, 'failed index save restores original item')
await repo.updateText(original.id, revised, '', 5000)
assert.equal((await repo.getItem(original.id)).text, '', 'empty edits preserve the exact text')
await Promise.all([repo.toggleFavorite(original.id), background.toggleFavorite(original.id)])
assert.equal((await repo.getItem(original.id)).isFavorite, true, 'quick repeated pin toggles serialize against fresh state')
const second = await repo.addItem({ kind: 'text', text: 'second', hash: 'second', byteSize: 6 })
await assert.rejects(repo.updateText(second.id, 'second', '', 5000), /duplicate/)
await repo.deleteItem(original.id)
await assert.rejects(repo.updateText(original.id, '', 'resurrect', 5000), /missing/)
assert.equal(await repo.getItem(original.id), undefined)
console.log('✓ History edits preserve full text/metadata, reject stale/deleted/oversized/duplicate saves, rollback failures and serialize pin toggles')
