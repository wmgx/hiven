import { useRef, useCallback, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { useAppStore } from '../../store'
import { QuickEditorToolbar } from './QuickEditorToolbar'
import { QuickEditorCommandOverlay } from './QuickEditorCommandOverlay'
import { getFluxMonacoTheme, registerFluxMonacoThemes } from '../../utils/monacoTheme'

export function QuickEditorPanel() {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const isLocalChangeRef = useRef(false)

  const text = useQuickEditorStore((s) => s.text)
  const language = useQuickEditorStore((s) => s.language)
  const cursorPosition = useQuickEditorStore((s) => s.cursorPosition)
  const scrollPosition = useQuickEditorStore((s) => s.scrollPosition)
  const setText = useQuickEditorStore((s) => s.setText)
  const setCursorPosition = useQuickEditorStore((s) => s.setCursorPosition)
  const setScrollPosition = useQuickEditorStore((s) => s.setScrollPosition)

  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      isLocalChangeRef.current = true
      setText(value)
    }
  }, [setText])

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

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
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
            editorRef.current = editor

            // Restore cursor & scroll
            editor.setPosition(cursorPosition)
            editor.setScrollPosition(scrollPosition)
            editor.focus()

            // Track cursor
            editor.onDidChangeCursorPosition((e) => {
              setCursorPosition({
                lineNumber: e.position.lineNumber,
                column: e.position.column,
              })
            })

            // Track scroll
            editor.onDidScrollChange((e) => {
              setScrollPosition({
                scrollTop: e.scrollTop,
                scrollLeft: e.scrollLeft,
              })
            })

            // ⌘K → open command overlay
            editor.addCommand(
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
              () => {
                useAppStore.getState().openQuickEditorCommand()
              }
            )
          }}
          options={{
            fontSize,
            minimap: { enabled: false },
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'line',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            automaticLayout: true,
            tabSize: 2,
            folding: true,
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            fontFamily: 'var(--font-mono)',
          }}
          theme={getFluxMonacoTheme(theme)}
        />
      </div>
      <QuickEditorCommandOverlay />
    </div>
  )
}
