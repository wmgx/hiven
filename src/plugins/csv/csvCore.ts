/**
 * CSV Tools pure core: parse → table → transforms → output.
 * No React / host dependencies. No external packages (safe for disk-released plugins).
 */

export type DelimiterMode = 'auto' | 'comma' | 'tab' | 'semicolon' | 'pipe'
export type HeaderMode = 'auto' | 'first-row' | 'no-header'
export type OutputMode =
  | 'objects'
  | 'array'
  | 'columns'
  | 'keyed'
  | 'ndjson'
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'sql'

export type JsonStyle = { minify: boolean; indent: 2 | 4 }
export type SqlStyle = { tableName: string }
export type TableTransforms = { dropEmpty: boolean; dedupe: boolean; transpose: boolean }

export type Table = {
  headers: string[]
  rows: string[][]
}

export type ParseResult =
  | { ok: true; kind: 'csv' | 'json'; delimiter?: string; table: Table }
  | { ok: false; message: string }

const DEFAULT_JSON_STYLE: JsonStyle = { minify: false, indent: 2 }
const DEFAULT_SQL_STYLE: SqlStyle = { tableName: 'table' }

/** Tab as unicode escape — avoids fragile '\t' display/minifier edge cases. */
const TAB = '\u0009'

const DELIMITER_MAP: Record<Exclude<DelimiterMode, 'auto'>, string> = {
  comma: ',',
  tab: TAB,
  semicolon: ';',
  pipe: '|',
}

export function detectInputKind(text: string): 'json' | 'csv' {
  const t = text.trim()
  if (!t) return 'csv'
  if (!(t.startsWith('[') || t.startsWith('{'))) return 'csv'
  try {
    const value = JSON.parse(t)
    if (Array.isArray(value)) return 'json'
    return 'csv'
  } catch {
    return 'csv'
  }
}

export function resolveDelimiter(mode: DelimiterMode, text: string): string {
  if (mode !== 'auto') return DELIMITER_MAP[mode]
  const sample = text.split(/\r?\n/).slice(0, 8).join('\n')
  if (!sample.trim()) return ','
  const candidates = [',', TAB, ';', '|'] as const
  let best: string = ','
  let bestScore = -1
  for (const delimiter of candidates) {
    const lines = sample.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0) continue
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter))
    const min = Math.min(...counts)
    if (min < 1) continue
    const variance = counts.reduce((sum, n) => sum + Math.abs(n - counts[0]), 0)
    const score = min * 10 - variance + (delimiter === TAB && min >= 1 ? 0.5 : 0)
    if (score > bestScore) {
      bestScore = score
      best = delimiter
    }
  }
  return best
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
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
    if (!inQuotes && ch === delimiter) count++
  }
  return count
}

export type ParseLimits = {
  /** Stop after this many matrix rows (including header row if present). */
  maxRows?: number
}

/** Fast line count for size banners (not quote-aware). */
export function countNewlines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') n++
  }
  return n
}

/**
 * Approximate total logical rows for a source string (header + data if CSV-like).
 * Uses newline count; good enough for UI banners.
 */
export function estimateRowCount(text: string): number {
  if (!text.trim()) return 0
  return countNewlines(text) + (text.endsWith('\n') ? 0 : 1)
}

export function sliceTable(table: Table, maxRows: number): { table: Table; truncated: boolean; totalRows: number } {
  const totalRows = table.rows.length
  if (maxRows < 0 || totalRows <= maxRows) {
    return { table, truncated: false, totalRows }
  }
  return {
    table: { headers: table.headers, rows: table.rows.slice(0, maxRows) },
    truncated: true,
    totalRows,
  }
}

/**
 * RFC4180-style parse into a raw matrix (rows of fields).
 * Throws Error on unterminated quotes.
 * When maxRows is set, stops after that many completed matrix rows (best-effort for large files).
 */
