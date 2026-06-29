/**
 * JS Filter completion helpers — extracted from index to satisfy architecture boundary.
 */
import * as monaco from 'monaco-editor'

type CompletionKind = 'field' | 'method'

type CompletionItem = {
  label: string
  insertText: string
  detail: string
  kind: CompletionKind
  snippet?: boolean
  replaceStart?: number
}

type CompletionContext = {
  basePath: string
  partial: string
  replaceStart: number
  dotStart: number
}

const METHOD_COMPLETIONS: CompletionItem[] = [
  { label: '.map()', insertText: '.map(${1:x} => ${2:x})', detail: 'Transform array items', kind: 'method', snippet: true },
  { label: '.filter()', insertText: '.filter(${1:x} => ${2:x})', detail: 'Keep matching array items', kind: 'method', snippet: true },
  { label: '.find()', insertText: '.find(${1:x} => ${2:x})', detail: 'Find first matching item', kind: 'method', snippet: true },
  { label: '.some()', insertText: '.some(${1:x} => ${2:x})', detail: 'Check any item matches', kind: 'method', snippet: true },
  { label: '.every()', insertText: '.every(${1:x} => ${2:x})', detail: 'Check all items match', kind: 'method', snippet: true },
  { label: '.slice()', insertText: '.slice(${1:0})', detail: 'Take a range', kind: 'method', snippet: true },
  { label: '.length', insertText: '.length', detail: 'Read length', kind: 'method' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text || '')
  } catch {
    return null
  }
}

function getCompletionContext(beforeCursor: string): CompletionContext | null {
  const partialMatch = beforeCursor.match(/[A-Za-z_$][\w$]*$/)
  const partial = partialMatch?.[0] ?? ''
  const partialStart = partial ? beforeCursor.length - partial.length : beforeCursor.length
  const dotStart = beforeCursor[partialStart - 1] === '.'
    ? partialStart - 1
    : beforeCursor.endsWith('.')
      ? beforeCursor.length - 1
      : -1

  if (dotStart < 0) return null

  return {
    basePath: beforeCursor.slice(0, dotStart),
    partial,
    replaceStart: partialStart,
    dotStart,
  }
}

function readPath(root: unknown, path: string): unknown {
  if (!path) return root

  let current = root
  let index = 0

  while (index < path.length) {
    if (path[index] === '.') {
      index += 1
      const keyMatch = path.slice(index).match(/^[A-Za-z_$][\w$]*/)
      if (!keyMatch) return undefined
      current = readProperty(current, keyMatch[0])
      index += keyMatch[0].length
      continue
    }

    if (path[index] === '[') {
      const end = path.indexOf(']', index)
      if (end < 0) return undefined
      const token = path.slice(index + 1, end).trim()
      const key = parseBracketKey(token)
      if (key === null) return undefined
      current = readProperty(current, key)
      index = end + 1
      continue
    }

    return undefined
  }

  return current
}

function readProperty(value: unknown, key: string | number): unknown {
  if (Array.isArray(value) && typeof key === 'number') return value[key]
  if (isRecord(value) && typeof key === 'string') return value[key]
  return undefined
}

function parseBracketKey(token: string): string | number | null {
  if (/^\d+$/.test(token)) return Number(token)
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    try {
      return JSON.parse(token.startsWith("'") ? `"${token.slice(1, -1).replace(/"/g, '\\"')}"` : token)
    } catch {
      return null
    }
  }
  return null
}

function describeValue(value: unknown) {
  if (Array.isArray(value)) return `array(${value.length})`
  if (value === null) return 'null'
  return typeof value
}

function buildCompletionItems(root: unknown | null, context: CompletionContext | null): CompletionItem[] {
  if (!context) return []

  const normalizedPartial = context.partial.toLowerCase()
  const target = root === null ? undefined : readPath(root, context.basePath)
  const fields = isRecord(target)
    ? Object.keys(target)
      .filter((key) => !normalizedPartial || key.toLowerCase().startsWith(normalizedPartial))
      .slice(0, 30)
      .map((key): CompletionItem => ({
        label: key,
        insertText: isIdentifier(key) ? key : `[${JSON.stringify(key)}]`,
        detail: describeValue(target[key]),
        kind: 'field',
        replaceStart: isIdentifier(key) ? context.replaceStart : context.dotStart,
      }))
    : []

  const methods = METHOD_COMPLETIONS
    .filter((item) => {
      const methodName = item.label.slice(1).replace(/\(\)$/, '')
      return !normalizedPartial || methodName.startsWith(normalizedPartial)
    })
    .map((item) => ({ ...item, replaceStart: context.dotStart }))

  return [...fields, ...methods].slice(0, 40)
}

function toMonacoSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  items: CompletionItem[],
): monaco.languages.CompletionItem[] {
  const cursorOffset = model.getOffsetAt(position)

  return items.map((item) => {
    const start = model.getPositionAt(item.replaceStart ?? cursorOffset)
    const range = {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }

    return {
      label: item.label,
      kind: item.kind === 'field'
        ? monaco.languages.CompletionItemKind.Field
        : monaco.languages.CompletionItemKind.Method,
      insertText: item.insertText,
      insertTextRules: item.snippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      detail: item.detail,
      range,
    }
  })
}

export { getCompletionContext, buildCompletionItems, toMonacoSuggestions, parseJson }
