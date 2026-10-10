import type { PluginClipboardApi } from '@hiven/plugin'
import { decodeQrFromBlob, decodeQrFromDataUrl, isImageDataUrl, type QrDecodeResult } from './qrCore'

type ScanImage = { blob: Blob } | { dataUrl: string }
type ScanClipboard = Pick<PluginClipboardApi, 'readImage' | 'readText'>

export type QrScanState = {
  previewUrl: string
  result: QrDecodeResult | null
  clipboardError: boolean
  busy: boolean
}

export const EMPTY_QR_SCAN: QrScanState = { previewUrl: '', result: null, clipboardError: false, busy: false }

async function readClipboardImage(getClipboard: () => ScanClipboard, signal: AbortSignal): Promise<ScanImage> {
  const clipboard = getClipboard()
  if (!clipboard.readImage) throw new DOMException('Image read unavailable', 'NotReadableError')
  try {
    const image = await clipboard.readImage({ signal })
    return { blob: new Blob([image.bytes as BlobPart], { type: image.contentType }) }
  } catch (error) {
    // A Data URL is also an image paste. Permission, cancellation and size
    // errors must never initiate another clipboard read.
    if (!(error instanceof Error) || error.name !== 'NotReadableError' || signal.aborted) throw error
    if (getClipboard() !== clipboard || !clipboard.readImage) throw new DOMException('Image read cancelled', 'AbortError')
    const text = await clipboard.readText({ signal })
    if (signal.aborted) throw new DOMException('Image read cancelled', 'AbortError')
    if (isImageDataUrl(text)) return { dataUrl: text.trim() }
    throw error
  }
}

/** One owner for all scan sources, their pending work, and preview URLs. */
export function createQrScanSession(
  onChange: (state: QrScanState) => void,
  decode = { blob: decodeQrFromBlob, dataUrl: decodeQrFromDataUrl },
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
) {
  let request: AbortController | undefined
  let ownedPreview = ''
  let disposed = false

  const cancel = () => {
    request?.abort()
    request = undefined
    if (ownedPreview) urls.revokeObjectURL(ownedPreview)
    ownedPreview = ''
  }

  const scan = async (read: (signal: AbortSignal) => ScanImage | Promise<ScanImage>, clipboard = false) => {
    if (disposed) return
    cancel()
    const current = new AbortController()
    request = current
    const isCurrent = () => request === current && !current.signal.aborted && !disposed
    let state = { ...EMPTY_QR_SCAN, busy: true }
    let imageReady = false
    onChange(state)
    try {
      const image = await read(current.signal)
      if (!isCurrent()) return
      imageReady = true
      const previewUrl = 'blob' in image ? urls.createObjectURL(image.blob) : image.dataUrl
      if ('blob' in image) ownedPreview = previewUrl
      state = { ...state, previewUrl }
      onChange(state)
      const result = 'blob' in image ? await decode.blob(image.blob) : await decode.dataUrl(image.dataUrl)
      if (isCurrent()) onChange({ ...state, result, busy: false })
    } catch {
      if (!isCurrent()) return
      onChange({
        ...state,
        result: clipboard && !imageReady ? null : { ok: false, code: 'failed' },
        clipboardError: clipboard && !imageReady,
        busy: false,
      })
    }
  }

  return {
    blob: (blob: Blob) => scan(() => ({ blob })),
    dataUrl: (dataUrl: string) => scan(() => ({ dataUrl: dataUrl.trim() })),
    clipboard: (getClipboard: () => ScanClipboard) => scan((signal) => readClipboardImage(getClipboard, signal), true),
    unreadableClipboard() {
      if (disposed) return
      cancel()
      onChange({ ...EMPTY_QR_SCAN, clipboardError: true })
    },
    reset() {
      if (disposed) return
      cancel()
      onChange({ ...EMPTY_QR_SCAN })
    },
    dispose() {
      cancel()
      disposed = true
    },
  }
}
