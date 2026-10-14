import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './imageBase64'

export function resizeDimensions(value: string, sourceWidth: number, sourceHeight: number) {
  if (!/^[1-9]\d*$/.test(value) || ![sourceWidth, sourceHeight].every(Number.isSafeInteger)
    || sourceWidth < 1 || sourceHeight < 1 || sourceWidth > 8192 || sourceHeight > 8192
    || sourceWidth * sourceHeight > MAX_IMAGE_PIXELS) return null
  const width = Number(value)
  if (!Number.isSafeInteger(width) || width > sourceWidth) return null
  const exactHeight = sourceHeight * width / sourceWidth
  if (exactHeight < 1) return null
  const height = Math.round(exactHeight)
  return { width, height }
}

/** Resample the complete original into one fresh output buffer, never a prior result. */
export async function exportResizedImage(original: HTMLCanvasElement, width: string, signal: AbortSignal) {
  if (signal.aborted) throw new Error('cancelled')
  const size = resizeDimensions(width, original.width, original.height)
  if (!size) throw new Error('invalid')
  const canvas = document.createElement('canvas')
  try {
    canvas.width = size.width; canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('invalid')
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'
    context.drawImage(original, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('invalid')), 'image/png'))
    if (signal.aborted) throw new Error('cancelled')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('size')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (signal.aborted) throw new Error('cancelled')
    return bytes
  } finally { canvas.width = 0; canvas.height = 0 }
}
