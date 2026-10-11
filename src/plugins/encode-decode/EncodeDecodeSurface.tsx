import { ImageBase64Panel } from './ImageBase64Panel'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, useToolDeliveryFeedback } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { ClipboardPaste, CornerDownLeft } from 'lucide-react'
import {
  hasEscapeSequences,
  hasHtmlEntities,
  isBase64,
  isJwt,
  isUrlEncoded,
  transformText,
  type EncodeDecodeDirection,
  type EncodeDecodeFormat,
} from './core'

const FORMATS: EncodeDecodeFormat[] = ['base64', 'url', 'html', 'slashes', 'jwt']

function initialOperation(text: string, surfaceId: string): { format: EncodeDecodeFormat; direction: EncodeDecodeDirection } {
  const [format, operation] = surfaceId.split('-')
  if (FORMATS.includes(format as EncodeDecodeFormat) && (operation === 'encode' || operation === 'decode')) {
    return { format: format as EncodeDecodeFormat, direction: operation }
  }
  if (isJwt(text)) return { format: 'jwt', direction: 'decode' }
  if (isBase64(text)) return { format: 'base64', direction: 'decode' }
  if (isUrlEncoded(text)) return { format: 'url', direction: 'decode' }
  if (hasHtmlEntities(text)) return { format: 'html', direction: 'decode' }
  if (hasEscapeSequences(text)) return { format: 'slashes', direction: 'decode' }
  return { format: 'base64', direction: 'encode' }
}

