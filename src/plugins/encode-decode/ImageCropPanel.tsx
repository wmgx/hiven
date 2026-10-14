import { useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, useLocalEscapeLayer } from '@hiven/plugin-ui'
import { MAX_IMAGE_BYTES } from './imageBase64'
import { loadRedactionImage, type Point } from './imageRedaction'
import { cropFromDrag, exportCrop, parseCrop, type CropRect } from './imageCrop'
import './imageCrop.css'

type Props = PluginSurfaceProps & { onDirtyChange(dirty: boolean): void; invalidateRef: { current: (() => void) | null } }
const emptyFields = { x: '0', y: '0', width: '', height: '' }
const keys = ['x', 'y', 'width', 'height'] as const
export function ImageCropPanel({ host, t, onDirtyChange, invalidateRef }: Props) {
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null)
  const [fields, setFields] = useState(emptyFields)
  const [draft, setDraft] = useState<CropRect | null>(null)
  const [dragActive, setDragActive] = useState(false)
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
  const drag = useRef<{ start: Point; pointer: number } | null>(null)
  const pending = useRef(false)
  const revision = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const composing = useRef(false)
  const mounted = useRef(true)
  const stateRef = useRef({ original, fields })
  stateRef.current = { original, fields }
  const selection = original ? parseCrop(fields, original.width, original.height) : null
  const cancelDraft = () => {
    const active = drag.current; drag.current = null
    if (active && canvas.current?.hasPointerCapture(active.pointer)) canvas.current.releasePointerCapture(active.pointer)
    setDragActive(false); setDraft(null); setReplacement(null)
  }
  const invalidate = () => { revision.current++; abort.current?.abort(); abort.current = null; cancelDraft() }
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
    view.width = original.width; view.height = original.height
    const context = view.getContext('2d')
    if (!context) return
    context.drawImage(original, 0, 0)
    const rect = dragActive ? draft : selection
    if (rect) {
      context.fillStyle = 'rgba(0,0,0,0.5)'
      context.fillRect(0, 0, original.width, rect.y)
      context.fillRect(0, rect.y, rect.x, rect.height)
      context.fillRect(rect.x + rect.width, rect.y, original.width - rect.x - rect.width, rect.height)
      context.fillRect(0, rect.y + rect.height, original.width, original.height - rect.y - rect.height)
      context.strokeStyle = '#ffffff'; context.lineWidth = 1
      context.strokeRect(rect.x + .5, rect.y + .5, rect.width - 1, rect.height - 1)
    }
  }, [original, fields, draft, dragActive])
  useLocalEscapeLayer({ open: dragActive || !!replacement, triggerRef: panel, popupRef: panel, owner: host.deliveryFeedbackOwner, composingRef: composing, onDismiss: cancelDraft })
  const run = async (operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (pending.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
    invalidate()
    const token = revision.current
    const controller = new AbortController(); abort.current = controller
    const current = () => mounted.current && token === revision.current && !controller.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    pending.current = true; setBusy(true); setStatus('image.busy')
    try { await operation(controller.signal, current) }
    catch (error) { if (current()) setStatus(error instanceof Error && error.message === 'size' ? 'image.sizeError' : 'crop.failed') }
    finally { pending.current = false; if (mounted.current) { setBusy(false); if (!current()) setStatus('') } }
  }
  const load = (read: (signal: AbortSignal) => Promise<{ bytes: Uint8Array; contentType?: string }>) => run(async (signal, current) => {
    readyRef.current = false; setReady(false)
    const data = await read(signal)
    const image = await loadRedactionImage(data.bytes, signal, data.contentType)
    if (!current()) { image.width = 0; image.height = 0; return }
    if (imageRef.current) { imageRef.current.width = 0; imageRef.current.height = 0 }
    imageRef.current = image; readyRef.current = true; setReady(true)
    setOriginal(image); setFields(emptyFields); setDirty(false); setStatus(''); setReplacement(null)
  })
  const choose = (kind: 'file' | 'clipboard', confirmed = false) => {
    if (pending.current) return
    if (dirty && !confirmed) { setReplacement(kind); return }
    setReplacement(null)
    if (kind === 'file') file.current?.click()
    else if (host.clipboard.readImage) void load(signal => host.clipboard.readImage!({ signal }))
  }
  const commit = (rect: CropRect | null) => {
    invalidate(); setFields(rect ? { x: String(rect.x), y: String(rect.y), width: String(rect.width), height: String(rect.height) } : emptyFields)
    setDirty(!!rect); setStatus('')
  }
  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - box.left) * event.currentTarget.width / box.width, y: (event.clientY - box.top) * event.currentTarget.height / box.height }
  }
  const deliver = (action: 'copy' | 'save') => {
    if (!readyRef.current || !ready || !original || imageRef.current !== original || stateRef.current.fields !== fields || !selection || drag.current) return
    void run(async (signal, current) => {
      const bytes = await exportCrop(original, selection, signal)
      if (!current()) return
      const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      try {
        if (!current()) return
        if (action === 'copy') {
          await host.clipboard.writeImage(blob.blobId, { signal })
          if (current()) { setDirty(false); setStatus('image.copied') }
        } else {
          const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'cropped.png' })
          if (current()) { setStatus(saved.status === 'saved' ? 'image.saved' : 'image.cancelled'); if (saved.status === 'saved') setDirty(false) }
        }
      } finally { try { await host.storage.blob.delete(blob.blobId) } catch { /* Delivery result takes priority over cleanup. */ } }
    })
  }
  return <main ref={panel} className="image-crop" tabIndex={-1} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}>
    <div className="image-crop-toolbar">
      <Button disabled={busy} onClick={() => choose('file')}>{t('image.chooseFile')}</Button>
      <Button disabled={busy || !host.clipboard.readImage} onClick={() => choose('clipboard')}>{t('image.readClipboard')}</Button>
      <Button disabled={busy || !ready || !original || dragActive} onClick={() => commit(null)}>{t('crop.clear')}</Button>
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void load(async () => { if (selected.size > MAX_IMAGE_BYTES) throw new Error('size'); return { bytes: new Uint8Array(await selected.arrayBuffer()), contentType: selected.type || undefined } })
      }} />
    </div>
    {replacement && <div role="alert" className="image-crop-replace"><span>{t('crop.replace')}</span><Button onClick={() => choose(replacement, true)}>{t('redact.replaceConfirm')}</Button><Button onClick={cancelDraft}>{t('redact.keep')}</Button></div>}
    {original && !ready && !busy && <div className="image-crop-replace"><span>{t('crop.previous')}</span><Button onClick={() => { readyRef.current = true; setReady(true); setStatus('') }}>{t('redact.keep')}</Button></div>}
    <div className="image-crop-fields">
      {keys.map(key => <label key={key}>{t(`crop.${key}`)}<input type="number" min={key === 'x' || key === 'y' ? 0 : 1} max={original ? key === 'x' ? original.width - 1 : key === 'y' ? original.height - 1 : key === 'width' ? original.width : original.height : undefined} step={1} value={fields[key]} disabled={busy || !ready || !original || dragActive} aria-invalid={!!original && !selection} aria-describedby="crop-size-status" onChange={event => {
        if (pending.current) return
        invalidate(); setFields({ ...fields, [key]: event.target.value }); setDirty(true); setStatus('')
      }} /></label>)}
    </div>
    <div className="image-crop-viewport" data-launcher-scrollable>
      {original ? <canvas ref={canvas} tabIndex={0} aria-label={t('crop.canvas')} onPointerDown={event => {
        if (!ready || pending.current || event.button !== 0 || !event.isPrimary) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { start: point(event), pointer: event.pointerId }; setDragActive(true); setDraft(null)
      }} onPointerMove={event => {
        if (drag.current?.pointer === event.pointerId) setDraft(cropFromDrag(drag.current.start, point(event), original.width, original.height))
      }} onPointerUp={event => {
        const active = drag.current
        if (!active || active.pointer !== event.pointerId) return
        const rect = cropFromDrag(active.start, point(event), original.width, original.height)
        cancelDraft(); if (rect) commit(rect)
      }} onPointerCancel={cancelDraft} onLostPointerCapture={() => { if (drag.current) cancelDraft() }} /> : <p className="image-crop-empty">{t('crop.empty')}</p>}
    </div>
    <footer className="image-crop-footer">
      <span id="crop-size-status" role="status" aria-live="polite">{status ? t(status) : selection ? t('crop.dimensions', { width: selection.width, height: selection.height }) : t(original ? fields.width || fields.height ? 'crop.invalid' : 'crop.select' : 'crop.empty')}</span>
      <Button disabled={busy || !ready || !selection || dragActive} onClick={() => deliver('copy')}>{t('image.copyImage')}</Button>
      <Button disabled={busy || !ready || !selection || dragActive} onClick={() => deliver('save')}>{t('image.save')}</Button>
    </footer>
  </main>
}
