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
  const [localText, setLocalText] = useState(boundText)
  const writeControllerRef = useRef<AbortController | undefined>(undefined)
  const writeGenerationRef = useRef(0)

  useEffect(() => {
    setLocalText(boundText)
  }, [source, boundText])

  useEffect(() => () => {
    writeGenerationRef.current += 1
    writeControllerRef.current?.abort()
    writeControllerRef.current = undefined
  }, [source.kind, source.paneId, source.origin])

  const setText = useCallback((newText: string) => {
    setLocalText(newText)
    if (!isBound) return
    writeControllerRef.current?.abort()
    const controller = new AbortController()
    const generation = ++writeGenerationRef.current
    writeControllerRef.current = controller
    hooks.setBoundSourceText(
      {
        kind: source.kind,
        paneId: source.paneId,
        origin: source.origin,
        text: source.text,
      },
      newText,
      {
        signal: controller.signal,
        isCurrent: () => writeControllerRef.current === controller && writeGenerationRef.current === generation,
      },
    )
  }, [isBound, hooks, source.kind, source.paneId, source.origin, source.text])

  return [localText, setText]
}
