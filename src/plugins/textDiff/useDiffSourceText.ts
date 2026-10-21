import { useCallback, useEffect, useState } from 'react'
import type { DiffSource } from '@hiven/plugin-diff'

/**
 * Local Diff source text (text-diff plugin only). Every source is an imported
 * snapshot; edits never write back to an editor pane.
 */
export function useDiffSourceText(source: DiffSource): [string, (text: string) => void] {
  const [text, setText] = useState(source.text ?? '')
  useEffect(() => {
    setText(source.text ?? '')
  }, [source])
  const write = useCallback((next: string) => setText(next), [])
  return [text, write]
}
