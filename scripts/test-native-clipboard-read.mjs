#!/usr/bin/env node
/**
 * Desktop clipboard reads must never call the web Clipboard API in Tauri.
 *
 * WKWebView shows a floating English "Paste" chip when JS calls
 * navigator.clipboard.readText() / .read() without a user gesture.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const nativeSrc = readFileSync('src/workspace/nativeClipboard.ts', 'utf8')

function loadNativeClipboard({ tauri, readTextImpl, navigatorReadText, invokeImpl } = {}) {
  const out = ts.transpileModule(nativeSrc, {
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
    navigator: {
      clipboard: {
        readText: navigatorReadText ?? (async () => {
          calls.push(['navigator.readText'])
          return 'from-web'
        }),
      },
    },
  }
  if (tauri) sandbox.__TAURI_INTERNALS__ = {}
  sandbox.globalThis = sandbox
  sandbox.require = (specifier) => {
    if (specifier === '@tauri-apps/api/image') {
      return { Image: class { constructor(rid) { this.rid = rid } } }
    }
    if (specifier === '@tauri-apps/api/core') {
      return {
        invoke: async (command, args) => {
          if (invokeImpl) return invokeImpl(command, args)
          assert.equal(command, 'clipboard_read_public_text')
          if (readTextImpl) return readTextImpl()
          calls.push(['tauri.readText'])
          return 'from-native'
        },
      }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }
  vm.runInNewContext(out, sandbox, { filename: 'nativeClipboard.ts' })
  return { api: sandbox.module.exports, calls }
}

{
  const { api, calls } = loadNativeClipboard({ tauri: true })
  const text = await api.readNativeClipboardText()
  assert.equal(text, 'from-native')
  assert.deepEqual(calls, [['tauri.readText']], 'Tauri must use the privacy-aware native reader')
}

{
  const { api, calls } = loadNativeClipboard({
    tauri: true,
    readTextImpl: async () => {
      calls.push(['tauri.readText.throw'])
      throw new Error('empty pasteboard')
    },
  })
  const text = await api.readNativeClipboardText()
  assert.equal(text, '', 'native throw must become empty string')
  assert.deepEqual(calls, [['tauri.readText.throw']], 'native throw must not fall back to navigator.clipboard.readText')
}

{
  const { api, calls } = loadNativeClipboard({ tauri: false })
  const text = await api.readNativeClipboardText()
  assert.equal(text, 'from-web')
  assert.deepEqual(calls, [['navigator.readText']], 'web runtime may use navigator.clipboard')
}

{
  const calls = []
  const { api } = loadNativeClipboard({ tauri: true, invokeImpl: async (command, args) => {
    calls.push([command, args])
    return 42
  } })
  await api.writeText('sample')
  const image = await api.readImage()
  assert.equal(image.rid, 42, 'native image resource must remain usable by the Tauri Image API')
  await api.writeImage(image)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['clipboard_write_text', { text: 'sample' }],
    ['clipboard_read_image', null],
    ['clipboard_write_image', { image: 42 }],
  ], 'clipboard operations must use the host commands that serialize macOS access')
}

console.log('native clipboard read contract passed')
