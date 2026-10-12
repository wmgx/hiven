import { useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button } from '@hiven/plugin-ui'
import { saveClipboardPng } from './saveClipboardPng'
import { decodeRaster, imageDataUri, inspectRaster, MAX_IMAGE_BYTES, parseImageBase64 } from './imageBase64'

type Result = { uri: string; preview: string; png: Uint8Array; width: number; height: number }
type ImagePanelProps = PluginSurfaceProps & {
  active: boolean
  saveFocused: boolean
  onShowWorkbench(): void
  onDirtyChange(dirty: boolean): void
  invalidateRef: { current: (() => void) | null }
}
export function ImageBase64Panel({ host, t, initialText, active, saveFocused, onShowWorkbench, onDirtyChange, invalidateRef }: ImagePanelProps) {
  const [text, setText] = useState(initialText ?? '')
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const activeRef = useRef(active)
  activeRef.current = active
  const revision = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const file = useRef<HTMLInputElement>(null)
  const invalidate = () => { revision.current++; controller.current?.abort(); controller.current = null }
  useLayoutEffect(() => {
    const stop = host.deliveryFeedbackOwner?.subscribeInvalidation(() => {
      invalidate()
      if (pending.current) { setBusy(false); setStatus('image.cancelled') }
    })
    return () => { invalidate(); stop?.() }
  }, [host.deliveryFeedbackOwner])
  useLayoutEffect(() => { onDirtyChange(text !== (initialText ?? '')) }, [text, initialText, onDirtyChange])
  useLayoutEffect(() => {
    const interrupt = () => {
      invalidate()
      if (pending.current) { setBusy(false); setStatus('image.cancelled') }
    }
    invalidateRef.current = interrupt
    return () => { if (invalidateRef.current === interrupt) invalidateRef.current = null }
  }, [invalidateRef])
  const run = async (operation: (signal: AbortSignal, current: () => boolean) => Promise<string>) => {
    if (!activeRef.current || pending.current || host.deliveryFeedbackOwner?.isCurrent() === false) return
    invalidate()
    const token = revision.current
    const abort = new AbortController(); controller.current = abort
    const current = () => activeRef.current && revision.current === token && !abort.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    pending.current = true; setBusy(true); setStatus('image.busy')
    try { const next = await operation(abort.signal, current); if (current()) setStatus(next) }
    catch (error) { if (current()) setStatus(error instanceof Error && error.message === 'size' ? 'image.sizeError' : 'image.error') }
    finally { pending.current = false; if (revision.current === token) { setBusy(false); controller.current = null } }
  }
  const load = async (bytes: Uint8Array, signal: AbortSignal, current: () => boolean, declaredMime?: string) => {
    const info = inspectRaster(bytes, declaredMime)
    const decoded = await decodeRaster(bytes, info, signal)
    if (current()) setResult({ ...decoded, uri: imageDataUri(bytes, info.mime), width: info.width, height: info.height })
    return 'image.ready'
  }
  const deliver = (action: 'uri' | 'copy' | 'save') => run(async (_signal, current) => {
    if (!result) return ''
    if (action === 'uri') { await host.clipboard.writeText(result.uri); return 'image.copied' }
    const blob = await host.storage.blob.put({ bytes: result.png, contentType: 'image/png', extension: 'png' })
    try {
      if (!current()) return 'image.cancelled'
      if (action === 'copy') { await host.clipboard.writeImage(blob.blobId); return 'image.copied' }
      const saved = await host.storage.blob.savePng(blob.blobId, { suggestedFilename: 'image.png' })
      return saved.status === 'saved' ? 'image.saved' : 'image.cancelled'
    } finally { await host.storage.blob.delete(blob.blobId) }
  })
  return <main className="image-base64-panel" hidden={!active} data-launcher-scrollable>
    {saveFocused && <p>{t('image.saveTaskHint')}</p>}
    <div className="image-base64-actions">
      {!saveFocused && <Button disabled={busy || !host.clipboard.readImage} onClick={() => void run(async (signal, current) => {
        const image = await host.clipboard.readImage!({ signal }); return load(image.bytes, signal, current, image.contentType)
      })}>{t('image.readClipboard')}</Button>}
      <Button variant={saveFocused ? 'primary' : undefined} autoFocus={saveFocused} disabled={busy || !host.clipboard.readImage} onClick={() => void run(async (signal, current) => {
        const image = await host.clipboard.readImage!({ signal })
        const info = inspectRaster(image.bytes, image.contentType)
        const decoded = await decodeRaster(image.bytes, info, signal)
        if (!current()) return 'image.cancelled'
        try {
          const saved = await saveClipboardPng(host.storage, decoded.png, current)
          if (saved.status === 'cancelled') return 'image.saveClipboardCancelled'
          return saved.pathCopied ? 'image.savedPathCopied' : 'image.savedPathCopyFailed'
        } catch { return 'image.saveClipboardFailed' }
      })}>{t('image.saveClipboard')}</Button>
      {!saveFocused && <Button disabled={busy} onClick={() => file.current?.click()}>{t('image.chooseFile')}</Button>}
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => {
        const selected = event.currentTarget.files?.[0]; event.currentTarget.value = ''
        if (selected) void run(async (signal, current) => {
          if (selected.size > MAX_IMAGE_BYTES) throw new Error('size')
          return load(new Uint8Array(await selected.arrayBuffer()), signal, current, selected.type || undefined)
        })
      }} />
    </div>
    {!saveFocused && <><label className="image-base64-input">{t('image.input')}<textarea data-launcher-scrollable value={text} spellCheck={false} onChange={(event) => {
      invalidate(); setText(event.currentTarget.value); setResult(null); setBusy(false); setStatus('')
    }} /></label>
    <div className="image-base64-actions">
      <Button disabled={busy || !text.trim()} onClick={() => void run(async (signal, current) => {
        const parsed = parseImageBase64(text); return load(parsed.bytes, signal, current, parsed.info.mime)
      })}>{t('image.decode')}</Button>
      {busy && <Button onClick={() => { invalidate(); setBusy(false); setStatus('image.cancelled') }}>{t('image.cancel')}</Button>}
    </div>
    {result && <>
      <div className="image-base64-preview"><img src={result.preview} alt={t('image.preview')} /><span>{t('image.dimensions', { width: result.width, height: result.height })}</span></div>
      <label className="image-base64-input">{t('image.output')}<textarea readOnly data-launcher-scrollable value={result.uri} spellCheck={false} /></label>
      <div className="image-base64-actions">
        <Button disabled={busy} onClick={() => void deliver('uri')}>{t('image.copyUri')}</Button>
        <Button disabled={busy} onClick={() => void deliver('copy')}>{t('image.copyImage')}</Button>
        <Button disabled={busy} onClick={() => void deliver('save')}>{t('image.save')}</Button>
      </div>
    </>}
    </>}
    {saveFocused && busy && <Button onClick={() => { invalidate(); setBusy(false); setStatus('image.cancelled') }}>{t('image.cancel')}</Button>}
    {status && <p role="status" aria-live="polite">{t(status)}</p>}
    <details><summary>{t('image.limits')}</summary><p>{t('image.hint')}</p></details>
    {saveFocused && <Button variant="ghost" onClick={onShowWorkbench}>{t('image.openWorkbench')}</Button>}
  </main>
}
