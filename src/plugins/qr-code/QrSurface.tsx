import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, ContextMenu, IconButton, SegmentedControl, Select, TextArea } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
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
  type QrDecodeResult,
  type QrErrorCorrection,
} from './qrCore'

type Mode = 'generate' | 'scan'

function decodeErrorKey(code: Exclude<QrDecodeResult, { ok: true }>['code']): string {
  if (code === 'not-image') return 'error.notImage'
  if (code === 'no-qr') return 'error.noQr'
  if (code === 'empty') return 'error.empty'
  return 'error.decodeFailed'
}

function initialMode(surfaceId: string, initialText?: string): Mode {
  if (surfaceId === 'scan') return 'scan'
  if (initialText && isImageDataUrl(initialText)) return 'scan'
  return 'generate'
}

export function QrSurface(props: PluginSurfaceProps) {
  const { host, t, initialText, surfaceId } = props
  const startMode = initialMode(surfaceId, initialText)
  const initialIsImage = Boolean(initialText && isImageDataUrl(initialText))
  const [mode, setMode] = useState<Mode>(startMode)
  const [text, setText] = useState(startMode === 'generate' && !initialIsImage ? (initialText ?? '') : '')
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
      .catch(() => {
        if (cancelled) return
        setDataUrl('')
        setGenError(t('error.generate'))
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

  const copyText = useCallback(async (value: string, toastKey: string) => {
    if (!value) return
    try {
      await host.clipboard.writeText(value)
      host.showMessage(t(toastKey), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }, [host, t])

  const copyDataUrl = useCallback(async () => {
    if (!dataUrl) return
    await copyText(dataUrl, 'toast.copiedDataUrl')
  }, [copyText, dataUrl])

  const copyImage = useCallback(async () => {
    if (!dataUrl) return
    try {
      const bytes = dataUrlToBytes(dataUrl)
      const ref = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      await host.clipboard.writeImage(ref.blobId)
      host.showMessage(t('toast.copiedImage'), 'success')
      host.complete()
      return
    } catch {
      // Browser / webview path: put a real PNG on the clipboard.
    }
    try {
      await copyPngBlobToClipboard(dataUrlToPngBlob(dataUrl))
      host.showMessage(t('toast.copiedImage'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }, [dataUrl, host, t])

  useEffect(() => {
    if (mode !== 'generate') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return
      const target = event.target as HTMLElement | null
      if (target?.closest('textarea, input, [contenteditable]')) return
      if (!dataUrl) return
      event.preventDefault()
      void copyImage()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [copyImage, dataUrl, mode])

  const saveImage = useCallback(async () => {
    if (!dataUrl || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const result = await saveQrImage(host.storage, dataUrl)
      if (mountedRef.current && result.status === 'saved') host.showMessage(t('toast.saved'), 'success')
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
        {mode === 'generate' ? (
          <Button type="button" variant="primary" disabled={!dataUrl} onClick={() => void copyImage()}>
            {t('action.copyImage')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            disabled={!scanResult}
            onClick={() => void copyText(scanResult, 'toast.copiedText')}
          >
            {t('action.copyText')}
          </Button>
        )}
        <IconButton type="button" label={t('action.close')} onClick={() => {
          scanRef.current?.reset()
          host.close()
        }}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
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
            <ContextMenu
              disabled={!dataUrl}
              trigger={
                <div className="qr-surface__preview">
                  {dataUrl ? (
                    <img src={dataUrl} alt={t('surface.title')} draggable={false} />
                  ) : (
                    <div className={genError ? 'qr-surface__error' : 'qr-surface__placeholder'}>
                      {genError || t('generate.empty')}
                    </div>
                  )}
                </div>
              }
              items={[
                { key: 'copy-image', label: t('action.copyImage'), onSelect: () => void copyImage() },
                { key: 'copy-data-url', label: t('action.copyDataUrl'), onSelect: () => void copyDataUrl() },
                { key: 'save-image', label: t(saving ? 'action.saving' : 'action.saveImage'), onSelect: () => void saveImage() },
              ]}
            />
            <div className="qr-surface__actions">
              <Button type="button" disabled={!dataUrl} onClick={() => void copyDataUrl()}>
                {t('action.copyDataUrl')}
              </Button>
              <Button type="button" disabled={!dataUrl || saving} onClick={() => void saveImage()}>
                {t(saving ? 'action.saving' : 'action.saveImage')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="qr-surface__body">
          <div className="qr-surface__pane">
            <input
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
              <div className="qr-surface__drop-hint">{t(host.clipboard.readImage ? 'scan.nativeHint' : 'scan.hint').replace('{shortcut}', /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V')}</div>
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
            <span className="qr-surface__label">{t('scan.result')}</span>
            {scanError ? (
              <div className="qr-surface__error">{scanError}</div>
            ) : (
              <ContextMenu
                disabled={!scanResult}
                trigger={
                  <pre className="qr-surface__result">
                    {scan.busy ? t('scan.working') : (scanResult || t('scan.drop'))}
                  </pre>
                }
                items={[
                  { key: 'copy-text', label: t('action.copyText'), onSelect: () => void copyText(scanResult, 'toast.copiedText') },
                ]}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
