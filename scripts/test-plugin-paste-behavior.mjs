#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const refactorSuite = readFileSync('scripts/test-refactor-suite.mjs', 'utf8')

assert.equal(
  packageJson.scripts?.['test:plugin-paste-behavior'],
  'node scripts/test-plugin-paste-behavior.mjs',
  'package.json must expose plugin paste behavior coverage',
)
assert.match(
  refactorSuite,
  /test:plugin-paste-behavior/,
  'refactor suite must include plugin paste behavior coverage',
)


function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

function loadPluginPaste({ invokeImpl, writeTextImpl, writeImageImpl, navigatorClipboard } = {}) {
  let src = readFileSync('src/workspace/pluginPaste.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  src = src.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"]\s*;?\s*\n?/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const calls = []
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    setTimeout: (fn, ms) => { calls.push(['delay', ms]); fn(); return 0 },
    Blob: class Blob {
      constructor(parts, options) {
        this.parts = parts
        this.type = options?.type ?? ''
      }
    },
    ClipboardItem: class ClipboardItem {
      constructor(items) { this.items = items }
    },
    navigator: { clipboard: navigatorClipboard ?? { writeText: async (text) => calls.push(['navigator.writeText', text]), write: async (items) => calls.push(['navigator.write', items.length]) } },
    requirePluginPermissions: (snapshot, required) => {
      calls.push(['require', required])
      if (snapshot?.deny) throw new Error(`denied:${required.join(',')}`)
    },
  }
  sandbox.globalThis = sandbox
  const loadMockModule = (specifier) => {
    if (specifier === '@tauri-apps/plugin-clipboard-manager') {
      return {
        writeText: writeTextImpl ?? (async (text) => calls.push(['tauri.writeText', text])),
        writeImage: writeImageImpl ?? (async (image) => calls.push(['tauri.writeImage', image])),
      }
    }
    if (specifier === '@tauri-apps/api/core') {
      return {
        invoke: invokeImpl ?? (async (command) => calls.push(['invoke', command])),
      }
    }
    if (specifier === '@tauri-apps/api/image') {
      return {
        Image: {
          fromBytes: async (bytes) => ({ kind: 'image', bytes: Array.from(bytes) }),
        },
      }
    }
    throw new Error(`unexpected dynamic import: ${specifier}`)
  }
  sandbox.require = loadMockModule
  sandbox.import = async (specifier) => loadMockModule(specifier)
  vm.runInNewContext(out, sandbox, { filename: 'pluginPaste.ts' })
  return { api: sandbox.module.exports, calls }
}

{
  const invoked = []
  const { api, calls } = loadPluginPaste({
    invokeImpl: async (command) => { invoked.push(command); calls.push(['invoke', command]) },
  })
  const paste = api.createPluginPaste()
  const result = await paste.pasteText('hello foreground')
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['tauri.writeText', 'hello foreground'],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteText must write clipboard then invoke the combined hide-and-paste command exactly once')
  assert.deepEqual(plain(invoked), ['hide_launcher_and_paste'])
  assert.ok(
    !calls.some((call) => call[0] === 'delay'),
    'pasteText must not rely on any JS-side delay; a hidden WKWebView throttles timers, so the hide+paste sequence must run entirely inside the Rust command',
  )
}

{
  const { api, calls } = loadPluginPaste({
    invokeImpl: async (command) => {
      calls.push(['invoke', command])
      if (command === 'hide_launcher_and_paste') throw new Error('Accessibility permission required')
    },
  })
  const result = await api.createPluginPaste().pasteText('needs permission')
  assert.deepEqual(plain(result), {
    ok: false,
    fallback: 'copied',
    message: 'Copied to clipboard. Grant Accessibility access in System Settings → Privacy & Security → Accessibility to enable auto-paste.',
  }, 'Accessibility permission failures must return the explicit copied fallback message')
  assert.deepEqual(plain(calls), [
    ['tauri.writeText', 'needs permission'],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'permission denial must surface from the single combined invoke, with no separate hide/simulate calls or JS delay')
}

{
  const { api, calls } = loadPluginPaste({
    writeTextImpl: async () => { throw new Error('tauri clipboard unavailable') },
    navigatorClipboard: { writeText: async (text) => calls.push(['navigator.writeText', text]) },
  })
  const result = await api.createPluginPaste({}).pasteFiles(['/tmp/a.txt', '/tmp/b.txt'])
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['require', ['clipboard.write', 'clipboard.files', 'accessibility.paste']],
    ['navigator.writeText', '/tmp/a.txt\n/tmp/b.txt'],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteFiles must copy newline-separated file paths and invoke the combined hide-and-paste command exactly once')
}

{
  const storage = { blob: { get: async (blobId) => blobId === 'image-1' ? new Uint8Array([1, 2, 3]) : undefined } }
  const { api, calls } = loadPluginPaste()
  const result = await api.createPluginPaste(undefined, storage).pasteImage('image-1')
  assert.deepEqual(plain(result), { ok: true })
  assert.deepEqual(plain(calls), [
    ['tauri.writeImage', { kind: 'image', bytes: [1, 2, 3] }],
    ['invoke', 'hide_launcher_and_paste'],
  ], 'pasteImage must write image bytes then invoke the combined hide-and-paste command exactly once')
}

{
  const { api } = loadPluginPaste()
  const result = await api.createPluginPaste(undefined, undefined).pasteImage('missing')
  assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: 'Image paste requires plugin blob storage' })
}

{
  const { api } = loadPluginPaste({ writeTextImpl: async () => { throw new Error('write failed') }, navigatorClipboard: { writeText: async () => { throw new Error('write failed') } } })
  const result = await api.createPluginPaste().pasteText('cannot copy')
  assert.deepEqual(plain(result), { ok: false, fallback: 'none', message: 'Failed to write to clipboard' })
}

console.log('plugin paste behavior checks passed')
