import { useRef } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import type { DiffSource } from '@hiven/plugin-diff'
import { ValueChip } from '@hiven/plugin-ui'
import type { createDiffSourceReader } from './sourceReadLifetime'

type Props = Pick<PluginSurfaceProps, 'host' | 't'> & {
  source: DiffSource; text: string; options: DiffSource[]
  reader: ReturnType<typeof createDiffSourceReader>; setSource(source: DiffSource): void
}

export function DiffSourceChip({ host, t, source, text, options, reader, setSource }: Props) {
  const snapshot = useRef(source)
  const previews = useRef(new Map<string, DiffSource>())
  const select = (value: string | string[]) => {
    if (value === snapshot.current.sourceId) { reader.invalidate(); setSource(snapshot.current); return }
    const cached = previews.current.get(String(value))
    const option = cached ?? options.find(option => option.sourceId === value)
    if (option) void reader.select(option, () => host.clipboard.readText(), next => {
      previews.current.set(next.sourceId, next); setSource(next)
    }, () => host.showToast(t('source.readFailed'), 'error'))
  }
  return <ValueChip label={t('source.chooseShort')} value={source.sourceId}
    onOpen={() => { snapshot.current = { ...source, text }; previews.current.clear() }}
    options={options.map(option => ({ value: option.sourceId, label: option.kind === 'empty' ? t('source.empty') : option.title,
      description: option.kind === 'editor-pane' ? t('source.paneDescription', { language: option.language || t('source.plainText'), lines: option.text?.split('\n').length ?? 0, chars: option.text?.length ?? 0 }) : t('source.snapshotHint'),
    }))} onPreview={select} onChange={select} />
}
