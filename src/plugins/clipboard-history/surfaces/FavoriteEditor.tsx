import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { ActionBar, Button, Combobox, TextInput, useImeKeyboard, useLocalEscapeLayer } from '@hiven/plugin-ui'
import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import type { ClipboardHistoryItem, FavoriteField } from '../storage/clipboardHistoryTypes'

type Draft = { title: string; fields: FavoriteField[]; dirty?: boolean; error?: string; savedFields?: FavoriteField[] }

export function useFavoriteEditor(repository: ClipboardHistoryRepository, host: PluginSurfaceProps['host'], t: PluginSurfaceProps['t'], onSaved: (item: ClipboardHistoryItem) => void, selectedId: string | null) {
  const drafts = useRef(new Map<string, Draft>())
  const pending = useRef(new Map<string, Promise<void>>())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, render] = useState(0)
  const [names, setNames] = useState<string[]>([])
  const save = useCallback((id: string): Promise<void> => {
    const running = pending.current.get(id)
    if (running) return running.then(() => save(id))
    const draft = drafts.current.get(id)
    if (!draft?.dirty) return Promise.resolve()
    draft.dirty = false
    const missingName = draft.fields.some(field => field.value.trim() && !field.name.trim())
    const fields = draft.fields.flatMap((field, index) => field.value.trim() && !field.name.trim() ? draft.savedFields?.[index] ? [draft.savedFields[index]] : [] : [field])
    const operation = repository.updateFavoriteInfo(id, draft.title, fields).then(item => {
      if (!item?.isFavorite) throw new Error('error.favoriteFailed')
      onSaved(item)
      if (drafts.current.get(id) === draft) { draft.savedFields = item.favoriteFields; draft.error = missingName ? t('favorite.nameRequired') : undefined }
    }).catch(error => {
      const key = error instanceof Error && ['favorite.nameRequired', 'favorite.tooManyFields'].includes(error.message) ? error.message : 'error.favoriteFailed'
      draft.error = t(key)
    }).finally(() => { pending.current.delete(id); render(v => v + 1) })
    pending.current.set(id, operation)
    return operation
  }, [repository, onSaved, t])
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    for (const id of drafts.current.keys()) void save(id)
  }, [save])
  useEffect(() => { flush(); setEditingId(id => id === selectedId ? id : null) }, [selectedId, flush])
  useEffect(() => {
    const off = host.subscribeLeaveIntent?.(flush)
    const ownerOff = host.deliveryFeedbackOwner?.subscribeInvalidation(flush)
    window.addEventListener('pagehide', flush)
    return () => { flush(); off?.(); ownerOff?.(); window.removeEventListener('pagehide', flush) }
  }, [host.subscribeLeaveIntent, host.deliveryFeedbackOwner, flush])
  const open = (item: ClipboardHistoryItem) => {
    if (!drafts.current.has(item.id)) drafts.current.set(item.id, { title: item.favoriteTitle ?? '', fields: item.favoriteFields ?? [], savedFields: item.favoriteFields ?? [] })
    setEditingId(item.id)
    void repository.getFavoriteFieldNames().then(setNames).catch(() => setNames([]))
  }
  const change = (id: string, draft: Draft) => {
    drafts.current.set(id, { ...draft, dirty: true, error: undefined })
    render(v => v + 1)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(id), 400)
  }
  return { open, names, flush, close: () => { flush(); setEditingId(null) },
    draft: selectedId && editingId === selectedId ? drafts.current.get(selectedId) : undefined,
    change,
  }
}

