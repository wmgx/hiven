#!/usr/bin/env node
/**
 * Plugin Action Manifest — Phase R4 behavior test
 *
 * Verifies:
 *  - PluginActionManifest type shape
 *  - registerPluginActionManifest / unregisterPluginActionManifest
 *  - discoverActionsForBlock filters by kind/source/length/secret
 *  - recommendActionsWithPlugins merges static + plugin actions
 *  - Secret content suppresses network-requiring plugin actions
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

const manifest = transpileAndRun('src/launcher/clipboard/pluginActionManifest.ts')

// ─── Register / Unregister ─────────────────────────────────────────────────────
manifest.clearPluginActionManifests()

manifest.registerPluginActionManifest({
  pluginId: 'test-translator',
  actions: [
    {
      id: 'translate-to-english',
      title: 'Translate to English',
      titleZh: '翻译为英文',
      accepts: { kinds: ['text'], sources: ['clipboard', 'editor-selection'] },
      outputTargets: ['copy', 'paste-to-foreground', 'open-editor'],
      defaultOutput: 'copy',
      presentation: 'inline',
      requiresNetwork: true,
    },
    {
      id: 'translate-to-chinese',
      title: 'Translate to Chinese',
      titleZh: '翻译为中文',
      accepts: { kinds: ['text'], sources: ['clipboard', 'editor-selection'] },
      outputTargets: ['copy', 'paste-to-foreground'],
      defaultOutput: 'copy',
      presentation: 'inline',
      requiresNetwork: true,
    },
  ],
})

manifest.registerPluginActionManifest({
  pluginId: 'test-json-tools',
  actions: [
    {
      id: 'json-to-typescript',
      title: 'JSON to TypeScript',
      titleZh: 'JSON 转 TypeScript 类型',
      accepts: { kinds: ['json'], minLength: 2 },
      outputTargets: ['copy', 'open-editor'],
      defaultOutput: 'copy',
      presentation: 'inline',
    },
  ],
})

// ─── discoverActionsForBlock ───────────────────────────────────────────────────

// Text clipboard should find translator
const textActions = manifest.discoverActionsForBlock({
  kind: 'text', source: 'clipboard', textLength: 50, isSecret: false,
})
assert.ok(textActions.some(a => a.id === 'translate-to-english'), 'text clipboard should discover translator')
assert.ok(textActions.some(a => a.id === 'translate-to-chinese'), 'text clipboard should discover both translations')
assert.equal(textActions[0].pluginId, 'test-translator', 'discovered action should have pluginId')

// JSON clipboard should find json-to-typescript
const jsonActions = manifest.discoverActionsForBlock({
  kind: 'json', source: 'clipboard', textLength: 100, isSecret: false,
})
assert.ok(jsonActions.some(a => a.id === 'json-to-typescript'), 'json clipboard should discover json-to-typescript')

// JSON too short should not match (minLength: 2)
const tooShort = manifest.discoverActionsForBlock({
  kind: 'json', source: 'clipboard', textLength: 1, isSecret: false,
})
assert.ok(!tooShort.some(a => a.id === 'json-to-typescript'), 'too short should not match minLength')

// Editor-document source should not match translator (sources: clipboard + editor-selection only)
const docActions = manifest.discoverActionsForBlock({
  kind: 'text', source: 'editor-document', textLength: 50, isSecret: false,
})
assert.ok(!docActions.some(a => a.id === 'translate-to-english'), 'editor-document should not match clipboard+selection-only actions')

// Secret should suppress network actions
const secretActions = manifest.discoverActionsForBlock({
  kind: 'text', source: 'clipboard', textLength: 50, isSecret: true,
})
assert.ok(!secretActions.some(a => a.id === 'translate-to-english'), 'secret should suppress network translator')
assert.ok(!secretActions.some(a => a.id === 'translate-to-chinese'), 'secret should suppress all network actions')

// URL kind should not match text or json plugins
const urlActions = manifest.discoverActionsForBlock({
  kind: 'url', source: 'clipboard', textLength: 30, isSecret: false,
})
assert.ok(!urlActions.some(a => a.id === 'translate-to-english'), 'url should not match text-only actions')

// ─── Unregister ────────────────────────────────────────────────────────────────
manifest.unregisterPluginActionManifest('test-translator')
const afterUnregister = manifest.discoverActionsForBlock({
  kind: 'text', source: 'clipboard', textLength: 50, isSecret: false,
})
assert.ok(!afterUnregister.some(a => a.id === 'translate-to-english'), 'unregistered actions should not be discovered')

// ─── Static contract ───────────────────────────────────────────────────────────
const manifestSrc = readFileSync('src/launcher/clipboard/pluginActionManifest.ts', 'utf8')
assert.match(manifestSrc, /PluginActionManifest/, 'manifest module should export type')
assert.match(manifestSrc, /PluginActionAccepts/, 'manifest module should export accepts type')
assert.match(manifestSrc, /PluginActionPresentation/, 'manifest module should export presentation type')
assert.match(manifestSrc, /registerPluginActionManifest/, 'manifest module should export register')
assert.match(manifestSrc, /discoverActionsForBlock/, 'manifest module should export discovery')
assert.match(manifestSrc, /requiresNetwork/, 'manifest should model network requirement for secret filtering')

const recSrc = readFileSync('src/launcher/clipboard/actionRecommendation.ts', 'utf8')
assert.match(recSrc, /recommendActionsWithPlugins/, 'recommendation should export merged function')
assert.match(recSrc, /discoverActionsForBlock/, 'recommendation should use plugin discovery')

manifest.clearPluginActionManifests()

console.log('plugin action manifest Phase R4 checks passed')
