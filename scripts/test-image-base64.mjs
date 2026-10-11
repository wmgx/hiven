import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const code = ts.transpileModule(await readFile(new URL('../src/plugins/encode-decode/imageBase64.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { inspectRaster, imageDataUri, parseImageBase64, MAX_IMAGE_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64'))
assert.deepEqual(inspectRaster(png), { mime: 'image/png', width: 1, height: 1 })
const uri = imageDataUri(png, 'image/png')
assert.deepEqual(parseImageBase64(uri).bytes, png)
assert.deepEqual(parseImageBase64(uri.split(',')[1]).bytes, png)
assert.throws(() => parseImageBase64(uri.replace('image/png', 'image/jpeg')))
for (const invalid of ['https://example.com/test.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:text/html;base64,PGgxPng8L2gxPg==', 'a===', 'AB==', '%%%%', '<svg/>']) assert.throws(() => parseImageBase64(invalid))
const huge = png.slice(); new DataView(huge.buffer).setUint32(16, 8193)
assert.throws(() => inspectRaster(huge), /size/)
const bomb = png.slice(); new DataView(bomb.buffer).setUint32(16, 8192); new DataView(bomb.buffer).setUint32(20, 8192)
assert.throws(() => inspectRaster(bomb), /size/)
assert.throws(() => inspectRaster(new Uint8Array(MAX_IMAGE_BYTES + 1)), /size/)
assert.throws(() => parseImageBase64('a'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 257)), /size/)
// JPEG SOF header is checked before decoding; a later browser decode must still succeed.
const jpeg = Uint8Array.from([255,216,255,192,0,8,8,0,2,0,3,0,255,217])
assert.deepEqual(inspectRaster(jpeg), { mime: 'image/jpeg', width: 3, height: 2 })
assert.throws(() => inspectRaster(jpeg.slice(0, 10)))
const webp = new Uint8Array(30); const view = new DataView(webp.buffer)
for (const [offset, value] of [[0,'RIFF'],[8,'WEBP'],[12,'VP8X']]) for (let i=0; i<value.length;i++) webp[offset+i]=value.charCodeAt(i)
view.setUint32(4,22,true); view.setUint32(16,10,true); webp[24]=2; webp[27]=1
assert.deepEqual(inspectRaster(webp), { mime: 'image/webp', width: 3, height: 2 })
webp[20]=2; assert.throws(() => inspectRaster(webp), /animated/)
console.log('Image Base64 binary, MIME, bounds and rejection checks passed; browser/native decoding is a separate UI acceptance step.')
