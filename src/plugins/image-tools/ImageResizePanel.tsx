import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { copyPng } from './copyPng'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextInput, SurfaceHeaderField, SurfaceStatus, SurfaceError, ActionBar, RowList, useLocalEscapeLayer } from '@hiven/plugin-ui'
import { MAX_IMAGE_BYTES } from './raster'
import { loadRedactionImage } from './imageRedaction'
import { exportResizedImage, resizeDimensions } from './imageResize'
import './imageCrop.css'

type Props = PluginSurfaceProps & { onDirtyChange(dirty: boolean): void; invalidateRef: { current: (() => void) | null } }
export function ImageResizePanel({ host, t, onDirtyChange, invalidateRef }: Props) {
  const primary = useRef<HTMLButtonElement>(null)
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
  const save = () => {
    if (!readyRef.current || !ready || !original || imageRef.current !== original || stateRef.current.width !== width || !size) return
    void run(async (signal, current) => {
      const bytes = await exportResizedImage(original, width, signal)
      if (!current()) return
      const blob = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      try {
        if (!current()) return
        const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'resized.png' })
        if (current()) { setStatus(saved.status === 'saved' ? 'image.saved' : ''); if (saved.status === 'saved') setDirty(false) }
      } finally { try { await host.storage.blob.delete(blob.blobId) } catch { /* Delivery result takes priority over cleanup. */ } }
    })
  }
  return <main ref={panel} className="image-crop image-resize" tabIndex={-1} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={event => {
      if (event.defaultPrevented || composing.current || event.nativeEvent.isComposing) return
      if ((event.metaKey || event.ctrlKey) && ['o','v'].includes(event.key.toLowerCase())) { event.preventDefault(); choose(event.key.toLowerCase() === 'o' ? 'file' : 'clipboard') }
    }}>
    {!original && <div className="image-crop-empty-actions"><Button autoFocus disabled={busy} onClick={() => choose('file')}>{t('image.chooseFile')} <kbd>⌘O</kbd></Button>
      <Button disabled={busy || !host.clipboard.readImage} onClick={() => choose('clipboard')}>{t('image.readClipboard')} <kbd>⌘V</kbd></Button></div>}
      <TextInput ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void load(async () => { if (selected.size > MAX_IMAGE_BYTES) throw new Error('size'); return { bytes: new Uint8Array(await selected.arrayBuffer()), contentType: selected.type || undefined } })
      }} />
    {replacement && <div role="alert" className="image-crop-replace"><span>{t('resize.replace')}</span><Button onClick={() => choose(replacement, true)}>{t('redact.replaceConfirm')}</Button><Button onClick={cancelReplacement}>{t('redact.keep')}</Button></div>}
    {original && !ready && !busy && <div className="image-crop-replace"><span>{t('resize.previous')}</span><Button onClick={() => { readyRef.current = true; setReady(true); setStatus('') }}>{t('redact.keep')}</Button></div>}
    <SurfaceHeaderField><TextInput aria-label={t('resize.width')} placeholder={t('resize.width')} data-plugin-surface-autofocus type="number" min={1} max={original?.width} step={1} value={width} disabled={busy || !ready || !original} aria-invalid={!!original && !size} onChange={event => {
      if (pending.current) return
      invalidate(); setWidth(event.target.value); setDirty(true); setStatus('')
    }} /></SurfaceHeaderField>
    {original && <RowList label={t('resize.title')} selectedId="result" onSelect={() => {}} onActivate={() => primary.current?.click()}
      items={[{ id: 'result', title: size ? `${original.width} × ${original.height} → ${size.width} × ${size.height}` : t('resize.invalid'), description: t('image.copyImage'), disabled: busy || !size || !ready, icon: <canvas ref={canvas} className="image-resize-thumbnail" aria-label={t('resize.preview')} /> }]} />}
    <SurfaceError>{status && status !== 'image.busy' && status !== 'image.saved' ? t(status) : original && !size ? t('resize.invalid') : null}</SurfaceError>
    <SurfaceStatus>{status === 'image.busy' || status === 'image.saved' ? t(status) : ''}</SurfaceStatus>
    <ActionBar>
      {host.OutputActions && <host.OutputActions primaryRef={primary} disabled={busy || !ready || !size}
        copy={async () => copyPng(host, await exportResizedImage(original!, width, new AbortController().signal))}
        more={[{ id: 'file', label: t('image.chooseFile'), run: () => choose('file') }, { id: 'clipboard', label: t('image.readClipboard'), run: () => choose('clipboard') }, { id: 'save', label: t('image.save'), run: save }]} />}
    </ActionBar>
  </main>
}
