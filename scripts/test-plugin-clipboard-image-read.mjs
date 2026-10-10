#!/usr/bin/env node
// One-shot SDK image reads with synthetic native handles only; never touches the clipboard.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function fixture(options = {}) {
  const calls = []
  let generation = 0
  let lifetime = { active: true }
  let source = 'builtin'
  let requested = ['clipboard.read', 'clipboard.image']
  let granted = true
  let launcherOpen = true
  let launcherSession = 1
  const originalLauncherSession = launcherSession
  const originalGeneration = generation
  const snapshot = { 'clipboard.read': { granted: true }, 'clipboard.image': { granted: true } }
  const owner = {
    source: 'builtin',
    isCurrent: () => generation === originalGeneration && (!options.launcher ||
      (!options.missingLauncherOwner && launcherOpen && launcherSession === originalLauncherSession)),
  }
  const step = async (stage, value) => {
    calls.push(stage)
    await options.at?.(stage)
    if (options.fail === stage) throw new Error('private provider failure')
    return value
  }
  const canvas = {
    width: 0, height: 0,
    getContext: () => options.noContext ? null : { putImageData() { calls.push('putPixels') } },
    toBlob: (callback) => {
      void step('encode').then(() => callback(options.noBlob ? null : {
        size: options.pngSize ?? 4,
        type: options.mime ?? 'image/png',
        arrayBuffer: () => step('bytes', new Uint8Array([1, 2, 3, 4]).buffer),
      }), () => callback(null))
    },
  }
  const sandbox = {
    console, Uint8Array, Uint8ClampedArray, Error, AbortController,
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }) } },
    document: { createElement: () => canvas },
    navigator: { clipboard: { read: () => { throw new Error('Forbidden browser image read') }, readText: () => { throw new Error('Forbidden browser text read') } } },
    __TAURI_INTERNALS__: options.web ? undefined : {},
    __HIVEN_WEB_NATIVE_BRIDGE__: options.bridge ?? false,
  }
  sandbox.globalThis = sandbox
  sandbox.window = sandbox
  const dependencies = {
    './pluginPermissions': {
      requirePluginPermissions: (value, required) => {
        if (required.some((permission) => !value[permission]?.granted)) throw new Error('Denied')
      },
      getPluginPermissionSnapshot: () => Object.fromEntries(requested.map((permission) => [permission, { granted }])),
    },
    './pluginRegistry': { pluginRegistry: {
      getPluginLifetime: () => lifetime,
      getPluginPermissions: () => requested,
    } },
    './launcher/pluginSource': { resolvePluginSettingsSource: () => source },
    '@tauri-apps/api/core': { invoke: async (command) => {
      if (command === 'clipboard_read_image') return step('native', 7)
      if (command === 'clipboard_read_public_text') return step('text', 'data:image/png;base64,AA==')
      throw new Error(`Forbidden native command: ${command}`)
    } },
    '@tauri-apps/api/image': { Image: class {
      constructor(rid) { assert.equal(rid, 7) }
      size() { return step('size', options.size ?? { width: 1, height: 1 }) }
      rgba() { return step('rgba', options.rgba ?? new Uint8Array([1, 2, 3, 4])) }
      close() { return step('close') }
    } },
  }
  const context = vm.createContext(sandbox)
  const cache = new Map()
  function load(name) {
    if (name in dependencies) return dependencies[name]
    if (cache.has(name)) return cache.get(name)
    assert.ok(['./pluginClipboard', './pluginClipboardImageRead', './nativeClipboard', './nativeImageHandle'].includes(name), `Unexpected import: ${name}`)
    const exports = {}
    cache.set(name, exports)
    const source = readFileSync(`src/workspace/${name.slice(2)}.ts`, 'utf8')
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
    vm.runInContext(`(function(exports, require) { ${compiled}\n})`, context)(exports, load)
    return exports
  }
  const api = load('./pluginClipboard').createPluginClipboard('test', snapshot, {
    blob: { put() { throw new Error('Image reads must not persist') } },
  }, options.noOwner ? undefined : owner)
  return {
    api, calls, canvas,
    revoke() { granted = false; generation++ },
    grant() { granted = true; generation++ },
    denyOnly() { granted = false },
    removeDeclaration() { requested = ['clipboard.read'] },
    destroy() { generation++ },
    replacePlugin() { lifetime.active = false; lifetime = { active: true } },
    replaceSource() { source = 'installed' },
    closeLauncher() { launcherOpen = false },
    reopenLauncher() { launcherOpen = true; launcherSession++ },
    snapshot,
  }
}

const rejectsName = (promise, name) => assert.rejects(promise, (error) => error.name === name && !error.message.includes('private provider'))

for (const options of [{ noOwner: true }, { web: true }, { bridge: true }]) {
  const f = fixture(options)
  assert.equal(f.api.readImage, undefined)
  assert.deepEqual(f.calls, [])
}
for (const transition of ['close', 'reopen', 'missing-owner']) {
  const f = fixture({ launcher: true, missingLauncherOwner: transition === 'missing-owner' })
  if (transition !== 'missing-owner') f.closeLauncher()
  if (transition === 'reopen') f.reopenLauncher()
  await rejectsName(f.api.readImage(), 'AbortError')
  await rejectsName(f.api.readText(), 'AbortError')
  assert.deepEqual(f.calls, [])
}
for (const stage of ['native', 'text']) {
  let f
  f = fixture({ launcher: true, at: (current) => { if (current === stage) { f.closeLauncher(); f.reopenLauncher() } } })
  await rejectsName(stage === 'native' ? f.api.readImage() : f.api.readText(), 'AbortError')
  assert.equal(f.calls.filter((call) => call === 'close').length, stage === 'native' ? 1 : 0)
}

