/** Binary-only image conversion. No URLs, text decoding, or executable formats. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024
export type RasterInfo = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }
const bad = (): never => { throw new Error('invalid') }
export function inspectRaster(bytes: Uint8Array, declaredMime?: string): RasterInfo {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('size')
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  let mime: RasterInfo['mime'], width = 0, height = 0
  if (bytes.length >= 33 && bytes[0] === 137 && ascii(1, 7) === 'PNG\r\n\x1a\n' && v.getUint32(8) === 13 && ascii(12, 4) === 'IHDR') {
    mime = 'image/png'; width = v.getUint32(16); height = v.getUint32(20)
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216) {
    mime = 'image/jpeg'
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) bad()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) bad()
      const size = v.getUint16(offset)
      if (size < 2 || offset + size > bytes.length) bad()
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (size < 8) bad()
        height = v.getUint16(offset + 3); width = v.getUint16(offset + 5); break
      }
      offset += size
    }
  } else if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && v.getUint32(4, true) + 8 === bytes.length) {
    mime = 'image/webp'
    const kind = ascii(12, 4)
    if (kind === 'VP8X') {
      if (bytes[20] & 2) throw new Error('animated')
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    } else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = v.getUint16(26, true) & 16383; height = v.getUint16(28, true) & 16383
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = v.getUint32(21, true)
      width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1
    } else bad()
  } else return bad()
  if (declaredMime && declaredMime.toLowerCase() !== mime) throw new Error('mime')
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_IMAGE_PIXELS) throw new Error('size')
  return { mime, width, height }
}
export function imageDataUri(bytes: Uint8Array, mime: RasterInfo['mime']): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return `data:${mime};base64,${btoa(binary)}`
}
export function parseImageBase64(text: string): { bytes: Uint8Array; info: RasterInfo } {
  if (text.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 256) throw new Error('size')
  const input = text.trim()
  let encoded = input, mime: string | undefined
  if (input.startsWith('data:')) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/i.exec(input)
    if (!match) return bad()
    mime = match[1]; encoded = match[2]
  }
  encoded = encoded.replace(/[\r\n\t ]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) return bad()
  const padding = encoded.indexOf('=')
  if (padding !== -1 && (padding < encoded.length - 2 || !/^={1,2}$/.test(encoded.slice(padding)))) return bad()
  const binary = atob(encoded)
  if (btoa(binary) !== encoded) return bad()
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return { bytes, info: inspectRaster(bytes, mime) }
}
export async function decodeRaster(bytes: Uint8Array, info: RasterInfo, signal: AbortSignal): Promise<{ png: Uint8Array; preview: string }> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: info.mime }))
  const image = new Image()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      const stop = () => { cleanup(); reject(new Error('cancelled')) }
      signal.addEventListener('abort', stop, { once: true })
      const cleanup = () => { signal.removeEventListener('abort', stop); clearTimeout(timeout) }
      image.onload = () => { cleanup(); resolve() }
      image.onerror = () => { cleanup(); reject(new Error('invalid')) }
      timeout = setTimeout(() => { cleanup(); reject(new Error('invalid')) }, 5000)
      if (signal.aborted) { cleanup(); stop(); return }
      image.src = url
    })
    if (signal.aborted) throw new Error('cancelled')
    // EXIF orientation may swap JPEG dimensions; keep the same bounded area.
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS || image.naturalWidth * image.naturalHeight !== info.width * info.height) throw new Error('size')
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    try {
      const context = canvas.getContext('2d'); if (!context) return bad()
      context.drawImage(image, 0, 0)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('invalid')), 'image/png'))
      if (signal.aborted) throw new Error('cancelled')
      if (blob.size > MAX_IMAGE_BYTES) throw new Error('size')
      const png = new Uint8Array(await blob.arrayBuffer())
      return { png, preview: imageDataUri(png, 'image/png') }
    } finally { canvas.width = 0; canvas.height = 0 }
  } finally { clearTimeout(timeout); image.src = ''; URL.revokeObjectURL(url) }
}
