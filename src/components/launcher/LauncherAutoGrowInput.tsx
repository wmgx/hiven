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
  { value, onChange, className, onFocus, ...rest },
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
    field.dataset.multiline = 'false'
    field.style.height = 'auto'
    let lineHeight = lineHeightOf(getComputedStyle(field))
    if (field.scrollHeight > lineHeight * 1.5) field.dataset.multiline = 'true'
    lineHeight = lineHeightOf(getComputedStyle(field))
    const lines = Math.max(1, Math.round(field.scrollHeight / lineHeight))
    field.style.height = `${Math.min(lines, MAX_LINES) * lineHeight}px`
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
      // Wrapped lines past 4 scroll inside the field; the launcher wheel guard must let them.
      data-launcher-scrollable
      value={value}
      className={['l-search-field', className].filter(Boolean).join(' ')}
      onChange={(event) => onChange?.(event.target.value.replace(/[\r\n]+/g, ''))}
      onFocus={(event) => {
        // Remount + programmatic focus (e.g. Esc back to the list) lands at 0; resume at the end.
        // A mouse click places its caret after this, so clicks still win.
        const field = event.currentTarget
        if (field.selectionStart === 0 && field.selectionEnd === 0 && field.value.length > 0) {
          field.setSelectionRange(field.value.length, field.value.length)
        }
        onFocus?.(event)
      }}
    />
  )
})
