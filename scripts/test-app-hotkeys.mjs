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
assert.equal(list.find((b) => b.appId.includes('Safari')).accelerator, 'Cmd+Option+S')
list = asArr(mod.removeAppHotkey(list, 'macos:bundle:com.apple.Safari'))
assert.equal(list.length, 1)

const rust = readFileSync('src-tauri/src/lib.rs', 'utf8')
assert.match(rust, /fn toggle_installed_app/)
assert.match(rust, /macos_hide_frontmost_app/)
assert.match(rust, /toggle_installed_app,/)

const hot = readFileSync('src/hotkeys/appHotkeys.ts', 'utf8')
assert.match(hot, /installAppHotkeys/)
assert.match(hot, /toggle_installed_app/)

const app = readFileSync('src/App.tsx', 'utf8')
assert.match(app, /installAppHotkeys/)

const settings = readFileSync('src/surfaces/SettingsContent.tsx', 'utf8')
assert.match(settings, /AppHotkeysSettings/)

const css = readFileSync('src/index.css', 'utf8')
// Dark launcher is solid SuperCmd charcoal (not translucent glass)
assert.match(css, /data-theme='dark'[\s\S]*#1c1c1e/)
assert.match(css, /data-theme='dark'[\s\S]*#3a3a3c/)
assert.match(css, /Never apply light translucent glass/)

console.log('✓ test-app-hotkeys passed')
