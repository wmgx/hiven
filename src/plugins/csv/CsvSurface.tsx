import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  DataGrid,
  type CellCopyArgs,
  type CellKeyDownArgs,
  type CellKeyboardEvent,
  type CellMouseArgs,
  type CellSelectArgs,
  type Column,
  type SortColumn,
} from 'react-data-grid'
import 'react-data-grid/lib/styles.css'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Checkbox, IconButton, SearchField, SegmentedControl, Select, TextInput } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import {
  applyTransforms,
  applyTableQuery,
  downloadTextFile,
  estimateRowCount,
  outputExtension,
  parseSource,
  processFullSource,
  sliceTable,
  toOutput,
  type DelimiterMode,
  type HeaderMode,
  type OutputMode,
  type FullProcessResult,
} from './csvCore'
import {
  defaultSqlTemplate,
  getSqlCompletions,
  type SqlCompletionItem,
} from './csvSqlFilter'

/** Soft caps keep UI responsive; banner when truncated. */
const PARSE_MAX_ROWS = 8_000
const GRID_MAX_ROWS = 5_000
const OUTPUT_PREVIEW_MAX_ROWS = 1_500
const SOURCE_TEXTAREA_MAX_CHARS = 200_000
/** Above this, skip full JSON re-stringify on every render path. */
const LARGE_SOURCE_CHARS = 512_000
const RETURN_MAX_BYTES = 1024 * 1024

const JSON_OUTPUTS: OutputMode[] = ['objects', 'array', 'columns', 'keyed']

type MainView = 'table' | 'output' | 'source'

type CsvGridRow = {
  id: number
  [key: string]: string | number
}

/** Inclusive block in display-space (row ids + column keys). */
type CellBlock = {
  start: { rowId: number; columnKey: string }
  end: { rowId: number; columnKey: string }
}

function localizedText(
  t: ((key: string, vars?: Record<string, string | number>) => string) | undefined,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  const applyVars = (template: string) => {
    if (!vars) return template
    let value = template
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
    return value
  }
  if (!t) return applyVars(fallback)
  const label = t(key, vars)
  if (!label || label === key) return applyVars(fallback)
  return label
}

const IconDetach = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
)

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16V4a2 2 0 0 1 2-2h12" />
  </svg>
)

const IconFolder = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 6a2 2 0 0 1 2-2h3.5l1.5 2H18a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" />
  </svg>
)

const IconDownload = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
)

const IconSortNone = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M5 3.5v9M5 3.5 3.2 5.5M5 3.5 6.8 5.5M11 12.5v-9M11 12.5 9.2 10.5M11 12.5 12.8 10.5" />
  </svg>
)

const IconSortAsc = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M8 12.5V3.5M8 3.5 5.5 6M8 3.5 10.5 6" />
  </svg>
)

const IconSortDesc = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M8 3.5v9M8 12.5 5.5 10M8 12.5 10.5 10" />
  </svg>
)

type FullJobState =
  | { status: 'idle' }
  | { status: 'running'; ratio: number; phase: string }
  | { status: 'done'; rows: number; cols: number; bytes: number }
  | { status: 'error'; message: string }



function normalizeBlock(block: CellBlock, displayRows: CsvGridRow[], headers: string[]) {
  const rowOrder = displayRows.map((r) => r.id)
  const i0 = rowOrder.indexOf(block.start.rowId)
  const i1 = rowOrder.indexOf(block.end.rowId)
  const j0 = headers.indexOf(block.start.columnKey)
  const j1 = headers.indexOf(block.end.columnKey)
  if (i0 < 0 || i1 < 0 || j0 < 0 || j1 < 0) return null
  const rMin = Math.min(i0, i1)
  const rMax = Math.max(i0, i1)
  const cMin = Math.min(j0, j1)
  const cMax = Math.max(j0, j1)
  return {
    rowIds: rowOrder.slice(rMin, rMax + 1),
    colKeys: headers.slice(cMin, cMax + 1),
    rMin,
    rMax,
    cMin,
    cMax,
  }
}

function isInBlock(
  rowId: number,
  columnKey: string,
  block: CellBlock | null,
  displayRows: CsvGridRow[],
  headers: string[],
): boolean {
  if (!block) return false
  const n = normalizeBlock(block, displayRows, headers)
  if (!n) return false
  return n.rowIds.includes(rowId) && n.colKeys.includes(columnKey)
}

