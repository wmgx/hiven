/**
 * hiven - JSON Object Diff
 *
 * Rules:
 * - Objects: ignore key order (compare by key set / values)
 * - Arrays: ordered by index
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonDiffChange =
  | { kind: 'added'; path: string; newValue: JsonValue }
  | { kind: 'removed'; path: string; oldValue: JsonValue }
  | { kind: 'changed'; path: string; oldValue: JsonValue; newValue: JsonValue; oldType: string; newType: string }

/** Options reserved for future extensions; currently unused. */
export type JsonDiffOptions = Record<string, never>

export interface JsonDiffResult {
  changes: JsonDiffChange[]
  originalNormalized: string
  modifiedNormalized: string
  hasSemanticDifferences: boolean
  hasSementicDifferences: boolean
}

export interface JsonParseResult {
  ok: boolean
  value?: JsonValue
  error?: string
  line?: number
  column?: number
}

export interface JsonDiffViewModel {
  status: 'json' | 'text'
  changes: JsonDiffChange[]
  originalDisplayText: string
  modifiedDisplayText: string
  originalLanguage: 'json' | 'plaintext'
  modifiedLanguage: 'json' | 'plaintext'
  originalError?: string
  modifiedError?: string
  invalidSides: Array<'original' | 'modified'>
}

// ─── Parse ──────────────────────────────────────────────────────────────────

/**
 * Tolerate common edit-time noise so JSON mode stays active while typing:
 * - BOM
 * - trailing commas before } / ]
 *
 * Display keeps the user's raw text; structure is parsed with this relaxation.
 */
export function relaxJsonText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/,(\s*[}\]])/g, '$1')
}

export function parseJson(text: string): JsonParseResult {
  const jsonText = text.replace(/^\uFEFF/, '')
  try {
    return { ok: true, value: JSON.parse(jsonText) }
  } catch {
    // Fall through to relaxed parse.
  }

  const relaxed = relaxJsonText(jsonText)
  try {
    return { ok: true, value: JSON.parse(relaxed) }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON'
    const posMatch = msg.match(/position (\d+)/)
    let line = 1
    let column = 1
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10)
      const before = relaxed.slice(0, pos)
      line = (before.match(/\n/g) || []).length + 1
      const lastNewline = before.lastIndexOf('\n')
      column = pos - lastNewline
    }
    return { ok: false, error: msg, line, column }
  }
}

// ─── Normalize / stringify ──────────────────────────────────────────────────

function typeOf(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Canonical form for equality-oriented display: sort object keys recursively.
 * Arrays keep order (by index).
 */
export function normalizeJson(value: JsonValue, _options: JsonDiffOptions = {}): JsonValue {
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item, _options))
  }

  const sortedKeys = Object.keys(value).sort()
  const result: Record<string, JsonValue> = {}
  for (const key of sortedKeys) {
    result[key] = normalizeJson(value[key], _options)
  }
  return result
}

export function stableStringify(value: JsonValue, options: JsonDiffOptions = {}): string {
  return JSON.stringify(normalizeJson(value, options), null, 2)
}

/**
 * Display stringify keeps each side's object key insertion order.
 * Arrays keep index order. Comparison still ignores object key order.
 */
export function displayStringify(value: JsonValue, _options: JsonDiffOptions = {}): string {
  return JSON.stringify(normalizeJsonForDisplay(value), null, 2)
}

/**
 * Pretty-print JSON text without sorting object keys (preserves parse order).
 * Tolerates trailing commas. Returns null if the side is not valid JSON.
 */
export function formatJsonPreserveKeyOrder(text: string): string | null {
  const parsed = parseJson(text)
  if (!parsed.ok || parsed.value === undefined) return null
  // JSON.stringify preserves insertion order from JSON.parse — do not sort keys.
  return JSON.stringify(parsed.value, null, 2)
}

function normalizeJsonForDisplay(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonForDisplay(item))
  }
  const valueObj = value as Record<string, JsonValue>
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(valueObj)) {
    result[key] = normalizeJsonForDisplay(valueObj[key])
  }
  return result
}

