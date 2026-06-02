/**
 * DualEditorView - Generic two-pane Monaco editor with synchronized scrolling
 * and diff highlights via deltaDecorations.
 * Used by both JSON semantic diff and plain text diff.
 */

import { useRef, useEffect, useCallback } from 'react'
import { Editor } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import type { RendererHost } from '../workspace/pluginTypes'

let cssInjected = false
function ensureCss() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .jd-removed-line { background: rgba(252, 165, 165, 0.22) !important; }
    .jd-added-line   { background: rgba(134, 239, 172, 0.22) !important; }
  `
  document.head.appendChild(style)
}

type DecId = string[]

export function DualEditorView({
  leftText,
  rightText,
  leftHighlights,
  rightHighlights,
  layout,
  language = 'plaintext',
  originalPaneId,
  modifiedPaneId,
  host,
  fontSize,
  lineNumbers,
  wordWrap,
}: {
  leftText: string
  rightText: string
  leftHighlights: number[]
  rightHighlights: number[]
  layout: 'side-by-side' | 'inline'
  language?: string
  originalPaneId: string | undefined
  modifiedPaneId: string | undefined
  host: RendererHost
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
}) {
  const leftRef  = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const rightRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const leftDecIds  = useRef<DecId>([])
  const rightDecIds = useRef<DecId>([])
  const isApplying  = useRef(false)
  const isSyncing   = useRef(false)

  const applyDecs = useCallback((
    editor: MonacoEditor.IStandaloneCodeEditor | null,
    idsRef: React.MutableRefObject<DecId>,
    lines: number[],
    cls: string,
  ) => {
    if (!editor) return
    const rulerColor = cls === 'jd-removed-line'
      ? 'rgba(252, 165, 165, 0.22)'
      : 'rgba(134, 239, 172, 0.22)'
    idsRef.current = editor.deltaDecorations(
      idsRef.current,
      lines.map(line => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: cls,
          overviewRuler: { color: rulerColor, position: 7 },
        },
      })),
    )
  }, [])

  const syncText = useCallback((
    editor: MonacoEditor.IStandaloneCodeEditor | null,
    text: string,
  ) => {
    if (!editor) return
    const model = editor.getModel()
    if (!model || model.getValue() === text) return
    isApplying.current = true
    try {
      editor.executeEdits('external', [{ range: model.getFullModelRange(), text, forceMoveMarkers: false }])
    } finally {
      isApplying.current = false
    }
  }, [])

  useEffect(() => { syncText(leftRef.current,  leftText)  }, [leftText,  syncText])
  useEffect(() => { syncText(rightRef.current, rightText) }, [rightText, syncText])

  useEffect(() => {
    applyDecs(leftRef.current,  leftDecIds,  leftHighlights,  'jd-removed-line')
    applyDecs(rightRef.current, rightDecIds, rightHighlights, 'jd-added-line')
  }, [leftHighlights, rightHighlights, applyDecs])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    readOnly: false,
    fontSize,
    lineNumbers: lineNumbers ? 'on' : 'off',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    folding: true,
    glyphMargin: false,
    lineDecorationsWidth: 12,
    lineNumbersMinChars: 4,
    padding: { top: 12 },
    fontFamily: 'var(--font-mono)',
    overviewRulerLanes: 3,
  }

  const handleLeftMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    ensureCss()
    leftRef.current = editor
    editor.onDidFocusEditorText(() => {
      if (originalPaneId) host.focusPane(originalPaneId)
    })
    editor.onDidChangeModelContent(() => {
      if (isApplying.current || !originalPaneId) return
      host.updatePaneText(originalPaneId, editor.getModel()?.getValue() ?? '')
    })
    editor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      const right = rightRef.current; if (!right) return
      isSyncing.current = true
      right.setScrollPosition({ scrollTop: e.scrollTop, scrollLeft: e.scrollLeft })
      isSyncing.current = false
    })
    applyDecs(editor, leftDecIds, leftHighlights, 'jd-removed-line')
  }, [originalPaneId, host, applyDecs, leftHighlights])

  const handleRightMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    ensureCss()
    rightRef.current = editor
    editor.onDidFocusEditorText(() => {
      if (modifiedPaneId) host.focusPane(modifiedPaneId)
    })
    editor.onDidChangeModelContent(() => {
      if (isApplying.current || !modifiedPaneId) return
      host.updatePaneText(modifiedPaneId, editor.getModel()?.getValue() ?? '')
    })
    editor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      const left = leftRef.current; if (!left) return
      isSyncing.current = true
      left.setScrollPosition({ scrollTop: e.scrollTop, scrollLeft: e.scrollLeft })
      isSyncing.current = false
    })
    applyDecs(editor, rightDecIds, rightHighlights, 'jd-added-line')
  }, [modifiedPaneId, host, applyDecs, rightHighlights])

  const border = '1px solid var(--color-border-tertiary)'

  if (layout === 'side-by-side') {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: border }}>
          <Editor height="100%" defaultValue={leftText} defaultLanguage={language}
            onMount={handleLeftMount} options={editorOptions} theme="vs" />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Editor height="100%" defaultValue={rightText} defaultLanguage={language}
            onMount={handleRightMount} options={editorOptions} theme="vs" />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', borderBottom: border }}>
        <Editor height="100%" defaultValue={leftText} defaultLanguage={language}
          onMount={handleLeftMount} options={editorOptions} theme="vs" />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Editor height="100%" defaultValue={rightText} defaultLanguage={language}
          onMount={handleRightMount} options={editorOptions} theme="vs" />
      </div>
    </div>
  )
}
