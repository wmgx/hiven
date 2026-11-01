import { useEffect, useRef, useState } from 'react'
import { SearchField, SurfaceBreadcrumbs, SurfaceHeaderField, SurfaceStatus, TextInput, useLocalEscapeLayer, useShortcuts, type MenuItemSpec } from '@hiven/plugin-ui'
import {
  identField, kindById, kindColumns, label, members, removeRecord, replaceRecord, shareField, tokens, updateKind, visibleKind, wholeText,
  type MemoData, type MemoRecord, type MemoText,
} from './model'
import { CopyButton, Footer, Hl, Section, Tags, useBackLayer } from './MemoParts'
import { kindTitle, type Frame, type ViewProps } from './MemoSurface'

const monoish = (value: string) => !/[　-鿿]/.test(value)

/** Delete with a short undo window; undo puts back only this record. */
function useRemove({ db, nav, host, t, commit }: Pick<ViewProps, 'db' | 'nav' | 'host' | 't' | 'commit'>) {
  return async (record: MemoRecord, leave: boolean) => {
    const kind = visibleKind(db, record)
    const next = removeRecord(db, record.id)
    if (!await commit(next)) return
    if (leave) nav.back()
    const single = kind && members(next, kind).length === 1
    host.showToast(t(single ? 'toast.deletedToSingle' : 'toast.deleted'), 'info', {
      action: { label: t('action.undo'), onClick: () => void commit({ ...next, records: [...next.records, record] }) },
    })
  }
}

function useFocusRoot() {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => { root.current?.focus({ preventScroll: true }) }, [])
  return root
}