// ─── Diff (object: by key; array: by index) ─────────────────────────────────

export function computeJsonDiff(
  original: JsonValue,
  modified: JsonValue,
  _options: JsonDiffOptions = {},
): JsonDiffChange[] {
  const changes: JsonDiffChange[] = []

  function diffRecursive(orig: JsonValue, mod: JsonValue, path: string) {
    const origType = typeOf(orig)
    const modType = typeOf(mod)

    if (origType !== modType) {
      changes.push({
        kind: 'changed',
        path,
        oldValue: orig,
        newValue: mod,
        oldType: origType,
        newType: modType,
      })
      return
    }

    if (origType !== 'object' && origType !== 'array') {
      if (orig !== mod) {
        changes.push({
          kind: 'changed',
          path,
          oldValue: orig,
          newValue: mod,
          oldType: origType,
          newType: modType,
        })
      }
      return
    }

    if (Array.isArray(orig) && Array.isArray(mod)) {
      const maxLen = Math.max(orig.length, mod.length)
      for (let i = 0; i < maxLen; i++) {
        const childPath = `${path}[${i}]`
        if (i >= orig.length) {
          changes.push({ kind: 'added', path: childPath, newValue: mod[i] })
        } else if (i >= mod.length) {
          changes.push({ kind: 'removed', path: childPath, oldValue: orig[i] })
        } else {
          diffRecursive(orig[i], mod[i], childPath)
        }
      }
      return
    }

    const origObj = orig as Record<string, JsonValue>
    const modObj = mod as Record<string, JsonValue>
    const allKeys = new Set([...Object.keys(origObj), ...Object.keys(modObj)])

    for (const key of [...allKeys].sort()) {
      const childPath = path ? `${path}.${key}` : `$.${key}`
      const inOrig = key in origObj
      const inMod = key in modObj

      if (inOrig && !inMod) {
        changes.push({ kind: 'removed', path: childPath, oldValue: origObj[key] })
      } else if (!inOrig && inMod) {
        changes.push({ kind: 'added', path: childPath, newValue: modObj[key] })
      } else {
        diffRecursive(origObj[key], modObj[key], childPath)
      }
    }
  }

  diffRecursive(original, modified, '$')
  return changes
}

export function jsonDiff(
  originalText: string,
  modifiedText: string,
  options: JsonDiffOptions = {},
): { result?: JsonDiffResult; originalError?: string; modifiedError?: string } {
  const origParsed = parseJson(originalText)
  const modParsed = parseJson(modifiedText)

  if (!origParsed.ok || !modParsed.ok) {
    return {
      originalError: origParsed.ok
        ? undefined
        : `Parse error at Ln ${origParsed.line}, Col ${origParsed.column}: ${origParsed.error}`,
      modifiedError: modParsed.ok
        ? undefined
        : `Parse error at Ln ${modParsed.line}, Col ${modParsed.column}: ${modParsed.error}`,
    }
  }

  const changes = computeJsonDiff(origParsed.value!, modParsed.value!, options)
  const originalNormalized = displayStringify(origParsed.value!, options)
  const modifiedNormalized = displayStringify(modParsed.value!, options)

  return {
    result: {
      changes,
      originalNormalized,
      modifiedNormalized,
      hasSemanticDifferences: changes.length > 0,
      hasSementicDifferences: changes.length > 0,
    },
  }
}

// ─── Diff Tree ──────────────────────────────────────────────────────────────

export type DiffTreeNode =
  | { type: 'same'; value: JsonValue }
  | { type: 'added'; value: JsonValue }
  | { type: 'removed'; value: JsonValue }
  | { type: 'changed'; oldValue: JsonValue; newValue: JsonValue }
  | {
      type: 'object'
      /** original key order, then mod-only keys */
      entries: Array<{ key: string; node: DiffTreeNode }>
      /** modified key order, then orig-only keys */
      modEntries: Array<{ key: string; node: DiffTreeNode }>
      hasChanges: boolean
    }
  | { type: 'array'; items: DiffTreeNode[]; hasChanges: boolean }

