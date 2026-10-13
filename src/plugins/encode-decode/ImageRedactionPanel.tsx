import { useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, useLocalEscapeLayer } from '@hiven/plugin-ui'
import { MAX_IMAGE_BYTES } from './imageBase64'
import { exportRedactions, loadRedactionImage, paintRedactions, redactionRect, type Point, type RedactionRect } from './imageRedaction'
import './imageRedaction.css'

type Props = PluginSurfaceProps & { onDirtyChange(dirty: boolean): void; invalidateRef: { current: (() => void) | null } }
export function ImageRedactionPanel({ host, t, onDirtyChange, invalidateRef }: Props) {
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null)
  const [rectangles, setRectangles] = useState<RedactionRect[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [draft, setDraft] = useState<RedactionRect | null>(null)
  const [ready, setReady] = useState(false)
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
  const invalidate = () => { revision.current++; abort.current?.abort(); abort.current = null; drag.current = null; setDragActive(false); setDraft(null) }
  useLayoutEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useLayoutEffect(() => {
    mounted.current = true
    const stop = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    const stopLeave = host.subscribeLeaveIntent?.(invalidate)
    invalidateRef.current = invalidate
    return () => { mounted.current = false; revision.current++; abort.current?.abort(); stop?.(); stopLeave?.(); invalidateRef.current = null }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent, invalidateRef])
  useLayoutEffect(() => {
    if (canvas.current && original) paintRedactions(canvas.current, original, draft ? [...rectangles, draft] : rectangles)
  }, [original, rectangles, draft])
  const cancelDraft = () => { drag.current = null; setDragActive(false); setDraft(null); setReplacement(null) }
  useLocalEscapeLayer({ open: dragActive || !!replacement, triggerRef: panel, popupRef: panel, owner: host.deliveryFeedbackOwner, composingRef: composing, onDismiss: cancelDraft })

  const run = async (operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    if (pending.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
    invalidate()
    const token = revision.current
    const controller = new AbortController(); abort.current = controller
    const current = () => mounted.current && token === revision.current && !controller.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    pending.current = true; setBusy(true); setStatus('image.busy')
    try { await operation(controller.signal, current) }
    catch (error) { if (current()) setStatus(error instanceof Error && error.message === 'size' ? 'image.sizeError' : 'redact.failed') }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const load = (read: (signal: AbortSignal) => Promise<{ bytes: Uint8Array; contentType?: string }>) => run(async (signal, current) => {
    setReady(false)
    const data = await read(signal)
    const image = await loadRedactionImage(data.bytes, signal, data.contentType)
    if (!current()) return
    setOriginal(image); setReady(true); setRectangles([]); setDirty(false); setStatus('redact.ready'); setReplacement(null)
  })
  const choose = (kind: 'file' | 'clipboard', confirmed = false) => {
    if (pending.current) return
    if (dirty && !confirmed) { setReplacement(kind); return }
    setReplacement(null)
    if (kind === 'file') file.current?.click()
    else if (host.clipboard.readImage) void load(signal => host.clipboard.readImage!({ signal }))
  }
  const undo = () => {
    if (pending.current) return
    if (drag.current) { cancelDraft(); return }
    if (!rectangles.length) return
    invalidate(); setRectangles(rectangles.slice(0, -1)); setDirty(true); setStatus('')
  }
  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: (event.clientX - box.left) * event.currentTarget.width / box.width, y: (event.clientY - box.top) * event.currentTarget.height / box.height }
  }
  const deliver = (action: 'copy' | 'save') => {
    if (!ready || !original || drag.current) return
    void run(async (signal, current) => {
      const bytes = await exportRedactions(original, rectangles, signal)
      if (!current()) return
      const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      try {
        if (!current()) return
        if (action === 'copy') {
          await host.clipboard.writeImage(blob.blobId, { signal })
          if (current()) { setDirty(false); setStatus('image.copied') }
        } else {
          const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'redacted.png' })
          if (current()) { setStatus(saved.status === 'saved' ? 'image.saved' : 'image.cancelled'); if (saved.status === 'saved') setDirty(false) }
        }
      } finally { try { await host.storage.blob.delete(blob.blobId) } catch { /* Cleanup cannot turn completed delivery into failure. */ } }
    })
  }
  return <main ref={panel} className="image-redaction" tabIndex={-1} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); undo() }
  }}>
    <div className="image-redaction-toolbar">
      <Button disabled={busy} onClick={() => choose('file')}>{t('image.chooseFile')}</Button>
      <Button disabled={busy || !host.clipboard.readImage} onClick={() => choose('clipboard')}>{t('image.readClipboard')}</Button>
      <Button disabled={busy || !rectangles.length} onClick={undo}>{t('redact.undo')}</Button>
      <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(event) => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void load(async () => { if (selected.size > MAX_IMAGE_BYTES) throw new Error('size'); return { bytes: new Uint8Array(await selected.arrayBuffer()), contentType: selected.type || undefined } })
      }} />
    </div>
    {replacement && <div role="alert" className="image-redaction-replace"><span>{t('redact.replace')}</span><Button onClick={() => choose(replacement, true)}>{t('redact.replaceConfirm')}</Button><Button onClick={cancelDraft}>{t('redact.keep')}</Button></div>}
    {original && !ready && !busy && <div className="image-redaction-replace"><span>{t('redact.previous')}</span><Button onClick={() => { setReady(true); setStatus('') }}>{t('redact.keep')}</Button></div>}
    <div className="image-redaction-viewport" data-launcher-scrollable>
      {original ? <canvas ref={canvas} tabIndex={0} aria-label={t('redact.canvas')} onPointerDown={(event) => {
        if (pending.current || event.button !== 0 || !event.isPrimary) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { start: point(event), pointer: event.pointerId }; setDragActive(true)
      }} onPointerMove={(event) => {
        if (!drag.current || drag.current.pointer !== event.pointerId || !original) return
        setDraft(redactionRect(drag.current.start, point(event), original.width, original.height))
      }} onPointerUp={(event) => {
        const active = drag.current
        if (!active || active.pointer !== event.pointerId || !original) return
        const rect = redactionRect(active.start, point(event), original.width, original.height)
        drag.current = null; setDragActive(false); setDraft(null)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (rect) { revision.current++; setRectangles([...rectangles, rect]); setDirty(true); setStatus('') }
      }} onPointerCancel={cancelDraft} onLostPointerCapture={() => { if (drag.current) cancelDraft() }} /> : <p className="image-redaction-empty">{t('redact.empty')}</p>}
    </div>
    <footer className="image-redaction-footer">
      <span role="status" aria-live="polite">{status ? t(status) : original ? t('redact.count', { count: rectangles.length, width: original.width, height: original.height }) : ''}</span>
      <Button disabled={busy || !ready || !original || dragActive} onClick={() => deliver('copy')}>{t('image.copyImage')}</Button>
      <Button disabled={busy || !ready || !original || dragActive} onClick={() => deliver('save')}>{t('image.save')}</Button>
    </footer>
  </main>
}
