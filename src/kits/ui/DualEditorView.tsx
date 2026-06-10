/**
 * Generic two-editor Monaco view with synchronized scrolling and line
 * decorations. This is a pure UI kit component: callers own all product
 * semantics, pane binding, and highlight computation.
 */

import { useRef, useEffect, useCallback } from 'react'
import { Editor } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { createMonacoDisposableBucket, disposeAllMonacoDisposables, type MonacoDisposable } from '../../utils/monacoDisposables'

let cssInjected = false
function ensureCss() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .ft-left-change-line  { background: rgba(252, 165, 165, 0.22) !important; }
    .ft-right-change-line { background: rgba(134, 239, 172, 0.22) !important; }
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
  onLeftFocus,
  onRightFocus,
  onLeftChange,
  onRightChange,
  fontSize,
  lineNumbers,
  wordWrap,
  leftStickyScrollEnabled,
  rightStickyScrollEnabled,
}: {
  leftText: string
  rightText: string
  leftHighlights: number[]
  rightHighlights: number[]
  layout: 'side-by-side' | 'inline'
  language?: string
  onLeftFocus?: () => void
  onRightFocus?: () => void
  onLeftChange?: (text: string) => void
  onRightChange?: (text: string) => void
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  leftStickyScrollEnabled: boolean
  rightStickyScrollEnabled: boolean
}) {
  const leftRef  = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const rightRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const leftDisposablesRef = useRef<MonacoDisposable[]>([])
  const rightDisposablesRef = useRef<MonacoDisposable[]>([])
  const leftDecIds  = useRef<DecId>([])
  const rightDecIds = useRef<DecId>([])
  const isApplying  = useRef(false)
  const isSyncing   = useRef(false)
  const skipNextLeftSync = useRef(false)
  const skipNextRightSync = useRef(false)
  const foldingEnabled = language !== 'plaintext'

  const applyLanguage = useCallback((editor: MonacoEditor.IStandaloneCodeEditor | null) => {
    const model = editor?.getModel()
    if (!editor || !model) return
    if (model.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(model, language)
    }
    editor.updateOptions({ folding: foldingEnabled })
  }, [language, foldingEnabled])

  useEffect(() => {
    applyLanguage(leftRef.current)
    applyLanguage(rightRef.current)
  }, [applyLanguage])

  const applyDecs = useCallback((
    editor: MonacoEditor.IStandaloneCodeEditor | null,
    idsRef: React.MutableRefObject<DecId>,
    lines: number[],
    cls: string,
  ) => {
    if (!editor) return
    const rulerColor = cls === 'ft-left-change-line'
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
    skipNextSyncRef: React.MutableRefObject<boolean>,
  ) => {
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    if (model.getValue() === text) {
      skipNextSyncRef.current = false
      return
    }
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      return
    }
    isApplying.current = true
    try {
      editor.executeEdits('external', [{ range: model.getFullModelRange(), text, forceMoveMarkers: false }])
    } finally {
      isApplying.current = false
    }
  }, [])

  useEffect(() => { syncText(leftRef.current,  leftText,  skipNextLeftSync)  }, [leftText,  syncText])
  useEffect(() => { syncText(rightRef.current, rightText, skipNextRightSync) }, [rightText, syncText])

  useEffect(() => {
    applyDecs(leftRef.current,  leftDecIds,  leftHighlights,  'ft-left-change-line')
    applyDecs(rightRef.current, rightDecIds, rightHighlights, 'ft-right-change-line')
  }, [leftHighlights, rightHighlights, applyDecs])

  const editorOptions: MonacoEditor.IStandaloneEditorConstructionOptions = {
    readOnly: false,
    fontSize,
    lineNumbers: lineNumbers ? 'on' : 'off',
    wordWrap: wordWrap ? 'on' : 'off',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    folding: foldingEnabled,
    glyphMargin: false,
    lineDecorationsWidth: 12,
    lineNumbersMinChars: 4,
    padding: { top: 12 },
    fontFamily: 'var(--font-mono)',
    overviewRulerLanes: 3,
  }

  const handleLeftMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    ensureCss()
    disposeAllMonacoDisposables(leftDisposablesRef.current)
    leftDecIds.current = []
    const disposables = createMonacoDisposableBucket()
    leftDisposablesRef.current = [disposables]
    leftRef.current = editor
    disposables.add(editor.onDidFocusEditorText(() => {
      onLeftFocus?.()
    }))
    disposables.add(editor.onDidChangeModelContent(() => {
      if (isApplying.current) return
      skipNextLeftSync.current = true
      onLeftChange?.(editor.getModel()?.getValue() ?? '')
    }))
    disposables.add(editor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      const right = rightRef.current; if (!right) return
      isSyncing.current = true
      right.setScrollPosition({ scrollTop: e.scrollTop, scrollLeft: e.scrollLeft })
      isSyncing.current = false
    }))
    disposables.add(editor.onDidDispose(() => {
      if (leftRef.current === editor) leftRef.current = null
      leftDecIds.current = []
      disposables.dispose()
    }))
    applyLanguage(editor)
    applyDecs(editor, leftDecIds, leftHighlights, 'ft-left-change-line')
  }, [onLeftFocus, onLeftChange, applyDecs, applyLanguage, leftHighlights])

  const handleRightMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    ensureCss()
    disposeAllMonacoDisposables(rightDisposablesRef.current)
    rightDecIds.current = []
    const disposables = createMonacoDisposableBucket()
    rightDisposablesRef.current = [disposables]
    rightRef.current = editor
    disposables.add(editor.onDidFocusEditorText(() => {
      onRightFocus?.()
    }))
    disposables.add(editor.onDidChangeModelContent(() => {
      if (isApplying.current) return
      skipNextRightSync.current = true
      onRightChange?.(editor.getModel()?.getValue() ?? '')
    }))
    disposables.add(editor.onDidScrollChange((e) => {
      if (isSyncing.current) return
      const left = leftRef.current; if (!left) return
      isSyncing.current = true
      left.setScrollPosition({ scrollTop: e.scrollTop, scrollLeft: e.scrollLeft })
      isSyncing.current = false
    }))
    disposables.add(editor.onDidDispose(() => {
      if (rightRef.current === editor) rightRef.current = null
      rightDecIds.current = []
      disposables.dispose()
    }))
    applyLanguage(editor)
    applyDecs(editor, rightDecIds, rightHighlights, 'ft-right-change-line')
  }, [onRightFocus, onRightChange, applyDecs, applyLanguage, rightHighlights])

  useEffect(() => () => {
    try {
      leftRef.current?.deltaDecorations(leftDecIds.current, [])
    } catch {}
    try {
      rightRef.current?.deltaDecorations(rightDecIds.current, [])
    } catch {}
    disposeAllMonacoDisposables(leftDisposablesRef.current)
    disposeAllMonacoDisposables(rightDisposablesRef.current)
    leftRef.current = null
    rightRef.current = null
    leftDecIds.current = []
    rightDecIds.current = []
  }, [])

  const border = '1px solid var(--color-border-tertiary)'

  if (layout === 'side-by-side') {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: border }}>
          <Editor height="100%" defaultValue={leftText} defaultLanguage={language}
            onMount={handleLeftMount} options={{ ...editorOptions, stickyScroll: { enabled: leftStickyScrollEnabled } }} theme="vs" />
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Editor height="100%" defaultValue={rightText} defaultLanguage={language}
            onMount={handleRightMount} options={{ ...editorOptions, stickyScroll: { enabled: rightStickyScrollEnabled } }} theme="vs" />
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', borderBottom: border }}>
        <Editor height="100%" defaultValue={leftText} defaultLanguage={language}
          onMount={handleLeftMount} options={{ ...editorOptions, stickyScroll: { enabled: leftStickyScrollEnabled } }} theme="vs" />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <Editor height="100%" defaultValue={rightText} defaultLanguage={language}
          onMount={handleRightMount} options={{ ...editorOptions, stickyScroll: { enabled: rightStickyScrollEnabled } }} theme="vs" />
      </div>
    </div>
  )
}
