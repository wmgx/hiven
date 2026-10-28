import { useEffect, useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, SurfaceHeaderActions, TextArea, TextInput } from '@hiven/plugin-ui'
import { evaluateJsonExpression, isJson, JsonCoreError } from './jsonCore'

export function JsonExpressionSurface({ host, t, initialText }: PluginSurfaceProps) {
  const [text, setText] = useState(initialText ?? '')
  const [expression, setExpression] = useState('')
  useEffect(() => {
    let current = true
    if (!initialText) void host.clipboard.readText().then(value => {
      if (current && isJson(value)) setText(previous => previous || value)
    }).catch(() => { if (current) host.showMessage(t('expression.readFailed'), 'error') })
    return () => { current = false }
  }, [host.clipboard, initialText])
  const result = useMemo(() => {
    if (!text.trim() || !expression.trim()) return { output: '', error: '' }
    // Keep the existing expression syntax; expressions are entered by the user, never read from the clipboard.
    try { return { output: evaluateJsonExpression(text, expression), error: '' } }
    catch (error) { return { output: '', error: t(error instanceof JsonCoreError ? `error.${error.code}` : 'error.expression') } }
  }, [text, expression, t])
  return <section className="json-expression-surface text-tools-converter">
    <SurfaceHeaderActions><Button disabled={!result.output || !!result.error} onClick={async () => {
      try { await host.clipboard.writeText(result.output); host.showMessage(t('expression.copied'), 'success') }
      catch { host.showMessage(t('expression.copyFailed'), 'error') }
    }}>{t('expression.copy')}</Button></SurfaceHeaderActions>
    <TextInput aria-label={t('expression.label')} placeholder={t('expression.placeholder')} value={expression} onChange={event => setExpression(event.target.value)} autoFocus />
    {result.error && <p role="alert">{result.error}</p>}
    <div className="text-tools-converter-columns">
      <label>{t('expression.input')}<TextArea data-launcher-scrollable spellCheck={false} aria-label={t('expression.input')} value={text} onChange={event => setText(event.target.value)} /></label>
      <label>{t('expression.output')}<TextArea data-launcher-scrollable readOnly aria-label={t('expression.output')} value={result.output} /></label>
    </div>
  </section>
}
