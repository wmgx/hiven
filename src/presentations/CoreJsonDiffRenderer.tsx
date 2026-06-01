/**
 * FluxText Core - Core JSON Diff Renderer
 * Shows semantic JSON differences with a red/green aligned view.
 * When either is invalid: fallback to plain text diff with a subtle note.
 * Adapted from JsonObjectDiffRenderer for the new RendererProps API.
 * Registered as 'core.json-diff' in the production plugin registry.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { jsonDiff, normalizeJson, parseJson } from '../workspace/jsonDiff'
import type { PaneInput, RendererProps } from '../workspace/pluginTypes'
import type { JsonArrayCompareMode, JsonValue } from '../workspace/jsonDiff'
import { t } from '../i18n'

type JsonDiffInputs = {
  original: PaneInput
  modified: PaneInput
  renderMode?: 'side-by-side' | 'inline'
}

export function CoreJsonDiffRenderer({ inputs, surfaceId, host }: RendererProps<JsonDiffInputs>) {
  const originalPane = inputs?.original
  const modifiedPane = inputs?.modified
  const originalPaneId = originalPane?.paneId
  const modifiedPaneId = modifiedPane?.paneId
  const originalText = originalPane?.text ?? ''
  const modifiedText = modifiedPane?.text ?? ''
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)
  const changeRefs = useRef<Array<HTMLDivElement | null>>([])
  const isInternalEdit = useRef<{ original: boolean; modified: boolean }>({ original: false, modified: false })
  const isApplyingExternalText = useRef(false)

  const [renderSideBySide, setRenderSideBySide] = useState(inputs?.renderMode !== 'inline')
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0)
  const [arrayMode, setArrayMode] = useState<'by-index' | 'unordered-scalar' | 'by-object-key'>('by-index')
  const [objectKey, setObjectKey] = useState('id')
  const arrayCompareMode = useMemo<JsonArrayCompareMode>(() => (
    arrayMode === 'by-object-key'
      ? { type: 'by-object-key', key: objectKey }
      : { type: arrayMode }
  ), [arrayMode, objectKey])

  // Store initial text for uncontrolled DiffEditor
  // When both valid on mount, use normalized text to hide formatting-only differences
  const [initialText] = useState(() => {
    if (!originalPaneId || !modifiedPaneId) return null
    return jsonDiff(originalText, modifiedText, { arrayCompareMode: { type: 'by-index' } })
  })

  const initialOriginal = initialText?.result?.originalNormalized || originalPane?.text || ''
  const initialModified = initialText?.result?.modifiedNormalized || modifiedPane?.text || ''

  // Compute JSON diff (returns error info if invalid)
  const diffResult = useMemo(() => {
    if (!originalPaneId || !modifiedPaneId) return null
    return jsonDiff(originalText, modifiedText, { arrayCompareMode })
  }, [originalPaneId, modifiedPaneId, originalText, modifiedText, arrayCompareMode])

  const isJsonValid = diffResult && !diffResult.originalError && !diffResult.modifiedError
  const changes = (isJsonValid && diffResult?.result?.changes) || []
  const semanticRows = useMemo(() => {
    if (!isJsonValid) return []
    return buildJsonDiffRows(originalText, modifiedText, arrayCompareMode)
  }, [isJsonValid, originalText, modifiedText, arrayCompareMode])
  const changedRows = useMemo(() => semanticRows.filter((row) => row.kind !== 'equal'), [semanticRows])
  const navigationChangeCount = isJsonValid ? changedRows.length : changes.length

  useEffect(() => {
    changeRefs.current = []
  }, [semanticRows])

  const jumpToChange = useCallback((idx: number) => {
    if (navigationChangeCount === 0) return
    const clampedIdx = Math.max(0, Math.min(idx, navigationChangeCount - 1))
    setCurrentChangeIdx(clampedIdx)
    if (isJsonValid) {
      changeRefs.current[clampedIdx]?.scrollIntoView({ block: 'nearest' })
      return
    }

    const editor = diffEditorRef.current
    const lineChanges = editor?.getLineChanges()
    const lineChange = lineChanges?.[clampedIdx]
    if (!editor || !lineChange) return
    const line = lineChange.modifiedStartLineNumber || lineChange.originalStartLineNumber || 1
    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.revealLineInCenter(line)
    modifiedEditor.setPosition({ lineNumber: line, column: 1 })
    modifiedEditor.focus()
  }, [isJsonValid, navigationChangeCount])

  // --- Editor mounting & edit sync ---

  const handleMount = useCallback((editor: MonacoEditor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor
    runtimeRegistry.registerDiffEditor(`json-diff-${surfaceId}`, editor)

    editor.getOriginalEditor().onDidFocusEditorText(() => {
      if (originalPaneId) host.focusPane(originalPaneId)
    })

    editor.getModifiedEditor().onDidFocusEditorText(() => {
      if (modifiedPaneId) host.focusPane(modifiedPaneId)
    })

    editor.getOriginalEditor().onDidChangeModelContent(() => {
      if (isApplyingExternalText.current) return
      if (!originalPaneId) return
      isInternalEdit.current.original = true
      host.updatePaneText(originalPaneId, editor.getOriginalEditor().getModel()?.getValue() ?? '')
    })

    editor.getModifiedEditor().onDidChangeModelContent(() => {
      if (isApplyingExternalText.current) return
      if (!modifiedPaneId) return
      isInternalEdit.current.modified = true
      host.updatePaneText(modifiedPaneId, editor.getModifiedEditor().getModel()?.getValue() ?? '')
    })
  }, [surfaceId, originalPaneId, modifiedPaneId, host])

  // Sync external text changes into editor without cursor reset
  // When JSON is valid, push normalized text to hide formatting differences
  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !originalPaneId) return
    const origEditor = editor.getOriginalEditor()
    const model = origEditor.getModel()
    if (!model) return
    if (isInternalEdit.current.original) {
      isInternalEdit.current.original = false
      return
    }

    // Determine what to show: normalized if valid, raw if invalid
    let targetText = originalText
    try {
      const parsed = JSON.parse(originalText)
      targetText = JSON.stringify(parsed, Object.keys(parsed).sort ? undefined : null, 2)
      // Use stableStringify from diffResult if available
      if (diffResult?.result?.originalNormalized) {
        targetText = diffResult.result.originalNormalized
      }
    } catch {
      // Invalid JSON - use raw text
    }

    if (model.getValue() !== targetText) {
      const fullRange = model.getFullModelRange()
      isApplyingExternalText.current = true
      try {
        origEditor.executeEdits('external', [{ range: fullRange, text: targetText, forceMoveMarkers: false }])
      } finally {
        isApplyingExternalText.current = false
      }
    }
  }, [originalPaneId, originalText, diffResult?.result?.originalNormalized])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !modifiedPaneId) return
    const modEditor = editor.getModifiedEditor()
    const model = modEditor.getModel()
    if (!model) return
    if (isInternalEdit.current.modified) {
      isInternalEdit.current.modified = false
      return
    }

    // Determine what to show: normalized if valid, raw if invalid
    let targetText = modifiedText
    try {
      const parsed = JSON.parse(modifiedText)
      targetText = JSON.stringify(parsed, Object.keys(parsed).sort ? undefined : null, 2)
      if (diffResult?.result?.modifiedNormalized) {
        targetText = diffResult.result.modifiedNormalized
      }
    } catch {
      // Invalid JSON - use raw text
    }

    if (model.getValue() !== targetText) {
      const fullRange = model.getFullModelRange()
      isApplyingExternalText.current = true
      try {
        modEditor.executeEdits('external', [{ range: fullRange, text: targetText, forceMoveMarkers: false }])
      } finally {
        isApplyingExternalText.current = false
      }
    }
  }, [modifiedPaneId, modifiedText, diffResult?.result?.modifiedNormalized])

  useEffect(() => {
    return () => {
      runtimeRegistry.unregisterDiffEditor(`json-diff-${surfaceId}`)
    }
  }, [surfaceId])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (editor) {
      editor.updateOptions({ renderSideBySide, renderSideBySideInlineBreakpoint: 0 })
    }
  }, [renderSideBySide])

  useEffect(() => {
    queueMicrotask(() => setRenderSideBySide(inputs?.renderMode !== 'inline'))
  }, [inputs?.renderMode])

  if (!originalPane || !modifiedPane) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t(locale, 'core.jsonDiff.title')}: {originalPane.title} ↔ {modifiedPane.title}
        </span>

        {!isJsonValid && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>
            {t(locale, 'diff.invalidJson')}
          </span>
        )}

        {isJsonValid && changes.length > 0 && (
          <>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
              background: 'var(--color-warning-bg, #fff3cd)',
              color: 'var(--color-warning-text, #856404)',
            }}>
              {t(locale, 'diff.changeCount', { count: changes.length })}
            </span>
            <button
              className="text-[10px] px-1 py-0.5 rounded hover:opacity-80"
              style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
              onClick={() => jumpToChange(currentChangeIdx - 1)}
              disabled={currentChangeIdx <= 0}
            >
              ↑
            </button>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {Math.min(currentChangeIdx + 1, navigationChangeCount)}/{navigationChangeCount}
            </span>
            <button
              className="text-[10px] px-1 py-0.5 rounded hover:opacity-80"
              style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
              onClick={() => jumpToChange(currentChangeIdx + 1)}
              disabled={currentChangeIdx >= navigationChangeCount - 1}
            >
              ↓
            </button>
          </>
        )}

        {isJsonValid && changes.length === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
            background: 'var(--color-success-bg)',
            color: 'var(--color-success-text)',
          }}>
            ✓ {t(locale, 'diff.semanticEqual')}
          </span>
        )}

        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{
            background: renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          onClick={() => setRenderSideBySide(true)}
        >
          {t(locale, 'diff.sideBySide')}
        </button>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{
            background: !renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: !renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          onClick={() => setRenderSideBySide(false)}
        >
          {t(locale, 'diff.inline')}
        </button>

        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t(locale, 'diff.exit')}
        </button>
      </div>

      {/* Array compare options (only when JSON is valid) */}
      {isJsonValid && (
        <div
          className="h-[26px] flex items-center px-3 gap-2 shrink-0"
          style={{
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            background: 'var(--color-background-secondary)',
          }}
        >
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {t(locale, 'diff.array')}:
          </span>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'by-index' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'by-index' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('by-index')}
          >
            {t(locale, 'diff.byIndex')}
          </button>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'unordered-scalar' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'unordered-scalar' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('unordered-scalar')}
          >
            {t(locale, 'diff.unorderedScalar')}
          </button>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'by-object-key' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'by-object-key' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('by-object-key')}
          >
            {t(locale, 'diff.byKey')}
          </button>
          {arrayMode === 'by-object-key' && (
            <input
              className="text-[10px] px-1.5 py-0.5 rounded w-[60px]"
              style={{
                background: 'var(--color-background-tertiary)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-tertiary)',
              }}
              value={objectKey}
              onChange={(e) => setObjectKey(e.target.value)}
              placeholder={t(locale, 'diff.keyPlaceholder')}
            />
          )}
        </div>
      )}

      {isJsonValid ? (
        <SemanticJsonDiffView
          rows={semanticRows}
          currentChangeIdx={currentChangeIdx}
          changeRefs={changeRefs}
        />
      ) : (
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          original={initialOriginal}
          modified={initialModified}
          originalLanguage={isJsonValid ? 'json' : 'plaintext'}
          modifiedLanguage={isJsonValid ? 'json' : 'plaintext'}
          onMount={handleMount}
          options={{
            renderSideBySide,
            renderSideBySideInlineBreakpoint: 0,
            originalEditable: true,
            readOnly: false,
            fontSize: settings.fontSize,
            lineNumbers: settings.lineNumbers ? 'on' : 'off',
            wordWrap: settings.wordWrap ? 'on' : 'off',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            folding: true,
            glyphMargin: false,
            lineDecorationsWidth: 12,
            lineNumbersMinChars: 4,
            padding: { top: 12 },
            fontFamily: 'var(--font-mono)',
            renderIndicators: true,
            ignoreTrimWhitespace: false,
          }}
          theme="vs"
        />
      </div>
      )}
    </div>
  )
}

