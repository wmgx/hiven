import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, SegmentedControl, Select, TextArea, TextInput } from '@hiven/plugin-ui'
import { BackIcon } from '@hiven/plugin-ui/icons'
import { saveQrImage } from './saveQrImage'
import { createQrPasteHandlers } from './qrPaste'
import { createQrScanSession, EMPTY_QR_SCAN } from './qrScanSession'
import {
  DEFAULT_QR_ERROR_LEVEL,
  DEFAULT_QR_SIZE,
  QR_ERROR_LEVELS,
  QR_SIZES,
  copyPngBlobToClipboard,
  dataUrlToBytes,
  dataUrlToPngBlob,
  generateQrDataUrl,
  isImageDataUrl,
  normalizeQrErrorCorrection,
  normalizeQrSize,
  QR_TOO_LONG,
  decodeErrorKey,
  type QrErrorCorrection,
} from './qrCore'

type Mode = 'generate' | 'scan'

function initialMode(surfaceId: string, initialText?: string): Mode {
  if (surfaceId === 'scan') return 'scan'
  if (initialText && isImageDataUrl(initialText)) return 'scan'
  return 'generate'
}

export function QrSurface(props: PluginSurfaceProps) {
  const { host, t, initialText, surfaceId } = props
  const startMode = initialMode(surfaceId, initialText)
  const initialIsImage = Boolean(initialText && isImageDataUrl(initialText))
  const baselineText = useRef(startMode === 'generate' && !initialIsImage ? (initialText ?? '') : '')
  const [mode, setMode] = useState<Mode>(startMode)
  const [text, setText] = useState(baselineText.current)
  const [ecc, setEcc] = useState<QrErrorCorrection>(DEFAULT_QR_ERROR_LEVEL)
  const [size, setSize] = useState(DEFAULT_QR_SIZE)
  const [dataUrl, setDataUrl] = useState('')
  const [genError, setGenError] = useState('')
  const [scan, setScan] = useState(EMPTY_QR_SCAN)
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const mountedRef = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef<ReturnType<typeof createQrScanSession> | null>(null)
  const hostRef = useRef(host)
  hostRef.current = host
  const scanPreview = scan.previewUrl
  const scanResult = scan.result?.ok ? scan.result.text : ''
  const scanError = scan.clipboardError ? t('error.clipboardRead') : scan.result?.ok === false ? t(decodeErrorKey(scan.result.code)) : ''

  useEffect(() => {
    mountedRef.current = true
    const session = createQrScanSession(setScan)
    scanRef.current = session
    return () => {
      mountedRef.current = false
      session.dispose()
      scanRef.current = null
    }
  }, [])

  useEffect(() => {
    const payload = text.trim()
    if (!payload) {
      setDataUrl('')
      setGenError('')
      return
    }
    let cancelled = false
    void generateQrDataUrl(payload, { errorCorrection: ecc, size })
      .then((url) => {
        if (cancelled) return
        setDataUrl(url)
        setGenError('')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDataUrl('')
        setGenError(t(error instanceof Error && error.message === QR_TOO_LONG ? 'error.tooLong' : 'error.generate'))
      })
    return () => {
      cancelled = true
    }
  }, [ecc, size, t, text])

  const decodeBlob = useCallback((blob: Blob) => scanRef.current?.blob(blob), [])

  useEffect(() => {
    if (mode === 'scan' && initialIsImage && initialText) void scanRef.current?.dataUrl(initialText)
    return () => scanRef.current?.reset()
  }, [initialIsImage, initialText, mode])

  useEffect(() => {
    if (mode !== 'scan') return
    const handlers = createQrPasteHandlers({
      nativeAvailable: () => typeof hostRef.current.clipboard.readImage === 'function',
      native: () => { void scanRef.current?.clipboard(() => hostRef.current.clipboard) },
      blob: (blob) => { void decodeBlob(blob) },
      dataUrl: (value) => { void scanRef.current?.dataUrl(value) },
      unreadable: () => scanRef.current?.unreadableClipboard(),
    })
    window.addEventListener('keydown', handlers.keydown)
    window.addEventListener('keyup', handlers.keyup)
    window.addEventListener('paste', handlers.paste)
    window.addEventListener('compositionstart', handlers.compositionstart)
    window.addEventListener('compositionend', handlers.compositionend)
    window.addEventListener('blur', handlers.blur)
    return () => {
      window.removeEventListener('keydown', handlers.keydown)
      window.removeEventListener('keyup', handlers.keyup)
      window.removeEventListener('paste', handlers.paste)
      window.removeEventListener('compositionstart', handlers.compositionstart)
      window.removeEventListener('compositionend', handlers.compositionend)
      window.removeEventListener('blur', handlers.blur)
    }
  }, [decodeBlob, mode])

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) void decodeBlob(file)
  }, [decodeBlob])

  // Throws on failure; OutputActions reports the result and completes the surface.
  const writeImage = useCallback(async () => {
    if (!dataUrl) throw new Error('empty')
    try {
      const bytes = dataUrlToBytes(dataUrl)
      const ref = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      await host.clipboard.writeImage(ref.blobId)
    } catch {
      // Browser / webview path: put a real PNG on the clipboard.
      await copyPngBlobToClipboard(dataUrlToPngBlob(dataUrl))
    }
  }, [dataUrl, host])

  const saveImage = useCallback(async () => {
    if (!dataUrl || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await saveQrImage(host.storage, dataUrl)
    } catch (error) {
      if (mountedRef.current) {
        host.showMessage(t(error instanceof Error && error.name === 'NotSupportedError' ? 'toast.saveUnavailable' : 'toast.saveFailed'), 'error')
      }
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }, [dataUrl, host, t])

  return (
    <section className="qr-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="qr-surface__header">
        <IconButton type="button" label={t('action.back')} onClick={() => {
          scanRef.current?.reset()
          host.requestBack()
        }}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <span className="qr-surface__crumb">{t('surface.title')}</span>
        <SegmentedControl
          aria-label={t('surface.title')}
          value={mode}
          onChange={(next) => {
            if (next === mode) return
            scanRef.current?.reset()
            setMode(next as Mode)
          }}
          options={[
            { value: 'generate', label: t('mode.generate') },
            { value: 'scan', label: t('mode.scan') },
          ]}
        />
        <div className="qr-surface__header-spacer" />
        {host.OutputActions && (mode === 'generate'
          ? <host.OutputActions copy={writeImage} disabled={!dataUrl} more={[
            { id: 'copy-data-url', label: t('action.copyDataUrl'), run: () => host.clipboard.writeText(dataUrl) },
            { id: 'save-image', label: t(saving ? 'action.saving' : 'action.saveImage'), run: saveImage },
          ]} />
          : <host.OutputActions text={scan.busy ? '' : scanResult} />)}
      </header>

      {mode === 'generate' ? (
        <div className="qr-surface__body">
          <div className="qr-surface__pane">
            <div className="qr-surface__toolbar">
              <span className="qr-surface__label">{t('param.ecc')}</span>
              <Select
                aria-label={t('param.ecc')}
                value={ecc}
                options={QR_ERROR_LEVELS.map((level) => ({ value: level, label: t(`ecc.${level}`) }))}
                onChange={(event) => setEcc(normalizeQrErrorCorrection(event.target.value))}
              />
              <span className="qr-surface__label">{t('param.size')}</span>
              <Select
                aria-label={t('param.size')}
                value={String(size)}
                options={QR_SIZES.map((value) => ({
                  value: String(value),
                  label: t(`param.size.option.${value}`),
                }))}
                onChange={(event) => setSize(normalizeQrSize(event.target.value))}
              />
            </div>
            <TextArea
              className="qr-surface__input"
              value={text}
              spellCheck={false}
              placeholder={t('generate.placeholder')}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="qr-surface__pane qr-surface__pane--preview">
            <div className="qr-surface__preview">
              {dataUrl ? (
                <img src={dataUrl} alt={t('surface.title')} draggable={false} />
              ) : (
                <div className={genError ? 'qr-surface__error' : 'qr-surface__placeholder'}>
                  {genError || t('generate.empty')}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="qr-surface__body">
          <div className="qr-surface__pane">
            <TextInput
              ref={fileRef}
              className="qr-surface__file"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void decodeBlob(file)
                event.target.value = ''
              }}
            />
            <div
              className={`qr-surface__drop${dragOver ? ' is-active' : ''}`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
            >
              {scanPreview ? <img src={scanPreview} alt={t('mode.scan')} /> : null}
              <div className="qr-surface__drop-title">{t('scan.drop')}</div>
              <Button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  fileRef.current?.click()
                }}
              >
                {t('action.chooseImage')}
              </Button>
            </div>
          </div>
          <div className="qr-surface__pane qr-surface__pane--preview">
            <div className="qr-surface__toolbar">
              <span className="qr-surface__label">{t('scan.result')}</span>
            </div>
            {scanError ? (
              <div className="qr-surface__error">{scanError}</div>
            ) : (
              <pre className="qr-surface__result">
                {scan.busy ? t('scan.working') : (scanResult || t('scan.drop'))}
              </pre>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
