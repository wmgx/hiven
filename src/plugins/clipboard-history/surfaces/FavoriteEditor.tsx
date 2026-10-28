import { useCallback, useEffect, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Combobox, TextInput, useImeKeyboard, useLocalEscapeLayer } from '@hiven/plugin-ui'
import type { ClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'
import type { ClipboardHistoryItem, FavoriteField } from '../storage/clipboardHistoryTypes'

type Draft = { title: string; fields: FavoriteField[]; dirty?: boolean; error?: string }

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
    const operation = repository.updateFavoriteInfo(id, draft.title, draft.fields).then(item => {
      if (!item?.isFavorite) throw new Error('error.favoriteFailed')
      onSaved(item)
      if (drafts.current.get(id) === draft) draft.error = undefined
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
    if (!drafts.current.has(item.id)) drafts.current.set(item.id, { title: item.favoriteTitle ?? '', fields: item.favoriteFields ?? [] })
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
    draft: selectedId && (editingId === selectedId || drafts.current.get(selectedId)?.error) ? drafts.current.get(selectedId) : undefined,
    change,
  }
}

export function FavoriteEditor({ draft, names, onChange, onBlur, onExit, host, t }: {
  host: PluginSurfaceProps['host']; draft: Draft; names: string[]; onChange: (draft: Draft) => void; onBlur: () => void; onExit: () => void; t: PluginSurfaceProps['t']
}) {
  const ime = useImeKeyboard()
  const title = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useLocalEscapeLayer({ open: true, triggerRef: root, popupRef: root, owner: host.deliveryFeedbackOwner, composingRef: ime.isImeComposingRef, onDismiss: onExit })
  useEffect(() => { title.current?.focus() }, [])
  return <div ref={root} className="clipboard-history-favorite-form" onBlur={onBlur}
    onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd}
    onKeyDown={event => {
      if (event.defaultPrevented || ime.shouldIgnoreKeyDown(event)) return
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); onExit() }
    }}>
    <TextInput ref={title} aria-label={t('favorite.titlePlaceholder')} placeholder={t('favorite.titlePlaceholder')}
      value={draft.title} maxLength={80} onChange={event => onChange({ ...draft, title: event.target.value })} />
    {draft.fields.map((field, index) => <div className="clipboard-history-field-row" key={index}>
      <Combobox allowCustomValue maxLength={20} options={names.map(name => ({ label: name, value: name }))}
        aria-label={t('favorite.fieldName')} placeholder={t('favorite.fieldName')} value={field.name}
        onChange={name => onChange({ ...draft, fields: draft.fields.map((entry, i) => i === index ? { ...entry, name } : entry) })} />
      <TextInput aria-label={t('favorite.fieldValue')} placeholder={t('favorite.fieldValue')} value={field.value} maxLength={500}
        onChange={event => onChange({ ...draft, fields: draft.fields.map((entry, i) => i === index ? { ...entry, value: event.target.value } : entry) })} />
      <Button onClick={() => onChange({ ...draft, fields: draft.fields.filter((_, i) => i !== index) })}>{t('favorite.removeField')}</Button>
    </div>)}
    <Button disabled={draft.fields.length >= 12} onClick={() => onChange({ ...draft, fields: [...draft.fields, { name: '', value: '' }] })}>{t('favorite.addField')}</Button>
    {draft.error && <p role="alert">{draft.error}</p>}
  </div>
}