type JsonDiffRowKind = 'equal' | 'changed' | 'added' | 'removed'

type JsonDiffRow = {
  left?: string
  right?: string
  kind: JsonDiffRowKind
}

type DisplayJsonDiffRow = JsonDiffRow & {
  leftLine: number | null
  rightLine: number | null
  changeIndex: number | null
}

function SemanticJsonDiffView({
  rows,
  currentChangeIdx,
  changeRefs,
}: {
  rows: JsonDiffRow[]
  currentChangeIdx: number
  changeRefs: React.MutableRefObject<Array<HTMLDivElement | null>>
}) {
  const displayRows = useMemo(() => withLineNumbers(rows), [rows])

  return (
    <div className="flex-1 min-h-0 overflow-auto font-mono text-[13px] leading-[1.45]">
      {displayRows.map((row, index) => {
        const hasLeft = row.left !== undefined
        const hasRight = row.right !== undefined
        const active = row.changeIndex !== null && row.changeIndex === currentChangeIdx

        return (
          <div
            key={index}
            ref={(el) => {
              if (row.changeIndex !== null) changeRefs.current[row.changeIndex] = el
            }}
            className="grid min-w-max"
            style={{
              gridTemplateColumns: '64px minmax(420px, 1fr) 64px minmax(420px, 1fr)',
              outline: active ? '1px solid var(--color-accent)' : undefined,
              outlineOffset: -1,
            }}
          >
            <LineNumber value={hasLeft ? row.leftLine : null} sign={row.kind === 'removed' ? '-' : undefined} />
            <JsonCell text={row.left} side="left" kind={row.kind} />
            <LineNumber value={hasRight ? row.rightLine : null} sign={row.kind === 'added' ? '+' : undefined} />
            <JsonCell text={row.right} side="right" kind={row.kind} />
          </div>
        )
      })}
    </div>
  )
}

