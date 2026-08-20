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

function loadTs(rel, extraRequires = {}) {
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
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /onContextMenu/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /action.copyImage/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /action.copyBase64/)
assert.match(read('src/plugins/qr-code/QrSurface.tsx'), /copyText\(dataUrl/)
assert.doesNotMatch(read('src/plugins/qr-code/QrSurface.tsx'), /copyText\(dataUrlToBase64/)
assert.match(read('src/plugins/qr-code/style.css'), /hiven-ui-button:hover/)
assert.match(read('src/plugins/qr-code/style.css'), /hiven-ui-button-primary:hover/)
assert.match(
  read('src/plugins/qr-code/style.css'),
  /:hover:not\(:disabled\):not\(\.hiven-ui-button-primary\)/,
)
assert.match(read('src/plugins/qr-code/style.css'), /-webkit-appearance:\s*none/)
assert.ok(en['action.copyBase64'])
assert.ok(zh['action.copyBase64'])
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

const catalog = read('src/workspace/pluginProductCatalog.ts')
assert.match(catalog, /product\('qr-code', 'QR Code'[\s\S]*?二维码/)

console.log('qr-code plugin contract checks passed')
