/**
 * Lightweight SQL query for in-memory CSV tables.
 * No external deps (disk-release safe).
 *
 * Supported:
 *   SELECT * FROM data WHERE age > 28
 *   SELECT name, age FROM data WHERE city LIKE '%Shang%'
 *   SELECT "Full Name", age FROM t
 *   WHERE age >= 18                    (bare WHERE still works)
 *   age IN (28, 30) OR name = 'Alice'  (bare expression)
 */

export type SqlFilterResult =
  | { ok: true; rowIndexes: number[]; columns: string[] | null }
  | { ok: false; message: string }

export type SqlCompletionItem = {
  label: string
  insertText: string
  detail?: string
  kind: 'column' | 'keyword' | 'table' | 'snippet'
}

export type SqlCompletions = {
  items: SqlCompletionItem[]
  /** Replace range in the SQL string (absolute indices). */
  from: number
  to: number
}

type Row = Record<string, string>

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'null' }
  | { kind: 'op'; value: string }
  | { kind: 'kw'; value: string }
  | { kind: 'star' }
  | { kind: 'lp' | 'rp' | 'comma' }

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'like',
  'in',
  'is',
  'null',
  'between',
  'true',
  'false',
  'select',
  'from',
  'where',
  'as',
  'order',
  'by',
  'asc',
  'desc',
  'limit',
])

const TABLE_ALIASES = new Set(['data', 't', 'table', 'csv', 'rows'])

function tokenize(input: string): Token[] | { error: string } {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (ch === '*') {
      tokens.push({ kind: 'star' })
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'lp' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'rp' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma' })
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      i++
      let value = ''
      while (i < input.length) {
        if (input[i] === quote) {
          if (input[i + 1] === quote) {
            value += quote
            i += 2
            continue
          }
          i++
          break
        }
        value += input[i]
        i++
      }
      if (quote === '"' && value.length > 0) {
        tokens.push({ kind: 'ident', value })
      } else {
        tokens.push({ kind: 'string', value })
      }
      continue
    }
    if (ch === '`' || ch === '[') {
      const end = ch === '`' ? '`' : ']'
      i++
      let value = ''
      while (i < input.length && input[i] !== end) {
        value += input[i]
        i++
      }
      if (input[i] === end) i++
      tokens.push({ kind: 'ident', value })
      continue
    }
    const two = input.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=') {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if (ch === '=' || ch === '<' || ch === '>') {
      tokens.push({ kind: 'op', value: ch })
      i++
      continue
    }
    if (/[0-9.]/.test(ch)) {
      let raw = ''
      while (i < input.length && /[0-9.]/.test(input[i])) {
        raw += input[i]
        i++
      }
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: `Invalid number: ${raw}` }
      tokens.push({ kind: 'number', value: n })
      continue
    }
    if (/[A-Za-z_\u0080-\uFFFF]/.test(ch)) {
      let raw = ''
      while (i < input.length && /[A-Za-z0-9_\u0080-\uFFFF]/.test(input[i])) {
        raw += input[i]
        i++
      }
      const lower = raw.toLowerCase()
      if (lower === 'null') tokens.push({ kind: 'null' })
      else if (KEYWORDS.has(lower)) tokens.push({ kind: 'kw', value: lower })
      else tokens.push({ kind: 'ident', value: raw })
      continue
    }
    return { error: `Unexpected character: ${ch}` }
  }
  return tokens
}

/** @deprecated use parseSqlQuery — kept for tests that only care about WHERE body */
export function extractWhereClause(sql: string): string {
  const parsed = parseSqlStructure(sql)
  if (!parsed.ok) return ''
  return parsed.where
}

type SqlStructure =
  | { ok: true; columns: string[] | null; where: string; orderBy: Array<{ col: string; dir: 'ASC' | 'DESC' }>; limit: number | null }
  | { ok: false; message: string }

/**
 * Structural parse of SELECT / WHERE / ORDER BY / LIMIT (regex + light validation).
 * Column existence is validated later against headers.
 */
