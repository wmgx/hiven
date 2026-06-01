/**
 * FluxText Core - Core Diff Renderer
 * Monaco DiffEditor renderer adapted for the new RendererProps API.
 * Registered as 'core.diff' in the production plugin registry.
 */
import { useEffect, useRef, useCallback, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { useAppStore } from '../store'
import type { PaneInput, RendererProps } from '../workspace/pluginTypes'
import { t } from '../i18n'

type DiffRendererInputs = {
  original: PaneInput
  modified: PaneInput
  renderMode?: 'side-by-side' | 'inline'
}

export function CoreDiffRenderer({ inputs, surfaceId, host }: RendererProps<DiffRendererInputs>) {
  const originalPane = inputs?.original
  const modifiedPane = inputs?.modified
  const originalPaneId = originalPane?.paneId
  const modifiedPaneId = modifiedPane?.paneId
  const originalText = originalPane?.text ?? ''
  const modifiedText = modifiedPane?.text ?? ''
  const [renderSideBySide, setRenderSideBySide] = useState(inputs?.renderMode !== 'inline')
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null)
  
  // Store initial text for uncontrolled mount
  const [initialOriginal] = useState(() => originalText)
  const [initialModified] = useState(() => modifiedText)

  const handleMount = useCallback((editor: MonacoEditor.IStandaloneDiffEditor) => {
    diffEditorRef.current = editor
    runtimeRegistry.registerDiffEditor(surfaceId, editor)

    const origEditor = editor.getOriginalEditor()
    const modEditor = editor.getModifiedEditor()

    origEditor.onDidFocusEditorText(() => {
      if (originalPaneId) host.focusPane(originalPaneId)
    })

    modEditor.onDidFocusEditorText(() => {
      if (modifiedPaneId) host.focusPane(modifiedPaneId)
    })
  }, [surfaceId, originalPaneId, modifiedPaneId, host])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !originalPaneId) return
    const origEditor = editor.getOriginalEditor()
    const model = origEditor.getModel()
    if (model && model.getValue() !== originalText) {
      const fullRange = model.getFullModelRange()
      origEditor.executeEdits('external', [{ range: fullRange, text: originalText, forceMoveMarkers: false }])
    }
  }, [originalPaneId, originalText])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (!editor || !modifiedPaneId) return
    const modEditor = editor.getModifiedEditor()
    const model = modEditor.getModel()
    if (model && model.getValue() !== modifiedText) {
      const fullRange = model.getFullModelRange()
      modEditor.executeEdits('external', [{ range: fullRange, text: modifiedText, forceMoveMarkers: false }])
    }
  }, [modifiedPaneId, modifiedText])

  useEffect(() => {
    return () => { runtimeRegistry.unregisterDiffEditor(surfaceId) }
  }, [surfaceId])

  useEffect(() => {
    const editor = diffEditorRef.current
    if (editor) editor.updateOptions({ renderSideBySide, renderSideBySideInlineBreakpoint: 0 })
  }, [renderSideBySide])

  useEffect(() => {
    queueMicrotask(() => setRenderSideBySide(inputs?.renderMode !== 'inline'))
  }, [inputs?.renderMode])

  if (!originalPane || !modifiedPane) return null

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="h-[28px] flex items-center px-3 gap-3 shrink-0" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)' }}>
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t(locale, 'diff.title')}: {originalPane.title} ↔ {modifiedPane.title}
        </span>
        <button className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80" style={{ background: renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} onClick={() => setRenderSideBySide(true)}>{t(locale, 'diff.sideBySide')}</button>
        <button className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80" style={{ background: !renderSideBySide ? 'var(--color-accent-bg)' : 'var(--color-background-tertiary)', color: !renderSideBySide ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }} onClick={() => setRenderSideBySide(false)}>{t(locale, 'diff.inline')}</button>
        <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>{t(locale, 'diff.textLineDiff')}</span>
        <button className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }} onClick={host.close}>{t(locale, 'diff.exit')}</button>
      </div>
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          original={initialOriginal}
          modified={initialModified}
          originalLanguage={originalPane.language || 'plaintext'}
          modifiedLanguage={modifiedPane.language || 'plaintext'}
          onMount={handleMount}
          options={{
            renderSideBySide,
            renderSideBySideInlineBreakpoint: 0,
            originalEditable: false,
            readOnly: true,
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
