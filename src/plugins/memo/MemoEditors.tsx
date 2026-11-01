import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ActionBar, Button, SurfaceBreadcrumbs, SurfaceError, SurfaceStatus, TextArea, TextInput, useShortcuts } from '@hiven/plugin-ui'
import { addData, addSibling, editData, kindById, label, members, newId, replaceRecord, validateDraft, visibleKind, type DataDraft, type MemoDb, type MemoText } from './model'
import { Section, Tags, useBackLayer, type Host, type T } from './MemoParts'
import type { Frame, ViewProps } from './MemoSurface'

const field = (name = '', value = '') => ({ id: newId('f'), name, value })

function initialDraft(db: MemoDb, frame: Extract<Frame, { v: 'edit' }>): DataDraft {
  const source = db.records.find(record => record.id === (frame.id ?? frame.source))
  if (frame.mode === 'edit' && source?.type === 'data') return { fields: source.fields.map(item => ({ ...item, original: item.name })), tags: source.tags, note: source.note }
  // Next of the same kind: names and order only — values, note and tags start empty.
  if (frame.mode === 'sibling' && source?.type === 'data') {
    const kind = visibleKind(db, source)
    return { fields: (kind ? kind.order : source.fields.map(item => item.name)).map(name => field(name)), tags: [], note: null }
  }
  if (frame.mode === 'convert' && source?.type === 'text') return { fields: [{ ...field('', source.text) }], tags: source.tags, note: null }
  return { fields: [field()], tags: [], note: null }
}

/** Unsaved work: report it to the host, and make the first Esc only warn. */
function useDraftExit(host: Host, dirty: boolean, back: () => void) {
  const [armed, setArmed] = useState(false)
  // Report only when dirtiness flips; the host object may be new on every render.
  const hostRef = useRef(host)
  hostRef.current = host
  useEffect(() => { hostRef.current.setUnsavedChanges?.(dirty) }, [dirty])
  useEffect(() => () => hostRef.current.setUnsavedChanges?.(false), [])
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])
  const leave = () => {
    if (dirty && !armed) { setArmed(true); return }
    host.setUnsavedChanges?.(false)
    back()
  }
  return { armed, leave, disarm: () => setArmed(false) }
}

