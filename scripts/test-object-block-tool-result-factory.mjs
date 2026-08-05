#!/usr/bin/env node
/**
 * test-object-block-tool-result-factory.mjs
 *
 * Regression test for createToolResultObjectBlock (src/launcher/clipboard/objectBlock.ts),
 * the factory that turns a launcher tool's text result (e.g. calculator "求和") into an
 * Object Block so it can be handed back to Global Launcher instead of vanishing into a
 * detached Quick Editor window. See doc/2026-07-20-launcher-text-result-secondary-actions-redesign.md.
 *
 * Loads the REAL production chain (objectBlock.ts -> clipboardSnapshot.ts -> detectContent.ts)
 * via ts.transpileModule + vm, same pattern as scripts/test-launcher-registry.mjs.
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

// --- src/kits/content/detectContent.ts (leaf, only type-only imports) ---
const detectContentModule = loadModule('src/kits/content/detectContent.ts', {
  stripImports: [...stripTypeImports],
})
assert.equal(typeof detectContentModule.detectContent, 'function', 'detectContent.ts must export detectContent')

// --- src/launcher/clipboard/clipboardSnapshot.ts (depends on kits/content/index -> detectContent) ---
const clipboardSnapshot = loadModule('src/launcher/clipboard/clipboardSnapshot.ts', {
  stripImports: [
    ...stripTypeImports,
    /import\s*\{\s*detectContent\s*\}\s*from\s*'\.\.\/\.\.\/kits\/content\/index'\s*;?\s*\n?/,
  ],
  globals: { detectContent: detectContentModule.detectContent },
})
assert.equal(typeof clipboardSnapshot.detectClipboardType, 'function', 'clipboardSnapshot.ts must export detectClipboardType')

// --- src/launcher/clipboard/objectBlock.ts (depends on clipboardSnapshot.ts) ---
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

// --- THE FUNCTION UNDER TEST (does not exist yet — this assertion is the red test) ---
assert.equal(
  typeof objectBlock.createToolResultObjectBlock,
  'function',
  'objectBlock.ts must export createToolResultObjectBlock (new factory for tool-result Object Blocks)',
)

const block = objectBlock.createToolResultObjectBlock('6')
assert.equal(block.source, 'tool-result', 'block.source must be the new tool-result source')
assert.equal(block.payloadText, '6', 'block.payloadText must be the raw result text (used for downstream actions)')
assert.equal(block.preview, '6', 'block.preview must show the result text in the token UI')
assert.equal(block.removable, true, 'user must be able to ⌫ remove the block')
assert.equal(block.kind, 'text', 'plain numeric text like "6" must be detected as kind "text"')

// A JSON-shaped result should be detected as such, same detection used for clipboard blocks.
const jsonBlock = objectBlock.createToolResultObjectBlock('{"a":1}')
assert.equal(jsonBlock.kind, 'json', 'JSON-shaped tool results must be detected as kind "json"')
assert.equal(jsonBlock.validity, 'valid', 'detected JSON must be marked valid, matching createClipboardObjectBlock behavior')

console.log('✓ test-object-block-tool-result-factory passed')