export function parseDelimited(text: string, delimiter: string, limits?: ParseLimits): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const maxRows = limits?.maxRows

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    // Ignore a single trailing empty row created by a final newline
    if (row.length === 1 && row[0] === '' && rows.length > 0) {
      row = []
      return
    }
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    if (maxRows !== undefined && rows.length >= maxRows) break

    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === delimiter) {
      pushField()
      i++
      continue
    }
    if (ch === '\r') {
      pushField()
      pushRow()
      i++
      if (text[i] === '\n') i++
      continue
    }
    if (ch === '\n') {
      pushField()
      pushRow()
      i++
      continue
    }
    field += ch
    i++
  }

  // Early stop for large files: ignore incomplete final field mid-quote or mid-row
  if (maxRows !== undefined && rows.length >= maxRows) {
    return rows
  }

  if (inQuotes) {
    throw new Error('Quoted field unterminated')
  }

  // Final field/row if content remains or file didn't end with newline
  if (field.length > 0 || row.length > 0 || text.length === 0) {
    pushField()
    // Don't push completely empty document as a row of one empty cell when input was empty
    if (!(rows.length === 0 && row.length === 1 && row[0] === '' && text.trim() === '')) {
      pushRow()
    }
  }

  // Strip trailing empty row from final newline
  if (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (last.length === 1 && last[0] === '') rows.pop()
  }

  return rows
}

function emptyTable(): Table {
  return { headers: [], rows: [] }
}

function normalizeHeader(name: string, index: number): string {
  const trimmed = name.trim()
  return trimmed || `column_${index + 1}`
}

function parseCsvText(
  text: string,
  delimiterMode: DelimiterMode,
  headerMode: HeaderMode,
  limits?: ParseLimits,
): ParseResult {
  const delimiter = resolveDelimiter(delimiterMode, text)
  let matrix: string[][]
  try {
    // +1 matrix row when headers are expected so maxRows refers to data rows when possible
    const matrixCap =
      limits?.maxRows === undefined
        ? undefined
        : headerMode === 'no-header'
          ? limits.maxRows
          : limits.maxRows + 1
    matrix = parseDelimited(text, delimiter, matrixCap === undefined ? undefined : { maxRows: matrixCap })
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  if (matrix.length === 0) {
    return { ok: true, kind: 'csv', delimiter, table: emptyTable() }
  }

  const useHeader =
    headerMode === 'first-row' || (headerMode === 'auto' && matrix.length > 1)

  if (useHeader) {
    const headers = (matrix[0] ?? []).map((h, i) => normalizeHeader(h, i))
    const width = headers.length
    const rows = matrix.slice(1).map((row) => {
      const next = row.slice(0, width)
      while (next.length < width) next.push('')
      return next
    })
    return { ok: true, kind: 'csv', delimiter, table: { headers, rows } }
  }

  const width = Math.max(...matrix.map((r) => r.length), 0)
  const headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`)
  const rows = matrix.map((row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push('')
    return next
  })
  return { ok: true, kind: 'csv', delimiter, table: { headers, rows } }
}

function parseJsonArray(text: string, limits?: ParseLimits): ParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: 'JSON input must be an array of objects' }
  }
  if (value.length === 0) {
    return { ok: true, kind: 'json', table: emptyTable() }
  }

  if (!value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) {
    return { ok: false, message: 'JSON input must be an array of objects' }
  }

  let objects = value as Array<Record<string, unknown>>
  if (limits?.maxRows !== undefined && objects.length > limits.maxRows) {
    objects = objects.slice(0, limits.maxRows)
  }
  const headerSet: string[] = []
  const seen = new Set<string>()
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      if (!seen.has(key)) {
        seen.add(key)
        headerSet.push(key)
      }
    }
  }
  const headers = headerSet.map((h, i) => normalizeHeader(h, i))
  const rows = objects.map((obj) => headers.map((h) => {
    const v = obj[h]
    if (v === null || v === undefined) return ''
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  }))
  return { ok: true, kind: 'json', table: { headers, rows } }
}

export function parseSource(
  text: string,
  delimiterMode: DelimiterMode = 'auto',
  headerMode: HeaderMode = 'auto',
  limits?: ParseLimits,
): ParseResult {
  if (!text.trim()) {
    return { ok: true, kind: 'csv', delimiter: ',', table: emptyTable() }
  }
  if (detectInputKind(text) === 'json') {
    return parseJsonArray(text.trim(), limits)
  }
  return parseCsvText(text, delimiterMode, headerMode, limits)
}

export function dropEmptyRows(table: Table): Table {
  return {
    headers: table.headers,
    rows: table.rows.filter((row) => row.some((cell) => cell.trim() !== '')),
  }
}

export function dedupeRows(table: Table): Table {
  const seen = new Set<string>()
  const rows: string[][] = []
  for (const row of table.rows) {
    const key = JSON.stringify(row)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return { headers: table.headers, rows }
}

export function transposeTable(table: Table): Table {
  const matrix = [table.headers, ...table.rows]
  if (matrix.length === 0) return emptyTable()
  const width = Math.max(...matrix.map((r) => r.length), 0)
  if (width === 0) return emptyTable()

  const transposed: string[][] = []
  for (let c = 0; c < width; c++) {
    const row: string[] = []
    for (let r = 0; r < matrix.length; r++) {
      row.push(matrix[r]?.[c] ?? '')
    }
    transposed.push(row)
  }

  if (transposed.length === 0) return emptyTable()
  const headers = transposed[0].map((h, i) => normalizeHeader(h, i))
  const rows = transposed.slice(1).map((row) => {
    const next = row.slice(0, headers.length)
    while (next.length < headers.length) next.push('')
    return next
  })
  return { headers, rows }
}

export function applyTransforms(table: Table, transforms: TableTransforms): Table {
  let next = table
  if (transforms.dropEmpty) next = dropEmptyRows(next)
  if (transforms.dedupe) next = dedupeRows(next)
  if (transforms.transpose) next = transposeTable(next)
  return next
}

function tableObjects(table: Table): Array<Record<string, string>> {
  return table.rows.map((row) => {
    const obj: Record<string, string> = {}
    table.headers.forEach((header, index) => {
      obj[header] = row[index] ?? ''
    })
    return obj
  })
}

function jsonStringify(value: unknown, style: JsonStyle): string {
  if (style.minify) return JSON.stringify(value)
  return JSON.stringify(value, null, style.indent)
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function quoteSqlIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `\`${name.replace(/`/g, '``')}\``
}