export function parseSqlStructure(sql: string): SqlStructure {
  const trimmed = sql.trim()
  if (!trimmed) {
    return { ok: true, columns: null, where: '', orderBy: [], limit: null }
  }

  let body = trimmed
  let columns: string[] | null = null
  let where = ''
  let orderBy: Array<{ col: string; dir: 'ASC' | 'DESC' }> = []
  let limit: number | null = null

  const selectMatch = body.match(/^\s*select\s+([\s\S]+?)\s+from\s+([^\s,;]+)(?:\s+([\s\S]*))?$/i)
  if (selectMatch) {
    const selectList = selectMatch[1].trim()
    // table name ignored (single virtual table)
    const rest = (selectMatch[3] ?? '').trim()

    if (selectList === '*') {
      columns = null
    } else {
      const parts = splitSelectList(selectList)
      if ('error' in parts) return { ok: false, message: parts.error }
      columns = parts.cols
    }

    const afterFrom = parseTrailingClauses(rest)
    if (!afterFrom.ok) return afterFrom
    where = afterFrom.where
    orderBy = afterFrom.orderBy
    limit = afterFrom.limit
  } else if (/^\s*select\b/i.test(body)) {
    // SELECT without FROM — allow "SELECT name, age WHERE ..." or incomplete
    const noFrom = body.match(/^\s*select\s+([\s\S]+?)(?:\s+where\s+([\s\S]+))?$/i)
    if (noFrom) {
      const selectList = noFrom[1].replace(/\s+where\s+[\s\S]*$/i, '').trim()
      if (selectList === '*') columns = null
      else {
        const parts = splitSelectList(selectList)
        if ('error' in parts) return { ok: false, message: parts.error }
        columns = parts.cols
      }
      where = (noFrom[2] ?? '').trim()
    } else {
      return { ok: false, message: 'Expected: SELECT … FROM data [WHERE …]' }
    }
  } else {
    // bare WHERE or expression
    const whereOnly = body.match(/^\s*where\s+([\s\S]+)$/i)
    where = whereOnly ? whereOnly[1].trim() : body
    const trailing = parseTrailingClauses(where.includes(' order ') || where.includes(' ORDER ') ? where : where)
    // If user wrote "age > 1 ORDER BY age", parseTrailing on full body
    const bareTrail = parseTrailingClauses(body.replace(/^\s*where\s+/i, ''))
    if (bareTrail.ok && (bareTrail.orderBy.length || bareTrail.limit != null || bareTrail.where !== body.replace(/^\s*where\s+/i, ''))) {
      where = bareTrail.where
      orderBy = bareTrail.orderBy
      limit = bareTrail.limit
    }
  }

  return { ok: true, columns, where, orderBy, limit }
}

function splitSelectList(list: string): { cols: string[] } | { error: string } {
  const cols: string[] = []
  let i = 0
  let current = ''
  let inSingle = false
  let inDouble = false
  let depth = 0
  while (i < list.length) {
    const ch = list[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      current += ch
      i++
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      current += ch
      i++
      continue
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') depth++
      if (ch === ')') depth = Math.max(0, depth - 1)
      if (ch === ',' && depth === 0) {
        const parsed = parseSelectItem(current)
        if ('error' in parsed) return parsed
        cols.push(parsed.col)
        current = ''
        i++
        continue
      }
    }
    current += ch
    i++
  }
  if (current.trim()) {
    const parsed = parseSelectItem(current)
    if ('error' in parsed) return parsed
    cols.push(parsed.col)
  }
  if (cols.length === 0) return { error: 'SELECT list is empty' }
  return { cols }
}

function parseSelectItem(raw: string): { col: string } | { error: string } {
  const t = raw.trim()
  if (!t) return { error: 'Empty column in SELECT' }
  if (t === '*') return { error: 'Cannot mix * with other columns' }
  // col AS alias | col alias
  const asMatch = t.match(/^(.*?)\s+as\s+(.+)$/i)
  if (asMatch) {
    return { col: unquoteIdent(asMatch[1].trim()) }
  }
  const parts = t.split(/\s+/)
  if (parts.length === 2 && !/[=<>!]/.test(parts[0])) {
    return { col: unquoteIdent(parts[0]) }
  }
  return { col: unquoteIdent(t) }
}

