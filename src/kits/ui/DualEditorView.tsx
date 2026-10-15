/**
 * Generic two-editor Monaco view with synchronized scrolling and line
 * decorations. This is a pure UI kit component: callers own all product
 * semantics, pane binding, and highlight computation.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { TextEditorCore } from '../editor/TextEditorCore'
import type { EditorSelectionRange, LineDecorationSpec, RangeDecorationSpec, TextEditorCoreHandle } from '../editor/types'

let cssInjected = false
function ensureCss() {
  if (cssInjected) return
  cssInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .ft-left-change-line  { background: rgba(252, 165, 165, 0.22) !important; }
    .ft-right-change-line { background: rgba(134, 239, 172, 0.22) !important; }
    .ft-left-change-block  {
      background: rgba(252, 165, 165, 0.28) !important;
      border-radius: 3px;
    }
    .ft-right-change-block {
      background: rgba(134, 239, 172, 0.28) !important;
      border-radius: 3px;
    }
  `
  document.head.appendChild(style)
}

const dualOptionOverrides: MonacoEditor.IStandaloneEditorConstructionOptions = {
  renderLineHighlight: 'none',
  overviewRulerLanes: 3,
}

export type DualEditorLineRevealRequest = {
  requestId: number
  leftLine: number
  rightLine: number
}

export function DualEditorView({
  leftText,
  rightText,
  leftHighlights,
  rightHighlights,
  leftRanges,
  rightRanges,
  lineRevealRequest,
  layout,
  language = 'plaintext',
  onLeftFocus,
  onRightFocus,
  onLeftChange,
  onRightChange,
  fontSize,
  lineNumbers,
  wordWrap,
  monacoTheme = 'flux-vscode-light',
  leftStickyScrollEnabled = false,
  rightStickyScrollEnabled = false,
  leftAriaLabel,
  onLeftReady,
  rightAriaLabel,
}: {
  leftText: string
  rightText: string
  leftHighlights: number[]
  rightHighlights: number[]
  /** Prefer precise character ranges (JSON mode). Falls back to whole-line highlights. */
  leftRanges?: EditorSelectionRange[]
  rightRanges?: EditorSelectionRange[]
  /** Applied once per request id; revealing lines does not move either cursor or selection. */
  lineRevealRequest?: DualEditorLineRevealRequest
  layout: 'side-by-side' | 'inline'
  language?: string
  onLeftFocus?: () => void
  onRightFocus?: () => void
  onLeftChange?: (text: string) => void
  onRightChange?: (text: string) => void
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  monacoTheme?: string
  leftStickyScrollEnabled?: boolean
  rightStickyScrollEnabled?: boolean
  onLeftReady?: (editor: MonacoEditor.IStandaloneCodeEditor) => (() => void) | void
  leftAriaLabel?: string
  rightAriaLabel?: string
}) {
  const leftRef = useRef<TextEditorCoreHandle | null>(null)
  const rightRef = useRef<TextEditorCoreHandle | null>(null)
  const isSyncing = useRef(false)
  const lineRevealRequestRef = useRef(lineRevealRequest)
  const appliedLeftReveal = useRef<number | null>(null)
  const appliedRightReveal = useRef<number | null>(null)

  const applyLineReveal = useCallback((ready?: {
    side: 'left' | 'right'
    editor: MonacoEditor.IStandaloneCodeEditor
  }) => {
    const request = lineRevealRequestRef.current
    if (!request) return
    const leftEditor = ready?.side === 'left' ? ready.editor : leftRef.current?.getEditor()
    const rightEditor = ready?.side === 'right' ? ready.editor : rightRef.current?.getEditor()
    const reveal = (editor: MonacoEditor.IStandaloneCodeEditor | null | undefined, line: number) => {
      const lineCount = editor?.getModel()?.getLineCount()
      if (!editor || !lineCount || !Number.isFinite(line)) return false
      editor.revealLineInCenter(Math.max(1, Math.min(Math.floor(line), lineCount)))
      return true
    }

    // The two targets can have different line numbers after insertions or
    // deletions. Suppress ordinary pixel-scroll mirroring while positioning
    // each editor independently.
    isSyncing.current = true
    try {
      if (appliedLeftReveal.current !== request.requestId && reveal(leftEditor, request.leftLine)) {
        appliedLeftReveal.current = request.requestId
      }
      if (appliedRightReveal.current !== request.requestId && reveal(rightEditor, request.rightLine)) {
        appliedRightReveal.current = request.requestId
      }
    } finally {
      isSyncing.current = false
    }
  }, [])

  useEffect(() => {
    ensureCss()
  }, [])

  useEffect(() => {
    lineRevealRequestRef.current = lineRevealRequest
    applyLineReveal()
  }, [applyLineReveal, lineRevealRequest])

  const useLeftRanges = Boolean(leftRanges && leftRanges.length > 0)
  const useRightRanges = Boolean(rightRanges && rightRanges.length > 0)

  const leftDecorations = useMemo<LineDecorationSpec[]>(() => {
    if (useLeftRanges) return []
    return [{
      lines: leftHighlights,
      className: 'ft-left-change-line',
      rulerColor: 'rgba(252, 165, 165, 0.22)',
    }]
  }, [leftHighlights, useLeftRanges])

  const rightDecorations = useMemo<LineDecorationSpec[]>(() => {
    if (useRightRanges) return []
    return [{
      lines: rightHighlights,
      className: 'ft-right-change-line',
      rulerColor: 'rgba(134, 239, 172, 0.22)',
    }]
  }, [rightHighlights, useRightRanges])

  const leftRangeDecorations = useMemo<RangeDecorationSpec[]>(() => {
    if (!useLeftRanges || !leftRanges) return []
    return [{
      ranges: leftRanges,
      className: 'ft-left-change-block',
      rulerColor: 'rgba(252, 165, 165, 0.28)',
    }]
  }, [leftRanges, useLeftRanges])

  const rightRangeDecorations = useMemo<RangeDecorationSpec[]>(() => {
    if (!useRightRanges || !rightRanges) return []
    return [{
      ranges: rightRanges,
      className: 'ft-right-change-block',
      rulerColor: 'rgba(134, 239, 172, 0.28)',
    }]
  }, [rightRanges, useRightRanges])

  const syncFrom = (source: 'left' | 'right') =>
    (position: { scrollTop: number; scrollLeft: number }) => {
      if (isSyncing.current) return
      const other = source === 'left' ? rightRef.current : leftRef.current
      if (!other) return
      isSyncing.current = true
      other.setScrollPosition(position)
      isSyncing.current = false
    }

  const leftPane = (
    <TextEditorCore
      ref={leftRef}
      value={leftText}
      language={language}
      theme={monacoTheme}
      fontSize={fontSize}
      lineNumbers={lineNumbers}
      wordWrap={wordWrap}
      stickyScroll={leftStickyScrollEnabled}
      optionOverrides={{ ...dualOptionOverrides, ariaLabel: leftAriaLabel }}
      lineDecorations={leftDecorations}
      rangeDecorations={leftRangeDecorations}
      onChange={onLeftChange}
      onFocus={onLeftFocus}
      onReady={(editor) => {
        const cleanup = onLeftReady?.(editor)
        applyLineReveal({ side: 'left', editor })
        return cleanup
      }}
      onScrollChange={syncFrom('left')}
    />
  )

  const rightPane = (
    <TextEditorCore
      ref={rightRef}
      value={rightText}
      language={language}
      theme={monacoTheme}
      fontSize={fontSize}
      lineNumbers={lineNumbers}
      wordWrap={wordWrap}
      stickyScroll={rightStickyScrollEnabled}
      optionOverrides={{ ...dualOptionOverrides, ariaLabel: rightAriaLabel }}
      lineDecorations={rightDecorations}
      rangeDecorations={rightRangeDecorations}
      onChange={onRightChange}
      onFocus={onRightFocus}
      onReady={(editor) => applyLineReveal({ side: 'right', editor })}
      onScrollChange={syncFrom('right')}
    />
  )

  const border = '1px solid var(--color-border-tertiary)'

  if (layout === 'side-by-side') {
    return (
      <div style={{ display: 'flex', height: '100%' }}>
        <div style={{ flex: 1, overflow: 'hidden', borderRight: border }}>{leftPane}</div>
        <div style={{ flex: 1, overflow: 'hidden' }}>{rightPane}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'hidden', borderBottom: border }}>{leftPane}</div>
      <div style={{ flex: 1, overflow: 'hidden' }}>{rightPane}</div>
    </div>
  )
}
