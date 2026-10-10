import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton } from '@hiven/plugin-ui'
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
  const [format, setFormat] = useState<EncodeDecodeFormat>(initial.format)
  const [direction, setDirection] = useState<EncodeDecodeDirection>(initial.direction)
  const [pasting, setPasting] = useState(false)
  const result = useMemo(() => {
    if (!inputText) return { ok: true as const, output: '' }
    try {
      return { ok: true as const, output: transformText(format, direction, inputText) }
    } catch {
      return { ok: false as const, output: '' }
    }
  }, [direction, format, inputText])
  const hasOutput = result.ok && inputText.length > 0

  const chooseFormat = (nextFormat: EncodeDecodeFormat) => {
    setFormat(nextFormat)
    if (nextFormat === 'jwt') setDirection('decode')
  }

  const useOutputAsInput = () => {
    if (!hasOutput) return
    setInputText(result.output)
    if (format !== 'jwt') setDirection(direction === 'encode' ? 'decode' : 'encode')
  }

  const copyOutput = async () => {
    if (!hasOutput) return
    try {
      await host.clipboard.writeText(result.output)
      host.showMessage(t('toast.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }

  const pasteOutput = async () => {
    if (!hasOutput || pasting) return
    setPasting(true)
    try {
      const pasteResult = await host.paste.pasteText(result.output)
      if (!pasteResult.ok && !pasteResult.message) return
      if (pasteResult.ok) {
        host.complete()
      } else if (pasteResult.fallback === 'copied') {
        host.showMessage(pasteResult.message, 'info')
      } else {
        host.showMessage(pasteResult.message || t('toast.pasteFailed'), 'error')
      }
    } catch {
      host.showMessage(t('toast.pasteFailed'), 'error')
    } finally {
      setPasting(false)
    }
  }

  return (
    <section className="encode-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="encode-header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <nav className="encode-formats" aria-label={t('format.label')}>
        {FORMATS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === format ? 'is-active' : ''}
            aria-pressed={item === format}
            onClick={() => chooseFormat(item)}
          >
            {t(`format.${item}`)}
          </button>
        ))}
      </nav>

      <nav className="encode-directions" aria-label={t('direction.label')}>
        {(format === 'jwt' ? ['decode'] : ['encode', 'decode']).map((item) => (
          <button
            key={item}
            type="button"
            className={item === direction ? 'is-active' : ''}
            aria-pressed={item === direction}
            onClick={() => setDirection(item as EncodeDecodeDirection)}
          >
            {t(`direction.${item}`)}
          </button>
        ))}
      </nav>

      <main className="encode-editors">
        <section className="encode-pane">
          <div className="encode-pane-header">
            <strong>{t('pane.input')}</strong>
            <Button type="button" variant="ghost" disabled={!inputText} onClick={() => setInputText('')}>
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
            onChange={(event) => setInputText(event.currentTarget.value)}
          />
        </section>

        <section className="encode-pane encode-pane-output">
          <div className="encode-pane-header">
            <strong>{t('pane.output')}</strong>
            <div className="encode-pane-actions">
              {format !== 'jwt' ? (
                <Button type="button" variant="ghost" disabled={!hasOutput || pasting} onClick={useOutputAsInput}>
                  {t('action.useAsInput')}
                </Button>
              ) : null}
              <IconButton type="button" label={t('action.continueProcessing')} disabled={!hasOutput || pasting} onClick={() => host.returnToLauncherWithObject({ kind: 'text', text: result.output, source: 'tool-result' })}>
                <CornerDownLeft size={14} />
              </IconButton>
              <IconButton type="button" label={t('action.pasteBack')} disabled={!hasOutput || pasting} onClick={() => void pasteOutput()}>
                <ClipboardPaste size={14} />
              </IconButton>
              <Button type="button" disabled={!hasOutput || pasting} onClick={() => void copyOutput()}>
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

      <footer className="encode-status" aria-live="polite">
        <span>{t('meta.characters', { count: inputText.length })}</span>
        <span className={!result.ok ? 'is-error' : ''}>
          {!result.ok ? t('status.error') : format === 'url' ? t(`hint.url.${direction}`) : hasOutput ? t('status.ready') : t('status.waiting')}
        </span>
        <span>{t('meta.characters', { count: result.output.length })}</span>
      </footer>
    </section>
  )
}