export function buildDiffTree(
  original: JsonValue,
  modified: JsonValue,
  _options: JsonDiffOptions = {},
): DiffTreeNode {
  function nodeHasChanges(node: DiffTreeNode): boolean {
    if (node.type === 'same') return false
    if (node.type === 'object' || node.type === 'array') return node.hasChanges
    return true
  }

  function build(orig: JsonValue, mod: JsonValue): DiffTreeNode {
    const origType = typeOf(orig)
    const modType = typeOf(mod)

    if (origType !== modType) {
      return { type: 'changed', oldValue: orig, newValue: mod }
    }

    if (origType !== 'object' && origType !== 'array') {
      if (orig === mod) return { type: 'same', value: orig }
      return { type: 'changed', oldValue: orig, newValue: mod }
    }

    if (Array.isArray(orig) && Array.isArray(mod)) {
      return buildArrayByIndex(orig, mod)
    }

    return buildObjectNode(
      orig as Record<string, JsonValue>,
      mod as Record<string, JsonValue>,
    )
  }

  function buildObjectNode(
    orig: Record<string, JsonValue>,
    mod: Record<string, JsonValue>,
  ): DiffTreeNode {
    const origKeys = Object.keys(orig)
    const modKeys = Object.keys(mod)
    const allKeys = [...new Set([...origKeys, ...modKeys])]
    const nodeMap = new Map<string, DiffTreeNode>()
    let hasChanges = false

    for (const key of allKeys) {
      const inOrig = key in orig
      const inMod = key in mod
      let node: DiffTreeNode

      if (inOrig && !inMod) {
        node = { type: 'removed', value: orig[key] }
        hasChanges = true
      } else if (!inOrig && inMod) {
        node = { type: 'added', value: mod[key] }
        hasChanges = true
      } else {
        node = build(orig[key], mod[key])
        if (nodeHasChanges(node)) hasChanges = true
      }
      nodeMap.set(key, node)
    }

    const origOnlyInMod = modKeys.filter((k) => !(k in orig))
    const entries = [...origKeys, ...origOnlyInMod].map((k) => ({ key: k, node: nodeMap.get(k)! }))

    const modOnlyInOrig = origKeys.filter((k) => !(k in mod))
    const modEntries = [...modKeys, ...modOnlyInOrig].map((k) => ({ key: k, node: nodeMap.get(k)! }))

    return { type: 'object', entries, modEntries, hasChanges }
  }

  function buildArrayByIndex(orig: JsonValue[], mod: JsonValue[]): DiffTreeNode {
    const maxLen = Math.max(orig.length, mod.length)
    const items: DiffTreeNode[] = []
    let hasChanges = false

    for (let i = 0; i < maxLen; i++) {
      let node: DiffTreeNode
      if (i >= orig.length) {
        node = { type: 'added', value: mod[i] }
        hasChanges = true
      } else if (i >= mod.length) {
        node = { type: 'removed', value: orig[i] }
        hasChanges = true
      } else {
        node = build(orig[i], mod[i])
        if (nodeHasChanges(node)) hasChanges = true
      }
      items.push(node)
    }

    return { type: 'array', items, hasChanges }
  }

  return build(original, modified)
}

// ─── Side Lines (dual Monaco) ───────────────────────────────────────────────

export type SideLine = {
  text: string
  highlight: boolean
}

function fmtLines(value: JsonValue, depth: number, keyPrefix: string, comma: string): string[] {
  const indent = '  '.repeat(depth)
  const lines = JSON.stringify(value, null, 2).split('\n')
  return lines.map((line, idx) => {
    const isFirst = idx === 0
    const isLast = idx === lines.length - 1
    return isFirst
      ? `${indent}${keyPrefix}${line}${isLast ? comma : ''}`
      : `${indent}${line}${isLast ? comma : ''}`
  })
}

