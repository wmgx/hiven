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
 * The original side preserves its own key insertion order. The modified side
 * can receive the original value as a reference so shared keys are displayed in
 * the same order without falling back to alphabetical sorting.
 */
export function displayStringify(
  value: JsonValue,
  reference?: JsonValue,
  options: JsonDiffOptions = {}
): string {
  return JSON.stringify(normalizeJsonForDisplay(value, reference, options), null, 2)
}

function normalizeJsonForDisplay(
  value: JsonValue,
  reference: JsonValue | undefined,
  options: JsonDiffOptions
): JsonValue {
  if (value === null || typeof value !== 'object') {
    return value
  }

  if (Array.isArray(value)) {
    const referenceArray = Array.isArray(reference) ? reference : undefined
    const arrayMode = options.arrayCompareMode
    if (arrayMode?.type === 'unordered-scalar' && value.every(isScalar)) {
      return [...value].sort(compareJsonValues)
    }
    if (arrayMode?.type === 'by-object-key') {
      return sortArrayByObjectKeyForDisplay(value, referenceArray, arrayMode.key, options)
    }
    return value.map((item, index) => normalizeJsonForDisplay(item, referenceArray?.[index], options))
  }

  const referenceObj = isJsonObject(reference) ? reference : undefined
  const valueObj = value as Record<string, JsonValue>
  const keys = orderObjectKeysForDisplay(valueObj, referenceObj)
  const result: Record<string, JsonValue> = {}
  for (const key of keys) {
    result[key] = normalizeJsonForDisplay(valueObj[key], referenceObj?.[key], options)
  }
  return result
}

function orderObjectKeysForDisplay(
  value: Record<string, JsonValue>,
  reference?: Record<string, JsonValue>
): string[] {
  const valueKeys = Object.keys(value)
  if (!reference) return valueKeys

  const valueKeySet = new Set(valueKeys)
  const sharedInReferenceOrder = Object.keys(reference).filter((key) => valueKeySet.has(key))
  const addedInValueOrder = valueKeys.filter((key) => !(key in reference))
  return [...sharedInReferenceOrder, ...addedInValueOrder]
}

function sortArrayByObjectKeyForDisplay(
  items: JsonValue[],
  reference: JsonValue[] | undefined,
  key: string,
  options: JsonDiffOptions
): JsonValue[] {
  const sortedItems = sortArrayByObjectKey(items, key)
  const sortedReference = reference ? sortArrayByObjectKey(reference, key) : undefined
  return sortedItems.map((item, index) => normalizeJsonForDisplay(item, sortedReference?.[index], options))
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)
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
  const originalNormalized = displayStringify(origParsed.value!, undefined, options)
  const modifiedNormalized = displayStringify(modParsed.value!, origParsed.value!, options)

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

/**
 * Build the text model consumed by Monaco DiffEditor.
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
