import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton } from '@hiven/plugin-ui'
import { BackIcon } from '@hiven/plugin-ui/icons'
import { PathTransformError, transformPaths, type PathFormat, type PathStyle } from './core'

export function FilePathsSurface({ host, t, initialText = '' }: PluginSurfaceProps) {
  const [source, setSource] = useState(initialText)
  const [base, setBase] = useState('')
  const [format, setFormat] = useState<PathFormat>('posix')
  const [style, setStyle] = useState<PathStyle>('auto')
  const result = useMemo(() => {
    try { return { output: transformPaths(source, format, base, style), error: '' } }
    catch (error) { return { output: '', error: error instanceof PathTransformError ? error.code : 'invalid' } }
  }, [source, format, base, style])
  const status = result.error && result.error !== 'empty' ? t(`error.${result.error}`) : ''
  return <section className="file-paths-surface" data-no-drag aria-label={t('title')}>
    <header>
      <IconButton label={t('back')} onClick={() => host.requestBack()}><BackIcon size={14} /></IconButton>
      <strong>{t('title')}</strong>
    </header>
    <nav aria-label={t('formatLabel')}><span>{t('formatLabel')}</span>{(['posix', 'uri', 'relative', 'name', 'markdown-image'] as PathFormat[]).map((item) =>
      <button type="button" key={item} aria-pressed={format === item} onClick={() => setFormat(item)}>{t(`format.${item}`)}</button>)}</nav>
    <nav aria-label={t('styleLabel')}><span>{t('styleLabel')}</span>{(['auto', 'unix', 'windows'] as PathStyle[]).map((item) =>
      <button type="button" key={item} aria-pressed={style === item} onClick={() => setStyle(item)}>{t(`style.${item}`)}</button>)}</nav>
    {(format === 'relative' || format === 'markdown-image') && <label>{t(format === 'markdown-image' ? 'documentBase' : 'base')}<input aria-label={t(format === 'markdown-image' ? 'documentBase' : 'base')} value={base} onChange={(event) => setBase(event.target.value)} /></label>}
    <div className="file-paths-editors">
      <label>{t('source')}<textarea data-plugin-surface-autofocus="sticky" aria-label={t('source')} placeholder={t('sourcePlaceholder')} spellCheck={false} value={source} onChange={(event) => setSource(event.target.value)} /></label>
      <label>{t('output')}<textarea aria-label={t('output')} spellCheck={false} readOnly value={result.output} /></label>
    </div>
    {status && <div role="status" aria-live="polite">{status}</div>}
    <footer>
      {host.OutputActions && <host.OutputActions text={result.error ? '' : result.output} />}
    </footer>
  </section>
}
