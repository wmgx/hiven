/**
 * FluxText - JSON Object Diff
 * Provides JSON normalization, stable stringify, and semantic diff algorithm.
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
  | { kind: 'moved-or-reordered'; path: string; note: string }

export type JsonArrayCompareMode =
  | { type: 'by-index' }
  | { type: 'unordered-scalar' }
  | { type: 'by-object-key'; key: string }

export interface JsonDiffOptions {
  arrayCompareMode?: JsonArrayCompareMode
  ignoreKeyOrder?: boolean // default true
}

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

export function parseJson(text: string): JsonParseResult {
  const jsonText = text.replace(/^\uFEFF/, '')
  try {
    const value = JSON.parse(jsonText)
    return { ok: true, value }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON'
    // Try to extract line/column from error message
    const posMatch = msg.match(/position (\d+)/)
    let line = 1
    let column = 1
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10)
      const before = jsonText.slice(0, pos)
      line = (before.match(/\n/g) || []).length + 1
      const lastNewline = before.lastIndexOf('\n')
      column = pos - lastNewline
    }
    return { ok: false, error: msg, line, column }
  }
}

// ─── Normalize ──────────────────────────────────────────────────────────────

function isScalar(value: JsonValue): boolean {
  return value === null || typeof value !== 'object'
}

function compareJsonValues(a: JsonValue, b: JsonValue): number {
  return JSON.stringify(a).localeCompare(JSON.stringify(b))
}

/**
 * Normalize a JSON value: sort object keys recursively (stable).
 * Arrays preserve order unless a display-oriented array mode asks for alignment.
 */
export function normalizeJson(value: JsonValue, options: JsonDiffOptions = {}): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => normalizeJson(item, options))
    const arrayMode = options.arrayCompareMode
    if (arrayMode?.type === 'unordered-scalar' && normalizedItems.every(isScalar)) {
      return [...normalizedItems].sort(compareJsonValues)
    }
    if (arrayMode?.type === 'by-object-key') {
      return sortArrayByObjectKey(normalizedItems, arrayMode.key)
    }
    return normalizedItems
  }

  // Object: sort keys alphabetically
  const sortedKeys = Object.keys(value).sort()
  const result: Record<string, JsonValue> = {}
  for (const key of sortedKeys) {
    result[key] = normalizeJson(value[key], options)
  }
  return result
}

function sortArrayByObjectKey(items: JsonValue[], key: string): JsonValue[] {
  const withKey: JsonValue[] = []
  const withoutKey: JsonValue[] = []

  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item) && key in item) {
      withKey.push(item)
    } else {
      withoutKey.push(item)
    }
  }

  withKey.sort((a, b) => {
    const aKey = (a as Record<string, JsonValue>)[key]
    const bKey = (b as Record<string, JsonValue>)[key]
    return compareJsonValues(aKey, bKey)
  })

  return [...withKey, ...withoutKey]
}

/**
 * Stable stringify: canonicalize then pretty-print with 2-space indent.
 */
export function stableStringify(value: JsonValue, options: JsonDiffOptions = {}): string {
  return JSON.stringify(normalizeJson(value, options), null, 2)
}

/**
 * Display stringify keeps object key order readable.
 *
 * Each side preserves its own key insertion order. This is intentionally
 * separate from the semantic diff algorithm, which ignores object key order.
 */
export function displayStringify(
  value: JsonValue,
  options: JsonDiffOptions = {}
): string {
  return JSON.stringify(normalizeJsonForDisplay(value, options), null, 2)
}

function normalizeJsonForDisplay(
  value: JsonValue,
  options: JsonDiffOptions
): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    const arrayMode = options.arrayCompareMode
    if (arrayMode?.type === 'unordered-scalar' && value.every(isScalar)) {
      return [...value].sort(compareJsonValues)
    }
    if (arrayMode?.type === 'by-object-key') {
      return sortArrayByObjectKey(value, arrayMode.key).map((item) => normalizeJsonForDisplay(item, options))
    }
    return value.map((item) => normalizeJsonForDisplay(item, options))
  }

  const valueObj = value as Record<string, JsonValue>
  const result: Record<string, JsonValue> = {}
  for (const key of Object.keys(valueObj)) {
    result[key] = normalizeJsonForDisplay(valueObj[key], options)
  }
  return result
}

// ─── Semantic Diff ──────────────────────────────────────────────────────────

function typeOf(value: JsonValue): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Compute semantic diff between two JSON values.
 */
