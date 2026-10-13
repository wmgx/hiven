/**
 * First-party CSV Tools plugin — surface-only table converter.
 * Opens in launcher tool-shell (in-place), not a detached window.
 */

import { Component, createElement, lazy, Suspense } from 'react'
import { definePlugin, type PluginSurfaceProps } from '@hiven/plugin'
import { createEntryLoader, EntryStylesheetError, identifyStylesheetFailure } from './entryLoader'
import './style.css'

const entry = createEntryLoader(async () => {
  const module = await import('./CsvSurface')
  return { default: module.CsvSurface }
}, error => identifyStylesheetFailure(error, document))

class CsvEntry extends Component<PluginSurfaceProps> {
  state = { Surface: lazy(entry.read), error: undefined as EntryStylesheetError | undefined, retrying: false }
  private active = true
  private pending = false

  static getDerivedStateFromError(error: unknown) {
    // Ordinary render/module errors retain the host's existing crash behavior.
    if (!(error instanceof EntryStylesheetError)) throw error
    return { error }
  }

  componentDidMount() { this.active = true }
  componentWillUnmount() { this.active = false }

  retry = () => {
    if (this.pending || !this.active) return
    this.pending = true
    this.setState({ retrying: true })
    void entry.retry().then(() => {
      if (this.active) this.setState({ Surface: lazy(entry.read), error: undefined, retrying: false })
    }, error => {
      if (this.active) this.setState({ error, retrying: false })
    }).finally(() => { this.pending = false })
  }

  render() {
    const { error, retrying, Surface } = this.state
    if (error && !(error instanceof EntryStylesheetError)) throw error
    const fallback = createElement(
      'section',
      { className: 'csv-tools-surface csv-tools-surface__empty--start', 'aria-busy': !error || retrying },
      createElement('p', { role: 'status' }, this.props.t(error ? (retrying ? 'surface.loading' : 'surface.loadFailed') : 'surface.loading')),
      error && createElement('button', { type: 'button', className: 'csv-tools-surface__file-btn',
        'aria-disabled': retrying, onClick: this.retry }, this.props.t('action.retry')),
      createElement('button', { type: 'button', className: 'csv-tools-surface__file-btn',
        onClick: () => this.props.host.requestBack() }, this.props.t('action.back')),
    )
    return error ? fallback : createElement(Suspense, { fallback }, createElement(Surface, this.props))
  }
}

function LazyCsvSurface(props: PluginSurfaceProps) {
  return createElement(CsvEntry, props)
}

const WORKSPACE_SHELL = {
  defaultWidth: 920,
  defaultHeight: 620,
  minWidth: 680,
  minHeight: 480,
  closeOnBlur: false,
  resizable: true,
}

const OPERATION_ROUTES = [
  { id: 'to-json', title: 'route.csvToJson', aliases: ['csv to json', 'tsv to json', 'csv2json', 'csv转json', 'csv 转 json'] },
  { id: 'to-array', title: 'route.toArray', aliases: ['csv to array', 'csv to json array', 'csv二维数组', 'csv转数组'] },
  { id: 'to-columns', title: 'route.toColumns', aliases: ['csv to columns', 'csv column arrays', 'csv列数组', 'csv转列数组'] },
  { id: 'to-keyed', title: 'route.toKeyed', aliases: ['csv to keyed object', 'csv keyed json', 'csv键值对象', 'csv转键值对象'] },
  { id: 'to-ndjson', title: 'route.toNdjson', aliases: ['csv to ndjson', 'csv to jsonl', 'csv to json lines', 'csv转jsonl', 'csv转json行'] },
  { id: 'to-csv', title: 'route.jsonToCsv', aliases: ['json to csv', 'json2csv', 'json转csv', 'json 转 csv'] },
  { id: 'to-tsv', title: 'route.toTsv', aliases: ['csv to tsv', 'json to tsv', 'table to tsv', 'csv转tsv', '转tsv'] },
  { id: 'to-markdown', title: 'route.toMarkdown', aliases: ['csv to markdown', 'json to markdown', 'json markdown table', 'json转markdown', 'json 转 markdown', 'JSON转表格', 'table to markdown', 'csv table', 'csv转markdown', '转markdown表格'] },
  { id: 'to-sql', title: 'route.toSql', aliases: ['csv to sql', 'csv sql insert', 'table to sql', 'csv转sql', '生成sql insert'] },
] as const

/** Boost CSV Tools when clipboard is table content or a .csv/.tsv path. */
function csvSurfaceTextMatch(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Single-line path / bare filename with table extension
  if (!/[\r\n]/.test(trimmed)) {
    if (/\.(csv|tsv)$/i.test(trimmed)) return true
    if (/^file:\/\/.+\.(csv|tsv)$/i.test(trimmed)) return true
  }
  // Delimited multi-line table
  const lines = trimmed.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length < 2) return false
  const sample = lines.slice(0, 6)
  for (const delimiter of [',', '\t', ';', '|'] as const) {
    const counts = sample.map((line) => {
      let n = 0
      let inQuotes = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            i++
            continue
          }
          inQuotes = !inQuotes
          continue
        }
        if (!inQuotes && ch === delimiter) n++
      }
      return n
    })
    const min = Math.min(...counts)
    if (min < 1) continue
    const first = counts[0]
    if (counts.every((c) => Math.abs(c - first) <= 1)) return true
  }
  return false
}

export const csvPlugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'CSV Tools',
        titleI18n: { zh: 'CSV Tools' },
        icon: 'Table',
        aliases: ['csv', 'tsv', 'table convert', '表格转换'],
        textMatch: csvSurfaceTextMatch,
        component: LazyCsvSurface,
        entry: { launcher: { surfaces: ['global-launcher'] }, shortcutBindable: true },
        shell: WORKSPACE_SHELL,
      },
      ...OPERATION_ROUTES.map((route) => ({
        id: route.id,
        kind: 'custom-view' as const,
        title: 'CSV Tools',
        titleI18n: { zh: 'CSV Tools' },
        component: LazyCsvSurface,
        entry: { launcher: false },
        shell: WORKSPACE_SHELL,
      })),
    ],
  },
  launcher: {
    items: OPERATION_ROUTES.map((route) => ({
      id: `open-${route.id}`,
      display: {
        title: route.title,
        subtitle: 'route.open',
        icon: 'Table',
        aliases: [...route.aliases],
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.id, { initialText: execution.input?.text })
        return { ok: true as const, keepOpen: true }
      },
    })),
  },
})

export default csvPlugin
