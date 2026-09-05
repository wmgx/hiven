import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'

type JsonFormatResult =
  | { ok: true; formatted: string }
  | { ok: false; message: string }

function formatJson(text: string, invalidMessage: string): JsonFormatResult {
  if (!text.trim()) return { ok: true, formatted: '' }
  try {
    return { ok: true, formatted: JSON.stringify(JSON.parse(text), null, 2) }
  } catch {
    return { ok: false, message: invalidMessage }
  }
}

export function JsonSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initialText = props.initialText?.trim()
  const [inputText, setInputText] = useState(initialText ?? '')
  const result = useMemo(() => formatJson(inputText, t('surface.invalid')), [inputText, t])
  const outputText = result.ok ? result.formatted : ''

  const copyOutput = async () => {
    if (!outputText) return
    try {
      await host.clipboard.writeText(outputText)
      host.showMessage(t('toast.copied'), 'success')
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }

  return (
    <section className="json-surface" aria-label={t('surface.title')}>
      <header className="json-surface__header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <div className="json-surface__spacer" />
        <Button type="button" variant="primary" onClick={() => void copyOutput()} disabled={!outputText}>
          {t('action.copy')}
        </Button>
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>
      <div className="json-surface__body">
        <textarea
          className="json-surface__input"
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
          spellCheck={false}
          placeholder={t('surface.inputPlaceholder')}
        />
        <pre className={`json-surface__output ${result.ok ? '' : 'is-error'}`} role={result.ok ? undefined : 'alert'}>
          {result.ok ? result.formatted || t('surface.emptyOutput') : result.message}
        </pre>
      </div>
    </section>
  )
}