function quoteSqlString(value: string): string {
  if (value === '') return 'NULL'
  return `'${value.replace(/'/g, "''")}'`
}

function toSqlInsert(table: Table, sql: SqlStyle): string {
  if (table.headers.length === 0) return ''
  const tableName = (sql.tableName || 'table').trim() || 'table'
  const cols = table.headers.map(quoteSqlIdent).join(', ')
  const values = table.rows.map((row) => {
    const cells = table.headers.map((_, i) => quoteSqlString(row[i] ?? ''))
    return `  (${cells.join(', ')})`
  })
  if (values.length === 0) return ''
  return `INSERT INTO ${quoteSqlIdent(tableName)} (${cols}) VALUES\n${values.join(',\n')};`
}

function toMarkdown(table: Table): string {
  if (table.headers.length === 0) return ''
  const header = `| ${table.headers.map(escapeMarkdownCell).join(' | ')} |`
  const sep = `| ${table.headers.map(() => '---').join(' | ')} |`
  const body = table.rows.map((row) => `| ${table.headers.map((_, i) => escapeMarkdownCell(row[i] ?? '')).join(' | ')} |`)
  return [header, sep, ...body].join('\n')
}

function escapeDelimitedField(value: string, delimiter: string): string {
  const needsQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  if (!needsQuote) return value
  return `"${value.replace(/"/g, '""')}"`
}

function toDelimited(table: Table, delimiter: string): string {
  const lines = [table.headers, ...table.rows].map((row) =>
    row.map((cell) => escapeDelimitedField(cell, delimiter)).join(delimiter),
  )
  return lines.join('\n')
}

export function toOutput(
  table: Table,
  mode: OutputMode,
  style: JsonStyle = DEFAULT_JSON_STYLE,
  sql: SqlStyle = DEFAULT_SQL_STYLE,
): string {
  if (mode === 'csv') return toDelimited(table, ',')
  if (mode === 'tsv') return toDelimited(table, TAB)
  if (mode === 'markdown') return toMarkdown(table)
  if (mode === 'sql') return toSqlInsert(table, sql)

  const objects = tableObjects(table)

  if (mode === 'objects') return jsonStringify(objects, style)
  if (mode === 'ndjson') return objects.map((obj) => JSON.stringify(obj)).join('\n')
  if (mode === 'array') return jsonStringify([table.headers, ...table.rows], style)
  if (mode === 'columns') {
    const cols: Record<string, string[]> = {}
    for (const header of table.headers) cols[header] = []
    for (const row of table.rows) {
      table.headers.forEach((header, index) => {
        cols[header].push(row[index] ?? '')
      })
    }
    return jsonStringify(cols, style)
  }
  if (mode === 'keyed') {
    if (table.headers.length === 0) return jsonStringify({}, style)
    const rest = table.headers.slice(1)
    const result: Record<string, Record<string, string>> = {}
    for (const row of table.rows) {
      const key = row[0] ?? ''
      const value: Record<string, string> = {}
      rest.forEach((header, index) => {
        value[header] = row[index + 1] ?? ''
      })
      result[key] = value
    }
    return jsonStringify(result, style)
  }

  return ''
}

