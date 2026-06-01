import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore } from '../../store'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import Editor from '@monaco-editor/react'

interface PaneEditorProps {
  paneId: string
}

export function PaneEditor({ paneId }: PaneEditorProps) {
  const pane = useWorkspaceStore((s) => s.panes[paneId])
  const setPaneText = useWorkspaceStore((s) => s.setPaneText)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const setEditorInstance = useAppStore((s) => s.setEditorInstance)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const settings = useAppStore((s) => s.settings)
  const editorRef = useRef<any>(null)
  const isLocalChange = useRef(false)

  // Per-pane cursor position state
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 })

  // Sync external text changes (e.g. from effect runner) without resetting cursor
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !pane) return
    if (isLocalChange.current) {
      isLocalChange.current = false
      return
    }
    const model = editor.getModel()
    if (model && model.getValue() !== pane.text) {
      // Push edit without moving cursor
      const fullRange = model.getFullModelRange()
      editor.executeEdits('external', [{
        range: fullRange,
        text: pane.text,
        forceMoveMarkers: false,
      }])
    }
  }, [pane?.text])

  const handleChange = useCallback((v: string | undefined) => {
    isLocalChange.current = true
    setPaneText(paneId, v || '')
  }, [paneId, setPaneText])

  useEffect(() => {
    return () => {
      runtimeRegistry.unregisterCodeEditor(paneId)
      if (activePaneId === paneId) {
        setEditorInstance(null)
      }
    }
  }, [paneId, activePaneId, setEditorInstance])

  if (!pane) return null

  const lines = pane.text.split('\n').length
  const chars = pane.text.length

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage={pane.language || 'plaintext'}
          defaultValue={pane.text}
          onChange={handleChange}
          onMount={(editor) => {
            editorRef.current = editor
            runtimeRegistry.registerCodeEditor(paneId, editor)
            if (activePaneId === paneId) {
              setEditorInstance(editor)
            }
            // Track focus
            editor.onDidFocusEditorText(() => {
              setActivePaneId(paneId)
              setEditorInstance(editor)
            })
            // Track cursor position
            editor.onDidChangeCursorPosition((e: any) => {
              setCursorInfo({ line: e.position.lineNumber, col: e.position.column })
            })
            // Override Cmd+F
            editor.addAction({
              id: 'find-and-replace',
              label: 'Find and Replace',
              keybindings: [
                2048 | 36, // CtrlCmd + KeyF
                2048 | 512 | 36, // CtrlCmd + Alt + KeyF
                2048 | 35, // CtrlCmd + KeyH
              ],
              run: (ed: any) => {
                ed.getAction('editor.action.startFindReplaceAction')?.run()
              },
            })
            // Cmd+K → open command palette (ensures it works after HMR)
            editor.addAction({
              id: 'open-command-palette',
              label: 'Open Command Palette',
              keybindings: [2048 | 41], // CtrlCmd + KeyK
              run: () => {
                useAppStore.getState().setCommandPaletteOpen(true)
              },
            })
            // Cmd+W → close pane
            editor.addAction({
              id: 'close-pane',
              label: 'Close Pane',
              keybindings: [2048 | 53], // CtrlCmd + KeyW
              run: () => {
                const ws = useWorkspaceStore.getState()
                if (ws.paneOrder.length > 1) {
                  ws.closePane(ws.activePaneId)
                }
              },
            })
          }}
          options={{
            fontSize: settings.fontSize,
            lineNumbers: settings.lineNumbers ? 'on' : 'off',
            wordWrap: settings.wordWrap ? 'on' : 'off',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 12,
            lineNumbersMinChars: 4,
            padding: { top: 12 },
            fontFamily: 'var(--font-mono)',
          }}
          theme="vs"
        />
      </div>

      {/* Per-pane status bar */}
      <div
        className="h-[22px] flex items-center px-3 gap-3 shrink-0"
        style={{
          borderTop: '0.5px solid var(--color-border-tertiary)',
          background: 'var(--color-background-secondary)',
        }}
      >
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Ln {cursorInfo.line}, Col {cursorInfo.col}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {lines} lines
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {chars} chars
        </span>
      </div>
    </div>
  )
}
