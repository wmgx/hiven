import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, SurfaceHeaderField, SurfaceError, TextArea, TextInput } from '@hiven/plugin-ui'
import { evaluateJsonExpression, isJson, JsonCoreError } from './jsonCore'

export function JsonExpressionSurface({ host, t, initialText }: PluginSurfaceProps) {
  const clipboard = useRef(host.clipboard).current
  const [text, setText] = useState(initialText ?? '')
  const [expression, setExpression] = useState('')
  useEffect(() => {
    let current = true
    if (!initialText) void clipboard.readText().then(value => {
      if (current && isJson(value)) setText(previous => previous || value)
    }).catch(() => { if (current) host.showMessage(t('expression.readFailed'), 'error') })
    return () => { current = false }
  }, [clipboard, initialText])
  const result = useMemo(() => {
    if (!text.trim() || !expression.trim()) return { output: '', error: '' }
    // Keep the existing expression syntax; expressions are entered by the user, never read from the clipboard.
    try { return { output: evaluateJsonExpression(text, expression), error: '' } }
    catch (error) { return { output: '', error: t(error instanceof JsonCoreError ? `error.${error.code}` : 'error.expression') } }
  }, [text, expression, t])
  return <section className="json-expression-surface text-tools-converter">
    <SurfaceHeaderField><TextInput aria-label={t('expression.label')} placeholder={t('expression.placeholder')} value={expression} onChange={event => setExpression(event.target.value)} autoFocus data-plugin-surface-autofocus="sticky" /></SurfaceHeaderField>
    <SurfaceError>{result.error}</SurfaceError>
    <div className="text-tools-converter-columns">
      <label>{t('expression.input')}<TextArea data-launcher-scrollable spellCheck={false} aria-label={t('expression.input')} value={text} onChange={event => setText(event.target.value)} /></label>
      <label>{t('expression.output')}<TextArea data-launcher-scrollable readOnly aria-label={t('expression.output')} value={result.output} /></label>
    </div>
    <ActionBar>{host.OutputActions && <host.OutputActions text={result.output} disabled={!!result.error} />}</ActionBar>
  </section>
}
