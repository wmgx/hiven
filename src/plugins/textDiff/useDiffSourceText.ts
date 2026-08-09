import { useCallback, useEffect, useRef, useState } from 'react'
import { getPluginDiffHost, type DiffSource } from '@hiven/plugin-diff'

/**
 * Bidirectional Diff source text (text-diff plugin only).
 * - editor-pane (+ paneId): local display + write-through via plugin-diff host
 * - clipboard / empty: local-only snapshot
 */
export function useDiffSourceText(source: DiffSource): [string, (text: string) => void] {
  const { hooks } = getPluginDiffHost()
  const isBound = source.kind === 'editor-pane' && Boolean(source.paneId)
  const boundText = hooks.useBoundSourceText(source)
  const [localText, setLocalText] = useState(source.text ?? '')
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
    hooks.setBoundSourceText(
      {
        kind: source.kind,
        paneId: source.paneId,
        origin: source.origin,
        text: source.text,
      },
      newText,
    )
  }, [isBound, hooks, source.kind, source.paneId, source.origin, source.text])

  return [localText, setText]
}
