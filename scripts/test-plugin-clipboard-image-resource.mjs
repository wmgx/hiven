#!/usr/bin/env node
/**
 * Tauri Image handles (clipboard-manager readImage, @tauri-apps/api/image) live in the
 * webview ResourceTable until close(). Clipboard image polling runs every few seconds,
 * so any handle it opens and forgets pins a full RGBA buffer in the native process
 * (2026-09-15: 18.4G footprint after ~48h with an image left on the pasteboard).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync('src/workspace/pluginClipboard.ts', 'utf8')

function loadPluginClipboard({ readImageImpl, fromBytesImpl, writeImageImpl, writeTextImpl }) {
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const intervals = []
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    navigator: { clipboard: { writeText: writeTextImpl } },
    setInterval: (fn) => intervals.push(fn),
    clearInterval: () => undefined,
  }
  sandbox.globalThis = sandbox
  sandbox.require = (specifier) => {
    switch (specifier) {
      case '@tauri-apps/api/image':
        return { Image: { fromBytes: fromBytesImpl } }
      case '@tauri-apps/api/core':
        return { invoke: async () => null }
      case './pluginPermissions':
        return { requirePluginPermissions: () => undefined }
      case './nativeImageHandle':
        return loadHandleHelper()
      case './pluginClipboardImageRead':
        return { createPluginClipboardImageReader: () => undefined, createPluginClipboardReadGuard: () => undefined }
      case './nativeClipboard':
        return { isTauriClipboardRuntime: () => true, readNativeClipboardText: async () => '', readImage: readImageImpl, writeImage: writeImageImpl, writeText: writeTextImpl ?? (async () => undefined) }
      default:
        throw new Error(`unexpected require: ${specifier}`)
    }
  }
  vm.runInNewContext(out, sandbox, { filename: 'pluginClipboard.ts' })
  return { api: sandbox.module.exports, intervals }
}

function loadHandleHelper() {
  const out = ts.transpileModule(readFileSync('src/workspace/nativeImageHandle.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  vm.runInNewContext(out, { exports }, { filename: 'nativeImageHandle.ts' })
  return exports
}

function fakeImage(log, { failRgba } = {}) {
  return {
    rgba: async () => {
      if (failRgba) throw new Error('rgba failed')
      return new Uint8Array([1, 2, 3, 4])
    },
    size: async () => ({ width: 1, height: 1 }),
    close: async () => {
      log.push('close')
    },
  }
}

const unusedStorage = {
  blob: {
    put: async () => {
      throw new Error('unchanged image must not be stored')
    },
  },
}

{
  const log = []
  const { api, intervals } = loadPluginClipboard({
    readImageImpl: async () => {
      log.push('read')
      return fakeImage(log)
    },
  })
  const clipboard = api.createPluginClipboard('builtin.test', undefined, unusedStorage)
  const stop = await clipboard.watch({ images: true, text: false, imagePollIntervalMs: 0 }, () => undefined)
  assert.deepEqual(log, ['read', 'close'], 'watch init must close the clipboard image handle')

  await intervals[0]()
  await intervals[0]()
  assert.deepEqual(
    log,
    ['read', 'close', 'read', 'close', 'read', 'close'],
    'every poll of an unchanged pasteboard image must close its handle',
  )
  stop()
}

{
  const log = []
  const { api } = loadPluginClipboard({
    readImageImpl: async () => {
      log.push('read')
      return fakeImage(log, { failRgba: true })
    },
  })
  const clipboard = api.createPluginClipboard('builtin.test', undefined, unusedStorage)
  const stop = await clipboard.watch({ images: true, text: false }, () => undefined)
  assert.deepEqual(log, ['read', 'close'], 'a failed rgba/size read must still close the handle')
  stop()
}

{
  const log = []
  const { api } = loadPluginClipboard({
    readImageImpl: async () => {
      throw new Error('unused')
    },
    fromBytesImpl: async () => {
      log.push('fromBytes')
      return fakeImage(log)
    },
    writeImageImpl: async () => {
      log.push('write')
    },
  })
  await api.writeClipboardImageBytes(new Uint8Array([137, 80, 78, 71]))
  assert.deepEqual(log, ['fromBytes', 'write', 'close'], 'image write must close the handle it created')
}

{
  const { api } = loadPluginClipboard({ writeTextImpl: async () => { throw new Error('clipboard unavailable') } })
  await assert.rejects(api.writeClipboardText('failed output'), /clipboard unavailable/, 'failed copy must not be reported as successful completion')
}

console.log('plugin clipboard image resource contract passed')

// Cancel during image creation/write: release an acquired handle, and never
// fall through to another clipboard implementation after ownership is lost.
for (const stage of ['create-resolves', 'create-rejects', 'write-rejects']) {
  const log = []
  let resolve, reject
  const delayed = new Promise((done, fail) => { resolve = done; reject = fail })
  const controller = new AbortController()
  const { api } = loadPluginClipboard({
    fromBytesImpl: async () => stage === 'write-rejects' ? fakeImage(log) : delayed,
    writeImageImpl: async () => { log.push('write'); return delayed },
  })
  const result = api.writeClipboardImageBytes(new Uint8Array([1, 2]), controller.signal)
  for (let i = 0; i < 12; i++) await Promise.resolve()
  controller.abort()
  if (stage === 'create-resolves') resolve(fakeImage(log))
  else reject(new Error('late native failure'))
  await result
  assert.deepEqual(log, stage === 'create-resolves' ? ['close'] : stage === 'create-rejects' ? [] : ['write', 'close'])
}
console.log('Clipboard cancellation passed: delayed decode/write cannot start a fallback and acquired native handles close')
