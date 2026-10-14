import { useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, useLocalEscapeLayer } from '@hiven/plugin-ui'
import { MAX_IMAGE_BYTES } from './imageBase64'
import { loadRedactionImage } from './imageRedaction'
import { exportResizedImage, resizeDimensions } from './imageResize'
import './imageCrop.css'

type Props = PluginSurfaceProps & { onDirtyChange(dirty: boolean): void; invalidateRef: { current: (() => void) | null } }
export function ImageResizePanel({ host, t, onDirtyChange, invalidateRef }: Props) {
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState('')
  const readyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const imageRef = useRef<HTMLCanvasElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [dirty, setDirty] = useState(false)
  const [replacement, setReplacement] = useState<'file' | 'clipboard' | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const revision = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const mounted = useRef(true)
  const stateRef = useRef({ original, width })
  stateRef.current = { original, width }
  const size = original ? resizeDimensions(width, original.width, original.height) : null
  const cancelReplacement = () => setReplacement(null)
  const invalidate = () => { revision.current++; abort.current?.abort(); abort.current = null; cancelReplacement() }
  useLayoutEffect(() => () => { if (imageRef.current) { imageRef.current.width = 0; imageRef.current.height = 0; imageRef.current = null } }, [])
  useLayoutEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useLayoutEffect(() => {
    mounted.current = true
    const stop = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    const stopLeave = host.subscribeLeaveIntent?.(invalidate)
    invalidateRef.current = invalidate
    return () => { mounted.current = false; revision.current++; abort.current?.abort(); stop?.(); stopLeave?.(); invalidateRef.current = null }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent, invalidateRef])
  useLayoutEffect(() => {
    const view = canvas.current
    if (!view || !original) return
    // Whole-image preview only; bounded independently of source/output buffers.
    const ratio = Math.min(1, 800 / original.width, 480 / original.height)
    view.width = Math.max(1, Math.round(original.width * ratio))
    view.height = Math.max(1, Math.round(original.height * ratio))
    const context = view.getContext('2d')
    context?.drawImage(original, 0, 0, view.width, view.height)
    return () => { view.width = 0; view.height = 0 }
  }, [original])
  useLocalEscapeLayer({ open: !!replacement, triggerRef: panel, popupRef: panel, owner: host.deliveryFeedbackOwner, composingRef: composing, onDismiss: cancelReplacement })
  const run = async (operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (pending.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
    invalidate()
    const token = revision.current
    const controller = new AbortController(); abort.current = controller
    const current = () => mounted.current && token === revision.current && !controller.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    pending.current = true; setBusy(true); setStatus('image.busy')
    try { await operation(controller.signal, current) }
    catch (error) { if (current()) setStatus(error instanceof Error && error.message === 'size' ? 'image.sizeError' : 'resize.failed') }
    finally { pending.current = false; if (mounted.current) { setBusy(false); if (!current()) setStatus('') } }
  }
  const load = (read: (signal: AbortSignal) => Promise<{ bytes: Uint8Array; contentType?: string }>) => run(async (signal, current) => {
    readyRef.current = false; setReady(false)
    const data = await read(signal)
    const image = await loadRedactionImage(data.bytes, signal, data.contentType)
    if (!current()) { image.width = 0; image.height = 0; return }
    if (imageRef.current) { imageRef.current.width = 0; imageRef.current.height = 0 }
    imageRef.current = image; readyRef.current = true; setReady(true)
    setOriginal(image); setWidth(String(image.width)); setDirty(false); setStatus(''); setReplacement(null)
  })
  const choose = (kind: 'file' | 'clipboard', confirmed = false) => {
    if (pending.current) return
    if (dirty && !confirmed) { setReplacement(kind); return }
    setReplacement(null)
    if (kind === 'file') file.current?.click()
    else if (host.clipboard.readImage) void load(signal => host.clipboard.readImage!({ signal }))
  }
  const deliver = (action: 'copy' | 'save') => {
    if (!readyRef.current || !ready || !original || imageRef.current !== original || stateRef.current.width !== width || !size) return
    void run(async (signal, current) => {
      const bytes = await exportResizedImage(original, width, signal)
      if (!current()) return
      const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      try {
        if (!current()) return
        if (action === 'copy') {
          await host.clipboard.writeImage(blob.blobId, { signal })
          if (current()) { setDirty(false); setStatus('image.copied') }
        } else {
          const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'resized.png' })
          if (current()) { setStatus(saved.status === 'saved' ? 'image.saved' : 'image.cancelled'); if (saved.status === 'saved') setDirty(false) }
        }
      } finally { try { await host.storage.blob.delete(blob.blobId) } catch { /* Delivery result takes priority over cleanup. */ } }
    })
  }
  return <main ref={panel} className="image-crop image-resize" tabIndex={-1} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
    <div className="image-crop-toolbar">
      <Button disabled={busy} onClick={() => choose('file')}>{t('image.chooseFile')}</Button>
      <Button disabled={busy || !host.clipboard.readImage} onClick={() => choose('clipboard')}>{t('image.readClipboard')}</Button>
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void load(async () => { if (selected.size > MAX_IMAGE_BYTES) throw new Error('size'); return { bytes: new Uint8Array(await selected.arrayBuffer()), contentType: selected.type || undefined } })
      }} />
    </div>
    {replacement && <div role="alert" className="image-crop-replace"><span>{t('resize.replace')}</span><Button onClick={() => choose(replacement, true)}>{t('redact.replaceConfirm')}</Button><Button onClick={cancelReplacement}>{t('redact.keep')}</Button></div>}
    {original && !ready && !busy && <div className="image-crop-replace"><span>{t('resize.previous')}</span><Button onClick={() => { readyRef.current = true; setReady(true); setStatus('') }}>{t('redact.keep')}</Button></div>}
    <div className="image-crop-fields">
      <label>{t('resize.width')}<input type="number" min={1} max={original?.width} step={1} value={width} disabled={busy || !ready || !original} aria-invalid={!!original && !size} aria-describedby="resize-size-status resize-hint" onChange={event => {
        if (pending.current) return
        invalidate(); setWidth(event.target.value); setDirty(true); setStatus('')
      }} /></label>
      {original && <span>{t('resize.source', { width: original.width, height: original.height })}</span>}
    </div>
    <small id="resize-hint">{t('resize.hint')}</small>
    <div className="image-crop-viewport" data-launcher-scrollable>
      {original ? <canvas ref={canvas} aria-label={t('resize.preview')} style={{ cursor: 'default' }} /> : <p className="image-crop-empty">{t('crop.empty')}</p>}
    </div>
    <footer className="image-crop-footer">
      <span id="resize-size-status" role="status" aria-live="polite">{status ? t(status) : size ? t('crop.dimensions', size) : t(original ? 'resize.invalid' : 'crop.empty')}</span>
      <Button disabled={busy || !ready || !size} onClick={() => deliver('copy')}>{t('image.copyImage')}</Button>
      <Button disabled={busy || !ready || !size} onClick={() => deliver('save')}>{t('image.save')}</Button>
    </footer>
  </main>
}