export function DetailView({ frame, nav, db, host, t, copy, commit }: ViewProps<Extract<Frame, { v: 'detail' }>>) {
  const record = db.records.find(item => item.id === frame.id) as MemoData
  const kind = visibleKind(db, record)
  const root = useFocusRoot()
  const menuRef = useRef<HTMLButtonElement>(null)
  const words = tokens(frame.q)
  const id = identField(db, record)
  const rows = record.fields.length + (record.note ? 1 : 0)
  const sel = Math.min(frame.sel, rows - 1)
  const field = record.fields[sel] as MemoData['fields'][number] | undefined
  const remove = useRemove({ db, nav, host, t, commit })
  const copyField = (index: number) => { const item = record.fields[index]; if (item?.value) return copy(item.value, item.name); return Promise.resolve() }
  const copyNote = () => copy(record.note ?? '', t('scope.note'))
  const copyWhole = () => void copy(wholeText(db, record, t('field.tags'), t('field.note')), t('scope.whole', { count: record.fields.filter(item => item.value).length }))
  const copySelected = () => void (field ? copyField(sel) : copyNote())
  const edit = () => nav.push({ v: 'edit', mode: 'edit', id: record.id })
  const sibling = () => nav.push({ v: 'edit', mode: 'sibling', source: record.id })
  const save = (next: MemoData) => void commit(replaceRecord(db, { ...next, updated: Date.now() }))
  const keys = useShortcuts({
    arrowdown: () => nav.set({ sel: Math.min(rows - 1, sel + 1) }),
    arrowup: () => nav.set({ sel: Math.max(0, sel - 1) }),
    enter: copySelected,
    'mod+c': copySelected,
    'mod+shift+c': copyWhole,
    'mod+e': edit,
    'mod+n': sibling,
    'mod+k': () => menuRef.current?.click(),
  })
  useBackLayer(host, [root], keys.composingRef, true, nav.back)

  const menu: MenuItemSpec[] = [
    { key: 'whole', label: t('action.copyWhole'), onSelect: copyWhole },
    { key: 'edit', label: t('action.edit'), onSelect: edit },
    { key: 'sibling', label: t('action.sibling'), onSelect: sibling },
  ]
  if (field && field !== id) menu.push({ key: 'id', label: t('action.useAsIdentity', { name: field.name }), onSelect: () => {
    void (kind ? commit(updateKind(db, kind.id, item => ({ ...item, idField: field.name }))) : commit(replaceRecord(db, { ...record, idField: field.name })))
      .then(ok => ok && host.showToast(t('toast.identity', { name: field.name }), 'success'))
  } })
  if (field && kind && !kind.order.includes(field.name)) menu.push({ key: 'share', label: t('action.shareField', { name: field.name }), onSelect: () => {
    void commit(shareField(db, kind.id, field.name)).then(ok => ok && host.showToast(t('toast.shared', { name: field.name }), 'success'))
  } })
  menu.push({ key: 'delete', label: t('action.delete'), danger: true, onSelect: () => void remove(record, true) })

  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceBreadcrumbs items={[
      ...(kind ? [{ label: kindTitle(db, kind.id, t), onClick: () => nav.push({ v: 'kind', kid: kind.id, q: '', sel: 0 }) }] : []),
      { label: label(db, record) || t('type.emptyData'), onClick: () => root.current?.focus() },
    ]} />
    <div className="memo-body memo-page">
      <div className="memo-fields">
        {record.fields.map((item, index) => <div key={item.id} className={`memo-field${index === sel ? ' is-selected' : ''}`} onClick={() => { nav.set({ sel: index }); root.current?.focus() }}>
          <span className="memo-field-name">{item.name}
            {item === id && <i className="memo-badge" title={t('badge.identityHint')}>{t('badge.identity')}</i>}
            {kind && !kind.order.includes(item.name) && <i className="memo-badge" title={t('badge.ownHint')}>{t('badge.own')}</i>}
          </span>
          <span className={`memo-field-value${item.value ? (monoish(item.value) ? ' is-mono' : '') : ' is-empty'}`}>{item.value ? <Hl text={item.value} words={words} /> : '—'}</span>
          {item.value ? <span onClick={event => event.stopPropagation()}><CopyButton label={t('action.copyScope', { scope: item.name })} copy={() => copyField(index)} /></span> : <span />}
        </div>)}
      </div>
      {record.note && <Section title={t('field.note')} action={<CopyButton label={t('action.copyNote')} copy={copyNote} />}>
        <div className={`memo-note${sel === record.fields.length ? ' is-selected' : ''}`}><Hl text={record.note} words={words} /></div>
      </Section>}
      <Section title={t('field.tags')}>
        <Tags host={host} t={t} own={record.tags} shared={kind?.tags} sharedHint={kind ? t('tag.sharedHint', { name: kindTitle(db, kind.id, t) }) : undefined}
          addLabel={t('tag.add')} onRemove={index => save({ ...record, tags: record.tags.filter((_, i) => i !== index) })}
          onAdd={tag => { if (!record.tags.includes(tag)) save({ ...record, tags: [...record.tags, tag] }) }} />
      </Section>
    </div>
    <Footer t={t} menuRef={menuRef} menu={menu} actions={[
      { label: field ? t('action.copyScope', { scope: field.name }) : t('action.copyNote'), keys: '↵', run: copySelected },
      { label: t('action.copyWhole'), keys: '⌘ ⇧ C', run: copyWhole },
      { label: t('action.edit'), keys: '⌘ E', run: edit },
      { label: t('action.sibling'), keys: '⌘ N', run: sibling },
    ]} />
  </div>
}

