import { useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, TextInput, SurfaceHeaderField, SurfaceStatus, SurfaceError, RowList, ActionBar } from '@hiven/plugin-ui'
import { decodeRaster, inspectRaster } from './raster'
import { saveClipboardPng } from './saveClipboardPng'

type Props = PluginSurfaceProps & { invalidateRef: { current: (() => void) | null } }

/** Reads the clipboard image once, normalizes it to PNG and hands it to the native save chooser. */
export function ImageSavePanel({ host, t, invalidateRef }: Props) {
  const [filename, setFilename] = useState('screenshot.png')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const revision = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const invalidate = () => { revision.current++; controller.current?.abort(); controller.current = null }
  const interrupt = () => {
    invalidate()
    if (pending.current) { setBusy(false); setStatus('') }
  }
  useLayoutEffect(() => {
    const stop = host.deliveryFeedbackOwner?.subscribeInvalidation(interrupt)
    invalidateRef.current = interrupt
    return () => { invalidate(); stop?.(); if (invalidateRef.current === interrupt) invalidateRef.current = null }
  }, [host.deliveryFeedbackOwner, invalidateRef])
  const save = async () => {
    if (pending.current || !host.clipboard.readImage || host.deliveryFeedbackOwner?.isCurrent() === false) return
    invalidate()
    const token = revision.current
    const abort = new AbortController(); controller.current = abort
    const current = () => revision.current === token && !abort.signal.aborted && host.deliveryFeedbackOwner?.isCurrent() !== false
    pending.current = true; setBusy(true); setStatus('image.busy')
    try {
      const image = await host.clipboard.readImage({ signal: abort.signal })
      const decoded = await decodeRaster(image.bytes, inspectRaster(image.bytes, image.contentType), abort.signal)
      if (!current()) return
      const saved = await saveClipboardPng(host.storage, decoded.png, current, filename)
      if (current()) setStatus(saved.status === 'cancelled' ? '' : saved.pathCopied ? 'image.savedPathCopied' : 'image.savedPathCopyFailed')
    } catch (error) {
      if (current()) setStatus(error instanceof Error && error.message === 'size' ? 'image.sizeError' : 'image.saveClipboardFailed')
    } finally {
      pending.current = false
      if (revision.current === token) { setBusy(false); controller.current = null }
    }
  }
  return <main className="image-tools-save" data-launcher-scrollable>
    <SurfaceHeaderField><TextInput value={filename} aria-label={t('image.filename')} data-plugin-surface-autofocus onChange={event => setFilename(event.target.value)} /></SurfaceHeaderField>
    <RowList label={t('image.format')} selectedId="png" onSelect={() => {}} onActivate={() => void save()}
      items={[{ id: 'png', title: 'PNG', description: t('image.saveClipboard'), disabled: busy || !host.clipboard.readImage }]} />
    <SurfaceStatus>{status === 'image.busy' || status.startsWith('image.saved') ? t(status) : ''}</SurfaceStatus>
    <SurfaceError>{status && status !== 'image.busy' && !status.startsWith('image.saved') ? t(status) : null}</SurfaceError>
    <ActionBar>{busy && <Button onClick={interrupt}>{t('image.cancel')}</Button>}{host.OutputActions && <host.OutputActions primaryAction={{ label: t('image.saveClipboard'), run: save, disabled: busy || !host.clipboard.readImage }} />}</ActionBar>
  </main>
}