function buildSideLinesImpl(
  node: DiffTreeNode,
  side: 'left' | 'right',
  depth: number,
  keyPrefix: string,
  comma: string,
): SideLine[] {
  const indent = '  '.repeat(depth)
  const skipType = side === 'left' ? 'added' : 'removed'

  if (node.type === skipType) return []

  if (node.type === 'same') {
    return fmtLines(node.value, depth, keyPrefix, comma).map((text) => ({ text, highlight: false }))
  }

  if (node.type === 'removed') {
    return fmtLines(node.value, depth, keyPrefix, comma).map((text) => ({ text, highlight: true }))
  }

  if (node.type === 'added') {
    return fmtLines(node.value, depth, keyPrefix, comma).map((text) => ({ text, highlight: true }))
  }

  if (node.type === 'changed') {
    const value = side === 'left' ? node.oldValue : node.newValue
    return fmtLines(value, depth, keyPrefix, comma).map((text) => ({ text, highlight: true }))
  }

  if (node.type === 'object') {
    const result: SideLine[] = []
    result.push({ text: `${indent}${keyPrefix}{`, highlight: false })
    const entriesToUse = side === 'left' ? node.entries : node.modEntries
    const visible = entriesToUse.filter(({ node: child }) => child.type !== skipType)
    visible.forEach(({ key, node: child }, idx) => {
      const isLast = idx === visible.length - 1
      result.push(...buildSideLinesImpl(child, side, depth + 1, `"${key}": `, isLast ? '' : ','))
    })
    result.push({ text: `${indent}}${comma}`, highlight: false })
    return result
  }

  if (node.type === 'array') {
    const result: SideLine[] = []
    result.push({ text: `${indent}${keyPrefix}[`, highlight: false })
    const visible = node.items.filter((item) => item.type !== skipType)
    visible.forEach((item, idx) => {
      const isLast = idx === visible.length - 1
      result.push(...buildSideLinesImpl(item, side, depth + 1, '', isLast ? '' : ','))
    })
    result.push({ text: `${indent}]${comma}`, highlight: false })
    return result
  }

  return []
}

export function buildSideLines(node: DiffTreeNode, side: 'left' | 'right'): SideLine[] {
  return buildSideLinesImpl(node, side, 0, '', '')
}

export function buildJsonDiffViewModel(
  originalText: string,
  modifiedText: string,
  options: JsonDiffOptions = {},
): JsonDiffViewModel {
  const diff = jsonDiff(originalText, modifiedText, options)
  const invalidSides: Array<'original' | 'modified'> = []
  if (diff.originalError) invalidSides.push('original')
  if (diff.modifiedError) invalidSides.push('modified')

  if (!diff.result) {
    return {
      status: 'text',
      changes: [],
      // Preserve user text even when invalid.
      originalDisplayText: originalText,
      modifiedDisplayText: modifiedText,
      originalLanguage: 'plaintext',
      modifiedLanguage: 'plaintext',
      originalError: diff.originalError,
      modifiedError: diff.modifiedError,
      invalidSides,
    }
  }

  return {
    status: 'json',
    changes: diff.result.changes,
    // Preserve user input formatting; do not pretty-rewrite.
    originalDisplayText: originalText,
    modifiedDisplayText: modifiedText,
    originalLanguage: 'json',
    modifiedLanguage: 'json',
    invalidSides,
  }
}

// ─── Path → source ranges on user text (no reformat) ────────────────────────

export type JsonPathRange = {
  startOffset: number
  endOffset: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** @deprecated alias — use JsonPathRange */
export type JsonPathLineRange = Pick<JsonPathRange, 'startLine' | 'endLine'>

export type JsonHighlightRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

/**
 * Offsets of the first character of each 1-based line.
 * Built once so path→line/col conversion is O(log L) instead of O(text length).
 * (The previous per-call scan from index 0 made large JSON path maps O(n²) and froze the UI.)
 */
function buildLineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) starts.push(i + 1)
  }
  return starts
}

function indexToLineCol(lineStarts: number[], index: number, textLength: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(index, textLength))
  // Largest lineStarts[lo] <= end
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid]! <= end) lo = mid
    else hi = mid - 1
  }
  return { line: lo + 1, column: end - lineStarts[lo]! + 1 }
}

function isJsonWs(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'
}

