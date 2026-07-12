import { useCallback, useEffect, useRef, useState } from 'react'
import { getPluginHostSdk, type DiffSource } from '@hiven/plugin'

/**
 * Bidirectional Diff source text.
 * - editor-pane (+ paneId): local display + write-through to host store (and cross-window for quick-editor)
 * - clipboard / empty: local-only snapshot
 *
 * Local state is the typing surface of truth so Diff stays responsive even when
 * the pane store lives in another webview. External store updates still follow in
 * when the bound value itself changes.
 */
export function useDiffSourceText(source: DiffSource): [string, (text: string) => void] {
  const { hooks } = getPluginHostSdk()
  const isBound = source.kind === 'editor-pane' && Boolean(source.paneId)
  const boundText = hooks.useBoundSourceText(source)
  const [localText, setLocalText] = useState(source.text ?? '')
  const { setBoundSourceText } = hooks.useWorkspaceActions()
  const prevBoundRef = useRef(boundText)

  useEffect(() => {
    if (!isBound) return
    if (boundText === prevBoundRef.current) return
    prevBoundRef.current = boundText
    setLocalText(boundText)
  }, [isBound, boundText])

  const setText = useCallback((newText: string) => {
    setLocalText(newText)
    if (!isBound) return
    setBoundSourceText(
      {
        kind: source.kind,
        paneId: source.paneId,
        origin: source.origin,
        text: source.text,
      },
      newText,
    )
  }, [isBound, setBoundSourceText, source.kind, source.paneId, source.origin, source.text])

  return [localText, setText]
}