export function FavoriteEditor({ draft, editing, disabled, names, onChange, onBlur, onExit, onEdit, onCopy, host, t }: {
  host: PluginSurfaceProps['host']; draft: Draft; editing: boolean; disabled: boolean; names: string[]; onChange: (draft: Draft) => void; onBlur: () => void; onExit: () => void; onEdit(): void; onCopy(value: string): void; t: PluginSurfaceProps['t']
}) {
  const ime = useImeKeyboard()
  const title = useRef<HTMLInputElement>(null)
  const lastField = useRef<HTMLInputElement | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useLocalEscapeLayer({ open: editing, triggerRef: root, popupRef: root, owner: host.deliveryFeedbackOwner, composingRef: ime.isImeComposingRef, onDismiss: onExit })
  useEffect(() => { if (editing) title.current?.focus() }, [editing])
  const rows = editing && draft.fields.length < 12 ? [...draft.fields, { name: '', value: '' }] : draft.fields
  const change = (index: number, patch: Partial<FavoriteField>) => {
    const fields = [...draft.fields]
    fields[index] = { ...(fields[index] ?? { name: '', value: '' }), ...patch }
    onChange({ ...draft, fields })
  }
  const nextCell = (direction = 1) => {
    const inputs = [...(root.current?.querySelectorAll<HTMLInputElement>('input:not([tabindex="-1"]):not([type="hidden"]):not(:disabled)') ?? [])]
    const index = inputs.indexOf(lastField.current ?? document.activeElement as HTMLInputElement)
    inputs[Math.max(0, Math.min(inputs.length - 1, index + direction))]?.focus()
  }
  return <div ref={root} className={`clipboard-history-favorite-form${editing ? ' is-editing' : ''}`} onBlur={onBlur} onFocus={event => { if (event.target instanceof HTMLInputElement) lastField.current = event.target }}
    onKeyDownCapture={event => {
      if (editing && event.key === 'Tab' && !ime.shouldIgnoreKeyDown(event)) {
        event.preventDefault(); event.stopPropagation(); nextCell(event.shiftKey ? -1 : 1)
      }
    }}
    onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd}
    onKeyDown={event => {
      if (!editing || event.defaultPrevented || ime.shouldIgnoreKeyDown(event)) return
      if ((event.target as HTMLElement).getAttribute('aria-expanded') === 'true') return
      event.stopPropagation()
      if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'e')) { event.preventDefault(); onExit() }
      else if (event.key === 'Enter') { event.preventDefault(); nextCell() }
      else if (event.key === 'Backspace') {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-favorite-row]')
        const index = Number(row?.dataset.favoriteRow)
        if (row && index < draft.fields.length && !draft.fields[index].name && !draft.fields[index].value) {
          event.preventDefault(); onChange({ ...draft, fields: draft.fields.filter((_, i) => i !== index) }); title.current?.focus()
        }
      }
    }}>
    {editing && <ActionBar><Button variant="ghost" onClick={() => nextCell()}>{t('favorite.nextCell')}<kbd>↵</kbd></Button><Button variant="ghost" onClick={onExit}>{t('favorite.done')}<kbd>⌘E</kbd></Button></ActionBar>}
    <div className="clipboard-history-favorite-title-bar"><span>{t('favorite.info')}</span>{!editing && <Button variant="ghost" disabled={disabled} aria-label={t('action.editFavoriteInfo')} onClick={onEdit}>{t('action.editFavoriteInfo')} <kbd>⌘E</kbd></Button>}</div>
    <table className="clipboard-history-favorite-fields"><tbody>
      <tr><td>{t('favorite.titlePlaceholder')}</td><td>{editing ? <TextInput ref={title} aria-label={t('favorite.titlePlaceholder')} placeholder={t('favorite.titlePlaceholder')} value={draft.title} maxLength={80} onChange={event => onChange({ ...draft, title: event.target.value })} /> : <span>{draft.title || '—'}</span>}</td><td /></tr>
      {rows.map((field, index) => <tr data-favorite-row={index} key={index}>
        <td>{editing ? <><Combobox side="top" allowCustomValue maxLength={20} options={names.map(name => ({ label: name, value: name }))}
          aria-label={t('favorite.fieldName')} placeholder={t('favorite.fieldName')} value={field.name} onChange={name => change(index, { name })} />
          {field.value.trim() && !field.name.trim() && <small className="favorite-field-error">{t('favorite.nameRequired')}</small>}</> : field.name}</td>
        <td>{editing ? <TextInput aria-label={t('favorite.fieldValue')} placeholder={t('favorite.fieldValue')} value={field.value} maxLength={500} onChange={event => change(index, { value: event.target.value })} />
          : <Button variant="ghost" disabled={disabled} title={t('favorite.copyValue')} onClick={() => onCopy(field.value)}>{field.value}</Button>}</td>
        <td>{editing && index < draft.fields.length && <Button variant="ghost" aria-label={t('favorite.removeField')} onClick={() => onChange({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>×</Button>}</td>
      </tr>)}
    </tbody></table>
    {draft.error && draft.error !== t('favorite.nameRequired') && <p role="alert">{draft.error}</p>}
  </div>
}
