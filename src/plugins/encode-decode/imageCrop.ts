import { MAX_IMAGE_BYTES } from './imageBase64'
import { redactionRect, type Point, type RedactionRect } from './imageRedaction'
export type CropRect = RedactionRect
export const cropFromDrag = (a: Point, b: Point, width: number, height: number) => redactionRect(a, b, width, height)
export function validCrop(rect: CropRect, width: number, height: number): boolean {
  return [rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isSafeInteger)
    && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= width && rect.y + rect.height <= height
}
export function parseCrop(fields: Record<keyof CropRect, string>, width: number, height: number): CropRect | null {
  if (!Object.values(fields).every(value => /^(0|[1-9]\d*)$/.test(value))) return null
  const rect = { x: Number(fields.x), y: Number(fields.y), width: Number(fields.width), height: Number(fields.height) }
  return validCrop(rect, width, height) ? rect : null
}
/** New pixel buffer of exactly the selected size; no source bytes or preview overlay. */
export async function exportCrop(original: HTMLCanvasElement, rect: CropRect, signal: AbortSignal) {
  if (signal.aborted) throw new Error('cancelled')
  if (!validCrop(rect, original.width, original.height)) throw new Error('invalid')
  const canvas = document.createElement('canvas')
  try {
    canvas.width = rect.width; canvas.height = rect.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('invalid')
    context.drawImage(original, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('invalid')), 'image/png'))
    if (signal.aborted) throw new Error('cancelled')
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('size')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (signal.aborted) throw new Error('cancelled')
    return bytes
  } finally { canvas.width = 0; canvas.height = 0 }
}
