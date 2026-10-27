import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

const MAX_LINES = 4

function lineHeightOf(style: CSSStyleDeclaration): number {
  return parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
}

/** Lines `text` would wrap to inside `field`, measured with the field's own font and width. */
export function measureWrappedLines(field: HTMLElement, text: string): number {
  const style = getComputedStyle(field)
  const lineHeight = lineHeightOf(style)
  const measure = document.createElement('div')
  const width = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  Object.assign(measure.style, { position: 'absolute', visibility: 'hidden', font: style.font,
    letterSpacing: style.letterSpacing, width: `${width}px`, lineHeight: `${lineHeight}px`,
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' })
  measure.textContent = text
  document.body.append(measure)
  const lines = Math.round(measure.getBoundingClientRect().height / lineHeight)
  measure.remove()
  return lines
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'rows'> & {
  value: string
  onChange?: (value: string) => void
}

/**
 * Single-line launcher input that soft-wraps and grows up to 4 lines, then
 * scrolls. Typing never inserts a line break; Enter stays with the host keys.
 */
export const LauncherAutoGrowInput = forwardRef<HTMLTextAreaElement, Props>(function LauncherAutoGrowInput(
  { value, onChange, className, ...rest },
  forwardedRef,
) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const setRef = useCallback((node: HTMLTextAreaElement | null) => {
    ref.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])

  useLayoutEffect(() => {
    const field = ref.current
    if (!field) return
    const lineHeight = lineHeightOf(getComputedStyle(field))
    field.style.height = 'auto'
    const lines = Math.max(1, Math.round(field.scrollHeight / lineHeight))
    field.style.height = `${Math.min(lines, MAX_LINES) * lineHeight}px`
    field.dataset.multiline = lines > 1 ? 'true' : 'false'
  }, [value])

  useEffect(() => {
    const field = ref.current
    if (!field) return
    const blockBreaks = (event: InputEvent) => {
      if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') event.preventDefault()
    }
    field.addEventListener('beforeinput', blockBreaks)
    return () => field.removeEventListener('beforeinput', blockBreaks)
  }, [])

  return (
    <textarea
      {...rest}
      ref={setRef}
      rows={1}
      wrap="soft"
      value={value}
      className={['l-search-field', className].filter(Boolean).join(' ')}
      onChange={(event) => onChange?.(event.target.value.replace(/[\r\n]+/g, ''))}
    />
  )
})