export function computeJsonDiff(
  original: JsonValue,
  modified: JsonValue,
  options: JsonDiffOptions = {}
): JsonDiffChange[] {
  const changes: JsonDiffChange[] = []
  const arrayMode = options.arrayCompareMode || { type: 'by-index' }

  function diffRecursive(orig: JsonValue, mod: JsonValue, path: string) {
    const origType = typeOf(orig)
    const modType = typeOf(mod)

    // Different types
    if (origType !== modType) {
      changes.push({ kind: 'changed', path, oldValue: orig, newValue: mod, oldType: origType, newType: modType })
      return
    }

    // Primitives
    if (origType !== 'object' && origType !== 'array') {
      if (orig !== mod) {
        changes.push({ kind: 'changed', path, oldValue: orig, newValue: mod, oldType: origType, newType: modType })
      }
      return
    }

    // Arrays
    if (Array.isArray(orig) && Array.isArray(mod)) {
      diffArray(orig, mod, path, arrayMode)
      return
    }

    // Objects
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

  function diffArray(orig: JsonValue[], mod: JsonValue[], path: string, mode: JsonArrayCompareMode) {
    switch (mode.type) {
      case 'by-index':
        diffArrayByIndex(orig, mod, path)
        break
      case 'unordered-scalar':
        diffArrayUnorderedScalar(orig, mod, path)
        break
      case 'by-object-key':
        diffArrayByObjectKey(orig, mod, path, mode.key)
        break
    }
  }

  function diffArrayByIndex(orig: JsonValue[], mod: JsonValue[], path: string) {
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
  }

  function diffArrayUnorderedScalar(orig: JsonValue[], mod: JsonValue[], path: string) {
    // Only works for scalar arrays
    const isScalar = (v: JsonValue) => v === null || typeof v !== 'object'
    const allScalar = orig.every(isScalar) && mod.every(isScalar)

    if (!allScalar) {
      // Fallback to by-index
      diffArrayByIndex(orig, mod, path)
      return
    }

    const origCounts = new Map<string, number>()
    const modCounts = new Map<string, number>()

    for (const v of orig) {
      const key = JSON.stringify(v)
      origCounts.set(key, (origCounts.get(key) || 0) + 1)
    }
    for (const v of mod) {
      const key = JSON.stringify(v)
      modCounts.set(key, (modCounts.get(key) || 0) + 1)
    }

    const allKeys = new Set([...origCounts.keys(), ...modCounts.keys()])
    for (const key of allKeys) {
      const origCount = origCounts.get(key) || 0
      const modCount = modCounts.get(key) || 0
      const value = JSON.parse(key)

      if (origCount > modCount) {
        for (let i = 0; i < origCount - modCount; i++) {
          changes.push({ kind: 'removed', path: `${path}[]`, oldValue: value })
        }
      } else if (modCount > origCount) {
        for (let i = 0; i < modCount - origCount; i++) {
          changes.push({ kind: 'added', path: `${path}[]`, newValue: value })
        }
      }
    }
  }

  function diffArrayByObjectKey(orig: JsonValue[], mod: JsonValue[], path: string, key: string) {
    const indexByKey = (arr: JsonValue[]): Map<string, { index: number; value: JsonValue }> => {
      const map = new Map<string, { index: number; value: JsonValue }>()
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item && typeof item === 'object' && !Array.isArray(item) && key in item) {
          const keyVal = JSON.stringify((item as Record<string, JsonValue>)[key])
          map.set(keyVal, { index: i, value: item })
        }
      }
      return map
    }

    const origMap = indexByKey(orig)
    const modMap = indexByKey(mod)
    const allKeys = new Set([...origMap.keys(), ...modMap.keys()])

    for (const k of allKeys) {
      const origEntry = origMap.get(k)
      const modEntry = modMap.get(k)
      const keyLabel = JSON.parse(k)

      if (origEntry && !modEntry) {
        changes.push({ kind: 'removed', path: `${path}[${key}=${keyLabel}]`, oldValue: origEntry.value })
      } else if (!origEntry && modEntry) {
        changes.push({ kind: 'added', path: `${path}[${key}=${keyLabel}]`, newValue: modEntry.value })
      } else if (origEntry && modEntry) {
        diffRecursive(origEntry.value, modEntry.value, `${path}[${key}=${keyLabel}]`)
      }
    }

    // Handle items without the key (fallback)
    const origWithout = orig.filter(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true
      return !(key in (item as Record<string, JsonValue>))
    })
    const modWithout = mod.filter(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return true
      return !(key in (item as Record<string, JsonValue>))
    })
    if (origWithout.length > 0 || modWithout.length > 0) {
      diffArrayByIndex(origWithout, modWithout, `${path}[no-key]`)
    }
  }

  diffRecursive(original, modified, '$')
  return changes
}