export function TextView({ frame, nav, db, host, t, copy, commit }: ViewProps<Extract<Frame, { v: 'text' }>>) {
  const record = db.records.find(item => item.id === frame.id) as MemoText
  const root = useFocusRoot()
  const menuRef = useRef<HTMLButtonElement>(null)
  const words = tokens(frame.q)
  const lines = record.text.split('\n')
  const hit = words.length ? lines.findIndex(line => words.some(word => line.toLowerCase().includes(word))) : -1
  const remove = useRemove({ db, nav, host, t, commit })
  const copyAll = () => void copy(record.text, t('scope.all'))
  const copyLine = () => copy(lines[hit], t('scope.matchedLine'))
  const edit = () => nav.push({ v: 'textEdit', id: record.id })
  const keys = useShortcuts({
    enter: () => { if (hit >= 0) void copyLine(); else copyAll() },
    'mod+c': () => { if (hit >= 0) void copyLine(); else copyAll() },
    'mod+shift+c': copyAll,
    'mod+e': edit,
    'mod+k': () => menuRef.current?.click(),
  })
  useBackLayer(host, [root], keys.composingRef, true, nav.back)
  const save = (tags: string[]) => void commit(replaceRecord(db, { ...record, tags, updated: Date.now() }))
  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceBreadcrumbs items={[{ label: label(db, record), onClick: () => root.current?.focus() }]} />
    <div className="memo-body memo-page">
      <div className="memo-text">
        {lines.map((line, index) => <div key={index} className={`memo-line${index === hit ? ' is-hit' : ''}${line.trim() && monoish(line) ? ' is-mono' : ''}`}>
          {line ? <Hl text={line} words={words} /> : ' '}
          {index === hit && <CopyButton label={t('action.copyMatchedLine')} copy={copyLine} />}
        </div>)}
      </div>
      <Section title={t('field.tags')}>
        <Tags host={host} t={t} own={record.tags} addLabel={t('tag.add')}
          onRemove={index => save(record.tags.filter((_, i) => i !== index))}
          onAdd={tag => { if (!record.tags.includes(tag)) save([...record.tags, tag]) }} />
      </Section>
    </div>
    <SurfaceStatus><span className="memo-status">{t('text.length', { count: record.text.length })}</span></SurfaceStatus>
    <Footer t={t} menuRef={menuRef}
      actions={[
        ...(hit >= 0 ? [{ label: t('action.copyMatchedLine'), keys: '↵', run: () => void copyLine() }, { label: t('action.copyAll'), keys: '⌘ ⇧ C', run: copyAll }]
          : [{ label: t('action.copyAll'), keys: '↵', run: copyAll }]),
        { label: t('action.edit'), keys: '⌘ E', run: edit },
      ]}
      menu={[
        { key: 'convert', label: t('action.convert'), onSelect: () => nav.push({ v: 'edit', mode: 'convert', source: record.id }) },
        { key: 'delete', label: t('action.deleteText'), danger: true, onSelect: () => void remove(record, true) },
      ]} />
  </div>
}

