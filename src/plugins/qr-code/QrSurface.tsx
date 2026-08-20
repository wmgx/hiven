import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, SegmentedControl, Select, TextArea } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import {
  DEFAULT_QR_ERROR_LEVEL,
  DEFAULT_QR_SIZE,
  QR_ERROR_LEVELS,
  QR_SIZES,
  copyPngBlobToClipboard,
  dataUrlToBytes,
  dataUrlToPngBlob,
  decodeQrFromBlob,
  decodeQrFromDataUrl,
  generateQrDataUrl,
  isImageDataUrl,
  normalizeQrErrorCorrection,
  normalizeQrSize,
  type QrDecodeResult,
  type QrErrorCorrection,
} from './qrCore'

type Mode = 'generate' | 'scan'

type ContextMenuState = {
  x: number
  y: number
  items: Array<{ id: string; label: string; run: () => void }>
}

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
  const [scanPreview, setScanPreview] = useState(initialIsImage ? initialText ?? '' : '')
  const [scanResult, setScanResult] = useState('')
  const [scanError, setScanError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const applyDecode = useCallback(async (result: QrDecodeResult, previewUrl?: string) => {
    if (previewUrl) setScanPreview(previewUrl)
    if (result.ok) {
      setScanResult(result.text)
      setScanError('')
      return
    }
    setScanResult('')
    setScanError(t(decodeErrorKey(result.code)))
  }, [t])

  const decodeBlob = useCallback(async (blob: Blob, previewUrl?: string) => {
    setBusy(true)
    try {
      const localPreview = previewUrl ?? URL.createObjectURL(blob)
      const result = await decodeQrFromBlob(blob)
      await applyDecode(result, localPreview)
    } finally {
      setBusy(false)
    }
  }, [applyDecode])

  useEffect(() => {
    if (!initialIsImage || !initialText) return
    void decodeQrFromDataUrl(initialText).then((result) => applyDecode(result, initialText))
  }, [applyDecode, initialIsImage, initialText])

  const onPaste = useCallback((event: ClipboardEvent) => {
    if (mode !== 'scan') return
    const items = event.clipboardData?.items
    if (!items) return
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file) continue
      event.preventDefault()
      void decodeBlob(file)
      return
    }
    const pasted = event.clipboardData?.getData('text/plain') ?? ''
    if (isImageDataUrl(pasted)) {
      event.preventDefault()
      void decodeQrFromDataUrl(pasted).then((result) => applyDecode(result, pasted.trim()))
    }
  }, [applyDecode, decodeBlob, mode])

  useEffect(() => {
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onPaste])

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) void decodeBlob(file)
  }, [decodeBlob])

  const closeMenu = useCallback(() => setMenu(null), [])

  const copyText = useCallback(async (value: string, toastKey: string) => {
    if (!value) return
    try {
      await host.clipboard.writeText(value)
      host.showMessage(t(toastKey), 'success')
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }, [host, t])

  const copyBase64 = useCallback(async () => {
    if (!dataUrl) return
    await copyText(dataUrl, 'toast.copiedBase64')
  }, [copyText, dataUrl])

  const copyImage = useCallback(async () => {
    if (!dataUrl) return
    try {
      const bytes = dataUrlToBytes(dataUrl)
      const ref = await host.storage.blob.put({ bytes, contentType: 'image/png', extension: 'png' })
      await host.clipboard.writeImage(ref.blobId)
      host.showMessage(t('toast.copiedImage'), 'success')
      return
    } catch {
      // Browser / webview path: put a real PNG on the clipboard.
    }
    try {
      await copyPngBlobToClipboard(dataUrlToPngBlob(dataUrl))
      host.showMessage(t('toast.copiedImage'), 'success')
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

  const downloadImage = useCallback(() => {
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'qr-code.png'
    link.click()
    host.showMessage(t('toast.downloaded'), 'success')
  }, [dataUrl, host, t])

  const openQrMenu = useCallback((event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }) => {
    if (!dataUrl) return
    event.preventDefault()
    event.stopPropagation()
    const width = 168
    const height = 120
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - width),
      y: Math.min(event.clientY, window.innerHeight - height),
      items: [
        { id: 'copy-image', label: t('action.copyImage'), run: () => void copyImage() },
        { id: 'copy-base64', label: t('action.copyBase64'), run: () => void copyBase64() },
        { id: 'download', label: t('action.download'), run: downloadImage },
      ],
    })
  }, [copyBase64, copyImage, dataUrl, downloadImage, t])

  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMenu, menu])

  return (
    <section className="qr-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="qr-surface__header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <span className="qr-surface__crumb">{t('surface.title')}</span>
        <SegmentedControl
          aria-label={t('surface.title')}
          value={mode}
          onChange={(next) => setMode(next as Mode)}
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
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
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
            <div className="qr-surface__preview" onContextMenu={openQrMenu}>
              {dataUrl ? (
                <img src={dataUrl} alt={t('surface.title')} draggable={false} />
              ) : (
                <div className={genError ? 'qr-surface__error' : 'qr-surface__placeholder'}>
                  {genError || t('generate.empty')}
                </div>
              )}
            </div>
            <div className="qr-surface__actions">
              <Button type="button" disabled={!dataUrl} onClick={() => void copyBase64()}>
                {t('action.copyBase64')}
              </Button>
              <Button type="button" disabled={!dataUrl} onClick={downloadImage}>
                {t('action.download')}
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
              <div className="qr-surface__drop-hint">{t('scan.hint')}</div>
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
              <pre
                className="qr-surface__result"
                onContextMenu={(event) => {
                  if (!scanResult) return
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({
                    x: Math.min(event.clientX, window.innerWidth - 168),
                    y: Math.min(event.clientY, window.innerHeight - 56),
                    items: [
                      { id: 'copy-text', label: t('action.copyText'), run: () => void copyText(scanResult, 'toast.copiedText') },
                    ],
                  })
                }}
              >
                {busy ? t('scan.working') : (scanResult || t('scan.drop'))}
              </pre>
            )}
          </div>
        </div>
      )}
      {menu ? (
        <div
          ref={menuRef}
          className="qr-surface__menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
                item.run()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