function withLineNumbers(rows: JsonDiffRow[]): DisplayJsonDiffRow[] {
  let leftLine = 0
  let rightLine = 0
  let changeIndex = -1

  return rows.map((row) => {
    const hasLeft = row.left !== undefined
    const hasRight = row.right !== undefined
    if (hasLeft) leftLine += 1
    if (hasRight) rightLine += 1
    if (row.kind !== 'equal') changeIndex += 1
    return {
      ...row,
      leftLine: hasLeft ? leftLine : null,
      rightLine: hasRight ? rightLine : null,
      changeIndex: row.kind !== 'equal' ? changeIndex : null,
    }
  })
}

function LineNumber({ value, sign }: { value: number | null; sign?: string }) {
  return (
    <div
      className="select-none text-right pr-2"
      style={{
        color: sign ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
        background: 'var(--color-background-secondary)',
        borderRight: '0.5px solid var(--color-border-tertiary)',
      }}
    >
      {value ?? ''}
      {sign ?? ' '}
    </div>
  )
}

function JsonCell({ text, side, kind }: { text?: string; side: 'left' | 'right'; kind: JsonDiffRowKind }) {
  const color = kind === 'removed' && side === 'left'
    ? 'rgba(255, 0, 0, 0.16)'
    : kind === 'added' && side === 'right'
      ? 'rgba(85, 170, 35, 0.18)'
      : kind === 'changed'
        ? side === 'left' ? 'rgba(255, 0, 0, 0.14)' : 'rgba(85, 170, 35, 0.16)'
        : 'transparent'

  return (
    <pre
      className="m-0 px-3 whitespace-pre overflow-hidden"
      style={{
        minHeight: '1.45em',
        background: color,
        color: text === undefined ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
      }}
    >
      {text ?? ''}
    </pre>
  )
}

