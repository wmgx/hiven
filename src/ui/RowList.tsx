import { useEffect, useRef, type ReactNode } from 'react'
import { shouldIgnoreImeKeyDown } from '../utils/imeKeyboard'
import './RowList.css'

export type RowItem = { id: string; title: string; description?: string; icon?: ReactNode; group?: string; disabled?: boolean }
export function Row({ item, selected, detail = false, onSelect, onActivate, onMore }: {
  item: RowItem; selected: boolean; detail?: boolean
  onSelect(): void; onActivate(): void; onMore?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }) }, [selected])
  return <button ref={ref} type="button" className={`hiven-row ${selected ? 'is-selected' : ''}`} role="option"
    aria-selected={selected} disabled={item.disabled} tabIndex={-1}
    onPointerMove={event => { if (event.movementX || event.movementY) onSelect() }}
    onClick={() => { onSelect(); if (!detail) onActivate() }} onDoubleClick={() => { if (detail) onActivate() }}
    onContextMenu={event => { if (onMore) { event.preventDefault(); onSelect(); onMore() } }}>
    {item.icon}<span className="hiven-row-text"><span>{item.title}</span>{item.description && <small>{item.description}</small>}</span>
    {selected && <kbd>↵</kbd>}
  </button>
}

export function RowList({ items, selectedId, onSelect, onActivate, onMore, detail, label }: {
  items: RowItem[]; selectedId?: string; onSelect(id: string): void; onActivate(id: string): void
  onMore?: (id: string) => void; detail?: boolean; label: string
}) {
  const composing = useRef(false)
  return <div className="hiven-row-list" role="listbox" aria-label={label} tabIndex={0}
    onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
    onKeyDown={event => {
      if (shouldIgnoreImeKeyDown(event, composing)) return
      const selected = Math.max(0, items.findIndex(item => item.id === selectedId))
      let next = selected
      if (event.key === 'ArrowDown') next = Math.min(items.length - 1, selected + 1)
      else if (event.key === 'ArrowUp') next = Math.max(0, selected - 1)
      else if ((event.metaKey || event.ctrlKey) && /^[1-9]$/.test(event.key)) {
        const item = items[Number(event.key) - 1]
        event.preventDefault(); event.stopPropagation()
        if (item && !item.disabled) { onSelect(item.id); onActivate(item.id) }
        return
      } else if (event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation()
        if (items[selected] && !items[selected].disabled) onActivate(items[selected].id)
        return
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && onMore && items[selected]) {
        event.preventDefault(); event.stopPropagation(); onMore(items[selected].id); return
      } else return
      event.preventDefault(); event.stopPropagation()
      if (items[next]) onSelect(items[next].id)
    }}>
    {items.map((item, index) => <div key={item.id}>
      {item.group && item.group !== items[index - 1]?.group && <div className="hiven-row-group">{item.group}</div>}
      <Row item={item} selected={item.id === selectedId} detail={detail} onSelect={() => onSelect(item.id)}
        onActivate={() => onActivate(item.id)} onMore={onMore ? () => onMore(item.id) : undefined} />
    </div>)}
  </div>
}
