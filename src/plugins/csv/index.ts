import en from './locales/en.json'
import zh from './locales/zh.json'
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
        title: en['surface.title'], titleI18n: { zh: zh['surface.title'] },
        icon: 'Table',
        aliases: ['csv', 'tsv', 'table convert', '表格转换'],
        textMatch: csvSurfaceTextMatch,
        component: LazyCsvSurface,
        entry: { launcher: { surfaces: ['global-launcher'] }, shortcutBindable: true },
        shell: WORKSPACE_SHELL,
      },
    ],
  },
})

export default csvPlugin