// ─── Full-file async pipeline (cooperative, abortable) ───────────────────────

export type JobProgress = {
  phase: 'parse' | 'transform' | 'output'
  /** 0..1 overall */
  ratio: number
}

export type JobHooks = {
  signal?: AbortSignal
  onProgress?: (progress: JobProgress) => void
}

const YIELD_CHARS = 48_000
const YIELD_ROWS = 1_200

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Aborted')
    err.name = 'AbortError'
    throw err
  }
}

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    setTimeout(resolve, 0)
  })
}

/**
 * Full delimited parse that yields to the event loop so the UI stays interactive.
 * No maxRows — intended for explicit "process full file" jobs.
 */
export async function parseDelimitedAsync(
  text: string,
  delimiter: string,
  hooks?: JobHooks,
): Promise<string[][]> {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  let sinceYield = 0
  const total = Math.max(text.length, 1)

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && rows.length > 0) {
      row = []
      return
    }
    rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          sinceYield += 2
          continue
        }
        inQuotes = false
        i++
        sinceYield++
        continue
      }
      field += ch
      i++
      sinceYield++
    } else if (ch === '"') {
      inQuotes = true
      i++
      sinceYield++
    } else if (ch === delimiter) {
      pushField()
      i++
      sinceYield++
    } else if (ch === '\r') {
      pushField()
      pushRow()
      i++
      sinceYield++
      if (text[i] === '\n') {
        i++
        sinceYield++
      }
    } else if (ch === '\n') {
      pushField()
      pushRow()
      i++
      sinceYield++
    } else {
      field += ch
      i++
      sinceYield++
    }

    if (sinceYield >= YIELD_CHARS) {
      throwIfAborted(hooks?.signal)
      hooks?.onProgress?.({ phase: 'parse', ratio: Math.min(0.55, (i / total) * 0.55) })
      await yieldToMain()
      sinceYield = 0
    }
  }

  throwIfAborted(hooks?.signal)

  if (inQuotes) {
    throw new Error('Quoted field unterminated')
  }

  if (field.length > 0 || row.length > 0 || text.length === 0) {
    pushField()
    if (!(rows.length === 0 && row.length === 1 && row[0] === '' && text.trim() === '')) {
      pushRow()
    }
  }

  if (rows.length > 0) {
    const last = rows[rows.length - 1]
    if (last.length === 1 && last[0] === '') rows.pop()
  }

  hooks?.onProgress?.({ phase: 'parse', ratio: 0.55 })
  return rows
}

function matrixToCsvTable(matrix: string[][], delimiter: string, headerMode: HeaderMode): ParseResult {
  if (matrix.length === 0) {
    return { ok: true, kind: 'csv', delimiter, table: emptyTable() }
  }
  const useHeader = headerMode === 'first-row' || (headerMode === 'auto' && matrix.length > 1)
  if (useHeader) {
    const headers = (matrix[0] ?? []).map((h, i) => normalizeHeader(h, i))
    const width = headers.length
    const rows = matrix.slice(1).map((row) => {
      const next = row.slice(0, width)
      while (next.length < width) next.push('')
      return next
    })
    return { ok: true, kind: 'csv', delimiter, table: { headers, rows } }
  }
  const width = Math.max(...matrix.map((r) => r.length), 0)
  const headers = Array.from({ length: width }, (_, i) => `column_${i + 1}`)
  const rows = matrix.map((row) => {
    const next = row.slice(0, width)
    while (next.length < width) next.push('')
    return next
  })
  return { ok: true, kind: 'csv', delimiter, table: { headers, rows } }
}