function isNumberChar(ch: string | undefined): boolean {
  if (!ch) return false
  const c = ch.charCodeAt(0)
  // 0-9 . e E + -
  return (c >= 48 && c <= 57) || c === 46 || c === 101 || c === 69 || c === 43 || c === 45
}

/**
 * Scan user JSON source and record character ranges for each structural path
 * (`$.a`, `$.a.b`, `$[0]`, …). Tolerates trailing commas and whitespace/newlines.
 */
export function buildJsonPathLineMap(text: string): Map<string, JsonPathRange> | null {
  const source = text.replace(/^\uFEFF/, '')
  const ranges = new Map<string, JsonPathRange>()
  const lineStarts = buildLineStarts(source)
  let i = 0

  const skipWs = () => {
    while (i < source.length && isJsonWs(source[i])) i++
  }

  const peek = () => source[i]
  const take = () => source[i++]

  const parseString = (): string => {
    if (take() !== '"') throw new Error('expected string')
    let out = ''
    while (i < source.length) {
      const ch = take()
      if (ch === '"') return out
      if (ch === '\\') {
        const esc = take()
        switch (esc) {
          case '"':
          case '\\':
          case '/':
            out += esc
            break
          case 'b': out += '\b'; break
          case 'f': out += '\f'; break
          case 'n': out += '\n'; break
          case 'r': out += '\r'; break
          case 't': out += '\t'; break
          case 'u': {
            const hex = source.slice(i, i + 4)
            i += 4
            out += String.fromCharCode(parseInt(hex, 16) || 0)
            break
          }
          default:
            out += esc ?? ''
        }
      } else {
        out += ch
      }
    }
    throw new Error('unterminated string')
  }

  const parsePrimitive = () => {
    if (source.startsWith('true', i)) { i += 4; return }
    if (source.startsWith('false', i)) { i += 5; return }
    if (source.startsWith('null', i)) { i += 4; return }
    const start = i
    if (source[i] === '-') i++
    while (i < source.length && isNumberChar(source[i])) i++
    if (i === start || (source[start] === '-' && i === start + 1)) throw new Error('bad number')
  }

  const record = (path: string, start: number, end: number) => {
    const safeEnd = Math.max(start, end)
    const startPos = indexToLineCol(lineStarts, start, source.length)
    const endPos = indexToLineCol(lineStarts, Math.max(start, safeEnd - 1), source.length)
    ranges.set(path, {
      startOffset: start,
      endOffset: safeEnd,
      startLine: startPos.line,
      startColumn: startPos.column,
      endLine: endPos.line,
      // end column is exclusive for Monaco (point after last char)
      endColumn: endPos.column + 1,
    })
  }

  const parseValue = (path: string): void => {
    skipWs()
    const start = i
    const ch = peek()
    if (ch === '{') parseObject(path)
    else if (ch === '[') parseArray(path)
    else if (ch === '"') { parseString() }
    else parsePrimitive()
    record(path, start, i)
  }

  const parseObject = (path: string) => {
    if (take() !== '{') throw new Error('expected {')
    skipWs()
    if (peek() === '}') { take(); return }
    while (i < source.length) {
      skipWs()
      const entryStart = i
      const key = parseString()
      skipWs()
      if (take() !== ':') throw new Error('expected :')
      const childPath = path === '$' ? `$.${key}` : `${path}.${key}`
      parseValue(childPath)
      // Include trailing comma in the property block when present (one visual block).
      skipWs()
      let entryEnd = i
      if (peek() === ',') {
        take()
        entryEnd = i
        skipWs()
        record(childPath, entryStart, entryEnd)
        if (peek() === '}') { take(); return }
        continue
      }
      record(childPath, entryStart, entryEnd)
      if (peek() === '}') { take(); return }
      throw new Error('expected , or }')
    }
    throw new Error('unterminated object')
  }

  const parseArray = (path: string) => {
    if (take() !== '[') throw new Error('expected [')
    skipWs()
    if (peek() === ']') { take(); return }
    let index = 0
    while (i < source.length) {
      const childPath = `${path}[${index}]`
      const elStart = i
      parseValue(childPath)
      skipWs()
      let elEnd = i
      if (peek() === ',') {
        take()
        elEnd = i
        skipWs()
        record(childPath, elStart, elEnd)
        index++
        if (peek() === ']') { take(); return }
        continue
      }
      record(childPath, elStart, elEnd)
      index++
      if (peek() === ']') { take(); return }
      throw new Error('expected , or ]')
    }
    throw new Error('unterminated array')
  }

  try {
    parseValue('$')
    skipWs()
    return ranges
  } catch {
    return null
  }
}