{
  const f = fixture()
  const result = await f.api.readImage()
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3, 4])
  assert.equal(result.contentType, 'image/png')
  assert.equal(result.width, 1)
  assert.equal(result.height, 1)
  assert.deepEqual(f.calls, ['native', 'size', 'rgba', 'close', 'putPixels', 'encode', 'bytes'])
  assert.equal(f.canvas.width, 0)
  assert.equal(f.canvas.height, 0)
}

for (const change of ['denyOnly', 'removeDeclaration', 'destroy', 'replacePlugin', 'replaceSource']) {
  const f = fixture()
  f[change]()
  await rejectsName(f.api.readImage(), ['denyOnly', 'removeDeclaration'].includes(change) ? 'NotAllowedError' : 'AbortError')
  assert.deepEqual(f.calls, [])
}
{
  const f = fixture()
  f.snapshot['clipboard.image'].granted = false
  await rejectsName(f.api.readImage(), 'NotAllowedError')
  assert.deepEqual(f.calls, [])
}

// Revocation and regrant must never revive the old host, including during an
// image failure followed by the same gesture's text/Data URL fallback.
for (const stage of ['native', 'size', 'rgba', 'close', 'encode', 'bytes']) {
  let f
  f = fixture({ at: (current) => { if (current === stage) { f.revoke(); f.grant() } } })
  await rejectsName(f.api.readImage(), 'AbortError')
  assert.equal(f.calls.filter((call) => call === 'close').length, 1, `${stage} must release the acquired native image`)
  await rejectsName(f.api.readText(), 'AbortError')
  assert.ok(!f.calls.includes('text'))
}

for (const stage of ['native', 'size', 'rgba', 'close', 'encode', 'bytes']) {
  const controller = new AbortController()
  const f = fixture({ at: (current) => { if (current === stage) controller.abort() } })
  await rejectsName(f.api.readImage({ signal: controller.signal }), 'AbortError')
  assert.equal(f.calls.filter((call) => call === 'close').length, 1)
}
{
  const controller = new AbortController()
  controller.abort()
  const f = fixture()
  await rejectsName(f.api.readImage({ signal: controller.signal }), 'AbortError')
  assert.deepEqual(f.calls, [])
}

for (const size of [{ width: 0, height: 1 }, { width: 1.5, height: 1 }, { width: 8193, height: 1 }, { width: 8192, height: 8192 }]) {
  const f = fixture({ size })
  await rejectsName(f.api.readImage(), 'DataError')
  assert.deepEqual(f.calls, ['native', 'size', 'close'])
}
for (const options of [{ rgba: new Uint8Array(3) }, { pngSize: 10 * 1024 * 1024 + 1 }, { pngSize: 0 }, { mime: 'text/plain' }, { pngSize: 3 }]) {
  const f = fixture(options)
  await rejectsName(f.api.readImage(), 'DataError')
  assert.equal(f.calls.filter((call) => call === 'close').length, 1)
}
for (const fail of ['native', 'size', 'rgba', 'encode', 'bytes']) {
  const f = fixture({ fail })
  await rejectsName(f.api.readImage(), 'NotReadableError')
  assert.equal(f.calls.filter((call) => call === 'close').length, fail === 'native' ? 0 : 1)
}
{
  let f
  f = fixture({ fail: 'native', at: (stage) => { if (stage === 'native') { f.revoke(); f.grant() } } })
  await rejectsName(f.api.readImage(), 'AbortError')
  await rejectsName(f.api.readText(), 'AbortError')
  assert.deepEqual(f.calls, ['native'])
}
{
  let f
  f = fixture({ at: (stage) => { if (stage === 'size') f.denyOnly() } })
  await rejectsName(f.api.readImage(), 'NotAllowedError')
  assert.deepEqual(f.calls, ['native', 'size', 'close'])
}
for (const options of [{ noContext: true }, { noBlob: true }]) {
  const f = fixture(options)
  await rejectsName(f.api.readImage(), 'NotReadableError')
  assert.equal(f.calls.filter((call) => call === 'close').length, 1)
  assert.equal(f.canvas.width, 0)
}

// Permission checks run again after dynamic imports, before native dispatch.
for (const method of ['readImage', 'readText']) {
  const f = fixture()
  const pending = f.api[method]()
  f.revoke()
  f.grant()
  await rejectsName(pending, 'AbortError')
  assert.deepEqual(f.calls, [])
}
{
  let f
  f = fixture({ at: (stage) => { if (stage === 'text') f.destroy() } })
  await rejectsName(f.api.readText(), 'AbortError')
}
for (const stage of ['before', 'import', 'text']) {
  const controller = new AbortController()
  const f = fixture({ at: (current) => { if (current === stage) controller.abort() } })
  if (stage === 'before') controller.abort()
  const pending = f.api.readText({ signal: controller.signal })
  if (stage === 'import') controller.abort()
  await rejectsName(pending, 'AbortError')
  assert.deepEqual(f.calls, stage === 'text' ? ['text'] : [])
}
{
  const f = fixture({ fail: 'native' })
  await rejectsName(f.api.readImage(), 'NotReadableError')
  assert.equal(await f.api.readText(), 'data:image/png;base64,AA==')
}

console.log('One-shot image read: native boundary, current grants/owner, bounded pixels, errors, release, and guarded Data URL fallback passed')
