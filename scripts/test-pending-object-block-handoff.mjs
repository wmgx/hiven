#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  let src = readFileSync(path, 'utf8').replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const mod = {}
  const store = new Map()
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(k),
  }
  // pending uses localStorage
  const localStorage = sessionStorage
  vm.runInNewContext(out, {
    exports: mod, module: { exports: mod }, console, Date, JSON, localStorage, Map, Set,
  })
  return mod
}

const pending = load('src/launcher/clipboard/pendingObjectBlock.ts')
const block = { id: 'b1', source: 'history-item', kind: 'text', title: 'hist', createdAt: 1, removable: true, validity: 'unknown', payloadText: '在收' }

let notifies = 0
pending.subscribePendingObjectBlock(() => { notifies += 1 })

pending.setPendingObjectBlock(block, { persist: true })
assert.equal(notifies, 1, 'set notifies once')
pending.setPendingObjectBlock(block, { persist: true, silent: true })
assert.equal(notifies, 1, 'silent set does not notify')

const got = pending.consumePendingObjectBlock()
assert.equal(got?.payloadText, '在收')
assert.equal(pending.consumePendingObjectBlock(), null, 'consume is one-shot')

// re-stash after consume then reopen
pending.setPendingObjectBlock(block, { persist: true, silent: true })
assert.equal(pending.consumePendingObjectBlock()?.payloadText, '在收', 'silent re-stash survives')

// wiring
const hook = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
assert.match(hook, /history-item/, 'handoff sources include history-item')
assert.match(hook, /silent:\s*true/, 're-stash is silent')
assert.match(hook, /isHandoffBlock/, 'clipboard read must not clobber handoff')

const renderer = readFileSync('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'utf8')
assert.match(renderer, /persist:\s*true/, 'returnToLauncher always persists')

console.log('test-pending-object-block-handoff: ok')
