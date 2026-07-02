import { useRef, useCallback, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../store'
import { QuickEditorToolbar } from './QuickEditorToolbar'
import { QuickEditorCommandOverlay } from './QuickEditorCommandOverlay'
import { getFluxMonacoTheme, registerFluxMonacoThemes } from '../../utils/monacoTheme'
import { installMonacoHoverOverlay } from '../../utils/monacoHoverOverlay'
import { createMonacoDisposableBucket } from '../../utils/monacoDisposables'
import { suppressStandaloneLauncherBlur } from '../../workspace/launcherBlurGuard'

export function QuickEditorPanel() {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoDisposablesRef = useRef<ReturnType<typeof createMonacoDisposableBucket> | null>(null)
  const isLocalChangeRef = useRef(false)

  const text = useQuickEditorStore((s) => s.text)
  const language = useQuickEditorStore((s) => s.language)
  const cursorPosition = useQuickEditorStore((s) => s.cursorPosition)
  const scrollPosition = useQuickEditorStore((s) => s.scrollPosition)
  const setText = useQuickEditorStore((s) => s.setText)
  const setCursorPosition = useQuickEditorStore((s) => s.setCursorPosition)
  const setScrollPosition = useQuickEditorStore((s) => s.setScrollPosition)

  const settings = useAppStore((s) => s.settings)
  const openQuickEditorCommand = useAppStore((s) => s.openQuickEditorCommand)

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      isLocalChangeRef.current = true
      setText(value)
    }
  }, [setText])

  const handleKeyDownCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
    event.preventDefault()
    event.stopPropagation()
    suppressStandaloneLauncherBlur()
    openQuickEditorCommand()
  }, [openQuickEditorCommand])

  // Sync external text changes (e.g. from command execution) without resetting cursor
  useEffect(() => {
    if (isLocalChangeRef.current) {
      isLocalChangeRef.current = false
      return
    }
    const editor = editorRef.current
    const model = editor?.getModel()
    if (editor && model && model.getValue() !== text) {
      const fullRange = model.getFullModelRange()
      editor.executeEdits('external', [{
        range: fullRange,
        text,
        forceMoveMarkers: false,
      }])
    }
  }, [text])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      monacoDisposablesRef.current?.dispose()
      monacoDisposablesRef.current = null
      editorRef.current = null
    }
  }, [])

  return (
    <div className="relative flex flex-col h-full overflow-hidden" onKeyDownCapture={handleKeyDownCapture}>
      <QuickEditorToolbar />
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultValue={text}
          defaultLanguage={language}
          beforeMount={registerFluxMonacoThemes}
          onChange={handleChange}
          onMount={(editor) => {
            registerFluxMonacoThemes(monaco)
            monacoDisposablesRef.current?.dispose()
            const disposables = createMonacoDisposableBucket()
            monacoDisposablesRef.current = disposables
            installMonacoHoverOverlay(editor)
            editorRef.current = editor

            // Restore cursor & scroll
            editor.setPosition(cursorPosition)
            editor.setScrollPosition(scrollPosition)
            editor.focus()

            // Track cursor
            disposables.add(editor.onDidChangeCursorPosition((e) => {
              setCursorPosition({
                lineNumber: e.position.lineNumber,
                column: e.position.column,
              })
            }))

            // Track scroll
            disposables.add(editor.onDidScrollChange((e) => {
              setScrollPosition({
                scrollTop: e.scrollTop,
                scrollLeft: e.scrollLeft,
              })
            }))

            // ⌘K → open command overlay
            disposables.add(editor.addAction({
              id: 'quick-editor-command',
              label: 'Quick Editor Command',
              keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
              ],
              run: () => {
                suppressStandaloneLauncherBlur()
                useAppStore.getState().openQuickEditorCommand()
              },
            }))

            // ⌘F / ⌘H → find and replace
            disposables.add(editor.addAction({
              id: 'find-and-replace',
              label: 'Find and Replace',
              keybindings: [
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
                monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
              ],
              run: (ed: MonacoEditor.IStandaloneCodeEditor) => {
                ed.getAction('editor.action.startFindReplaceAction')?.run()
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
            find: { addExtraSpaceOnTop: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            folding: true,
            stickyScroll: { enabled: false },
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            padding: { top: 12, bottom: 12 },
            fontFamily: 'var(--font-mono)',
            automaticLayout: true,
            tabSize: 2,
          }}
          theme={getFluxMonacoTheme(settings.theme)}
        />
      </div>
      <QuickEditorCommandOverlay />
    </div>
  )
}
