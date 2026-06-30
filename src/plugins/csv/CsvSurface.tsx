import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'

type DelimiterMode = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe'
type HeaderMode = 'auto' | 'first-row' | 'no-header'
type OutputMode = 'objects' | 'array' | 'csv' | 'tsv'

type ParseResult = {
  delimiter: string
  rows: string[][]
  headers: string[]
  objects: Array<Record<string, string>>
}

function delimiterFor(mode: DelimiterMode, text: string): string {
  if (mode === 'comma') return ','
  if (mode === 'tab') return '\t'
  if (mode === 'semicolon') return ';'
  if (mode === 'pipe') return '|'
  const sample = text.split(/\r?\n/).slice(0, 6).join('\n')
  const candidates = [',', '\t', ';', '|']
  return candidates
    .map((delimiter) => ({ delimiter, score: sample.split(delimiter).length }))
    .sort((a, b) => b.score - a.score)[0]?.delimiter ?? ','
}

function parseTable(text: string, delimiterMode: DelimiterMode, headerMode: HeaderMode): ParseResult {
  const delimiter = delimiterFor(delimiterMode, text)
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(delimiter).map((cell) => cell.trim()))
  const hasHeader = headerMode === 'first-row' || (headerMode === 'auto' && rows.length > 1)
  const headers = hasHeader
    ? rows[0] ?? []
    : (rows[0] ?? []).map((_, index) => `column_${index + 1}`)
  const body = hasHeader ? rows.slice(1) : rows
  const objects = body.map((row) => Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, row[index] ?? ''])))
  return { delimiter, rows, headers, objects }
}

function stringifyDelimited(rows: string[][], delimiter: string): string {
  return rows.map((row) => row.join(delimiter)).join('\n')
}

function outputFor(result: ParseResult, outputMode: OutputMode): string {
  if (outputMode === 'objects') return JSON.stringify(result.objects, null, 2)
  if (outputMode === 'array') return JSON.stringify(result.rows, null, 2)
  const rows = [result.headers, ...result.objects.map((object) => result.headers.map((header) => object[header] ?? ''))]
  return stringifyDelimited(rows, outputMode === 'tsv' ? '\t' : ',')
}

export function CsvSurface(props: PluginSurfaceProps) {
  const { host } = props
  const [sourceText, setSourceText] = useState(props.initialText ?? 'name,age\nAlice,30\nBob,28')
  const [delimiter, setDelimiter] = useState<DelimiterMode>('auto')
  const [header, setHeader] = useState<HeaderMode>('auto')
  const [output, setOutput] = useState<OutputMode>('objects')

  const parsed = useMemo(() => parseTable(sourceText, delimiter, header), [delimiter, header, sourceText])
  const outputText = useMemo(() => outputFor(parsed, output), [output, parsed])

  return (
    <section className="csv-tools-surface" aria-label="CSV Tools">
      <header className="csv-tools-surface__header">
        <div>
          <strong>CSV Tools</strong>
          <span>表格转换 surface</span>
        </div>
        <div className="csv-tools-surface__actions">
          <button type="button" onClick={() => host.clipboard.writeText(outputText)}>Copy</button>
          <button type="button" onClick={() => host.close()}>Close</button>
        </div>
      </header>

      <div className="csv-tools-surface__params" aria-label="CSV parameters">
        <label>Delimiter
          <select value={delimiter} onChange={(event) => setDelimiter(event.target.value as DelimiterMode)}>
            <option value="auto">Auto</option>
            <option value="comma">Comma</option>
            <option value="tab">Tab</option>
            <option value="semicolon">Semicolon</option>
            <option value="pipe">Pipe</option>
          </select>
        </label>
        <label>Header
          <select value={header} onChange={(event) => setHeader(event.target.value as HeaderMode)}>
            <option value="auto">Auto</option>
            <option value="first-row">First row</option>
            <option value="no-header">No header</option>
          </select>
        </label>
        <label>Output
          <select value={output} onChange={(event) => setOutput(event.target.value as OutputMode)}>
            <option value="objects">JSON objects</option>
            <option value="array">2D array</option>
            <option value="csv">CSV</option>
            <option value="tsv">TSV</option>
          </select>
        </label>
      </div>

      <div className="csv-tools-surface__body">
        <div className="csv-tools-surface__pane">
          <div className="csv-tools-surface__pane-title">Source</div>
          <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} />
        </div>
        <div className="csv-tools-surface__pane">
          <div className="csv-tools-surface__pane-title">Table preview</div>
          <div className="csv-tools-surface__table-wrap">
            <table>
              <thead><tr>{parsed.headers.map((head, index) => <th key={`${head}:${index}`}>{head}</th>)}</tr></thead>
              <tbody>
                {parsed.objects.slice(0, 50).map((row, rowIndex) => (
                  <tr key={rowIndex}>{parsed.headers.map((head, index) => <td key={`${rowIndex}:${index}`}>{row[head]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="csv-tools-surface__pane">
          <div className="csv-tools-surface__pane-title">Output preview</div>
          <pre>{outputText}</pre>
        </div>
      </div>
    </section>
  )
}