export function DataEditor({ frame, nav, db, host, t, commit }: ViewProps<Extract<Frame, { v: 'edit' }>>) {
  const [initial] = useState(() => {
    const draft = initialDraft(db, frame)
    // The converted text keeps a localized first field name.
    return frame.mode === 'convert' ? { ...draft, fields: draft.fields.map(item => ({ ...item, name: t('field.content') })) } : draft
  })
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<{ row: number; part: 'name' | 'value' } | 'note' | null>(() => ({ row: 0, part: frame.mode === 'sibling' ? 'value' : 'name' }))
  const [saving, setSaving] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const exit = useDraftExit(host, dirty, nav.back)
  const source = db.records.find(record => record.id === (frame.id ?? frame.source))

  useEffect(() => {
    if (!focus) return
    const selector = focus === 'note' ? '[data-memo-note]' : `[data-memo-${focus.part}="${focus.row}"]`
    root.current?.querySelector<HTMLElement>(selector)?.focus()
    setFocus(null)
  }, [focus])

  const change = (next: DataDraft) => { setDraft(next); setError(null); exit.disarm() }
  const patchField = (index: number, patch: Partial<DataDraft['fields'][number]>) => change({ ...draft, fields: draft.fields.map((item, i) => i === index ? { ...item, ...patch } : item) })
  const addField = () => { change({ ...draft, fields: [...draft.fields, field()] }); setFocus({ row: draft.fields.length, part: 'name' }) }
  const move = (index: number, step: number) => {
    const to = index + step
    if (to < 0 || to >= draft.fields.length) return
    const fields = [...draft.fields]
    ;[fields[index], fields[to]] = [fields[to], fields[index]]
    change({ ...draft, fields }); setFocus({ row: to, part: 'value' })
  }
  const removeField = (index: number) => {
    const before = draft
    const fields = draft.fields.filter((_, i) => i !== index)
    change({ ...draft, fields: fields.length ? fields : [field()] })
    host.showToast(t('toast.fieldRemoved', { name: before.fields[index].name || t('field.unnamed') }), 'info', { action: { label: t('action.undo'), onClick: () => setDraft(before) } })
  }

  const save = async () => {
    if (saving) return
    const problem = validateDraft(draft)
    if (problem) { setError(t(`error.${problem}`)); return }
    setSaving(true)
    try {
      if (frame.mode === 'edit' && frame.id) {
        const result = editData(db, frame.id, draft)
        if (!await commit(result.db)) return
        host.setUnsavedChanges?.(false)
        nav.back()
        host.showToast(result.renamed ? t('toast.savedRenamed', { count: result.renamed }) : t('toast.saved'), 'success')
      } else if (frame.mode === 'sibling' && frame.source) {
        const result = addSibling(db, frame.source, draft)
        if (!await commit(result.db)) return
        host.setUnsavedChanges?.(false)
        nav.showKind(result.kindId, result.id)
        const formed = members(result.db, kindById(result.db, result.kindId)!).length === 2
        host.showToast(t(formed ? 'toast.kindFormed' : 'toast.saved'), 'success')
      } else {
        const result = addData(db, draft)
        if (!await commit(result.db)) return
        host.setUnsavedChanges?.(false)
        nav.replace({ v: 'detail', id: result.id, q: '', sel: 0 })
        host.showToast(t(frame.mode === 'convert' ? 'toast.converted' : 'toast.saved'), 'success')
      }
    } finally {
      setSaving(false)
    }
  }

  const rowOf = (target: EventTarget) => Number((target as HTMLElement).closest<HTMLElement>('[data-memo-row]')?.dataset.memoRow ?? -1)
  const keys = useShortcuts({
    'mod+s': () => void save(),
    'alt+arrowup': event => { const row = rowOf(event.target); if (row < 0) return false; move(row, -1) },
    'alt+arrowdown': event => { const row = rowOf(event.target); if (row < 0) return false; move(row, 1) },
    enter: (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const row = rowOf(target)
      if (target.dataset.memoName !== undefined) { setFocus({ row, part: 'value' }); return }
      // A value that already spans lines keeps Enter as a newline; ⇧↵ starts one.
      if (target.dataset.memoValue === undefined || (target as HTMLTextAreaElement).value.includes('\n')) return false
      if (row + 1 < draft.fields.length) setFocus({ row: row + 1, part: draft.fields[row + 1].name ? 'value' : 'name' })
      else addField()
    },
  })
  useBackLayer(host, [root], keys.composingRef, true, exit.leave)

  const title = frame.mode === 'edit' && source ? t('editor.editTitle', { name: label(db, source) }) : t(`editor.${frame.mode}`)
  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceBreadcrumbs items={[{ label: title, onClick: () => undefined }]} />
    {error && <SurfaceError><span role="alert">{error}</span></SurfaceError>}
    <div className="memo-body memo-page">
      {frame.mode === 'sibling' && source && <p className="memo-hint">{t('editor.siblingHint', { name: label(db, source) })}</p>}
      {frame.mode === 'convert' && <p className="memo-hint">{t('editor.convertHint')}</p>}
      <div className="memo-editor">
        {draft.fields.map((item, index) => <div key={item.id} className="memo-editor-row" data-memo-row={index}>
          <TextInput data-memo-name={index} value={item.name} placeholder={t(index ? 'field.namePlaceholder' : 'field.firstNamePlaceholder')} aria-label={t('field.name')}
            onChange={event => patchField(index, { name: event.target.value })} />
          <TextArea data-memo-value={index} rows={Math.max(1, item.value.split('\n').length)} value={item.value} placeholder={t('field.valuePlaceholder')} aria-label={t('field.value')}
            onChange={event => patchField(index, { value: event.target.value })} />
          <span className="memo-editor-ops">
            <Button variant="ghost" aria-label={t('editor.moveUp')} title={t('editor.moveUp')} onClick={() => move(index, -1)}>↑</Button>
            <Button variant="ghost" aria-label={t('editor.moveDown')} title={t('editor.moveDown')} onClick={() => move(index, 1)}>↓</Button>
            <Button variant="ghost" aria-label={t('editor.removeField')} title={t('editor.removeField')} onClick={() => removeField(index)}>×</Button>
          </span>
        </div>)}
      </div>
      <div className="memo-editor-more">
        <Button variant="ghost" onClick={addField}>+ {t('editor.addField')}</Button>
        {draft.note === null && <Button variant="ghost" onClick={() => { change({ ...draft, note: '' }); setFocus('note') }}>+ {t('editor.addNote')}</Button>}
      </div>
      {draft.note !== null && <Section title={t('field.note')}>
        <TextArea data-memo-note rows={4} value={draft.note} placeholder={t('field.notePlaceholder')} onChange={event => change({ ...draft, note: event.target.value })} />
      </Section>}
      <Section title={t('field.tags')}>
        <Tags host={host} t={t} own={draft.tags} addLabel={t('tag.add')}
          onRemove={index => change({ ...draft, tags: draft.tags.filter((_, i) => i !== index) })}
          onAdd={tag => { if (!draft.tags.includes(tag)) change({ ...draft, tags: [...draft.tags, tag] }) }} />
      </Section>
    </div>
    <SurfaceStatus><span className={`memo-status${exit.armed ? ' is-warning' : ''}`}>{exit.armed ? t('editor.discardHint') : t('editor.keysHint')}</span></SurfaceStatus>
    <EditorFooter t={t} saving={saving} onCancel={exit.leave} onSave={() => void save()} />
  </div>
}

