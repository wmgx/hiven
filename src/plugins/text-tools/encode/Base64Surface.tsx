import { useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, Button, CommandInput, EmptyState, SurfaceError, SurfaceHeaderActions, SurfaceHeaderField, SurfaceStatus, ValueChip } from '@hiven/plugin-ui'
import { base64Decode, base64Encode } from './core'
import { decodeRaster, imageDataUri, inspectRaster, parseImageBase64 } from './imageBase64'

type Result = { text: string; preview?: string; png?: Uint8Array }
type Source = { text: string; image?: Uint8Array; material?: boolean }

export function Base64Surface({ host, t, initialText }: PluginSurfaceProps) {
  const clipboard = useRef(host.clipboard).current
  const [source, setSource] = useState<Source>({ text: initialText ?? '', material: Boolean(initialText) })
  const [direction, setDirection] = useState('auto')
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [copying, setCopying] = useState(false)
  const read = useRef<AbortController | null>(null)
  const work = useRef<AbortController | null>(null)
  const invalidate = () => { read.current?.abort(); work.current?.abort() }
  useEffect(() => {
    const stop = host.deliveryFeedbackOwner?.subscribeInvalidation(invalidate)
    const leave = host.subscribeLeaveIntent?.(invalidate)
    return () => { invalidate(); stop?.(); leave?.() }
  }, [host.deliveryFeedbackOwner, host.subscribeLeaveIntent])
  const readImage = async (ignoreMissing = false) => {
    invalidate()
    const abort = new AbortController(); read.current = abort
    try {
      const image = await clipboard.readImage?.({ signal: abort.signal })
      if (image && !abort.signal.aborted) setSource({ text: '', image: image.bytes })
    } catch (error) {
      if (!abort.signal.aborted && !(ignoreMissing && error instanceof Error && error.name === 'NotReadableError')) setError(t('base64.readFailed'))
    }
  }
  useEffect(() => {
    const abort = new AbortController(); work.current = abort
    setResult(null); setError('')
    void (async () => {
      if (!source.text && !source.image) return
      try {
        let image: ReturnType<typeof parseImageBase64> | undefined
        if (source.image) image = { bytes: source.image, info: inspectRaster(source.image) }
        else if (direction === 'auto') {
          try { image = parseImageBase64(source.text) }
          catch (error) { if (/^data:image\//i.test(source.text.trim())) throw error }
        }
        if (image) {
          const decoded = await decodeRaster(image.bytes, image.info, abort.signal)
          if (!abort.signal.aborted) setResult({ text: imageDataUri(image.bytes, image.info.mime), ...decoded })
        } else {
          let text: string
          if (direction === 'encode') text = base64Encode(source.text)
          else if (direction === 'decode') text = base64Decode(source.text)
          else { try { text = base64Decode(source.text) } catch { text = base64Encode(source.text) } }
          if (!abort.signal.aborted) setResult({ text })
        }
      } catch { if (!abort.signal.aborted) setError(t('base64.invalid')) }
    })()
    return () => abort.abort()
  }, [source, direction, t])
  const copyImage = async () => {
    const signal = work.current?.signal
    if (!result?.png || !signal || signal.aborted || copying || host.deliveryFeedbackOwner?.isCurrent() === false) return
    setCopying(true)
    try {
      const blob = await host.storage.blob.put({ bytes: result.png, contentType: 'image/png', extension: 'png' })
      try {
        if (signal.aborted || host.deliveryFeedbackOwner?.isCurrent() === false) return
        await host.clipboard.writeImage(blob.blobId, { signal })
        if (!signal.aborted) host.showMessage(t('base64.copied'), 'success')
      } finally { await host.storage.blob.delete(blob.blobId) }
    } catch { if (!signal.aborted) setError(t('base64.copyFailed')) }
    finally { setCopying(false) }
  }
  return <section className="base64-surface command-result-surface">
    <SurfaceHeaderField><CommandInput value={source.text} initialMaterial={source.material} placeholder={t('base64.input')}
      onChange={text => { invalidate(); setResult(null); setSource({ text }) }}
      onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') void readImage(true) }} /></SurfaceHeaderField>
    <SurfaceHeaderActions><ValueChip label={t('base64.direction')} value={direction}
      options={['auto', 'encode', 'decode'].map(value => ({ value, label: t(`base64.${value}`) }))}
      onPreview={value => { if (value !== direction) { invalidate(); setDirection(String(value)) } }}
      onChange={value => { if (value !== direction) { invalidate(); setDirection(String(value)) } }} /></SurfaceHeaderActions>
    <SurfaceError>{error}</SurfaceError>
    <div data-command-content className="base64-command-result">
      {result?.preview && <img className="base64-preview" src={result.preview} alt={t('base64.preview')} />}
      {result ? <pre aria-label={t('base64.output')} data-testid="base64-result" tabIndex={0}>{result.text}</pre>
        : !error && <EmptyState title={t('base64.empty')} hint={t('base64.emptyHint')} />}
    </div>
    <SurfaceStatus>{result && t('base64.characters', { count: result.text.length })}</SurfaceStatus>
    <ActionBar>
      {!result && <Button disabled={!clipboard.readImage} onClick={() => void readImage()}>{t('base64.readImage')}<kbd>⌘V</kbd></Button>}
      {host.OutputActions && <host.OutputActions text={result?.text ?? ''} />}
      {result?.png && <Button disabled={copying} onClick={() => void copyImage()}>{t('base64.copyImage')}</Button>}
    </ActionBar>
  </section>
}