export function EncodeDecodeSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initialText = props.initialText ?? ''
  const [initial] = useState(() => initialOperation(initialText, props.surfaceId))
  const [inputText, setInputText] = useState(initialText)
  const baseline = useRef(initialText)
  const hasUnsavedChanges = inputText !== baseline.current
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, reportUnsavedChanges])
  const [imageMode, setImageMode] = useState(props.surfaceId === 'image-base64')
  const [format, setFormat] = useState<EncodeDecodeFormat>(initial.format)
  const [direction, setDirection] = useState<EncodeDecodeDirection>(initial.direction)
  const [busy, setBusy] = useState<'copy' | 'paste' | 'return' | null>(null)
  const pendingRef = useRef<{ action: 'copy' | 'paste' | 'return'; controller: AbortController } | null>(null)
  const result = useMemo(() => {
    if (!inputText) return { ok: true as const, output: '' }
    try {
      return { ok: true as const, output: transformText(format, direction, inputText) }
    } catch {
      return { ok: false as const, output: '' }
    }
  }, [direction, format, inputText])
  const hasOutput = result.ok && inputText.length > 0
  const useAsInputDescription = t('action.useAsInputDescription', {
    format: t(`format.${format}`),
    direction: t(`direction.${direction === 'encode' ? 'decode' : 'encode'}`),
  })

  const chooseFormat = (nextFormat: EncodeDecodeFormat) => {
    update(() => {
      setImageMode(false)
      setFormat(nextFormat)
      if (nextFormat === 'jwt') setDirection('decode')
    })
  }

  const useOutputAsInput = () => {
    if (!hasOutput) return
    update(() => {
      setInputText(result.output)
      if (format !== 'jwt') setDirection(direction === 'encode' ? 'decode' : 'encode')
    })
  }

  const delivery = useToolDeliveryFeedback(result, host.deliveryFeedbackOwner)

  useLayoutEffect(() => () => {
    pendingRef.current?.controller.abort()
    pendingRef.current = null
  }, [])

  const update = (change: () => void) => {
    delivery.invalidate()
    pendingRef.current?.controller.abort()
    // Keep an issued clipboard/paste write locked until it settles.
    if (pendingRef.current?.action === 'return') {
      pendingRef.current = null
      setBusy(null)
    }
    change()
  }

  const deliver = async (action: 'copy' | 'paste' | 'return') => {
    if (!hasOutput || pendingRef.current) return
    const attempt = delivery.beginAttempt()
    if (!attempt.isCurrent()) return
    const submission = { action, controller: new AbortController() }
    pendingRef.current = submission
    setBusy(action)
    const isCurrent = () => pendingRef.current === submission
      && !submission.controller.signal.aborted && attempt.isCurrent()
    const release = () => {
      if (pendingRef.current !== submission) return
      pendingRef.current = null
      setBusy(null)
    }
    try {
      if (action === 'return') {
        const accepted = await host.returnToLauncherWithObject(
          { kind: 'text', text: result.output, source: 'tool-result' },
          { signal: submission.controller.signal },
        )
        if (!isCurrent()) return
        if (accepted === false) release()
        return accepted
      }
      if (action === 'copy') {
        await host.clipboard.writeText(result.output)
        if (!isCurrent()) return
        delivery.invalidate()
        host.showMessage(t('toast.copied'), 'success')
        host.complete()
      } else {
        const delivered = await host.paste.pasteText(result.output)
        if (!isCurrent()) return
        attempt.reportPaste(delivered)
        if (delivered.ok) host.complete()
      }
    } catch {
      if (isCurrent()) {
        attempt.reportError(t(action === 'copy' ? 'toast.copyFailed' : action === 'paste' ? 'toast.pasteFailed' : 'toast.returnFailed'))
        release()
      }
    } finally {
      release()
    }
  }

  return (
    <section className="encode-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="encode-header">
        <IconButton type="button" label={t('action.back')} onClick={() => update(() => host.requestBack())}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => update(() => host.close())}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <nav className="encode-formats" aria-label={t('format.label')}>
        {FORMATS.map((item) => (
          <button
            key={item}
            type="button"
            className={!imageMode && item === format ? 'is-active' : ''}
            aria-pressed={!imageMode && item === format}
            onClick={() => chooseFormat(item)}
          >
            {t(`format.${item}`)}
          </button>
        ))}
        <button type="button" className={imageMode ? 'is-active' : ''} aria-pressed={imageMode} onClick={() => update(() => setImageMode(true))}>{t('image.title')}</button>
      </nav>

      {imageMode ? <ImageBase64Panel {...props} /> : <>
      <nav className="encode-directions" aria-label={t('direction.label')}>
        {(format === 'jwt' ? ['decode'] : ['encode', 'decode']).map((item) => (
          <button
            key={item}
            type="button"
            className={item === direction ? 'is-active' : ''}
            aria-pressed={item === direction}
            onClick={() => update(() => setDirection(item as EncodeDecodeDirection))}
          >
            {t(`direction.${item}`)}
          </button>
        ))}
      </nav>

      <main className="encode-editors">
        <section className="encode-pane">
          <div className="encode-pane-header">
            <strong>{t('pane.input')}</strong>
            <Button type="button" variant="ghost" disabled={!inputText} onClick={() => update(() => setInputText(''))}>
              {t('action.clear')}
            </Button>
          </div>
          <textarea
            data-plugin-surface-autofocus
            data-launcher-scrollable
            value={inputText}
            aria-label={t('pane.input')}
            placeholder={t('surface.inputPlaceholder')}
            spellCheck={false}
            onChange={(event) => update(() => setInputText(event.currentTarget.value))}
          />
        </section>

        <section className="encode-pane encode-pane-output">
          <div className="encode-pane-header">
            <strong>{t('pane.output')}</strong>
            <div className="encode-pane-actions">
              {format !== 'jwt' ? (
                <Button type="button" variant="ghost" title={useAsInputDescription} aria-label={useAsInputDescription} disabled={!hasOutput || busy !== null} onClick={useOutputAsInput}>
                  {t('action.useAsInput')}
                </Button>
              ) : null}
              <Button type="button" variant="ghost" title={t('action.continueProcessingDescription')} aria-label={t('action.continueProcessingDescription')} disabled={!hasOutput || busy !== null} onClick={() => deliver('return')}>
                <CornerDownLeft size={14} aria-hidden="true" />
                {t('action.continueProcessing')}
              </Button>
              <Button type="button" variant="ghost" title={t('action.pasteBackDescription')} aria-label={t('action.pasteBackDescription')} disabled={!hasOutput || busy !== null} onClick={() => void deliver('paste')}>
                <ClipboardPaste size={14} aria-hidden="true" />
                {t('action.pasteBack')}
              </Button>
              <Button type="button" title={t('action.copyDescription')} aria-label={t('action.copyDescription')} disabled={!hasOutput || busy !== null} onClick={() => void deliver('copy')}>
                {t('action.copy')}
              </Button>
            </div>
          </div>
          <div className="encode-output-wrap">
            <textarea
              data-launcher-scrollable
              value={result.output}
              aria-label={t('pane.output')}
              placeholder={result.ok ? t('surface.outputPlaceholder') : ''}
              readOnly
              spellCheck={false}
            />
            {!result.ok ? <div className="encode-error" role="alert">{t('error.invalid')}</div> : null}
          </div>
        </section>
      </main>

      <footer className={`encode-status${delivery.feedback ? ' has-delivery' : ''}`} aria-live="polite">
        <span>{t('meta.characters', { count: inputText.length })}</span>
        <span className={delivery.feedback ? `is-${delivery.feedback.tone}` : !result.ok ? 'is-error' : ''} role="status">
          {delivery.feedback?.message ?? (!result.ok ? t('status.error') : format === 'url' ? t(`hint.url.${direction}`) : hasOutput ? t('status.ready') : t('status.waiting'))}
        </span>
        <span>{t('meta.characters', { count: result.output.length })}</span>
      </footer>
      </>}
    </section>
  )
}
