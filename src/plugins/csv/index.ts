/**
 * First-party CSV Tools plugin — surface-only table converter.
 * Opens in launcher tool-shell (in-place), not a detached window.
 */

import { definePlugin } from '@hiven/plugin'
import { CsvSurface } from './CsvSurface'

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
        aliases: ['csv', 'tsv', 'table convert', '表格转换', 'csv to json', 'sql insert'],
        textMatch: csvSurfaceTextMatch,
        component: CsvSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: {
          defaultWidth: 920,
          defaultHeight: 620,
          minWidth: 680,
          minHeight: 480,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
})

export default csvPlugin
