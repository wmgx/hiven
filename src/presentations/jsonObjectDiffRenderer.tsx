/**
 * FluxText - JSON Object Diff Renderer
 * Shows raw pane text in an editable DiffEditor.
 * When both panes contain valid JSON: shows semantic diff summary above.
 * When either is invalid: fallback to plain text diff with a subtle note.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { jsonDiff } from '../workspace/jsonDiff'
import type { PresentationRendererProps } from '../workspace/presentationRegistry'

export function JsonObjectDiffRenderer({ session, onClose, onUpdate }: PresentationRendererProps) {
  const [originalPaneId, modifiedPaneId] = session.targetPaneIds
  const originalPane = useWorkspaceStore((s) => s.panes[originalPaneId])
  const modifiedPane = useWorkspaceStore((s) => s.panes[modifiedPaneId])
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setEditorInstance = useAppStore((s) => s.setEditorInstance)
  const settings = useAppStore((s) => s.settings)
  const diffEditorRef = useRef<any>(null)
  const isInternalEdit = useRef<{ orig: boolean; mod: boolean }>({ orig: false, mod: false })

  const renderSideBySide = (session.options.renderSideBySide as boolean) ?? true
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0)
  const [arrayMode, setArrayMode] = useState<'by-index' | 'unordered-scalar' | 'by-object-key'>('by-index')
  const [objectKey, setObjectKey] = useState('id')

  // Store initial text for uncontrolled DiffEditor
  // When both valid on mount, use normalized text to hide formatting-only differences
  const initialDiffResult = useMemo(() => {
    if (!originalPane || !modifiedPane) return null
    return jsonDiff(originalPane.text, modifiedPane.text, { arrayCompareMode: { type: 'by-index' } })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // only compute on mount

  const initialOriginal = useRef(
    (initialDiffResult?.result?.originalNormalized) || originalPane?.text || ''
  )
  const initialModified = useRef(
    (initialDiffResult?.result?.modifiedNormalized) || modifiedPane?.text || ''
  )

  // Compute JSON diff (returns error info if invalid)
  const diffResult = useMemo(() => {
    if (!originalPane || !modifiedPane) return null
    const options = {
      arrayCompareMode: arrayMode === 'by-object-key'
        ? { type: 'by-object-key' as const, key: objectKey }
        : { type: arrayMode as 'by-index' | 'unordered-scalar' }
    }
    return jsonDiff(originalPane.text, modifiedPane.text, options)
  }, [originalPane?.text, modifiedPane?.text, arrayMode, objectKey])

  const isJsonValid = diffResult && !diffResult.originalError && !diffResult.modifiedError
  const changes = (isJsonValid && diffResult?.result?.changes) || []

  // Jump to diff change in editor
  const jumpToChange = useCallback((idx: number) => {
    const editor = diffEditorRef.current
    if (!editor || changes.length === 0) return
    const clampedIdx = Math.max(0, Math.min(idx, changes.length - 1))
    setCurrentChangeIdx(clampedIdx)

    // Use Monaco diff navigation
    const modEditor = editor.getModifiedEditor()
    const lineChanges = editor.getLineChanges()
    if (lineChanges && lineChanges[clampedIdx]) {
      const line = lineChanges[clampedIdx].modifiedStartLineNumber || lineChanges[clampedIdx].originalStartLineNumber || 1
      modEditor.revealLineInCenter(line)
      modEditor.setPosition({ lineNumber: line, column: 1 })
      modEditor.focus()
    }
  }, [changes.length])

  // --- Editor mounting & edit sync (same pattern as monacoDiffRenderer) ---

  const handleMount = useCallback((editor: any) => {
    diffEditorRef.current = editor
    runtimeRegistry.registerDiffEditor(`json-diff-${session.id}`, editor)

    const origEditor = editor.getOriginalEditor()
    const modEditor = editor.getModifiedEditor()

    origEditor.onDidFocusEditorText(() => {
      setActivePaneId(originalPaneId)
      setEditorInstance(origEditor)
    })

    modEditor.onDidFocusEditorText(() => {
      setActivePaneId(modifiedPaneId)
      setEditorInstance(modEditor)
    })

    origEditor.onDidChangeModelContent(() => {
      isInternalEdit.current.orig = true
      const text = origEditor.getModel()?.getValue() || ''
      setPaneText(originalPaneId, text)
    })

    modEditor.onDidChangeModelContent(() => {
      isInternalEdit.current.mod = true
      const text = modEditor.getModel()?.getValue() || ''
      setPaneText(modifiedPaneId, text)
    })
  }, [session.id, originalPaneId, modifiedPaneId, setPaneText, setActivePaneId, setEditorInstance])

  // Sync external text changes into editor without cursor reset
  // When JSON is valid, push normalized text to hide formatting differences
  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !originalPane) return
    if (isInternalEdit.current.orig) {
      isInternalEdit.current.orig = false
      return
    }
    const origEditor = editor.getOriginalEditor()
    const model = origEditor.getModel()
    if (!model) return

    // Determine what to show: normalized if valid, raw if invalid
    let targetText = originalPane.text
    try {
      const parsed = JSON.parse(originalPane.text)
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
      origEditor.executeEdits('external', [{ range: fullRange, text: targetText, forceMoveMarkers: false }])
    }
  }, [originalPane?.text])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !modifiedPane) return
    if (isInternalEdit.current.mod) {
      isInternalEdit.current.mod = false
      return
    }
    const modEditor = editor.getModifiedEditor()
    const model = modEditor.getModel()
    if (!model) return

    // Determine what to show: normalized if valid, raw if invalid
    let targetText = modifiedPane.text
    try {
      const parsed = JSON.parse(modifiedPane.text)
      targetText = JSON.stringify(parsed, Object.keys(parsed).sort ? undefined : null, 2)
      if (diffResult?.result?.modifiedNormalized) {
        targetText = diffResult.result.modifiedNormalized
      }
    } catch {
      // Invalid JSON - use raw text
    }

    if (model.getValue() !== targetText) {
      const fullRange = model.getFullModelRange()
      modEditor.executeEdits('external', [{ range: fullRange, text: targetText, forceMoveMarkers: false }])
    }
  }, [modifiedPane?.text])

  useEffect(() => {
    return () => {
      runtimeRegistry.unregisterDiffEditor(`json-diff-${session.id}`)
    }
  }, [session.id])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (editor) {
      editor.updateOptions({ renderSideBySide })
    }
  }, [renderSideBySide])

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
          JSON Diff: {originalPane.title} ↔ {modifiedPane.title}
        </span>

        {!isJsonValid && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#fef3c7', color: '#92400e' }}>
            非法 JSON · 文本对比
          </span>
        )}

        {isJsonValid && changes.length > 0 && (
          <>
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
              background: 'var(--color-warning-bg, #fff3cd)',
              color: 'var(--color-warning-text, #856404)',
            }}>
              {changes.length} 处差异
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
            ✓ 语义一致
          </span>
        )}

        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{
            background: renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          onClick={() => onUpdate({ renderSideBySide: true })}
        >
          Side-by-side
        </button>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{
            background: !renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
            color: !renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
          }}
          onClick={() => onUpdate({ renderSideBySide: false })}
        >
          Inline
        </button>

        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={onClose}
        >
          Exit Diff
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
            Array:
          </span>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'by-index' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'by-index' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('by-index')}
          >
            By Index
          </button>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'unordered-scalar' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'unordered-scalar' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('unordered-scalar')}
          >
            Unordered Scalar
          </button>
          <button
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: arrayMode === 'by-object-key' ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)',
              color: arrayMode === 'by-object-key' ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            onClick={() => setArrayMode('by-object-key')}
          >
            By Key
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
              placeholder="key"
            />
          )}
        </div>
      )}

      {/* DiffEditor - always shows RAW pane text, editable */}
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          original={initialOriginal.current}
          modified={initialModified.current}
          originalLanguage="json"
          modifiedLanguage="json"
          onMount={handleMount}
          options={{
            renderSideBySide,
            originalEditable: true,
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
