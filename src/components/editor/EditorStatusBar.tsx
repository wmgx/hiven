import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../../i18n'

export interface EditorStatusBarProps {
  cursor: { line: number; col: number }
  lineCount: number
  charCount: number
  selectedCharCount: number
  languageStatus: string
  leading?: ReactNode
  trailing?: ReactNode
}

export function EditorStatusBar({
  cursor,
  lineCount,
  charCount,
  selectedCharCount,
  languageStatus,
  leading,
  trailing,
}: EditorStatusBarProps) {
  const t = useT('editor')
  const barRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = barRef.current
    if (!node) return
    const updateWidth = () => setWidth(node.clientWidth)
    updateWidth()
    const resizeObserver = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? node.clientWidth)
    })
    resizeObserver.observe(node)
    return () => resizeObserver.disconnect()
  }, [])

  const showLineCount = width >= 240
  const showCharCount = width >= 320
  const showLanguage = width >= 160

  return (
    <div
      ref={barRef}
      className="h-[22px] flex items-center px-2 gap-2 shrink-0 overflow-hidden whitespace-nowrap text-[10px]"
      style={{
        borderTop: 'var(--hairline) solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
        color: 'var(--color-text-tertiary)',
      }}
    >
      {leading}
      <span className="shrink-0">
        {t('line')} {cursor.line}, {t('column')} {cursor.col}
      </span>
      {showLineCount && (
        <span className="shrink-0">
          {lineCount} {t('lines')}
        </span>
      )}
      {showCharCount && (
        <span className="shrink-0">
          {charCount} {t('chars')}
        </span>
      )}
      {selectedCharCount > 0 && (
        <span className="shrink-0">
          {selectedCharCount} {t('selectedChars')}
        </span>
      )}
      <span className="ml-auto" aria-hidden />
      {showLanguage && (
        <span className="min-w-0 truncate text-right" title={languageStatus}>
          {languageStatus}
        </span>
      )}
      {trailing}
    </div>
  )
}
