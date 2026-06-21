import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import { RendererHost } from './RendererHost'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useT } from '../../i18n'
import { detectEditorLanguage } from '../../workspace/languageDetector'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { PaneBottomPanels } from './PaneBottomPanels'
import { installMonacoHoverOverlay } from '../../utils/monacoHoverOverlay'
import { createMonacoDisposableBucket } from '../../utils/monacoDisposables'
import { getFluxMonacoTheme, registerFluxMonacoThemes } from '../../utils/monacoTheme'
import { X } from 'lucide-react'

interface PaneEditorProps {
  paneId: string
}

export function PaneEditor({ paneId }: PaneEditorProps) {
  const pane = useWorkspaceStore((s) => s.panes[paneId])
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setPaneSelection = useWorkspaceStore((s) => s.setPaneSelection)
  const closePane = useWorkspaceStore((s) => s.closePane)
  const layout = useWorkspaceStore((s) => s.layout)
  const setEditorInstance = useAppStore((s) => s.setEditorInstance)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const t = useT('editor')
  const rendererState = useWorkspaceStore((s) => s.paneRenderers[paneId])
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoDisposablesRef = useRef<ReturnType<typeof createMonacoDisposableBucket> | null>(null)
  const statusBarRef = useRef<HTMLDivElement | null>(null)
  const isLocalChange = useRef(false)
  const pasteDetectionRef = useRef<{ paneId: string; shouldDetect: boolean } | null>(null)
  const paneText = pane?.text ?? ''
  const language = pane?.language || 'plaintext'
  const languageSource = pane?.languageSource ?? (pane?.language && pane.language !== 'plaintext' ? 'manual' : 'auto')
  const foldingEnabled = language !== 'plaintext'
  // Monaco adds 16px for folding controls, so plaintext panes reserve it manually.
  const lineDecorationsWidth = foldingEnabled ? 8 : 24

  // Per-pane cursor position state
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 })
  const [selectedCharCount, setSelectedCharCount] = useState(0)
  const [statusWidth, setStatusWidth] = useState(0)

  // Sync external text changes (e.g. from effect runner) without resetting cursor
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !pane) return
    const model = editor.getModel()
    if (isLocalChange.current) {
      isLocalChange.current = false
      if (model?.getValue() === paneText) return
    }
    if (model && model.getValue() !== paneText) {
      // Push edit without moving cursor
      const fullRange = model.getFullModelRange()
      editor.executeEdits('external', [{
        range: fullRange,
        text: paneText,
        forceMoveMarkers: false,
      }])
    }
  }, [pane, paneText])

  const handleChange = useCallback((v: string | undefined) => {
    const nextText = v || ''
    isLocalChange.current = true
    setPaneText(paneId, nextText)
  }, [paneId, setPaneText])

  useEffect(() => {
    return () => {
      monacoDisposablesRef.current?.dispose()
      monacoDisposablesRef.current = null
      editorRef.current = null
      pasteDetectionRef.current = null
      runtimeRegistry.unregisterCodeEditor(paneId)
      if (useWorkspaceStore.getState().activePaneId === paneId) {
        useAppStore.getState().setEditorInstance(null)
      }
    }
  }, [paneId])

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || !pane) return
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }
    editor.updateOptions({
      folding: foldingEnabled,
      lineDecorationsWidth,
      stickyScroll: { enabled: pane.stickyScroll === true },
    })
  }, [language, foldingEnabled, lineDecorationsWidth, pane])

  useEffect(() => {
    const node = statusBarRef.current
    if (!node) return
    const updateWidth = () => setStatusWidth(node.clientWidth)
    updateWidth()
    const resizeObserver = new ResizeObserver((entries) => {
      setStatusWidth(entries[0]?.contentRect.width ?? node.clientWidth)
    })
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  if (!pane) return null

  // If a plugin renderer is active, show RendererHost instead of Monaco
  if (rendererState) {
    return (
      <div className="h-full" onPointerDown={() => setActivePaneId(paneId)}>
        <RendererHost paneId={paneId} rendererState={rendererState} />
      </div>
    )
  }

  const lines = paneText.split('\n').length
  const chars = paneText.length
  const showLineCount = statusWidth >= 240
  const showCharCount = statusWidth >= 320
  const showLanguage = statusWidth >= 160
  const languageLabel = getLanguageOptionLabel(language, locale)
  const languageStatus = languageSource === 'manual'
    ? languageLabel
    : `${languageLabel} · ${t('autoLanguage')}`
  const visiblePaneIds = layout.panes
  const paneNumber = visiblePaneIds.indexOf(paneId) + 1
  const showPaneNumber = visiblePaneIds.length > 1 && paneNumber > 0

  return (
    <div className="flex flex-col h-full" onPointerDown={() => setActivePaneId(paneId)}>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage={language}
          defaultValue={paneText}
          beforeMount={registerFluxMonacoThemes}
          onChange={handleChange}
          onMount={(editor) => {
            registerFluxMonacoThemes(monaco)
            monacoDisposablesRef.current?.dispose()
            const disposables = createMonacoDisposableBucket()
            monacoDisposablesRef.current = disposables
            installMonacoHoverOverlay(editor)
            editorRef.current = editor
            runtimeRegistry.registerCodeEditor(paneId, editor)
            if (activePaneId === paneId) {
              setEditorInstance(editor)
            }
            // Track focus
            disposables.add(editor.onDidFocusEditorText(() => {
              setActivePaneId(paneId)
              setEditorInstance(editor)
            }))
            // Track cursor position
            disposables.add(editor.onDidChangeCursorPosition((e: MonacoEditor.ICursorPositionChangedEvent) => {
              setCursorInfo({ line: e.position.lineNumber, col: e.position.column })
            }))
            disposables.add(editor.onDidChangeCursorSelection(() => {
              const model = editor.getModel()
              const selections = editor.getSelections() ?? []
              const selectedLength = model
                ? selections.reduce((total, selection) => (
                  selection.isEmpty() ? total : total + model.getValueLengthInRange(selection)
                ), 0)
                : 0
              setSelectedCharCount(selectedLength)

              const selection = editor.getSelection()
              setPaneSelection(paneId, selection && !selection.isEmpty()
                ? {
                    startLineNumber: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLineNumber: selection.endLineNumber,
                    endColumn: selection.endColumn,
                  }
                : null)
            }))
            const rememberPasteDetection = () => {
              if (!editor.hasTextFocus()) return
              const model = editor.getModel()
              if (!model) {
                pasteDetectionRef.current = null
                return
              }
              const text = model.getValue()
              const fullRange = model.getFullModelRange()
              const selections = editor.getSelections() ?? []
              const hasFullSelection = selections.some((selection) => (
                selection.startLineNumber === fullRange.startLineNumber &&
                selection.startColumn === fullRange.startColumn &&
                selection.endLineNumber === fullRange.endLineNumber &&
                selection.endColumn === fullRange.endColumn
              ))
              pasteDetectionRef.current = {
                paneId,
                shouldDetect: text.trim().length === 0 || hasFullSelection,
              }
            }
            const handlePasteCapture = () => rememberPasteDetection()
            const handlePasteKeydownCapture = (event: KeyboardEvent) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
                rememberPasteDetection()
              }
            }
            window.addEventListener('paste', handlePasteCapture, true)
            window.addEventListener('keydown', handlePasteKeydownCapture, true)
            disposables.add({
              dispose() {
                window.removeEventListener('paste', handlePasteCapture, true)
                window.removeEventListener('keydown', handlePasteKeydownCapture, true)
              },
            })
            disposables.add(editor.onDidPaste(() => {
              const pasteDetection = pasteDetectionRef.current
              pasteDetectionRef.current = null
              if (!pasteDetection?.shouldDetect) return
              window.setTimeout(() => {
                const model = editor.getModel()
                const text = model?.getValue() ?? ''
                const state = useWorkspaceStore.getState()
                const currentPane = state.panes[pasteDetection.paneId]
                const currentLanguageSource = currentPane?.languageSource
                  ?? (currentPane?.language && currentPane.language !== 'plaintext' ? 'manual' : 'auto')
                if (!currentPane || currentLanguageSource === 'manual' || text.trim().length === 0) return
                state.updatePaneDetectedLanguage(
                  pasteDetection.paneId,
                  detectEditorLanguage(text, { allowShortStrongSignals: true })
                )
              }, 0)
            }))
            // Override Cmd+F
            disposables.add(editor.addAction({
              id: 'find-and-replace',
              label: 'Find and Replace',
              keybindings: [
                2048 | 36, // CtrlCmd + KeyF
                2048 | 512 | 36, // CtrlCmd + Alt + KeyF
                2048 | 35, // CtrlCmd + KeyH
              ],
              run: (ed: MonacoEditor.IStandaloneCodeEditor) => {
                ed.getAction('editor.action.startFindReplaceAction')?.run()
              },
            }))
            // Cmd+W → close pane
            disposables.add(editor.addAction({
              id: 'close-pane',
              label: 'Close Pane',
              keybindings: [2048 | 53], // CtrlCmd + KeyW
              run: () => {
                useWorkspaceStore.getState().closeActiveSurfaceOrPane()
              },
            }))
            disposables.add(editor.onDidDispose(() => {
              if (editorRef.current === editor) editorRef.current = null
              if (monacoDisposablesRef.current === disposables) monacoDisposablesRef.current = null
              disposables.dispose()
            }))
          }}
          options={{
            fontSize: settings.fontSize,
            lineNumbers: settings.lineNumbers ? 'on' : 'off',
            wordWrap: settings.wordWrap ? 'on' : 'off',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            folding: foldingEnabled,
            stickyScroll: { enabled: pane.stickyScroll === true },
            glyphMargin: false,
            lineDecorationsWidth,
            lineNumbersMinChars: 3,
            padding: { top: 12, left: 8 },
            fontFamily: 'var(--font-mono)',
          }}
          theme={getFluxMonacoTheme(settings.theme)}
        />
      </div>

      {/* Plugin pane-bottom panels */}
      <PaneBottomPanels paneId={paneId} />

      {/* Per-pane status bar */}
      <div
        ref={statusBarRef}
        className="h-[22px] flex items-center px-2 gap-2 shrink-0 overflow-hidden whitespace-nowrap text-[10px]"
        style={{
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {showPaneNumber && (
          <span
            className="pane-status-index shrink-0"
            title={pane.title}
            data-active={activePaneId === paneId ? 'true' : 'false'}
          >
            {paneNumber}
          </span>
        )}
        <span className="shrink-0">
          {t('line')} {cursorInfo.line}, {t('column')} {cursorInfo.col}
        </span>
        {showLineCount && (
          <span className="shrink-0">
            {lines} {t('lines')}
          </span>
        )}
        {showCharCount && (
          <span className="shrink-0">
            {chars} {t('chars')}
          </span>
        )}
        {selectedCharCount > 0 && (
          <span className="shrink-0">
            {selectedCharCount} {t('selectedChars')}
          </span>
        )}
        {showLanguage && (
          <span className="ml-auto min-w-0 truncate text-right" title={languageStatus}>
            {languageStatus}
          </span>
        )}
        <button
          type="button"
          className="pane-status-close"
          title={t('closePane')}
          onClick={(event) => {
            event.stopPropagation()
            closePane(paneId)
          }}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  )
}
