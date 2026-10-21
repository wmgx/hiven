#!/usr/bin/env node
/**
 * Output Target Expansion — Phase R3 behavior + UI contract test
 *
 * Verifies:
 *  - actionExecutor transforms text correctly (format JSON, minify)
 *  - getActionOutputTargets returns default + alternatives
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

const materialText = transpileAndRun('src/launcher/clipboard/currentMaterial.ts')
const currentTextSupport = transpileAndRun('src/launcher/clipboard/currentTextDelivery.ts', materialText)
const executor = transpileAndRun('src/launcher/clipboard/actionExecutor.ts', {
  ...currentTextSupport,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  atob: (value) => Buffer.from(value, 'base64').toString('binary'),
})

// ─── getActionOutputTargets ────────────────────────────────────────────────────
const jsonAction = {
  id: 'format-clipboard-json',
  title: 'Format Clipboard JSON',
  titleZh: '格式化剪贴板 JSON',
  pluginId: 'json-tools',
  defaultOutput: 'copy',
  alternativeOutputs: ['open-editor'],
}
const targets = executor.getActionOutputTargets(jsonAction)
assert.deepEqual(JSON.parse(JSON.stringify(targets)), ['copy', 'open-editor'], 'should return default + alternatives')

// ─── executeRecommendedAction: format JSON → copy ──────────────────────────────
let copiedText = ''
const handlers = {
  copyText: async (text) => { copiedText = text },
  openInEditor: async () => {},
  openPluginSurface: async () => {},
}
const block = { preview: '{"a":1,"b":2}', source: 'clipboard', kind: 'json' }
const result = await executor.executeRecommendedAction(
  { block, action: jsonAction, target: 'copy' },
  handlers,
)
assert.equal(result.ok, true)
assert.equal(copiedText, JSON.stringify({ a: 1, b: 2 }, null, 2), 'format JSON should pretty-print')

// ─── executeRecommendedAction: minify JSON ─────────────────────────────────────
const minifyAction = { id: 'minify-json', titleZh: '压缩 JSON', defaultOutput: 'copy' }
copiedText = ''
const result2 = await executor.executeRecommendedAction(
  { block: { preview: '{\n  "x": 1\n}' }, action: minifyAction, target: 'copy' },
  handlers,
)
assert.equal(result2.ok, true)
assert.equal(copiedText, '{"x":1}', 'minify should compact JSON')

// ─── executeRecommendedAction: encode/decode and timestamp transforms ───────────
copiedText = ''
await executor.executeRecommendedAction(
  { block: { preview: 'hello world' }, action: { id: 'base64-encode', titleZh: 'Base64 编码', defaultOutput: 'copy' }, target: 'copy' },
  handlers,
)
assert.equal(copiedText, 'aGVsbG8gd29ybGQ=', 'base64 encode should transform text')

copiedText = ''
await executor.executeRecommendedAction(
  { block: { preview: 'a%20b' }, action: { id: 'url-decode', titleZh: 'URL decode', defaultOutput: 'copy' }, target: 'copy' },
  handlers,
)
assert.equal(copiedText, 'a b', 'URL decode should transform text')

copiedText = ''
await executor.executeRecommendedAction(
  { block: { preview: '1700000000' }, action: { id: 'convert-timestamp', titleZh: '转换时间戳', defaultOutput: 'copy' }, target: 'copy' },
  handlers,
)
assert.match(copiedText, /^2023-11-/, 'timestamp conversion should produce datetime text')

// ─── executeRecommendedAction: open editor ─────────────────────────────────────
let editorText = ''
let editorTitle = ''
const handlers2 = {
  ...handlers,
  openInEditor: async (text, opts) => { editorText = text; editorTitle = opts?.title ?? '' },
}
const result3 = await executor.executeRecommendedAction(
  { block: { preview: 'hello world' }, action: { id: 'open-clipboard-editor', titleZh: '打开到编辑器', defaultOutput: 'open-editor' }, target: 'open-editor' },
  handlers2,
)
assert.equal(result3.ok, true)
assert.equal(editorText, 'hello world')
assert.equal(editorTitle, '打开到编辑器')

console.log('output target expansion Phase R3 checks passed')
