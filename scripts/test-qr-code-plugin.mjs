#!/usr/bin/env node
/**
 * Contract + pure-logic checks for the first-party QR Code plugin.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)

const ROOT = process.cwd()
const PLUGIN_DIR = join(ROOT, 'src/plugins/qr-code')

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function loadTs(rel, extraRequires = {}, extraGlobals = {}) {
  const path = join(ROOT, rel)
  const source = readFileSync(path, 'utf8').replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  const context = vm.createContext({
    module,
    exports: module.exports,
    console,
    Buffer,
    atob,
    btoa,
    Uint8Array,
    Blob: globalThis.Blob,
    AbortController,
    DOMException,
    Error,
    URL,
    ...extraGlobals,
    require(specifier) {
      if (specifier in extraRequires) return extraRequires[specifier]
      return nodeRequire(specifier)
    },
  })
  vm.runInContext(transpiled, context, { filename: path })
  return module.exports
}

assert.ok(existsSync(join(PLUGIN_DIR, 'manifest.json')))
assert.ok(existsSync(join(PLUGIN_DIR, 'index.tsx')))
assert.ok(existsSync(join(PLUGIN_DIR, 'qrCore.ts')))
assert.ok(existsSync(join(PLUGIN_DIR, 'QrSurface.tsx')))
assert.ok(existsSync(join(PLUGIN_DIR, 'locales/en.json')))
assert.ok(existsSync(join(PLUGIN_DIR, 'locales/zh.json')))

const manifest = JSON.parse(read('src/plugins/qr-code/manifest.json'))
assert.equal(manifest.pluginId, 'qr-code')
assert.equal(manifest.displayNameI18n.zh, '二维码')
assert.equal(manifest.capabilities.includes('command'), false)
assert.ok(manifest.capabilities.includes('surface'))
assert.ok(manifest.permissions.includes('clipboard.image'))
assert.ok(manifest.permissions.includes('storage.blob'))

const en = JSON.parse(read('src/plugins/qr-code/locales/en.json'))
const zh = JSON.parse(read('src/plugins/qr-code/locales/zh.json'))
for (const key of Object.keys(en)) {
  assert.ok(key in zh, `zh locale missing ${key}`)
}
for (const key of Object.keys(zh)) {
  assert.ok(key in en, `en locale missing ${key}`)
}
for (const key of [
  'qr.generate.title',
  'qr.decode.title',
  'surface.title',
  'mode.generate',
  'mode.scan',
  'error.noQr',
]) {
  assert.ok(en[key], `en missing ${key}`)
  assert.ok(zh[key], `zh missing ${key}`)
}

const indexSrc = read('src/plugins/qr-code/index.tsx')
assert.match(indexSrc, /id:\s*['"]main['"]/)
assert.match(indexSrc, /id:\s*['"]scan['"]/)
assert.match(indexSrc, /生成二维码/)
assert.match(indexSrc, /识别二维码/)
assert.doesNotMatch(indexSrc, /tools:\s*\[/)
assert.doesNotMatch(indexSrc, /inputPolicy/)
assert.match(indexSrc, /from ['"]@hiven\/plugin['"]/)
assert.doesNotMatch(indexSrc, /from ['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(read('src/plugins/qr-code/QrSurface.tsx'), /from ['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(indexSrc, /from ['"]@tauri-apps\//)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /surfaceId === 'scan'/)

const core = loadTs('src/plugins/qr-code/qrCore.ts')
assert.equal(core.isImageDataUrl('data:image/png;base64,abcd'), true)
assert.equal(core.isImageDataUrl('hello'), false)
assert.equal(typeof core.dataUrlToPngBlob, 'function')
assert.equal(core.dataUrlToBase64('data:image/png;base64,abcd'), 'abcd')
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /copyPngBlobToClipboard/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /clipboard\.writeImage/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /action.copyImage/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /action.copyDataUrl/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /copyText\(dataUrl/)
assert.doesNotMatch(read('src/plugins/qr-code/QrSurface.tsx'), /copyText\(dataUrlToBase64/)
assert.match(read('src/plugins/qr-code/style.css'), /hiven-ui-button:hover/)
assert.match(read('src/plugins/qr-code/style.css'), /hiven-ui-button-primary:hover/)
assert.match(
  read('src/plugins/qr-code/style.css'),
  /:hover:not\(:disabled\):not\(\.hiven-ui-button-primary\)/,
)
assert.match(read('src/plugins/qr-code/style.css'), /-webkit-appearance:\s*none/)
assert.ok(en['action.copyDataUrl'])
assert.ok(zh['action.copyDataUrl'])
assert.equal(core.normalizeQrErrorCorrection('H'), 'H')
assert.equal(core.normalizeQrErrorCorrection('nope'), 'M')
assert.equal(core.normalizeQrSize(320), 320)
assert.equal(core.normalizeQrSize('nope'), 256)

const modules = core.createQrModules('https://example.com', 'M')
assert.ok(modules.size >= 21, `QR modules too small: ${modules.size}`)

const builtin = JSON.parse(read('src/builtin-plugins/index.json'))
const packed = builtin.packages.find((pkg) => pkg.pluginId === 'qr-code')
assert.ok(packed, 'builtin index should include qr-code')
assert.equal(packed.version, manifest.version)

// The exact generated PNG survives the private-blob save path and decodes back
// to the same payload. Cancellation/errors clean up only that temporary blob.
const { saveQrImage } = loadTs('src/plugins/qr-code/saveQrImage.ts', { './qrCore': core })
const payload = 'Hiven QA123'
const generated = await core.generateQrDataUrl(payload)
const { PNG } = nodeRequire('pngjs')
for (const outcome of ['saved', 'cancelled', 'error']) {
  const calls = []
  let bytes
  const storage = { blob: {
    async put(input) {
      calls.push('put')
      assert.equal(input.contentType, 'image/png')
      assert.equal(input.extension, 'png')
      bytes = input.bytes.slice()
      return { blobId: 'our-temporary-png' }
    },
    async savePng(blobId, options) {
      calls.push('save')
      assert.equal(blobId, 'our-temporary-png')
      assert.equal(options.suggestedFilename, 'qr-code.png')
      if (outcome === 'error') throw new Error('write failed')
      return { status: outcome }
    },
    async delete(blobId) {
      calls.push('delete')
      assert.equal(blobId, 'our-temporary-png')
    },
  } }
  if (outcome === 'error') await assert.rejects(saveQrImage(storage, generated), /write failed/)
  else assert.equal((await saveQrImage(storage, generated)).status, outcome)
  assert.deepEqual(calls, ['put', 'save', 'delete'])
  const decoded = PNG.sync.read(Buffer.from(bytes))
  assert.equal(core.decodeQrFromImageData(decoded), payload)
}

const surface = read('src/plugins/qr-code/QrSurface.tsx')
assert.doesNotMatch(surface, /document\.createElement\(['"]a['"]\)|link\.download|toast\.downloaded/)
assert.match(surface, /result\.status === 'saved'/)
assert.match(surface, /savingRef\.current/)
assert.equal(en['action.saveImage'], 'Save image…')
assert.equal(en['action.copyDataUrl'], 'Copy Data URL')
assert.match(en['scan.hint'], /\{shortcut\}/)
assert.match(zh['scan.hint'], /\{shortcut\}/)

const catalog = read('src/workspace/pluginProductCatalog.ts')
assert.match(catalog, /product\('qr-code', 'QR Code'[\s\S]*?二维码/)

console.log('qr-code plugin contract checks passed')

// Scan lifetime and paste routing are exercised as behavior, independently of
// React markup. The decoder below still runs jsQR against the generated PNG.
const { createQrScanSession } = loadTs('src/plugins/qr-code/qrScanSession.ts', { './qrCore': core })
const pngBytes = core.dataUrlToBytes(generated)
const nativeImage = { bytes: pngBytes, contentType: 'image/png', width: 256, height: 256 }
const pngBlob = new Blob([pngBytes], { type: 'image/png' })
const decodePng = async (blob) => {
  const png = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
  const text = core.decodeQrFromImageData(png)
  return text ? { ok: true, text } : { ok: false, code: 'no-qr' }
}
const realDecode = {
  blob: decodePng,
  dataUrl: (value) => decodePng(core.dataUrlToPngBlob(value)),
}
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function sessionHarness(decode = realDecode) {
  const states = []
  const liveUrls = new Set()
  const revoked = []
  let created = 0
  const session = createQrScanSession((state) => states.push(state), decode, {
    createObjectURL() {
      const url = `blob:scan-${++created}`
      liveUrls.add(url)
      return url
    },
    revokeObjectURL(url) {
      assert.ok(liveUrls.delete(url), `URL ${url} should be owned and revoked once`)
      revoked.push(url)
    },
  })
  return { session, states, liveUrls, revoked, latest: () => states.at(-1) }
}

{
  const h = sessionHarness()
  let nativeReads = 0
  const clipboard = {
    async readImage({ signal }) {
      assert.equal(signal.aborted, false)
      nativeReads++
      return nativeImage
    },
    async readText() { assert.fail('An image paste must not read text') },
  }
  await h.session.clipboard(() => clipboard)
  assert.equal(nativeReads, 1)
  assert.equal(h.latest().result.text, payload)
  assert.equal(h.latest().busy, false)
  assert.equal(h.liveUrls.size, 1)
  h.session.reset()
  assert.equal(h.liveUrls.size, 0, 'Leaving scan releases the preview')
  assert.equal(h.latest().previewUrl, '')
  h.session.dispose()
}

// A newer file wins over both a pending native read and a pending decode.
{
  const pending = deferred()
  let signal
  let decodes = 0
  const h = sessionHarness({ ...realDecode, blob: (blob) => { decodes++; return decodePng(blob) } })
  const native = h.session.clipboard(() => ({
    readImage(options) { signal = options.signal; return pending.promise },
    async readText() { assert.fail('Superseded work cannot read text') },
  }))
  await h.session.blob(pngBlob)
  const count = h.states.length
  pending.resolve(nativeImage)
  await native
  assert.equal(signal.aborted, true)
  assert.equal(decodes, 1)
  assert.equal(h.states.length, count)
  assert.equal(h.latest().result.text, payload)
  h.session.dispose()
  assert.equal(h.liveUrls.size, 0)
}
for (const olderSource of ['blob', 'dataUrl']) {
  const pending = deferred()
  let first = true
  const h = sessionHarness({
    blob: (blob) => {
      if (olderSource === 'blob' && first) { first = false; return pending.promise }
      return decodePng(blob)
    },
    dataUrl: () => pending.promise,
  })
  const older = olderSource === 'blob' ? h.session.blob(pngBlob) : h.session.dataUrl(generated)
  await Promise.resolve()
  assert.equal(h.latest().busy, true)
  await h.session.blob(pngBlob)
  const count = h.states.length
  pending.resolve({ ok: true, text: 'obsolete image' })
  await older
  assert.equal(h.states.length, count, `${olderSource} decode cannot overwrite the newer file`)
  assert.equal(h.latest().result.text, payload)
  assert.equal(h.revoked.length, olderSource === 'blob' ? 1 : 0, 'Data URLs are never revoked')
  h.session.dispose()
  assert.equal(h.liveUrls.size, 0)
}

// Failed reads are distinct from a successfully read image with no QR code;
// a subsequent file or Data URL paste recovers without reopening the surface.
{
  const h = sessionHarness()
  await h.session.blob(pngBlob)
  let textReads = 0
  let text = 'ordinary clipboard text'
  const clipboard = {
    async readImage() { throw new DOMException('Unavailable', 'NotReadableError') },
    async readText() { textReads++; return text },
  }
  await h.session.clipboard(() => clipboard)
  assert.equal(h.latest().clipboardError, true)
  assert.equal(h.latest().result, null)
  assert.equal(h.latest().busy, false)
  assert.equal(h.liveUrls.size, 0)
  await h.session.blob(pngBlob)
  assert.equal(h.latest().result.text, payload)
  assert.equal(h.latest().clipboardError, false)
  text = generated
  await h.session.clipboard(() => clipboard)
  assert.equal(textReads, 2)
  assert.equal(h.latest().result.text, payload)
  assert.equal(h.latest().previewUrl, generated)
  assert.equal(h.liveUrls.size, 0)
  h.session.dispose()
}
for (const name of ['NotAllowedError', 'AbortError', 'DataError', 'Error']) {
  const h = sessionHarness()
  await h.session.clipboard(() => ({
    async readImage() { throw new DOMException('Rejected', name) },
    async readText() { assert.fail(`${name} must not fall back to text`) },
  }))
  assert.equal(h.latest().clipboardError, true)
  assert.equal(h.latest().busy, false)
  h.session.dispose()
}
{
  const pending = deferred()
  const h = sessionHarness()
  let clipboard = {
    readImage() { return pending.promise },
    async readText() { assert.fail('A replaced host cannot finish an old gesture') },
  }
  const read = h.session.clipboard(() => clipboard)
  clipboard = {
    async readImage() { return nativeImage },
    async readText() { assert.fail('An old gesture cannot borrow a new host') },
  }
  pending.reject(new DOMException('Unavailable', 'NotReadableError'))
  await read
  assert.equal(h.latest().clipboardError, true)
  assert.equal(h.latest().busy, false)
  h.session.dispose()
}
for (const stage of ['native', 'text', 'decode']) {
  const pending = deferred()
  const entered = []
  let signal
  const h = sessionHarness(stage === 'decode' ? {
    ...realDecode,
    blob: () => { entered.push('decode'); return pending.promise },
  } : realDecode)
  const clipboard = {
    async readImage(options) {
      signal = options.signal
      if (stage === 'native') { entered.push('native'); return pending.promise }
      if (stage === 'text') throw new DOMException('Unavailable', 'NotReadableError')
      return nativeImage
    },
    async readText(options) {
      entered.push('text')
      assert.equal(options.signal, signal, 'The text fallback shares the native gesture cancellation')
      return pending.promise
    },
  }
  const read = h.session.clipboard(() => clipboard)
  // Let each deferred operation start, then dismiss the owner.
  for (let step = 0; step < 4; step++) await Promise.resolve()
  assert.deepEqual(entered, [stage], `The pending ${stage} operation must actually start`)
  h.session.dispose()
  const count = h.states.length
  pending.resolve(stage === 'native' ? nativeImage : stage === 'text' ? generated : { ok: true, text: payload })
  await read
  assert.equal(signal.aborted, true)
  assert.deepEqual(entered, [stage], 'Dismissed work cannot start a later operation')
  assert.equal(h.states.length, count, `Dismissal must ignore pending ${stage}`)
  assert.equal(h.liveUrls.size, 0)
}

class FakeElement {
  constructor(editable) { this.editable = editable }
  closest() { return this.editable ? this : null }
}
const { createQrPasteHandlers } = loadTs('src/plugins/qr-code/qrPaste.ts', { './qrCore': core }, { Element: FakeElement })
function pasteHarness(nativeAvailable = true) {
  const calls = []
  const handlers = createQrPasteHandlers({
    nativeAvailable: () => nativeAvailable,
    native: () => calls.push('native'),
    blob: () => calls.push('blob'),
    dataUrl: () => calls.push('dataUrl'),
    unreadable: () => calls.push('unreadable'),
  })
  return { handlers, calls }
}
function key(overrides = {}) {
  return {
    key: 'v', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false,
    repeat: false, isComposing: false, keyCode: 86, defaultPrevented: false,
    composedPath: () => [new FakeElement(false)],
    preventDefault() { this.defaultPrevented = true },
    ...overrides,
  }
}
function paste(text = '', image = true, overrides = {}) {
  return {
    defaultPrevented: false,
    composedPath: () => [new FakeElement(false)],
    preventDefault() { this.defaultPrevented = true },
    clipboardData: {
      items: image ? [{ type: 'image/png', getAsFile: () => pngBlob }] : [],
      getData: () => text,
    },
    ...overrides,
  }
}
{
  const { handlers, calls } = pasteHarness()
  const event = key()
  handlers.keydown(event)
  assert.equal(event.defaultPrevented, true)
  handlers.keydown(key({ repeat: true }))
  const duplicate = paste()
  handlers.paste(duplicate)
  assert.equal(duplicate.defaultPrevented, true)
  assert.deepEqual(calls, ['native'], 'One explicit native paste must not also decode the DOM event')
  handlers.keyup(key())
  handlers.paste(paste())
  assert.deepEqual(calls, ['native', 'blob'], 'A later DOM paste is independent')
}
for (const overrides of [
  { composedPath: () => [new FakeElement(true)] },
  { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
  { altKey: true }, { shiftKey: true }, { ctrlKey: false },
]) {
  const { handlers, calls } = pasteHarness()
  handlers.keydown(key(overrides))
  assert.deepEqual(calls, [], 'Editing, IME and other shortcuts must retain their own behavior')
}
{
  const { handlers, calls } = pasteHarness()
  handlers.compositionstart()
  handlers.keydown(key())
  handlers.paste(paste())
  handlers.compositionend()
  handlers.paste(paste('', true, { composedPath: () => [new FakeElement(true)] }))
  assert.deepEqual(calls, [])
  handlers.keydown(key({ ctrlKey: false, metaKey: true }))
  assert.deepEqual(calls, ['native'])
}
{
  const { handlers, calls } = pasteHarness(false)
  const event = key()
  handlers.keydown(event)
  assert.equal(event.defaultPrevented, false, 'Browser mode must keep the ordinary paste event')
  handlers.paste(paste())
  handlers.paste(paste(generated, false))
  handlers.paste(paste('ordinary text', false))
  assert.deepEqual(calls, ['blob', 'dataUrl', 'unreadable'])
}
assert.ok(en['error.clipboardRead'] && zh['error.clipboardRead'])
assert.match(en['scan.nativeHint'], /\{shortcut\}/)
assert.match(zh['scan.nativeHint'], /\{shortcut\}/)
console.log('qr-code scan lifetime and explicit paste checks passed')
