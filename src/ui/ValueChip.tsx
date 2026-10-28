import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import './ValueChip.css'

type Value = string | string[]
export type ValueChipProps = {
  label: string
  value: Value
  options?: Array<{ value: string; label: string; description?: string }>
  onChange(value: Value): void | boolean
  onPreview?(value: Value): void | boolean
  custom?: 'text' | 'number'
  multiple?: boolean
  disabled?: boolean
  emptyLabel?: string
  maxSelect?: number
}

/** Selection is provisional until Enter/click; leaving the popup restores its opening value. */
export function ValueChip({ label, value, options = [], onChange, onPreview, custom, multiple, disabled, emptyLabel, maxSelect }: ValueChipProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const origin = useRef<Value>(value)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Value>(value)
  const [selected, setSelected] = useState(0)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const filtered = custom ? options : options.filter(option => `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const selectedValue = custom ? String(draft) : multiple ? draft : filtered[selected]?.value ?? draft
  const display = (Array.isArray(value) ? value : [value]).map(item => options.find(option => option.value === item)?.label ?? item).join(', ')
  const callbacks = useRef({ onChange, onPreview })
  callbacks.current = { onChange, onPreview }
  const cancel = () => { callbacks.current.onPreview?.(origin.current); setOpen(false); trigger.current?.focus() }
  const preview = (next: Value) => { setDraft(next); callbacks.current.onPreview?.(next) }
  const commit = (next = selectedValue, nextChip = false) => {
    if (callbacks.current.onChange(next) === false) return
    setOpen(false)
    trigger.current?.focus()
    if (nextChip) {
      const chips = [...(trigger.current?.closest('[data-value-chips]')?.querySelectorAll<HTMLButtonElement>('[data-value-chip]') ?? [])]
      const nextTrigger = chips[(chips.indexOf(trigger.current!) + 1) % chips.length]
      requestAnimationFrame(() => nextTrigger?.click())
    }
  }
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current!.getBoundingClientRect()
    setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)) })
    input.current?.focus()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) cancel()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => { document.removeEventListener('pointerdown', outside, true) }
  }, [open])
  const toggle = (item: string) => {
    const values = Array.isArray(draft) ? draft : []
    const next = values.includes(item) ? values.filter(value => value !== item) : values.length < (maxSelect ?? Infinity) ? [...values, item] : values
    preview(next)
  }
  return <>
    <button type="button" ref={trigger} data-value-chip className="hiven-value-chip" disabled={disabled}
      aria-label={`${label}: ${display}`} aria-expanded={open} aria-haspopup="listbox"
      onClick={() => {
        if (open) { cancel(); return }
        origin.current = Array.isArray(value) ? [...value] : value
        setDraft(origin.current)
        setQuery(custom ? String(value) : '')
        setSelected(Math.max(0, options.findIndex(option => option.value === value)))
        setOpen(true)
      }} onKeyDown={event => { if (event.key === 'Tab' && !event.shiftKey && !open) { event.preventDefault(); event.stopPropagation(); trigger.current?.click() } }}>
      <span>{label}</span><strong>{display || emptyLabel || '—'}</strong><ChevronDown size={12} />
    </button>
    {open && createPortal(<div ref={popup} className="hiven-value-menu" style={position} data-local-escape-layer
      onKeyDown={event => {
        if (shouldIgnoreImeKeyDown(event, composing)) { event.stopPropagation(); return }
        if (['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key) || (multiple && event.key === ' ')) event.stopPropagation()
        if (event.key === 'Escape') { event.preventDefault(); cancel() }
        else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); commit(selectedValue, event.key === 'Tab') }
        else if (multiple && event.key === ' ') { event.preventDefault(); if (filtered[selected]) toggle(filtered[selected].value) }
        else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const next = Math.max(0, Math.min(filtered.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)))
          setSelected(next)
          if (filtered[next] && !multiple) { preview(filtered[next].value); if (custom) setQuery(filtered[next].value) }
        }
      }}>
      <input ref={input} aria-label={label} value={query} type={custom === 'number' ? 'number' : 'text'}
        onCompositionStart={() => startImeComposition(composing)} onCompositionEnd={() => finishImeComposition(composing)}
        onChange={event => { setQuery(event.target.value); setSelected(0); if (custom) preview(event.target.value) }} />
      <div role="listbox" aria-label={label} aria-multiselectable={multiple || undefined}>
        {filtered.map((option, index) => <button key={option.value} type="button" role="option"
          aria-selected={multiple ? Array.isArray(draft) && draft.includes(option.value) : index === selected}
          className={index === selected ? 'is-highlighted' : ''} tabIndex={-1}
          onPointerMove={event => { if (!event.movementX && !event.movementY) return; setSelected(index); if (!multiple) preview(option.value) }}
          onMouseDown={event => event.preventDefault()}
          onClick={() => multiple ? toggle(option.value) : commit(option.value)}>
          <span>{option.label}{option.description && <small>{option.description}</small>}</span>
          {multiple && Array.isArray(draft) && draft.includes(option.value) && <span aria-hidden>✓</span>}
        </button>)}
        {!filtered.length && emptyLabel && <p>{emptyLabel}</p>}
      </div>
    </div>, document.body)}
  </>
}
