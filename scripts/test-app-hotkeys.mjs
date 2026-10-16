#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const moduleExports = {}
  vm.runInNewContext(out, {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    Array,
    Object,
    String,
    Set,
    Map,
  })
  return moduleExports
}

const mod = load('src/workspace/appHotkeys.ts')
const asArr = (v) => Array.from(v ?? [])

assert.deepEqual(asArr(mod.emptyAppHotkeys()), [])
let list = asArr(
  mod.upsertAppHotkey([], {
    appId: 'macos:bundle:com.apple.Safari',
    name: 'Safari',
    accelerator: 'Cmd+Shift+S',
  }),
)
assert.equal(list.length, 1)
list = asArr(
  mod.upsertAppHotkey(list, {
    appId: 'macos:bundle:com.apple.Notes',
    name: 'Notes',
    accelerator: 'Cmd+Shift+N',
  }),
)
assert.equal(list.length, 2)
// Same app replaces
list = asArr(
  mod.upsertAppHotkey(list, {
    appId: 'macos:bundle:com.apple.Safari',
    name: 'Safari',
    accelerator: 'Cmd+Option+S',
  }),
)
assert.equal(list.length, 2)
assert.equal(list.find((b) => b.appId.includes('Safari')).accelerator, 'Cmd+Alt+S')
const transferred = asArr(mod.upsertAppHotkey(list, {
  appId: 'macos:bundle:com.apple.Notes', name: 'Notes', accelerator: 'Command + Option + S',
}))
assert.equal(transferred.length, 1, 'native accelerator aliases must transfer the same binding')
assert.equal(transferred[0].appId, 'macos:bundle:com.apple.Notes')
list = asArr(mod.removeAppHotkey(list, 'macos:bundle:com.apple.Safari'))
assert.equal(list.length, 1)

console.log('✓ test-app-hotkeys passed')