function rangeToHighlight(range: JsonPathRange): JsonHighlightRange {
  return {
    startLineNumber: range.startLine,
    startColumn: range.startColumn,
    endLineNumber: range.endLine,
    endColumn: range.endColumn,
  }
}

/** Merge overlapping / adjacent ranges into fewer visual blocks. */
export function mergeHighlightRanges(ranges: JsonHighlightRange[]): JsonHighlightRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) =>
    a.startLineNumber - b.startLineNumber ||
    a.startColumn - b.startColumn ||
    a.endLineNumber - b.endLineNumber ||
    a.endColumn - b.endColumn,
  )
  const out: JsonHighlightRange[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const prev = out[out.length - 1]!
    const sameLineTouch =
      prev.endLineNumber === cur.startLineNumber &&
      cur.startColumn <= prev.endColumn + 1
    const multiLineOverlap =
      cur.startLineNumber < prev.endLineNumber ||
      (cur.startLineNumber === prev.endLineNumber && cur.startColumn <= prev.endColumn + 1)
    if (sameLineTouch || multiLineOverlap) {
      if (
        cur.endLineNumber > prev.endLineNumber ||
        (cur.endLineNumber === prev.endLineNumber && cur.endColumn > prev.endColumn)
      ) {
        prev.endLineNumber = cur.endLineNumber
        prev.endColumn = cur.endColumn
      }
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

function pushRange(
  lines: Set<number>,
  ranges: JsonHighlightRange[],
  range: JsonPathRange | undefined,
) {
  if (!range) return
  for (let line = range.startLine; line <= range.endLine; line++) lines.add(line)
  ranges.push(rangeToHighlight(range))
}

/**
 * JSON mode highlights on the user's original text (no auto-format).
 * Returns character-range blocks for precise inline/multi-line decoration.
 * Returns null when either side is not parseable as JSON.
 */
export function computeJsonLineHighlights(
  leftText: string,
  rightText: string,
  options: JsonDiffOptions = {},
): {
  leftHighlights: number[]
  rightHighlights: number[]
  leftRanges: JsonHighlightRange[]
  rightRanges: JsonHighlightRange[]
  changes: JsonDiffChange[]
} | null {
  const leftParsed = parseJson(leftText)
  const rightParsed = parseJson(rightText)
  if (!leftParsed.ok || !rightParsed.ok || leftParsed.value == null || rightParsed.value == null) {
    return null
  }

  const changes = computeJsonDiff(leftParsed.value, rightParsed.value, options)
  const leftMap = buildJsonPathLineMap(leftText)
  const rightMap = buildJsonPathLineMap(rightText)
  if (!leftMap || !rightMap) return null

  const leftLines = new Set<number>()
  const rightLines = new Set<number>()
  const leftRangesRaw: JsonHighlightRange[] = []
  const rightRangesRaw: JsonHighlightRange[] = []

  for (const change of changes) {
    if (change.kind === 'removed' || change.kind === 'changed') {
      pushRange(leftLines, leftRangesRaw, leftMap.get(change.path))
    }
    if (change.kind === 'added' || change.kind === 'changed') {
      pushRange(rightLines, rightRangesRaw, rightMap.get(change.path))
    }
  }

  return {
    leftHighlights: [...leftLines].sort((a, b) => a - b),
    rightHighlights: [...rightLines].sort((a, b) => a - b),
    leftRanges: mergeHighlightRanges(leftRangesRaw),
    rightRanges: mergeHighlightRanges(rightRangesRaw),
    changes,
  }
}
