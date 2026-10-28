import { finishImeComposition, startImeComposition, shouldIgnoreImeKeyDown } from '../utils/imeKeyboard'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LauncherAutoGrowInput, measureWrappedLines } from '../components/launcher/LauncherAutoGrowInput'
import { ObjectBlockToken } from '../components/launcher/ObjectBlockToken'
import { createQueryObjectBlock } from '../launcher/clipboard/objectBlock'
import { shouldPasteAsBlock } from '../launcher/clipboard/attachPolicy'
import { registerLocalEscapeLayer } from '../utils/localEscapeLayer'
import { useAppStore } from '../store'
import { t } from '../i18n'

/** Command material uses the same Block and four-line input as the launcher. */
export function CommandInput({ value, onChange, placeholder, initialMaterial = false, onKeyDown }: {
  value: string; onChange(value: string): void; placeholder?: string; initialMaterial?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}) {
  const composing = useRef(false)
  const locale = useAppStore(state => state.locale)
  const [block, setBlock] = useState(initialMaterial)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const editor = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (initialMaterial) setBlock(true) }, [initialMaterial])
  const hasBlock = block && Boolean(value)
  const collapse = () => { setExpanded(false); requestAnimationFrame(() => field.current?.focus()) }
  useEffect(() => {
    if (!expanded || !root.current || !editor.current) return
    editor.current.focus()
    return registerLocalEscapeLayer({ trigger: root.current, popup: editor.current, isCurrent: () => true,
      isComposing: () => composing.current, dismiss: collapse })
  }, [expanded])
  const key = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldIgnoreImeKeyDown(event, composing)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e' && hasBlock) {
      event.preventDefault(); event.stopPropagation(); if (expanded) collapse(); else setExpanded(true); return
    }
    if (event.key === 'Backspace' && hasBlock && !expanded) {
      event.preventDefault(); event.stopPropagation(); setBlock(false); onChange(''); return
    }
    if (event.key === 'Tab' && !expanded) {
      const chip = root.current?.closest('.surface-chrome-header')?.querySelector<HTMLButtonElement>('[data-value-chip]')
      if (chip) { event.preventDefault(); event.stopPropagation(); chip.click(); return }
    }
    onKeyDown?.(event)
  }
  return <div ref={root} className="hiven-command-input" onCompositionStart={() => startImeComposition(composing)} onCompositionEnd={() => finishImeComposition(composing)}>
    {hasBlock && !expanded && <ObjectBlockToken block={createQueryObjectBlock({ query: value })} locale={locale}
      onRemove={() => { setBlock(false); onChange('') }} />}
    {expanded ? <textarea ref={editor} className="launcher-block-editor" value={value} rows={Math.min(10, Math.max(3, value.split('\n').length))}
      aria-label={t(locale, 'palette.expandBlock')} data-launcher-scrollable onChange={event => onChange(event.target.value)} onKeyDown={key} />
      : <LauncherAutoGrowInput ref={field} data-command-input data-plugin-surface-autofocus="sticky" autoFocus
        value={hasBlock ? '' : value} readOnly={hasBlock} aria-label={placeholder} placeholder={hasBlock ? t(locale, 'palette.blockInputHint') : placeholder}
        onChange={onChange} onKeyDown={key} onPaste={event => {
          const text = event.clipboardData.getData('text/plain')
          const field = event.currentTarget
          const merged = value.slice(0, field.selectionStart) + text + value.slice(field.selectionEnd)
          if (!shouldPasteAsBlock(text, measureWrappedLines(field, merged))) return
          event.preventDefault(); setBlock(true); onChange(merged)
        }} />}
  </div>
}
