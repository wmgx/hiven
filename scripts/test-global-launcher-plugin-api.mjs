#!/usr/bin/env node
/**
 * test-global-launcher-plugin-api.mjs
 *
 * Regression test for createGlobalLauncherPluginApi (src/launcher/clipboard/globalLauncherApi.ts):
 * verifies that calling the wrapped api's returnToLauncher(text) delivers a tool-result
 * Object Block through the REAL pending-object-block bridge (src/launcher/clipboard/pendingObjectBlock.ts),
 * the same bridge clipboard-history's "return to launcher" flow already uses.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, { stripImports = [], globals = {} } = {}) {
  let src = readFileSync(path, 'utf8')
  for (const re of stripImports) src = src.replace(re, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const stripTypeImports = [/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g]

// --- Real chain: detectContent -> clipboardSnapshot -> objectBlock ---
const detectContentModule = loadModule('src/kits/content/detectContent.ts', {
  stripImports: [...stripTypeImports],
})
const clipboardSnapshot = loadModule('src/launcher/clipboard/clipboardSnapshot.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{\s*detectContent\s*\}\s*from\s*'\.\.\/\.\.\/kits\/content\/index'\s*;?\s*\n?/,
  ],
  globals: { detectContent: detectContentModule.detectContent },
})
const objectBlock = loadModule('src/launcher/clipboard/objectBlock.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{[^}]*\}\s*from\s*'\.\/clipboardSnapshot'\s*;?\s*\n?/,
  ],
  globals: {
    detectClipboardFilePath: clipboardSnapshot.detectClipboardFilePath,
    detectClipboardType: clipboardSnapshot.detectClipboardType,
    fileNameFromPath: clipboardSnapshot.fileNameFromPath,
    shouldAutoAttachClipboard: clipboardSnapshot.shouldAutoAttachClipboard,
    shouldShowRecentClipboardHint: clipboardSnapshot.shouldShowRecentClipboardHint,
  },
})
assert.equal(typeof objectBlock.createToolResultObjectBlock, 'function', 'Task 2 must land first: createToolResultObjectBlock missing')

// --- Real pendingObjectBlock.ts (in-memory localStorage stub; module never requires persistence in this flow) ---
const memoryStorage = new Map()
const fakeLocalStorage = {
  getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
  setItem: (key, value) => { memoryStorage.set(key, value) },
  removeItem: (key) => { memoryStorage.delete(key) },
}
const pendingObjectBlock = loadModule('src/launcher/clipboard/pendingObjectBlock.ts', {
  stripImports: [...stripTypeImports],
  globals: { localStorage: fakeLocalStorage },
})
assert.equal(typeof pendingObjectBlock.consumePendingObjectBlock, 'function', 'pendingObjectBlock.ts must export consumePendingObjectBlock')

// --- THE MODULE UNDER TEST (does not exist yet — this require throws, which is the red test) ---
let globalLauncherApi
try {
  globalLauncherApi = loadModule('src/launcher/clipboard/globalLauncherApi.ts', {
    stripImports: [
      ...stripTypeImports,
      /import\s*\{[^}]*\}\s*from\s*'\.\/objectBlock'\s*;?\s*\n?/,
      /import\s*\{[^}]*\}\s*from\s*'\.\/pendingObjectBlock'\s*;?\s*\n?/,
    ],
    globals: {
      createToolResultObjectBlock: objectBlock.createToolResultObjectBlock,
      setPendingObjectBlock: pendingObjectBlock.setPendingObjectBlock,
    },
  })
} catch (error) {
  console.error('Expected failure (red test): src/launcher/clipboard/globalLauncherApi.ts does not exist yet')
  throw error
}

assert.equal(typeof globalLauncherApi.createGlobalLauncherPluginApi, 'function', 'globalLauncherApi.ts must export createGlobalLauncherPluginApi')

// --- Fake base PluginLauncherApi (minimal shape; only fields the wrapper touches or spreads through) ---
const baseApi = {
  getActiveText: () => '',
  getSelectionText: () => '',
  copyText: async () => {},
  insertText: async () => { throw new Error('base insertText must not be called by returnToLauncher') },
  replaceActiveText: async () => { throw new Error('base replaceActiveText must not be called by returnToLauncher') },
  showMessage: () => {},
}

const wrapped = globalLauncherApi.createGlobalLauncherPluginApi(baseApi)
assert.equal(typeof wrapped.copyText, 'function', 'wrapped api must still expose base methods (spread-through)')
assert.equal(typeof wrapped.returnToLauncher, 'function', 'wrapped api must override returnToLauncher')

// Sanity: nothing pending before we call it.
assert.equal(pendingObjectBlock.consumePendingObjectBlock(), null, 'no pending block should exist before returnToLauncher runs')

await wrapped.returnToLauncher('6')

const delivered = pendingObjectBlock.consumePendingObjectBlock()
assert.ok(delivered, 'returnToLauncher must deliver a block through setPendingObjectBlock')
assert.equal(delivered.source, 'tool-result', 'delivered block must be source "tool-result"')
assert.equal(delivered.payloadText, '6', 'delivered block must carry the exact result text')

// Consuming again must return null (one-shot consume, per pendingObjectBlock.ts's own contract).
assert.equal(pendingObjectBlock.consumePendingObjectBlock(), null, 'pending block must be consumed exactly once')

console.log('✓ test-global-launcher-plugin-api passed')