export async function parseSourceAsync(
  text: string,
  delimiterMode: DelimiterMode = 'auto',
  headerMode: HeaderMode = 'auto',
  hooks?: JobHooks,
): Promise<ParseResult> {
  if (!text.trim()) {
    return { ok: true, kind: 'csv', delimiter: ',', table: emptyTable() }
  }
  if (detectInputKind(text) === 'json') {
    // JSON.parse is atomic; report midpoint then return
    hooks?.onProgress?.({ phase: 'parse', ratio: 0.2 })
    await yieldToMain()
    throwIfAborted(hooks?.signal)
    const result = parseJsonArray(text.trim())
    hooks?.onProgress?.({ phase: 'parse', ratio: 0.55 })
    return result
  }

  const delimiter = resolveDelimiter(delimiterMode, text)
  try {
    const matrix = await parseDelimitedAsync(text, delimiter, hooks)
    return matrixToCsvTable(matrix, delimiter, headerMode)
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function applyTransformsAsync(
  table: Table,
  transforms: TableTransforms,
  hooks?: JobHooks,
): Promise<Table> {
  hooks?.onProgress?.({ phase: 'transform', ratio: 0.58 })
  await yieldToMain()
  throwIfAborted(hooks?.signal)
  // Transforms are O(n); for huge tables re-yield mid dedupe
  let next = table
  if (transforms.dropEmpty) {
    const rows: string[][] = []
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      if (i > 0 && i % YIELD_ROWS === 0) {
        throwIfAborted(hooks?.signal)
        hooks?.onProgress?.({
          phase: 'transform',
          ratio: 0.58 + (i / Math.max(table.rows.length, 1)) * 0.06,
        })
        await yieldToMain()
      }
    }
    next = { headers: table.headers, rows }
  }
  if (transforms.dedupe) {
    const seen = new Set<string>()
    const rows: string[][] = []
    const source = next.rows
    for (let i = 0; i < source.length; i++) {
      const row = source[i]
      const key = JSON.stringify(row)
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(row)
      }
      if (i > 0 && i % YIELD_ROWS === 0) {
        throwIfAborted(hooks?.signal)
        hooks?.onProgress?.({
          phase: 'transform',
          ratio: 0.64 + (i / Math.max(source.length, 1)) * 0.06,
        })
        await yieldToMain()
      }
    }
    next = { headers: next.headers, rows }
  }
  if (transforms.transpose) {
    next = transposeTable(next)
  }
  hooks?.onProgress?.({ phase: 'transform', ratio: 0.72 })
  return next
}

async function joinChunks(
  parts: string[],
  hooks?: JobHooks,
  baseRatio = 0.72,
  span = 0.28,
): Promise<string> {
  // Avoid one giant join freeze for millions of parts — join in batches
  if (parts.length < 4_000) return parts.join('')
  const batches: string[] = []
  for (let i = 0; i < parts.length; i += 2_000) {
    throwIfAborted(hooks?.signal)
    batches.push(parts.slice(i, i + 2_000).join(''))
    if (i > 0 && i % 8_000 === 0) {
      hooks?.onProgress?.({
        phase: 'output',
        ratio: baseRatio + Math.min(span, (i / parts.length) * span),
      })
      await yieldToMain()
    }
  }
  return batches.join('')
}