/**
 * Full JSON diff pipeline:
 * 1. Parse both inputs
 * 2. Normalize
 * 3. Compute semantic changes
 * 4. Generate stable stringified versions for Monaco Diff display
 */
export function jsonDiff(
  originalText: string,
  modifiedText: string,
  options: JsonDiffOptions = {}
): { result?: JsonDiffResult; originalError?: string; modifiedError?: string } {
  const origParsed = parseJson(originalText)
  const modParsed = parseJson(modifiedText)

  if (!origParsed.ok || !modParsed.ok) {
    return {
      originalError: origParsed.ok ? undefined : `Parse error at Ln ${origParsed.line}, Col ${origParsed.column}: ${origParsed.error}`,
      modifiedError: modParsed.ok ? undefined : `Parse error at Ln ${modParsed.line}, Col ${modParsed.column}: ${modParsed.error}`,
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
      // entries: orig key 顺序（orig keys 在前，mod-only keys 在后）
      entries: Array<{ key: string; node: DiffTreeNode }>
      // modEntries: mod key 顺序（mod keys 在前，orig-only keys 在后）
      modEntries: Array<{ key: string; node: DiffTreeNode }>
      hasChanges: boolean
    }
  | { type: 'array'; items: DiffTreeNode[]; hasChanges: boolean }

/**
 * Build a diff tree from two JSON values.
 * Nodes with no differences are marked as { type: 'same' } and can be skipped in rendering.
 */
export function buildDiffTree(
  original: JsonValue,
  modified: JsonValue,
  options: JsonDiffOptions = {}
): DiffTreeNode {
  const arrayMode = options.arrayCompareMode ?? ({ type: 'by-index' } as const)

  function nodeHasChanges(node: DiffTreeNode): boolean {
    if (node.type === 'same') return false
    if (node.type === 'object') return node.hasChanges
    if (node.type === 'array') return node.hasChanges
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
      return buildArrayNode(orig, mod)
    }

    return buildObjectNode(
      orig as Record<string, JsonValue>,
      mod as Record<string, JsonValue>
    )
  }

  function buildObjectNode(
    orig: Record<string, JsonValue>,
    mod: Record<string, JsonValue>
  ): DiffTreeNode {
    // 先把所有 key 的 DiffTreeNode 计算出来
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

    // entries: orig key 顺序（orig keys 在前，mod-only keys 在后）
    const origOnlyInMod = modKeys.filter(k => !(k in orig))
    const entries = [...origKeys, ...origOnlyInMod].map(k => ({ key: k, node: nodeMap.get(k)! }))

    // modEntries: mod key 顺序（mod keys 在前，orig-only keys 在后）
    const modOnlyInOrig = origKeys.filter(k => !(k in mod))
    const modEntries = [...modKeys, ...modOnlyInOrig].map(k => ({ key: k, node: nodeMap.get(k)! }))

    return { type: 'object', entries, modEntries, hasChanges }
  }

  function buildArrayNode(orig: JsonValue[], mod: JsonValue[]): DiffTreeNode {
    if (arrayMode.type === 'unordered-scalar') return buildArrayUnorderedScalar(orig, mod)
    if (arrayMode.type === 'by-object-key') return buildArrayByObjectKey(orig, mod, arrayMode.key)
    return buildArrayByIndex(orig, mod)
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

  function buildArrayUnorderedScalar(orig: JsonValue[], mod: JsonValue[]): DiffTreeNode {
    const isScalarVal = (v: JsonValue) => v === null || typeof v !== 'object'
    if (!orig.every(isScalarVal) || !mod.every(isScalarVal)) return buildArrayByIndex(orig, mod)

    const origCounts = new Map<string, number>()
    const modCounts = new Map<string, number>()
    for (const v of orig) { const k = JSON.stringify(v); origCounts.set(k, (origCounts.get(k) || 0) + 1) }
    for (const v of mod)  { const k = JSON.stringify(v); modCounts.set(k, (modCounts.get(k) || 0) + 1) }

    const allKeys = new Set([...origCounts.keys(), ...modCounts.keys()])
    const items: DiffTreeNode[] = []
    let hasChanges = false

    for (const k of allKeys) {
      const oc = origCounts.get(k) || 0
      const mc = modCounts.get(k) || 0
      const value = JSON.parse(k) as JsonValue
      for (let i = 0; i < Math.max(oc, mc); i++) {
        if (i < oc && i < mc) {
          items.push({ type: 'same', value })
        } else if (i < oc) {
          items.push({ type: 'removed', value }); hasChanges = true
        } else {
          items.push({ type: 'added', value }); hasChanges = true
        }
      }
    }

    return { type: 'array', items, hasChanges }
  }

  function buildArrayByObjectKey(orig: JsonValue[], mod: JsonValue[], key: string): DiffTreeNode {
    const toMap = (arr: JsonValue[]): Map<string, JsonValue> => {
      const map = new Map<string, JsonValue>()
      for (const item of arr) {
        if (item && typeof item === 'object' && !Array.isArray(item) && key in (item as Record<string, JsonValue>)) {
          map.set(JSON.stringify((item as Record<string, JsonValue>)[key]), item)
        }
      }
      return map
    }

    const origMap = toMap(orig)
    const modMap = toMap(mod)
    const allKeys = [...new Set([...origMap.keys(), ...modMap.keys()])].sort()
    const items: DiffTreeNode[] = []
    let hasChanges = false

    for (const k of allKeys) {
      const origItem = origMap.get(k)
      const modItem = modMap.get(k)
      let node: DiffTreeNode

      if (origItem !== undefined && modItem === undefined) {
        node = { type: 'removed', value: origItem }; hasChanges = true
      } else if (origItem === undefined && modItem !== undefined) {
        node = { type: 'added', value: modItem }; hasChanges = true
      } else if (origItem !== undefined && modItem !== undefined) {
        node = build(origItem, modItem)
        if (nodeHasChanges(node)) hasChanges = true
      } else {
        node = { type: 'same' }
      }
      items.push(node)
    }

    return { type: 'array', items, hasChanges }
  }

  return build(original, modified)
}

// ─── Side Lines (for dual Monaco editor) ────────────────────────────────────

export type SideLine = {
  text: string
  highlight: boolean
}

/** Serialize a JSON value into indented lines with key prefix and trailing comma. */
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
  // left 侧跳过 added（原始 JSON 里没有）；right 侧跳过 removed（修改后 JSON 里没有）
  const skipType = side === 'left' ? 'added' : 'removed'

  if (node.type === skipType) return []

  if (node.type === 'same') {
    return fmtLines(node.value, depth, keyPrefix, comma).map(text => ({ text, highlight: false }))
  }

  if (node.type === 'removed') {
    // 只有 left 侧会到这里
    return fmtLines(node.value, depth, keyPrefix, comma).map(text => ({ text, highlight: true }))
  }

  if (node.type === 'added') {
    // 只有 right 侧会到这里
    return fmtLines(node.value, depth, keyPrefix, comma).map(text => ({ text, highlight: true }))
  }

  if (node.type === 'changed') {
    const value = side === 'left' ? node.oldValue : node.newValue
    return fmtLines(value, depth, keyPrefix, comma).map(text => ({ text, highlight: true }))
  }

  if (node.type === 'object') {
    const result: SideLine[] = []
    result.push({ text: `${indent}${keyPrefix}{`, highlight: false })
    // left 侧按 orig key 顺序，right 侧按 mod key 顺序
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
    const visible = node.items.filter(item => item.type !== skipType)
    visible.forEach((item, idx) => {
      const isLast = idx === visible.length - 1
      result.push(...buildSideLinesImpl(item, side, depth + 1, '', isLast ? '' : ','))
    })
    result.push({ text: `${indent}]${comma}`, highlight: false })
    return result
  }

  return []
}

/**
 * Build the text and highlight information for one side of a semantic diff.
 * side='left' → original JSON (without added entries)
 * side='right' → modified JSON (without removed entries)
 */
export function buildSideLines(node: DiffTreeNode, side: 'left' | 'right'): SideLine[] {
  return buildSideLinesImpl(node, side, 0, '', '')
}

/**
 * Build the text model consumed by the JSON diff renderer.
 *
 * Valid JSON is displayed as pretty text that preserves object key order while
 * aligning shared keys across sides. Invalid JSON deliberately falls back to raw
 * text diff for both sides.
 */
export function buildJsonDiffViewModel(
  originalText: string,
  modifiedText: string,
  options: JsonDiffOptions = {}
): JsonDiffViewModel {
  const diff = jsonDiff(originalText, modifiedText, options)
  const invalidSides: Array<'original' | 'modified'> = []
  if (diff.originalError) invalidSides.push('original')
  if (diff.modifiedError) invalidSides.push('modified')

  if (!diff.result) {
    return {
      status: 'text',
      changes: [],
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
    originalDisplayText: diff.result.originalNormalized,
    modifiedDisplayText: diff.result.modifiedNormalized,
    originalLanguage: 'json',
    modifiedLanguage: 'json',
    invalidSides,
  }
}
