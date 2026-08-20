/**
 * QR encode / decode helpers. Browser-only decode uses canvas + jsQR;
 * matrix generation works in Node for tests.
 */

import { create as createQrCode, toDataURL as qrToDataUrl } from 'qrcode'
import jsQR from 'jsqr'

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export const QR_ERROR_LEVELS: QrErrorCorrection[] = ['L', 'M', 'Q', 'H']
export const QR_SIZES = [160, 256, 320, 480] as const
export const DEFAULT_QR_SIZE = 256
export const DEFAULT_QR_ERROR_LEVEL: QrErrorCorrection = 'M'

export type QrModules = {
  size: number
}

export type QrDecodeResult =
  | { ok: true; text: string }
  | { ok: false; code: 'empty' | 'not-image' | 'no-qr' | 'failed' }

export function isQrErrorCorrection(value: unknown): value is QrErrorCorrection {
  return value === 'L' || value === 'M' || value === 'Q' || value === 'H'
}

export function normalizeQrErrorCorrection(value: unknown): QrErrorCorrection {
  return isQrErrorCorrection(value) ? value : DEFAULT_QR_ERROR_LEVEL
}

export function normalizeQrSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_QR_SIZE
  const rounded = Math.round(n)
  if ((QR_SIZES as readonly number[]).includes(rounded)) return rounded
  return Math.max(128, Math.min(1024, rounded))
}

export function isImageDataUrl(text: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(text.trim())
}

export function createQrModules(text: string, errorCorrection: QrErrorCorrection = DEFAULT_QR_ERROR_LEVEL): QrModules {
  const payload = text.trim()
  if (!payload) throw new Error('empty')
  const qr = createQrCode(payload, { errorCorrectionLevel: errorCorrection })
  return { size: qr.modules.size }
}

export async function generateQrDataUrl(
  text: string,
  options?: { errorCorrection?: QrErrorCorrection; size?: number },
): Promise<string> {
  const payload = text.trim()
  if (!payload) throw new Error('empty')
  return qrToDataUrl(payload, {
    errorCorrectionLevel: options?.errorCorrection ?? DEFAULT_QR_ERROR_LEVEL,
    width: normalizeQrSize(options?.size),
    margin: 1,
    color: { dark: '#111111', light: '#ffffff' },
  })
}

export function dataUrlToBase64(dataUrl: string): string {
  const trimmed = dataUrl.trim()
  const comma = trimmed.indexOf(',')
  if (comma < 0) throw new Error('not-image')
  return trimmed.slice(comma + 1)
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrlToBase64(dataUrl))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function dataUrlToPngBlob(dataUrl: string): Blob {
  return new Blob([dataUrlToBytes(dataUrl) as BlobPart], { type: 'image/png' })
}

export async function copyPngBlobToClipboard(blob: Blob): Promise<void> {
  const ClipboardItemCtor = globalThis.ClipboardItem
  if (!navigator.clipboard?.write || !ClipboardItemCtor) {
    throw new Error('unsupported')
  }
  await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })])
}

export function decodeQrFromImageData(imageData: ImageData): string | null {
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })
  const text = result?.data?.trim()
  return text ? text : null
}

export async function decodeQrFromBlob(blob: Blob): Promise<QrDecodeResult> {
  if (!blob || blob.size === 0) return { ok: false, code: 'empty' }
  if (blob.type && !blob.type.startsWith('image/')) return { ok: false, code: 'not-image' }
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { ok: false, code: 'failed' }
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return { ok: false, code: 'failed' }
    context.drawImage(bitmap, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    bitmap.close()
    const text = decodeQrFromImageData(imageData)
    if (!text) return { ok: false, code: 'no-qr' }
    return { ok: true, text }
  } catch {
    return { ok: false, code: 'failed' }
  }
}

export async function decodeQrFromDataUrl(dataUrl: string): Promise<QrDecodeResult> {
  if (!isImageDataUrl(dataUrl)) return { ok: false, code: 'not-image' }
  try {
    const bytes = dataUrlToBytes(dataUrl)
    const mime = dataUrl.trim().slice(5, dataUrl.trim().indexOf(';')) || 'image/png'
    return decodeQrFromBlob(new Blob([bytes as BlobPart], { type: mime }))
  } catch {
    return { ok: false, code: 'failed' }
  }
}
