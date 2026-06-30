import { useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'

type StandaloneDiffRow = {
  index: number
  left: string
  right: string
  status: 'same' | 'changed' | 'added' | 'removed'
}

export function TextDiffSurface(props: PluginSurfaceProps) {
  const { host } = props
  const [originalText, setOriginalText] = useState(props.initialText ?? 'hello\nworld\n')
  const [modifiedText, setModifiedText] = useState('hello\nhiven\nworld\n')
  const rows = useMemo(() => standaloneDiffRows(originalText, modifiedText), [modifiedText, originalText])
  const changeCount = rows.filter((row) => row.status !== 'same').length

  return (
    <section className="text-diff-tool-surface" aria-label="Text Diff">
      <header className="text-diff-tool-surface__header">
        <div>
          <strong>Text Diff</strong>
          <span>{changeCount} changed line{changeCount === 1 ? '' : 's'}</span>
        </div>
        <button type="button" onClick={() => host.close()}>Close</button>
      </header>

      <div className="text-diff-tool-surface__body">
        <label className="text-diff-tool-surface__pane">
          <span>Original</span>
          <textarea value={originalText} onChange={(event) => setOriginalText(event.target.value)} spellCheck={false} />
        </label>
        <label className="text-diff-tool-surface__pane">
          <span>Modified</span>
          <textarea value={modifiedText} onChange={(event) => setModifiedText(event.target.value)} spellCheck={false} />
        </label>
        <div className="text-diff-tool-surface__preview">
          <span>Preview</span>
          <div className="text-diff-tool-surface__rows">
            {rows.map((row) => (
              <div key={row.index} className={`text-diff-tool-surface__row is-${row.status}`}>
                <span>{row.index + 1}</span>
                <code>{row.left || ' '}</code>
                <code>{row.right || ' '}</code>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function standaloneDiffRows(originalText: string, modifiedText: string): StandaloneDiffRow[] {
  const leftLines = originalText.split(/\r?\n/)
  const rightLines = modifiedText.split(/\r?\n/)
  const length = Math.max(leftLines.length, rightLines.length)
  return Array.from({ length }, (_, index) => {
    const left = leftLines[index] ?? ''
    const right = rightLines[index] ?? ''
    const hasLeft = index < leftLines.length
    const hasRight = index < rightLines.length
    return {
      index,
      left,
      right,
      status: left === right ? 'same' : !hasLeft ? 'added' : !hasRight ? 'removed' : 'changed',
    }
  })
}