function unquoteIdent(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`')) || (s.startsWith('[') && s.endsWith(']'))) {
    return s.slice(1, -1)
  }
  return s
}

function parseTrailingClauses(rest: string): SqlStructure {
  let s = rest.trim()
  let limit: number | null = null
  let orderBy: Array<{ col: string; dir: 'ASC' | 'DESC' }> = []

  const limitMatch = s.match(/\blimit\s+(\d+)\s*$/i)
  if (limitMatch) {
    limit = Number(limitMatch[1])
    s = s.slice(0, limitMatch.index).trim()
  }

  const orderMatch = s.match(/\border\s+by\s+([\s\S]+)$/i)
  if (orderMatch) {
    const orderPart = orderMatch[1].trim()
    s = s.slice(0, orderMatch.index).trim()
    orderBy = orderPart.split(',').map((piece) => {
      const p = piece.trim()
      const m = p.match(/^(.*?)(?:\s+(asc|desc))?$/i)
      const col = unquoteIdent((m?.[1] ?? p).trim())
      const dir = (m?.[2]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC'
      return { col, dir }
    })
  }

  // strip leading WHERE if present
  const where = s.replace(/^\s*where\s+/i, '').trim()
  return { ok: true, columns: null, where, orderBy, limit }
}

type Expr =
  | { type: 'and' | 'or'; left: Expr; right: Expr }
  | { type: 'not'; expr: Expr }
  | { type: 'cmp'; col: string; op: string; value: string | number | null }
  | { type: 'like'; col: string; pattern: string; negated: boolean }
  | { type: 'in'; col: string; values: Array<string | number | null>; negated: boolean }
  | { type: 'between'; col: string; lo: string | number; hi: string | number; negated: boolean }
  | { type: 'isnull'; col: string; negated: boolean }
  | { type: 'bool'; value: boolean }

class Parser {
  private i = 0
  constructor(private tokens: Token[]) {}

  parse(): Expr {
    if (this.tokens.length === 0) return { type: 'bool', value: true }
    const expr = this.parseOr()
    if (this.i < this.tokens.length) {
      throw new Error(`Unexpected token: ${JSON.stringify(this.tokens[this.i])}`)
    }
    return expr
  }

  private peek(): Token | undefined {
    return this.tokens[this.i]
  }
  private take(): Token | undefined {
    return this.tokens[this.i++]
  }
  private matchKw(v: string): boolean {
    const t = this.peek()
    if (t?.kind === 'kw' && t.value === v) {
      this.take()
      return true
    }
    return false
  }

  private parseOr(): Expr {
    let left = this.parseAnd()
    while (this.matchKw('or')) left = { type: 'or', left, right: this.parseAnd() }
    return left
  }

  private parseAnd(): Expr {
    let left = this.parseUnary()
    while (this.matchKw('and')) left = { type: 'and', left, right: this.parseUnary() }
    return left
  }

  private parseUnary(): Expr {
    if (this.matchKw('not')) return { type: 'not', expr: this.parseUnary() }
    return this.parseAtom()
  }

  private parseAtom(): Expr {
    if (this.peek()?.kind === 'lp') {
      this.take()
      const e = this.parseOr()
      if (this.peek()?.kind !== 'rp') throw new Error('Expected )')
      this.take()
      return e
    }
    if (this.matchKw('true')) return { type: 'bool', value: true }
    if (this.matchKw('false')) return { type: 'bool', value: false }

    const colTok = this.take()
    if (colTok?.kind !== 'ident') throw new Error('Expected column name in expression')
    const col = colTok.value

    if (this.matchKw('is')) {
      const neg = this.matchKw('not')
      if (this.matchKw('null') || this.peek()?.kind === 'null') {
        if (this.peek()?.kind === 'null') this.take()
        return { type: 'isnull', col, negated: neg }
      }
      throw new Error('Expected NULL after IS')
    }

    let negated = false
    if (this.matchKw('not')) negated = true

    if (this.matchKw('like')) {
      const pat = this.literal()
      if (typeof pat !== 'string') throw new Error('LIKE pattern must be a string')
      return { type: 'like', col, pattern: pat, negated }
    }
    if (this.matchKw('in')) {
      return { type: 'in', col, values: this.list(), negated }
    }
    if (this.matchKw('between')) {
      const lo = this.literal()
      if (!this.matchKw('and')) throw new Error('BETWEEN requires AND')
      const hi = this.literal()
      if (lo === null || hi === null) throw new Error('BETWEEN cannot use NULL')
      return { type: 'between', col, lo, hi, negated }
    }
    if (negated) throw new Error('Unexpected NOT before comparison')

    if (this.peek()?.kind !== 'op') throw new Error(`Expected operator after "${col}"`)
    const op = (this.take() as { value: string }).value
    const value = this.literal()
    return { type: 'cmp', col, op, value }
  }

  private literal(): string | number | null {
    const t = this.take()
    if (!t) throw new Error('Expected value')
    if (t.kind === 'string' || t.kind === 'number') return t.value
    if (t.kind === 'null') return null
    if (t.kind === 'ident') return t.value
    throw new Error('Expected literal')
  }

  private list(): Array<string | number | null> {
    if (this.peek()?.kind !== 'lp') throw new Error('Expected (')
    this.take()
    const out: Array<string | number | null> = []
    if (this.peek()?.kind === 'rp') {
      this.take()
      return out
    }
    out.push(this.literal())
    while (this.peek()?.kind === 'comma') {
      this.take()
      out.push(this.literal())
    }
    if (this.peek()?.kind !== 'rp') throw new Error('Expected )')
    this.take()
    return out
  }
}

function resolveCol(headers: string[], name: string): string | null {
  const exact = headers.find((h) => h === name)
  if (exact) return exact
  const ci = headers.find((h) => h.toLowerCase() === name.toLowerCase())
  return ci ?? null
}

function cellOf(row: Row, col: string): string {
  return String(row[col] ?? '')
}

function cmpValues(cell: string, op: string, value: string | number | null): boolean {
  if (value === null) {
    const empty = cell.trim() === ''
    if (op === '=' || op === '==') return empty
    if (op === '!=' || op === '<>') return !empty
    return false
  }
  if (typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(cell.trim())) {
    const n = Number(cell)
    const v = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(n) && Number.isFinite(v)) {
      if (op === '=' || op === '==') return n === v
      if (op === '!=' || op === '<>') return n !== v
      if (op === '>') return n > v
      if (op === '>=') return n >= v
      if (op === '<') return n < v
      if (op === '<=') return n <= v
    }
  }
  const s = cell
  const v = String(value)
  if (op === '=' || op === '==') return s === v
  if (op === '!=' || op === '<>') return s !== v
  if (op === '>') return s > v
  if (op === '>=') return s >= v
  if (op === '<') return s < v
  if (op === '<=') return s <= v
  return false
}

function likeMatch(cell: string, pattern: string): boolean {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '%') re += '.*'
    else if (c === '_') re += '.'
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i').test(cell)
}

function evalExpr(expr: Expr, row: Row, headers: string[]): boolean {
  switch (expr.type) {
    case 'bool':
      return expr.value
    case 'not':
      return !evalExpr(expr.expr, row, headers)
    case 'and':
      return evalExpr(expr.left, row, headers) && evalExpr(expr.right, row, headers)
    case 'or':
      return evalExpr(expr.left, row, headers) || evalExpr(expr.right, row, headers)
    case 'isnull': {
      const col = resolveCol(headers, expr.col)
      if (!col) return false
      const empty = cellOf(row, col).trim() === ''
      return expr.negated ? !empty : empty
    }
    case 'cmp': {
      const col = resolveCol(headers, expr.col)
      if (!col) return false
      return cmpValues(cellOf(row, col), expr.op, expr.value)
    }
    case 'like': {
      const col = resolveCol(headers, expr.col)
      if (!col) return false
      const ok = likeMatch(cellOf(row, col), expr.pattern)
      return expr.negated ? !ok : ok
    }
    case 'in': {
      const col = resolveCol(headers, expr.col)
      if (!col) return false
      const cell = cellOf(row, col)
      const ok = expr.values.some((v) => cmpValues(cell, '=', v))
      return expr.negated ? !ok : ok
    }
    case 'between': {
      const col = resolveCol(headers, expr.col)
      if (!col) return false
      const cell = cellOf(row, col)
      const ok = cmpValues(cell, '>=', expr.lo) && cmpValues(cell, '<=', expr.hi)
      return expr.negated ? !ok : ok
    }
    default:
      return false
  }
}

function findUnknownColumns(expr: Expr, headers: string[]): string[] {
  const out: string[] = []
  const visit = (e: Expr) => {
    switch (e.type) {
      case 'and':
      case 'or':
        visit(e.left)
        visit(e.right)
        break
      case 'not':
        visit(e.expr)
        break
      case 'cmp':
      case 'like':
      case 'in':
      case 'between':
      case 'isnull':
        if (!resolveCol(headers, e.col)) out.push(e.col)
        break
      default:
        break
    }
  }
  visit(expr)
  return out
}

function resolveColumnList(requested: string[] | null, headers: string[]): { ok: true; columns: string[] | null } | { ok: false; message: string } {
  if (requested == null) return { ok: true, columns: null }
  const resolved: string[] = []
  for (const name of requested) {
    const col = resolveCol(headers, name)
    if (!col) return { ok: false, message: `Unknown column: ${name}` }
    resolved.push(col)
  }
  return { ok: true, columns: resolved }
}

/**
 * Run a SQL-like query: optional SELECT columns + WHERE + ORDER BY + LIMIT.
 * `rowIndexes` are indexes into the original `rows` array (after filter/sort/limit).
 * `columns` is null for SELECT * (or bare WHERE).
 */
export function filterRowsBySql(rows: Row[], headers: string[], sql: string): SqlFilterResult {
  const structure = parseSqlStructure(sql)
  if (!structure.ok) return structure

  const colRes = resolveColumnList(structure.columns, headers)
  if (!colRes.ok) return colRes

  let indexes = rows.map((_, i) => i)

  if (structure.where.trim()) {
    const tok = tokenize(structure.where)
    if ('error' in tok) return { ok: false, message: tok.error }
    let expr: Expr
    try {
      expr = new Parser(tok).parse()
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
    const unknown = findUnknownColumns(expr, headers)
    if (unknown.length > 0) {
      return { ok: false, message: `Unknown column: ${unknown[0]}` }
    }
    indexes = indexes.filter((i) => evalExpr(expr, rows[i], headers))
  }

  if (structure.orderBy.length > 0) {
    for (const ob of structure.orderBy) {
      if (!resolveCol(headers, ob.col)) {
        return { ok: false, message: `Unknown column in ORDER BY: ${ob.col}` }
      }
    }
    indexes = [...indexes].sort((ia, ib) => {
      for (const ob of structure.orderBy) {
        const col = resolveCol(headers, ob.col)!
        const av = cellOf(rows[ia], col)
        const bv = cellOf(rows[ib], col)
        const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
        if (cmp !== 0) return ob.dir === 'ASC' ? cmp : -cmp
      }
      return 0
    })
  }

  if (structure.limit != null && structure.limit >= 0) {
    indexes = indexes.slice(0, structure.limit)
  }

  return { ok: true, rowIndexes: indexes, columns: colRes.columns }
}

/** Free-text filter: any column contains query (case-insensitive). */
export function filterRowsByText(rows: Row[], headers: string[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows.map((_, i) => i)
  const indexes: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (headers.some((h) => String(row[h] ?? '').toLowerCase().includes(q))) {
      indexes.push(i)
    }
  }
  return indexes
}

// ─── Autocomplete ────────────────────────────────────────────────────────────

const SQL_KEYWORDS_SUGGEST: SqlCompletionItem[] = [
  { label: 'SELECT', insertText: 'SELECT ', kind: 'keyword', detail: 'keyword' },
  { label: 'FROM', insertText: 'FROM ', kind: 'keyword', detail: 'keyword' },
  { label: 'WHERE', insertText: 'WHERE ', kind: 'keyword', detail: 'keyword' },
  { label: 'AND', insertText: 'AND ', kind: 'keyword', detail: 'keyword' },
  { label: 'OR', insertText: 'OR ', kind: 'keyword', detail: 'keyword' },
  { label: 'NOT', insertText: 'NOT ', kind: 'keyword', detail: 'keyword' },
  { label: 'LIKE', insertText: "LIKE '%'", kind: 'keyword', detail: 'keyword' },
  { label: 'IN', insertText: 'IN ()', kind: 'keyword', detail: 'keyword' },
  { label: 'BETWEEN', insertText: 'BETWEEN  AND ', kind: 'keyword', detail: 'keyword' },
  { label: 'IS NULL', insertText: 'IS NULL', kind: 'keyword', detail: 'keyword' },
  { label: 'IS NOT NULL', insertText: 'IS NOT NULL', kind: 'keyword', detail: 'keyword' },
  { label: 'ORDER BY', insertText: 'ORDER BY ', kind: 'keyword', detail: 'keyword' },
  { label: 'ASC', insertText: 'ASC', kind: 'keyword', detail: 'keyword' },
  { label: 'DESC', insertText: 'DESC', kind: 'keyword', detail: 'keyword' },
  { label: 'LIMIT', insertText: 'LIMIT ', kind: 'keyword', detail: 'keyword' },
]

const SQL_SNIPPETS: SqlCompletionItem[] = [
  {
    label: 'SELECT * FROM data WHERE …',
    insertText: 'SELECT * FROM data WHERE ',
    kind: 'snippet',
    detail: 'snippet',
  },
  {
    label: 'SELECT cols FROM data',
    insertText: 'SELECT  FROM data WHERE ',
    kind: 'snippet',
    detail: 'snippet',
  },
]

function quoteColIfNeeded(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Completions at `cursor` (0..sql.length). Replaces the token under the cursor.
 */
export function getSqlCompletions(sql: string, cursor: number, headers: string[]): SqlCompletions {
  const pos = Math.max(0, Math.min(cursor, sql.length))
  // token under cursor: [from, to)
  let from = pos
  let to = pos
  while (from > 0 && /[A-Za-z0-9_\u0080-\uFFFF]/.test(sql[from - 1])) from--
  while (to < sql.length && /[A-Za-z0-9_\u0080-\uFFFF]/.test(sql[to])) to++
  const prefix = sql.slice(from, to)
  const prefixLower = prefix.toLowerCase()

  const before = sql.slice(0, from)
  const beforeTrimEnd = before.replace(/\s+$/, '')
  const context = inferSqlContext(beforeTrimEnd)

  const items: SqlCompletionItem[] = []

  if (!sql.trim() || (pos <= sql.trimStart().length && !prefix)) {
    items.push(...SQL_SNIPPETS)
  }

  if (context === 'select-list' || context === 'where' || context === 'order' || context === 'general') {
    for (const h of headers) {
      if (!prefix || h.toLowerCase().includes(prefixLower) || quoteColIfNeeded(h).toLowerCase().includes(prefixLower)) {
        items.push({
          label: h,
          insertText: quoteColIfNeeded(h),
          kind: 'column',
          detail: 'column',
        })
      }
    }
  }

  if (context === 'from' || context === 'general') {
    for (const t of ['data', 't', 'table']) {
      if (!prefix || t.startsWith(prefixLower)) {
        items.push({ label: t, insertText: t, kind: 'table', detail: 'table' })
      }
    }
  }

  if (context !== 'from') {
    for (const kw of SQL_KEYWORDS_SUGGEST) {
      if (!prefix || kw.label.toLowerCase().startsWith(prefixLower) || kw.label.toLowerCase().includes(prefixLower)) {
        // contextual keyword filtering
        if (context === 'select-list' && !['FROM'].includes(kw.label) && kw.label !== 'AS') {
          if (['SELECT', 'WHERE', 'AND', 'OR'].includes(kw.label)) continue
        }
        if (context === 'after-select-star' && kw.label !== 'FROM') continue
        items.push(kw)
      }
    }
    // AS in select list
    if (context === 'select-list' && (!prefix || 'as'.startsWith(prefixLower))) {
      items.push({ label: 'AS', insertText: 'AS ', kind: 'keyword', detail: 'keyword' })
    }
  }

  // de-dupe by label
  const seen = new Set<string>()
  const unique = items.filter((it) => {
    const key = `${it.kind}:${it.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // sort: columns first, then keywords, prefix match first
  unique.sort((a, b) => {
    const score = (x: SqlCompletionItem) => {
      let s = 0
      if (x.kind === 'column') s += 100
      if (x.kind === 'snippet') s += 90
      if (x.kind === 'table') s += 80
      if (prefix && x.label.toLowerCase().startsWith(prefixLower)) s += 50
      if (prefix && x.insertText.toLowerCase().startsWith(prefixLower)) s += 40
      return -s
    }
    const d = score(a) - score(b)
    if (d !== 0) return d
    return a.label.localeCompare(b.label)
  })

  return { items: unique.slice(0, 40), from, to }
}

type SqlCtx = 'select-list' | 'from' | 'where' | 'order' | 'after-select-star' | 'general'

function inferSqlContext(before: string): SqlCtx {
  const s = before.trimEnd()
  if (!s) return 'general'
  const lower = s.toLowerCase()

  if (/\border\s+by\b[\s\S]*$/i.test(s)) return 'order'
  if (/\bwhere\b[\s\S]*$/i.test(s)) return 'where'
  if (/\bfrom\s*$/i.test(s) || /\bfrom\s+\w*$/i.test(s)) return 'from'
  if (/^\s*select\s+\*\s*$/i.test(s) || /\bselect\s+\*\s*$/i.test(s)) return 'after-select-star'
  if (/\bselect\b/i.test(lower) && !/\bfrom\b/i.test(lower)) return 'select-list'
  if (/\bfrom\b/i.test(lower) && !/\bwhere\b/i.test(lower) && !/\border\s+by\b/i.test(lower)) {
    // after table name, suggest WHERE / ORDER
    return 'general'
  }
  return 'general'
}

/** Default starter when switching to SQL mode. */
export function defaultSqlTemplate(headers: string[]): string {
  if (headers.length === 0) return 'SELECT * FROM data WHERE '
  const preview = headers.slice(0, 3).map(quoteColIfNeeded).join(', ')
  return `SELECT ${preview} FROM data WHERE `
}