function buildJsonDiffRows(
  originalText: string,
  modifiedText: string,
  arrayCompareMode: JsonArrayCompareMode
): JsonDiffRow[] {
  const originalParsed = parseJson(originalText)
  const modifiedParsed = parseJson(modifiedText)
  if (!originalParsed.ok || !modifiedParsed.ok || originalParsed.value === undefined || modifiedParsed.value === undefined) return []

  const originalValue = normalizeJson(originalParsed.value, { arrayCompareMode })
  const modifiedValue = normalizeJson(modifiedParsed.value, { arrayCompareMode })
  return renderPair(originalValue, modifiedValue, 0, undefined, false, arrayCompareMode)
}

function renderPair(
  left: JsonValue,
  right: JsonValue,
  depth: number,
  label: string | undefined,
  comma: boolean,
  arrayCompareMode: JsonArrayCompareMode
): JsonDiffRow[] {
  if (JSON.stringify(left) === JSON.stringify(right)) {
    return renderSame(left, depth, label, comma)
  }

  if (isObjectRecord(left) && isObjectRecord(right)) {
    const rows: JsonDiffRow[] = [{ left: `${indent(depth)}${label ?? ''}{`, right: `${indent(depth)}${label ?? ''}{`, kind: 'equal' }]
    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort()
    keys.forEach((key, index) => {
      const childComma = index < keys.length - 1
      const childLabel = `${JSON.stringify(key)}: `
      if (key in left && key in right) {
        rows.push(...renderPair(left[key], right[key], depth + 1, childLabel, childComma, arrayCompareMode))
      } else if (key in left) {
        rows.push(...renderSingle(left[key], 'removed', depth + 1, childLabel, childComma))
      } else {
        rows.push(...renderSingle(right[key], 'added', depth + 1, childLabel, childComma))
      }
    })
    rows.push({ left: `${indent(depth)}}${comma ? ',' : ''}`, right: `${indent(depth)}}${comma ? ',' : ''}`, kind: 'equal' })
    return rows
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const pairs = alignArrayItems(left, right, arrayCompareMode)
    const rows: JsonDiffRow[] = [{ left: `${indent(depth)}${label ?? ''}[`, right: `${indent(depth)}${label ?? ''}[`, kind: 'equal' }]
    pairs.forEach((pair, index) => {
      const childComma = index < pairs.length - 1
      if (pair.left !== undefined && pair.right !== undefined) {
        rows.push(...renderPair(pair.left, pair.right, depth + 1, undefined, childComma, arrayCompareMode))
      } else if (pair.left !== undefined) {
        rows.push(...renderSingle(pair.left, 'removed', depth + 1, undefined, childComma))
      } else if (pair.right !== undefined) {
        rows.push(...renderSingle(pair.right, 'added', depth + 1, undefined, childComma))
      }
    })
    rows.push({ left: `${indent(depth)}]${comma ? ',' : ''}`, right: `${indent(depth)}]${comma ? ',' : ''}`, kind: 'equal' })
    return rows
  }

  return [{
    left: `${indent(depth)}${label ?? ''}${formatScalar(left)}${comma ? ',' : ''}`,
    right: `${indent(depth)}${label ?? ''}${formatScalar(right)}${comma ? ',' : ''}`,
    kind: 'changed',
  }]
}