export function KindView({ frame, nav, db, host, t, copy, commit }: ViewProps<Extract<Frame, { v: 'kind' }>>) {
  const kind = kindById(db, frame.kid)!
  const all = members(db, kind)
  const words = tokens(frame.q)
  const context = [kind.name, ...kind.tags].join('\n').toLowerCase()
  const rows = words.length ? all.filter(record => {
    const own = [...record.fields.flatMap(field => [field.name, field.value]), ...record.tags, record.note ?? ''].join('\n').toLowerCase()
    return words.every(word => own.includes(word) || context.includes(word))
  }) : all
  const sel = Math.min(frame.sel, Math.max(0, rows.length - 1))
  const current = rows[sel]
  const columns = kindColumns(db, kind)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const [renaming, setRenaming] = useState(false)
  const remove = useRemove({ db, nav, host, t, commit })
  const valueOf = (record: MemoData, name: string) => record.fields.find(field => field.name === name)?.value ?? ''
  const open = () => { if (current) nav.push({ v: 'detail', id: current.id, q: frame.q, sel: 0 }) }
  const copyId = () => { if (current) void copy(valueOf(current, columns[0]), columns[0]) }
  const sibling = () => nav.push({ v: 'edit', mode: 'sibling', source: (current ?? all[0]).id })
  const keys = useShortcuts({
    arrowdown: () => nav.set({ sel: Math.min(rows.length - 1, sel + 1) }),
    arrowup: () => nav.set({ sel: Math.max(0, sel - 1) }),
    enter: open,
    'mod+c': copyId,
    'mod+n': sibling,
    'mod+k': () => menuRef.current?.click(),
  })
  // Esc clears the filter first, then leaves the table.
  useBackLayer(host, [root, input], keys.composingRef, !renaming, () => frame.q ? nav.set({ q: '', sel: 0 }) : nav.back())
  useLocalEscapeLayer({ open: renaming, triggerRef: renameRef, popupRef: renameRef, owner: host.deliveryFeedbackOwner, composingRef: keys.composingRef, onDismiss: () => setRenaming(false) })
  const rename = (name: string) => {
    setRenaming(false)
    void commit(updateKind(db, kind.id, item => ({ ...item, name: name.trim() })))
  }

  return <div ref={root} className="memo-surface" tabIndex={-1} {...keys.handlers}>
    <SurfaceBreadcrumbs items={[{ label: kindTitle(db, kind.id, t), onClick: () => setRenaming(true) }]} />
    <SurfaceHeaderField>
      {renaming
        ? <TextInput ref={renameRef} autoFocus defaultValue={kind.name} placeholder={t('kind.namePlaceholder')} aria-label={t('action.rename')}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); rename(event.currentTarget.value) } }}
          onBlur={event => rename(event.currentTarget.value)} />
        : <SearchField ref={input} autoFocus data-plugin-surface-autofocus value={frame.q} placeholder={t('kind.filterPlaceholder', { count: all.length })}
          onChange={event => nav.set({ q: event.target.value, sel: 0 })} />}
    </SurfaceHeaderField>
    <div className="memo-strip">
      <span className="memo-count">{rows.length === all.length ? t('kind.count', { count: all.length }) : `${rows.length} / ${all.length}`}</span>
      <span>{t('tag.shared')}</span>
      <Tags host={host} t={t} own={kind.tags} addLabel={t('tag.addShared')}
        onRemove={index => void commit(updateKind(db, kind.id, item => ({ ...item, tags: item.tags.filter((_, i) => i !== index) })))}
        onAdd={tag => void commit(updateKind(db, kind.id, item => item.tags.includes(tag) ? item : { ...item, tags: [...item.tags, tag] }))} />
    </div>
    <div className="memo-body">
      <table className="memo-table">
        <thead><tr>{columns.map(name => <th key={name}>{name}</th>)}</tr></thead>
        <tbody>{rows.map((record, index) => <tr key={record.id} className={index === sel ? 'is-selected' : ''}
          ref={element => { if (index === sel) element?.scrollIntoView({ block: 'nearest' }) }}
          onPointerMove={event => { if ((event.movementX || event.movementY) && index !== sel) nav.set({ sel: index }) }}
          onClick={() => nav.push({ v: 'detail', id: record.id, q: frame.q, sel: 0 })}>
          {columns.map(name => { const value = valueOf(record, name); return <td key={name}><span className="memo-cell">
            <span className={value ? (monoish(value) ? 'is-mono' : '') : 'is-empty'}>{value ? <Hl text={value} words={words} /> : '—'}</span>
            {value && <span onClick={event => event.stopPropagation()}><CopyButton label={t('action.copyCell', { name })} copy={() => copy(value, t('scope.cell', { record: label(db, record), name }))} /></span>}
          </span></td> })}
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="memo-empty-filter">{t('kind.noMatch', { query: frame.q })}</p>}
    </div>
    <Footer t={t} menuRef={menuRef}
      actions={current ? [
        { label: t('action.open'), keys: '↵', run: open },
        { label: t('action.copyScope', { scope: columns[0] }), keys: '⌘ C', run: copyId },
        { label: t('action.sibling'), keys: '⌘ N', run: sibling },
      ] : [{ label: t('action.sibling'), keys: '⌘ N', run: sibling }]}
      menu={[
        ...(current ? [{ key: 'whole', label: t('action.copyWhole'), onSelect: () => void copy(wholeText(db, current, t('field.tags'), t('field.note')), t('scope.whole', { count: current.fields.filter(field => field.value).length })) }] : []),
        { key: 'rename', label: t('action.rename'), onSelect: () => setRenaming(true) },
        ...(current ? [{ key: 'delete', label: t('action.delete'), danger: true, onSelect: () => void remove(current, false) }] : []),
      ]} />
  </div>
}