export async function toOutputAsync(
  table: Table,
  mode: OutputMode,
  style: JsonStyle = DEFAULT_JSON_STYLE,
  sql: SqlStyle = DEFAULT_SQL_STYLE,
  hooks?: JobHooks,
): Promise<string> {
  const total = Math.max(table.rows.length, 1)
  const report = async (done: number) => {
    hooks?.onProgress?.({
      phase: 'output',
      ratio: 0.72 + Math.min(0.28, (done / total) * 0.28),
    })
    if (done > 0 && done % YIELD_ROWS === 0) {
      throwIfAborted(hooks?.signal)
      await yieldToMain()
    }
  }

  if (mode === 'csv' || mode === 'tsv') {
    const delimiter = mode === 'tsv' ? TAB : ','
    const parts: string[] = [
      table.headers.map((c) => escapeDelimitedField(c, delimiter)).join(delimiter),
    ]
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      parts.push(
        '\n' + row.map((cell) => escapeDelimitedField(cell, delimiter)).join(delimiter),
      )
      await report(i + 1)
    }
    return joinChunks(parts, hooks)
  }

  if (mode === 'markdown') {
    if (table.headers.length === 0) return ''
    const parts: string[] = [
      `| ${table.headers.map(escapeMarkdownCell).join(' | ')} |\n`,
      `| ${table.headers.map(() => '---').join(' | ')} |`,
    ]
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      parts.push(
        `\n| ${table.headers.map((_, j) => escapeMarkdownCell(row[j] ?? '')).join(' | ')} |`,
      )
      await report(i + 1)
    }
    return joinChunks(parts, hooks)
  }

  if (mode === 'sql') {
    if (table.headers.length === 0) return ''
    const tableName = (sql.tableName || 'table').trim() || 'table'
    const cols = table.headers.map(quoteSqlIdent).join(', ')
    const parts: string[] = [`INSERT INTO ${quoteSqlIdent(tableName)} (${cols}) VALUES\n`]
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      const cells = table.headers.map((_, j) => quoteSqlString(row[j] ?? ''))
      parts.push(`${i === 0 ? '' : ',\n'}  (${cells.join(', ')})`)
      await report(i + 1)
    }
    parts.push(';')
    return joinChunks(parts, hooks)
  }

  if (mode === 'ndjson') {
    const parts: string[] = []
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      const obj: Record<string, string> = {}
      table.headers.forEach((h, j) => {
        obj[h] = row[j] ?? ''
      })
      parts.push((i === 0 ? '' : '\n') + JSON.stringify(obj))
      await report(i + 1)
    }
    return joinChunks(parts, hooks)
  }

  // Structured JSON modes — build object/array then stringify with periodic yields while mapping
  if (mode === 'objects') {
    const objects: Array<Record<string, string>> = []
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      const obj: Record<string, string> = {}
      table.headers.forEach((h, j) => {
        obj[h] = row[j] ?? ''
      })
      objects.push(obj)
      await report(i + 1)
    }
    throwIfAborted(hooks?.signal)
    hooks?.onProgress?.({ phase: 'output', ratio: 0.95 })
    await yieldToMain()
    return jsonStringify(objects, style)
  }

  if (mode === 'array') {
    throwIfAborted(hooks?.signal)
    hooks?.onProgress?.({ phase: 'output', ratio: 0.9 })
    await yieldToMain()
    return jsonStringify([table.headers, ...table.rows], style)
  }

  if (mode === 'columns') {
    const cols: Record<string, string[]> = {}
    for (const header of table.headers) cols[header] = []
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      table.headers.forEach((header, index) => {
        cols[header].push(row[index] ?? '')
      })
      await report(i + 1)
    }
    throwIfAborted(hooks?.signal)
    return jsonStringify(cols, style)
  }

  if (mode === 'keyed') {
    if (table.headers.length === 0) return jsonStringify({}, style)
    const rest = table.headers.slice(1)
    const result: Record<string, Record<string, string>> = {}
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]
      const key = row[0] ?? ''
      const value: Record<string, string> = {}
      rest.forEach((header, index) => {
        value[header] = row[index + 1] ?? ''
      })
      result[key] = value
      await report(i + 1)
    }
    throwIfAborted(hooks?.signal)
    return jsonStringify(result, style)
  }

  return ''
}

export type FullProcessResult = {
  table: Table
  output: string
  rowCount: number
  colCount: number
}

/** Parse → transform → serialize the entire source without preview caps. */
export async function processFullSource(
  text: string,
  options: {
    delimiter: DelimiterMode
    header: HeaderMode
    output: OutputMode
    transforms: TableTransforms
    jsonStyle?: JsonStyle
    sqlStyle?: SqlStyle
  },
  hooks?: JobHooks,
): Promise<FullProcessResult> {
  const parsed = await parseSourceAsync(text, options.delimiter, options.header, hooks)
  if (!parsed.ok) {
    throw new Error(parsed.message)
  }
  const table = await applyTransformsAsync(parsed.table, options.transforms, hooks)
  const output = await toOutputAsync(
    table,
    options.output,
    options.jsonStyle ?? DEFAULT_JSON_STYLE,
    options.sqlStyle ?? DEFAULT_SQL_STYLE,
    hooks,
  )
  hooks?.onProgress?.({ phase: 'output', ratio: 1 })
  return {
    table,
    output,
    rowCount: table.rows.length,
    colCount: table.headers.length,
  }
}

export function outputExtension(mode: OutputMode): string {
  if (mode === 'csv') return 'csv'
  if (mode === 'tsv') return 'tsv'
  if (mode === 'markdown') return 'md'
  if (mode === 'sql') return 'sql'
  if (mode === 'ndjson') return 'ndjson'
  return 'json'
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the browser has a chance to start the download
  setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