export function TextEditor({ frame, nav, db, host, t, commit }: ViewProps<Extract<Frame, { v: 'textEdit' }>>) {
  const record = frame.id ? db.records.find(item => item.id === frame.id) as MemoText | undefined : undefined
  const [text, setText] = useState(record?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const exit = useDraftExit(host, text !== (record?.text ?? ''), nav.back)
  const save = async () => {
    if (saving) return
    if (!text.trim()) { setError(t('error.emptyText')); return }
    setSaving(true)
    try {
      const now = Date.now()
      if (record) {
        if (!await commit(replaceRecord(db, { ...record, text, updated: now }))) return
        host.setUnsavedChanges?.(false)
        nav.back()
      } else {
        const id = newId('t')
        if (!await commit({ ...db, records: [...db.records, { id, type: 'text', text, tags: [], updated: now }] })) return
        host.setUnsavedChanges?.(false)
        nav.replace({ v: 'text', id, q: '' })
      }
      host.showToast(t('toast.saved'), 'success')
    } finally {
      setSaving(false)
    }
  }
  const keys = useShortcuts({ 'mod+s': () => void save() })
  useBackLayer(host, [root], keys.composingRef, true, exit.leave)
  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceBreadcrumbs items={[{ label: t(record ? 'editor.editText' : 'editor.newText'), onClick: () => undefined }]} />
    {error && <SurfaceError><span role="alert">{error}</span></SurfaceError>}
    <div className="memo-body memo-page">
      <TextArea variant="editor" autoFocus className="memo-text-editor" value={text} placeholder={t('editor.textPlaceholder')}
        onChange={event => { setText(event.target.value); setError(null); exit.disarm() }} />
    </div>
    <SurfaceStatus><span className={`memo-status${exit.armed ? ' is-warning' : ''}`}>{exit.armed ? t('editor.discardHint') : ''}</span></SurfaceStatus>
    <EditorFooter t={t} saving={saving} onCancel={exit.leave} onSave={() => void save()} />
  </div>
}

function EditorFooter({ t, saving, onCancel, onSave }: { t: T; saving: boolean; onCancel(): void; onSave(): void }) {
  return <ActionBar>
    <Button variant="ghost" onMouseDown={event => event.preventDefault()} onClick={onCancel}>{t('action.cancel')}<kbd>esc</kbd></Button>
    <Button variant="ghost" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={onSave}>{t('action.save')}<kbd>⌘</kbd><kbd>S</kbd></Button>
  </ActionBar>
}
