/**
 * FluxText Core - Core JSON Diff Renderer
 * Shows raw pane text in an editable DiffEditor.
 * When both panes contain valid JSON: shows semantic diff summary above.
 * When either is invalid: fallback to plain text diff with a subtle note.
 * Adapted from JsonObjectDiffRenderer for the new RendererProps API.
 * Registered as 'core.json-diff' in the production plugin registry.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { jsonDiff } from '../workspace/jsonDiff'
import type { PaneInput, RendererProps } from '../workspace/pluginTypes'
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
    const editor = diffEditorRef.current
    if (changes.length === 0) return
    const clampedIdx = Math.max(0, Math.min(idx, changes.length - 1))
    setCurrentChangeIdx(clampedIdx)
    const lineChanges = editor?.getLineChanges()
    const lineChange = lineChanges?.[clampedIdx]
    if (!editor || !lineChange) return
    const line = lineChange.modifiedStartLineNumber || lineChange.originalStartLineNumber || 1
    const modifiedEditor = editor.getModifiedEditor()
    modifiedEditor.revealLineInCenter(line)
    modifiedEditor.setPosition({ lineNumber: line, column: 1 })
    modifiedEditor.focus()
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
    </div>
  )
}
