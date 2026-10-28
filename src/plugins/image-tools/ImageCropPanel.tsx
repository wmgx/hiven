import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { copyPng } from './copyPng'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextInput, SurfaceHeaderField, SurfaceHeaderActions, ValueChip, ActionBar, SurfaceStatus, SurfaceError, useLocalEscapeLayer } from '@hiven/plugin-ui'
import { MAX_IMAGE_BYTES } from './raster'
import { loadRedactionImage, type Point } from './imageRedaction'
import { cropFromDrag, moveCrop, exportCrop, parseCrop, type CropRect } from './imageCrop'
import './imageCrop.css'

type Props = PluginSurfaceProps & { onDirtyChange(dirty: boolean): void; invalidateRef: { current: (() => void) | null } }
const emptyFields = { x: '0', y: '0', width: '', height: '' }

export function ImageCropPanel({ host, t, onDirtyChange, invalidateRef }: Props) {
  const [filename, setFilename] = useState('')
  const [original, setOriginal] = useState<HTMLCanvasElement | null>(null)
  const [fields, setFields] = useState(emptyFields)
  const [ratio, setRatio] = useState('free')
  const ratioOrigin = useRef({ ratio, fields })
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
  const drag = useRef<{ start: Point; pointer: number; moving?: CropRect; aspect: number } | null>(null)
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
      const handle = 6 * original.width / Math.max(1, view.getBoundingClientRect().width)
      context.fillStyle = '#ffffff'
      for (const x of [rect.x, rect.x + rect.width]) for (const y of [rect.y, rect.y + rect.height]) context.fillRect(x - handle / 2, y - handle / 2, handle, handle)
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
  const load = (read: (signal: AbortSignal) => Promise<{ bytes: Uint8Array; contentType?: string; name?: string }>) => run(async (signal, current) => {
    readyRef.current = false; setReady(false)
    const data = await read(signal)
    const image = await loadRedactionImage(data.bytes, signal, data.contentType)
    if (!current()) { image.width = 0; image.height = 0; return }
    if (imageRef.current) { imageRef.current.width = 0; imageRef.current.height = 0 }
    imageRef.current = image; readyRef.current = true; setReady(true)
    setFilename(data.name || t('image.clipboard')); setOriginal(image); setFields(emptyFields); setDirty(false); setStatus(''); setReplacement(null)
  })
  useEffect(() => {
    const controller = new AbortController(), token = revision.current
    void host.clipboard.readImage?.({ signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && revision.current === token) void load(async () => data)
    }).catch(() => {})
    return () => controller.abort()
  }, [])
  const choose = (kind: 'file' | 'clipboard', confirmed = false) => {
    if (pending.current) return
    if (dirty && !confirmed) { setReplacement(kind); return }
    invalidate(); setReplacement(null)
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
  const aspect = (value: string) => value === 'free' ? undefined : Number(value.split(':')[0]) / Number(value.split(':')[1])
  const previewRatio = (value: string | string[]) => {
    const next = String(value); setRatio(next)
    const source = ratioOrigin.current
    if (next === source.ratio) { invalidate(); setFields(source.fields); return }
    const rect = original ? parseCrop(source.fields, original.width, original.height) : null
    if (rect && original) commit(cropFromDrag({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, original.width, original.height, aspect(next)))
  }
  const dragRect = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = drag.current
    if (!active || !original) return null
    const end = point(event)
    return active.moving ? moveCrop(active.moving, end.x - active.start.x, end.y - active.start.y, original.width, original.height)
      : cropFromDrag(active.start, end, original.width, original.height, aspect(ratio) ?? (event.shiftKey ? active.aspect : undefined))
  }
  const displayed = dragActive ? draft : selection
  const save = () => {
    if (!readyRef.current || !ready || !original || imageRef.current !== original || stateRef.current.fields !== fields || !selection || drag.current) return
    void run(async (signal, current) => {
      const bytes = await exportCrop(original, selection, signal)
      if (!current()) return
      const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      try {
        if (!current()) return
        const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'cropped.png' })
        if (current()) { setStatus(saved.status === 'saved' ? 'image.saved' : ''); if (saved.status === 'saved') setDirty(false) }
      } finally { try { await host.storage.blob.delete(blob.blobId) } catch { /* Delivery result takes priority over cleanup. */ } }
    })
  }
  return <main ref={panel} className="image-crop" tabIndex={-1} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || composing.current || event.defaultPrevented) return
      if ((event.metaKey || event.ctrlKey) && ['o', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); choose(event.key.toLowerCase() === 'o' ? 'file' : 'clipboard'); return }
      if (selection && original && !busy && !dragActive && event.target === canvas.current && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
        event.preventDefault(); const step = event.shiftKey ? 10 : 1
        commit(moveCrop(selection, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0, original.width, original.height))
      }
    }}>
    <SurfaceHeaderField><span className="image-tools-filename">{filename}</span></SurfaceHeaderField>
    <SurfaceHeaderActions><ValueChip label={t('crop.ratio')} value={ratio} options={['free','1:1','4:3','16:9'].map(value => ({ value, label: value === 'free' ? t('crop.free') : value }))}
      onOpen={() => { ratioOrigin.current = { ratio, fields } }} onPreview={previewRatio} onChange={previewRatio} /></SurfaceHeaderActions>
    {!original && <div className="image-crop-empty-actions"><Button disabled={busy} autoFocus onClick={() => choose('file')}>{t('image.chooseFile')} <kbd>⌘O</kbd></Button>
      <Button disabled={busy || !host.clipboard.readImage} onClick={() => choose('clipboard')}>{t('image.readClipboard')} <kbd>⌘V</kbd></Button></div>}
      <TextInput ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void load(async () => { if (selected.size > MAX_IMAGE_BYTES) throw new Error('size'); return { bytes: new Uint8Array(await selected.arrayBuffer()), contentType: selected.type || undefined, name: selected.name } })
      }} />
    {replacement && <div role="alert" className="image-crop-replace"><span>{t('crop.replace')}</span><Button onClick={() => choose(replacement, true)}>{t('redact.replaceConfirm')}</Button><Button onClick={cancelDraft}>{t('redact.keep')}</Button></div>}
    {original && !ready && !busy && <div className="image-crop-replace"><span>{t('crop.previous')}</span><Button onClick={() => { readyRef.current = true; setReady(true); setStatus('') }}>{t('redact.keep')}</Button></div>}
    <div className="image-crop-viewport" data-launcher-scrollable>
      {original ? <div className="image-crop-stage"><canvas ref={canvas} tabIndex={0} aria-label={t('crop.canvas')} onPointerDown={event => {
        if (!ready || pending.current || event.button !== 0 || !event.isPrimary) return
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        const start = point(event)
        const tolerance = 10 * original.width / event.currentTarget.getBoundingClientRect().width
        const corner = selection && [
          { x: selection.x, y: selection.y }, { x: selection.x + selection.width, y: selection.y },
          { x: selection.x, y: selection.y + selection.height }, { x: selection.x + selection.width, y: selection.y + selection.height },
        ].find(p => Math.hypot(p.x - start.x, p.y - start.y) <= tolerance)
        const moving = !corner && selection && start.x > selection.x && start.x < selection.x + selection.width && start.y > selection.y && start.y < selection.y + selection.height ? selection : undefined
        const anchor = corner && selection ? { x: corner.x === selection.x ? selection.x + selection.width : selection.x, y: corner.y === selection.y ? selection.y + selection.height : selection.y } : start
        drag.current = { start: anchor, pointer: event.pointerId, moving, aspect: selection ? selection.width / selection.height : 1 }; setDragActive(true); setDraft(selection)
      }} onPointerMove={event => {
        if (drag.current?.pointer === event.pointerId) setDraft(dragRect(event))
      }} onPointerUp={event => {
        const active = drag.current
        if (!active || active.pointer !== event.pointerId) return
        const rect = dragRect(event)
        cancelDraft(); if (rect) commit(rect)
      }} onPointerCancel={cancelDraft} onLostPointerCapture={() => { if (drag.current) cancelDraft() }} />{displayed && <span className="image-crop-size" data-crop-rect={JSON.stringify(displayed)} style={{ left: `${(displayed.x + displayed.width) / original.width * 100}%`, top: `${(displayed.y + displayed.height) / original.height * 100}%` }}>{t('crop.dimensions', displayed)}</span>}</div> : <p className="image-crop-empty">{t('crop.empty')}</p>}
    </div>
    <SurfaceError>{status && !['image.busy','image.saved'].includes(status) ? t(status) : null}</SurfaceError>
    <SurfaceStatus>{status === 'image.busy' || status === 'image.saved' ? t(status) : original ? t('crop.hint') : ''}</SurfaceStatus>
    <ActionBar>
      {host.OutputActions && <host.OutputActions disabled={busy || !ready || !selection || dragActive}
        copy={async () => copyPng(host, await exportCrop(original!, selection!, new AbortController().signal))}
        more={[{ id: 'file', label: t('image.chooseFile'), run: () => choose('file') }, { id: 'clipboard', label: t('image.readClipboard'), run: () => choose('clipboard') }, { id: 'clear', label: t('crop.clear'), run: () => commit(null) }, { id: 'save', label: t('image.save'), run: save }]} />}
    </ActionBar>
  </main>
}
