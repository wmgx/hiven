/**
 * FluxText Core - Core JSON Diff Renderer
 * Shows raw pane text in an editable DiffEditor.
 * When both panes contain valid JSON: shows semantic diff summary above.
 * When either is invalid: fallback to plain text diff with a subtle note.
 * Adapted from JsonObjectDiffRenderer for the new RendererProps API.
 * Registered as 'core.json-diff' in the production plugin registry.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { jsonDiff } from '../workspace/jsonDiff'
import type { PaneInput, RendererProps } from '../workspace/pluginTypes'
import type { JsonDiffChange, JsonValue } from '../workspace/jsonDiff'
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
    const options = {
      arrayCompareMode: arrayMode === 'by-object-key'
        ? { type: 'by-object-key' as const, key: objectKey }
        : { type: arrayMode as 'by-index' | 'unordered-scalar' }
    }
    return jsonDiff(originalText, modifiedText, options)
  }, [originalPaneId, modifiedPaneId, originalText, modifiedText, arrayMode, objectKey])

  const isJsonValid = diffResult && !diffResult.originalError && !diffResult.modifiedError
  const changes = (isJsonValid && diffResult?.result?.changes) || []

  const jumpToChange = useCallback((idx: number) => {
    if (changes.length === 0) return
    const clampedIdx = Math.max(0, Math.min(idx, changes.length - 1))
    setCurrentChangeIdx(clampedIdx)
    changeRefs.current[clampedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [changes.length])

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
  const normalizedOriginal = diffResult?.result?.originalNormalized ?? originalText
  const normalizedModified = diffResult?.result?.modifiedNormalized ?? modifiedText

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
              {currentChangeIdx + 1}/{changes.length}
            </span>
            <button
              className="text-[10px] px-1 py-0.5 rounded hover:opacity-80"
              style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
              onClick={() => jumpToChange(currentChangeIdx + 1)}
              disabled={currentChangeIdx >= changes.length - 1}
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
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div
            className="w-[320px] shrink-0 overflow-auto"
            style={{
              borderRight: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
            }}
          >
            <div className="px-3 py-2 text-[10px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t(locale, 'diff.semanticChanges')}
            </div>
            {changes.length === 0 ? (
              <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                {t(locale, 'diff.semanticEqual')}
              </div>
            ) : (
              <div className="px-2 pb-2 space-y-2">
                {changes.map((change, index) => (
                  <SemanticChangeRow
                    key={`${change.kind}:${change.path}:${index}`}
                    change={change}
                    active={index === currentChangeIdx}
                    locale={locale}
                    refSetter={(el) => { changeRefs.current[index] = el }}
                    onClick={() => setCurrentChangeIdx(index)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className={`flex flex-1 min-w-0 overflow-hidden ${renderSideBySide ? 'flex-row' : 'flex-col'}`}>
            <EditableJsonPane
              title={`${t(locale, 'diff.original')}: ${originalPane.title}`}
              value={normalizedOriginal}
              onChange={(value) => {
                if (originalPaneId) host.updatePaneText(originalPaneId, value)
              }}
              onFocus={() => {
                if (originalPaneId) host.focusPane(originalPaneId)
              }}
              settings={settings}
            />
            <EditableJsonPane
              title={`${t(locale, 'diff.modified')}: ${modifiedPane.title}`}
              value={normalizedModified}
              onChange={(value) => {
                if (modifiedPaneId) host.updatePaneText(modifiedPaneId, value)
              }}
              onFocus={() => {
                if (modifiedPaneId) host.focusPane(modifiedPaneId)
              }}
              settings={settings}
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DiffEditor
            height="100%"
            original={initialOriginal}
            modified={initialModified}
            originalLanguage="plaintext"
            modifiedLanguage="plaintext"
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

function EditableJsonPane({
  title,
  value,
  onChange,
  onFocus,
  settings,
}: {
  title: string
  value: string
  onChange: (value: string) => void
  onFocus: () => void
  settings: ReturnType<typeof useAppStore.getState>['settings']
}) {
  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
      <div
        className="h-[24px] shrink-0 flex items-center px-3 text-[10px]"
        style={{
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {title}
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language="json"
          value={value}
          onChange={(next) => onChange(next ?? '')}
          onMount={(editor) => {
            editor.onDidFocusEditorText(onFocus)
          }}
          options={{
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
          }}
          theme="vs"
        />
      </div>
    </div>
  )
}

function SemanticChangeRow({
  change,
  active,
  locale,
  refSetter,
  onClick,
}: {
  change: JsonDiffChange
  active: boolean
  locale: import('../i18n').Locale
  refSetter: (el: HTMLDivElement | null) => void
  onClick: () => void
}) {
  return (
    <div
      ref={refSetter}
      className="rounded-md px-2 py-2 cursor-pointer"
      style={{
        border: active ? '1px solid var(--color-accent)' : '0.5px solid var(--color-border-tertiary)',
        background: active ? 'var(--color-accent-bg)' : 'var(--color-background-primary)',
      }}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-medium" style={{ color: changeColor(change.kind) }}>
          {changeKindLabel(locale, change.kind)}
        </span>
        <span className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
          {change.path}
        </span>
      </div>
      <ChangeValues change={change} locale={locale} />
    </div>
  )
}

function ChangeValues({ change, locale }: { change: JsonDiffChange; locale: import('../i18n').Locale }) {
  if (change.kind === 'added') {
    return <ValueBlock label={t(locale, 'diff.after')} value={change.newValue} color="var(--color-success-text)" />
  }
  if (change.kind === 'removed') {
    return <ValueBlock label={t(locale, 'diff.before')} value={change.oldValue} color="var(--color-error-text)" />
  }
  if (change.kind === 'changed') {
    return (
      <div className="space-y-1">
        <ValueBlock label={t(locale, 'diff.before')} value={change.oldValue} color="var(--color-error-text)" />
        <ValueBlock label={t(locale, 'diff.after')} value={change.newValue} color="var(--color-success-text)" />
      </div>
    )
  }
  return (
    <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
      {change.note}
    </div>
  )
}

function ValueBlock({ label, value, color }: { label: string; value: JsonValue; color: string }) {
  return (
    <div>
      <div className="text-[9px] mb-0.5" style={{ color }}>{label}</div>
      <pre
        className="text-[10px] leading-snug whitespace-pre-wrap break-words max-h-[90px] overflow-auto"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {formatJsonValue(value)}
      </pre>
    </div>
  )
}

function formatJsonValue(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function changeKindLabel(locale: import('../i18n').Locale, kind: JsonDiffChange['kind']): string {
  if (kind === 'added') return t(locale, 'diff.added')
  if (kind === 'removed') return t(locale, 'diff.removed')
  if (kind === 'changed') return t(locale, 'diff.changed')
  return t(locale, 'diff.reordered')
}

function changeColor(kind: JsonDiffChange['kind']): string {
  if (kind === 'added') return 'var(--color-success-text)'
  if (kind === 'removed') return 'var(--color-error-text)'
  if (kind === 'changed') return 'var(--color-warning-text, #856404)'
  return 'var(--color-text-secondary)'
}
