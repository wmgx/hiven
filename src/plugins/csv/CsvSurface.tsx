import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
} from './csvCore'
import {
  defaultSqlTemplate,
  filterRowsBySql,
  filterRowsByText,
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

function rowsToTsv(headers: string[], rows: CsvGridRow[]): string {
  const lines = [
    headers.join('\t'),
    ...rows.map((row) => headers.map((h) => String(row[h] ?? '')).join('\t')),
  ]
  return lines.join('\n')
}

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

export function CsvSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initial = resolveInitialSource(props.initialText)
  const [sourceText, setSourceText] = useState(initial.source)
  const [linkedFileLabel, setLinkedFileLabel] = useState<string | undefined>(initial.fileLabel)
  const [fileError, setFileError] = useState<string | null>(null)
  const [delimiter, setDelimiter] = useState<DelimiterMode>('auto')
  const [header, setHeader] = useState<HeaderMode>('auto')
  const [output, setOutput] = useState<OutputMode>('objects')
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
  const [mainView, setMainView] = useState<MainView>('table')
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
  const fullJobKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        delimiter,
        header,
        output,
        minify,
        indent,
        tableName,
        dropEmpty,
        dedupe,
        transpose,
      ].join('|'),
    [dedupe, delimiter, dropEmpty, header, indent, minify, output, sourceText, tableName, transpose],
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
    fullJobKeyRef.current = ''
    setFullJob({ status: 'idle' })
  }, [])

  const onFilePicked = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setFileError(null)
    try {
      const content = await file.text()
      startParseTransition(() => {
        invalidateFullJob()
        setSourceText(content)
        setLinkedFileLabel(file.name)
        setSourceEditUnlocked(content.length <= SOURCE_TEXTAREA_MAX_CHARS)
        setSelectedCell(null)
        setMainView('table')
      })
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error))
    }
  }, [invalidateFullJob])

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

  const parseTruncated =
    Boolean(parseLimits) &&
    parsed.ok &&
    (estimatedLines > (tableFull?.rows.length ?? 0) + 2 ||
      (tableFull !== null && tableFull.rows.length >= PARSE_MAX_ROWS))

  const gridSlice = useMemo(() => {
    if (!tableFull) return null
    return sliceTable(tableFull, GRID_MAX_ROWS)
  }, [tableFull])

  const table = gridSlice?.table ?? null
  const gridTruncated = gridSlice?.truncated ?? false
  const totalDataRows = gridSlice?.totalRows ?? tableFull?.rows.length ?? 0

  const outputPreviewTable = useMemo(() => {
    if (!tableFull) return null
    return sliceTable(tableFull, OUTPUT_PREVIEW_MAX_ROWS).table
  }, [tableFull])

  // Only build heavy output strings when viewing output; small tables precompute for instant copy
  const outputText = useMemo(() => {
    if (!tableFull) return ''
    if (mainView !== 'output') {
      if (isLargeSource || tableFull.rows.length > OUTPUT_PREVIEW_MAX_ROWS) return ''
      try {
        return toOutput(tableFull, output, { minify, indent }, { tableName })
      } catch {
        return ''
      }
    }
    if (!outputPreviewTable) return ''
    try {
      return toOutput(outputPreviewTable, output, { minify, indent }, { tableName })
    } catch {
      return ''
    }
  }, [indent, isLargeSource, mainView, minify, output, outputPreviewTable, tableFull, tableName])

  const outputTruncated =
    Boolean(tableFull) && tableFull!.rows.length > OUTPUT_PREVIEW_MAX_ROWS && mainView === 'output'

  /** True when preview parse did not cover the whole source — needs async full pipeline. */
  const needsFullProcess = Boolean(parseTruncated)
  const fullJobReady =
    fullJob.status === 'done' && fullJobKeyRef.current === jobFingerprint && Boolean(fullOutputRef.current)

  const runFullProcess = useCallback(async () => {
    if (fullJob.status === 'running') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFullJob({ status: 'running', ratio: 0, phase: 'parse' })
    fullOutputRef.current = null
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
        },
        {
          signal: controller.signal,
          onProgress: (p) => {
            setFullJob({ status: 'running', ratio: p.ratio, phase: p.phase })
          },
        },
      )
      if (controller.signal.aborted) return
      fullOutputRef.current = result.output
      fullJobKeyRef.current = jobFingerprint
      setFullJob({
        status: 'done',
        rows: result.rowCount,
        cols: result.colCount,
        bytes: result.output.length,
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
      if (error instanceof Error && error.name === 'AbortError') {
        setFullJob({ status: 'idle' })
        return
      }
      setFullJob({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    dedupe,
    delimiter,
    dropEmpty,
    fullJob.status,
    header,
    host,
    indent,
    jobFingerprint,
    minify,
    output,
    sourceText,
    t,
    tableName,
    transpose,
  ])

  const cancelFullProcess = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setFullJob({ status: 'idle' })
  }, [])

  const downloadFullResult = useCallback(() => {
    const text = fullOutputRef.current
    if (!text) return
    const base = linkedFileLabel
      ? fileNameFromPath(linkedFileLabel).replace(/\.[^.]+$/, '')
      : 'csv-export'
    downloadTextFile(`${base}.${outputExtension(output)}`, text)
  }, [linkedFileLabel, output])

  const errorMessage = !parsed.ok
    ? localizedText(t, 'error.generic', 'Parse error: {message}', { message: parsed.message })
    : ''

  const cols = tableFull?.headers.length ?? 0
  const displayRows = fullJobReady && fullJob.status === 'done' ? fullJob.rows : totalDataRows
  const sizeLabel = localizedText(t, 'meta.size', '{rows} × {cols}', {
    rows: displayRows,
    cols: fullJobReady && fullJob.status === 'done' ? fullJob.cols : cols,
  })

  const delimiterHint =
    parsed.ok && parsed.kind === 'csv' && parsed.delimiter
      ? parsed.delimiter === '\t'
        ? 'TAB'
        : parsed.delimiter
      : null

  const showJsonStyle = JSON_OUTPUTS.includes(output)
  const isJsonInput = parsed.ok && parsed.kind === 'json'
  const canCopyOutput = Boolean(tableFull) && !errorMessage

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

  const tableHeaders = table?.headers ?? []

  const sqlFilterResult = useMemo(() => {
    if (filterMode !== 'sql' || !sqlFilter.trim()) return null
    const plain = gridRows.map((row) => {
      const rec: Record<string, string> = {}
      for (const h of tableHeaders) rec[h] = String(row[h] ?? '')
      return rec
    })
    return filterRowsBySql(plain, tableHeaders, sqlFilter)
  }, [filterMode, gridRows, sqlFilter, tableHeaders])

  const filterError =
    sqlFilterResult && !sqlFilterResult.ok ? sqlFilterResult.message : null

  /** Columns visible in the grid (SQL SELECT projection or full table). */
  const visibleHeaders = useMemo(() => {
    if (filterMode === 'sql' && sqlFilter.trim() && sqlFilterResult?.ok && sqlFilterResult.columns) {
      return sqlFilterResult.columns
    }
    return tableHeaders
  }, [filterMode, sqlFilter, sqlFilterResult, tableHeaders])

  const sqlCompletions = useMemo(() => {
    if (filterMode !== 'sql') return { items: [] as SqlCompletionItem[], from: 0, to: 0 }
    return getSqlCompletions(sqlFilter, sqlCursor, tableHeaders)
  }, [filterMode, sqlCursor, sqlFilter, tableHeaders])

  const applySqlCompletion = useCallback(
    (item: SqlCompletionItem) => {
      const { from, to } = sqlCompletions
      const next = sqlFilter.slice(0, from) + item.insertText + sqlFilter.slice(to)
      const caret = from + item.insertText.length
      setSqlFilter(next)
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
    [sqlCompletions, sqlFilter],
  )

  const displayGridRows = useMemo((): CsvGridRow[] => {
    // gridRows use id = original row index — filter indexes match id
    let rows = gridRows
    if (filterMode === 'sql' && sqlFilter.trim()) {
      if (sqlFilterResult?.ok) {
        // Preserve SQL ORDER BY / LIMIT order from rowIndexes
        const byId = new Map(gridRows.map((row) => [row.id, row]))
        rows = sqlFilterResult.rowIndexes
          .map((id) => byId.get(id))
          .filter((row): row is CsvGridRow => Boolean(row))
      } else {
        rows = []
      }
    } else if (filterMode === 'text' && globalFilter.trim()) {
      const plain = gridRows.map((row) => {
        const rec: Record<string, string> = {}
        for (const h of tableHeaders) rec[h] = String(row[h] ?? '')
        return rec
      })
      const indexes = new Set(filterRowsByText(plain, tableHeaders, globalFilter))
      rows = gridRows.filter((row) => indexes.has(row.id))
    }
    // UI header sort only when SQL didn't already order (or always allow override)
    if (sortColumns.length > 0) {
      const sorted = [...rows]
      sorted.sort((a, b) => {
        for (const sc of sortColumns) {
          const av = String(a[sc.columnKey] ?? '')
          const bv = String(b[sc.columnKey] ?? '')
          const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
          if (cmp !== 0) return sc.direction === 'ASC' ? cmp : -cmp
        }
        return 0
      })
      rows = sorted
    }
    return rows
  }, [filterMode, globalFilter, gridRows, sortColumns, sqlFilter, sqlFilterResult, tableHeaders])

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
    setSortColumns((prev) => {
      const existing = prev.find((s) => s.columnKey === columnKey)
      if (!existing) return [{ columnKey, direction: 'ASC' }]
      if (existing.direction === 'ASC') return [{ columnKey, direction: 'DESC' }]
      return prev.filter((s) => s.columnKey !== columnKey)
    })
  }, [])

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
    async (text: string) => {
      if (!text) return
      try {
        await host.clipboard.writeText(text)
      } catch {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // ignore
        }
      }
    },
    [host.clipboard],
  )

  const copySelection = useCallback(async () => {
    if (!table) return
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
  }, [cellBlock, displayGridRows, selectedCell, selectedColumns, visibleHeaders, writeClipboard])

  const handleCellCopy = useCallback(
    (args: CellCopyArgs<CsvGridRow>, event: React.ClipboardEvent<HTMLDivElement>) => {
      if (!table) return
      event.preventDefault()
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
    [cellBlock, displayGridRows, selectedColumns, visibleHeaders, writeClipboard],
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

  const handleCopyPrimary = useCallback(() => {
    if (mainView === 'table' && (selectedCell || selectedColumns.size > 0 || cellBlock)) {
      void copySelection()
      return
    }
    if (mainView === 'source') {
      void writeClipboard(sourceText)
      return
    }
    // Prefer completed full-file result
    if (fullJobReady && fullOutputRef.current) {
      void writeClipboard(fullOutputRef.current)
      return
    }
    // Whole table already in memory (preview parse not truncated) → serialize full output
    if (!needsFullProcess && tableFull) {
      try {
        void writeClipboard(toOutput(tableFull, output, { minify, indent }, { tableName }))
      } catch {
        // ignore
      }
      return
    }
    // Preview-only: copy what we have (or prompt full process via banner)
    if (outputText) {
      void writeClipboard(outputText)
    }
  }, [
    cellBlock,
    copySelection,
    fullJobReady,
    indent,
    mainView,
    minify,
    needsFullProcess,
    output,
    outputText,
    selectedCell,
    selectedColumns.size,
    sourceText,
    tableFull,
    tableName,
    writeClipboard,
  ])

  // Clear selection when table shape changes
  useEffect(() => {
    setSelectedCell(null)
    setSelectedColumns(new Set())
    setCellBlock(null)
    setSortColumns([])
    setGlobalFilter('')
    setSqlFilter('')
  }, [tableFull?.headers.join('\0'), totalDataRows])

  // Invalidate full result when pipeline inputs change
  useEffect(() => {
    if (fullJobKeyRef.current && fullJobKeyRef.current !== jobFingerprint) {
      fullOutputRef.current = null
      fullJobKeyRef.current = ''
      if (fullJob.status === 'done' || fullJob.status === 'error') {
        setFullJob({ status: 'idle' })
      }
    }
  }, [fullJob.status, jobFingerprint])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const showTruncationBanner = needsFullProcess

  return (
    <section
      className="csv-tools-surface"
      aria-label="CSV Tools"
      data-no-drag
      data-launcher-scrollable
    >
      <header className="csv-tools-surface__header">
        <IconButton
          type="button"
          className="csv-tools-surface__back"
          label={localizedText(t, 'action.back', 'Back')}
          onClick={() => host.requestBack()}
        >
          <BackIcon size={14} strokeWidth={2} />
          <span className="csv-tools-surface__back-root">hiven</span>
        </IconButton>
        <span className="csv-tools-surface__sep">/</span>
        <span className="csv-tools-surface__crumb">{localizedText(t, 'surface.title', 'CSV Tools')}</span>
        {tableFull ? <span className="csv-tools-surface__meta">{sizeLabel}</span> : null}
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
            label={localizedText(t, 'action.copy', 'Copy')}
            disabled={
              !canCopyOutput &&
              selectedColumns.size === 0 &&
              !cellBlock &&
              !selectedCell &&
              !sourceText
            }
            onClick={handleCopyPrimary}
          >
            <IconCopy />
          </IconButton>
          <IconButton
            type="button"
            className="csv-tools-surface__ib"
            label={localizedText(t, 'action.detach', 'Open in window')}
            onClick={() => host.detachToWindow(sourceText)}
          >
            <IconDetach />
          </IconButton>
          <IconButton
            type="button"
            className="csv-tools-surface__ib csv-tools-surface__ib--close"
            label={localizedText(t, 'action.close', 'Close')}
            onClick={() => host.close()}
          >
            <CloseIcon size={14} strokeWidth={2} />
          </IconButton>
        </div>
      </header>

      {fileError ? (
        <div className="csv-tools-surface__banner is-error">
          {localizedText(t, 'error.file', 'File error: {message}', { message: fileError })}
        </div>
      ) : null}

      {showTruncationBanner || fullJob.status === 'running' || fullJob.status === 'done' || fullJob.status === 'error' ? (
        <div
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
                  'Full result ready: {rows} × {cols}, {size}. Copy or download uses the complete file.',
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
                  'Preview only (up to {shown} rows, ≈{total} lines, {size}). Run full process to convert the entire file.',
                  {
                    shown: Math.min(totalDataRows, PARSE_MAX_ROWS, GRID_MAX_ROWS),
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
                    onClick={() => void writeClipboard(fullOutputRef.current ?? '')}
                  >
                    {localizedText(t, 'job.copyFull', 'Copy full')}
                  </button>
                  <button type="button" className="csv-tools-surface__file-btn" onClick={downloadFullResult}>
                    <IconDownload />
                    <span>{localizedText(t, 'job.download', 'Download')}</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="csv-tools-surface__file-btn csv-tools-surface__file-btn--primary"
                  disabled={Boolean(errorMessage) || !sourceText.trim()}
                  onClick={() => void runFullProcess()}
                >
                  {localizedText(t, 'job.runFull', 'Process full file')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="csv-tools-surface__toolbar" aria-label="CSV parameters">
        <div className="csv-tools-surface__toolbar-group">
          <label className="csv-tools-surface__field">
            <span>{localizedText(t, 'param.delimiter', 'Delimiter')}</span>
            <Select
              className="csv-tools-surface__native-select"
              value={delimiter}
              disabled={isJsonInput}
              options={delimiterOptions}
              aria-label={localizedText(t, 'param.delimiter', 'Delimiter')}
              onChange={(event) => setDelimiter(event.target.value as DelimiterMode)}
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
              onChange={(event) => setHeader(event.target.value as HeaderMode)}
            />
          </label>

          <label className="csv-tools-surface__field">
            <span>{localizedText(t, 'param.output', 'Output')}</span>
            <Select
              className="csv-tools-surface__native-select"
              value={output}
              options={outputOptions}
              aria-label={localizedText(t, 'param.output', 'Output')}
              onChange={(event) => {
                setOutput(event.target.value as OutputMode)
                setMainView('output')
              }}
            />
          </label>

          {showJsonStyle && mainView === 'output' && (
            <>
              <Checkbox
                checked={minify}
                onChange={(event) => setMinify((event.target as HTMLInputElement).checked)}
              >
                {localizedText(t, 'param.minify', 'Minify')}
              </Checkbox>
              {!minify && (
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
                    onChange={(event) => setIndent(event.target.value === '4' ? 4 : 2)}
                  />
                </label>
              )}
            </>
          )}

          {output === 'sql' && mainView === 'output' && (
            <label className="csv-tools-surface__field">
              <span>{localizedText(t, 'param.tableName', 'Table name')}</span>
              <input
                type="text"
                className="csv-tools-surface__text"
                value={tableName}
                onChange={(event) => setTableName(event.target.value)}
                spellCheck={false}
              />
            </label>
          )}
        </div>

        <div className="csv-tools-surface__transform-checks">
          <Checkbox checked={dropEmpty} onChange={(event) => setDropEmpty((event.target as HTMLInputElement).checked)}>
            {localizedText(t, 'transform.dropEmpty', 'Drop empty rows')}
          </Checkbox>
          <Checkbox checked={dedupe} onChange={(event) => setDedupe((event.target as HTMLInputElement).checked)}>
            {localizedText(t, 'transform.dedupe', 'Deduplicate')}
          </Checkbox>
          <Checkbox checked={transpose} onChange={(event) => setTranspose((event.target as HTMLInputElement).checked)}>
            {localizedText(t, 'transform.transpose', 'Transpose')}
          </Checkbox>
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
            {globalFilter.trim() || sqlFilter.trim()
              ? ` · ${localizedText(t, 'meta.filtered', '{shown}/{total}', {
                  shown: displayGridRows.length,
                  total: gridRows.length,
                })}`
              : ''}
          </span>
        ) : (
          <span className="csv-tools-surface__tab-hint mono">
            {formatBytes(sourceText.length)}
            {estimatedLines > 0 ? ` · ~${estimatedLines.toLocaleString()} lines` : ''}
            {mainView === 'table' && (globalFilter.trim() || sqlFilter.trim())
              ? ` · ${displayGridRows.length}/${gridRows.length}`
              : ''}
          </span>
        )}
      </div>

      <div className="csv-tools-surface__body csv-tools-surface__body--single">
        {mainView === 'table' ? (
          <div className="csv-tools-surface__grid-wrap" data-no-drag data-launcher-scrollable>
            {errorMessage ? (
              <div className="csv-tools-surface__empty is-error">{errorMessage}</div>
            ) : table && table.headers.length > 0 ? (
              <>
                <div className="csv-tools-surface__table-tools" data-no-drag>
                  <SegmentedControl
                    aria-label={localizedText(t, 'table.filterMode', 'Filter mode')}
                    value={filterMode}
                    onChange={(value) => {
                      const next = value as 'text' | 'sql'
                      setFilterMode(next)
                      if (next === 'sql' && !sqlFilter.trim()) {
                        const starter = defaultSqlTemplate(tableHeaders)
                        setSqlFilter(starter)
                        setSqlCursor(starter.length)
                        setSqlSuggestOpen(true)
                      }
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
                      onChange={(event) => setGlobalFilter(event.target.value)}
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
                          setSqlFilter(el.value)
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
                  <span className="csv-tools-surface__table-hint">
                    {localizedText(
                      t,
                      'table.selectionHint',
                      'Drag cells · click header = column · sort icon',
                    )}
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
                        setGlobalFilter('')
                        setSqlFilter('')
                        setSortColumns([])
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
              <div className="csv-tools-surface__empty">
                {localizedText(t, 'empty.source', 'Paste CSV, TSV, or a JSON array of objects')}
              </div>
            )}
          </div>
        ) : null}

        {mainView === 'output' ? (
          <div className="csv-tools-surface__output-wrap">
            {fullJobReady ? (
              <div className="csv-tools-surface__output-hint">
                {localizedText(
                  t,
                  'job.outputHint',
                  'Showing a preview of the full result ({size}). Use Copy full / Download for the complete file.',
                  { size: formatBytes(fullOutputRef.current?.length ?? 0) },
                )}
              </div>
            ) : null}
            <pre className={errorMessage ? 'is-error' : undefined}>
              {errorMessage ||
                (fullJobReady && fullOutputRef.current
                  ? fullOutputRef.current.length > 400_000
                    ? fullOutputRef.current.slice(0, 400_000) +
                      `\n… (${formatBytes(fullOutputRef.current.length - 400_000)} more)`
                    : fullOutputRef.current
                  : outputText)}
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
                  'Editing {size} of text in the browser may freeze the UI. Table and output already use a capped preview.',
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
                invalidateFullJob()
                setSourceText(next)
                setLinkedFileLabel(undefined)
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
