import { decodeRaster, inspectRaster, MAX_IMAGE_BYTES } from './imageBase64'

export type Point = { x: number; y: number }
export type RedactionRect = { x: number; y: number; width: number; height: number }

/** Cover every touched source pixel, regardless of CSS scale or device pixel ratio. */
export function redactionRect(a: Point, b: Point, width: number, height: number): RedactionRect | null {
  if (![a.x, a.y, b.x, b.y, width, height].every(Number.isFinite) || a.x === b.x || a.y === b.y) return null
  const x = Math.max(0, Math.min(width, Math.floor(Math.min(a.x, b.x))))
  const y = Math.max(0, Math.min(height, Math.floor(Math.min(a.y, b.y))))
  const right = Math.max(0, Math.min(width, Math.ceil(Math.max(a.x, b.x))))
  const bottom = Math.max(0, Math.min(height, Math.ceil(Math.max(a.y, b.y))))
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

export async function loadRedactionImage(bytes: Uint8Array, signal: AbortSignal, mime?: string): Promise<HTMLCanvasElement> {
  const decoded = await decodeRaster(bytes, inspectRaster(bytes, mime), signal)
  const image = new Image()
  image.src = decoded.preview
  await image.decode()
  if (signal.aborted) throw new Error('cancelled')
  const canvas = document.createElement('canvas')
  // Canonical PNG dimensions already include EXIF orientation.
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('invalid')
  ctx.drawImage(image, 0, 0)
  image.src = ''
  return canvas
}

export function paintRedactions(canvas: HTMLCanvasElement, original: HTMLCanvasElement, rectangles: readonly RedactionRect[]) {
  if (canvas.width !== original.width) canvas.width = original.width
  if (canvas.height !== original.height) canvas.height = original.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('invalid')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(original, 0, 0)
  ctx.fillStyle = '#000000'
  for (const rect of rectangles) ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
}

/** Fresh flattened pixels only: no original file bytes, EXIF or editable layers. */
export async function exportRedactions(original: HTMLCanvasElement, rectangles: readonly RedactionRect[], signal: AbortSignal) {
  const canvas = document.createElement('canvas')
  try {
    paintRedactions(canvas, original, rectangles)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('invalid')), 'image/png'))
    if (signal.aborted) throw new Error('cancelled')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('size')
    return new Uint8Array(await blob.arrayBuffer())
  } finally { canvas.width = 0; canvas.height = 0 }
}
