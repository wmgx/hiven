import { useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, SegmentedControl, SurfaceHeaderActions, TextArea } from '@hiven/plugin-ui'
import { base64Decode, base64Encode } from './core'
import { decodeRaster, imageDataUri, inspectRaster, parseImageBase64 } from './imageBase64'

type Result = { text: string; preview?: string; png?: Uint8Array }
type Source = { text: string; image?: Uint8Array }

export function Base64Surface({ host, t, initialText }: PluginSurfaceProps) {
  const [source, setSource] = useState<Source>({ text: initialText ?? '' })
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
  useEffect(() => {
    if (initialText) return
    const abort = new AbortController(); read.current = abort
    void (async () => {
      try {
        if (host.clipboard.readImage) {
          try {
            const image = await host.clipboard.readImage({ signal: abort.signal })
            if (!abort.signal.aborted) setSource({ text: '', image: image.bytes })
            return
          } catch (error) {
            // Empty/text-only clipboards have no image; permission and size failures still surface.
            if (error instanceof Error && error.name !== 'NotReadableError') throw error
          }
        }
        const text = await host.clipboard.readText({ signal: abort.signal })
        if (!abort.signal.aborted) setSource({ text })
      } catch { if (!abort.signal.aborted) setError(t('base64.readFailed')) }
    })()
    return () => abort.abort()
  }, [host.clipboard, initialText, t])
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
  return <section className="base64-surface text-tools-converter">
    <SurfaceHeaderActions>{result?.png && <Button disabled={copying} onClick={() => void copyImage()}>{t('base64.copyImage')}</Button>}</SurfaceHeaderActions>
    {!source.image && <SegmentedControl value={direction} options={['auto', 'encode', 'decode'].map(value => ({ value, label: t(`base64.${value}`) }))}
      onChange={value => { invalidate(); setResult(null); setDirection(value) }} />}
    {error && <p role="alert">{error}</p>}
    <div className="text-tools-converter-columns">
      <label>{t('base64.input')}<TextArea aria-label={t('base64.input')} data-launcher-scrollable spellCheck={false} value={source.text}
        onChange={event => { invalidate(); setResult(null); setSource({ text: event.target.value }) }} /></label>
      <label>{t('base64.output')}
        {result?.preview && <img className="base64-preview" src={result.preview} alt={t('base64.preview')} />}
        <TextArea aria-label={t('base64.output')} data-launcher-scrollable readOnly value={result?.text ?? ''} />
      </label>
    </div>
    {host.OutputActions && <host.OutputActions text={result?.text ?? ''} />}
  </section>
}