function renderSame(value: JsonValue, depth: number, label: string | undefined, comma: boolean): JsonDiffRow[] {
  return stringifyWithLabel(value, depth, label, comma).map((line) => ({ left: line, right: line, kind: 'equal' }))
}

function renderSingle(value: JsonValue, kind: 'added' | 'removed', depth: number, label: string | undefined, comma: boolean): JsonDiffRow[] {
  return stringifyWithLabel(value, depth, label, comma).map((line) => (
    kind === 'removed'
      ? { left: line, kind }
      : { right: line, kind }
  ))
}

function stringifyWithLabel(value: JsonValue, depth: number, label: string | undefined, comma: boolean): string[] {
  const rawLines = JSON.stringify(value, null, 2).split('\n')
  const prefix = indent(depth)
  if (rawLines.length === 1) return [`${prefix}${label ?? ''}${rawLines[0]}${comma ? ',' : ''}`]
  const lines = rawLines.map((line) => `${prefix}${line}`)
  lines[0] = `${prefix}${label ?? ''}${rawLines[0]}`
  lines[lines.length - 1] = `${lines[lines.length - 1]}${comma ? ',' : ''}`
  return lines
}

function alignArrayItems(
  left: JsonValue[],
  right: JsonValue[],
  arrayCompareMode: JsonArrayCompareMode
): Array<{ left?: JsonValue; right?: JsonValue }> {
  if (arrayCompareMode.type === 'by-object-key') {
    return alignArrayByObjectKey(left, right, arrayCompareMode.key)
  }
  const maxLength = Math.max(left.length, right.length)
  return Array.from({ length: maxLength }, (_, index) => ({ left: left[index], right: right[index] }))
}

function alignArrayByObjectKey(left: JsonValue[], right: JsonValue[], key: string): Array<{ left?: JsonValue; right?: JsonValue }> {
  const leftMap = mapArrayObjectsByKey(left, key)
  const rightMap = mapArrayObjectsByKey(right, key)
  const keys = Array.from(new Set([...leftMap.keys(), ...rightMap.keys()])).sort()
  const rows = keys.map((itemKey) => ({ left: leftMap.get(itemKey), right: rightMap.get(itemKey) }))
  const leftRest = left.filter((item) => !arrayObjectKey(item, key))
  const rightRest = right.filter((item) => !arrayObjectKey(item, key))
  const maxRest = Math.max(leftRest.length, rightRest.length)
  for (let index = 0; index < maxRest; index += 1) {
    rows.push({ left: leftRest[index], right: rightRest[index] })
  }
  return rows
}

function mapArrayObjectsByKey(items: JsonValue[], key: string): Map<string, JsonValue> {
  const map = new Map<string, JsonValue>()
  for (const item of items) {
    const itemKey = arrayObjectKey(item, key)
    if (itemKey) map.set(itemKey, item)
  }
  return map
}

function arrayObjectKey(value: JsonValue, key: string): string | null {
  if (!isObjectRecord(value) || !(key in value)) return null
  return JSON.stringify(value[key])
}

function isObjectRecord(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function formatScalar(value: JsonValue): string {
  return JSON.stringify(value)
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}