function blockToTsv(block: CellBlock, displayRows: CsvGridRow[], headers: string[]): string {
  const n = normalizeBlock(block, displayRows, headers)
  if (!n) return ''
  const lines = n.rowIds.map((id) => {
    const row = displayRows.find((r) => r.id === id)
    return n.colKeys.map((h) => String(row?.[h] ?? '')).join('\t')
  })
  return lines.join('\n')
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * initialText may already be file *contents* (host resolved a path) or plain CSV.
 * Surface never imports Tauri — path resolution happens in launcher host.
 * Empty by default — no demo sample.
 */
function resolveInitialSource(text: string | undefined): { source: string; fileLabel?: string } {
  if (!text?.trim()) return { source: '' }
  return { source: text }
}

function initialOutput(surfaceId: string): OutputMode {
  if (surfaceId === 'to-json') return 'objects'
  if (surfaceId === 'to-array') return 'array'
  if (surfaceId === 'to-columns') return 'columns'
  if (surfaceId === 'to-keyed') return 'keyed'
  if (surfaceId === 'to-ndjson') return 'ndjson'
  if (surfaceId === 'to-csv') return 'csv'
  if (surfaceId === 'to-tsv') return 'tsv'
  if (surfaceId === 'to-markdown') return 'markdown'
  if (surfaceId === 'to-sql') return 'sql'
  return 'objects'
}

export function CsvSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initial = resolveInitialSource(props.initialText)
  const [sourceText, setSourceText] = useState(initial.source)
  const [linkedFileLabel, setLinkedFileLabel] = useState<string | undefined>(initial.fileLabel)
  const [fileError, setFileError] = useState<string | null>(null)
  const [delimiter, setDelimiter] = useState<DelimiterMode>('auto')
  const [header, setHeader] = useState<HeaderMode>('auto')
  const [output, setOutput] = useState<OutputMode>(() => initialOutput(props.surfaceId))
  const [minify, setMinify] = useState(false)
  const [indent, setIndent] = useState<2 | 4>(2)
  const [tableName, setTableName] = useState('table')
  const [dropEmpty, setDropEmpty] = useState(false)
  const [dedupe, setDedupe] = useState(false)
  const [transpose, setTranspose] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{ rowId: number; columnKey: string } | null>(null)
  const [selectedColumns, setSelectedColumns] = useState<ReadonlySet<string>>(() => new Set())
  const [cellBlock, setCellBlock] = useState<CellBlock | null>(null)
  const [sortColumns, setSortColumns] = useState<readonly SortColumn[]>([])
  const [filterMode, setFilterMode] = useState<'text' | 'sql'>('text')
  const [globalFilter, setGlobalFilter] = useState('')
  const [sqlFilter, setSqlFilter] = useState('')
  const [sqlCursor, setSqlCursor] = useState(0)
  const [sqlSuggestOpen, setSqlSuggestOpen] = useState(false)
  const [sqlSuggestIndex, setSqlSuggestIndex] = useState(0)
  const [mainView, setMainView] = useState<MainView>(() => props.surfaceId === 'main'
    ? 'table'
    : initial.source ? 'output' : 'source')
  const sqlInputRef = useRef<HTMLInputElement>(null)
  const dragSelectRef = useRef<{
    active: boolean
    start: { rowId: number; columnKey: string }
  } | null>(null)
  const [sourceEditUnlocked, setSourceEditUnlocked] = useState(
    () => initial.source.length <= SOURCE_TEXTAREA_MAX_CHARS,
  )
  const [isParsing, startParseTransition] = useTransition()
  const [fullJob, setFullJob] = useState<FullJobState>({ status: 'idle' })
  const fullOutputRef = useRef<string | null>(null)
  const fullResultRef = useRef<FullProcessResult | null>(null)
  const fullJobKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileReadingHost, setFileReadingHost] = useState<typeof host | null>(null)
  const readingFile = fileReadingHost === host
  const fileReadRef = useRef<object | null>(null)
  const [resultRevision, setResultRevision] = useState(0)
  const resultRevisionRef = useRef(0)
  const returnSubmissionRef = useRef<AbortController | null>(null)
  const [returnSubmission, setReturnSubmission] = useState<{ host: typeof host; controller: AbortController } | null>(null)
  const returnLifetimeRef = useRef({ host, active: false })
  const pendingCopiesRef = useRef(0)
  const returning = returnSubmission?.host === host && !returnSubmission.controller.signal.aborted

  useLayoutEffect(() => {
    if (returnLifetimeRef.current.host !== host) {
      fullOutputRef.current = null
      fullResultRef.current = null
      fullJobKeyRef.current = ''
      fullReturnSnapshotRef.current = null
      setFullJob({ status: 'idle' })
    }
    const lifetime = { host, active: true }
    returnLifetimeRef.current = lifetime
    return () => {
      lifetime.active = false
      returnSubmissionRef.current?.abort()
      returnSubmissionRef.current = null
      fileReadRef.current = null
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [host])

  // Revoke the click snapshot before an edit, file read or exit can race its receipt.
  const cancelReturn = useCallback(() => {
    resultRevisionRef.current += 1
    setResultRevision(resultRevisionRef.current)
    returnSubmissionRef.current?.abort()
    returnSubmissionRef.current = null
    setReturnSubmission(null)
  }, [])

  const updateResult = useCallback((update: () => void) => {
    cancelReturn()
    abortRef.current?.abort()
    abortRef.current = null
    fullOutputRef.current = null
    fullResultRef.current = null
    fullJobKeyRef.current = ''
    fullReturnSnapshotRef.current = null
    setFullJob({ status: 'idle' })
    update()
  }, [cancelReturn])

  // Retain the exact source separately from the old preview fingerprint: same-length
  // middle edits must never make an earlier full result eligible for a new handoff.
  const resultParameters = JSON.stringify([delimiter, header, output, minify, indent, tableName, dropEmpty, dedupe, transpose, filterMode, globalFilter, sqlFilter, sortColumns])
  const fullReturnSnapshotRef = useRef<{ sourceText: string; parameters: string } | null>(null)

  const deferredSource = useDeferredValue(sourceText)
  const isSourceStale = deferredSource !== sourceText

  const estimatedLines = useMemo(() => estimateRowCount(deferredSource), [deferredSource])
  const isLargeSource = deferredSource.length > LARGE_SOURCE_CHARS
  const sourceTooBigForEditor = sourceText.length > SOURCE_TEXTAREA_MAX_CHARS

  const jobFingerprint = useMemo(
    () =>
      [
        sourceText.length,
        // sample edges so identity changes when content swaps of same length
        sourceText.slice(0, 64),
        sourceText.slice(-64),
        resultParameters,
      ].join('|'),
    [resultParameters, sourceText],
  )

  const parseLimits = useMemo(() => {
    // Preview path only — full file uses processFullSource on demand
    if (isLargeSource || estimatedLines > PARSE_MAX_ROWS * 1.2) {
      return { maxRows: PARSE_MAX_ROWS }
    }
    if (deferredSource.length > 256_000 || estimatedLines > PARSE_MAX_ROWS) {
      return { maxRows: PARSE_MAX_ROWS }
    }
    return undefined
  }, [deferredSource.length, estimatedLines, isLargeSource])

  const invalidateFullJob = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    fullOutputRef.current = null
    fullResultRef.current = null
    fullJobKeyRef.current = ''
    fullReturnSnapshotRef.current = null
    setFullJob({ status: 'idle' })
  }, [])

  const onFilePicked = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    cancelReturn()
    invalidateFullJob()
    const read = {}
    const lifetime = returnLifetimeRef.current
    fileReadRef.current = read
    setFileReadingHost(host)
    setFileError(null)
    try {
      const content = await file.text()
      if (fileReadRef.current !== read || !lifetime.active) return
      updateResult(() => startParseTransition(() => {
        invalidateFullJob()
        setSourceText(content)
        setLinkedFileLabel(file.name)
        setSourceEditUnlocked(content.length <= SOURCE_TEXTAREA_MAX_CHARS)
        setSelectedCell(null)
        setMainView('table')
      }))
    } catch (error) {
      if (fileReadRef.current !== read || !lifetime.active) return
      setFileError(error instanceof Error ? error.message : String(error))
    } finally {
      if (fileReadRef.current === read) {
        fileReadRef.current = null
        setFileReadingHost(null)
      }
    }
  }, [cancelReturn, host, invalidateFullJob, updateResult])

  const parsed = useMemo(() => {
    try {
      return parseSource(deferredSource, delimiter, header, parseLimits)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }, [delimiter, deferredSource, header, parseLimits])

  const tableFull = useMemo(() => {
    if (!parsed.ok) return null
    try {
      return applyTransforms(parsed.table, { dropEmpty, dedupe, transpose })
    } catch {
      return null
    }
  }, [dedupe, dropEmpty, parsed, transpose])

  // A capped parse is only useful for discovering source columns. Do not query
  // that subset or present its row count as the complete result.
  const returnNeedsFullProcess = Boolean(
    parseLimits && parsed.ok && parsed.table.rows.length >= PARSE_MAX_ROWS - 1,
  )
  const needsFullProcess = returnNeedsFullProcess
  const fullReturnReady = fullJob.status === 'done'
    && fullOutputRef.current !== null
    && fullResultRef.current !== null
    && fullJobKeyRef.current === jobFingerprint
    && fullReturnSnapshotRef.current?.sourceText === sourceText
    && fullReturnSnapshotRef.current.parameters === resultParameters
  const fullJobReady = fullReturnReady
  const tableQuery = useMemo(() => ({ filterMode, globalFilter, sqlFilter, sortColumns }), [filterMode, globalFilter, sqlFilter, sortColumns])
  const queryResult = useMemo(() => {
    if (!tableFull || returnNeedsFullProcess) return null
    // Capped JSON and transposed sources may have columns beyond the preview.
    // Their query validation belongs to the full run as well.
    return applyTableQuery(tableFull, tableQuery)
  }, [returnNeedsFullProcess, tableFull, tableQuery])
  const filterError = queryResult && !queryResult.ok ? queryResult.message : null
  const currentInputReady = !isParsing && !isSourceStale && !readingFile
  const finalTable = currentInputReady && !filterError
    ? fullJobReady ? fullResultRef.current!.table
      : !returnNeedsFullProcess && queryResult?.ok ? queryResult.table : null
    : null
  const gridSlice = useMemo(() => finalTable ? sliceTable(finalTable, GRID_MAX_ROWS) : null, [finalTable])
  // Keep the same filter controls available for pending, invalid and zero-row results.
  const table = gridSlice?.table ?? (tableFull ? { headers: tableFull.headers, rows: [] } : null)
  const totalDataRows = finalTable?.rows.length ?? 0
  const tableHeaders = fullJobReady ? fullResultRef.current!.sourceHeaders : tableFull?.headers ?? []
  const outputPreviewTable = useMemo(() => finalTable ? sliceTable(finalTable, OUTPUT_PREVIEW_MAX_ROWS).table : null, [finalTable])
  const outputText = useMemo(() => {
    if (!outputPreviewTable || mainView !== 'output') return ''
    try {
      return toOutput(outputPreviewTable, output, { minify, indent }, { tableName })
    } catch {
      return ''
    }
  }, [indent, mainView, minify, output, outputPreviewTable, tableName])
  const canReturnOutput = Boolean(sourceText.trim() && finalTable) && currentInputReady
  const getCompleteOutput = useCallback((): string | null => {
    if (!canReturnOutput || resultRevision !== resultRevisionRef.current || fileReadRef.current) return null
    if (fullJobReady) return fullOutputRef.current
    return toOutput(finalTable!, output, { minify, indent }, { tableName })
  }, [canReturnOutput, finalTable, fullJobReady, indent, minify, output, resultRevision, tableName])

  const returnOutput = async () => {
    const lifetime = returnLifetimeRef.current
    if (!canReturnOutput || !lifetime.active || lifetime.host !== host
      || resultRevision !== resultRevisionRef.current || fileReadRef.current
      || returnSubmissionRef.current || pendingCopiesRef.current > 0) return
    // Serialize all transformed rows, never the grid selection or 1,500-row preview.
    let text: string
    try {
      const currentOutput = getCompleteOutput()
      if (currentOutput === null) return
      text = currentOutput
      if (text.length > RETURN_MAX_BYTES || new TextEncoder().encode(text).byteLength > RETURN_MAX_BYTES) {
        host.showMessage(t('toast.returnTooLarge'), 'error')
        return
      }
    } catch {
      host.showMessage(t('toast.returnFailed'), 'error')
      return
    }
    const submission = new AbortController()
    returnSubmissionRef.current = submission
    setReturnSubmission({ host, controller: submission })
    try {
      const accepted = await host.returnToLauncherWithObject({ kind: 'text', text, source: 'tool-result' }, { signal: submission.signal })
      if (!lifetime.active || returnSubmissionRef.current !== submission || submission.signal.aborted) return
      // The host owns successful navigation. A failed receipt leaves the draft intact.
      if (accepted === false) {
        returnSubmissionRef.current = null
        setReturnSubmission(null)
      }
    } catch {
      if (!lifetime.active || returnSubmissionRef.current !== submission || submission.signal.aborted) return
      returnSubmissionRef.current = null
      setReturnSubmission(null)
      host.showMessage(t('toast.returnFailed'), 'error')
    }
  }

  const runFullProcess = useCallback(async () => {
    const lifetime = returnLifetimeRef.current
    if (abortRef.current || resultRevision !== resultRevisionRef.current || !currentInputReady
      || !sourceText.trim() || !tableFull || filterError || !lifetime.active || lifetime.host !== host) return
    cancelReturn()
    const controller = new AbortController()
    abortRef.current = controller
    const isCurrent = () => lifetime.active && lifetime.host === host
      && abortRef.current === controller && !controller.signal.aborted
    setFullJob({ status: 'running', ratio: 0, phase: 'parse' })
    fullOutputRef.current = null
    fullResultRef.current = null
    fullReturnSnapshotRef.current = null
    try {
      const result = await processFullSource(
        sourceText,
        {
          delimiter,
          header,
          output,
          transforms: { dropEmpty, dedupe, transpose },
          jsonStyle: { minify, indent },
          sqlStyle: { tableName },
          query: tableQuery,
        },
        {
          signal: controller.signal,
          onProgress: (p) => {
            if (isCurrent()) setFullJob({ status: 'running', ratio: p.ratio, phase: p.phase })
          },
        },
      )
      if (!isCurrent()) return
      fullOutputRef.current = result.output
      fullResultRef.current = result
      fullJobKeyRef.current = jobFingerprint
      fullReturnSnapshotRef.current = { sourceText, parameters: resultParameters }
      setFullJob({
        status: 'done',
        rows: result.rowCount,
        cols: result.colCount,
        bytes: new TextEncoder().encode(result.output).byteLength,
      })
      setMainView('output')
      try {
        host.showMessage?.(
          localizedText(t, 'job.doneToast', 'Full file ready: {rows} rows', { rows: result.rowCount }),
          'success',
        )
      } catch {
        // optional host toast
      }
    } catch (error) {
      if (!isCurrent()) return
      if (error instanceof Error && error.name === 'AbortError') {
        setFullJob({ status: 'idle' })
        return
      }
      setFullJob({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [
    cancelReturn,
    currentInputReady,
    dedupe,
    delimiter,
    dropEmpty,
    filterError,
    header,
    host,
    indent,
    jobFingerprint,
    minify,
    output,
    resultParameters,
    resultRevision,
    sourceText,
    t,
    tableName,
    tableFull,
    tableQuery,
    transpose,
  ])

  const cancelFullProcess = useCallback(() => {
    cancelReturn()
    invalidateFullJob()
  }, [cancelReturn, invalidateFullJob])

  const downloadFullResult = useCallback(() => {
    const text = getCompleteOutput()
    if (text === null) return
    const base = linkedFileLabel
      ? fileNameFromPath(linkedFileLabel).replace(/\.[^.]+$/, '')
      : 'csv-export'
    downloadTextFile(`${base}.${outputExtension(output)}`, text)
  }, [getCompleteOutput, linkedFileLabel, output])

  const errorMessage = !parsed.ok
    ? localizedText(t, 'error.generic', 'Parse error: {message}', { message: parsed.message })
    : ''

  const cols = finalTable?.headers.length ?? 0
  const sizeLabel = localizedText(t, 'meta.size', '{rows} × {cols}', {
    rows: totalDataRows,
    cols,
  })

  const delimiterHint =
    parsed.ok && parsed.kind === 'csv' && parsed.delimiter
      ? parsed.delimiter === '\t'
        ? 'TAB'
        : parsed.delimiter
      : null

  const showJsonStyle = JSON_OUTPUTS.includes(output)
  const isJsonInput = parsed.ok && parsed.kind === 'json'
  const canCopyOutput = canReturnOutput && !errorMessage

  const gridRows = useMemo((): CsvGridRow[] => {
    if (!table) return []
    return table.rows.map((row, index) => {
      const record: CsvGridRow = { id: index }
      table.headers.forEach((h, i) => {
        record[h] = row[i] ?? ''
      })
      return record
    })
  }, [table])

  /** Final columns include SQL projection, with source columns kept for completion. */
  const visibleHeaders = table?.headers ?? []

  const sqlCompletions = useMemo(() => {
    if (filterMode !== 'sql') return { items: [] as SqlCompletionItem[], from: 0, to: 0 }
    return getSqlCompletions(sqlFilter, sqlCursor, tableHeaders)
  }, [filterMode, sqlCursor, sqlFilter, tableHeaders])

  const applySqlCompletion = useCallback(
    (item: SqlCompletionItem) => {
      const { from, to } = sqlCompletions
      const next = sqlFilter.slice(0, from) + item.insertText + sqlFilter.slice(to)
      const caret = from + item.insertText.length
      updateResult(() => setSqlFilter(next))
      setSqlCursor(caret)
      setSqlSuggestOpen(false)
      setSqlSuggestIndex(0)
      requestAnimationFrame(() => {
        const el = sqlInputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(caret, caret)
      })
    },
    [sqlCompletions, sqlFilter, updateResult],
  )

  const displayGridRows = gridRows

  const toggleColumnSelected = useCallback((columnKey: string, additive: boolean) => {
    setSelectedColumns((prev) => {
      if (!additive) {
        if (prev.size === 1 && prev.has(columnKey)) return new Set()
        return new Set([columnKey])
      }
      const next = new Set(prev)
      if (next.has(columnKey)) next.delete(columnKey)
      else next.add(columnKey)
      return next
    })
    setCellBlock(null)
  }, [])

  const cycleSort = useCallback((columnKey: string) => {
    updateResult(() => setSortColumns((prev) => {
      const existing = prev.find((s) => s.columnKey === columnKey)
      if (!existing) return [{ columnKey, direction: 'ASC' }]
      if (existing.direction === 'ASC') return [{ columnKey, direction: 'DESC' }]
      return prev.filter((s) => s.columnKey !== columnKey)
    }))
  }, [updateResult])

  const sortDirFor = useCallback(
    (columnKey: string): 'ASC' | 'DESC' | null => {
      const sc = sortColumns.find((s) => s.columnKey === columnKey)
      return sc?.direction ?? null
    },
    [sortColumns],
  )

  const gridColumns: Column<CsvGridRow>[] = useMemo(() => {
    if (visibleHeaders.length === 0) return []
    return visibleHeaders.map((h) => {
      const dir = sortDirFor(h)
      return {
        key: h,
        name: h,
        resizable: true,
        sortable: false, // custom sort icon — header click selects column
        minWidth: 108,
        headerCellClass: selectedColumns.has(h)
          ? 'csv-tools-surface__header-cell is-col-selected'
          : 'csv-tools-surface__header-cell',
        cellClass: (row: CsvGridRow) => {
          const classes: string[] = []
          if (selectedColumns.has(h)) classes.push('csv-cell--col-selected')
          if (isInBlock(row.id, h, cellBlock, displayGridRows, visibleHeaders)) {
            classes.push('csv-cell--range')
          }
          if (selectedCell?.rowId === row.id && selectedCell.columnKey === h && !cellBlock) {
            classes.push('csv-cell--focus')
          }
          return classes.length > 0 ? classes.join(' ') : undefined
        },
        renderHeaderCell: () => (
          <div className="csv-tools-surface__col-header">
            <button
              type="button"
              className="csv-tools-surface__col-name"
              title={localizedText(t, 'table.clickSelectCol', 'Click to select column')}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleColumnSelected(h, event.shiftKey || event.metaKey || event.ctrlKey)
              }}
            >
              <span className="csv-tools-surface__col-name-text">{h}</span>
            </button>
            <button
              type="button"
              className={`csv-tools-surface__col-sort${dir ? ' is-on' : ''}`}
              title={localizedText(t, 'table.clickSort', 'Click to sort')}
              aria-label={localizedText(t, 'table.clickSort', 'Click to sort')}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                cycleSort(h)
              }}
            >
              {dir === 'ASC' ? <IconSortAsc /> : dir === 'DESC' ? <IconSortDesc /> : <IconSortNone />}
            </button>
          </div>
        ),
        renderCell: ({ row }: { row: CsvGridRow }) => (
          <div
            className="csv-tools-surface__cell"
            onMouseEnter={() => {
              const drag = dragSelectRef.current
              if (!drag?.active) return
              setCellBlock({
                start: drag.start,
                end: { rowId: row.id, columnKey: h },
              })
              setSelectedColumns(new Set())
            }}
          >
            {String(row[h] ?? '')}
          </div>
        ),
      }
    })
  }, [
    cellBlock,
    cycleSort,
    displayGridRows,
    selectedCell,
    selectedColumns,
    sortDirFor,
    t,
    toggleColumnSelected,
    visibleHeaders,
  ])

  const delimiterOptions = [
    { value: 'auto', label: localizedText(t, 'delimiter.auto', 'Auto') },
    { value: 'comma', label: localizedText(t, 'delimiter.comma', 'Comma') },
    { value: 'tab', label: localizedText(t, 'delimiter.tab', 'Tab') },
    { value: 'semicolon', label: localizedText(t, 'delimiter.semicolon', 'Semicolon') },
    { value: 'pipe', label: localizedText(t, 'delimiter.pipe', 'Pipe') },
  ]

  const headerOptions = [
    { value: 'auto', label: localizedText(t, 'header.auto', 'Auto') },
    { value: 'first-row', label: localizedText(t, 'header.firstRow', 'First row') },
    { value: 'no-header', label: localizedText(t, 'header.none', 'No header') },
  ]

  const outputOptions = [
    { value: 'objects', label: localizedText(t, 'output.objects', 'JSON objects') },
    { value: 'array', label: localizedText(t, 'output.array', '2D array') },
    { value: 'columns', label: localizedText(t, 'output.columns', 'Column arrays') },
    { value: 'keyed', label: localizedText(t, 'output.keyed', 'Keyed object') },
    { value: 'ndjson', label: localizedText(t, 'output.ndjson', 'JSON Lines') },
    { value: 'csv', label: localizedText(t, 'output.csv', 'CSV') },
    { value: 'tsv', label: localizedText(t, 'output.tsv', 'TSV') },
    { value: 'markdown', label: localizedText(t, 'output.markdown', 'Markdown') },
    { value: 'sql', label: localizedText(t, 'output.sql', 'SQL INSERT') },
  ]

  const writeClipboard = useCallback(
    async (text: string, complete = false) => {
      const lifetime = returnLifetimeRef.current
      if (!lifetime.active || lifetime.host !== host || (complete && pendingCopiesRef.current > 0)) return
      cancelReturn()
      const revision = resultRevisionRef.current
      const isCurrent = () => lifetime.active && lifetime.host === host && resultRevisionRef.current === revision
      pendingCopiesRef.current += 1
      try {
        await host.clipboard.writeText(text)
        if (!isCurrent()) return
        host.showMessage(localizedText(t, 'toast.copied', 'Copied'), 'success')
        if (complete) host.complete()
      } catch {
        if (!isCurrent()) return
        try {
          await navigator.clipboard.writeText(text)
          if (!isCurrent()) return
          host.showMessage(localizedText(t, 'toast.copied', 'Copied'), 'success')
          if (complete) host.complete()
        } catch {
          if (isCurrent()) host.showMessage(localizedText(t, 'toast.copyFailed', 'Copy failed'), 'error')
        }
      } finally {
        pendingCopiesRef.current -= 1
      }
    },
    [cancelReturn, host, t],
  )

  const copySelection = useCallback(async () => {
    if (!table || !canCopyOutput || resultRevision !== resultRevisionRef.current || fileReadRef.current) return
    if (cellBlock) {
      await writeClipboard(blockToTsv(cellBlock, displayGridRows, visibleHeaders))
      return
    }
    if (selectedColumns.size > 0) {
      const cols = visibleHeaders.filter((h) => selectedColumns.has(h))
      const body = displayGridRows.map((row) => cols.map((h) => String(row[h] ?? '')).join('\t'))
      await writeClipboard([cols.join('\t'), ...body].join('\n'))
      return
    }
    if (selectedCell) {
      const row = displayGridRows.find((r) => r.id === selectedCell.rowId)
      if (row) await writeClipboard(String(row[selectedCell.columnKey] ?? ''))
    }
  }, [canCopyOutput, cellBlock, displayGridRows, resultRevision, selectedCell, selectedColumns, table, visibleHeaders, writeClipboard])

  const handleCellCopy = useCallback(
    (args: CellCopyArgs<CsvGridRow>, event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (!table || !canCopyOutput || resultRevision !== resultRevisionRef.current || fileReadRef.current) return
      if (cellBlock) {
        const tsv = blockToTsv(cellBlock, displayGridRows, visibleHeaders)
        event.clipboardData.setData('text/plain', tsv)
        void writeClipboard(tsv)
        return
      }
      if (selectedColumns.size > 0) {
        const cols = visibleHeaders.filter((h) => selectedColumns.has(h))
        const body = displayGridRows.map((row) => cols.map((h) => String(row[h] ?? '')).join('\t'))
        const tsv = [cols.join('\t'), ...body].join('\n')
        event.clipboardData.setData('text/plain', tsv)
        void writeClipboard(tsv)
        return
      }
      const value = String(args.row[args.column.key] ?? '')
      event.clipboardData.setData('text/plain', value)
      void writeClipboard(value)
    },
    [canCopyOutput, cellBlock, displayGridRows, resultRevision, selectedColumns, table, visibleHeaders, writeClipboard],
  )

  const handleCellKeyDown = useCallback(
    (_args: CellKeyDownArgs<CsvGridRow>, event: CellKeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventGridDefault()
        event.preventDefault()
        void copySelection()
      }
      if (event.key === 'Escape') {
        setCellBlock(null)
        setSelectedColumns(new Set())
      }
    },
    [copySelection],
  )

  const handleCellMouseDown = useCallback(
    (args: CellMouseArgs<CsvGridRow>, event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // Don't start drag-select from interactive controls inside cell
      if ((event.target as HTMLElement).closest('input, button, a, label')) return

      const start = { rowId: args.row.id, columnKey: args.column.key }
      dragSelectRef.current = { active: true, start }
      setSelectedCell(start)
      setCellBlock(null)
      setSelectedColumns(new Set())
    },
    [],
  )

  const handleCellClick = useCallback(
    (args: CellMouseArgs<CsvGridRow>, event: React.MouseEvent<HTMLDivElement>) => {
      const rowId = args.row.id
      const columnKey = args.column.key
      // Shift+click still expands block for power users
      if (event.shiftKey && selectedCell) {
        setCellBlock({
          start: selectedCell,
          end: { rowId, columnKey },
        })
        setSelectedColumns(new Set())
        return
      }
      // If we just finished a drag, keep the block
      if (cellBlock) return
      setSelectedCell({ rowId, columnKey })
    },
    [cellBlock, selectedCell],
  )

  useEffect(() => {
    const endDrag = () => {
      if (dragSelectRef.current) dragSelectRef.current.active = false
    }
    window.addEventListener('mouseup', endDrag)
    window.addEventListener('blur', endDrag)
    return () => {
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('blur', endDrag)
    }
  }, [])

  const copyFullOutput = useCallback(() => {
    try {
      const text = getCompleteOutput()
      if (text !== null) void writeClipboard(text, true)
    } catch {
      host.showMessage(localizedText(t, 'toast.copyFailed', 'Copy failed'), 'error')
    }
  }, [getCompleteOutput, host, t, writeClipboard])

  const handleCopyPrimary = useCallback(() => {
    if (resultRevision !== resultRevisionRef.current || fileReadRef.current) return
    if (mainView === 'source') {
      void writeClipboard(sourceText)
      return
    }
    if (!canCopyOutput) return
    if (mainView === 'table' && (selectedCell || selectedColumns.size > 0 || cellBlock)) {
      void copySelection()
      return
    }
    copyFullOutput()
  }, [canCopyOutput, cellBlock, copyFullOutput, copySelection, mainView, resultRevision, selectedCell, selectedColumns.size, sourceText, writeClipboard])

  // Row identities belong to the current final result; a query edit must not
  // leave a cell or range pointing at a different row. Conditions stay intact.
  useEffect(() => {
    setSelectedCell(null)
    setSelectedColumns(new Set())
    setCellBlock(null)
  }, [sourceText, resultParameters])

  const showTruncationBanner = needsFullProcess || returnNeedsFullProcess

  return (
    <section
      className="csv-tools-surface"
      aria-label={localizedText(t, 'surface.title', 'CSV Tools')}
      data-no-drag
      data-launcher-scrollable
    >
      <header className="csv-tools-surface__header">
        <IconButton
          type="button"
          className="csv-tools-surface__back"
          label={localizedText(t, 'action.back', 'Back')}
          onClick={() => updateResult(() => host.requestBack())}
        >
          <BackIcon size={14} strokeWidth={2} />
          <span className="csv-tools-surface__back-root">hiven</span>
        </IconButton>
        <span className="csv-tools-surface__sep">/</span>
        <span className="csv-tools-surface__crumb">{localizedText(t, 'surface.title', 'CSV Tools')}</span>
        {finalTable ? <span className="csv-tools-surface__meta">{sizeLabel}</span> : null}
        {delimiterHint ? <span className="csv-tools-surface__meta mono">{delimiterHint}</span> : null}
        {linkedFileLabel ? (
          <span className="csv-tools-surface__meta" title={linkedFileLabel}>
            {fileNameFromPath(linkedFileLabel)}
          </span>
        ) : null}
        {(isParsing || isSourceStale) && (
          <span className="csv-tools-surface__meta csv-tools-surface__meta--busy">
            {localizedText(t, 'meta.updating', 'Updating…')}
          </span>
        )}

        <div className="csv-tools-surface__header-spacer" />

        <div className="csv-tools-surface__actions">
          <button
            type="button"
            className="csv-tools-surface__file-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            <IconFolder />
            <span>{localizedText(t, 'action.openFile', 'Open file')}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            hidden
            onChange={(event) => void onFilePicked(event)}
          />
          <IconButton
            type="button"
            className="csv-tools-surface__ib"
            label={mainView === 'table' && (selectedCell || selectedColumns.size > 0 || cellBlock)
              ? t('action.copySelection')
              : mainView === 'source'
                ? t('source.copyRaw')
                : t('action.copyFullOutput')}
            disabled={mainView === 'source' ? !sourceText || readingFile : !canCopyOutput}
            onClick={handleCopyPrimary}
          >
            <IconCopy />
          </IconButton>
          <button
            type="button"
            className="csv-tools-surface__file-btn"
            title={t(returnNeedsFullProcess && !fullReturnReady ? 'action.returnNeedsFull' : 'action.returnToSearchDescription')}
            disabled={!canReturnOutput || returning}
            onClick={() => void returnOutput()}
          >
            {t('action.returnToSearch')}
          </button>
          <IconButton
            type="button"
            className="csv-tools-surface__ib"
            label={localizedText(t, 'action.detach', 'Open in window')}
            onClick={() => updateResult(() => host.detachToWindow(sourceText))}
          >
            <IconDetach />
          </IconButton>
          <IconButton
            type="button"
            className="csv-tools-surface__ib csv-tools-surface__ib--close"
            label={localizedText(t, 'action.close', 'Close')}
            onClick={() => updateResult(() => host.close())}
          >
            <CloseIcon size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </header>

      {fileError ? (
        <div className="csv-tools-surface__banner is-error" role="alert">
          {localizedText(t, 'error.file', 'File error: {message}', { message: fileError })}
        </div>
      ) : null}

      {showTruncationBanner || fullJob.status === 'running' || fullJob.status === 'done' || fullJob.status === 'error' ? (
        <div
          role={fullJob.status === 'error' ? 'alert' : 'status'}
          className={
            fullJob.status === 'error'
              ? 'csv-tools-surface__banner is-error'
              : fullJob.status === 'done'
                ? 'csv-tools-surface__banner is-ok'
                : 'csv-tools-surface__banner is-warn'
          }
        >
          <div className="csv-tools-surface__banner-row">
            <div className="csv-tools-surface__banner-text">
              {fullJob.status === 'running' ? (
                <>
                  {localizedText(t, 'job.running', 'Processing full file… {pct}% ({phase})', {
                    pct: Math.round(fullJob.ratio * 100),
                    phase:
                      fullJob.phase === 'parse'
                        ? localizedText(t, 'job.phase.parse', 'parse')
                        : fullJob.phase === 'transform'
                          ? localizedText(t, 'job.phase.transform', 'transform')
                          : localizedText(t, 'job.phase.output', 'output'),
                  })}
                  <div className="csv-tools-surface__progress" aria-hidden="true">
                    <div className="csv-tools-surface__progress-bar" style={{ width: `${Math.round(fullJob.ratio * 100)}%` }} />
                  </div>
                </>
              ) : fullJob.status === 'done' ? (
                localizedText(
                  t,
                  'job.done',
                  'Final result ready: {rows} × {cols}, {size}. Copy, Return to Search and Download use this complete result.',
                  {
                    rows: fullJob.rows,
                    cols: fullJob.cols,
                    size: formatBytes(fullJob.bytes),
                  },
                )
              ) : fullJob.status === 'error' ? (
                localizedText(t, 'job.error', 'Full process failed: {message}', { message: fullJob.message })
              ) : (
                localizedText(
                  t,
                  'meta.truncated',
                  'Source: ≈{total} lines, {size}. Process the full file to apply the current filters and sorting before previewing the result.',
                  {
                    total: estimatedLines,
                    size: formatBytes(sourceText.length),
                  },
                )
              )}
            </div>
            <div className="csv-tools-surface__banner-actions">
              {fullJob.status === 'running' ? (
                <button type="button" className="csv-tools-surface__file-btn" onClick={cancelFullProcess}>
                  {localizedText(t, 'job.cancel', 'Cancel')}
                </button>
              ) : fullJob.status === 'done' ? (
                <>
                  <button
                    type="button"
                    className="csv-tools-surface__file-btn csv-tools-surface__file-btn--primary"
                    disabled={!canCopyOutput}
                    onClick={copyFullOutput}
                  >
                    {localizedText(t, 'job.copyFull', 'Copy full')}
                  </button>
                  <button type="button" className="csv-tools-surface__file-btn" disabled={!canCopyOutput} onClick={downloadFullResult}>
                    <IconDownload />
                    <span>{localizedText(t, 'job.download', 'Download')}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="csv-tools-surface__file-btn csv-tools-surface__file-btn--primary"
                  disabled={Boolean(errorMessage || filterError) || !sourceText.trim() || !currentInputReady}
                  onClick={() => void runFullProcess()}
                >
                  {localizedText(t, 'job.runFull', 'Process full file')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="csv-tools-surface__toolbar"
        aria-label={localizedText(t, 'toolbar.parameters', 'CSV parameters')}
      >
        <div className="csv-tools-surface__control-group">
          <span className="csv-tools-surface__control-title">
            {localizedText(t, 'toolbar.read', 'Read')}
          </span>
          <div className="csv-tools-surface__toolbar-group">
            <label className="csv-tools-surface__field">
              <span>{localizedText(t, 'param.delimiter', 'Delimiter')}</span>
              <Select
                className="csv-tools-surface__native-select"
                value={delimiter}
                disabled={isJsonInput}
                options={delimiterOptions}
                aria-label={localizedText(t, 'param.delimiter', 'Delimiter')}
                onChange={(event) => updateResult(() => setDelimiter(event.target.value as DelimiterMode))}
              />
            </label>

            <label className="csv-tools-surface__field">
              <span>{localizedText(t, 'param.header', 'Header')}</span>
              <Select
                className="csv-tools-surface__native-select"
                value={header}
                disabled={isJsonInput}
                options={headerOptions}
                aria-label={localizedText(t, 'param.header', 'Header')}
                onChange={(event) => updateResult(() => setHeader(event.target.value as HeaderMode))}
              />
            </label>
          </div>
        </div>

        <div className="csv-tools-surface__control-group">
          <span className="csv-tools-surface__control-title">
            {localizedText(t, 'toolbar.convert', 'Convert')}
          </span>
          <div className="csv-tools-surface__toolbar-group">
            <label className="csv-tools-surface__field">
              <span>{localizedText(t, 'param.output', 'Output')}</span>
              <Select
                className="csv-tools-surface__native-select"
                value={output}
                options={outputOptions}
                aria-label={localizedText(t, 'param.output', 'Output')}
                onChange={(event) => {
                  updateResult(() => setOutput(event.target.value as OutputMode))
                  setMainView('output')
                }}
              />
            </label>

            {showJsonStyle && mainView === 'output' && (
              <Checkbox
                checked={minify}
                onChange={(event) => updateResult(() => setMinify((event.target as HTMLInputElement).checked))}
              >
                {localizedText(t, 'param.minify', 'Minify')}
              </Checkbox>
            )}
            {showJsonStyle && mainView === 'output' && !minify && (
                <label className="csv-tools-surface__field">
                  <span>{localizedText(t, 'param.indent', 'Indent')}</span>
                  <Select
                    className="csv-tools-surface__native-select"
                    value={String(indent)}
                    options={[
                      { value: '2', label: '2' },
                      { value: '4', label: '4' },
                    ]}
                    aria-label={localizedText(t, 'param.indent', 'Indent')}
                    onChange={(event) => updateResult(() => setIndent(event.target.value === '4' ? 4 : 2))}
                  />
                </label>
            )}

            {output === 'sql' && mainView === 'output' && (
              <label className="csv-tools-surface__field">
                <span>{localizedText(t, 'param.tableName', 'Table name')}</span>
                <input
                  type="text"
                  className="csv-tools-surface__text"
                  value={tableName}
                  onChange={(event) => updateResult(() => setTableName(event.target.value))}
                  spellCheck={false}
                />
              </label>
            )}
          </div>
        </div>

        <div className="csv-tools-surface__control-group csv-tools-surface__control-group--transform">
          <span className="csv-tools-surface__control-title">
            {localizedText(t, 'toolbar.clean', 'Shape')}
          </span>
          <div className="csv-tools-surface__transform-checks">
            <Checkbox checked={dropEmpty} onChange={(event) => updateResult(() => setDropEmpty((event.target as HTMLInputElement).checked))}>
              {localizedText(t, 'transform.dropEmpty', 'Drop empty rows')}
            </Checkbox>
            <Checkbox checked={dedupe} onChange={(event) => updateResult(() => setDedupe((event.target as HTMLInputElement).checked))}>
              {localizedText(t, 'transform.dedupe', 'Deduplicate')}
            </Checkbox>
            <Checkbox checked={transpose} onChange={(event) => updateResult(() => setTranspose((event.target as HTMLInputElement).checked))}>
              {localizedText(t, 'transform.transpose', 'Transpose')}
            </Checkbox>
          </div>
        </div>
      </div>

      <div className="csv-tools-surface__viewbar">
        <SegmentedControl
          aria-label={localizedText(t, 'pane.view', 'View')}
          value={mainView}
          onChange={(value) => setMainView(value as MainView)}
          options={[
            { value: 'table', label: localizedText(t, 'pane.table', 'Table') },
            { value: 'output', label: localizedText(t, 'pane.output', 'Output') },
            { value: 'source', label: localizedText(t, 'pane.source', 'Source') },
          ]}
        />
        {mainView === 'table' && (selectedColumns.size > 0 || cellBlock) ? (
          <span className="csv-tools-surface__tab-hint">
            {cellBlock
              ? localizedText(t, 'meta.selectedBlock', 'Block selected')
              : localizedText(t, 'meta.selectedCols', '{count} columns', { count: selectedColumns.size })}
            {finalTable
              ? ` · ${localizedText(t, 'table.previewScope', '{total} result rows · previewing {shown}', {
                  shown: displayGridRows.length,
                  total: totalDataRows,
                })}`
              : ''}
          </span>
        ) : (
          <span className="csv-tools-surface__tab-hint mono">
            {formatBytes(sourceText.length)}
            {estimatedLines > 0
              ? ` · ${localizedText(t, 'meta.estimatedLines', '~{count} lines', {
                  count: estimatedLines.toLocaleString(),
                })}`
              : ''}
            {mainView === 'table' && finalTable
              ? ` · ${localizedText(t, 'table.previewScope', '{total} result rows · previewing {shown}', { shown: displayGridRows.length, total: totalDataRows })}`
              : ''}
          </span>
        )}
      </div>

      <div className="csv-tools-surface__body csv-tools-surface__body--single">
        {mainView === 'table' ? (
          <div className="csv-tools-surface__grid-wrap" data-no-drag data-launcher-scrollable>
            {errorMessage ? (
              <div className="csv-tools-surface__empty is-error" role="alert">
                {errorMessage}
              </div>
            ) : table && table.headers.length > 0 ? (
              <>
                <div className="csv-tools-surface__table-tools" data-no-drag>
                  <SegmentedControl
                    aria-label={localizedText(t, 'table.filterMode', 'Filter mode')}
                    value={filterMode}
                    onChange={(value) => {
                      const next = value as 'text' | 'sql'
                      updateResult(() => {
                        setFilterMode(next)
                        if (next === 'sql' && !sqlFilter.trim()) {
                          const starter = defaultSqlTemplate(tableHeaders)
                          setSqlFilter(starter)
                          setSqlCursor(starter.length)
                          setSqlSuggestOpen(true)
                        }
                      })
                    }}
                    options={[
                      { value: 'text', label: localizedText(t, 'table.filterModeText', 'Text') },
                      { value: 'sql', label: localizedText(t, 'table.filterModeSql', 'SQL') },
                    ]}
                  />
                  {filterMode === 'text' ? (
                    <SearchField
                      className="csv-tools-surface__filter"
                      value={globalFilter}
                      onChange={(event) => updateResult(() => setGlobalFilter(event.target.value))}
                      placeholder={localizedText(t, 'table.filterPlaceholder', 'Filter rows…')}
                      aria-label={localizedText(t, 'table.filterPlaceholder', 'Filter rows…')}
                    />
                  ) : (
                    <div className="csv-tools-surface__sql-wrap">
                      <TextInput
                        ref={sqlInputRef}
                        className="csv-tools-surface__filter csv-tools-surface__filter--sql"
                        value={sqlFilter}
                        onChange={(event) => {
                          const el = event.target
                          updateResult(() => setSqlFilter(el.value))
                          setSqlCursor(el.selectionStart ?? el.value.length)
                          setSqlSuggestOpen(true)
                          setSqlSuggestIndex(0)
                        }}
                        onClick={(event) => {
                          const el = event.currentTarget
                          setSqlCursor(el.selectionStart ?? el.value.length)
                          setSqlSuggestOpen(true)
                        }}
                        onKeyUp={(event) => {
                          const el = event.currentTarget
                          setSqlCursor(el.selectionStart ?? el.value.length)
                        }}
                        onFocus={() => setSqlSuggestOpen(true)}
                        onBlur={() => {
                          // delay so mousedown on suggestion can fire
                          window.setTimeout(() => setSqlSuggestOpen(false), 120)
                        }}
                        onKeyDown={(event) => {
                          if (!sqlSuggestOpen || sqlCompletions.items.length === 0) return
                          if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            setSqlSuggestIndex((i) => (i + 1) % sqlCompletions.items.length)
                            return
                          }
                          if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            setSqlSuggestIndex(
                              (i) => (i - 1 + sqlCompletions.items.length) % sqlCompletions.items.length,
                            )
                            return
                          }
                          if (event.key === 'Enter' || event.key === 'Tab') {
                            const item = sqlCompletions.items[sqlSuggestIndex]
                            if (item) {
                              event.preventDefault()
                              applySqlCompletion(item)
                            }
                            return
                          }
                          if (event.key === 'Escape') {
                            setSqlSuggestOpen(false)
                          }
                        }}
                        placeholder={localizedText(
                          t,
                          'table.sqlPlaceholder',
                          'SELECT name, age FROM data WHERE age > 28',
                        )}
                        aria-label={localizedText(t, 'table.sqlPlaceholder', 'SQL query')}
                        aria-autocomplete="list"
                        aria-expanded={sqlSuggestOpen}
                        spellCheck={false}
                        autoComplete="off"
                      />
                      {sqlSuggestOpen && sqlCompletions.items.length > 0 ? (
                        <ul className="csv-tools-surface__sql-suggest" role="listbox">
                          {sqlCompletions.items.map((item, index) => (
                            <li key={`${item.kind}-${item.label}-${index}`}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={index === sqlSuggestIndex}
                                className={
                                  index === sqlSuggestIndex
                                    ? 'csv-tools-surface__sql-suggest-item is-active'
                                    : 'csv-tools-surface__sql-suggest-item'
                                }
                                onMouseDown={(event) => {
                                  event.preventDefault()
                                  applySqlCompletion(item)
                                }}
                                onMouseEnter={() => setSqlSuggestIndex(index)}
                              >
                                <span className="csv-tools-surface__sql-suggest-label">{item.label}</span>
                                {item.detail ? (
                                  <span className="csv-tools-surface__sql-suggest-detail">{item.detail}</span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                  <span className="csv-tools-surface__table-hint" title={t('table.filterScope')}>
                    {finalTable
                      ? localizedText(t, 'table.previewScope', '{total} result rows · previewing {shown}', { shown: displayGridRows.length, total: totalDataRows })
                      : t(filterError ? 'table.invalidQuery' : 'table.pendingFull')}
                  </span>
                  {(selectedColumns.size > 0 ||
                    cellBlock ||
                    globalFilter ||
                    sqlFilter ||
                    sortColumns.length > 0) && (
                    <button
                      type="button"
                      className="csv-tools-surface__file-btn"
                      onClick={() => {
                        setSelectedColumns(new Set())
                        setCellBlock(null)
                        setSelectedCell(null)
                        if (globalFilter || sqlFilter || sortColumns.length > 0) {
                          updateResult(() => {
                            setGlobalFilter('')
                            setSqlFilter('')
                            setSortColumns([])
                          })
                        }
                      }}
                    >
                      {localizedText(t, 'table.clearSelection', 'Clear')}
                    </button>
                  )}
                </div>
                {filterError ? (
                  <div className="csv-tools-surface__filter-error" role="alert">
                    {localizedText(t, 'table.sqlError', 'SQL: {message}', { message: filterError })}
                  </div>
                ) : null}
                <div className="csv-tools-surface__grid-host" data-no-drag data-launcher-scrollable>
                  <DataGrid
                    className="csv-tools-surface__grid"
                    columns={gridColumns}
                    rows={displayGridRows}
                    rowKeyGetter={(row: CsvGridRow) => row.id}
                    onCellMouseDown={handleCellMouseDown}
                    onCellClick={handleCellClick}
                    onSelectedCellChange={(args: CellSelectArgs<CsvGridRow>) => {
                      if (!args.row) return
                      if (!cellBlock && !dragSelectRef.current?.active) {
                        setSelectedCell({ rowId: args.row.id, columnKey: args.column.key })
                      }
                    }}
                    onCellCopy={handleCellCopy}
                    onCellKeyDown={handleCellKeyDown}
                    defaultColumnOptions={{ resizable: true, sortable: false }}
                    style={{ height: '100%', width: '100%', blockSize: '100%' }}
                    rowHeight={32}
                    headerRowHeight={36}
                  />
                </div>
              </>
            ) : (
              <div className="csv-tools-surface__empty csv-tools-surface__empty--start">
                <span className="csv-tools-surface__empty-mark" aria-hidden="true">CSV</span>
                <strong>{localizedText(t, 'empty.title', 'Start with table data')}</strong>
                <p>{localizedText(t, 'empty.source', 'Paste CSV, TSV, or a JSON array of objects')}</p>
                <div className="csv-tools-surface__empty-actions">
                  <button
                    type="button"
                    className="csv-tools-surface__file-btn csv-tools-surface__file-btn--primary"
                    onClick={() => setMainView('source')}
                  >
                    {localizedText(t, 'empty.enterSource', 'Enter source')}
                  </button>
                  <button
                    type="button"
                    className="csv-tools-surface__file-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <IconFolder />
                    <span>{localizedText(t, 'action.openFile', 'Open file')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {mainView === 'output' ? (
          <div className="csv-tools-surface__output-wrap">
            {sortColumns.length > 0 || (filterMode === 'text' ? globalFilter : sqlFilter).trim() ? (
              <div className="csv-tools-surface__output-hint">{t('table.filterScope')}</div>
            ) : null}
            <div className="csv-tools-surface__output-hint">
              {finalTable
                ? localizedText(t, 'job.outputHint', '{total} result rows · previewing up to {shown}. Copy, Return to Search and Download use the complete result.', {
                    total: totalDataRows,
                    shown: outputPreviewTable?.rows.length ?? 0,
                  })
                : !errorMessage && !filterError && tableFull ? t('table.pendingFull') : ''}
            </div>
            <pre className={errorMessage || filterError ? 'is-error' : undefined}>
              {errorMessage || (filterError ? localizedText(t, 'table.sqlError', 'SQL: {message}', { message: filterError }) : outputText)}
            </pre>
          </div>
        ) : null}

        {mainView === 'source' ? (
          sourceTooBigForEditor && !sourceEditUnlocked ? (
            <div className="csv-tools-surface__source-guard">
              <div className="csv-tools-surface__source-guard-title">
                {localizedText(t, 'source.largeTitle', 'Source is large')}
              </div>
              <p className="csv-tools-surface__source-guard-body">
                {localizedText(
                  t,
                  'source.largeBody',
                  'Editing {size} of text in the browser may freeze the UI. Use Process full file to calculate the complete result; the table and output views show limited previews.',
                  { size: formatBytes(sourceText.length) },
                )}
              </p>
              <div className="csv-tools-surface__source-guard-actions">
                <button
                  type="button"
                  className="csv-tools-surface__file-btn csv-tools-surface__file-btn--primary"
                  onClick={() => setSourceEditUnlocked(true)}
                >
                  {localizedText(t, 'source.unlockEdit', 'Edit anyway')}
                </button>
                <button
                  type="button"
                  className="csv-tools-surface__file-btn"
                  onClick={() => void writeClipboard(sourceText)}
                >
                  {localizedText(t, 'source.copyRaw', 'Copy raw source')}
                </button>
              </div>
            </div>
          ) : (
            <textarea
              value={sourceText}
              onChange={(event) => {
                const next = event.target.value
                updateResult(() => {
                  invalidateFullJob()
                  setSourceText(next)
                  setLinkedFileLabel(undefined)
                })
              }}
              spellCheck={false}
              placeholder={localizedText(t, 'empty.source', 'Paste CSV, TSV, or a JSON array of objects')}
            />
          )
        ) : null}
      </div>
    </section>
  )
}
