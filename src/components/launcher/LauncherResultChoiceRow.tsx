import { useEffect, useRef } from 'react'
import type { LauncherResultChoice } from '../../workspace/launcher/types'

export function LauncherResultChoiceRow({
  choice,
  index,
  selected,
  checked = false,
  disabled = false,
  multi = false,
  onHover,
  onSelect,
}: {
  choice: LauncherResultChoice
  index: number
  selected: boolean
  checked?: boolean
  disabled?: boolean
  multi?: boolean
  onHover?: () => void
  onSelect: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const bodyText = choice.preview ?? choice.title
  const longResult = isLongResultText(bodyText)
  const className = `global-launcher-result-row ${longResult ? 'l-result-block' : 'l-result'} ${selected ? 'sel is-selected' : ''} ${disabled ? 'disabled' : ''}`

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className={className}
      onMouseEnter={onHover}
      onClick={onSelect}
      disabled={disabled}
    >
      {multi ? (
        <span className={`check ${checked ? 'on' : ''}`}>{checked ? '✓' : ''}</span>
      ) : (
        <span className="ri">{index === 0 ? '=' : '#'}</span>
      )}
      <span className={longResult ? 'block-main' : 'rtext'}>{bodyText}</span>
      {!longResult && choice.subtitle && (
        <span className="rkind">{choice.subtitle}</span>
      )}
      {!multi && <span className="rkbd">↵</span>}
    </button>
  )
}

function isLongResultText(text: string): boolean {
  return text.includes('\n') || text.length > 88
}
