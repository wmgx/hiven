/**
 * FluxText - Monaco Diff Renderer
 * Built-in presentation renderer that uses Monaco DiffEditor.
 * Renders side-by-side or inline diff between two panes.
 */

import { useEffect, useRef, useCallback } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { useAppStore } from '../store'
import { applyEffects } from '../workspace/effectRunner'
import type { PresentationRendererProps } from '../workspace/presentationRegistry'

export function MonacoDiffRenderer({ session, onClose, onUpdate }: PresentationRendererProps) {
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

  // Store initial text for uncontrolled mount
  const initialOriginal = useRef(originalPane?.text || '')
  const initialModified = useRef(modifiedPane?.text || '')

  const handleMount = useCallback((editor: any) => {
    diffEditorRef.current = editor
    runtimeRegistry.registerDiffEditor(session.id, editor)

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

    // Sync edits back to panes (mark as internal to skip external sync)
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

  // Sync external changes (e.g. from command palette actions) into diff editor without cursor reset
  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !originalPane) return
    if (isInternalEdit.current.orig) {
      isInternalEdit.current.orig = false
      return
    }
    const origEditor = editor.getOriginalEditor()
    const model = origEditor.getModel()
    if (model && model.getValue() !== originalPane.text) {
      const fullRange = model.getFullModelRange()
      origEditor.executeEdits('external', [{ range: fullRange, text: originalPane.text, forceMoveMarkers: false }])
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
    if (model && model.getValue() !== modifiedPane.text) {
      const fullRange = model.getFullModelRange()
      modEditor.executeEdits('external', [{ range: fullRange, text: modifiedPane.text, forceMoveMarkers: false }])
    }
  }, [modifiedPane?.text])

  useEffect(() => {
    return () => {
      runtimeRegistry.unregisterDiffEditor(session.id)
    }
  }, [session.id])

  // Update renderSideBySide option without remounting
  useEffect(() => {
    const editor = diffEditorRef.current
    if (editor) {
      editor.updateOptions({ renderSideBySide })
    }
  }, [renderSideBySide])

  if (!originalPane || !modifiedPane) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Diff toolbar */}
      <div
        className="h-[28px] flex items-center px-3 gap-3 shrink-0"
        style={{
          borderBottom: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Diff: {originalPane.title} ↔ {modifiedPane.title}
        </span>
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
        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>
          Text Line Diff
        </span>
        <button
          className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={() => {
            onClose()
            setTimeout(() => {
              applyEffects([{
                type: 'presentation.open',
                renderer: 'monaco-diff',
                mode: 'split-view',
                targetPaneIds: [modifiedPaneId, originalPaneId],
                options: { renderSideBySide },
              }])
            }, 50)
          }}
        >
          Swap
        </button>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={onClose}
        >
          Exit Diff
        </button>
      </div>

      {/* Diff editor - uncontrolled: use initial values only */}
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          original={initialOriginal.current}
          modified={initialModified.current}
          originalLanguage={originalPane.language || 'plaintext'}
          modifiedLanguage={modifiedPane.language || 'plaintext'}
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
            folding: false,
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
